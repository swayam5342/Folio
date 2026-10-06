from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, get_owned_notebook
from app.models import Document, Notebook, User
from app.schemas import NotebookCreate, NotebookOut, NotebookUpdate
from app.services import storage

router = APIRouter(prefix="/notebooks")


async def _source_count(db: AsyncSession, notebook: Notebook) -> int:
    return await db.scalar(select(func.count()).where(Document.notebook_id == notebook.id))


def _out(notebook: Notebook, source_count: int) -> NotebookOut:
    return NotebookOut.model_validate(notebook).model_copy(update={"source_count": source_count})


@router.get("", response_model=list[NotebookOut])
async def list_notebooks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    counts = (
        select(Document.notebook_id, func.count().label("n"))
        .group_by(Document.notebook_id)
        .subquery()
    )
    rows = await db.execute(
        select(Notebook, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.notebook_id == Notebook.id)
        .where(Notebook.user_id == user.id)
        .order_by(Notebook.updated_at.desc())
    )
    return [_out(nb, n) for nb, n in rows.all()]


@router.post("", response_model=NotebookOut, status_code=201)
async def create_notebook(
    payload: NotebookCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notebook = Notebook(name=payload.name, user_id=user.id)
    db.add(notebook)
    await db.commit()
    await db.refresh(notebook)
    return _out(notebook, 0)


@router.get("/{notebook_id}", response_model=NotebookOut)
async def get_notebook(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    return _out(notebook, await _source_count(db, notebook))


@router.patch("/{notebook_id}", response_model=NotebookOut)
async def rename_notebook(
    payload: NotebookUpdate,
    notebook: Notebook = Depends(get_owned_notebook),
    db: AsyncSession = Depends(get_db),
):
    notebook.name = payload.name
    notebook.touch()
    await db.commit()
    await db.refresh(notebook)
    return _out(notebook, await _source_count(db, notebook))


@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    paths = (await db.scalars(select(Document.storage_path).where(Document.notebook_id == notebook.id))).all()
    await db.delete(notebook)
    await db.commit()
    for path in paths:
        storage.delete_file(path)
