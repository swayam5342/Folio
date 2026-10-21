"""Splitting page text into chunks for embedding and search.

Two strategies (CHUNK_STRATEGY):
- "fixed": an overlapping character window over each page (the original method).
- "structured": follows the page's layout blocks. A heading starts a new section;
  paragraphs are packed into chunks up to CHUNK_SIZE without being cut, code blocks
  stay whole (up to twice CHUNK_SIZE), tables (Markdown) are chunks of their own, split
  by rows with the header repeated when large, and only a paragraph too long for one chunk
  falls back to the overlapping window. Every chunk records its section title, so the
  title can be embedded with it ("contextual chunks").

Chunks never cross pages, so every citation points at exactly one page. char_start
and char_end locate the chunk within the page's extracted text.
"""
from collections.abc import Iterator

from app.config import settings

MAX_SECTION_TITLE = 200


def _windows(text: str, size: int, overlap: int) -> Iterator[tuple[int, int, str]]:
    """Overlapping windows over text as (start, end, stripped piece); blank pieces skipped."""
    step = max(size - overlap, 1)  # guards against an infinite loop if overlap >= size
    start = 0
    while start < len(text):
        raw = text[start:start + size]
        piece = raw.strip()
        if piece:
            lead = len(raw) - len(raw.lstrip())
            yield start + lead, start + lead + len(piece), piece
        start += step


def _resolve(chunk_size: int | None, overlap: int | None) -> tuple[int, int]:
    size = chunk_size or settings.CHUNK_SIZE
    return size, settings.CHUNK_OVERLAP if overlap is None else overlap  # 0 is a valid overlap


def chunk_pages(pages: list[dict], chunk_size: int | None = None, overlap: int | None = None) -> list[dict]:
    """
    Splits each page's text into overlapping chunks (character-based, a
    reasonable proxy for tokens). Every chunk keeps its source page_number
    so answers can cite back to an exact page.

    Returns: [{"page_number", "chunk_index", "content", "section_title": None, "char_start", "char_end"}, ...]
    """
    size, overlap = _resolve(chunk_size, overlap)
    chunks: list[dict] = []
    for page in pages:
        for start, end, piece in _windows(page["text"], size, overlap):
            chunks.append({
                "page_number": page["page_number"],
                "chunk_index": len(chunks),
                "content": piece,
                "section_title": None,
                "char_start": start,
                "char_end": end,
            })
    return chunks


def _title(text: str) -> str:
    return " ".join(text.split())[:MAX_SECTION_TITLE]


def assemble_pages(pages: list[dict], sep: str) -> list[dict]:
    """Build each page's text from its blocks joined by sep, recording every block's
    [start, end) in that text. Chunk offsets and the viewer's highlights rely on these."""
    for page in pages:
        pos = 0
        for i, block in enumerate(page["blocks"]):
            if i:
                pos += len(sep)
            block["start"] = pos
            pos += len(block["text"])
            block["end"] = pos
        page["text"] = sep.join(block["text"] for block in page["blocks"])
    return pages


def _table_pieces(table: str, size: int) -> Iterator[tuple[int, int, str]]:
    """A Markdown table split into row groups of about size characters, each repeating the
    header. Offsets cover the piece's own rows, so a highlight lands on them."""
    lines = table.split("\n")
    starts = []
    pos = 0
    for line in lines:
        starts.append(pos)
        pos += len(line) + 1
    has_rule = len(lines) > 2 and set(lines[1].replace(" ", "")) <= set("|-:")
    head = 2 if has_rule else 1
    header = "\n".join(lines[:head])
    i = head
    while i < len(lines):
        j = i + 1  # at least one row per piece, even an oversized one
        while j < len(lines) and starts[j] + len(lines[j]) - starts[i] + len(header) + 1 <= size:
            j += 1
        start, end = starts[i], starts[j - 1] + len(lines[j - 1])
        yield start, end, f"{header}\n{table[start:end]}"
        i = j


class _StructuredChunker:
    """Walks pages in order, carrying the current section title across page breaks."""

    def __init__(self, size: int, overlap: int) -> None:
        self.size, self.overlap = size, overlap
        self.chunks: list[dict] = []
        self.section: str | None = None
        self.page: dict = {}
        self.buffer: list[tuple[int, int, str]] = []  # (start, end, kind) of blocks waiting to form one chunk

    def emit(self, start: int, end: int, content: str) -> None:
        self.chunks.append({
            "page_number": self.page["page_number"],
            "chunk_index": len(self.chunks),
            "content": content,
            "section_title": self.section,
            "char_start": start,
            "char_end": end,
        })

    def flush(self, drop_lone_heading: bool = False) -> None:
        if not self.buffer:
            return
        # A heading with nothing after it adds nothing: its title travels with the next chunks.
        if not (drop_lone_heading and len(self.buffer) == 1 and self.buffer[0][2] == "heading"):
            start, end = self.buffer[0][0], self.buffer[-1][1]
            self.emit(start, end, self.page["text"][start:end])
        self.buffer.clear()

    def add_page(self, page: dict) -> None:
        self.page = page
        blocks = page.get("blocks") or [{"kind": "body", "text": page["text"], "start": 0, "end": len(page["text"])}]
        for block in blocks:
            text, kind = block["text"], block["kind"]
            start, end = block["start"], block["end"]  # set by assemble_pages

            if kind == "heading":
                self.flush()
                self.section = _title(text)
                self.buffer.append((start, end, kind))
                continue

            if kind == "table":
                # Tables stand alone: never merged into prose, split by rows (header repeated) when large.
                self.flush(drop_lone_heading=True)
                if len(text) <= self.size * 2:
                    self.emit(start, end, text)
                else:
                    for s, e, piece in _table_pieces(text, self.size):
                        self.emit(start + s, start + e, piece)
                continue

            if len(text) > (self.size * 2 if kind == "code" else self.size):
                self.flush(drop_lone_heading=True)
                for s, e, piece in _windows(text, self.size, self.overlap):
                    self.emit(start + s, start + e, piece)
                continue

            only_heading = len(self.buffer) == 1 and self.buffer[0][2] == "heading"  # keep a heading with its first block
            if self.buffer and not only_heading and end - self.buffer[0][0] > self.size:
                self.flush()
            self.buffer.append((start, end, kind))
            if kind == "code" and len(text) > self.size:
                self.flush()  # an oversized code block is its own chunk
        self.flush(drop_lone_heading=True)


def chunk_structured(pages: list[dict], chunk_size: int | None = None, overlap: int | None = None) -> list[dict]:
    """Section- and paragraph-aware chunks from pages carrying "blocks" (see pdf_parser).

    Same output shape as chunk_pages, with section_title set once a heading has been seen.
    Pages without blocks are treated as one body block."""
    chunker = _StructuredChunker(*_resolve(chunk_size, overlap))
    for page in pages:
        chunker.add_page(page)
    return chunker.chunks


def chunk_document(pages: list[dict], strategy: str | None = None) -> list[dict]:
    """Chunks with the given strategy (default: CHUNK_STRATEGY)."""
    if (strategy or settings.CHUNK_STRATEGY) == "structured":
        return chunk_structured(pages)
    return chunk_pages(pages)


def embedding_text(chunk: dict) -> str:
    """What gets embedded: the chunk prefixed with its section title, when it has one."""
    title = chunk.get("section_title")
    if title and not chunk["content"].startswith(title):
        return f"{title}\n\n{chunk['content']}"
    return chunk["content"]
