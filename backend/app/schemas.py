import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, field_validator, model_validator

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
    name: NotebookName | None = None
    pii_redaction_enabled: bool | None = None

    @model_validator(mode="after")
    def _has_change(self):
        if self.name is None and self.pii_redaction_enabled is None:
            raise ValueError("provide a name or pii_redaction_enabled")
        return self


class NotebookOut(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime
    source_count: int = 0
    pii_redaction_enabled: bool = False


# --- Documents ----------------------------------------------------------

class DocumentOut(ORMModel):
    id: uuid.UUID
    notebook_id: uuid.UUID
    filename: str
    kind: str = "pdf"
    page_count: int
    ocr_pages: int
    size_bytes: int
    status: Literal["processing", "ready", "failed"]
    error: str | None
    risk_score: int = 0
    risk_reasons: list[str] = Field(default_factory=list)
    pii_summary: dict[str, int] = Field(default_factory=dict)
    summary: str | None = None
    summary_status: Literal["pending", "done", "failed"] | None = None
    created_at: datetime

    @field_validator("status", mode="before")
    @classmethod
    def _enum_value(cls, v):
        return getattr(v, "value", v)


# --- Chat ---------------------------------------------------------------

class ChatRequest(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    # Restrict retrieval to these sources (null = every ready source in the notebook).
    document_ids: Annotated[list[uuid.UUID], Field(max_length=200)] | None = None


class SourceOut(BaseModel):
    marker: str | None = None  # "C3" — which [[Cn]] in the answer this source backs; null for nearest excerpts
    chunk_id: str
    document_id: str
    filename: str
    document_kind: str = "pdf"
    page_number: int  # the slide number for pptx; 1 for single-page kinds (docx, md, txt, text)
    section_title: str | None = None
    char_start: int | None = None  # the chunk's range in the page text served by /documents/{id}/pages
    char_end: int | None = None
    snippet: str
    score: float | None = None  # relevance to the question: reranker score (0-1), else cosine similarity
    support: Literal["ok", "low"] | None = None  # does the excerpt support the claims citing it?
    support_score: float | None = None


Confidence = Literal["high", "medium", "low"]


class MessageOut(ORMModel):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    sources: list[SourceOut] = Field(default_factory=list)
    confidence: Confidence | None = None
    abstained: bool = False  # the sources didn't support an answer; sources are the nearest excerpts
    created_at: datetime

    @field_validator("role", mode="before")
    @classmethod
    def _enum_value(cls, v):
        return getattr(v, "value", v)


class TraceCandidate(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    document_kind: str = "pdf"
    page_number: int
    section_title: str | None
    char_start: int | None = None
    char_end: int | None = None
    snippet: str
    vector_rank: int | None
    keyword_rank: int | None
    vector_similarity: float | None
    fused_score: float
    rerank_score: float | None
    selected: bool
    marker: str | None
    support: Literal["ok", "low"] | None = None


class TracePlanner(BaseModel):
    llm_called: bool
    cached: bool
    error: str | None


class TraceOut(BaseModel):
    """How an answer was retrieved: queries searched, every candidate's scores, timings, tokens."""
    message_id: uuid.UUID
    question: str
    standalone_query: str
    variants: list[str]
    hypothetical: str | None
    planner: TracePlanner
    document_ids: list[str] | None
    features: dict[str, bool]
    candidates: list[TraceCandidate]
    reranked: bool
    confidence: Confidence | None
    top_score: float | None
    abstained: bool
    timings_ms: dict[str, float]
    total_ms: float
    tokens: dict[str, dict | None]
    citation_coverage: float | None = None
    cached: bool = False  # answered from the answer cache; the timings are the original answer's


# --- Study sets -----------------------------------------------------------

QUIZ_COUNTS = (5, 10, 15)
FLASHCARD_COUNTS = (10, 20, 30)


class StudySetCreate(BaseModel):
    kind: Literal["quiz", "flashcards"]
    count: int
    topic: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    document_ids: list[uuid.UUID] | None = None

    @field_validator("topic")
    @classmethod
    def _empty_topic_is_none(cls, v: str | None) -> str | None:
        return v or None

    @model_validator(mode="after")
    def _count_for_kind(self):
        allowed = QUIZ_COUNTS if self.kind == "quiz" else FLASHCARD_COUNTS
        if self.count not in allowed:
            raise ValueError(f"count must be one of {', '.join(map(str, allowed))} for {self.kind}")
        return self


class StudySetSummary(ORMModel):
    id: uuid.UUID
    notebook_id: uuid.UUID
    kind: Literal["quiz", "flashcards"]
    title: str
    topic: str | None
    item_count: int
    last_score: int | None
    created_at: datetime

    @field_validator("kind", mode="before")
    @classmethod
    def _enum_value(cls, v):
        return getattr(v, "value", v)


class StudySetOut(StudySetSummary):
    document_ids: list[uuid.UUID]
    items: list[dict]


class ScoreIn(BaseModel):
    score: Annotated[int, Field(ge=0)]
