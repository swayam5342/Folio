"""PDF → text per page, plus the layout cues structure-aware chunking needs.

Each page's text is split into blocks (PyMuPDF's paragraphs) labelled
"heading", "code" or "body". Headings are told apart from body text by font:
noticeably larger than the document's body size, or short and entirely bold.
Code is text set entirely in a monospaced font.
"""
import logging
from collections import Counter

import pymupdf

from app.services.ocr import ocr_page

log = logging.getLogger(__name__)

# A page whose text layer has fewer real characters than this is treated as
# scanned (blank apart from a page number or header) and read with OCR instead.
MIN_TEXT_CHARS = 20

HEADING_SIZE_RATIO = 1.15  # a span this much larger than body text reads as a heading
MAX_HEADING_CHARS = 120
MAX_HEADING_LINES = 3
MIN_TABLE_FILL = 0.6  # share of a detected table's cells that must hold text

_BOLD = 1 << 4
_MONOSPACED = 1 << 3

# Expand ligatures ("ﬁ" → "fi") so keyword search matches words such as "find" and "office";
# skip images, which only the OCR path needs.
_TEXT_FLAGS = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_LIGATURES & ~pymupdf.TEXT_PRESERVE_IMAGES


def _visible_chars(text: str) -> int:
    return len("".join(text.split()))


def _read_blocks(page: pymupdf.Page) -> list[dict]:
    """Text blocks of a page in reading order: [{"text", "size", "bold", "mono"}]."""
    blocks = []
    # Content-stream order, as get_text("text") uses: sorting by position would interleave columns.
    for block in page.get_text("dict", flags=_TEXT_FLAGS)["blocks"]:
        if block.get("type") != 0:
            continue  # image block
        lines: list[str] = []
        spans: list[dict] = []
        for line in block["lines"]:
            text = "".join(span["text"] for span in line["spans"])
            if text.strip():
                lines.append(text.rstrip())
                spans.extend(s for s in line["spans"] if s["text"].strip())
        if not lines:
            continue
        blocks.append({
            "text": "\n".join(lines).strip(),
            "bbox": block["bbox"],
            "lines": len(lines),
            "size": max(s["size"] for s in spans),
            "bold": all(s["flags"] & _BOLD for s in spans),
            "mono": all(s["flags"] & _MONOSPACED for s in spans),
            "chars": [(round(s["size"], 1), _visible_chars(s["text"])) for s in spans],
        })
    return blocks


def _looks_like_table(table) -> bool:
    """PyMuPDF also "finds" tables in boxed code and shaded lines: keep only real grids,
    at least 2x2 with most cells filled."""
    if table.row_count < 2 or table.col_count < 2:
        return False
    try:
        cells = [cell for row in table.extract() for cell in row]
    except Exception:
        return False
    filled = sum(1 for cell in cells if cell and cell.strip())
    return filled >= MIN_TABLE_FILL * len(cells)


def _with_tables(page: pymupdf.Page, blocks: list[dict]) -> list[dict]:
    """Replace the text blocks inside each detected table with one Markdown "table" block,
    placed where the table's first block was. Any failure keeps the blocks as they are."""
    try:
        tables = page.find_tables().tables
    except Exception:
        log.warning("table detection failed on page %d", page.number + 1, exc_info=True)
        return blocks
    for table in tables:
        if not _looks_like_table(table):
            continue
        try:
            markdown = table.to_markdown(clean=False).strip()
        except Exception:
            continue
        if not markdown:
            continue
        x0, y0, x1, y1 = table.bbox

        def inside(block: dict, x0=x0, y0=y0, x1=x1, y1=y1) -> bool:
            bx0, by0, bx1, by1 = block["bbox"]
            return x0 <= (bx0 + bx1) / 2 <= x1 and y0 <= (by0 + by1) / 2 <= y1

        covered = [i for i, block in enumerate(blocks) if block.get("bbox") and inside(block)]
        if covered and all(blocks[i].get("mono") for i in covered):
            continue  # a shaded code listing, not a table
        if covered:
            at = covered[0]
        else:  # no text block inside (rare): place it by its top edge
            at = next((i for i, b in enumerate(blocks) if b.get("bbox") and b["bbox"][1] >= y0), len(blocks))
        kept = [b for i, b in enumerate(blocks) if i not in set(covered)]
        at -= sum(1 for i in covered if i < at)
        kept.insert(at, {"kind": "table", "text": markdown, "chars": []})
        blocks = kept
    return blocks


def body_font_size(blocks: list[dict]) -> float:
    """The font size covering the most characters: what ordinary paragraphs use."""
    weights: Counter[float] = Counter()
    for block in blocks:
        for size, chars in block["chars"]:
            weights[size] += chars
    return weights.most_common(1)[0][0] if weights else 0.0


def classify_block(block: dict, body_size: float) -> str:
    """'heading', 'code' or 'body' for one block."""
    text = block["text"]
    if block["mono"]:
        return "code"
    looks_like_title = (
        block["lines"] <= MAX_HEADING_LINES
        and len(text) <= MAX_HEADING_CHARS
        and any(c.isalpha() for c in text)
        and not text.rstrip().endswith((".", ",", ";"))
    )
    if looks_like_title and body_size and (
        block["size"] >= body_size * HEADING_SIZE_RATIO or (block["bold"] and block["size"] >= body_size * 0.95)
    ):
        return "heading"
    return "body"


def extract_pages_from_pdf(file_bytes: bytes) -> tuple[int, list[dict], int]:
    """
    Extracts text per page from a PDF, falling back to OCR for pages with no text layer.
    Returns (total_page_count, pages, ocr_page_count) with 1-indexed pages, where each page is
    {"page_number": 1, "text": "...", "blocks": [{"kind": "heading"|"body"|"code"|"table", "text": "..."}]}.
    Tables found by PyMuPDF become one Markdown "table" block in place of their text blocks.
    A page's text is its block texts joined by newlines. Pages with no text even after OCR are
    skipped in the list but still counted in the total. OCR'd pages are a single body block.
    """
    raw_pages: list[tuple[int, list[dict] | None, str]] = []
    ocr_pages = 0
    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        page_count = doc.page_count
        for i, page in enumerate(doc):
            blocks = _read_blocks(page)
            text = "\n".join(b["text"] for b in blocks)
            if _visible_chars(text) >= MIN_TEXT_CHARS:
                blocks = _with_tables(page, blocks)
                text = "\n".join(b["text"] for b in blocks)
            else:
                ocr_text = ocr_page(page).strip()
                if _visible_chars(ocr_text) > _visible_chars(text):
                    raw_pages.append((i + 1, None, ocr_text))
                    ocr_pages += 1
                    continue
            if text:
                raw_pages.append((i + 1, blocks, text))

    body_size = body_font_size([b for _, page_blocks, _ in raw_pages if page_blocks for b in page_blocks])
    pages = []
    for page_number, page_blocks, text in raw_pages:
        if page_blocks is None:
            typed = [{"kind": "body", "text": text}]
        else:
            typed = [{"kind": b.get("kind") or classify_block(b, body_size), "text": b["text"]} for b in page_blocks]
        pages.append({"page_number": page_number, "text": text, "blocks": typed})
    return page_count, pages, ocr_pages
