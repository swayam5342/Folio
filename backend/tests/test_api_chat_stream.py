"""The chat SSE stream end to end, with retrieval, the LLM and the citation check replaced by fakes."""
import json
import uuid
from types import SimpleNamespace

import pytest

from app.config import settings
from app.observability import StageTimer
from app.routers import chat
from app.services import pipeline
from app.services.query_planner import QueryPlan
from app.services.retrieval import Candidate

pytestmark = pytest.mark.db

PASSWORD = "a-long-password"


def _events(body: str) -> list[tuple[str, dict]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


@pytest.fixture
def fake_pipeline(monkeypatch):
    document = SimpleNamespace(id=uuid.uuid4(), filename="notes.pdf")
    chunk = SimpleNamespace(id=uuid.uuid4(), content="Slow start doubles cwnd every RTT.", page_number=2, section_title="Slow Start")
    candidate = Candidate(chunk.id, vector_rank=1, vector_similarity=0.8, fused_score=0.03, rerank_score=0.97)

    async def run(db, notebook_id, question, history, document_ids=None, timer=None):
        timer = timer or StageTimer()
        for stage in ("plan", "search", "rerank"):
            with timer.stage(stage):
                pass
            yield stage
        result = pipeline.RetrievalResult(
            plan=QueryPlan(question=question, standalone=question + "?", variants=["v"]),
            candidates=[candidate], chunks={chunk.id: (chunk, document)}, reranked=True,
            confidence="high", top_score=0.97, abstain=False, timer=timer,
        )
        result.selected = [{"chunk": chunk, "document": document, "candidate": candidate}]
        yield result

    async def stream_answer(messages, usage=None):
        for part in ("Slow start doubles ", "the window [[C1]]."):
            yield part

    monkeypatch.setattr(chat.pipeline, "run", run)
    monkeypatch.setattr(chat.llm, "stream_answer", stream_answer)
    monkeypatch.setattr(chat.citation_check, "check_citations", lambda answer, passages: {"C1": {"support": "ok", "support_score": 0.99}})
    monkeypatch.setattr(settings, "ENABLE_CITATION_CHECK", True)
    monkeypatch.setattr(settings, "ENABLE_RERANKER", True)
    return document


async def test_stream_reports_stages_retrieval_and_verified_sources(client, unique_username, fake_pipeline):
    await client.post("/api/auth/register", json={"username": unique_username, "password": PASSWORD})
    notebook_id = (await client.post("/api/notebooks", json={"name": "Stream"})).json()["id"]

    response = await client.post(f"/api/notebooks/{notebook_id}/chat", json={"question": "how fast"})
    events = _events(response.text)
    names = [name for name, _ in events]
    assert names == ["stage", "stage", "stage", "retrieval", "stage", "token", "token", "stage", "done"]
    assert [data["stage"] for name, data in events if name == "stage"] == ["plan", "search", "rerank", "generate", "verify"]
    assert "plan" in events[1][1]["timings_ms"]  # each stage event carries the finished stages' timings

    retrieval = events[3][1]
    assert retrieval["queries"] == ["how fast?", "v"] and retrieval["rewritten"] is True
    assert retrieval["passages"] == [{
        "marker": "C1", "document_id": str(fake_pipeline.id), "filename": "notes.pdf",
        "page_number": 2, "section_title": "Slow Start", "score": 0.97,
    }]

    message = events[-1][1]["message"]
    assert message["confidence"] == "high"
    [source] = message["sources"]
    assert (source["marker"], source["score"], source["support"], source["support_score"]) == ("C1", 0.97, "ok", 0.99)

    trace = (await client.get(f"/api/messages/{message['id']}/trace")).json()
    assert trace["candidates"][0]["support"] == "ok"
