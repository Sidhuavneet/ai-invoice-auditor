"""Supabase Storage wrapper for invoice blobs (PDF / DOCX / images).

Bucket layout:
    invoices/inbox/<file>       — awaiting pipeline
    invoices/processed/<file>   — already processed

Sidecar .meta.json files (if any) live alongside the source file.
"""

from __future__ import annotations

import os
from pathlib import Path

from api.db import supabase


def _bucket() -> str:
    return os.environ.get("SUPABASE_BUCKET", "invoices")


def _client():
    return supabase().storage.from_(_bucket())


def upload(path: str, data: bytes, content_type: str | None = None, upsert: bool = True) -> None:
    """Upload bytes to `<bucket>/<path>`."""
    opts: dict = {"upsert": "true" if upsert else "false"}
    if content_type:
        opts["content-type"] = content_type
    _client().upload(path=path, file=data, file_options=opts)


def upload_file(path: str, local_file: str | Path, content_type: str | None = None) -> None:
    with open(local_file, "rb") as f:
        upload(path, f.read(), content_type=content_type)


def download(path: str) -> bytes:
    """Download object bytes. Raises if the path does not exist."""
    return _client().download(path)


def exists(path: str) -> bool:
    parent = path.rsplit("/", 1)[0] if "/" in path else ""
    name = path.rsplit("/", 1)[-1]
    try:
        listing = _client().list(parent)
    except Exception:
        return False
    return any(item.get("name") == name for item in listing)


def list_dir(prefix: str) -> list[str]:
    """List file names under a bucket prefix (non-recursive)."""
    try:
        listing = _client().list(prefix)
    except Exception:
        return []
    return [item["name"] for item in listing if item.get("name")]


def move(src: str, dst: str) -> None:
    _client().move(src, dst)


def remove(paths: list[str]) -> None:
    if paths:
        _client().remove(paths)


def signed_url(path: str, expires_in: int = 3600) -> str:
    """Return a time-limited URL the browser can fetch directly."""
    res = _client().create_signed_url(path, expires_in)
    return res.get("signedURL") or res.get("signed_url") or ""


# ─── Convenience paths ───────────────────────────────────────────────────────


def inbox_path(name: str) -> str:
    return f"inbox/{name}"


def processed_path(name: str) -> str:
    return f"processed/{name}"


def move_to_processed(name: str) -> None:
    """Move both the source file and its .meta.json sidecar (if present)."""
    move(inbox_path(name), processed_path(name))
    stem = name.rsplit(".", 1)[0]
    meta = f"{stem}.meta.json"
    if exists(inbox_path(meta)):
        move(inbox_path(meta), processed_path(meta))
