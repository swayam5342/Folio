"""OCR for PDF pages that have no text layer (scans, slides exported as images)."""
import threading

import pymupdf

OCR_DPI = 200

_engine = None
_lock = threading.Lock()


def _get_engine():
    """Lazy, process-wide RapidOCR instance (models ship inside the package, so it works offline)."""
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR

                _engine = RapidOCR()
    return _engine


def ocr_page(page: pymupdf.Page) -> str:
    """Render one page and return its recognised text, top-to-bottom, left-to-right."""
    png = page.get_pixmap(dpi=OCR_DPI).tobytes("png")
    result, _ = _get_engine()(png)
    if not result:
        return ""
    # Each result is [box(4 corner points), text, confidence]; order by the box's top-left corner,
    # treating boxes within ~half a text line of each other as the same line.
    lines = sorted(result, key=lambda r: (round(r[0][0][1] / 20), r[0][0][0]))
    return "\n".join(r[1] for r in lines if r[1].strip())
