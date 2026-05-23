import os

from agents.reporting_agent import (
    STATUS_APPROVED,
    STATUS_REJECTED,
    STATUS_MANUAL,
    STATUS_NOT_REQUIRED,
)
from api import db


def _normalize_decision_status(raw) -> str:
    """Map any incoming status form to the canonical lowercase enum.

    The HITL interrupt resumes with 'accept'/'reject' (legacy) or
    'approve'/'reject'; reporting pre-fills 'approved'/'rejected'/'manual_review'.
    Anything else is treated as still-pending manual review.
    """
    s = (str(raw) if raw is not None else "").lower().strip().replace(" ", "_")
    if s in {"accept", "approve", "approved"}:
        return STATUS_APPROVED
    if s in {"reject", "rejected"}:
        return STATUS_REJECTED
    if s in {"manual_review", "review"}:
        return STATUS_MANUAL
    if s in {"not_required", ""}:
        return s or STATUS_NOT_REQUIRED
    return s


def final_saver(state):
    """Persist the final report to Supabase Postgres. Vector indexing is
    centralized in api.server._refresh_index_from_reports (single writer into
    Chroma) — do NOT add vectors here, that would produce duplicates on every
    re-process.
    """
    print("[INFO] Saving final report")
    state["status"] = _normalize_decision_status(state.get("status"))
    if "remarks" not in state or state["remarks"] is None:
        state["remarks"] = STATUS_NOT_REQUIRED
    result = dict(state["invoice_json"])
    result["file_name"] = state["file_name"]
    result.update(state["metadata"])
    result.update(state["system_report"])
    result["human_report"] = state["human_report"]
    result["status"] = state["status"]
    result["remarks"] = state["remarks"]
    result["pipeline_status"] = "ok"

    # PK = source filename with extension (matches inbox/ and bucket layout).
    file_path = state.get("file_path") or ""
    source_name = os.path.basename(file_path) if file_path else f"{state['file_name']}.pdf"
    db.upsert_report(source_name, result)
    return state
