import enum
import uuid
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Column, Computed, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import deferred, relationship

from app.config import settings
from app.database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class DocumentStatus(str, enum.Enum):
    processing = "processing"
    ready = "ready"
    failed = "failed"


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"


class StudyKind(str, enum.Enum):
    quiz = "quiz"
    flashcards = "flashcards"
    # "Studio" outputs: written documents built from the sources, every item cited.
    study_guide = "study_guide"
    faq = "faq"
    timeline = "timeline"
    glossary = "glossary"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(32), nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebooks = relationship("Notebook", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)


class Notebook(Base):
    __tablename__ = "notebooks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    pii_redaction_enabled = Column(Boolean, nullable=False, default=False)

    user = relationship("User", back_populates="notebooks")
    documents = relationship("Document", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)
    messages = relationship("Message", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)
    threads = relationship("Thread", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)
    notes = relationship("Note", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)
    study_sets = relationship("StudySet", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)

    def touch(self) -> None:
        self.updated_at = utcnow()


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    # pdf | docx | pptx | txt | md | text (pasted); see services/extractors.py
    kind = Column(String(8), nullable=False, default="pdf", server_default="pdf")
    storage_path = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    page_count = Column(Integer, nullable=False, default=0)
    ocr_pages = Column(Integer, nullable=False, default=0)
    status = Column(
        Enum(DocumentStatus, native_enum=False, length=16),
        nullable=False,
        default=DocumentStatus.processing,
    )
    error = Column(Text, nullable=True)
    # How the current chunks were made ("fixed" / "structured"); null for documents indexed before v2.
    chunk_strategy = Column(String(16), nullable=True)
    risk_score = Column(Integer, nullable=False, default=0)
    risk_reasons = Column(JSONB, nullable=False, default=list)
    pii_summary = Column(JSONB, nullable=False, default=dict)
    summary = Column(Text, nullable=True)  # short LLM overview, written after indexing
    suggested_questions = Column(JSONB, nullable=False, default=list)  # written with the summary
    summary_status = Column(String(16), nullable=True)  # pending | done | failed; null = not attempted
    indexed_at = Column(DateTime(timezone=True), nullable=True)  # when the current chunks were stored
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="documents")
    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan", passive_deletes=True)

    @property
    def progress(self) -> dict | None:
        """Live indexing progress while processing (see services/progress.py)."""
        from app.services import progress

        return progress.get(self.id) if self.status == DocumentStatus.processing else None


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    page_number = Column(Integer, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    section_title = Column(Text, nullable=True)  # heading the chunk sits under (structured chunking)
    char_start = Column(Integer, nullable=True)  # position within the page's extracted text
    char_end = Column(Integer, nullable=True)
    risk_score = Column(Integer, nullable=False, default=0)
    risk_reasons = Column(JSONB, nullable=False, default=list)
    quarantined = Column(Boolean, nullable=False, default=False)
    embedding = Column(Vector(settings.EMBEDDING_DIM))
    # Maintained by Postgres for keyword search; never loaded or written by the app.
    content_tsv = deferred(Column(TSVECTOR, Computed("to_tsvector('english', content)", persisted=True)))

    document = relationship("Document", back_populates="chunks")


class Thread(Base):
    """One conversation in a notebook; a notebook can have several."""
    __tablename__ = "threads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="threads")
    messages = relationship("Message", back_populates="thread", cascade="all, delete-orphan", passive_deletes=True)


class Note(Base):
    """A saved answer (with its citations) or a note the user wrote."""
    __tablename__ = "notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)  # markdown; [[Cn]] markers index into sources
    sources = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="notes")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum(MessageRole, native_enum=False, length=16), nullable=False)
    content = Column(Text, nullable=False)
    sources = Column(JSONB, nullable=False, default=list)
    confidence = Column(String(8), nullable=True)  # high | medium | low, for answers
    abstained = Column(Boolean, nullable=False, default=False)
    # Retrieval trace ("How was this answered?"); large, so only loaded by the trace endpoint.
    trace = deferred(Column(JSONB, nullable=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="messages")
    thread = relationship("Thread", back_populates="messages")


class AnswerCache(Base):
    """A stored answer, reused when the same standalone question is asked over the same sources."""
    __tablename__ = "answer_cache"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False)
    key = Column(String(64), nullable=False)  # see services/answer_cache.cache_key
    answer = Column(Text, nullable=False)
    sources = Column(JSONB, nullable=False, default=list)
    confidence = Column(String(8), nullable=True)
    trace = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class StudySet(Base):
    __tablename__ = "study_sets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(Enum(StudyKind, native_enum=False, length=16), nullable=False)
    title = Column(String(120), nullable=False)
    topic = Column(Text, nullable=True)
    document_ids = Column(JSONB, nullable=False, default=list)
    items = Column(JSONB, nullable=False, default=list)
    last_score = Column(Integer, nullable=True)
    difficulty = Column(String(8), nullable=True)  # quizzes: easy | medium | hard
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="study_sets")

    @property
    def item_count(self) -> int:
        return len(self.items or [])
