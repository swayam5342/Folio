import uuid

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Notebook, Document, Chunk
from app.schemas import NotebookCreate, NotebookOut, DocumentOut
from app.services.pdf_parser import extract_pages_from_pdf
from app.services.chunking import chunk_pages
from app.services.embeddings import embed_texts

router = APIRouter()


@router.post("/notebooks", response_model=NotebookOut)
async def create_notebook(payload: NotebookCreate, db: AsyncSession = Depends(get_db)):
    notebook = Notebook(name=payload.name)
    db.add(notebook)
    await db.commit()
    await db.refresh(notebook)
    return notebook


@router.get("/notebooks/{notebook_id}/documents", response_model=list[DocumentOut])
async def list_documents(notebook_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.notebook_id == notebook_id))
    return result.scalars().all()


@router.post("/notebooks/{notebook_id}/documents", response_model=DocumentOut)
async def upload_document(
    notebook_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    notebook = await db.get(Notebook, notebook_id)
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported right now")

    file_bytes = await file.read()
    pages = extract_pages_from_pdf(file_bytes)
    if not pages:
        raise HTTPException(status_code=400, detail="Could not extract any text from this PDF")

    document = Document(notebook_id=notebook_id, filename=file.filename, page_count=len(pages))
    db.add(document)
    await db.flush()  # populate document.id before creating chunks that reference it

    raw_chunks = chunk_pages(pages)
    embeddings = embed_texts([c["content"] for c in raw_chunks])

    for raw_chunk, embedding in zip(raw_chunks, embeddings):
        db.add(Chunk(
            document_id=document.id,
            page_number=raw_chunk["page_number"],
            chunk_index=raw_chunk["chunk_index"],
            content=raw_chunk["content"],
            embedding=embedding,
        ))

    await db.commit()
    await db.refresh(document)
    return document
