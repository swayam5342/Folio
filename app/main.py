from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import documents, chat

app = FastAPI(title="NotebookLM-style RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this before deploying anywhere real
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, tags=["documents"])
app.include_router(chat.router, tags=["chat"])


@app.get("/health")
async def health():
    return {"status": "ok"}
