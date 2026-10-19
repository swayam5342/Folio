"""Uploaded sources on local disk under UPLOAD_DIR.

Paths stored in the database are relative to UPLOAD_DIR and are built from
ids only — never from the user-supplied filename. Non-PDF sources also keep
their extracted page text next to the original (<path>.pages.json).
"""
import json
import uuid
from pathlib import Path

from app.config import settings


def _root() -> Path:
    return Path(settings.UPLOAD_DIR).resolve()


def root() -> Path:
    """Resolved upload root for readiness checks and future storage adapters."""
    return _root()


def absolute(storage_path: str) -> Path:
    path = (_root() / storage_path).resolve()
    if _root() not in path.parents:
        raise ValueError("storage path escapes upload dir")
    return path


def save_file(user_id: uuid.UUID, document_id: uuid.UUID, data: bytes, ext: str) -> str:
    """Store an upload as <user>/<document>.<ext>; returns the relative storage path."""
    storage_path = f"{user_id}/{document_id}.{ext}"
    path = absolute(storage_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return storage_path


def _pages_path(storage_path: str) -> Path:
    return absolute(f"{storage_path}.pages.json")


def save_pages(storage_path: str, pages: list[dict]) -> None:
    """Store the sanitized page text the text viewer shows (chunk offsets point into it):
    [{"page_number", "text", "blocks": [{"kind", "start", "end"}]}]."""
    slim = [
        {
            "page_number": page["page_number"],
            "text": page["text"],
            "blocks": [{"kind": b["kind"], "start": b["start"], "end": b["end"]} for b in page["blocks"]],
        }
        for page in pages
    ]
    _pages_path(storage_path).write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")


def load_pages(storage_path: str) -> list[dict] | None:
    path = _pages_path(storage_path)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def delete_file(storage_path: str) -> None:
    for path in (storage_path, f"{storage_path}.pages.json"):
        try:
            absolute(path).unlink(missing_ok=True)
        except (OSError, ValueError):
            pass  # a missing/odd file shouldn't block deleting the database row
