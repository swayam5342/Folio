"""
Builds a prompt that forces the model to cite sources with [[C<n>]] markers
tied to the retrieved chunks, streams the answer from Groq, then parses those
markers back into a structured source list (filename, page number, snippet)
for the frontend to render as clickable citations.
"""
import re
from collections.abc import AsyncIterator

import groq

from app.config import settings

CITATION_PATTERN = re.compile(r"\[\[C(\d+)\]\]")

# Models don't always follow the [[C1]] format: gpt-oss tends to emit its native
# 【C1】 / 【C1†L3】 style, others write [C1] or [[C1, C2]]. Match all of those.
_LOOSE_CITATION = re.compile(r"(?:\[\[?|【)\s*(C\d+(?:\s*[,;]\s*C?\d+)*)[^\]】\n]{0,20}?(?:\]\]?|】)")


def normalize_citations(text: str) -> str:
    """Rewrite any citation variant into canonical [[Cn]] markers."""
    def repl(m: re.Match) -> str:
        numbers = re.findall(r"\d+", m.group(1))
        return "".join(f"[[C{n}]]" for n in numbers)
    return _LOOSE_CITATION.sub(repl, text)


SYSTEM_PROMPT = """You are a research assistant answering questions about the user's uploaded sources.

Rules:
- Answer using ONLY information in the source excerpts provided with the question. If they don't contain the answer, say so plainly instead of guessing.
- After every claim, cite the excerpt(s) it came from using the marker in plain ASCII double square brackets, exactly like [[C1]] or [[C1]][[C2]]. Do not use any other citation style (no 【】, no footnotes).
- Only use markers listed with the current question; never invent markers.
- Earlier conversation turns are context for follow-up questions only; their facts must still be backed by the current excerpts to be cited.
- Be concise and direct. Use short paragraphs or bullet lists when they help."""


class LLMError(Exception):
    def __init__(self, detail: str, retry_after: int | None = None):
        super().__init__(detail)
        self.detail = detail
        self.retry_after = retry_after


class RateLimited(LLMError):
    def __init__(self, retry_after: int | None):
        wait = f" Try again in {retry_after} seconds." if retry_after else " Try again shortly."
        super().__init__("The AI service is rate limited (free tier)." + wait, retry_after)


def build_context(retrieved: list[dict]) -> tuple[str, dict]:
    context_blocks = []
    citation_map = {}

    for i, item in enumerate(retrieved, start=1):
        chunk = item["chunk"]
        document = item["document"]
        marker = f"C{i}"
        citation_map[marker] = {
            "chunk_id": str(chunk.id),
            "document_id": str(document.id),
            "filename": document.filename,
            "page_number": chunk.page_number,
            "snippet": chunk.content[:240],
        }
        context_blocks.append(
            f'[{marker}] (from "{document.filename}", page {chunk.page_number})\n{chunk.content}'
        )

    return "\n\n---\n\n".join(context_blocks), citation_map


def build_messages(question: str, context: str, history: list[tuple[str, str]]) -> list[dict]:
    """history: [(role, content), ...] oldest first. Old citation markers are stripped
    because they refer to excerpts that aren't in this prompt."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for role, content in history:
        messages.append({"role": role, "content": CITATION_PATTERN.sub("", content).strip()})
    messages.append({
        "role": "user",
        "content": f"Source excerpts:\n{context}\n\nQuestion: {question}",
    })
    return messages


def parse_citations(answer_text: str, citation_map: dict) -> list[dict]:
    """answer_text must already be normalized with normalize_citations."""
    used_markers = sorted(set(CITATION_PATTERN.findall(answer_text)), key=int)
    return [citation_map[f"C{n}"] for n in used_markers if f"C{n}" in citation_map]


def _retry_after(exc: groq.APIStatusError) -> int | None:
    value = exc.response.headers.get("retry-after")
    try:
        return max(1, round(float(value))) if value else None
    except ValueError:
        return None


async def stream_answer(messages: list[dict]) -> AsyncIterator[str]:
    """Yields answer text pieces. Raises LLMError (or RateLimited) with a user-safe message."""
    client = groq.AsyncGroq(api_key=settings.GROQ_API_KEY, max_retries=0)
    try:
        stream = await client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            max_tokens=4096,  # reasoning models (e.g. gpt-oss) spend part of this on thinking
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and (text := chunk.choices[0].delta.content):
                yield text
    except groq.RateLimitError as exc:
        raise RateLimited(_retry_after(exc)) from exc
    except groq.AuthenticationError as exc:
        raise LLMError("The AI service rejected the API key — check GROQ_API_KEY.") from exc
    except groq.APIStatusError as exc:
        raise LLMError(f"The AI service returned an error ({exc.status_code}). Please try again.") from exc
    except groq.APIConnectionError as exc:
        raise LLMError("Couldn't reach the AI service. Check your internet connection.") from exc
    finally:
        await client.close()
