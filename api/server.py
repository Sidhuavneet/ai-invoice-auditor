import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

from agents.rag_agents.rag import rag_chat
from agents.reporting_agent import _atomic_write_json
from graph import app as graph_app
from graph import resumer
from graph_utils import mailbox_utils
from graph_utils.embeddings import get_embedding_model
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_groq import ChatGroq

REPORTS_DIR = Path("outputs/reports")
INBOX_DIR = Path("inbox")
PROCESSED_DIR = INBOX_DIR / "processed"
DOC_DB_DIR = Path("docDB")
CHROMA_COLLECTION = "invoice_reports"
ERRORS_DIR = Path("outputs/errors")

REPORTS_DIR.mkdir(parents=True, exist_ok=True)
INBOX_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
DOC_DB_DIR.mkdir(parents=True, exist_ok=True)
ERRORS_DIR.mkdir(parents=True, exist_ok=True)

llm = ChatGroq(
    model=os.environ.get("GROQ_REASON_MODEL", "llama-3.3-70b-versatile"),
    temperature=0.5,
    api_key=os.environ.get("GROQ_API_KEY"),
)
embedding_model = get_embedding_model()

app = FastAPI(title="AI Invoice Auditor API")


@app.on_event("startup")
def _bootstrap_index():
    """Build Chroma index from existing reports on first boot so chat is live immediately."""
    if (DOC_DB_DIR / "chroma.sqlite3").exists():
        return
    try:
        n = _refresh_index_from_reports()
        if n:
            print(f"[startup] Indexed {n} chunks from existing reports.")
    except Exception as e:
        print(f"[startup] Index bootstrap skipped: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


class DecisionBody(BaseModel):
    status: str
    remarks: str = ""


class ChatBody(BaseModel):
    query: str


# ---------- canonical status helpers --------------------------------------

FINAL_STATUSES = {"approved", "rejected"}


def _canon_status(raw) -> str:
    s = (str(raw) if raw is not None else "").lower().strip().replace(" ", "_")
    if s in {"accept", "approve", "approved"}:
        return "approved"
    if s in {"reject", "rejected"}:
        return "rejected"
    if s in {"manual_review", "review"}:
        return "manual_review"
    if s in {"not_required"}:
        return "not_required"
    return s  # e.g. "pending", "error", or empty


def _canon_recommendation(raw) -> str:
    s = (str(raw) if raw is not None else "").lower().strip().replace(" ", "_")
    if s in {"approve", "approved", "accept"}:
        return "approve"
    if s in {"reject", "rejected"}:
        return "reject"
    if s in {"manual_review", "review"}:
        return "manual_review"
    return s


def _summarize_report(filename: str) -> dict:
    try:
        with open(REPORTS_DIR / filename, "r") as f:
            data = json.load(f)
    except Exception:
        return {"file": filename, "status": "error", "recommendation": "", "vendor": "", "invoice_no": "", "total": "", "pipeline_status": "error"}
    header = data.get("header", {}) or {}
    return {
        "file": filename,
        "invoice_no": header.get("invoice_no", ""),
        "invoice_date": header.get("invoice_date", ""),
        "vendor": header.get("vendor_id", ""),
        "currency": header.get("currency", ""),
        "total": header.get("total_amount", ""),
        "recommendation": _canon_recommendation(data.get("recommendation")),
        "status": _canon_status(data.get("status")),
        "pipeline_status": data.get("pipeline_status", "ok"),
    }


@app.get("/health")
def health():
    return {"ok": True}


def _to_float_safe(val) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    for ch in ("₹", "$", "€", "£", ",", " "):
        s = s.replace(ch, "")
    try:
        return float(s)
    except ValueError:
        return 0.0


@app.get("/stats")
def stats():
    """Aggregate stats across all reports for the analytics dashboard.

    Returns counts, status distribution, top vendors, spend timeline,
    discrepancy reasons, and simple anomalies — all in one round-trip
    so the dashboard doesn't have to compute things client-side.
    """
    from collections import Counter, defaultdict
    from statistics import median, pstdev

    reports = []
    if REPORTS_DIR.exists():
        for f in sorted(os.listdir(REPORTS_DIR)):
            if not (f.startswith("RE_") and f.endswith(".json")):
                continue
            try:
                data = json.loads((REPORTS_DIR / f).read_text(encoding="utf-8"))
            except Exception:
                continue
            reports.append(data)

    pending_count = 0
    if INBOX_DIR.exists():
        exts = (".pdf", ".docx", ".png", ".jpg", ".jpeg")
        report_stems = {r.get("file_name", "") for r in reports}
        for f in sorted(os.listdir(INBOX_DIR)):
            full = INBOX_DIR / f
            if not full.is_file():
                continue
            if not f.lower().endswith(exts):
                continue
            stem = f[: f.rfind(".")]
            if stem not in report_stems:
                pending_count += 1

    total = len(reports)
    status_counts: Counter = Counter()
    spend_by_currency: dict[str, float] = defaultdict(float)
    vendor_spend: dict[str, float] = defaultdict(float)
    vendor_counts: Counter = Counter()
    vendor_currency: dict[str, str] = {}
    spend_by_date: dict[str, float] = defaultdict(float)
    reason_counter: Counter = Counter()
    confidences: list[float] = []
    invoice_totals_by_vendor: dict[str, list[float]] = defaultdict(list)
    line_item_count = 0
    auto_approved = 0
    manual_review = 0
    rejected_count = 0
    approved_count = 0

    for r in reports:
        st = _canon_status(r.get("status"))
        rec = _canon_recommendation(r.get("recommendation"))
        status_counts[st or "unknown"] += 1
        if st == "approved":
            approved_count += 1
            if rec == "approve":
                auto_approved += 1
        elif st == "rejected":
            rejected_count += 1
        elif st == "manual_review":
            manual_review += 1

        h = r.get("header") or {}
        total_amt = _to_float_safe(h.get("total_amount"))
        cur = (h.get("currency") or "").strip().upper() or "USD"
        if total_amt:
            spend_by_currency[cur] += total_amt
            vendor = (h.get("vendor_id") or "Unknown").strip() or "Unknown"
            vendor_spend[vendor] += total_amt
            vendor_counts[vendor] += 1
            vendor_currency.setdefault(vendor, cur)
            invoice_totals_by_vendor[vendor].append(total_amt)
        date = h.get("invoice_date") or ""
        if date:
            spend_by_date[str(date)[:10]] += total_amt

        reasons = r.get("reasons") or []
        for reason in reasons:
            # Group similar reason strings into categories.
            rs = str(reason).lower()
            if "currency" in rs:
                key = "Currency issue"
            elif "missing" in rs:
                key = "Missing field"
            elif "translation confidence" in rs:
                key = "Low translation confidence"
            elif "future" in rs:
                key = "Future-dated"
            elif "discrepanc" in rs or "erp" in rs:
                key = "ERP discrepancy"
            elif "total" in rs or "math" in rs or "sum" in rs:
                key = "Total mismatch"
            else:
                key = "Other"
            reason_counter[key] += 1

        try:
            confidences.append(float(r.get("translation_confidence", 1.0) or 0.0))
        except Exception:
            pass
        line_item_count += len(r.get("line_item") or [])

    top_vendors = []
    for vendor, spend in sorted(vendor_spend.items(), key=lambda kv: -kv[1])[:8]:
        top_vendors.append({
            "vendor": vendor,
            "spend": round(spend, 2),
            "count": vendor_counts[vendor],
            "currency": vendor_currency.get(vendor, ""),
        })

    spend_timeline = [
        {"date": d, "amount": round(amt, 2)}
        for d, amt in sorted(spend_by_date.items())
    ]

    # Anomalies: invoices > median + 2σ for their vendor.
    anomalies = []
    for r in reports:
        h = r.get("header") or {}
        total_amt = _to_float_safe(h.get("total_amount"))
        vendor = (h.get("vendor_id") or "").strip()
        if not (vendor and total_amt):
            continue
        peers = invoice_totals_by_vendor.get(vendor, [])
        if len(peers) < 3:
            continue
        m = median(peers)
        try:
            sigma = pstdev(peers)
        except Exception:
            sigma = 0.0
        if sigma > 0 and total_amt > m + 2 * sigma:
            anomalies.append({
                "file": r.get("file_name", ""),
                "vendor": vendor,
                "amount": round(total_amt, 2),
                "median": round(m, 2),
                "reason": f"{total_amt:.2f} is >2σ above {vendor}'s median {m:.2f}",
            })

    # Other anomalies: future dates, unaccepted currency.
    for r in reports:
        h = r.get("header") or {}
        if any(("future" in str(x).lower()) for x in (r.get("reasons") or [])):
            anomalies.append({
                "file": r.get("file_name", ""),
                "vendor": (h.get("vendor_id") or "").strip(),
                "amount": _to_float_safe(h.get("total_amount")),
                "reason": "Future-dated invoice",
            })

    auto_rate = (auto_approved / total * 100.0) if total else 0.0
    avg_conf = (sum(confidences) / len(confidences) * 100.0) if confidences else 0.0

    return {
        "kpis": {
            "total_invoices": total,
            "pending": pending_count,
            "approved": approved_count,
            "rejected": rejected_count,
            "manual_review": manual_review,
            "auto_approval_rate": round(auto_rate, 1),
            "avg_translation_confidence": round(avg_conf, 1),
            "total_line_items": line_item_count,
            "spend_by_currency": {k: round(v, 2) for k, v in spend_by_currency.items()},
        },
        "status_distribution": [
            {"status": k, "count": v} for k, v in status_counts.items()
        ],
        "top_vendors": top_vendors,
        "spend_timeline": spend_timeline,
        "discrepancy_reasons": [
            {"reason": k, "count": v} for k, v in reason_counter.most_common()
        ],
        "anomalies": anomalies[:10],
    }


@app.get("/invoices")
def list_invoices():
    items: list[dict] = []
    seen_stems: set[str] = set()
    if REPORTS_DIR.exists():
        for f in sorted(os.listdir(REPORTS_DIR)):
            if f.endswith(".json") and f.startswith("RE_"):
                items.append(_summarize_report(f))
                seen_stems.add(f[3:-5])
    if INBOX_DIR.exists():
        exts = (".pdf", ".docx", ".png", ".jpg", ".jpeg")
        for f in sorted(os.listdir(INBOX_DIR)):
            full = INBOX_DIR / f
            if not full.is_file():
                continue
            if not f.lower().endswith(exts):
                continue
            stem = f[: f.rfind(".")]
            if stem in seen_stems:
                continue
            items.append({
                "file": f,
                "invoice_no": "",
                "invoice_date": "",
                "vendor": "",
                "currency": "",
                "total": "",
                "recommendation": "",
                "status": "pending",
                "pipeline_status": "pending",
            })
    return items


@app.get("/invoices/{name}")
def get_invoice(name: str):
    path = REPORTS_DIR / name
    if path.exists() and name.endswith(".json"):
        with open(path, "r") as f:
            data = json.load(f)
            data["status"] = _canon_status(data.get("status"))
            data["recommendation"] = _canon_recommendation(data.get("recommendation"))
            return data
    if not name.endswith(".json"):
        stem = name[: name.rfind(".")] if "." in name else name
        report_path = REPORTS_DIR / f"RE_{stem}.json"
        if report_path.exists():
            with open(report_path, "r") as f:
                data = json.load(f)
                data["status"] = _canon_status(data.get("status"))
                data["recommendation"] = _canon_recommendation(data.get("recommendation"))
                return data
    inbox_path = INBOX_DIR / name
    if not inbox_path.exists():
        inbox_path = PROCESSED_DIR / name
    if inbox_path.exists():
        stem = name[: name.rfind(".")] if "." in name else name
        err_path = ERRORS_DIR / f"{stem}.json"
        if err_path.exists():
            try:
                err = json.loads(err_path.read_text(encoding="utf-8"))
            except Exception:
                err = {"error": "unknown processing error"}
            return {
                "file_name": name,
                "header": {},
                "line_item": [],
                "discrepancy_report": {"discrepancy_summary": []},
                "status": "error",
                "recommendation": "",
                "pipeline_status": "error",
                "human_report": f"Processing failed: {err.get('error','')}. Fix the document or pipeline and re-run /process.",
            }
        return {
            "file_name": name,
            "header": {},
            "line_item": [],
            "discrepancy_report": {"discrepancy_summary": []},
            "status": "manual_review",
            "recommendation": "manual_review",
            "pipeline_status": "pending",
            "human_report": "Pipeline is paused awaiting your decision. Approve or reject below to resume processing.",
        }
    raise HTTPException(404, "Invoice not found")


@app.get("/invoices/{name}/file")
def get_invoice_file(name: str):
    """Stream the original uploaded file for preview.

    Looks in inbox/, inbox/processed/, then falls back to matching by stem
    (so the UI can pass either the inbox filename or RE_<stem>.json).
    """
    # Strip directory components to prevent traversal.
    safe = Path(name).name
    if safe.endswith(".json") and safe.startswith("RE_"):
        safe = safe[3:-5]
    stem = safe[: safe.rfind(".")] if "." in safe else safe
    candidates: list[Path] = []
    # Exact name match first.
    for base in (INBOX_DIR, PROCESSED_DIR):
        candidates.append(base / safe)
    # Stem match across known extensions.
    for base in (INBOX_DIR, PROCESSED_DIR):
        for ext in (".pdf", ".png", ".jpg", ".jpeg", ".docx"):
            candidates.append(base / f"{stem}{ext}")
    for c in candidates:
        if c.is_file():
            media = {
                ".pdf": "application/pdf",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }.get(c.suffix.lower(), "application/octet-stream")
            # content_disposition_type="inline" so browsers render PDFs/images
            # in an iframe/img instead of forcing a download prompt.
            return FileResponse(
                str(c),
                media_type=media,
                filename=c.name,
                content_disposition_type="inline",
            )
    raise HTTPException(404, "Source file not found")


@app.post("/invoices/{name}/decision")
def submit_decision(name: str, body: DecisionBody):
    decided = _canon_status(body.status)
    if decided not in FINAL_STATUSES:
        raise HTTPException(400, "status must be 'approve'/'accept' or 'reject'")
    invoice_name = name[: name.rfind(".")] if name.endswith(".json") else name
    if invoice_name.startswith("RE_"):
        invoice_name = invoice_name[3:]
    try:
        # Resumer passes status straight back into state; saver normalizes.
        resumer(name=invoice_name, status=decided, remarks=body.remarks)
    except Exception as e:
        raise HTTPException(500, f"Resume failed: {e}")
    # Move source file to processed/ once finalized.
    _move_to_processed(invoice_name)
    # Refresh index so chat reflects the new status immediately.
    try:
        _refresh_index_from_reports()
    except Exception as e:
        print(f"[decision] index refresh skipped: {e}")
    return {"ok": True, "status": decided}


def _move_to_processed(stem: str) -> None:
    for ext in (".pdf", ".docx", ".png", ".jpg", ".jpeg"):
        src = INBOX_DIR / f"{stem}{ext}"
        if src.exists() and src.is_file():
            try:
                shutil.move(str(src), str(PROCESSED_DIR / src.name))
                # Also drop from added.json so re-uploading the same filename
                # later triggers a fresh /process pass.
                try:
                    mailbox_utils.unmark(src.name)
                except Exception:
                    pass
            except Exception as e:
                print(f"[processed-move] {src.name}: {e}")
    meta = INBOX_DIR / f"{stem}.meta.json"
    if meta.exists():
        try:
            shutil.move(str(meta), str(PROCESSED_DIR / meta.name))
        except Exception:
            pass


@app.post("/process")
def process_inbox():
    target = "inbox"
    processed = 0
    errors: list[str] = []
    failed: list[str] = []
    seen: set[str] = set()
    MAX_ITERS = int(os.environ.get("MAX_PROCESS_ITERS", "50"))
    iters = 0
    truncated = False
    while iters < MAX_ITERS:
        iters += 1
        paths = mailbox_utils.poll(target)
        if not paths or not paths.get("file"):
            break
        fname = paths["file"]
        if fname in seen:
            break
        seen.add(fname)
        file_path = f"{target}/{fname}"
        metadata_path = f"{target}/{paths['meta']}" if paths["meta"] else ""
        file_name = fname[: fname.rfind(".")]
        err_path = ERRORS_DIR / f"{file_name}.json"
        try:
            if err_path.exists():
                err_path.unlink()
            result_state = graph_app.invoke(
                {
                    "file_path": file_path,
                    "metadata_path": metadata_path,
                    "file_name": file_name,
                },
                config={"configurable": {"thread_id": file_name}},
            )
            processed += 1
            # Auto-finalized (no human-review pause) → move to processed/.
            final_status = _canon_status((result_state or {}).get("status"))
            if final_status in FINAL_STATUSES:
                _move_to_processed(file_name)
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            errors.append(f"{fname}: {msg}")
            failed.append(fname)
            try:
                err_path.write_text(json.dumps({"file": fname, "error": msg}), encoding="utf-8")
            except Exception:
                pass
            continue
    else:
        # Loop exited because we hit MAX_ITERS without `break` — check if more remain.
        pass
    # Detect truncation: there are still un-added inbox files after we stopped.
    try:
        nxt = mailbox_utils.poll(target)
        if nxt and nxt.get("file"):
            truncated = True
            # We just consumed it via poll(); roll it back.
            mailbox_utils.unmark(nxt["file"])
    except Exception:
        pass

    for fname in failed:
        try:
            mailbox_utils.unmark(fname)
        except Exception:
            pass

    indexed = _refresh_index_from_reports()
    return {
        "processed": processed,
        "errors": errors,
        "indexed": indexed,
        "truncated": truncated,
        "max_iters": MAX_ITERS,
    }


# Human-readable labels for each LangGraph node, surfaced live in the UI.
NODE_LABELS = {
    "extractor": "Extracting",
    "translate": "Translating",
    "validation": "Validating",
    "reporting": "Auditing",
    "human": "Awaiting review",
    "final": "Saving",
}


@app.post("/process/stream")
def process_inbox_stream():
    """SSE variant of /process. Streams per-node + per-file events so the UI
    can render a live agent pipeline visualization (extractor → translate →
    validation → reporting → final). Uses LangGraph's stream() instead of
    invoke() so we observe each node as it completes.

    Events emitted (each line: `event: <name>\\ndata: <json>\\n\\n`):
      - file_start  : {file}
      - node        : {file, node, label, status: "running"|"done"}
      - file_done   : {file, status, error?}
      - paused      : {file}                — graph hit HITL interrupt
      - summary     : {processed, errors, indexed, truncated}
      - done        : {}
    """
    def event_stream():
        target = "inbox"
        processed = 0
        errors: list[str] = []
        failed: list[str] = []
        seen: set[str] = set()
        MAX_ITERS = int(os.environ.get("MAX_PROCESS_ITERS", "50"))
        iters = 0
        truncated = False

        def evt(name: str, payload: dict) -> str:
            return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

        while iters < MAX_ITERS:
            iters += 1
            paths = mailbox_utils.poll(target)
            if not paths or not paths.get("file"):
                break
            fname = paths["file"]
            if fname in seen:
                break
            seen.add(fname)
            file_path = f"{target}/{fname}"
            metadata_path = f"{target}/{paths['meta']}" if paths["meta"] else ""
            file_name = fname[: fname.rfind(".")]
            err_path = ERRORS_DIR / f"{file_name}.json"

            yield evt("file_start", {"file": fname})

            try:
                if err_path.exists():
                    err_path.unlink()
                final_state: dict = {}
                # stream() yields {node_name: state_update} after each node.
                for step in graph_app.stream(
                    {
                        "file_path": file_path,
                        "metadata_path": metadata_path,
                        "file_name": file_name,
                    },
                    config={"configurable": {"thread_id": file_name}},
                ):
                    for node_name, state_update in (step or {}).items():
                        # LangGraph emits a magic "__interrupt__" sentinel when
                        # a node calls interrupt() for HITL.
                        if node_name == "__interrupt__":
                            yield evt("paused", {"file": fname})
                            continue
                        yield evt("node", {
                            "file": fname,
                            "node": node_name,
                            "label": NODE_LABELS.get(node_name, node_name),
                            "status": "done",
                        })
                        if isinstance(state_update, dict):
                            final_state.update(state_update)

                processed += 1
                status = _canon_status(final_state.get("status"))
                if status in FINAL_STATUSES:
                    _move_to_processed(file_name)
                yield evt("file_done", {"file": fname, "status": status or "manual_review"})
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                errors.append(f"{fname}: {msg}")
                failed.append(fname)
                try:
                    err_path.write_text(json.dumps({"file": fname, "error": msg}), encoding="utf-8")
                except Exception:
                    pass
                yield evt("file_done", {"file": fname, "status": "error", "error": msg})

        # Truncation probe — same logic as /process.
        try:
            nxt = mailbox_utils.poll(target)
            if nxt and nxt.get("file"):
                truncated = True
                mailbox_utils.unmark(nxt["file"])
        except Exception:
            pass
        for fname in failed:
            try:
                mailbox_utils.unmark(fname)
            except Exception:
                pass

        indexed = _refresh_index_from_reports()
        yield evt("summary", {
            "processed": processed,
            "errors": errors,
            "indexed": indexed,
            "truncated": truncated,
        })
        yield evt("done", {})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------- Chroma index (single writer, per-report vector IDs) ----------

MANIFEST_PATH = DOC_DB_DIR / "manifest.json"


def _load_manifest() -> dict:
    """Manifest schema: {report_name: {"mtime": float, "ids": [str, ...]}}.

    Tolerates legacy schema where the value was a bare float; those entries
    are treated as having unknown IDs (forced re-add on next refresh).
    """
    if not MANIFEST_PATH.exists():
        return {}
    try:
        raw = json.loads(MANIFEST_PATH.read_text())
    except Exception:
        return {}
    out: dict = {}
    for k, v in raw.items():
        if isinstance(v, dict):
            out[k] = {"mtime": float(v.get("mtime") or 0), "ids": list(v.get("ids") or [])}
        else:
            # Legacy: float mtime, no IDs tracked.
            out[k] = {"mtime": float(v or 0), "ids": []}
    return out


def _save_manifest(m: dict) -> None:
    _atomic_write_json(str(MANIFEST_PATH), m)


def _open_chroma() -> Chroma:
    """Open (or create) the persistent Chroma collection used by chat."""
    return Chroma(
        collection_name=CHROMA_COLLECTION,
        embedding_function=embedding_model,
        persist_directory=str(DOC_DB_DIR),
    )


def _refresh_index_from_reports(force: bool = False) -> int:
    """Embed only reports that are new or changed. Single writer for the vector DB.

    On change, deletes the old vector IDs for that report before re-adding,
    so re-processing a file does not accumulate duplicates.
    """
    from langchain_text_splitters import RecursiveJsonSplitter

    splitter = RecursiveJsonSplitter(max_chunk_size=1999)
    manifest = {} if force else _load_manifest()

    db = _open_chroma()
    new_manifest = dict(manifest)
    added_total = 0

    current_reports = {p.name for p in REPORTS_DIR.glob("RE_*.json")}

    # 1) Drop manifest entries for reports that no longer exist on disk.
    for stale in list(new_manifest.keys()):
        if stale not in current_reports:
            ids = new_manifest[stale].get("ids") or []
            if ids:
                try:
                    db.delete(ids=ids)
                except Exception as e:
                    print(f"[index] stale-delete failed for {stale}: {e}")
            del new_manifest[stale]

    # 2) Add/update changed reports.
    for report in REPORTS_DIR.glob("RE_*.json"):
        mtime = report.stat().st_mtime
        prev = new_manifest.get(report.name)
        if prev and prev.get("mtime") == mtime and not force:
            continue
        try:
            data = json.loads(report.read_text(encoding="utf-8"))
        except Exception:
            continue
        meta = {
            "file_name": data.get("file_name", report.stem),
            "vendor": (data.get("header") or {}).get("vendor_id", ""),
            "invoice_no": (data.get("header") or {}).get("invoice_no", ""),
            "source_report": report.name,
        }
        docs: list[Document] = []
        ids: list[str] = []
        for chunk in splitter.split_json(data):
            docs.append(Document(page_content=str(chunk), metadata=meta))
            ids.append(str(uuid.uuid4()))
        if not docs:
            continue
        # Delete prior vectors for this report (if any) so re-process doesn't dup.
        if prev and prev.get("ids"):
            try:
                db.delete(ids=prev["ids"])
            except Exception as e:
                print(f"[index] stale-delete failed for {report.name}: {e}")
        db.add_documents(docs, ids=ids)
        new_manifest[report.name] = {"mtime": mtime, "ids": ids}
        added_total += len(docs)

    _save_manifest(new_manifest)
    return added_total


@app.post("/rebuild-index")
def rebuild_index():
    """Force a full rebuild of the Chroma index from outputs/reports/*.json."""
    # Drop the entire collection so we rebuild from zero.
    try:
        db = _open_chroma()
        db.delete_collection()
    except Exception as e:
        print(f"[rebuild] drop-collection failed: {e}")
    if MANIFEST_PATH.exists():
        try:
            MANIFEST_PATH.unlink()
        except Exception:
            pass
    n = _refresh_index_from_reports(force=True)
    if n == 0:
        raise HTTPException(400, "No reports found in outputs/reports/.")
    return {"ok": True, "indexed": n}


class UploadUrlBody(BaseModel):
    url: str
    filename: Optional[str] = None


@app.post("/upload-url")
def upload_from_url(body: UploadUrlBody):
    import urllib.request
    import urllib.parse

    url = body.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "Only http(s) URLs are allowed.")

    parsed = urllib.parse.urlparse(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,application/pdf,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{parsed.scheme}://{parsed.netloc}/",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    except urllib.error.HTTPError as e:
        raise HTTPException(
            400,
            f"Source returned {e.code} for {parsed.netloc}. "
            "The site likely blocks remote fetches (hotlink protection). "
            "Save the image locally and use the Upload button.",
        )
    except Exception as e:
        raise HTTPException(400, f"Could not fetch URL: {e}")

    ext_map = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
        "application/pdf": ".pdf",
    }
    ext = ext_map.get(ctype)
    if not ext:
        guess = Path(urllib.parse.urlparse(url).path).suffix.lower()
        if guess in {".png", ".jpg", ".jpeg", ".pdf", ".docx"}:
            ext = guess
    if not ext:
        raise HTTPException(400, f"Unsupported content type: {ctype or 'unknown'}")

    name = body.filename or Path(urllib.parse.urlparse(url).path).name or f"web{ext}"
    if not name.lower().endswith(ext):
        name = Path(name).stem + ext
    dest = INBOX_DIR / name
    dest.write_bytes(data)
    return {"ok": True, "filename": dest.name}


@app.post("/upload")
async def upload_invoice(file: UploadFile = File(...)):
    allowed = {".pdf", ".docx", ".png", ".jpg", ".jpeg"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported file type: {ext}")
    dest = INBOX_DIR / (file.filename or "upload" + ext)
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)
    # A fresh upload is an explicit request to re-process. Clear any stale
    # poller bookkeeping AND any previous report so the next /process picks it up.
    try:
        mailbox_utils.unmark(dest.name)
    except Exception:
        pass
    stem = dest.stem
    old_report = REPORTS_DIR / f"RE_{stem}.json"
    if old_report.exists():
        try:
            old_report.unlink()
        except Exception:
            pass
    return {"ok": True, "filename": dest.name}


def _load_db() -> Optional[Chroma]:
    # Chroma writes a sqlite file on first add; absent file = nothing indexed.
    if not (DOC_DB_DIR / "chroma.sqlite3").exists():
        return None
    db = _open_chroma()
    # An empty collection is equivalent to "not indexed yet" for chat purposes.
    try:
        if db._collection.count() == 0:
            return None
    except Exception:
        pass
    return db


# ---------- Chat intent router --------------------------------------------

_AGG_PATTERNS = re.compile(
    r"\b(latest|most\s+recent|newest|oldest|earliest|"
    r"how\s+many|count|number\s+of|total\s+spend|grand\s+total|sum\s+of|"
    r"list\s+all|show\s+all|all\s+invoices|pending|approved|rejected|"
    r"manual\s+review|needs?\s+review|flagged)\b",
    re.IGNORECASE,
)


def _build_full_corpus_context() -> str:
    """Aggregate every report's key fields into a compact table for the LLM.

    Aggregate/temporal questions cannot be answered from k=5 semantic chunks —
    pass the full set of report summaries so the model can count, sort, sum.
    """
    rows = []
    for f in sorted(os.listdir(REPORTS_DIR)) if REPORTS_DIR.exists() else []:
        if not (f.startswith("RE_") and f.endswith(".json")):
            continue
        try:
            data = json.loads((REPORTS_DIR / f).read_text(encoding="utf-8"))
        except Exception:
            continue
        h = data.get("header") or {}
        rows.append({
            "file": f,
            "invoice_no": h.get("invoice_no", ""),
            "invoice_date": h.get("invoice_date", ""),
            "vendor": h.get("vendor_id", ""),
            "currency": h.get("currency", ""),
            "total": h.get("total_amount", ""),
            "recommendation": _canon_recommendation(data.get("recommendation")),
            "status": _canon_status(data.get("status")),
            "reasons": data.get("reasons") or [],
        })
    if not rows:
        return "No invoices indexed yet."
    return json.dumps(rows, ensure_ascii=False, indent=2)


def _retrieve_context(query: str, db: Chroma) -> str:
    """Choose context source based on query intent.

    Aggregate/temporal → full corpus summary (cannot be answered from top-k).
    Otherwise → top-5 semantic chunks.
    """
    if _AGG_PATTERNS.search(query):
        return _build_full_corpus_context()
    docs = db.similarity_search(query, k=5)
    return "\n\n".join(d.page_content for d in docs) or "No relevant invoices found."


@app.post("/chat")
def chat(body: ChatBody):
    db = _load_db()
    if db is None:
        raise HTTPException(400, "No invoices indexed yet. Process invoices first.")
    if _AGG_PATTERNS.search(body.query):
        # Aggregate path: bypass the RAG subgraph (which is k=5 retrieval).
        content = _build_full_corpus_context()
        prompt = (
            "Answer the user's question using ONLY the JSON list of invoices below. "
            "Use markdown with tables when listing.\n\n"
            f"## query\n{body.query}\n\n## invoices\n{content}"
        )
        resp = llm.invoke(prompt).content
        return {"response": resp, "reviewed_response": {}}
    res = rag_chat(query=body.query, llm=llm, db=db)
    return {
        "response": res.get("response", ""),
        "reviewed_response": res.get("reviewed_response", {}),
    }


@app.post("/chat/stream")
def chat_stream(body: ChatBody):
    db = _load_db()
    if db is None:
        raise HTTPException(400, "No invoices indexed yet. Process invoices first.")

    content = _retrieve_context(body.query, db)

    prompt = f"""
You are a helpful invoice chat assistant. Answer the query using only the
provided content. Use proper markdown — headings, bold, bullet lists, and
tables when listing multiple invoices. Do not invent fields that aren't in the
content.

If the query is unrelated to invoices, reply exactly:
"I am an invoice helper assistant. Please ask invoice-related questions."

## query
{body.query}

## content
{content}
"""

    def event_stream():
        full = []
        try:
            for chunk in llm.stream(prompt):
                token = getattr(chunk, "content", "") or ""
                if not token:
                    continue
                full.append(token)
                yield f"event: token\ndata: {json.dumps(token)}\n\n"
            scores = {}
            try:
                full_text = "".join(full)
                review_prompt = (
                    "Score the answer 0-1 on confidence_score, groundness_score, "
                    "content_relevence as JSON only.\n"
                    f"## query: {body.query}\n## content: {content}\n## response: {full_text}"
                )
                rv = llm.invoke(review_prompt).content
                start, end = rv.find("{"), rv.rfind("}")
                if start != -1 and end != -1:
                    scores = json.loads(rv[start : end + 1])
            except Exception:
                scores = {}
            yield f"event: done\ndata: {json.dumps({'reviewed_response': scores})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(str(e))}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
