"""
Hybrid retrieval: vector similarity (meaning) fused with full-text search
(exact terms such as course codes or function names) by reciprocal rank fusion.
"""
import uuid

from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import TSQUERY
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Chunk, Document, DocumentStatus

RRF_K = 60  # standard reciprocal-rank-fusion constant: damps the weight of top ranks



def _or_query(query_text: str):
    """The question's terms OR-ed together, so a question that mentions a code once still
    matches chunks containing just that code. numnode() is 0 when only stop words remain."""
    anded = cast(func.plainto_tsquery("english", query_text), Text)
    return cast(func.replace(anded, "&", "|"), TSQUERY)


def _scope(stmt, notebook_id: uuid.UUID, document_ids: list[uuid.UUID] | None):
    stmt = stmt.join(Document, Chunk.document_id == Document.id).where(
        Document.notebook_id == notebook_id, Document.status == DocumentStatus.ready
    )
    if document_ids is not None:
        stmt = stmt.where(Document.id.in_(document_ids))
    return stmt


async def similarity_search(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    query_text: str,
    query_embedding: list[float],
    top_k: int | None = None,
    document_ids: list[uuid.UUID] | None = None,
    candidates: int = 30,
) -> list[dict]:
    """Best `top_k` chunks of the notebook's ready documents, as [{"chunk", "document"}], best first."""
    top_k = top_k or settings.TOP_K

    vector_ids = (await db.scalars(
        _scope(select(Chunk.id), notebook_id, document_ids)
        .order_by(Chunk.embedding.cosine_distance(query_embedding))
        .limit(candidates)
    )).all()

    tsquery = _or_query(query_text)
    keyword_ids = (await db.scalars(
        _scope(select(Chunk.id), notebook_id, document_ids)
        .where(func.numnode(tsquery) > 0, Chunk.content_tsv.op("@@")(tsquery))
        .order_by(func.ts_rank_cd(Chunk.content_tsv, tsquery).desc())
        .limit(candidates)
    )).all()

    scores: dict[uuid.UUID, float] = {}
    for ranked in (vector_ids, keyword_ids):
        for rank, chunk_id in enumerate(ranked, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank)
    best = sorted(scores, key=scores.get, reverse=True)[:top_k]
    if not best:
        return []

    rows = (await db.execute(
        select(Chunk, Document).join(Document, Chunk.document_id == Document.id).where(Chunk.id.in_(best))
    )).all()
    by_id = {chunk.id: (chunk, document) for chunk, document in rows}
    return [{"chunk": by_id[i][0], "document": by_id[i][1]} for i in best if i in by_id]
