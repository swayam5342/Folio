import pymupdf

from app.services.ocr import ocr_page

# A page whose text layer has fewer real characters than this is treated as
# scanned (blank apart from a page number or header) and read with OCR instead.
MIN_TEXT_CHARS = 20


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
            text = page.get_text("text").strip()
            if len("".join(text.split())) < MIN_TEXT_CHARS:
                ocr_text = ocr_page(page).strip()
                if len("".join(ocr_text.split())) > len("".join(text.split())):
                    text = ocr_text
                    ocr_pages += 1
            if text:
                pages.append({"page_number": i + 1, "text": text})
        return doc.page_count, pages, ocr_pages
