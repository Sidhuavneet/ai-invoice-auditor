# AI Invoice Auditor

An end-to-end **multi-agent AI system** that ingests invoices (PDF, DOCX, scanned images), extracts structured data, validates it against configurable business rules, flags discrepancies for human review, and answers natural-language questions about processed invoices via a RAG chatbot.

Built with **LangGraph**, **LangChain**, **Groq (Llama 3.3 70B)**, **FAISS**, and **Streamlit**.

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
- **Streamlit dashboard** — invoice viewer, discrepancy summary, approve/reject controls, QA chat

---

## Architecture

```
Inbox  ──►  Extractor  ──►  Translator  ──►  Validator  ──►  Reporter  ──►  Router
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
- **UI:** Streamlit
- **Config:** YAML rules file

---

## Quick Start

### Prerequisites
- Python 3.11+
- System packages: `tesseract-ocr`, `poppler-utils`
  - macOS: `brew install tesseract poppler`
  - Ubuntu: `sudo apt install tesseract-ocr poppler-utils`

### Install & run

```bash
git clone https://github.com/<your-username>/ai-invoice-auditor.git
cd ai-invoice-auditor

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# add your GROQ_API_KEY (free from https://console.groq.com/keys)

streamlit run main.py
```

Open http://localhost:8501, click **"Process New Invoices"** to run the pipeline on the sample invoices in `inbox/`, then review reports or ask the QA chatbot.

---

## Project Structure

```
.
├── main.py                # Streamlit dashboard
├── graph.py               # LangGraph workflow definition
├── agents/                # Extractor, translator, validator, reporter, saver, RAG
├── graph_utils/           # OCR, parsing, embeddings, mailbox, LLM gateway
├── config/rules.yaml      # Business rules (tolerances, currencies, policies)
├── inbox/                 # Drop invoices here for processing
├── outputs/reports/       # Generated JSON reports
├── docDB/                 # FAISS vector index
├── mock_erp/              # Mock ERP system
└── data/ERP_mockdata/     # Sample ERP records
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

## License

MIT — see [LICENSE](LICENSE).
