# AI Invoice Auditor – Simulated Email Invoice Dataset

This folder simulates the type of invoices a logistics company might receive by email from its global vendors.  
Each invoice is represented by:
- A **file** (`.pdf`, `.docx`, or `.png`) – the invoice attachment.
- A **metadata file** (`.meta.json`) – simulating the email header.

---

##  Folder Structure
```
data/incoming/
├── INV_EN_001.pdf
├── INV_EN_001.meta.json
├── INV_EN_002.pdf
├── INV_EN_002.meta.json
├── INV_ES_003.pdf
├── INV_ES_003.meta.json
├── INV_DE_004.docx
├── INV_DE_004.meta.json
├── INV_EN_005_scan.png
├── INV_EN_005_scan.meta.json
├── INV_EN_006_malformed.pdf
├── INV_EN_006_malformed.meta.json
```

---

## Purpose

This dataset supports the **Capstone Project – AI Invoice Auditor**.  
Your agentic AI system should:
1. **Monitor** the `data/incoming` folder for new files (simulate email monitoring).  
2. **Extract** invoice text, tables, and key fields (language and format agnostic).  
3. **Translate** non-English invoices into English.  
4. **Validate** invoice details against the mock ERP system (via FASTAPI).  
5. **Generate** validation reports highlighting discrepancies, missing fields, and translation confidence.  
6. **Support** RAG-based question answering over invoice data.  

---

## Email Metadata Example
Example for `INV_EN_001.meta.json`:
```json
{
  "sender": "accounts@globallogistics.com",
  "subject": "Invoice INV-1001 for PO-1001",
  "received_timestamp": "2025-03-14T09:32:00Z",
  "language": "en",
  "attachments": ["INV_EN_001.pdf"]
}
```

Use these `.meta.json` files to simulate real email headers.  

---

##  Notes
- The invoices in this dataset are **synthetic** and language-diverse (English, Spanish, German).  
- One invoice (`INV_EN_005_scan.png`) is intentionally **handwritten-style** to test OCR performance.  
- One invoice (`INV_EN_006_malformed.pdf`) is intentionally **incomplete** (missing invoice number and currency) to test your validation logic.  
- You are not provided the “correct” data — your system should infer and validate automatically using your pipeline and mock ERP.  

---

##  Tip
Use your **Invoice Monitor Agent** to simulate polling this folder every few seconds.  
Each time a new invoice appears, it should trigger the full pipeline:
Extraction → Translation → Validation → Reporting → RAG Indexing.

---

###  Example simulation script
You can simulate incoming emails like this:

import time, shutil, os

source = "data/samples/"
target = "data/incoming/"

for f in os.listdir(source):
    if f.endswith(('.pdf', '.docx', '.png', '.meta.json')):
        shutil.copy(os.path.join(source, f), target)
        print(f"Simulated email arrival: {f}")
        time.sleep(15)


---

*Prepared by: Dr.Meenakshi.H.N, ETA, Infosys, Full Stack Agentic AI Course*  
*Version: v1.0 – October 2025*
