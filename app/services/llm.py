"""
Builds a prompt that forces the model to cite sources with [[C<n>]] markers
tied to the retrieved chunks, then parses those markers back into a
structured source list (filename, page number, snippet) for the frontend
to render as clickable citations.
"""
import re

from app.config import settings

CITATION_PATTERN = re.compile(r"\[\[C(\d+)\]\]")


def build_prompt(question: str, retrieved: list[dict]) -> tuple[str, dict]:
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

    context = "\n\n---\n\n".join(context_blocks)

    prompt = f"""You are answering a question using ONLY the source excerpts below.

Rules:
- Answer using only information present in the excerpts. If the excerpts don't contain the answer, say so plainly instead of guessing.
- After every claim, cite the excerpt(s) it came from using the marker in double brackets, e.g. [[C1]] or [[C1]][[C2]].
- Do not invent markers that aren't listed below.
- Be concise and direct.

Source excerpts:
{context}

Question: {question}

Answer:"""

    return prompt, citation_map


def parse_citations(answer_text: str, citation_map: dict) -> list[dict]:
    used_markers = sorted(set(CITATION_PATTERN.findall(answer_text)), key=int)
    return [citation_map[f"C{n}"] for n in used_markers if f"C{n}" in citation_map]


async def generate_answer(question: str, retrieved: list[dict]) -> dict:
    prompt, citation_map = build_prompt(question, retrieved)
    answer_text = await _call_groq(prompt)
    sources = parse_citations(answer_text, citation_map)
    return {"answer": answer_text, "sources": sources}


async def _call_groq(prompt: str) -> str:
    from groq import AsyncGroq

    client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    response = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,  # reasoning models (e.g. gpt-oss) spend part of this on thinking
    )
    return response.choices[0].message.content or ""
