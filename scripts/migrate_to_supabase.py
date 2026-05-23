"""One-time migration of local filesystem state into Supabase.

Idempotent — safe to re-run. Uploads existing PDFs/DOCX/images to the
Storage bucket and upserts existing report JSON into the `reports` table.
The processed-files tracker (outputs/added.json) is folded in too.

Usage:
    python -m scripts.migrate_to_supabase
"""

from __future__ import annotations

import json
import mimetypes
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from api import db, storage  # noqa: E402  (env must load first)

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "inbox"
PROCESSED = INBOX / "processed"
REPORTS = ROOT / "outputs" / "reports"
ADDED_JSON = ROOT / "outputs" / "added.json"

SOURCE_EXTS = (".pdf", ".docx", ".png", ".jpg", ".jpeg")


def _find_source_filename(stem: str) -> str | None:
    """Locate the source file (with extension) for a report's stem."""
    for d in (INBOX, PROCESSED):
        if not d.exists():
            continue
        for ext in SOURCE_EXTS:
            p = d / f"{stem}{ext}"
            if p.exists():
                return p.name
    return None


def upload_blobs() -> tuple[int, int]:
    """Mirror inbox/ and inbox/processed/ into the Storage bucket."""
    inbox_count = 0
    processed_count = 0

    if INBOX.exists():
        for p in INBOX.iterdir():
            if p.is_file():
                ct = mimetypes.guess_type(p.name)[0]
                storage.upload_file(storage.inbox_path(p.name), p, content_type=ct)
                inbox_count += 1
                print(f"  ↑ inbox/{p.name}")

    if PROCESSED.exists():
        for p in PROCESSED.iterdir():
            if p.is_file():
                ct = mimetypes.guess_type(p.name)[0]
                storage.upload_file(storage.processed_path(p.name), p, content_type=ct)
                processed_count += 1
                print(f"  ↑ processed/{p.name}")

    return inbox_count, processed_count


def import_reports() -> int:
    """Read every RE_*.json and upsert into the reports table."""
    if not REPORTS.exists():
        return 0
    count = 0
    for p in sorted(REPORTS.glob("RE_*.json")):
        try:
            body = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  ⚠ skip {p.name}: {e}")
            continue

        stem = p.stem[3:]  # strip "RE_"
        src = _find_source_filename(stem)
        if not src:
            # Report exists but the source file is gone — key by stem.
            src = stem
        db.upsert_report(src, body)
        count += 1
        print(f"  ✓ {src}")
    return count


def import_processed_tracker() -> int:
    """Replay outputs/added.json into the processed_files table."""
    if not ADDED_JSON.exists():
        return 0
    try:
        names = json.loads(ADDED_JSON.read_text(encoding="utf-8"))
    except Exception:
        return 0
    if not isinstance(names, list):
        return 0
    for name in names:
        if isinstance(name, str) and name:
            db.mark_processed(name)
    return len(names)


def main() -> int:
    print("→ Verifying Supabase connection ...")
    try:
        with db.conn() as c, c.cursor() as cur:
            cur.execute("select 1")
            cur.fetchone()
    except Exception as e:
        print(f"✗ Postgres unreachable: {e}", file=sys.stderr)
        print("  Check SUPABASE_DB_URL in .env.", file=sys.stderr)
        return 1

    print("→ Uploading blobs to Storage ...")
    try:
        ib, pr = upload_blobs()
        print(f"  Uploaded {ib} inbox + {pr} processed.")
    except Exception as e:
        print(f"✗ Blob upload failed: {e}", file=sys.stderr)
        print("  Check SUPABASE_BUCKET exists and SUPABASE_SERVICE_ROLE_KEY is set.", file=sys.stderr)
        return 1

    print("→ Importing reports into Postgres ...")
    n = import_reports()
    print(f"  Upserted {n} reports.")

    print("→ Importing processed-files tracker ...")
    m = import_processed_tracker()
    print(f"  Recorded {m} processed entries.")

    print("\n✓ Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
