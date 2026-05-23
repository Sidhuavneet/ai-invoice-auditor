"""Supabase backend: Postgres connection pool + service-role client.

Reports live in the `reports` table (jsonb body + denormalised columns for
filtering). PDF blobs live in the Supabase Storage bucket; see api.storage.

This module intentionally holds no business logic — it exposes a connection
pool and a handful of thin CRUD helpers. Callers compose them.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from supabase import Client, create_client


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(
            f"Missing required env var {name}. Copy .env.example to .env and fill in Supabase credentials."
        )
    return val


_pool: ConnectionPool | None = None
_supabase: Client | None = None


def pool() -> ConnectionPool:
    """Lazy singleton Postgres pool. First call validates env."""
    global _pool
    if _pool is None:
        dsn = _require("SUPABASE_DB_URL")
        _pool = ConnectionPool(
            conninfo=dsn,
            min_size=1,
            max_size=8,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


def supabase() -> Client:
    """Lazy singleton Supabase client using the service-role key (server-side only)."""
    global _supabase
    if _supabase is None:
        url = _require("SUPABASE_URL")
        key = _require("SUPABASE_SERVICE_ROLE_KEY")
        _supabase = create_client(url, key)
    return _supabase


@contextmanager
def conn() -> Iterator[psycopg.Connection]:
    with pool().connection() as c:
        yield c


# ─── Reports CRUD ────────────────────────────────────────────────────────────

_DENORM_KEYS = ("vendor", "total", "currency", "invoice_date", "status", "recommendation", "flags")


def _extract_denorm(report: dict) -> dict:
    """Pull denormalised columns out of a report dict for indexed filtering."""
    return {
        "vendor": report.get("vendor"),
        "total": report.get("total"),
        "currency": report.get("currency"),
        "invoice_date": report.get("invoice_date") or report.get("date"),
        "status": report.get("status"),
        "recommendation": (report.get("system_report") or {}).get("recommendation")
        or report.get("recommendation"),
        "flags": json.dumps(
            (report.get("system_report") or {}).get("flags") or report.get("flags") or []
        ),
    }


def upsert_report(file_name: str, report: dict) -> None:
    """Insert or update the report for a given source file."""
    denorm = _extract_denorm(report)
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            insert into reports (
                file_name, report, vendor, total, currency, invoice_date,
                status, recommendation, flags, updated_at
            )
            values (%s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s::jsonb, now())
            on conflict (file_name) do update set
                report = excluded.report,
                vendor = excluded.vendor,
                total = excluded.total,
                currency = excluded.currency,
                invoice_date = excluded.invoice_date,
                status = excluded.status,
                recommendation = excluded.recommendation,
                flags = excluded.flags,
                updated_at = now()
            """,
            (
                file_name,
                json.dumps(report),
                denorm["vendor"],
                denorm["total"],
                denorm["currency"],
                denorm["invoice_date"],
                denorm["status"],
                denorm["recommendation"],
                denorm["flags"],
            ),
        )


def get_report(file_name: str) -> dict | None:
    """Fetch one report by source file name. Returns the parsed JSON body or None."""
    with conn() as c, c.cursor() as cur:
        cur.execute("select report from reports where file_name = %s", (file_name,))
        row = cur.fetchone()
        return row["report"] if row else None


def list_reports() -> list[dict]:
    """Return all report JSON bodies, newest first by processed_at."""
    with conn() as c, c.cursor() as cur:
        cur.execute("select report from reports order by processed_at desc")
        return [r["report"] for r in cur.fetchall()]


def list_report_names() -> list[str]:
    with conn() as c, c.cursor() as cur:
        cur.execute("select file_name from reports order by processed_at desc")
        return [r["file_name"] for r in cur.fetchall()]


def delete_report(file_name: str) -> bool:
    with conn() as c, c.cursor() as cur:
        cur.execute("delete from reports where file_name = %s", (file_name,))
        return cur.rowcount > 0


# ─── Processed-files tracker (replaces outputs/added.json) ───────────────────


def mark_processed(file_name: str) -> None:
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "insert into processed_files (file_name) values (%s) on conflict do nothing",
            (file_name,),
        )


def unmark_processed(file_name: str) -> None:
    with conn() as c, c.cursor() as cur:
        cur.execute("delete from processed_files where file_name = %s", (file_name,))


def is_processed(file_name: str) -> bool:
    with conn() as c, c.cursor() as cur:
        cur.execute("select 1 from processed_files where file_name = %s", (file_name,))
        return cur.fetchone() is not None


def processed_set() -> set[str]:
    with conn() as c, c.cursor() as cur:
        cur.execute("select file_name from processed_files")
        return {r["file_name"] for r in cur.fetchall()}
