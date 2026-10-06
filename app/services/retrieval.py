import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk, Document, DocumentStatus
from app.config import settings


async def similarity_search(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    query_embedding: list[float],
    top_k: int | None = None,
) -> list[dict]:
    """Cosine-similarity search over chunks of one notebook's ready documents."""
    top_k = top_k or settings.TOP_K

    stmt = (
        select(Chunk, Document)
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.notebook_id == notebook_id, Document.status == DocumentStatus.ready)
        .order_by(Chunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )

    result = await db.execute(stmt)
    rows = result.all()
    return [{"chunk": chunk, "document": document} for chunk, document in rows]
