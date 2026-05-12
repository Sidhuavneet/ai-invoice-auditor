import json
import os
import shutil
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv()

from agents.rag_agents.rag import rag_chat
from graph import app as graph_app
from graph import resumer
from graph_utils import mailbox_utils
from graph_utils.embeddings import get_embedding_model
from langchain_community.vectorstores.faiss import FAISS
from langchain_groq import ChatGroq

REPORTS_DIR = Path("outputs/reports")
INBOX_DIR = Path("inbox")
DOC_DB_DIR = Path("docDB")
ERRORS_DIR = Path("outputs/errors")

REPORTS_DIR.mkdir(parents=True, exist_ok=True)
INBOX_DIR.mkdir(parents=True, exist_ok=True)
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


def _summarize_report(filename: str) -> dict:
    try:
        with open(REPORTS_DIR / filename, "r") as f:
            data = json.load(f)
    except Exception:
        return {"file": filename, "status": "error", "recommendation": "", "vendor": "", "invoice_no": "", "total": ""}
    header = data.get("header", {}) or {}
    return {
        "file": filename,
        "invoice_no": header.get("invoice_no", ""),
        "invoice_date": header.get("invoice_date", ""),
        "vendor": header.get("vendor_id", ""),
        "currency": header.get("currency", ""),
        "total": header.get("total_amount", ""),
        "recommendation": (data.get("recommendation") or "").lower().strip(),
        "status": (data.get("status") or "").lower().strip(),
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/invoices")
def list_invoices():
    """List finished reports + any inbox files still in-flight (paused on
    human-review or yet to run). Pending entries get status="pending" so the
    UI can show them with a distinct badge."""
    items: list[dict] = []
    seen_stems: set[str] = set()
    if REPORTS_DIR.exists():
        for f in sorted(os.listdir(REPORTS_DIR)):
            if f.endswith(".json") and f.startswith("RE_"):
                items.append(_summarize_report(f))
                # RE_<stem>.json → track <stem> so we don't double-list
                seen_stems.add(f[3:-5])
    # Inbox files without a corresponding report = pending.
    if INBOX_DIR.exists():
        exts = (".pdf", ".docx", ".png", ".jpg", ".jpeg")
        for f in sorted(os.listdir(INBOX_DIR)):
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
            })
    return items


@app.get("/invoices/{name}")
def get_invoice(name: str):
    # 1) Direct report name (RE_*.json) — return it.
    path = REPORTS_DIR / name
    if path.exists() and name.endswith(".json"):
        with open(path, "r") as f:
            return json.load(f)
    # 2) Inbox filename (e.g. "Actual_invoice.pdf") — check if its report exists
    #    yet. After HITL approval, the graph runs Saver which writes
    #    RE_<stem>.json; the UI keeps the original inbox name in its URL.
    if not name.endswith(".json"):
        stem = name[: name.rfind(".")] if "." in name else name
        report_path = REPORTS_DIR / f"RE_{stem}.json"
        if report_path.exists():
            with open(report_path, "r") as f:
                return json.load(f)
    # 3) Still pending (graph paused or not yet run) — or failed.
    inbox_path = INBOX_DIR / name
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
                "recommendation": "error",
                "human_report": f"Processing failed: {err.get('error','')}. Fix the document or pipeline and re-run /process.",
            }
        return {
            "file_name": name,
            "header": {},
            "line_item": [],
            "discrepancy_report": {"discrepancy_summary": []},
            "status": "manual review",
            "recommendation": "manual review",
            "human_report": "Pipeline is paused awaiting your decision. Approve or reject below to resume processing.",
        }
    raise HTTPException(404, "Invoice not found")


@app.post("/invoices/{name}/decision")
def submit_decision(name: str, body: DecisionBody):
    status = body.status.lower().strip()
    if status not in {"accept", "reject"}:
        raise HTTPException(400, "status must be 'accept' or 'reject'")
    invoice_name = name[: name.rfind(".")] if name.endswith(".json") else name
    if invoice_name.startswith("RE_"):
        invoice_name = invoice_name[3:]
    try:
        resumer(name=invoice_name, status=status, remarks=body.remarks)
    except Exception as e:
        raise HTTPException(500, f"Resume failed: {e}")
    return {"ok": True}


@app.post("/process")
def process_inbox():
    target = "inbox"
    processed = 0
    errors: list[str] = []
    failed: list[str] = []
    seen: set[str] = set()
    MAX_ITERS = 50  # safety net against any future poller weirdness
    iters = 0
    while iters < MAX_ITERS:
        iters += 1
        paths = mailbox_utils.poll(target)
        if not paths or not paths.get("file"):
            break
        fname = paths["file"]
        # If poll() somehow returns the same file twice in one request, stop.
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
            graph_app.invoke(
                {
                    "file_path": file_path,
                    "metadata_path": metadata_path,
                    "file_name": file_name,
                },
                config={"configurable": {"thread_id": file_name}},
            )
            processed += 1
        except Exception as e:
            # One bad file shouldn't block the rest. Record it for the UI and keep going.
            msg = f"{type(e).__name__}: {e}"
            errors.append(f"{fname}: {msg}")
            failed.append(fname)
            try:
                err_path.write_text(json.dumps({"file": fname, "error": msg}), encoding="utf-8")
            except Exception:
                pass
            continue

    # Only after the request completes, unmark failed files so the user can
    # retry them on a future click — never inside the loop, that infinite-loops.
    for fname in failed:
        try:
            mailbox_utils.unmark(fname)
        except Exception:
            pass

    # Always refresh the FAISS index so chat stays in sync, regardless of
    # whether the pipeline reached Saver (e.g. when a graph paused on review).
    indexed = _refresh_index_from_reports()
    return {"processed": processed, "errors": errors, "indexed": indexed}


MANIFEST_PATH = DOC_DB_DIR / "manifest.json"


def _load_manifest() -> dict[str, float]:
    if MANIFEST_PATH.exists():
        try:
            return json.loads(MANIFEST_PATH.read_text())
        except Exception:
            return {}
    return {}


def _save_manifest(m: dict[str, float]) -> None:
    MANIFEST_PATH.write_text(json.dumps(m, indent=2))


def _refresh_index_from_reports(force: bool = False) -> int:
    """Embed only reports that are new or changed since last run.

    Maintains docDB/manifest.json mapping report filename -> mtime. On each call:
      - load existing FAISS index (if any)
      - find reports not yet in manifest, or whose mtime advanced
      - embed only those, append to index
      - update manifest
    Re-embedding the whole corpus on every call wastes CPU and Groq budget; this
    keeps the index incremental and durable across restarts.
    """
    from langchain_core.documents import Document
    from langchain_text_splitters import RecursiveJsonSplitter

    splitter = RecursiveJsonSplitter(max_chunk_size=1999)
    manifest = {} if force else _load_manifest()

    new_docs: list[Document] = []
    new_manifest = dict(manifest)
    for report in REPORTS_DIR.glob("RE_*.json"):
        mtime = report.stat().st_mtime
        if not force and manifest.get(report.name) == mtime:
            continue  # already embedded, unchanged
        try:
            data = json.loads(report.read_text(encoding="utf-8"))
        except Exception:
            continue
        meta = {
            "file_name": data.get("file_name", report.stem),
            "vendor": (data.get("header") or {}).get("vendor_id", ""),
            "invoice_no": (data.get("header") or {}).get("invoice_no", ""),
        }
        for chunk in splitter.split_json(data):
            new_docs.append(Document(page_content=str(chunk), metadata=meta))
        new_manifest[report.name] = mtime

    if not new_docs:
        return 0

    index_file = DOC_DB_DIR / "index.faiss"
    if index_file.exists() and not force:
        db = FAISS.load_local(
            str(DOC_DB_DIR) + "/",
            embeddings=embedding_model,
            allow_dangerous_deserialization=True,
        )
        db.add_documents(new_docs)
    else:
        db = FAISS.from_documents(new_docs, embedding=embedding_model)
    db.save_local(folder_path=str(DOC_DB_DIR) + "/")
    _save_manifest(new_manifest)
    return len(new_docs)


@app.post("/rebuild-index")
def rebuild_index():
    """Force a full rebuild of the FAISS index from outputs/reports/*.json."""
    n = _refresh_index_from_reports(force=True)
    if n == 0:
        raise HTTPException(400, "No reports found in outputs/reports/.")
    return {"ok": True, "indexed": n}


class UploadUrlBody(BaseModel):
    url: str
    filename: Optional[str] = None


@app.post("/upload-url")
def upload_from_url(body: UploadUrlBody):
    """Fetch a remote image/PDF URL and save into inbox/."""
    import urllib.request
    import urllib.parse

    url = body.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "Only http(s) URLs are allowed.")

    parsed = urllib.parse.urlparse(url)
    # Browser-like headers — many hosts return 403 to bare urllib User-Agents
    # and to requests missing a Referer matching the asset's own origin.
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


@app.post("/chat")
def chat(body: ChatBody):
    db = _load_db()
    if db is None:
        raise HTTPException(400, "No invoices indexed yet. Process invoices first.")
    res = rag_chat(query=body.query, llm=llm, db=db)
    return {
        "response": res.get("response", ""),
        "reviewed_response": res.get("reviewed_response", {}),
    }


@app.post("/chat/stream")
def chat_stream(body: ChatBody):
    """Stream the answer token-by-token via SSE.

    Pipeline: synchronous retrieve → streaming generate. Reflection scoring
    runs after the stream and is delivered as a final SSE event.
    """
    db = _load_db()
    if db is None:
        raise HTTPException(400, "No invoices indexed yet. Process invoices first.")

    # Step 1: retrieve relevant chunks (fast, synchronous).
    docs = db.similarity_search(body.query, k=5)
    content = "\n\n".join(d.page_content for d in docs) or "No relevant invoices found."

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
                # SSE event: token
                yield f"event: token\ndata: {json.dumps(token)}\n\n"
            # Final reflection (best-effort, never fail the stream).
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
