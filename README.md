---
title: AI Invoice Auditor
emoji: 📄
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# AI Invoice Auditor

An end-to-end **multi-agent AI system** that ingests invoices (PDF, DOCX, scanned images), extracts structured data, validates it against configurable business rules, flags discrepancies for human review, and answers natural-language questions about processed invoices via a RAG chatbot.

Built with **LangGraph**, **LangChain**, **Groq (Llama 3.3 70B)**, **Chroma**, **Supabase (Postgres + Storage)**, **FastAPI**, and **Next.js**.

---

## Features

- **Multi-agent pipeline** orchestrated with LangGraph — 6 specialised agents collaborate on each invoice
- **Human-in-the-loop** — workflow pauses on low-confidence/ambiguous invoices and resumes after approval/rejection from the dashboard
- **Multi-modal ingestion** — native parsing for PDF, DOCX, and scanned images (Tesseract OCR)
- **Multi-language support** — built-in translation agent handles English, German, Spanish invoices
- **Rules engine** — business rules (tolerances, accepted currencies, validation policies) driven by `config/rules.yaml`, decoupled from code
- **Mock ERP integration** — simulates enterprise lookups for PO/vendor reconciliation
- **RAG chatbot** — FAISS + sentence-transformers embeddings let users query processed invoices in natural language
- **Stateful & resumable** — LangGraph Postgres checkpointer (Supabase) survives restarts and supports human-review interrupts
- **Cloud storage** — invoice blobs in Supabase Storage, structured reports in Postgres `reports` table; no filesystem persistence required
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
- **Embeddings / RAG:** sentence-transformers (`all-MiniLM-L6-v2`), Chroma (Cloud or local)
- **OCR & Parsing:** Tesseract, pypdf, python-docx, Pillow
- **State + Blobs:** Supabase Postgres (LangGraph checkpoints + `reports` table) and Supabase Storage (PDF/DOCX/image blobs)
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
# add your Supabase credentials — see "Supabase setup" below

# One-time: migrate any pre-existing local reports/PDFs into Supabase.
python -m scripts.migrate_to_supabase

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

Open http://localhost:3000. Upload an invoice via the UI (it lands in the Supabase Storage `invoices` bucket under `inbox/`), click **Process New Invoices**, then review reports or open the QA chat.

---

## Supabase setup

1. Create a free Supabase project at https://supabase.com.
2. In the SQL Editor, run:
   ```sql
   create table reports (
     file_name      text primary key,
     report         jsonb not null,
     vendor         text,
     total          numeric,
     currency       text,
     invoice_date   date,
     status         text,
     recommendation text,
     flags          jsonb,
     processed_at   timestamptz default now(),
     updated_at     timestamptz default now()
   );
   create index reports_vendor_idx on reports (vendor);
   create index reports_status_idx on reports (status);
   create index reports_date_idx   on reports (invoice_date);
   create index reports_flags_gin  on reports using gin (flags);

   create table processed_files (
     file_name text primary key,
     added_at  timestamptz default now()
   );
   ```
3. **Storage → New bucket** → name it `invoices`, set to **Private**.
4. **Connect → Session pooler URI** → paste into `SUPABASE_DB_URL` (use a DB password with no special characters).
5. Drop `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from **Project Settings → API** into `.env`.

LangGraph's `PostgresSaver` will create its own checkpoint tables automatically on first run.

---

## API

| Method | Path | Description |
|---|---|---|
| POST | `/process` | Drain the Storage `inbox/` through the LangGraph pipeline |
| POST | `/upload` | Multipart upload an invoice into the Storage `inbox/` |
| GET  | `/invoices` | List processed invoice reports from Postgres (summaries) |
| GET  | `/invoices/{name}` | Full JSON report from Postgres |
| GET  | `/invoices/{name}/file` | Stream the original blob from Storage |
| POST | `/invoices/{name}/decision` | Resume a paused HITL run with `{ status, remarks }` |
| POST | `/chat` | Ask a question — runs the RAG sub-graph against Chroma |

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
