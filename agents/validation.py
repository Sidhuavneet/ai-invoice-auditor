from graph_utils.fetch_rules import fetch_rules
from typing import Dict, Any, List
import json
import os

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
    if not po_number:
        return None
    for item in _load_po_records():
        if item.get("po_number") == po_number:
            return item
    return None


def get_vendor_by_id(vendor_id: str):
    if not vendor_id:
        return None
    for item in _load_vendors():
        if item.get("vendor_id") == vendor_id:
            return item
    return None


def get_vendor_by_name(vendor_name: str):
    if not vendor_name:
        return None
    target = vendor_name.strip().lower()
    for item in _load_vendors():
        if item.get("vendor_name", "").strip().lower() == target:
            return item
    return None


def validation(state):
    rules = fetch_rules("config/rules.yaml")
    print("[INFO] Fetching Rules")
    state["rules"] = rules
    print("[INFO] Performing data validation")
    missing = validatedata(state["invoice_json"], rules)
    print("[INFO] Performing business validation")
    discrepancy_report = business_data(state["invoice_json"], rules)
    state["invoice_json"]["missing"] = missing
    state["invoice_json"]["discrepancy_report"] = discrepancy_report
    return state


def _to_float(val) -> float:
    """Best-effort numeric coercion. Returns 0.0 on failure."""
    if val is None or val == "":
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    for ch in ("₹", "$", "€", "£", ","):
        s = s.replace(ch, "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _normalize_currency(raw: str, symbol_map: Dict[str, str]) -> str:
    """Map symbols and lowercased codes to ISO codes (USD/EUR/INR/GBP)."""
    if not raw:
        return ""
    raw = str(raw).strip()
    if raw in symbol_map:
        return symbol_map[raw]
    return raw.upper()


def _within_tolerance(actual: float, expected: float, percent: float) -> bool:
    if expected == 0:
        return actual == 0
    delta = abs(actual - expected) / abs(expected) * 100.0
    return delta <= percent


def business_data(invoice: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic business validation against mock ERP.

    Returns the same shape the previous LLM-based version produced.
    """
    header = invoice.get("header", {}) or {}
    line_items = invoice.get("line_item", []) or []
    tolerances = rules.get("tolerances", {}) or {}
    accepted_currencies = set(rules.get("accepted_currencies", []) or [])
    symbol_map = rules.get("currency_symbol_map", {}) or {}

    price_tol = float(tolerances.get("price_difference_percent", 0))
    qty_tol = float(tolerances.get("quantity_difference_percent", 0))

    po_ref = header.get("po_reference") or ""
    invoice_vendor = header.get("vendor_id") or ""
    invoice_currency = _normalize_currency(header.get("currency", ""), symbol_map)
    invoice_total = _to_float(header.get("total_amount"))

    po = get_po_by_number(po_ref) or {}
    erp_vendor = get_vendor_by_id(po.get("vendor_id", "")) if po else None
    if erp_vendor is None:
        erp_vendor = get_vendor_by_name(invoice_vendor) or {}

    discrepancies: List[str] = []

    # ---- invoice_data_validation ----
    vendor_ok = False
    if erp_vendor:
        vendor_ok = erp_vendor.get("vendor_name", "").strip().lower() == invoice_vendor.strip().lower()
    if invoice_vendor and not vendor_ok:
        discrepancies.append(f"Vendor '{invoice_vendor}' not found in ERP or mismatches PO.")

    po_ok = bool(po) if po_ref else None
    if po_ref and not po:
        discrepancies.append(f"PO reference '{po_ref}' not found in ERP.")

    # ---- currency_validation ----
    accepted_currency = invoice_currency in accepted_currencies if invoice_currency else False
    symbol_mapping_ok = bool(invoice_currency)
    if invoice_currency and not accepted_currency:
        discrepancies.append(f"Currency '{invoice_currency}' is not in the accepted list.")

    # If vendor has an expected currency, flag mismatch.
    expected_currency = (erp_vendor or {}).get("currency")
    if expected_currency and invoice_currency and invoice_currency != expected_currency:
        discrepancies.append(
            f"Currency '{invoice_currency}' does not match vendor's expected '{expected_currency}'."
        )

    # ---- business_validation: line-item level + totals ----
    price_ok = True
    qty_ok = True
    if po and line_items:
        po_items_by_code = {li.get("item_code"): li for li in (po.get("line_items") or [])}
        for li in line_items:
            code = li.get("item_code")
            if not code:
                continue
            po_li = po_items_by_code.get(code)
            if not po_li:
                discrepancies.append(f"Item {code} on invoice is not on PO {po_ref}.")
                continue
            inv_qty = _to_float(li.get("qty"))
            po_qty = _to_float(po_li.get("qty"))
            if not _within_tolerance(inv_qty, po_qty, qty_tol):
                qty_ok = False
                discrepancies.append(
                    f"Quantity for {code} differs: invoice {inv_qty} vs PO {po_qty}."
                )
            inv_price = _to_float(li.get("unit_price"))
            po_price = _to_float(po_li.get("unit_price"))
            if not _within_tolerance(inv_price, po_price, price_tol):
                price_ok = False
                discrepancies.append(
                    f"Unit price for {code} differs: invoice {inv_price} vs PO {po_price}."
                )

    # ---- totals: compare sum(line totals) to header total when both available ----
    amounts_ok = True
    if line_items:
        computed_total = sum(_to_float(li.get("total")) for li in line_items)
        if computed_total and invoice_total:
            if not _within_tolerance(invoice_total, computed_total, price_tol):
                amounts_ok = False
                discrepancies.append(
                    f"Header total {invoice_total} does not equal sum of line items {computed_total}."
                )

    return {
        "invoice_data_validation": {
            "vendor_name": vendor_ok,
            "po_number": po_ok,
            "amounts": amounts_ok,
            "dates": bool(header.get("invoice_date")),
        },
        "currency_validation": {
            "accepted_currency": accepted_currency,
            "symbol_mapping": symbol_mapping_ok,
        },
        "business_validation": {
            "price_difference": price_ok,
            "quantity_difference": qty_ok,
            "tax_difference": None,
        },
        "discrepancy_summary": discrepancies,
        "discrepancy_flag": bool(discrepancies),
    }


def validatedata(invoice: Dict[str, Any], rules: Dict[str, Any]) -> list:
    """Deterministic required-field check. No LLM call.

    A field is "missing" if the key is absent or its value is empty.
    Optional fields are intentionally ignored.
    """
    required = rules.get("required_fields", {}) or {}
    header = invoice.get("header", {}) or {}
    line_items = invoice.get("line_item", []) or []

    missing: list = []
    for field in required.get("header", []) or []:
        val = header.get(field)
        if val in (None, "", []):
            missing.append(field)

    required_li = required.get("line_item", []) or []
    if required_li and line_items:
        for i, li in enumerate(line_items):
            for field in required_li:
                val = (li or {}).get(field)
                if val in (None, "", []):
                    missing.append(f"line_item[{i}].{field}")

    return missing
