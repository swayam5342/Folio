import uuid
from types import SimpleNamespace

from app.services import llm


def _item(filename: str, page: int, content: str):
    chunk = SimpleNamespace(id=uuid.uuid4(), page_number=page, content=content)
    document = SimpleNamespace(id=uuid.uuid4(), filename=filename)
    return {"chunk": chunk, "document": document}


def test_normalize_citation_variants():
    text = "A【C1†L3】 B [C2] C [[C1, C3]] D【C4】 E [[C5]]"
    assert llm.normalize_citations(text) == "A[[C1]] B [[C2]] C [[C1]][[C3]] D[[C4]] E [[C5]]"


def test_normalize_leaves_ordinary_brackets_alone():
    text = "Array [1, 2] and [note] stay."
    assert llm.normalize_citations(text) == text


def test_build_context_labels_and_maps_excerpts():
    retrieved = [_item("a.pdf", 2, "alpha text"), _item("b.pdf", 7, "beta text")]
    context, citation_map = llm.build_context(retrieved)

    assert '[C1] (from "a.pdf", page 2)\nalpha text' in context
    assert '[C2] (from "b.pdf", page 7)\nbeta text' in context
    assert citation_map["C2"]["page_number"] == 7
    assert citation_map["C2"]["filename"] == "b.pdf"


def test_parse_citations_orders_by_marker_and_drops_unknown():
    _, citation_map = llm.build_context([_item("a.pdf", 1, "x"), _item("b.pdf", 2, "y")])
    sources = llm.parse_citations("Claim [[C2]]. Other [[C1]][[C2]]. Fake [[C9]].", citation_map)
    assert [s["marker"] for s in sources] == ["C1", "C2"]


def test_build_messages_strips_old_markers_from_history():
    messages = llm.build_messages("Q?", "ctx", [("user", "earlier"), ("assistant", "Yes [[C1]].")])

    assert messages[0]["role"] == "system"
    assert messages[2] == {"role": "assistant", "content": "Yes ."}
    assert messages[-1]["content"].endswith("Question: Q?")
