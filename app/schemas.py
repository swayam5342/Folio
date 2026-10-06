import uuid
from datetime import datetime
from typing import List

from pydantic import BaseModel


class NotebookCreate(BaseModel):
    name: str


class NotebookOut(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    page_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    question: str


class SourceOut(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page_number: int
    snippet: str


class ChatResponse(BaseModel):
    answer: str
    sources: List[SourceOut]
