"""Re-index documents with the current CHUNK_STRATEGY from the command line.

    python -m app.reindex          # documents chunked with a different strategy (incl. pre-v2 ones)
    python -m app.reindex --all    # every ready or failed document

In Docker: docker compose exec backend python -m app.reindex
"""
import argparse
import asyncio
import logging

from sqlalchemy import or_, select

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.models import Document, DocumentStatus
from app.observability import configure_logging
from app.services import storage
from app.services.ingest import process_document

log = logging.getLogger("folio.reindex")


async def reindex(everything: bool) -> int:
    async with AsyncSessionLocal() as db:
        stmt = select(Document).where(Document.status != DocumentStatus.processing)
        if not everything:
            stmt = stmt.where(
                or_(Document.chunk_strategy.is_(None), Document.chunk_strategy != settings.CHUNK_STRATEGY)
            )
        documents = (await db.scalars(stmt.order_by(Document.created_at))).all()
        targets = [(d.id, d.filename) for d in documents if storage.absolute(d.storage_path).exists()]
        for document in documents:
            if (document.id, document.filename) in targets:
                document.status = DocumentStatus.processing
        await db.commit()

    for i, (document_id, filename) in enumerate(targets, start=1):
        log.info("re-indexing %d/%d: %s", i, len(targets), filename)
        await process_document(document_id)
    return len(targets)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="re-index every document, not just outdated ones")
    args = parser.parse_args()
    configure_logging(settings.LOG_LEVEL, "text")

    async def run() -> int:
        try:
            return await reindex(args.all)
        finally:
            await engine.dispose()

    count = asyncio.run(run())
    log.info("re-indexed %d document(s) with strategy %r", count, settings.CHUNK_STRATEGY)


if __name__ == "__main__":
    main()
