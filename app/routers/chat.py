import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.deps import get_owned_notebook
from app.models import Message, MessageRole, Notebook
from app.schemas import ChatRequest, MessageOut
from app.services import llm
from app.services.embeddings import embed_query
from app.services.retrieval import similarity_search

router = APIRouter(prefix="/notebooks/{notebook_id}")
log = logging.getLogger(__name__)

NO_SOURCES_ANSWER = "Upload a source to start chatting — once a PDF finishes processing I can answer questions about it."


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


async def _save_assistant(notebook_id: uuid.UUID, content: str, sources: list[dict]) -> MessageOut:
    # Own session: the request-scoped one isn't guaranteed to outlive the streaming response.
    async with AsyncSessionLocal() as db:
        message = Message(notebook_id=notebook_id, role=MessageRole.assistant, content=content, sources=sources)
        db.add(message)
        notebook = await db.get(Notebook, notebook_id)
        if notebook is not None:
            notebook.touch()
        await db.commit()
        await db.refresh(message)
        return MessageOut.model_validate(message)


@router.post("/chat")
async def chat(
    payload: ChatRequest,
    notebook: Notebook = Depends(get_owned_notebook),
    db: AsyncSession = Depends(get_db),
):
    recent = (await db.scalars(
        select(Message)
        .where(Message.notebook_id == notebook.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(settings.HISTORY_MESSAGES + 1)
    )).all()[::-1]

    # A retry after a failed answer re-sends the same question: reuse the
    # unanswered user message instead of storing a duplicate.
    if recent and recent[-1].role == MessageRole.user and recent[-1].content == payload.question:
        user_message = recent.pop()
    else:
        user_message = Message(notebook_id=notebook.id, role=MessageRole.user, content=payload.question, sources=[])
        db.add(user_message)
    history = [(m.role.value, m.content) for m in recent[-settings.HISTORY_MESSAGES:]]

    notebook.touch()
    await db.commit()

    query_embedding = await asyncio.to_thread(embed_query, payload.question)
    retrieved = await similarity_search(db, notebook.id, query_embedding)
    notebook_id = notebook.id

    async def events() -> AsyncIterator[str]:
        if not retrieved:
            yield _sse("token", {"text": NO_SOURCES_ANSWER})
            saved = await _save_assistant(notebook_id, NO_SOURCES_ANSWER, [])
            yield _sse("done", {"message": saved.model_dump(mode="json")})
            return

        context, citation_map = llm.build_context(retrieved)
        messages = llm.build_messages(payload.question, context, history)
        parts: list[str] = []
        try:
            async for text in llm.stream_answer(messages):
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
        saved = await _save_assistant(notebook_id, answer, llm.parse_citations(answer, citation_map))
        yield _sse("done", {"message": saved.model_dump(mode="json")})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
