import pymupdf


def extract_pages_from_pdf(file_bytes: bytes) -> tuple[int, list[dict]]:
    """
    Extracts text per page from a PDF.
    Returns (total_page_count, [{"page_number": 1, "text": "..."}, ...]) with
    1-indexed pages. Pages with no extractable text (e.g. pure images) are
    skipped in the list but still counted in the total.
    """
    pages = []
    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            text = page.get_text("text").strip()
            if text:
                pages.append({"page_number": i + 1, "text": text})
        return doc.page_count, pages
