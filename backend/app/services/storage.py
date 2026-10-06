"""Uploaded PDFs on local disk under UPLOAD_DIR.

Paths stored in the database are relative to UPLOAD_DIR and are built from
ids only — never from the user-supplied filename.
"""
import uuid
from pathlib import Path

from app.config import settings


def _root() -> Path:
    return Path(settings.UPLOAD_DIR).resolve()


def absolute(storage_path: str) -> Path:
    path = (_root() / storage_path).resolve()
    if _root() not in path.parents:
        raise ValueError("storage path escapes upload dir")
    return path


def save_pdf(user_id: uuid.UUID, document_id: uuid.UUID, data: bytes) -> str:
    storage_path = f"{user_id}/{document_id}.pdf"
    path = absolute(storage_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return storage_path


def delete_file(storage_path: str) -> None:
    try:
        absolute(storage_path).unlink(missing_ok=True)
    except (OSError, ValueError):
        pass  # a missing/odd file shouldn't block deleting the database row
