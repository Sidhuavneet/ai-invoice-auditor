import json
import os
import shutil
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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

REPORTS_DIR.mkdir(parents=True, exist_ok=True)
INBOX_DIR.mkdir(parents=True, exist_ok=True)
DOC_DB_DIR.mkdir(parents=True, exist_ok=True)

llm = ChatGroq(
    model=os.environ.get("GROQ_REASON_MODEL", "llama-3.3-70b-versatile"),
    temperature=0.5,
    api_key=os.environ.get("GROQ_API_KEY"),
)
embedding_model = get_embedding_model()

app = FastAPI(title="AI Invoice Auditor API")

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
    if not REPORTS_DIR.exists():
        return []
    files = sorted([f for f in os.listdir(REPORTS_DIR) if f.endswith(".json")])
    return [_summarize_report(f) for f in files]


@app.get("/invoices/{name}")
def get_invoice(name: str):
    path = REPORTS_DIR / name
    if not path.exists() or not name.endswith(".json"):
        raise HTTPException(404, "Invoice report not found")
    with open(path, "r") as f:
        return json.load(f)


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
    while True:
        paths = mailbox_utils.poll(target)
        if not paths or not paths.get("file"):
            break
        file_path = f"{target}/{paths['file']}"
        metadata_path = f"{target}/{paths['meta']}" if paths["meta"] else ""
        file_name = paths["file"][: paths["file"].rfind(".")]
        try:
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
            errors.append(f"{paths['file']}: {e}")
            break
    return {"processed": processed, "errors": errors}


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
