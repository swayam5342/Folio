"""Request dependencies: current user and ownership-checked resource lookups.

Every lookup of a user-owned resource goes through these, and a resource the
user doesn't own is reported as 404 so its existence isn't revealed.
"""
import uuid

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Document, Notebook, StudySet, User
from app.security import SESSION_COOKIE, decode_token


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    user_id = decode_token(token) if token else None
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


async def get_owned_notebook(
    notebook_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Notebook:
    notebook = await db.get(Notebook, notebook_id)
    if notebook is None or notebook.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return notebook


async def get_owned_document(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Document:
    result = await db.execute(
        select(Document)
        .join(Notebook, Document.notebook_id == Notebook.id)
        .where(Document.id == document_id, Notebook.user_id == user.id)
    )
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


async def get_owned_study_set(
    study_set_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StudySet:
    result = await db.execute(
        select(StudySet)
        .join(Notebook, StudySet.notebook_id == Notebook.id)
        .where(StudySet.id == study_set_id, Notebook.user_id == user.id)
    )
    study_set = result.scalar_one_or_none()
    if study_set is None:
        raise HTTPException(status_code=404, detail="Study set not found")
    return study_set
