import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Notebook
from app.schemas import ChatRequest, ChatResponse, SourceOut
from app.services.embeddings import embed_query
from app.services.retrieval import similarity_search
from app.services.llm import generate_answer

router = APIRouter()


@router.post("/notebooks/{notebook_id}/chat", response_model=ChatResponse)
async def chat(notebook_id: uuid.UUID, payload: ChatRequest, db: AsyncSession = Depends(get_db)):
    notebook = await db.get(Notebook, notebook_id)
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")

    query_embedding = embed_query(payload.question)
    retrieved = await similarity_search(db, notebook_id, query_embedding)

    if not retrieved:
        return ChatResponse(
            answer="No documents have been uploaded to this notebook yet.",
            sources=[],
        )

    result = await generate_answer(payload.question, retrieved)
    sources = [SourceOut(**s) for s in result["sources"]]
    return ChatResponse(answer=result["answer"], sources=sources)
