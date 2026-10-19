"""Background processing of uploaded sources: extract → sanitize → chunk → embed → store.

The same job re-indexes an existing document (e.g. after CHUNK_STRATEGY changes):
the old chunks are replaced in the same transaction that stores the new ones."""
import asyncio
import logging
import uuid

from sqlalchemy import delete, update

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Chunk, Document, DocumentStatus, Notebook, utcnow
from app.services import content_security, extractors, storage, summaries
from app.services.chunking import assemble_pages, chunk_document, embedding_text
from app.services.embeddings import embed_texts

log = logging.getLogger(__name__)

NO_TEXT_ERROR = "No readable text found in this source."
UNREADABLE_ERROR = "This file couldn't be read as a {label}."
GENERIC_ERROR = "Processing failed — please try uploading again."
INTERRUPTED_ERROR = "Processing was interrupted — please re-upload."

# Block separators in assembled page text. PDFs keep single newlines (their chunks predate
# this); other kinds use blank lines so the text viewer shows paragraphs.
PDF_BLOCK_SEP = "\n"
TEXT_BLOCK_SEP = "\n\n"


class IngestError(Exception):
    """A failure whose message is safe to show the user."""


def extract_and_embed(
    data: bytes, kind: str, strategy: str, *, redact_pii: bool = False
) -> tuple[int, int, list[dict], list[list[float]], int, list[str], dict[str, int], list[dict]]:
    """Source bytes → (page_count, ocr_pages, chunks, embeddings, risk, reasons, pii, pages).
    pages is the sanitized page text the chunk offsets point into. CPU-bound: run it in a thread."""
    try:
        page_count, pages, ocr_pages = extractors.extract(kind, data)
    except Exception as exc:
        raise IngestError(UNREADABLE_ERROR.format(label=extractors.LABELS.get(kind, "file"))) from exc
    # Mask and normalize before chunking, so chunks, offsets and the stored viewer text agree.
    pages, pii_summary, had_invisible = content_security.sanitize_pages(pages, redact_pii=redact_pii)
    if not pages:
        raise IngestError(NO_TEXT_ERROR)
    pages = assemble_pages(pages, PDF_BLOCK_SEP if kind == "pdf" else TEXT_BLOCK_SEP)
    chunks = chunk_document(pages, strategy)
    max_risk = 2 if had_invisible else 0
    reasons: set[str] = {"invisible_unicode"} if had_invisible else set()
    for chunk in chunks:
        scan = content_security.scan_text(chunk["content"])  # injection risk only: text is already clean
        chunk["risk_score"] = scan.risk_score
        chunk["risk_reasons"] = scan.reasons
        chunk["quarantined"] = settings.ENABLE_PROMPT_INJECTION_SCAN and scan.quarantined
        max_risk = max(max_risk, scan.risk_score)
        reasons.update(scan.reasons)
    embeddings = embed_texts([embedding_text(c) for c in chunks])
    return page_count, ocr_pages, chunks, embeddings, max_risk, sorted(reasons), pii_summary, pages


def chunk_rows(document_id: uuid.UUID, chunks: list[dict], embeddings: list[list[float]]) -> list[Chunk]:
    """ORM rows for a document's chunks."""
    return [
        Chunk(
            document_id=document_id,
            page_number=c["page_number"],
            chunk_index=c["chunk_index"],
            content=c["content"],
            section_title=c["section_title"],
            char_start=c["char_start"],
            char_end=c["char_end"],
            risk_score=c.get("risk_score", 0),
            risk_reasons=c.get("risk_reasons", []),
            quarantined=c.get("quarantined", False),
            embedding=e,
        )
        for c, e in zip(chunks, embeddings, strict=True)
    ]


async def process_document(document_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        document = await db.get(Document, document_id)
        if document is None:
            return  # deleted before processing started
        notebook = await db.get(Notebook, document.notebook_id)
        redact_pii = bool(settings.ENABLE_PII_REDACTION and notebook and notebook.pii_redaction_enabled)
        try:
            data = storage.absolute(document.storage_path).read_bytes()
            page_count, ocr_pages, chunks, embeddings, risk_score, risk_reasons, pii_summary, pages = await asyncio.to_thread(
                extract_and_embed, data, document.kind, settings.CHUNK_STRATEGY, redact_pii=redact_pii
            )
            if document.kind != "pdf":  # the text viewer shows exactly the text the chunks came from
                await asyncio.to_thread(storage.save_pages, document.storage_path, pages)
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
        await db.execute(delete(Chunk).where(Chunk.document_id == document_id))  # re-index: replace old chunks
        db.add_all(chunk_rows(document_id, chunks, embeddings))
        document.page_count = page_count
        document.ocr_pages = ocr_pages
        document.chunk_strategy = settings.CHUNK_STRATEGY
        document.risk_score = risk_score
        document.risk_reasons = risk_reasons
        document.pii_summary = pii_summary
        document.status = DocumentStatus.ready
        document.error = None
        document.indexed_at = utcnow()
        document.summary = None
        document.summary_status = "pending" if settings.ENABLE_SOURCE_SUMMARIES else None
        await db.commit()

    # After the commit: the source is already searchable while its summary is written.
    if settings.ENABLE_SOURCE_SUMMARIES:
        try:
            await summaries.generate(document_id)
        except Exception:
            log.exception("Summary for document %s failed", document_id)
            await _set_summary_failed(document_id)


async def _set_summary_failed(document_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(update(Document).where(Document.id == document_id).values(summary_status="failed"))
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
        # A summary that was being written when the server stopped will never finish.
        await db.execute(update(Document).where(Document.summary_status == "pending").values(summary_status="failed"))
        await db.commit()
        return result.rowcount
