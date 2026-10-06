from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_secrets()
    yield


app = FastAPI(title="NotebookLM-style RAG API", lifespan=lifespan)

app.include_router(auth.router, prefix="/api", tags=["auth"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
