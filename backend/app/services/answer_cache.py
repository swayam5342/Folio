"""Stored answers for repeat questions (ENABLE_ANSWER_CACHE).

The key is the planner's *standalone* question, so a follow-up such as "and the
second one?" is rewritten before lookup and only matches an earlier question that
means the same thing. It also covers which sources were searched and a fingerprint
of the notebook's indexed sources: adding, removing or re-indexing a source makes
old entries stop matching. Model and feature flags are part of the key so changing
the pipeline never serves an answer it didn't produce.
"""
import hashlib
import json
import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AnswerCache, Document, DocumentStatus, utcnow

MAX_ENTRIES_PER_NOTEBOOK = 200


def normalize_question(text: str) -> str:
    return " ".join(text.casefold().split())


async def fingerprint(db: AsyncSession, notebook_id: uuid.UUID) -> str:
    """Changes whenever a ready source is added, removed or re-indexed."""
    rows = (await db.execute(
        select(Document.id, Document.indexed_at)
        .where(Document.notebook_id == notebook_id, Document.status == DocumentStatus.ready)
        .order_by(Document.id)
    )).all()
    return hashlib.sha256(json.dumps([[str(i), str(t)] for i, t in rows]).encode()).hexdigest()


def cache_key(standalone: str, document_ids: Sequence[uuid.UUID] | None, source_fingerprint: str) -> str:
    scope = "all" if document_ids is None else sorted(str(d) for d in document_ids)
    material = {
        "q": normalize_question(standalone),
        "scope": scope,
        "sources": source_fingerprint,
        "model": settings.GROQ_MODEL,
        "flags": settings.feature_flags(),
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()


async def lookup(db: AsyncSession, notebook_id: uuid.UUID, key: str) -> AnswerCache | None:
    return await db.scalar(select(AnswerCache).where(AnswerCache.notebook_id == notebook_id, AnswerCache.key == key))


async def store(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    key: str,
    answer: str,
    sources: list[dict],
    confidence: str | None,
    trace: dict | None,
) -> None:
    """Upsert an answer, keeping the newest MAX_ENTRIES_PER_NOTEBOOK per notebook. Commits."""
    values = {"answer": answer, "sources": sources, "confidence": confidence, "trace": trace, "created_at": utcnow()}
    await db.execute(
        insert(AnswerCache)
        .values(id=uuid.uuid4(), notebook_id=notebook_id, key=key, **values)
        .on_conflict_do_update(index_elements=["notebook_id", "key"], set_=values)
    )
    keep = (
        select(AnswerCache.id)
        .where(AnswerCache.notebook_id == notebook_id)
        .order_by(AnswerCache.created_at.desc())
        .limit(MAX_ENTRIES_PER_NOTEBOOK)
    )
    await db.execute(delete(AnswerCache).where(AnswerCache.notebook_id == notebook_id, AnswerCache.id.not_in(keep)))
    await db.commit()


async def clear(db: AsyncSession, notebook_id: uuid.UUID) -> None:
    """Drop a notebook's stored answers (the caller commits)."""
    await db.execute(delete(AnswerCache).where(AnswerCache.notebook_id == notebook_id))
