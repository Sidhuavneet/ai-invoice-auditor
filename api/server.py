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
from langchain_community.vectorstores.faiss import FAISS
from langchain_core.documents import Document
from langchain_groq import ChatGroq

REPORTS_DIR = Path("outputs/reports")
INBOX_DIR = Path("inbox")
PROCESSED_DIR = INBOX_DIR / "processed"
DOC_DB_DIR = Path("docDB")
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
    """Build FAISS from existing reports on first boot so chat is live immediately."""
    if (DOC_DB_DIR / "index.faiss").exists():
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


# ---------- FAISS index (single writer, per-report vector IDs) ------------

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


def _refresh_index_from_reports(force: bool = False) -> int:
    """Embed only reports that are new or changed. Single writer for FAISS.

    On change, deletes the old vector IDs for that report before re-adding,
    so re-processing a file does not accumulate duplicates.
    """
    from langchain_text_splitters import RecursiveJsonSplitter

    splitter = RecursiveJsonSplitter(max_chunk_size=1999)
    manifest = {} if force else _load_manifest()

    index_file = DOC_DB_DIR / "index.faiss"
    db: Optional[FAISS] = None
    if index_file.exists() and not force:
        db = FAISS.load_local(
            str(DOC_DB_DIR) + "/",
            embeddings=embedding_model,
            allow_dangerous_deserialization=True,
        )

    new_manifest = dict(manifest)
    added_total = 0
    pending_first_batch: list[tuple[str, list[Document], list[str]]] = []

    current_reports = {p.name for p in REPORTS_DIR.glob("RE_*.json")}

    # 1) Drop manifest entries for reports that no longer exist on disk.
    for stale in list(new_manifest.keys()):
        if stale not in current_reports:
            ids = new_manifest[stale].get("ids") or []
            if db is not None and ids:
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
        if db is not None and prev and prev.get("ids"):
            try:
                db.delete(ids=prev["ids"])
            except Exception as e:
                print(f"[index] stale-delete failed for {report.name}: {e}")

        if db is None:
            pending_first_batch.append((report.name, docs, ids))
        else:
            db.add_documents(docs, ids=ids)
        new_manifest[report.name] = {"mtime": mtime, "ids": ids}
        added_total += len(docs)

    # If we had no pre-existing index, build it from the first batch.
    if db is None and pending_first_batch:
        all_docs: list[Document] = []
        all_ids: list[str] = []
        for _, docs, ids in pending_first_batch:
            all_docs.extend(docs)
            all_ids.extend(ids)
        db = FAISS.from_documents(all_docs, embedding=embedding_model, ids=all_ids)

    if db is None:
        return 0

    db.save_local(folder_path=str(DOC_DB_DIR) + "/")
    _save_manifest(new_manifest)
    return added_total


@app.post("/rebuild-index")
def rebuild_index():
    """Force a full rebuild of the FAISS index from outputs/reports/*.json."""
    # Wipe existing index files so we truly rebuild from zero.
    for p in DOC_DB_DIR.glob("index.*"):
        try:
            p.unlink()
        except Exception:
            pass
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


def _load_db() -> Optional[FAISS]:
    index_file = DOC_DB_DIR / "index.faiss"
    if not index_file.exists():
        return None
    return FAISS.load_local(
        str(DOC_DB_DIR) + "/",
        embeddings=embedding_model,
        allow_dangerous_deserialization=True,
    )


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


def _retrieve_context(query: str, db: FAISS) -> str:
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
