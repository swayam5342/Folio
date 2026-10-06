import re

import pymupdf

from app.services.ocr import ocr_page

# A page whose text layer has fewer real characters than this is treated as
# scanned (blank apart from a page number or header) and read with OCR instead.
MIN_TEXT_CHARS = 20

# Control characters other than tab, newline and carriage return. PDFs emit them for
# glyphs with no Unicode mapping (often in math fonts), and PostgreSQL text columns
# reject NUL outright, which would fail the whole document.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(text: str) -> str:
    return _CONTROL_CHARS.sub("", text).strip()


def extract_pages_from_pdf(file_bytes: bytes) -> tuple[int, list[dict], int]:
    """
    Extracts text per page from a PDF, falling back to OCR for pages with no text layer.
    Returns (total_page_count, [{"page_number": 1, "text": "..."}, ...], ocr_page_count)
    with 1-indexed pages. Pages with no text even after OCR are skipped in the list
    but still counted in the total.
    """
    pages = []
    ocr_pages = 0
    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            text = _clean(page.get_text("text"))
            if len("".join(text.split())) < MIN_TEXT_CHARS:
                ocr_text = _clean(ocr_page(page))
                if len("".join(ocr_text.split())) > len("".join(text.split())):
                    text = ocr_text
                    ocr_pages += 1
            if text:
                pages.append({"page_number": i + 1, "text": text})
        return doc.page_count, pages, ocr_pages
