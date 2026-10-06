"""
Generates quizzes and flashcard decks from a notebook's sources.

Everything sent to the model has to fit Groq's free tier (8,000 tokens per
minute), so a set is written from a bounded selection of excerpts rather than
whole documents. Excerpts are labelled C1..Cn exactly like chat, each item must
cite one, and items that don't validate are dropped.
"""
import asyncio
import json
import random
import uuid

from pydantic import BaseModel, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk, Document, StudyKind
from app.services import llm
from app.services.embeddings import embed_query
from app.services.retrieval import similarity_search

MAX_EXCERPTS = 18
# Excerpt budgets keep one generation under the free tier's 8,000 tokens/minute.
# Quizzes get less source text because they use more reasoning (to get the answer key right).
EXCERPT_CHARS = {StudyKind.quiz: 12_000, StudyKind.flashcards: 16_000}
REASONING = {StudyKind.quiz: "medium", StudyKind.flashcards: "low"}

SYSTEM_PROMPT = """You write study material for a student, strictly from the source excerpts provided.

Rules:
- Every item must be answerable from ONE excerpt, and must cite it in "cite" as the excerpt's label, e.g. "C3".
- Use only facts stated in the excerpts. Never invent facts, numbers or examples.
- Spread items across different excerpts; don't repeat the same fact.
- Write clearly for a university student revising for an exam.
- Reply with JSON only, in exactly the shape requested."""

QUIZ_SHAPE = """{"title": "<short title for this quiz, max 8 words>",
 "items": [{"question": "<question>",
            "options": ["<option>", "<option>", "<option>", "<option>"],
            "answer_index": <0-3, index of the single correct option>,
            "explanation": "<one sentence on why the answer is correct>",
            "cite": "C<n>"}]}"""

FLASHCARD_SHAPE = """{"title": "<short title for this deck, max 8 words>",
 "items": [{"front": "<a term or a short question>",
            "back": "<the answer, at most two sentences>",
            "cite": "C<n>"}]}"""


class GenerationFailed(Exception):
    """Too few usable items came back (message is safe to show)."""


class _QuizItem(BaseModel):
    question: str
    options: list[str]
    answer_index: int
    explanation: str
    cite: str

    @field_validator("question", "explanation", "cite")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("blank")
        return v.strip()

    @field_validator("options")
    @classmethod
    def _four_distinct(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v]
        if len(cleaned) != 4 or any(not o for o in cleaned) or len({o.lower() for o in cleaned}) != 4:
            raise ValueError("need 4 distinct options")
        return cleaned

    @field_validator("answer_index")
    @classmethod
    def _in_range(cls, v: int) -> int:
        if not 0 <= v <= 3:
            raise ValueError("answer_index out of range")
        return v


class _FlashcardItem(BaseModel):
    front: str
    back: str
    cite: str

    @field_validator("front", "back", "cite")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("blank")
        return v.strip()


async def select_excerpts(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    document_ids: list[uuid.UUID],
    topic: str | None,
    max_chars: int,
) -> list[dict]:
    """Chunks to write from, as [{"chunk", "document"}] in reading order, within the size budget."""
    if topic:
        embedding = await asyncio.to_thread(embed_query, topic)
        picked = await similarity_search(
            db, notebook_id, topic, embedding, top_k=MAX_EXCERPTS, document_ids=document_ids, candidates=40
        )
    else:
        # An even spread across all selected material, so the set covers it start to end.
        rows = (await db.execute(
            select(Chunk.id)
            .join(Document, Chunk.document_id == Document.id)
            .where(Chunk.document_id.in_(document_ids))
            .order_by(Document.created_at, Chunk.page_number, Chunk.chunk_index)
        )).scalars().all()
        k = min(MAX_EXCERPTS, len(rows))
        ids = [rows[i * len(rows) // k] for i in range(k)] if k else []
        result = (await db.execute(
            select(Chunk, Document).join(Document, Chunk.document_id == Document.id).where(Chunk.id.in_(ids))
        )).all()
        picked = [{"chunk": c, "document": d} for c, d in result]

    picked.sort(key=lambda r: (r["document"].created_at, r["chunk"].page_number, r["chunk"].chunk_index))
    selected, used = [], 0
    for row in picked:
        size = len(row["chunk"].content)
        if selected and used + size > max_chars:
            break
        selected.append(row)
        used += size
    return selected


def _build_messages(kind: StudyKind, count: int, topic: str | None, context: str) -> list[dict]:
    if kind == StudyKind.quiz:
        task = (
            f"Write exactly {count} multiple-choice questions. Each has exactly 4 options with one correct answer; "
            "wrong options must be plausible but clearly wrong according to the excerpt. "
            "Ask positive questions only: never 'which is NOT', 'EXCEPT' or 'which is false'. "
            "No 'all of the above' or 'none of the above'. "
            "The four options must differ in meaning, not just in wording or order. "
            "Before answering, check each question against its excerpt: exactly one option must be correct."
        )
        shape = QUIZ_SHAPE
    else:
        task = (
            f"Write exactly {count} flashcards. The front is a key term or a short question; "
            "the back answers it in at most two sentences."
        )
        shape = FLASHCARD_SHAPE
    focus = f"\nFocus on: {topic}" if topic else ""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Source excerpts:\n{context}\n\n{task}{focus}\n\nReply with JSON in this shape:\n{shape}"},
    ]


def _validate(raw: str, kind: StudyKind, citation_map: dict) -> tuple[str, list[dict]]:
    """Parse the model's JSON; keep only items that are well-formed and cite a real excerpt."""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object")
    model = _QuizItem if kind == StudyKind.quiz else _FlashcardItem
    items = []
    for candidate in data.get("items") or []:
        try:
            item = model.model_validate(candidate)
        except ValidationError:
            continue
        source = citation_map.get(item.cite.strip("[] "))
        if source is None:
            continue
        if isinstance(item, _QuizItem):
            # Shuffle so the correct answer isn't always in the position the model favours.
            order = list(range(4))
            random.shuffle(order)
            items.append({
                "question": item.question,
                "options": [item.options[i] for i in order],
                "answer_index": order.index(item.answer_index),
                "explanation": item.explanation,
                "source": source,
            })
        else:
            items.append({"front": item.front, "back": item.back, "source": source})
    title = str(data.get("title") or "").strip()[:120]
    return title, items


async def generate(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    kind: StudyKind,
    count: int,
    topic: str | None,
    document_ids: list[uuid.UUID],
) -> tuple[str, list[dict]]:
    """Returns (title, items). Raises llm.LLMError / llm.RateLimited, or GenerationFailed."""
    excerpts = await select_excerpts(db, notebook_id, document_ids, topic, EXCERPT_CHARS[kind])
    if not excerpts:
        raise GenerationFailed("The selected sources have no text to study from.")
    context, citation_map = llm.build_context(excerpts)
    messages = _build_messages(kind, count, topic, context)

    title, items = "", []
    for attempt in range(2):  # one retry if the JSON is broken
        try:
            raw = await llm.complete_json(messages, reasoning_effort=REASONING[kind])
            title, items = _validate(raw, kind, citation_map)
            break
        except (llm.InvalidJSON, json.JSONDecodeError, ValueError):
            if attempt == 1:
                raise GenerationFailed("Couldn't generate a good set — try again.")

    if len(items) < (count + 1) // 2:
        raise GenerationFailed("Couldn't generate a good set — try again.")
    noun = "Quiz" if kind == StudyKind.quiz else "Flashcards"
    default_title = f"{noun}: {topic}" if topic else noun
    return title or default_title[:120], items[:count]
