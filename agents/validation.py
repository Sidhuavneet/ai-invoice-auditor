from graph_utils.fetch_rules import fetch_rules
from graph_utils.llm_gateway import LLM_Gateway
from typing import Dict, Any
import json
import os
import re

_ERP_DIR = os.path.join("data", "ERP_mockdata")
_po_cache = None
_vendor_cache = None


def _load_po_records():
    global _po_cache
    if _po_cache is None:
        with open(os.path.join(_ERP_DIR, "PO Records.json"), "r") as f:
            _po_cache = json.load(f)
    return _po_cache


def _load_vendors():
    global _vendor_cache
    if _vendor_cache is None:
        with open(os.path.join(_ERP_DIR, "vendors.json"), "r") as f:
            _vendor_cache = json.load(f)
    return _vendor_cache


def get_po_by_number(po_number: str):
    for item in _load_po_records():
        if item.get("po_number") == po_number:
            return item
    return None


def get_vendor_by_id(vendor_id: str):
    for item in _load_vendors():
        if item.get("vendor_id") == vendor_id:
            return item
    return None


def validation(state):
    rules = fetch_rules("config/rules.yaml")
    print("[INFO] Fetching Rules")
    state["rules"]=rules
    print("[INFO] Performing data validation")
    missing = validatedata(state["invoice_json"], rules)
    print("[INFO] Performing business validation")
    discrepancy_report=business_data(state["invoice_json"],rules)
    state["invoice_json"]["missing"]=missing
    state["invoice_json"]["discrepancy_report"]=discrepancy_report
    return state


def business_data(invoice:Dict[str,Any],rules):
    po_res = {}
    try:
        po_number = invoice["header"]["po_reference"]
        po_res = get_po_by_number(po_number) or {}
    except Exception:
        po_res = {}
    vendor_res = {}
    try:
        vendor_id = po_res.get("vendor_id")
        if vendor_id:
            vendor_res = get_vendor_by_id(vendor_id) or {}
    except Exception:
        vendor_res = {}
    prompt = f"""
You are an invoice validator agent. Your goal is to verify if the invoice is valid or not based on the given invoice data and rules provided.

**Invoice Data:**
{invoice}

**Extracted DB Data:**
Invoice data:
{po_res}

Vendor info:
{vendor_res}

**Validation Rules:**
Business Validation Thresholds:
{rules["tolerances"]}

Accepted Currencies:
{rules["accepted_currencies"]}

Currency symbol mapping:
{rules["currency_symbol_map"]}

**Instructions:**
1. Validate the invoice according to the rules above.
2. Use the currency_symbol_map to accept both symbols and ISO codes.
3. Provide a structured JSON report containing:

- "invoice_data_validation": validation results for each field (vendor name, PO number, amounts, dates, etc.)
- "currency_validation": whether the invoice currency follows accepted rules
- "business_validation": checks against business rules and thresholds
- "discrepancy_summary": list of discrepancies found (format: List[str])
- "discrepancy_flag": true if discrepancies exist, false otherwise

**Important:**
- Only return a single valid JSON object.  
- Do not include any explanations, text, or comments.  
- Always return the full JSON, even if empty discrepancies.

Example format:
{{
    "invoice_data_validation": {{}},
    "currency_validation": {{}},
    "business_validation": {{}},
    "discrepancy_summary": [],
    "discrepancy_flag": false
}}
"""


    llm = LLM_Gateway("aa")
    res = llm.invoke(prompt)
    try:
        match=re.search(r"\{.*\}",res,re.S)
        json_s=match.group(0) if match else ""
        structured_data=json.loads(json_s)
        return structured_data
    except:
        raise ValueError("Error in paring Business Validation data")

def validatedata(invoice: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    prompt = f"""
    You are an invoice validator agent. Your goal is to identify if there are any missing fields
    or data based on the given invoice data and rules that are provided below.
    **Invoice Data:**

    {invoice}

    **Validation Rules:**

    {rules["required_fields"]}
    {rules["data_types"]}
    
    **Task:**
    Please return a **list of missing fields** (in the format of a list of strings like ["invoice_no", "total_amount"]). 
    If no fields are missing, return an empty list `[]`.
    Do **not** add any extra explanation. Just return the list of missing fields.

    strictly return the json as output
    """
    

    llm = LLM_Gateway("aa")
    res = llm.invoke(prompt).strip()


    res = res.strip('```') 
    res = res.replace('json', '').strip()  
    
 
    try:
        missing_fields = json.loads(res)  
        if not isinstance(missing_fields, list):
            missing_fields = []  
    except json.JSONDecodeError:
        print(f"Error parsing response: {res}")
        missing_fields = [] 

    return missing_fields

