from app.config import settings


def chunk_pages(pages: list[dict], chunk_size: int = None, overlap: int = None) -> list[dict]:
    """
    Splits each page's text into overlapping chunks (character-based, a
    reasonable proxy for tokens). Every chunk keeps its source page_number
    so answers can cite back to an exact page.

    Returns: [{"page_number": int, "chunk_index": int, "content": str}, ...]
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE
    overlap = overlap or settings.CHUNK_OVERLAP
    step = max(chunk_size - overlap, 1)  # guards against infinite loop if overlap >= chunk_size

    chunks = []
    chunk_index = 0

    for page in pages:
        text = page["text"]
        start = 0
        while start < len(text):
            end = start + chunk_size
            piece = text[start:end].strip()
            if piece:
                chunks.append({
                    "page_number": page["page_number"],
                    "chunk_index": chunk_index,
                    "content": piece,
                })
                chunk_index += 1
            start += step

    return chunks
