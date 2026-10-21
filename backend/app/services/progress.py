"""Live progress of documents being indexed, for the Sources panel.

Indexing runs in this process (a background task plus a worker thread), so a
plain in-memory dict is enough: the worker writes, the documents endpoint reads,
and nothing survives a restart (interrupted documents are marked failed then).

    {"stage": "reading" | "ocr" | "chunking" | "embedding" | "saving", "done": int | None, "total": int | None}
"""
import uuid
from collections.abc import Callable

Reporter = Callable[[str, int | None, int | None], None]

_progress: dict[uuid.UUID, dict] = {}


def reporter(document_id: uuid.UUID) -> Reporter:
    """A callback the indexing worker calls as it advances: report(stage, done, total)."""
    def report(stage: str, done: int | None = None, total: int | None = None) -> None:
        _progress[document_id] = {"stage": stage, "done": done, "total": total}
    return report


def get(document_id: uuid.UUID) -> dict | None:
    return _progress.get(document_id)


def clear(document_id: uuid.UUID) -> None:
    _progress.pop(document_id, None)
