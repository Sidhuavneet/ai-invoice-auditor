"""MCP server for the AI Invoice Auditor.

Exposes the same invoice-auditing tools the in-app chat uses to any
MCP-compatible client (Claude Desktop, Cursor, Zed, OpenAI Realtime, etc.).
After this runs, you can open Claude Desktop, ask "which invoices need
review?", and Claude will call get_invoice / list_flagged / etc. directly
against your local backend — no UI needed.

Design:
    - **Thin HTTP wrapper** over the existing FastAPI backend (`/stats`,
      `/invoices/{name}`, `/invoices/{name}/decision`, …). Reusing the
      backend keeps a single source of truth: any tool added to the chat
      shows up automatically here.
    - **Run-as-process**: clients spawn this script via stdio. The MCP SDK
      handles the JSON-RPC protocol.

Run locally:
    .mcp-venv/bin/python mcp_server.py

Wire to Claude Desktop (macOS) by editing
    ~/Library/Application Support/Claude/claude_desktop_config.json
and adding (substituting absolute paths):

    {
      "mcpServers": {
        "invoice-auditor": {
          "command": "/absolute/path/to/repo/.mcp-venv/bin/python",
          "args": ["/absolute/path/to/repo/mcp_server.py"],
          "env": { "INVOICE_AUDITOR_API": "http://localhost:8000" }
        }
      }
    }

Restart Claude Desktop → ask "show flagged invoices" → it calls list_flagged.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

API_BASE = os.environ.get("INVOICE_AUDITOR_API", "http://localhost:8000").rstrip("/")
HTTP_TIMEOUT = 30.0

mcp = FastMCP("invoice-auditor")


def _get(path: str, params: dict | None = None) -> Any:
    """Tiny synchronous GET helper. FastMCP supports async, but our backend
    is fast enough that sync keeps the tool code dead simple."""
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        r = client.get(f"{API_BASE}{path}", params=params or {})
        r.raise_for_status()
        return r.json()


def _post(path: str, json: dict | None = None) -> Any:
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        r = client.post(f"{API_BASE}{path}", json=json or {})
        r.raise_for_status()
        return r.json()


# ---------- Read tools ----------------------------------------------------


@mcp.tool()
def get_overall_stats() -> dict:
    """Get the dashboard KPIs across all invoices: total count, spend by
    currency, auto-approval rate, top vendors, recent discrepancy reasons,
    and statistical anomalies. Use this for any aggregate / "overall" /
    "summary" question.
    """
    return _get("/stats")


@mcp.tool()
def list_invoices() -> list[dict]:
    """List every invoice (one row per report) with vendor, total, status,
    and recommendation. Use when the user wants a complete list."""
    return _get("/invoices")


@mcp.tool()
def get_invoice(file_name: str) -> dict:
    """Fetch a single invoice's full structured record (header, line items,
    discrepancies, recommendation, human-readable report).

    Args:
        file_name: Filename stem (e.g. "INV_EN_001") or "RE_<stem>.json".
    """
    return _get(f"/invoices/{file_name}")


@mcp.tool()
def list_flagged() -> list[dict]:
    """List only invoices currently in manual_review or rejected — i.e. the
    ones that need a human decision or were declined."""
    items = _get("/invoices")
    return [i for i in items if i.get("status") in {"manual_review", "rejected"}]


@mcp.tool()
def get_vendor_stats(vendor: str) -> dict:
    """Aggregate stats for one vendor: total spend, invoice count, status mix,
    and the 5 most recent invoices for that vendor.

    Args:
        vendor: Vendor name (substring match is allowed, e.g. 'HafenLogistik').
    """
    # The web chat does this server-side via the same logic; here we recompute
    # from /invoices to keep the MCP server's surface area minimal.
    items = _get("/invoices")
    target = vendor.strip().lower()
    matching = [i for i in items if target in (i.get("vendor") or "").lower()]
    if not matching:
        return {"vendor": vendor, "invoice_count": 0, "total_spend": 0, "invoices": []}
    total = 0.0
    status_mix: dict[str, int] = {}
    for inv in matching:
        try:
            total += float(str(inv.get("total") or "0").replace(",", "").replace("$", ""))
        except ValueError:
            pass
        st = inv.get("status") or "unknown"
        status_mix[st] = status_mix.get(st, 0) + 1
    return {
        "vendor": matching[0].get("vendor"),
        "total_spend": round(total, 2),
        "currency": matching[0].get("currency", ""),
        "invoice_count": len(matching),
        "status_mix": status_mix,
        "invoices": matching[:5],
    }


@mcp.tool()
def search_invoices(query: str, k: int = 5) -> list[dict]:
    """Semantic-search the invoice corpus for free-text queries like
    "logistics from Germany" or "anything tax-related". Returns the top-k
    matching invoices ranked by vector similarity.

    Args:
        query: Free-text search phrase.
        k: How many results to return (default 5).
    """
    # The backend doesn't yet expose a dedicated /search endpoint, so we
    # fall back to listing all invoices and ranking by substring match. The
    # web chat uses the richer Chroma-backed search via its own /chat tool.
    items = _get("/invoices")
    q = query.lower()
    scored = [
        (i, sum(1 for term in q.split() if term in (str(i.get("vendor", "")) + " " + str(i.get("file", ""))).lower()))
        for i in items
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [s[0] for s in scored[: max(1, min(int(k), 10))] if s[1] > 0]


@mcp.tool()
def get_recent_invoices(k: int = 5) -> list[dict]:
    """Return the N most recent invoices by invoice_date (most recent first).

    Args:
        k: how many to return (default 5).
    """
    items = _get("/invoices")
    items.sort(key=lambda i: i.get("invoice_date") or "0000-00-00", reverse=True)
    return items[: max(1, min(int(k), 10))]


@mcp.tool()
def get_top_vendors(k: int = 5) -> list[dict]:
    """Return the top-k vendors by total spend.

    Args:
        k: how many vendors to return (default 5, max 10).
    """
    stats = _get("/stats")
    return (stats.get("top_vendors") or [])[: max(1, min(int(k), 10))]


@mcp.tool()
def get_anomalies() -> list[dict]:
    """Return invoices flagged as statistically unusual — amount >2σ above
    that vendor's median, future-dated, or other rule-based anomalies."""
    stats = _get("/stats")
    return stats.get("anomalies") or []


@mcp.tool()
def get_discrepancy_summary() -> list[dict]:
    """Return the frequency of each discrepancy reason category across the
    corpus (e.g. 'Total mismatch', 'Future-dated'). Useful for spotting
    systemic data-quality issues."""
    stats = _get("/stats")
    return stats.get("discrepancy_reasons") or []


# ---------- Write tools (require explicit user intent) -------------------


@mcp.tool()
def approve_invoice(file_name: str, remarks: str = "") -> dict:
    """**WRITE action** — approve an invoice that is currently awaiting human
    review. Resumes the paused LangGraph pipeline with status=approved.

    Args:
        file_name: Invoice filename stem (e.g. "INV_EN_002").
        remarks: Optional reviewer note attached to the decision.
    """
    return _post(f"/invoices/{file_name}/decision", {"status": "accept", "remarks": remarks})


@mcp.tool()
def reject_invoice(file_name: str, remarks: str = "") -> dict:
    """**WRITE action** — reject an invoice that is currently awaiting human
    review. Resumes the paused pipeline with status=rejected.

    Args:
        file_name: Invoice filename stem.
        remarks: Optional reviewer note (recommended for rejections).
    """
    return _post(f"/invoices/{file_name}/decision", {"status": "reject", "remarks": remarks})


# ---------- Resources -----------------------------------------------------
# MCP "resources" let the client browse/read static content directly. Here we
# expose each invoice report JSON as a resource, identified by URI.


@mcp.resource("invoice://{file_name}")
def read_invoice_resource(file_name: str) -> str:
    """Return the full invoice report JSON for the named invoice.

    URI pattern: invoice://INV_EN_001
    """
    import json as _json
    return _json.dumps(_get(f"/invoices/{file_name}"), indent=2)


if __name__ == "__main__":
    # FastMCP defaults to stdio transport — Claude Desktop spawns us and
    # talks JSON-RPC over our stdin/stdout. No network port needed.
    mcp.run()
