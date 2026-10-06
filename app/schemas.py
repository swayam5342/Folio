import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, field_validator

# Normalise before the pattern check (StringConstraints checks the pattern on the raw input).
_normalise = BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v)
Username = Annotated[str, _normalise, StringConstraints(pattern=r"^[a-z0-9_]{3,32}$")]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
NotebookName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth ---------------------------------------------------------------

class Credentials(BaseModel):
    username: Username
    password: Password


class LoginRequest(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=64)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class UserOut(ORMModel):
    id: uuid.UUID
    username: str
    created_at: datetime


# --- Notebooks ----------------------------------------------------------

class NotebookCreate(BaseModel):
    name: NotebookName


class NotebookUpdate(BaseModel):
    name: NotebookName


class NotebookOut(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime
    source_count: int = 0


# --- Documents ----------------------------------------------------------

class DocumentOut(ORMModel):
    id: uuid.UUID
    notebook_id: uuid.UUID
    filename: str
    page_count: int
    size_bytes: int
    status: Literal["processing", "ready", "failed"]
    error: str | None
    created_at: datetime

    @field_validator("status", mode="before")
    @classmethod
    def _enum_value(cls, v):
        return getattr(v, "value", v)


# --- Chat ---------------------------------------------------------------

class ChatRequest(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class SourceOut(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page_number: int
    snippet: str


class MessageOut(ORMModel):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    sources: list[SourceOut] = Field(default_factory=list)
    created_at: datetime

    @field_validator("role", mode="before")
    @classmethod
    def _enum_value(cls, v):
        return getattr(v, "value", v)
