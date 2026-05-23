"""Bucket-backed mailbox.

The Supabase Storage bucket holds the canonical inbox/ and processed/
folders. `poll(target)` returns the next un-processed file by downloading it
to the local `target` directory so the existing PDF/DOCX/image readers work
unchanged. The processed-files tracker lives in Postgres.
"""

from __future__ import annotations

import os

from api import db, storage


SOURCE_EXTS = (".pdf", ".docx", ".png", ".jpg", ".jpeg")


def _is_source_file(name: str) -> bool:
    return name.lower().endswith(SOURCE_EXTS)


def _ensure_local(target: str, bucket_path: str, name: str) -> str:
    """Download `bucket_path` into `target/name` if not already cached locally."""
    os.makedirs(target, exist_ok=True)
    local = os.path.join(target, name)
    if not os.path.exists(local):
        data = storage.download(bucket_path)
        with open(local, "wb") as f:
            f.write(data)
    return local


def poll(target: str) -> dict | None:
    """Return the next un-processed file from the bucket inbox/.

    Downloads the file (and any .meta.json sidecar) into `target/` so
    downstream code can read it via the regular filesystem path. Marks the
    file processed in Postgres so subsequent calls advance to the next one.
    """
    print("----------------polling-----------------")
    processed = db.processed_set()
    listing = storage.list_dir("inbox")
    out = {"file": "", "meta": ""}
    for name in listing:
        if not _is_source_file(name):
            continue
        if name in processed:
            continue
        _ensure_local(target, storage.inbox_path(name), name)
        out["file"] = name

        stem = name[: name.rfind(".")]
        meta_name = f"{stem}.meta.json"
        if meta_name in listing:
            _ensure_local(target, storage.inbox_path(meta_name), meta_name)
            out["meta"] = meta_name

        db.mark_processed(name)
        print(f"polled {name}")
        return out
    return None


def unmark(filename: str) -> None:
    """Remove a file from the processed set so it can be retried."""
    db.unmark_processed(filename)
