from app.services.chunking import chunk_pages


def test_chunks_keep_page_numbers_and_sequential_indexes():
    pages = [{"page_number": 1, "text": "a" * 25}, {"page_number": 3, "text": "b" * 10}]
    chunks = chunk_pages(pages, chunk_size=10, overlap=0)

    assert [c["page_number"] for c in chunks] == [1, 1, 1, 3]
    assert [c["chunk_index"] for c in chunks] == [0, 1, 2, 3]
    assert chunks[-1]["content"] == "b" * 10


def test_chunks_overlap():
    text = "".join(str(i % 10) for i in range(30))
    chunks = chunk_pages([{"page_number": 1, "text": text}], chunk_size=10, overlap=4)

    assert chunks[0]["content"] == text[0:10]
    assert chunks[1]["content"] == text[6:16]  # step = size - overlap


def test_whitespace_only_pieces_are_skipped():
    chunks = chunk_pages([{"page_number": 1, "text": "x" + " " * 30}], chunk_size=10, overlap=0)
    assert [c["content"] for c in chunks] == ["x"]


def test_overlap_not_smaller_than_size_still_terminates():
    chunks = chunk_pages([{"page_number": 1, "text": "abcdef"}], chunk_size=3, overlap=5)
    assert len(chunks) == 6  # step clamps to 1
