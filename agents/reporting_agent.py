import json
from graph_utils.llm_gateway import LLM_Gateway


def reporting(state):
    print("[INFO] Generating Report")
    invoice = state["invoice_json"]
    rules = state["rules"]
    system = decide_recommendation(invoice, rules)
    human = generate_human_readable_report(invoice, system)
    state["system_report"] = system
    state["human_report"] = human
    if "manual review" in system["recommendation"].lower():
        state["status"] = "Manual Review"
        state["remarks"] = ""
    else:
        state["status"] = "Not Required"
        state["remarks"] = "Not Required"
    result = dict(invoice)
    result["file_name"] = state["file_name"]
    result.update(state["metadata"])
    result.update(system)
    result["status"] = state["status"]
    result["remarks"] = state["remarks"]
    result["human_report"] = state["human_report"]
    with open(f"outputs/reports/RE_{state['file_name']}.json", "w", encoding="utf-8") as f:
        json.dump(result, f)
    return state


def decide_recommendation(invoice: dict, rules: dict) -> dict:
    """Policy-driven recommendation. No LLM call.

    Rules sourced from config/rules.yaml validation_policies:
      - invalid_currency_action: reject  → Reject
      - missing required field, discrepancy_flag, or low translation confidence → Manual Review
      - otherwise → Approve
    """
    policies = rules.get("validation_policies", {}) or {}
    threshold = float(policies.get("auto_approve_confidence_threshold", 0.85))
    invalid_currency_action = (policies.get("invalid_currency_action") or "manual_review").lower()

    missing = invoice.get("missing") or []
    discrepancy_report = invoice.get("discrepancy_report") or {}
    discrepancy_flag = bool(discrepancy_report.get("discrepancy_flag"))
    currency_ok = bool((discrepancy_report.get("currency_validation") or {}).get("accepted_currency"))
    translation_confidence = float(invoice.get("translation_confidence", 1.0) or 0.0)

    reasons = []

    if not currency_ok and invoice.get("header", {}).get("currency"):
        if invalid_currency_action == "reject":
            reasons.append("currency not in accepted list")
            return {"recommendation": "Reject", "reasons": reasons}
        reasons.append("currency not in accepted list")

    if missing:
        reasons.append(f"missing required fields: {missing}")
    if discrepancy_flag:
        reasons.append("ERP discrepancies detected")
    if translation_confidence < threshold:
        reasons.append(f"translation confidence {translation_confidence:.2f} below {threshold}")

    if reasons:
        return {"recommendation": "Manual Review", "reasons": reasons}
    return {"recommendation": "Approve", "reasons": []}


def generate_human_readable_report(invoice: dict, system_report: dict) -> str:
    llm = LLM_Gateway("reason")
    prompt = f"""
    Role: You generate concise financial-document summaries in natural language.
    Write a 2-3 line plain-English summary describing this invoice and why it
    received its recommendation. Reference the vendor, total, and any
    discrepancies. No salutations, no markdown.

    Invoice: {invoice}
    Decision: {system_report}

    Output:
    """
    try:
        return llm.invoke(prompt).strip()
    except Exception as e:
        rec = system_report.get("recommendation", "Manual Review")
        reasons = system_report.get("reasons") or []
        suffix = f" Reasons: {'; '.join(reasons)}." if reasons else ""
        return f"Recommendation: {rec}.{suffix} (summary unavailable: {e})"
