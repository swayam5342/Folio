import fitz  # PyMuPDF


def extract_pages_from_pdf(file_bytes: bytes) -> list[dict]:
    """
    Extracts text per page from a PDF.
    Returns [{"page_number": 1, "text": "..."}, ...] (1-indexed pages).
    Pages with no extractable text (e.g. pure images) are skipped.
    """
    pages = []
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            text = page.get_text("text").strip()
            if text:
                pages.append({"page_number": i + 1, "text": text})
    return pages
