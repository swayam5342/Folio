import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import auth, chat, documents, notebooks
from app.services.embeddings import get_model
from app.services.ingest import fail_interrupted_documents

log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_secrets()
    interrupted = await fail_interrupted_documents()
    if interrupted:
        log.warning("Marked %d interrupted document(s) as failed", interrupted)
    # Load the embedding model now so the first upload/question isn't slow.
    await asyncio.to_thread(get_model)
    yield


app = FastAPI(title="NotebookLM-style RAG API", lifespan=lifespan)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(notebooks.router, prefix="/api", tags=["notebooks"])
app.include_router(documents.router, prefix="/api", tags=["documents"])
app.include_router(chat.router, prefix="/api", tags=["chat"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
