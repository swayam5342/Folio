import asyncio
import logging
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal
from app.observability import RequestContextMiddleware, configure_logging
from app.routers import auth, chat, documents, evaluation, notebooks, notes, study, threads
from app.services import reranker, storage
from app.services.embeddings import get_model
from app.services.ingest import fail_interrupted_documents

configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
log = logging.getLogger("folio")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_secrets()
    interrupted = await fail_interrupted_documents()
    if interrupted:
        log.warning("Marked %d interrupted document(s) as failed", interrupted)
    # Load the models now so the first upload/question isn't slow.
    await asyncio.to_thread(get_model)
    if settings.ENABLE_RERANKER:
        await asyncio.to_thread(reranker.get_model)
    log.info("startup complete", extra={"features": settings.feature_flags()})
    yield


app = FastAPI(title="NotebookLM-style RAG API", lifespan=lifespan)
app.add_middleware(RequestContextMiddleware)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(notebooks.router, prefix="/api", tags=["notebooks"])
app.include_router(documents.router, prefix="/api", tags=["documents"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(chat.messages_router, prefix="/api", tags=["chat"])
app.include_router(threads.router, prefix="/api", tags=["chat"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(study.router, prefix="/api", tags=["study"])
app.include_router(evaluation.router, prefix="/api", tags=["evaluation"])


@app.get("/api/health")
async def health():
    """Process liveness only; does not claim dependencies are ready."""
    return {"status": "ok"}


@app.get("/api/readyz")
async def readiness():
    """Readiness for orchestration: database connectivity plus usable upload storage."""
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        upload_root = storage.root()
        upload_root.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=upload_root):
            pass
    except Exception:
        log.exception("readiness check failed")
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {"status": "ready"}


@app.get("/api/features")
async def features() -> dict[str, bool]:
    """Which optional pipeline stages are switched on (no secrets; used by the UI and the eval harness)."""
    return settings.feature_flags()
