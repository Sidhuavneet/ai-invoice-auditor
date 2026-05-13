from graph_utils.fetch_rules import fetch_rules
from typing import Dict, Any, List


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
    """Deterministic math/format validation. No ERP lookup.

    Checks that are universally meaningful for any invoice:
      - currency is recognized
      - header total equals sum of line totals (within tolerance)
      - each line: qty * unit_price equals line total (within tolerance)
      - invoice date is present and not in the future
    """
    header = invoice.get("header", {}) or {}
    line_items = invoice.get("line_item", []) or []
    tolerances = rules.get("tolerances", {}) or {}
    accepted_currencies = set(rules.get("accepted_currencies", []) or [])
    symbol_map = rules.get("currency_symbol_map", {}) or {}

    price_tol = float(tolerances.get("price_difference_percent", 0))

    invoice_currency = _normalize_currency(header.get("currency", ""), symbol_map)
    invoice_total = _to_float(header.get("total_amount"))

    discrepancies: List[str] = []

    # ---- currency_validation ----
    accepted_currency = invoice_currency in accepted_currencies if invoice_currency else False
    symbol_mapping_ok = bool(invoice_currency)
    if invoice_currency and not accepted_currency:
        discrepancies.append(f"Currency '{invoice_currency}' is not in the accepted list.")

    # ---- line-level arithmetic: qty * unit_price ?= line total ----
    line_math_ok = True
    if line_items:
        for i, li in enumerate(line_items):
            qty = _to_float(li.get("qty"))
            unit = _to_float(li.get("unit_price"))
            total = _to_float(li.get("total"))
            if qty and unit and total:
                expected = qty * unit
                if not _within_tolerance(total, expected, price_tol):
                    line_math_ok = False
                    discrepancies.append(
                        f"Line {i + 1}: qty × unit_price = {expected:.2f} but total is {total:.2f}."
                    )

    # ---- header vs sum(line totals) ----
    amounts_ok = True
    if line_items:
        computed_total = sum(_to_float(li.get("total")) for li in line_items)
        if computed_total and invoice_total:
            if not _within_tolerance(invoice_total, computed_total, price_tol):
                amounts_ok = False
                discrepancies.append(
                    f"Header total {invoice_total} does not equal sum of line items {computed_total}."
                )

    # ---- date sanity: future-dated invoices are suspicious ----
    dates_ok = bool(header.get("invoice_date"))
    inv_date = header.get("invoice_date")
    if inv_date:
        from datetime import date, datetime
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
            try:
                parsed = datetime.strptime(str(inv_date), fmt).date()
                if parsed > date.today():
                    dates_ok = False
                    discrepancies.append(f"Invoice date {inv_date} is in the future.")
                break
            except ValueError:
                continue

    return {
        "invoice_data_validation": {
            "amounts": amounts_ok,
            "dates": dates_ok,
        },
        "currency_validation": {
            "accepted_currency": accepted_currency,
            "symbol_mapping": symbol_mapping_ok,
        },
        "business_validation": {
            "line_math": line_math_ok,
            "totals_match": amounts_ok,
        },
        "discrepancy_summary": discrepancies,
        "discrepancy_flag": bool(discrepancies),
    }


def validatedata(invoice: Dict[str, Any], rules: Dict[str, Any]) -> list:
    """Deterministic required-field check. No LLM call."""
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
