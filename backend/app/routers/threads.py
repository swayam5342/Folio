"""Chat threads: a notebook can hold several separate conversations."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_owned_message, get_owned_notebook, get_owned_thread
from app.models import Message, Notebook, Thread, utcnow
from app.schemas import MessageOut, ThreadCreate, ThreadOut, ThreadUpdate

router = APIRouter()

NEW_THREAD_TITLE = "New chat"


async def latest_thread(db: AsyncSession, notebook_id: uuid.UUID) -> Thread | None:
    return await db.scalar(
        select(Thread).where(Thread.notebook_id == notebook_id).order_by(Thread.updated_at.desc()).limit(1)
    )


@router.get("/notebooks/{notebook_id}/threads", response_model=list[ThreadOut])
async def list_threads(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    """Most recently used first."""
    return (await db.scalars(
        select(Thread).where(Thread.notebook_id == notebook.id).order_by(Thread.updated_at.desc())
    )).all()


@router.post("/notebooks/{notebook_id}/threads", response_model=ThreadOut, status_code=201)
async def create_thread(
    payload: ThreadCreate, notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)
):
    thread = Thread(notebook_id=notebook.id, title=payload.title or NEW_THREAD_TITLE)
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return thread


@router.patch("/threads/{thread_id}", response_model=ThreadOut)
async def rename_thread(
    payload: ThreadUpdate, thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)
):
    thread.title = payload.title
    await db.commit()
    await db.refresh(thread)
    return thread


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)):
    await db.delete(thread)
    await db.commit()


@router.get("/threads/{thread_id}/messages", response_model=list[MessageOut])
async def thread_messages(thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)):
    return (await db.scalars(
        select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at, Message.id)
    )).all()


@router.delete("/threads/{thread_id}/messages", status_code=204)
async def clear_thread(thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Message).where(Message.thread_id == thread.id))
    thread.updated_at = utcnow()
    await db.commit()


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(message: Message = Depends(get_owned_message), db: AsyncSession = Depends(get_db)):
    """Remove one answer, e.g. before regenerating it. Only the thread's last message may go,
    so a conversation is never left with a gap the model would misread."""
    last = await db.scalar(
        select(Message.id).where(Message.thread_id == message.thread_id)
        .order_by(Message.created_at.desc(), Message.id.desc()).limit(1)
    )
    if last != message.id:
        raise HTTPException(status_code=409, detail="Only the latest message can be removed")
    await db.delete(message)
    await db.commit()
