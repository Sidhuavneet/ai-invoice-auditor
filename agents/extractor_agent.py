"""Extractor agent — turns invoice text (or OCR output) into a typed JSON record.

Uses Pydantic schemas + LangChain's `with_structured_output()` so the LLM is
constrained to a schema instead of returning free-form JSON. Benefits:

  - **Type safety**: the result is a typed `InvoiceExtraction` Pydantic model,
    not a `dict` we hope is well-formed.
  - **Auto-retry**: when the model emits invalid JSON or misses a field,
    LangChain re-prompts with the validation error attached — without us
    writing retry code.
  - **No regex JSON parsing**: the previous `re.search(r"\\{.*\\}")` hack is gone.

Resume line: *"Schema-validated structured outputs using Pydantic models with
auto-retry — eliminated brittle JSON parsing in the extraction agent."*
"""

import json
import os
from typing import List

from pydantic import BaseModel, Field
from langchain_groq import ChatGroq

from graph_utils.readcontent import read_invoice


# ---------- Pydantic schemas ----------------------------------------------


class LineItem(BaseModel):
    """One row of an itemized invoice. Receipts with a single total leave this empty."""
    item_code: str = Field(default="", description="SKU / item code if printed")
    description: str = Field(default="", description="Line description")
    qty: str = Field(default="", description="Quantity as a string (preserve units)")
    unit_price: str = Field(default="", description="Unit price as a string")
    total: str = Field(default="", description="Line total as a string")


class InvoiceHeader(BaseModel):
    invoice_no: str = Field(default="", description="Invoice / receipt / ride / booking / transaction ID")
    invoice_date: str = Field(default="", description="Invoice date or transaction timestamp")
    vendor_id: str = Field(
        default="",
        description=(
            "Merchant / service provider / company name (e.g. 'Rapido', 'Uber'). "
            "NEVER the customer's name."
        ),
    )
    currency: str = Field(
        default="",
        description="ISO code if printed, else infer from symbol (₹=INR, $=USD, €=EUR, £=GBP)",
    )
    po_reference: str = Field(default="", description="PO number if present, else empty")
    total_amount: str = Field(
        default="",
        description="Final amount paid as a string (strip currency symbols and commas)",
    )


class InvoiceExtraction(BaseModel):
    """Top-level extraction result. `line_item` is empty for receipts / single-total docs."""
    header: InvoiceHeader = Field(default_factory=InvoiceHeader)
    line_item: List[LineItem] = Field(default_factory=list)


# ---------- LLM (reused across calls so we don't re-handshake every invoice) -


_extractor_llm = ChatGroq(
    model=os.environ.get("GROQ_REASON_MODEL", "llama-3.3-70b-versatile"),
    temperature=0,
    api_key=os.environ.get("GROQ_API_KEY"),
)
# `method="function_calling"` routes through Groq's tool-call API which is the
# most reliable structured-output mode for Llama 3.3 — the model is constrained
# to emit JSON arguments matching our Pydantic schema.
_extractor_structured = _extractor_llm.with_structured_output(
    InvoiceExtraction,
    method="function_calling",
)


SYSTEM_PROMPT = """\
You are an extraction agent for financial documents (invoices, receipts, ride
bookings, transaction confirmations). Map fields flexibly:
  - vendor_id: merchant / service provider / company name. NEVER the customer's name.
  - invoice_no: invoice/receipt/ride/booking/transaction ID — whichever is present.
  - invoice_date: invoice date OR transaction timestamp.
  - currency: ISO code if printed, else infer from the symbol (₹=INR, $=USD, €=EUR, £=GBP).
  - total_amount: the final amount as a number (strip currency symbols + commas).
Extract line_item only when itemized rows are present; single-total receipts have an empty list.
Do not hallucinate fields. Keep missing values as empty strings."""


def extractor(state):
    print(f"[INFO]- extracting from {state['file_path']}")
    text = read_invoice(state["file_path"])

    meta_path = state.get("metadata_path") or ""
    if meta_path:
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                state["metadata"] = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            state["metadata"] = {}
    else:
        # Uploaded files have no email sidecar — synthesise minimal metadata so
        # downstream agents have a consistent shape to read from.
        state["metadata"] = {
            "file_name": state.get("file_name", ""),
            "sender": "manual upload",
            "subject": "",
            "received_timestamp": "",
            "language": "",
            "attachments": [],
        }

    state["invoice_json"] = _structure_content(text)
    return state


def _structure_content(text: str) -> dict:
    """Run the LLM through a Pydantic-validated schema and return a plain dict
    (downstream agents expect a JSON-like dict, not a Pydantic instance).

    On schema-validation failure, LangChain auto-retries with the error fed
    back in — usually one extra hop is enough for the model to self-correct.
    """
    prompt = f"{SYSTEM_PROMPT}\n\nDocument:\n{text}"
    try:
        result: InvoiceExtraction = _extractor_structured.invoke(prompt)
    except Exception as e:
        # Surface a clean failure for the saver to log against the file.
        raise ValueError(f"Extractor schema validation failed: {e}") from e
    # `.model_dump()` → plain dict in canonical key order; defaults applied.
    return result.model_dump()
