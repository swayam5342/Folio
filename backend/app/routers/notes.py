"""Notes: answers saved from the chat (keeping their citations) and notes the user writes."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_owned_note, get_owned_notebook
from app.models import Note, Notebook, utcnow
from app.schemas import NoteCreate, NoteOut, NoteUpdate

router = APIRouter()


@router.get("/notebooks/{notebook_id}/notes", response_model=list[NoteOut])
async def list_notes(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    """Newest first."""
    return (await db.scalars(
        select(Note).where(Note.notebook_id == notebook.id).order_by(Note.updated_at.desc())
    )).all()


@router.post("/notebooks/{notebook_id}/notes", response_model=NoteOut, status_code=201)
async def create_note(payload: NoteCreate, notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    note = Note(
        notebook_id=notebook.id,
        title=payload.title,
        content=payload.content,
        sources=[s.model_dump() for s in payload.sources],
    )
    db.add(note)
    notebook.touch()
    await db.commit()
    await db.refresh(note)
    return note


@router.patch("/notes/{note_id}", response_model=NoteOut)
async def update_note(payload: NoteUpdate, note: Note = Depends(get_owned_note), db: AsyncSession = Depends(get_db)):
    if payload.title is not None:
        note.title = payload.title
    if payload.content is not None:
        note.content = payload.content
    note.updated_at = utcnow()
    await db.commit()
    await db.refresh(note)
    return note


@router.delete("/notes/{note_id}", status_code=204)
async def delete_note(note: Note = Depends(get_owned_note), db: AsyncSession = Depends(get_db)):
    await db.delete(note)
    await db.commit()
