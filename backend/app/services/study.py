"""
Generates quizzes, flashcard decks and "studio" documents (study guide, FAQ,
timeline, glossary) from a notebook's sources.

Everything sent to the model has to fit Groq's free tier (8,000 tokens per
minute), so a set is written from a bounded selection of excerpts rather than
whole documents. Excerpts are labelled C1..Cn exactly like chat, each item must
cite one, and items that don't validate are dropped.
"""
import asyncio
import json
import random
import re
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
EXCERPT_CHARS = {
    StudyKind.quiz: 12_000,
    StudyKind.flashcards: 16_000,
    StudyKind.study_guide: 16_000,
    StudyKind.faq: 14_000,
    StudyKind.timeline: 16_000,
    StudyKind.glossary: 16_000,
}
REASONING = {StudyKind.quiz: "medium"}  # everything else: "low"
NOUNS = {
    StudyKind.quiz: "Quiz",
    StudyKind.flashcards: "Flashcards",
    StudyKind.study_guide: "Study guide",
    StudyKind.faq: "FAQ",
    StudyKind.timeline: "Timeline",
    StudyKind.glossary: "Glossary",
}
DIFFICULTY = {
    "easy": "Make the questions easy: direct recall of clearly stated facts and definitions.",
    "medium": "Mix recall questions with some that need understanding of how ideas connect.",
    "hard": (
        "Make the questions hard: application, comparison and multi-step reasoning, with distractors "
        "that a student who only skimmed would find convincing - but still answerable from one excerpt."
    ),
}

SYSTEM_PROMPT = """You write study material for a student, strictly from the source excerpts provided.

Rules:
- Every item must be answerable from ONE excerpt, and must cite it in "cite" as the excerpt's label, e.g. "C3".
- Use only facts stated in the excerpts. Never invent facts, numbers or examples.
- Spread items across different excerpts; don't repeat the same fact.
- Write clearly for a university student revising for an exam.
- Never mention excerpt labels (C1, C2, ...) or "the excerpt" in any text the student reads; labels belong only in "cite".
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


STUDY_GUIDE_SHAPE = """{"title": "<short title for this study guide, max 8 words>",
 "items": [{"heading": "<topic heading>",
            "body": "<3-5 sentences explaining the topic for revision>",
            "cite": "C<n>"}]}"""

FAQ_SHAPE = """{"title": "<short title for this FAQ, max 8 words>",
 "items": [{"question": "<a question a student would ask>",
            "answer": "<the answer, 1-3 sentences>",
            "cite": "C<n>"}]}"""

TIMELINE_SHAPE = """{"title": "<short title for this timeline, max 8 words>",
 "items": [{"when": "<date, year, period or step number exactly as the excerpt gives it>",
            "event": "<what happened, one sentence>",
            "cite": "C<n>"}]}"""

GLOSSARY_SHAPE = """{"title": "<short title for this glossary, max 8 words>",
 "items": [{"term": "<term>",
            "definition": "<definition in one or two sentences>",
            "cite": "C<n>"}]}"""

# Per studio kind: (task instruction, JSON shape, the item's text fields).
STUDIO = {
    StudyKind.study_guide: (
        "Write a study guide of exactly {count} sections covering the most important topics, in a sensible "
        "learning order. Each section explains one topic from one excerpt.",
        STUDY_GUIDE_SHAPE,
        ("heading", "body"),
    ),
    StudyKind.faq: (
        "Write exactly {count} frequently asked questions with answers, covering what a student is most likely "
        "to ask about this material.",
        FAQ_SHAPE,
        ("question", "answer"),
    ),
    StudyKind.timeline: (
        "Write a timeline of up to {count} events or steps, in chronological (or procedural) order. Only include "
        "events whose date, period or order the excerpt actually states; if there are fewer, return fewer.",
        TIMELINE_SHAPE,
        ("when", "event"),
    ),
    StudyKind.glossary: (
        "Write a glossary of exactly {count} key terms with clear definitions, as the excerpts define or use them.",
        GLOSSARY_SHAPE,
        ("term", "definition"),
    ),
}


# A label the model leaked into student-facing text, e.g. "C4 states that", "excerpt C2", "[[C3]]".
_LEAKED_LABEL = re.compile(r"(?:\b(?:the\s+)?excerpt\s+)?\[{0,2}\bC\d+\b\]{0,2}", re.IGNORECASE)


def _scrub(text: str) -> str:
    """Replace leaked excerpt labels with plain words, keeping sentence case."""
    cleaned = _LEAKED_LABEL.sub("the source", text).strip()
    return cleaned[:1].upper() + cleaned[1:] if cleaned else cleaned


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


def _build_messages(kind: StudyKind, count: int, topic: str | None, context: str, difficulty: str = "medium") -> list[dict]:
    if kind in STUDIO:
        template, shape, _ = STUDIO[kind]
        task = template.format(count=count)
    elif kind == StudyKind.quiz:
        task = (
            f"Write exactly {count} multiple-choice questions. {DIFFICULTY.get(difficulty, DIFFICULTY['medium'])} "
            "Each has exactly 4 options with one correct answer; "
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
    if kind in STUDIO:
        return _validate_studio(data, kind, citation_map)
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
                "question": _scrub(item.question),
                "options": [_scrub(item.options[i]) for i in order],
                "answer_index": order.index(item.answer_index),
                "explanation": _scrub(item.explanation),
                "source": source,
            })
        else:
            items.append({"front": _scrub(item.front), "back": _scrub(item.back), "source": source})
    title = str(data.get("title") or "").strip()[:120]
    return title, items


def _validate_studio(data: dict, kind: StudyKind, citation_map: dict) -> tuple[str, list[dict]]:
    """Studio items: each text field non-blank (and scrubbed of excerpt labels), citing a real excerpt."""
    _, _, fields = STUDIO[kind]
    items = []
    for candidate in data.get("items") or []:
        if not isinstance(candidate, dict):
            continue
        values = {f: str(candidate.get(f) or "").strip() for f in fields}
        source = citation_map.get(str(candidate.get("cite") or "").strip("[] "))
        if source is None or not all(values.values()):
            continue
        items.append({**{f: _scrub(v) for f, v in values.items()}, "source": source})
    if kind == StudyKind.glossary:
        items.sort(key=lambda item: item["term"].casefold())
    title = str(data.get("title") or "").strip()[:120]
    return title, items


async def generate(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    kind: StudyKind,
    count: int,
    topic: str | None,
    document_ids: list[uuid.UUID],
    difficulty: str = "medium",
) -> tuple[str, list[dict]]:
    """Returns (title, items). Raises llm.LLMError / llm.RateLimited, or GenerationFailed."""
    excerpts = await select_excerpts(db, notebook_id, document_ids, topic, EXCERPT_CHARS[kind])
    if not excerpts:
        raise GenerationFailed("The selected sources have no text to study from.")
    context, citation_map = llm.build_context(excerpts)
    messages = _build_messages(kind, count, topic, context, difficulty)

    title, items = "", []
    for attempt in range(2):  # one retry if the JSON is broken
        try:
            raw = await llm.complete_json(messages, reasoning_effort=REASONING.get(kind, "low"))
            title, items = _validate(raw, kind, citation_map)
            break
        except (llm.InvalidJSON, json.JSONDecodeError, ValueError) as exc:
            if attempt == 1:
                raise GenerationFailed("Couldn't generate a good set — try again.") from exc

    # A timeline may legitimately be short (few dated events); everything else needs half the items.
    minimum = 3 if kind == StudyKind.timeline else (count + 1) // 2
    if len(items) < minimum:
        if kind == StudyKind.timeline:
            raise GenerationFailed("These sources don't have enough dated or ordered events for a timeline.")
        raise GenerationFailed("Couldn't generate a good set — try again.")
    noun = NOUNS[kind]
    default_title = f"{noun}: {topic}" if topic else noun
    return title or default_title[:120], items[:count]
