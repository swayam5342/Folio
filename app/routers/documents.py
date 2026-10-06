import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, get_owned_document, get_owned_notebook
from app.models import Document, DocumentStatus, Notebook, User
from app.schemas import DocumentOut
from app.services import storage
from app.services.ingest import process_document

router = APIRouter()

_READ_CHUNK = 1024 * 1024


async def _read_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read the upload but stop as soon as it exceeds the limit."""
    buf = bytearray()
    while chunk := await file.read(_READ_CHUNK):
        buf += chunk
        if len(buf) > max_bytes:
            raise HTTPException(status_code=413, detail=f"PDFs must be {settings.MAX_UPLOAD_MB} MB or smaller")
    return bytes(buf)


@router.get("/notebooks/{notebook_id}/documents", response_model=list[DocumentOut])
async def list_documents(notebook: Notebook = Depends(get_owned_notebook), db: AsyncSession = Depends(get_db)):
    result = await db.scalars(
        select(Document).where(Document.notebook_id == notebook.id).order_by(Document.created_at)
    )
    return result.all()


@router.post("/notebooks/{notebook_id}/documents", response_model=DocumentOut, status_code=202)
async def upload_document(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    notebook: Notebook = Depends(get_owned_notebook),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    data = await _read_capped(file, settings.MAX_UPLOAD_MB * 1024 * 1024)
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="That file isn't a valid PDF")

    document_id = uuid.uuid4()
    storage_path = storage.save_pdf(user.id, document_id, data)
    document = Document(
        id=document_id,
        notebook_id=notebook.id,
        filename=filename[:255],
        storage_path=storage_path,
        size_bytes=len(data),
        status=DocumentStatus.processing,
    )
    db.add(document)
    notebook.touch()
    try:
        await db.commit()
    except Exception:
        storage.delete_file(storage_path)
        raise
    await db.refresh(document)

    background.add_task(process_document, document.id)
    return document


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(document: Document = Depends(get_owned_document)):
    return document


@router.get("/documents/{document_id}/file")
async def get_document_file(document: Document = Depends(get_owned_document)):
    path = storage.absolute(document.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="The stored file is missing")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=document.filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document: Document = Depends(get_owned_document), db: AsyncSession = Depends(get_db)):
    notebook = await db.get(Notebook, document.notebook_id)
    storage_path = document.storage_path
    await db.delete(document)
    notebook.touch()
    await db.commit()
    storage.delete_file(storage_path)
