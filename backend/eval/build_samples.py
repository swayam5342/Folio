"""Builds the evaluation corpus (docs/samples/*.pdf) from eval/samples.py.

    python -m eval.build_samples            # from backend/

Each HTML page is rendered onto exactly one A4 page, so a fact's page number in
the dataset is the page it was written on. A page that overflows is an error
rather than silently spilling onto the next page and breaking the gold labels.
The output is deterministic, so rebuilding leaves the committed PDFs unchanged.
"""
from pathlib import Path

import pymupdf

from eval.samples import DOCUMENTS

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "docs" / "samples"

MARGIN = 56
CSS = """
* { font-family: sans-serif; }
body { font-size: 10.5pt; line-height: 1.4; color: #1b1f24; }
h1 { font-size: 17pt; font-weight: bold; margin: 0 0 8pt 0; }
h2 { font-size: 13pt; font-weight: bold; margin: 12pt 0 4pt 0; }
p { margin: 0 0 6pt 0; }
ul, ol { margin: 0 0 6pt 0; }
li { margin: 0 0 2pt 0; }
pre { font-family: monospace; font-size: 9.5pt; background: #f2f2f2; padding: 6pt; }
"""


def build_pdf(document: dict) -> bytes:
    doc = pymupdf.open()
    pages = document["pages"]
    for number, html in enumerate(pages, start=1):
        page = doc.new_page(width=pymupdf.paper_size("a4")[0], height=pymupdf.paper_size("a4")[1])
        body = pymupdf.Rect(MARGIN, MARGIN, page.rect.width - MARGIN, page.rect.height - MARGIN - 18)
        spare, _ = page.insert_htmlbox(body, html, css=CSS)
        if spare < 0:
            raise ValueError(f"{document['title']}: page {number} overflows its page")
        footer = f"{document['footer']}   ·   Page {number} of {len(pages)}"
        page.insert_text((MARGIN, page.rect.height - MARGIN + 10), footer, fontsize=7.5, fontname="helv", color=(0.4, 0.4, 0.4))
    doc.set_metadata({"title": document["title"], "author": "Folio evaluation corpus", "creationDate": "", "modDate": ""})
    data = doc.tobytes(garbage=3, deflate=True, no_new_id=True)
    doc.close()
    return data


def main() -> None:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    for filename, document in DOCUMENTS.items():
        (SAMPLES_DIR / filename).write_bytes(build_pdf(document))
        print(f"wrote {SAMPLES_DIR / filename} ({len(document['pages'])} pages)")


if __name__ == "__main__":
    main()
