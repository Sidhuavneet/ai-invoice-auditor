from graph_utils.readcontent import read_invoice
from graph_utils.llm_gateway import LLM_Gateway
import re 
import json



def extractor(state):
    print(f"[INFO]- extracting from {state['file_path']}")
    text=read_invoice(state["file_path"])
    meta_path=state.get("metadata_path") or ""
    if meta_path:
        try:
            with open(meta_path,"r",encoding="utf-8") as file:
                state["metadata"]=json.load(file)
        except (FileNotFoundError, json.JSONDecodeError):
            state["metadata"]={}
    else:
        # Uploaded files have no email sidecar — synthesise minimal metadata so
        # downstream agents have a consistent shape to read from.
        state["metadata"]={
            "file_name": state.get("file_name",""),
            "sender": "manual upload",
            "subject": "",
            "received_timestamp": "",
            "language": "",
            "attachments": [],
        }
    state["invoice_json"]=structure_content(text)
    return state

def structure_content(text):

    llm=LLM_Gateway('reason')
    structured_prompt=f"""
    You are a helpful AI agent that extracts structured data from financial documents.
    The document may be a traditional invoice OR a receipt / ride booking / transaction confirmation.
    Map flexibly:
      - vendor_id: merchant / service provider / company name (e.g. "Rapido", "Uber", "Amazon"). Never use the customer's name.
      - invoice_no: invoice number, receipt number, ride ID, booking ID, or transaction ID.
      - invoice_date: invoice date, ride time, booking time, or transaction timestamp.
      - po_reference: PO number if present, else empty.
      - currency: ISO code if printed, else infer from symbol (₹=INR, $=USD, €=EUR, £=GBP).
      - total_amount: final amount paid / selected price / total fare as a number (strip currency symbols and commas).
    Extract line_item only when itemized rows are present; receipts with a single total have an empty list.

    invoice: {text}

    Rules:
    - Return ONLY a JSON object, no prose, no markdown fence.
    - Keep missing values as empty strings (or empty list for line_item).
    - Do not hallucinate.

    output structure:
    {{
        "header": {{
            "invoice_no": "",
            "invoice_date": "",
            "vendor_id": "",
            "currency": "",
            "po_reference": "",
            "total_amount": ""
        }},
        "line_item": [
            {{"item_code": "", "description": "", "qty": "", "unit_price": "", "total": ""}}
        ]
    }}
    """
    response=llm.invoke(structured_prompt)
    try:
        match=re.search(r"\{.*\}",response,re.S)
        json_s=match.group(0) if match else ""
        structured_data=json.loads(json_s)
    except Exception as e:
        raise ValueError(f"Error in structure node \n{e}")
    structured_data.setdefault("header", {})
    structured_data.setdefault("line_item", [])
    if structured_data["line_item"] is None:
        structured_data["line_item"] = []
    return structured_data