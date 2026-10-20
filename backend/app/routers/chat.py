import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.deps import get_owned_message, get_owned_notebook
from app.models import AnswerCache, Document, DocumentStatus, Message, MessageRole, Notebook, Thread, utcnow
from app.observability import StageTimer
from app.schemas import ChatRequest, MessageOut, TraceOut
from app.services import answer_cache, citation_check, llm, pipeline
from app.services.chunking import embedding_text
from app.routers.threads import NEW_THREAD_TITLE, latest_thread
from app.services.query_planner import plan_queries

router = APIRouter(prefix="/notebooks/{notebook_id}")
messages_router = APIRouter()
log = logging.getLogger(__name__)

NO_SOURCES_ANSWER = "Upload a source to start chatting — once it finishes processing I can answer questions about it."
NO_SELECTED_SOURCES_ANSWER = "None of the selected sources are ready to search. Tick at least one ready source and ask again."
ABSTAIN_ANSWER = (
    "I couldn't find this in your sources. The passages below are the closest matches, but none of them "
    "answers the question directly — try rephrasing, or check that the right sources are selected."
)
UNCITED_ANSWER = "I couldn't produce a fully source-grounded answer. Please retry or ask a more specific question."
COVERAGE_WARNING = "\n\n> ⚠ Some claims could not be tied to a retrieved excerpt. Verify them against the sources."
NEAREST_EXCERPTS = 3  # shown with an abstention


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/messages", response_model=list[MessageOut])
async def list_messages(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    result = await db.scalars(
        select(Message).where(Message.notebook_id == notebook.id).order_by(Message.created_at, Message.id)
    )
    return result.all()


@router.delete("/messages", status_code=204)
async def clear_messages(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Message).where(Message.notebook_id == notebook.id))
    await db.commit()


@messages_router.get("/messages/{message_id}/trace", response_model=TraceOut)
async def get_trace(message: Message = Depends(get_owned_message), db: AsyncSession = Depends(get_db)):
    """How an answer was retrieved. 404 for questions and for answers saved before traces existed."""
    trace = await db.scalar(select(Message.trace).where(Message.id == message.id))
    if not trace:
        raise HTTPException(status_code=404, detail="No retrieval trace for this message")
    return TraceOut(message_id=message.id, **trace)


async def _resolve_thread(db: AsyncSession, notebook: Notebook, thread_id: uuid.UUID | None) -> Thread:
    """The requested thread (404 unless it's in this notebook), else the latest, else a new one."""
    if thread_id is not None:
        thread = await db.get(Thread, thread_id)
        if thread is None or thread.notebook_id != notebook.id:
            raise HTTPException(status_code=404, detail="Chat not found")
        return thread
    thread = await latest_thread(db, notebook.id)
    if thread is None:
        thread = Thread(notebook_id=notebook.id, title=NEW_THREAD_TITLE)
        db.add(thread)
        await db.flush()
    return thread


def _thread_title(question: str) -> str:
    """A new chat is named after its first question."""
    title = " ".join(question.split())
    return title if len(title) <= 60 else title[:59].rstrip() + "…"


async def _save_assistant(
    notebook_id: uuid.UUID,
    thread_id: uuid.UUID,
    content: str,
    sources: list[dict],
    confidence: str | None = None,
    abstained: bool = False,
    trace: dict | None = None,
) -> MessageOut:
    # Own session: the request-scoped one isn't guaranteed to outlive the streaming response.
    async with AsyncSessionLocal() as db:
        message = Message(
            notebook_id=notebook_id,
            thread_id=thread_id,
            role=MessageRole.assistant,
            content=content,
            sources=sources,
            confidence=confidence,
            abstained=abstained,
            trace=trace,
        )
        db.add(message)
        notebook = await db.get(Notebook, notebook_id)
        if notebook is not None:
            notebook.touch()
        thread = await db.get(Thread, thread_id)
        if thread is not None:
            thread.updated_at = utcnow()
        await db.commit()
        await db.refresh(message)
        return MessageOut.model_validate(message)


def _retrieval_event(result: pipeline.RetrievalResult, citation_map: dict) -> dict:
    """What the UI's pipeline view needs once retrieval is done: queries, counts and the chosen passages."""
    return {
        "question": result.plan.question,
        "queries": result.plan.search_queries,
        "rewritten": result.plan.standalone != result.plan.question,
        "candidates": len(result.candidates),
        "reranked": result.reranked,
        "confidence": result.confidence,
        "abstain": result.abstain,
        "passages": [
            {k: source[k] for k in ("marker", "document_id", "filename", "document_kind", "page_number", "section_title", "score")}
            for source in citation_map.values()
        ],
        "timings_ms": result.timer.timings_ms,
    }


async def _source_overviews(notebook_id: uuid.UUID, document_ids: list[uuid.UUID] | None) -> str | None:
    """Summaries of the searched sources, one line each, for broad questions."""
    stmt = select(Document.filename, Document.summary).where(
        Document.notebook_id == notebook_id,
        Document.status == DocumentStatus.ready,
        Document.summary.is_not(None),
    )
    if document_ids is not None:
        stmt = stmt.where(Document.id.in_(document_ids))
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(stmt.order_by(Document.created_at))).all()
    return "\n".join(f"- {filename}: {summary}" for filename, summary in rows) or None


def _nearest_excerpts(result: pipeline.RetrievalResult) -> list[dict]:
    """The closest passages, shown with an abstention so the user can judge for themselves."""
    _, citation_map = llm.build_context(result.selected[:NEAREST_EXCERPTS])
    return [{**source, "marker": None} for source in citation_map.values()]


@router.post("/chat")
async def chat(
    payload: ChatRequest,
    notebook: Notebook = Depends(get_owned_notebook),
    db: AsyncSession = Depends(get_db),
):
    thread = await _resolve_thread(db, notebook, payload.thread_id)
    recent = (await db.scalars(
        select(Message)
        .where(Message.thread_id == thread.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(settings.HISTORY_MESSAGES + 1)
    )).all()[::-1]

    # A retry after a failed answer re-sends the same question: reuse the
    # unanswered user message instead of storing a duplicate.
    if recent and recent[-1].role == MessageRole.user and recent[-1].content == payload.question:
        user_message = recent.pop()
    else:
        user_message = Message(
            notebook_id=notebook.id, thread_id=thread.id, role=MessageRole.user, content=payload.question, sources=[]
        )
        db.add(user_message)
        if not recent and thread.title == NEW_THREAD_TITLE:
            thread.title = _thread_title(payload.question)
    history = [(m.role.value, m.content) for m in recent[-settings.HISTORY_MESSAGES:]]

    notebook.touch()
    thread.updated_at = utcnow()
    await db.commit()

    notebook_id = notebook.id
    thread_id = thread.id
    regenerate = payload.regenerate
    question = payload.question
    document_ids = payload.document_ids

    async def events() -> AsyncIterator[str]:
        timer = StageTimer()
        result: pipeline.RetrievalResult | None = None
        key: str | None = None
        cached: AnswerCache | None = None
        try:
            async with AsyncSessionLocal() as session:
                yield _sse("stage", {"stage": "plan", "timings_ms": timer.timings_ms})
                with timer.stage("plan"):
                    plan = await plan_queries(question, history)
                if settings.ENABLE_ANSWER_CACHE:
                    # Keyed on the standalone question, so a follow-up only hits when it means the same thing.
                    fingerprint = await answer_cache.fingerprint(session, notebook_id)
                    key = answer_cache.cache_key(plan.standalone, document_ids, fingerprint)
                    if not regenerate:  # a regenerated answer replaces the stored one instead
                        cached = await answer_cache.lookup(session, notebook_id, key)
                if cached is None:
                    async for step in pipeline.run(session, notebook_id, question, history, document_ids, timer, plan=plan):
                        if isinstance(step, pipeline.RetrievalResult):
                            result = step
                        else:
                            # Durations of the stages finished so far, so the UI can show real timings.
                            yield _sse("stage", {"stage": step, "timings_ms": timer.timings_ms})
        except Exception:
            log.exception("Retrieval failed")
            yield _sse("error", {"detail": "Something went wrong searching your sources.", "retry_after": None})
            return

        if cached is not None:
            yield _sse("token", {"text": cached.answer})
            trace = {**cached.trace, "cached": True} if cached.trace else None
            saved = await _save_assistant(notebook_id, thread_id, cached.answer, cached.sources, confidence=cached.confidence, trace=trace)
            log.info("chat answered from cache", extra={"notebook_id": str(notebook_id), "timings_ms": timer.timings_ms})
            yield _sse("done", {"message": saved.model_dump(mode="json")})
            return
        if result is None:  # run() always ends with a result; guards against a future change
            return

        if not result.selected:
            text = NO_SELECTED_SOURCES_ANSWER if document_ids is not None else NO_SOURCES_ANSWER
            yield _sse("token", {"text": text})
            saved = await _save_assistant(notebook_id, thread_id, text, [])
            yield _sse("done", {"message": saved.model_dump(mode="json")})
            return

        context, citation_map = llm.build_context(result.selected)
        yield _sse("retrieval", _retrieval_event(result, citation_map))

        if result.abstain:
            yield _sse("token", {"text": ABSTAIN_ANSWER})
            saved = await _save_assistant(
                notebook_id, thread_id, ABSTAIN_ANSWER, _nearest_excerpts(result),
                confidence=result.confidence, abstained=True, trace=pipeline.build_trace(result),
            )
            log.info("chat abstained", extra={"notebook_id": str(notebook_id), "top_score": result.top_score})
            yield _sse("done", {"message": saved.model_dump(mode="json")})
            return

        yield _sse("stage", {"stage": "generate", "timings_ms": timer.timings_ms})
        overviews = None
        if pipeline.is_broad_question(question, result.plan.standalone):
            overviews = await _source_overviews(notebook_id, document_ids)
        messages = llm.build_messages(question, context, history, overviews)
        parts: list[str] = []
        usage: dict = {}
        try:
            with timer.stage("generate"):
                async for text in llm.stream_answer(messages, usage=usage):
                    parts.append(text)
                    yield _sse("token", {"text": text})
        except llm.LLMError as exc:
            yield _sse("error", {"detail": exc.detail, "retry_after": exc.retry_after})
            return
        except Exception:
            log.exception("Chat stream failed")
            yield _sse("error", {"detail": "Something went wrong generating the answer.", "retry_after": None})
            return

        answer = llm.normalize_citations("".join(parts)).strip() or "I couldn't generate an answer — please try rephrasing the question."
        sources = llm.parse_citations(answer, citation_map)
        coverage, uncited_claims = citation_check.citation_coverage(answer, set(citation_map))
        degraded = (not sources and uncited_claims) or coverage < settings.MIN_CITATION_COVERAGE
        if not sources and uncited_claims:
            answer = UNCITED_ANSWER
            coverage = 0.0
            result.confidence = "low"
            yield _sse("replace", {"text": answer})
        elif coverage < settings.MIN_CITATION_COVERAGE:
            # The warning covers the uncited claims; the confidence badge stays the retrieval signal
            # (overwriting it said "no passage matches" even when the best passage scored 0.99).
            answer += COVERAGE_WARNING
            yield _sse("replace", {"text": answer})
        verdicts: dict[str, dict] = {}
        if settings.ENABLE_CITATION_CHECK and settings.ENABLE_RERANKER and sources:
            yield _sse("stage", {"stage": "verify", "timings_ms": timer.timings_ms})
            passages = {
                f"C{i}": embedding_text({"content": llm.passage_text(item), "section_title": item["chunk"].section_title})
                for i, item in enumerate(result.selected, start=1)
            }
            try:
                with timer.stage("verify"):
                    verdicts = await asyncio.to_thread(citation_check.check_citations, answer, passages)
            except Exception:  # a failed check must never lose the answer
                log.exception("Citation check failed")
        sources = [{**source, **verdicts.get(source["marker"], {})} for source in sources]
        markers = {source["chunk_id"]: marker for marker, source in citation_map.items()}
        trace = pipeline.build_trace(
            result, markers, usage, {m: v["support"] for m, v in verdicts.items()}, citation_coverage=coverage
        )
        saved = await _save_assistant(notebook_id, thread_id, answer, sources, confidence=result.confidence, trace=trace)
        if settings.ENABLE_ANSWER_CACHE and key and sources and not degraded:  # only clean, cited answers are worth repeating
            try:
                async with AsyncSessionLocal() as session:
                    await answer_cache.store(session, notebook_id, key, answer, sources, result.confidence, trace)
            except Exception:
                log.exception("Storing the answer in the cache failed")
        log.info(
            "chat answered",
            extra={
                "notebook_id": str(notebook_id),
                "queries": len(result.plan.search_queries),
                "candidates": len(result.candidates),
                "cited": len(sources),
                "low_support": sum(1 for v in verdicts.values() if v["support"] == "low"),
                "confidence": result.confidence,
                "timings_ms": timer.timings_ms,
                "total_ms": timer.total_ms,
            },
        )
        yield _sse("done", {"message": saved.model_dump(mode="json")})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
