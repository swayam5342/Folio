from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_owned_notebook, get_owned_study_set
from app.models import Document, DocumentStatus, Notebook, StudyKind, StudySet
from app.schemas import ScoreIn, StudySetCreate, StudySetOut, StudySetSummary
from app.services import llm, study

router = APIRouter()


@router.get("/notebooks/{notebook_id}/study-sets", response_model=list[StudySetSummary])
async def list_study_sets(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    result = await db.scalars(
        select(StudySet).where(StudySet.notebook_id == notebook.id).order_by(StudySet.created_at.desc())
    )
    return result.all()


@router.post("/notebooks/{notebook_id}/study-sets", response_model=StudySetOut, status_code=201)
async def create_study_set(
    payload: StudySetCreate,
    notebook: Notebook = Depends(get_owned_notebook),
    db: AsyncSession = Depends(get_db),
):
    ready_query = select(Document.id).where(
        Document.notebook_id == notebook.id, Document.status == DocumentStatus.ready
    )
    if payload.document_ids is not None:
        ready_query = ready_query.where(Document.id.in_(payload.document_ids))
    document_ids = list((await db.scalars(ready_query)).all())
    if not document_ids:
        raise HTTPException(status_code=400, detail="Add a ready source first")

    kind = StudyKind(payload.kind)
    try:
        title, items = await study.generate(db, notebook.id, kind, payload.count, payload.topic, document_ids)
    except llm.RateLimited as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        return JSONResponse(status_code=429, content={"detail": exc.detail}, headers=headers)
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=exc.detail)
    except study.GenerationFailed as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    study_set = StudySet(
        notebook_id=notebook.id,
        kind=kind,
        title=title,
        topic=payload.topic,
        document_ids=[str(d) for d in document_ids],
        items=items,
    )
    db.add(study_set)
    notebook.touch()
    await db.commit()
    await db.refresh(study_set)
    return study_set


@router.get("/study-sets/{study_set_id}", response_model=StudySetOut)
async def get_study_set(study_set: StudySet = Depends(get_owned_study_set)):
    return study_set


@router.delete("/study-sets/{study_set_id}", status_code=204)
async def delete_study_set(study_set: StudySet = Depends(get_owned_study_set), db: AsyncSession = Depends(get_db)):
    await db.delete(study_set)
    await db.commit()


@router.post("/study-sets/{study_set_id}/score", response_model=StudySetOut)
async def save_score(
    payload: ScoreIn,
    study_set: StudySet = Depends(get_owned_study_set),
    db: AsyncSession = Depends(get_db),
):
    if study_set.kind != StudyKind.quiz:
        raise HTTPException(status_code=400, detail="Only quizzes have scores")
    if payload.score > study_set.item_count:
        raise HTTPException(status_code=422, detail="Score is higher than the number of questions")
    study_set.last_score = payload.score
    await db.commit()
    await db.refresh(study_set)
    return study_set
