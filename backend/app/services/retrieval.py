"""
Hybrid retrieval: vector similarity (meaning) fused with full-text search
(exact terms such as course codes or function names) by reciprocal rank fusion.

With several search queries (the question plus paraphrases, see query_planner)
every query contributes its own vector and keyword ranking to one fusion, so a
chunk found by many of them rises to the top. Each candidate keeps its best
vector and keyword rank for the retrieval trace.
"""
import uuid
from collections.abc import Hashable, Sequence
from dataclasses import dataclass

from sqlalchemy import ColumnElement, Text, cast, func, select
from sqlalchemy.dialects.postgresql import TSQUERY
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Chunk, Document, DocumentStatus

RRF_K = 60  # standard reciprocal-rank-fusion constant: damps the weight of top ranks


def reciprocal_rank_fusion[K: Hashable](rankings: Sequence[Sequence[K]], k: int = RRF_K) -> list[tuple[K, float]]:
    """Merge several best-first rankings into one: each item scores sum(1 / (k + rank)).

    Items found by more than one ranking rise to the top. Ties keep first-seen order,
    so the result is deterministic. Returns [(item, score)] best first."""
    scores: dict[K, float] = {}
    for ranked in rankings:
        for rank, item in enumerate(ranked, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda pair: pair[1], reverse=True)


@dataclass
class Candidate:
    """One retrieved chunk and how it scored at each stage (None: not found by that search)."""
    chunk_id: uuid.UUID
    vector_rank: int | None = None  # best rank over all vector searches, 1 = top
    keyword_rank: int | None = None  # best rank over all keyword searches
    vector_similarity: float | None = None  # best cosine similarity, 0-1
    fused_score: float = 0.0
    rerank_score: float | None = None


def _or_query(query_text: str):
    """The question's terms OR-ed together, so a question that mentions a code once still
    matches chunks containing just that code. numnode() is 0 when only stop words remain."""
    anded = cast(func.plainto_tsquery("english", query_text), Text)
    return cast(func.replace(anded, "&", "|"), TSQUERY)


def _scope(stmt, notebook_id: uuid.UUID, document_ids: Sequence[uuid.UUID] | None):
    stmt = stmt.join(Document, Chunk.document_id == Document.id).where(
        Document.notebook_id == notebook_id, Document.status == DocumentStatus.ready
    )
    if settings.ENABLE_PROMPT_INJECTION_SCAN:
        stmt = stmt.where(Chunk.quarantined.is_(False))
    if document_ids is not None:
        stmt = stmt.where(Document.id.in_(document_ids))
    return stmt


async def _vector_ranking(
    db: AsyncSession, notebook_id: uuid.UUID, embedding: list[float], document_ids, limit: int
) -> list[tuple[uuid.UUID, float]]:
    distance: ColumnElement[float] = Chunk.embedding.cosine_distance(embedding)
    rows = await db.execute(
        _scope(select(Chunk.id, distance.label("distance")), notebook_id, document_ids).order_by(distance).limit(limit)
    )
    return [(chunk_id, 1.0 - float(d)) for chunk_id, d in rows.all()]


async def _keyword_ranking(
    db: AsyncSession, notebook_id: uuid.UUID, query_text: str, document_ids, limit: int
) -> list[uuid.UUID]:
    tsquery = _or_query(query_text)
    return list((await db.scalars(
        _scope(select(Chunk.id), notebook_id, document_ids)
        .where(func.numnode(tsquery) > 0, Chunk.content_tsv.op("@@")(tsquery))
        .order_by(func.ts_rank_cd(Chunk.content_tsv, tsquery).desc())
        .limit(limit)
    )).all())


async def hybrid_candidates(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    queries: Sequence[str],
    embeddings: Sequence[list[float]],
    document_ids: Sequence[uuid.UUID] | None = None,
    limit: int | None = None,
    vector_only_embeddings: Sequence[list[float]] = (),
) -> list[Candidate]:
    """Up to `limit` candidates fused from a vector (and, with hybrid search on, a keyword)
    search per query, best first. vector_only_embeddings (e.g. a HyDE passage) add vector
    searches without a keyword search."""
    limit = limit or settings.RETRIEVE_K
    rankings: list[list[uuid.UUID]] = []
    candidates: dict[uuid.UUID, Candidate] = {}

    def candidate(chunk_id: uuid.UUID) -> Candidate:
        return candidates.setdefault(chunk_id, Candidate(chunk_id))

    for embedding in [*embeddings, *vector_only_embeddings]:
        ranked = await _vector_ranking(db, notebook_id, embedding, document_ids, limit)
        rankings.append([chunk_id for chunk_id, _ in ranked])
        for rank, (chunk_id, similarity) in enumerate(ranked, start=1):
            c = candidate(chunk_id)
            c.vector_rank = min(c.vector_rank or rank, rank)
            c.vector_similarity = max(c.vector_similarity or 0.0, similarity)

    if settings.ENABLE_HYBRID_SEARCH:
        for query in queries:
            ranked_ids = await _keyword_ranking(db, notebook_id, query, document_ids, limit)
            rankings.append(ranked_ids)
            for rank, chunk_id in enumerate(ranked_ids, start=1):
                c = candidate(chunk_id)
                c.keyword_rank = min(c.keyword_rank or rank, rank)

    fused = []
    for chunk_id, score in reciprocal_rank_fusion(rankings)[:limit]:
        candidates[chunk_id].fused_score = score
        fused.append(candidates[chunk_id])
    return fused


async def load_chunks(db: AsyncSession, chunk_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, tuple[Chunk, Document]]:
    """Chunks with their documents, by chunk id."""
    if not chunk_ids:
        return {}
    rows = (await db.execute(
        select(Chunk, Document).join(Document, Chunk.document_id == Document.id).where(Chunk.id.in_(chunk_ids))
    )).all()
    return {chunk.id: (chunk, document) for chunk, document in rows}


async def similarity_search(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    query_text: str,
    query_embedding: list[float],
    top_k: int | None = None,
    document_ids: list[uuid.UUID] | None = None,
    candidates: int = 30,
) -> list[dict]:
    """Best `top_k` chunks for one query, as [{"chunk", "document"}], best first (no reranking).

    With ENABLE_HYBRID_SEARCH off, only the vector ranking is used (the evaluation baseline)."""
    top_k = top_k or settings.TOP_K
    fused = await hybrid_candidates(db, notebook_id, [query_text], [query_embedding], document_ids, candidates)
    best = [c.chunk_id for c in fused[:top_k]]
    by_id = await load_chunks(db, best)
    return [{"chunk": by_id[i][0], "document": by_id[i][1]} for i in best if i in by_id]
