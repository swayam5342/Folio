import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, Computed, String, Integer, ForeignKey, DateTime, Text, Enum
from sqlalchemy.dialects.postgresql import UUID, JSONB, TSVECTOR
from sqlalchemy.orm import deferred, relationship
from pgvector.sqlalchemy import Vector

from app.database import Base
from app.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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

    user = relationship("User", back_populates="notebooks")
    documents = relationship("Document", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)
    messages = relationship("Message", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)
    study_sets = relationship("StudySet", back_populates="notebook", cascade="all, delete-orphan", passive_deletes=True)

    def touch(self) -> None:
        self.updated_at = utcnow()


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
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
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="documents")
    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan", passive_deletes=True)


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    page_number = Column(Integer, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(settings.EMBEDDING_DIM))
    # Maintained by Postgres for keyword search; never loaded or written by the app.
    content_tsv = deferred(Column(TSVECTOR, Computed("to_tsvector('english', content)", persisted=True)))

    document = relationship("Document", back_populates="chunks")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum(MessageRole, native_enum=False, length=16), nullable=False)
    content = Column(Text, nullable=False)
    sources = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="messages")


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
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    notebook = relationship("Notebook", back_populates="study_sets")

    @property
    def item_count(self) -> int:
        return len(self.items or [])
