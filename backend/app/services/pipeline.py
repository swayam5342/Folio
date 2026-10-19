"""The retrieval pipeline behind a chat answer.

    question → plan (rewrite + variants [+ HyDE]) → embed → hybrid search per query
             → RRF fuse → cross-encoder rerank → confidence gate → top TOP_K excerpts
             → neighbouring text attached (same page and section)

Every optional stage follows its ENABLE_* flag, so the evaluation harness can
switch stages off one at a time. `run` is an async generator: it yields the name
of each stage as it starts (the chat stream forwards these to the UI) and
finally a RetrievalResult. `build_trace` turns a result into the JSON stored
with the answer for "How was this answered?".
"""
import asyncio
import re
import uuid
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import cast

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Chunk, Document
from app.observability import StageTimer
from app.services import reranker
from app.services.chunking import embedding_text
from app.services.embeddings import embed_queries, embed_texts
from app.services.query_planner import QueryPlan, plan_queries
from app.services.retrieval import Candidate, hybrid_candidates, load_chunks

SNIPPET_CHARS = 240

# Questions about the sources as a whole: no single passage "answers" them, so a weak
# best match says nothing about whether they can be answered. They never abstain.
_BROAD_QUESTION = re.compile(
    r"\b(summar(y|ies|ise|ize|ising|izing)|overview|outline|tl;?dr|takeaways?|"
    r"(key|main|important|central) (points?|ideas?|findings?|topics?|themes?|arguments?|concepts?|results?)|"
    r"what (is|are) (this|these|the) (documents?|sources?|papers?|pdfs?|files?|chapters?|notes?|slides?) about|"
    r"leave open|open questions)\b",
    re.IGNORECASE,
)

Confidence = str  # "high" | "medium" | "low"


@dataclass
class RetrievalResult:
    plan: QueryPlan
    candidates: list[Candidate]  # best first: by rerank score when reranked, else by fused score
    chunks: dict[uuid.UUID, tuple[Chunk, Document]]
    reranked: bool
    confidence: Confidence | None
    top_score: float | None
    abstain: bool
    timer: StageTimer
    document_ids: list[uuid.UUID] | None = None
    selected: list[dict] = field(default_factory=list)  # [{"chunk", "document", "candidate"}], TOP_K best


def is_broad_question(*questions: str) -> bool:
    """Summaries, overviews, "key points": questions about the sources as a whole."""
    return any(_BROAD_QUESTION.search(q) for q in questions)


def assess_confidence(candidates: Sequence[Candidate], reranked: bool) -> tuple[Confidence | None, float | None]:
    """(level, score behind it) from the best candidate; (None, None) when nothing was found.

    Cross-encoders are sharply polarised: a correct passage worded differently from the
    question can score near 0. So "low" needs the embedding similarity to be weak as well;
    a strong reranker score alone earns "high". The returned score is the reranker's when
    reranked, else the similarity."""
    if not candidates:
        return None, None
    similarity = max(c.vector_similarity or 0.0 for c in candidates)
    weak_similarity = similarity < settings.SIMILARITY_LOW
    if reranked:
        top = max(c.rerank_score or 0.0 for c in candidates)
        if top >= settings.CONFIDENCE_HIGH:
            level = "high"
        elif top < settings.CONFIDENCE_LOW and weak_similarity:
            level = "low"
        else:
            level = "medium"
    else:
        top = similarity
        level = "high" if similarity >= settings.SIMILARITY_HIGH else "low" if weak_similarity else "medium"
    return level, round(top, 4)


def should_abstain(confidence: Confidence | None, broad: bool = False) -> bool:
    """Refuse to answer on low confidence, unless the question is about the sources as a whole."""
    return settings.ENABLE_ABSTENTION and confidence == "low" and not broad


def select_context(
    candidates: Sequence[Candidate],
    chunks: dict[uuid.UUID, tuple[Chunk, Document]],
    *,
    broad: bool,
) -> list[Candidate]:
    """Choose a compact, non-redundant context with source coverage for broad questions."""
    limit = settings.BROAD_TOP_K if broad else settings.TOP_K
    chosen: list[Candidate] = []
    seen_text: set[str] = set()
    per_document: dict[uuid.UUID, int] = {}
    total_chars = 0

    def add(candidate: Candidate, enforce_cap: bool) -> bool:
        nonlocal total_chars
        chunk, document = chunks[candidate.chunk_id]
        document_id = cast(uuid.UUID, document.id)
        fingerprint = " ".join(chunk.content.casefold().split())
        if fingerprint in seen_text:
            return False
        if enforce_cap and per_document.get(document_id, 0) >= settings.MAX_CHUNKS_PER_DOCUMENT:
            return False
        if chosen and total_chars + len(chunk.content) > settings.CONTEXT_MAX_CHARS:
            return False
        chosen.append(candidate)
        seen_text.add(fingerprint)
        per_document[document_id] = per_document.get(document_id, 0) + 1
        total_chars += len(chunk.content)
        return True

    if broad:
        # Round-robin by source so a long/high-scoring PDF cannot erase the rest
        # of the notebook from an overview.
        by_document: dict[uuid.UUID, list[Candidate]] = {}
        for candidate in candidates:
            document_id = cast(uuid.UUID, chunks[candidate.chunk_id][1].id)
            by_document.setdefault(document_id, []).append(candidate)
        depth = 0
        while len(chosen) < limit and any(depth < len(items) for items in by_document.values()):
            for items in by_document.values():
                if depth < len(items):
                    add(items[depth], enforce_cap=True)
                    if len(chosen) >= limit:
                        break
            depth += 1
    else:
        for candidate in candidates:
            add(candidate, enforce_cap=True)
            if len(chosen) >= limit:
                break

    # If caps were too strict (for example a one-document notebook), fill the
    # remaining budget in rank order while still removing exact duplicates.
    if len(chosen) < limit:
        selected_ids = {c.chunk_id for c in chosen}
        for candidate in candidates:
            if candidate.chunk_id not in selected_ids and add(candidate, enforce_cap=False):
                selected_ids.add(candidate.chunk_id)
            if len(chosen) >= limit:
                break
    return chosen


async def run(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    question: str,
    history: list[tuple[str, str]],
    document_ids: list[uuid.UUID] | None = None,
    timer: StageTimer | None = None,
) -> AsyncIterator[str | RetrievalResult]:
    """Yields stage names ("plan", "search", "rerank") as they start, then the RetrievalResult."""
    timer = timer or StageTimer()

    yield "plan"
    with timer.stage("plan"):
        plan = await plan_queries(question, history)

    yield "search"
    queries = plan.search_queries
    with timer.stage("embed"):
        query_vectors = await asyncio.to_thread(embed_queries, queries)
        hyde_vectors = await asyncio.to_thread(embed_texts, [plan.hypothetical]) if plan.hypothetical else []
    with timer.stage("search"):
        candidates = await hybrid_candidates(
            db, notebook_id, queries, query_vectors, document_ids,
            vector_only_embeddings=hyde_vectors,
        )
        chunks = await load_chunks(db, [c.chunk_id for c in candidates])
        candidates = [c for c in candidates if c.chunk_id in chunks]  # deleted mid-request

    reranked = settings.ENABLE_RERANKER and bool(candidates)
    if reranked:
        yield "rerank"
        passages = [
            embedding_text({"content": chunks[c.chunk_id][0].content, "section_title": chunks[c.chunk_id][0].section_title})
            for c in candidates
        ]
        with timer.stage("rerank"):
            scores = await asyncio.to_thread(reranker.score, plan.standalone, passages)
        for c, s in zip(candidates, scores, strict=True):
            c.rerank_score = round(s, 4)
        candidates.sort(key=lambda c: c.rerank_score or 0.0, reverse=True)

    # Confidence must describe the passages that will actually reach generation.
    # Looking across discarded candidates can let one unrelated high-similarity hit
    # suppress a necessary abstention.
    broad = is_broad_question(question, plan.standalone)
    selected_candidates = select_context(candidates, chunks, broad=broad)
    confidence, top_score = assess_confidence(selected_candidates, reranked)
    result = RetrievalResult(
        plan=plan,
        candidates=candidates,
        chunks=chunks,
        reranked=reranked,
        confidence=confidence,
        top_score=top_score,
        abstain=should_abstain(confidence, broad=broad),
        timer=timer,
        document_ids=document_ids,
    )
    result.selected = [
        {"chunk": chunks[c.chunk_id][0], "document": chunks[c.chunk_id][1], "candidate": c}
        for c in selected_candidates
    ]
    if settings.ENABLE_NEIGHBOR_EXPANSION and result.selected and not result.abstain:
        with timer.stage("expand"):
            await expand_neighbors(db, result.selected)
    yield result


def _overlaps(a: Chunk, b: Chunk) -> bool:
    if None in (a.char_start, a.char_end, b.char_start, b.char_end):
        return True  # unknown positions: assume overlap rather than repeat text
    return a.char_start < b.char_end and b.char_start < a.char_end


async def expand_neighbors(db: AsyncSession, selected: list[dict]) -> None:
    """Attach the chunks just before and after each selected passage as item["before"] /
    item["after"], so the model reads whole thoughts rather than cut-off excerpts.

    A neighbour must be on the same page and in the same section (so the citation's page
    stays exact), not quarantined, not selected itself, not used for another passage and
    not overlapping the passage's text. Best-ranked passages are expanded first, while
    the context stays within CONTEXT_MAX_CHARS."""
    wanted = {
        (item["chunk"].document_id, item["chunk"].chunk_index + delta)
        for item in selected
        for delta in (-1, 1)
    }
    rows = (await db.scalars(
        select(Chunk).where(
            tuple_(Chunk.document_id, Chunk.chunk_index).in_(list(wanted)),
            Chunk.quarantined.is_(False),
        )
    )).all()
    by_position = {(c.document_id, c.chunk_index): c for c in rows}
    used = {item["chunk"].id for item in selected}
    total = sum(len(item["chunk"].content) for item in selected)
    for item in selected:  # already best first
        chunk = item["chunk"]
        for key, delta in (("before", -1), ("after", 1)):
            neighbour = by_position.get((chunk.document_id, chunk.chunk_index + delta))
            if (
                neighbour is None
                or neighbour.id in used
                or neighbour.page_number != chunk.page_number
                or neighbour.section_title != chunk.section_title
                or _overlaps(neighbour, chunk)
                or total + len(neighbour.content) > settings.CONTEXT_MAX_CHARS
            ):
                continue
            item[key] = neighbour.content
            used.add(neighbour.id)
            total += len(neighbour.content)


def build_trace(
    result: RetrievalResult,
    markers: dict[str, str] | None = None,
    answer_usage: dict | None = None,
    supports: dict[str, str] | None = None,
    citation_coverage: float | None = None,
) -> dict:
    """JSON-ready record of how an answer was retrieved. markers maps chunk id → "C<n>";
    supports maps a marker to its citation check verdict ("ok" / "low")."""
    markers = markers or {}
    supports = supports or {}
    selected_ids = {item["chunk"].id for item in result.selected}
    candidates = []
    for c in result.candidates:
        chunk, document = result.chunks[c.chunk_id]
        candidates.append({
            "chunk_id": str(chunk.id),
            "document_id": str(document.id),
            "filename": document.filename,
            "document_kind": document.kind or "pdf",
            "page_number": chunk.page_number,
            "section_title": chunk.section_title,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
            "snippet": chunk.content[:SNIPPET_CHARS],
            "vector_rank": c.vector_rank,
            "keyword_rank": c.keyword_rank,
            "vector_similarity": None if c.vector_similarity is None else round(c.vector_similarity, 4),
            "fused_score": round(c.fused_score, 5),
            "rerank_score": c.rerank_score,
            "selected": chunk.id in selected_ids,
            "marker": markers.get(str(chunk.id)),
            "support": supports.get(markers.get(str(chunk.id), "")),
        })
    plan = result.plan
    return {
        "question": plan.question,
        "standalone_query": plan.standalone,
        "variants": plan.variants,
        "hypothetical": plan.hypothetical,
        "planner": {"llm_called": plan.llm_called, "cached": plan.cached, "error": plan.error},
        "document_ids": None if result.document_ids is None else [str(d) for d in result.document_ids],
        "features": settings.feature_flags(),
        "candidates": candidates,
        "reranked": result.reranked,
        "confidence": result.confidence,
        "top_score": result.top_score,
        "abstained": result.abstain,
        "timings_ms": result.timer.timings_ms,
        "total_ms": result.timer.total_ms,
        "tokens": {"planner": plan.usage or None, "answer": answer_usage or None},
        "citation_coverage": citation_coverage,
    }
