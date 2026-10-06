"""Background processing of uploaded PDFs: extract → chunk → embed → store."""
import asyncio
import logging
import uuid

from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import Chunk, Document, DocumentStatus
from app.services import storage
from app.services.chunking import chunk_pages
from app.services.embeddings import embed_texts
from app.services.pdf_parser import extract_pages_from_pdf

log = logging.getLogger(__name__)

NO_TEXT_ERROR = "No extractable text — is this a scanned PDF?"
UNREADABLE_ERROR = "This file couldn't be read as a PDF."
GENERIC_ERROR = "Processing failed — please try uploading again."
INTERRUPTED_ERROR = "Processing was interrupted — please re-upload."


class IngestError(Exception):
    """A failure whose message is safe to show the user."""


def _extract_and_embed(path) -> tuple[int, list[dict], list[list[float]]]:
    """CPU-bound work, run in a thread so the event loop keeps serving requests."""
    try:
        page_count, pages = extract_pages_from_pdf(path.read_bytes())
    except Exception as exc:
        raise IngestError(UNREADABLE_ERROR) from exc
    if not pages:
        raise IngestError(NO_TEXT_ERROR)
    chunks = chunk_pages(pages)
    embeddings = embed_texts([c["content"] for c in chunks])
    return page_count, chunks, embeddings


async def process_document(document_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        document = await db.get(Document, document_id)
        if document is None:
            return  # deleted before processing started
        try:
            page_count, chunks, embeddings = await asyncio.to_thread(
                _extract_and_embed, storage.absolute(document.storage_path)
            )
        except IngestError as exc:
            await _mark_failed(document_id, str(exc))
            return
        except Exception:
            log.exception("Processing document %s failed", document_id)
            await _mark_failed(document_id, GENERIC_ERROR)
            return

        # The document may have been deleted while we were embedding.
        if await db.get(Document, document_id, populate_existing=True) is None:
            return
        db.add_all(
            Chunk(
                document_id=document_id,
                page_number=c["page_number"],
                chunk_index=c["chunk_index"],
                content=c["content"],
                embedding=e,
            )
            for c, e in zip(chunks, embeddings)
        )
        document.page_count = page_count
        document.status = DocumentStatus.ready
        document.error = None
        await db.commit()


async def _mark_failed(document_id: uuid.UUID, message: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(Document)
            .where(Document.id == document_id)
            .values(status=DocumentStatus.failed, error=message)
        )
        await db.commit()


async def fail_interrupted_documents() -> int:
    """On startup: anything still 'processing' was orphaned by a restart."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(Document)
            .where(Document.status == DocumentStatus.processing)
            .values(status=DocumentStatus.failed, error=INTERRUPTED_ERROR)
        )
        await db.commit()
        return result.rowcount
