# AI Invoice Auditor

An end-to-end **multi-agent AI system** that ingests invoices (PDF, DOCX, scanned images), extracts structured data, validates it against configurable business rules, flags discrepancies for human review, and answers natural-language questions about processed invoices via a RAG chatbot.

Built with **LangGraph**, **LangChain**, **Groq (Llama 3.3 70B)**, **FAISS**, **FastAPI**, and **Next.js**.

---

## Features

- **Multi-agent pipeline** orchestrated with LangGraph — 6 specialised agents collaborate on each invoice
- **Human-in-the-loop** — workflow pauses on low-confidence/ambiguous invoices and resumes after approval/rejection from the dashboard
- **Multi-modal ingestion** — native parsing for PDF, DOCX, and scanned images (Tesseract OCR)
- **Multi-language support** — built-in translation agent handles English, German, Spanish invoices
- **Rules engine** — business rules (tolerances, accepted currencies, validation policies) driven by `config/rules.yaml`, decoupled from code
- **Mock ERP integration** — simulates enterprise lookups for PO/vendor reconciliation
- **RAG chatbot** — FAISS + sentence-transformers embeddings let users query processed invoices in natural language
- **Stateful & resumable** — SQLite checkpointing via LangGraph survives restarts and supports human-review interrupts
- **FastAPI backend + Next.js frontend** — typed REST API consumed by an App Router dashboard

---

## Architecture

```
                ┌─────────────────────────┐         ┌──────────────────────────┐
                │  Next.js (App Router)   │  HTTP   │  FastAPI (api/server.py) │
                │  /, /invoices/[name],   │ ──────► │  /process /invoices …    │
                │  /chat                  │         │  /chat /upload           │
                └─────────────────────────┘         └────────────┬─────────────┘
                                                                 │
                                                                 ▼
Inbox  ──►  Extractor ──►  Translator ──►  Validator ──►  Reporter ──►  Router
                                                                          │
                                          ┌───────────────────────────────┤
                                          ▼                               ▼
                                 Human Review (interrupt)            Auto Approve / Reject
                                          │                               │
                                          └──────────────►  Saver  ◄──────┘
                                                              │
                                                              ▼
                                                 JSON report + FAISS index
```

**Agents**

| Agent | Role |
|---|---|
| Extractor | OCR + LLM extraction of header & line items into structured JSON |
| Translator | Detects language, translates non-English invoices |
| Validator | Field/data-type checks + business validation against ERP using `rules.yaml` |
| Reporter | Generates discrepancy summary + recommendation (approve/reject/manual review) |
| Human Review | LangGraph `interrupt` — pauses graph, awaits dashboard decision |
| Saver | Persists final report, indexes content into FAISS for the chatbot |

---

## Tech Stack

- **Orchestration:** LangGraph, LangChain
- **LLMs:** Groq — `llama-3.3-70b-versatile` (reasoning), `llama-3.1-8b-instant` (utility)
- **Embeddings / RAG:** sentence-transformers (`all-MiniLM-L6-v2`), FAISS
- **OCR & Parsing:** Tesseract, pypdf, python-docx, Pillow
- **State:** SQLite (LangGraph checkpointer)
- **Backend API:** FastAPI + Uvicorn
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Config:** YAML rules file

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- System packages: `tesseract-ocr`, `poppler-utils`
  - macOS: `brew install tesseract poppler`
  - Ubuntu: `sudo apt install tesseract-ocr poppler-utils`

### Backend (FastAPI)

```bash
git clone https://github.com/<your-username>/ai-invoice-auditor.git
cd ai-invoice-auditor

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# add your GROQ_API_KEY (free from https://console.groq.com/keys)

uvicorn api.server:app --reload --port 8000
```

API available at http://localhost:8000 (interactive docs at http://localhost:8000/docs).

### Frontend (Next.js)

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Upload an invoice (or drop one into `inbox/`), click **Process New Invoices**, then review reports or open the QA chat.

---

## API

| Method | Path | Description |
|---|---|---|
| POST | `/process` | Drain `inbox/` through the LangGraph pipeline |
| POST | `/upload` | Multipart upload an invoice into `inbox/` |
| GET  | `/invoices` | List processed invoice reports (summaries) |
| GET  | `/invoices/{name}` | Full JSON report |
| POST | `/invoices/{name}/decision` | Resume a paused HITL run with `{ status, remarks }` |
| POST | `/chat` | Ask a question — runs the RAG sub-graph against FAISS |

---

## Project Structure

```
.
├── api/                    # FastAPI app (server.py)
├── web/                    # Next.js frontend (App Router)
├── graph.py                # LangGraph workflow definition
├── agents/                 # Extractor, translator, validator, reporter, saver, RAG
├── graph_utils/            # OCR, parsing, embeddings, mailbox, LLM gateway
├── config/rules.yaml       # Business rules (tolerances, currencies, policies)
├── inbox/                  # Drop invoices here for processing
├── outputs/reports/        # Generated JSON reports
├── docDB/                  # FAISS vector index
├── mock_erp/               # Mock ERP system
└── data/ERP_mockdata/      # Sample ERP records
```

---

## Configurable Business Rules

`config/rules.yaml` controls validation without code changes:

- Required header & line-item fields
- Data type expectations
- Price / quantity / tax tolerance thresholds
- Accepted currencies and symbol → ISO mapping
- Policies (e.g. missing field → flag, invalid currency → reject)
- Auto-approval confidence threshold

---

## Deployment

- **Backend:** any container host with system access for `tesseract` + `poppler` (Render, Railway, Fly.io). Expose port 8000.
- **Frontend:** Vercel — set `NEXT_PUBLIC_API_URL` to the deployed API URL.

---

## License

MIT — see [LICENSE](LICENSE).
