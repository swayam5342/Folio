"""Structure-aware extraction and chunking, on a small PDF built in the test."""
import pymupdf
import pytest

from app.services.chunking import chunk_document, chunk_pages, chunk_structured, embedding_text
from app.services.pdf_parser import body_font_size, classify_block, extract_pages_from_pdf

BODY = "Paging divides memory into fixed-size frames so a process need not be contiguous."
CODE = "def lookup(table, page):\n    return table[page]"


def _pdf() -> bytes:
    """Page 1: heading, two paragraphs, a code block. Page 2: a paragraph only (same section)."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Virtual Memory", fontsize=20, fontname="helv")
    page.insert_textbox(pymupdf.Rect(72, 90, 520, 160), BODY, fontsize=11, fontname="helv")
    page.insert_textbox(pymupdf.Rect(72, 170, 520, 240), BODY.replace("Paging", "Segmentation"), fontsize=11, fontname="helv")
    page.insert_textbox(pymupdf.Rect(72, 250, 520, 300), CODE, fontsize=11, fontname="cour")
    page2 = doc.new_page()
    page2.insert_textbox(pymupdf.Rect(72, 72, 520, 140), BODY.replace("Paging", "Swapping"), fontsize=11, fontname="helv")
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture(scope="module")
def pages() -> list[dict]:
    page_count, pages, ocr_pages = extract_pages_from_pdf(_pdf())
    assert (page_count, ocr_pages) == (2, 0)
    return pages


def test_blocks_are_classified_by_font(pages):
    kinds = [(b["kind"], b["text"].split()[0]) for b in pages[0]["blocks"]]
    assert kinds[0] == ("heading", "Virtual")
    assert ("body", "Paging") in kinds
    assert ("code", "def") in kinds


def test_page_text_is_its_blocks_joined(pages):
    for page in pages:
        assert page["text"] == "\n".join(b["text"] for b in page["blocks"])


def test_structured_chunks_carry_section_across_pages(pages):
    chunks = chunk_structured(pages, chunk_size=800, overlap=100)
    assert all(c["section_title"] == "Virtual Memory" for c in chunks)
    assert {c["page_number"] for c in chunks} == {1, 2}
    # The heading is kept with the first paragraph so keyword search can still match it.
    assert chunks[0]["content"].startswith("Virtual Memory")


def test_paragraphs_are_not_cut_and_offsets_locate_the_chunk(pages):
    chunks = chunk_structured(pages, chunk_size=120, overlap=0)
    by_page = {p["page_number"]: p["text"] for p in pages}
    for c in chunks:
        assert by_page[c["page_number"]][c["char_start"]:c["char_end"]] == c["content"]
    # Each ~85-character paragraph fits in a 120-character chunk, so none is split mid-sentence.
    assert any(c["content"].endswith("contiguous.") for c in chunks)
    assert all(not c["content"].startswith(("ging", "mentation")) for c in chunks)


def test_code_block_stays_whole(pages):
    chunks = chunk_structured(pages, chunk_size=40, overlap=0)  # code (~50 chars) is under 2x size
    assert any(c["content"] == pages[0]["blocks"][-1]["text"] for c in chunks)


def test_oversized_paragraph_falls_back_to_windows():
    text = "word " * 100
    page = {"page_number": 4, "text": text.strip(), "blocks": [{"kind": "body", "text": text.strip()}]}
    chunks = chunk_structured([page], chunk_size=100, overlap=20)
    assert len(chunks) > 1
    assert all(len(c["content"]) <= 100 for c in chunks)
    assert all(page["text"][c["char_start"]:c["char_end"]] == c["content"] for c in chunks)


def test_lone_heading_at_page_end_is_dropped_but_titles_next_page():
    pages = [
        {"page_number": 1, "text": "Intro text\nNext Part", "blocks": [
            {"kind": "body", "text": "Intro text"}, {"kind": "heading", "text": "Next Part"}]},
        {"page_number": 2, "text": "Body of part", "blocks": [{"kind": "body", "text": "Body of part"}]},
    ]
    chunks = chunk_structured(pages, chunk_size=200, overlap=0)
    assert [(c["content"], c["section_title"]) for c in chunks] == [("Intro text", None), ("Body of part", "Next Part")]


def test_pages_without_blocks_are_one_body_block():
    chunks = chunk_structured([{"page_number": 1, "text": "scanned words"}], chunk_size=100, overlap=0)
    assert chunks[0]["content"] == "scanned words"


def test_fixed_chunks_have_offsets_and_no_section():
    chunks = chunk_pages([{"page_number": 1, "text": "  abcdefghij"}], chunk_size=6, overlap=0)
    assert [(c["content"], c["char_start"], c["char_end"]) for c in chunks] == [("abcd", 2, 6), ("efghij", 6, 12)]
    assert all(c["section_title"] is None for c in chunks)


def test_chunk_document_dispatches_on_strategy(pages):
    assert chunk_document(pages, "fixed")[0]["section_title"] is None
    assert chunk_document(pages, "structured")[0]["section_title"] == "Virtual Memory"


def test_embedding_text_prefixes_section_once():
    assert embedding_text({"content": "body", "section_title": "Title"}) == "Title\n\nbody"
    assert embedding_text({"content": "Title\nbody", "section_title": "Title"}) == "Title\nbody"
    assert embedding_text({"content": "body", "section_title": None}) == "body"


def test_heading_rules():
    body = {"text": "x", "lines": 1, "size": 11, "bold": False, "mono": False, "chars": [(11.0, 500)]}
    assert body_font_size([body, {**body, "chars": [(20.0, 10)]}]) == 11.0
    big = {**body, "text": "Results", "size": 16}
    assert classify_block(big, 11) == "heading"
    assert classify_block({**big, "text": "A full sentence that ends."}, 11) == "body"
    assert classify_block({**body, "text": "Method", "bold": True}, 11) == "heading"
    assert classify_block({**big, "text": "2024"}, 11) == "body"  # no letters: a page number or year
