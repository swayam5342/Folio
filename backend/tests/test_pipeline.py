"""Pipeline wiring with the database, models and LLM replaced by fakes."""
import uuid
from types import SimpleNamespace

import pytest

from app.config import settings
from app.services import pipeline
from app.services.query_planner import QueryPlan
from app.services.retrieval import Candidate


def _chunk(content: str, page: int = 1):
    document = SimpleNamespace(id=uuid.uuid4(), filename="notes.pdf")
    chunk = SimpleNamespace(id=uuid.uuid4(), content=content, page_number=page, section_title="Sec")
    return chunk, document


@pytest.fixture
def fakes(monkeypatch):
    """Three candidates fused in order a, b, c; the reranker prefers c."""
    monkeypatch.setattr(settings, "ENABLE_RERANKER", True)
    monkeypatch.setattr(settings, "ENABLE_ABSTENTION", True)
    monkeypatch.setattr(settings, "TOP_K", 2)
    monkeypatch.setattr(settings, "BROAD_TOP_K", 2)
    monkeypatch.setattr(settings, "CONTEXT_MAX_CHARS", 18000)
    monkeypatch.setattr(settings, "MAX_CHUNKS_PER_DOCUMENT", 4)
    monkeypatch.setattr(settings, "CONFIDENCE_HIGH", 0.5)
    monkeypatch.setattr(settings, "CONFIDENCE_LOW", 0.05)
    monkeypatch.setattr(settings, "SIMILARITY_HIGH", 0.75)
    monkeypatch.setattr(settings, "SIMILARITY_LOW", 0.55)
    rows = {name: _chunk(name) for name in ("a", "b", "c")}
    by_id = {row[0].id: row for row in rows.values()}
    rerank = {"a": 0.2, "b": 0.01, "c": 0.9}
    seen: dict = {"similarity": 0.7}

    async def plan_queries(question, history):
        return QueryPlan(question=question, standalone=question + " standalone", variants=["v1"])

    async def hybrid_candidates(db, notebook_id, queries, embeddings, document_ids, limit=None, vector_only_embeddings=()):
        seen.update(queries=list(queries), document_ids=document_ids)
        return [
            Candidate(rows[n][0].id, vector_rank=i, vector_similarity=seen["similarity"], fused_score=1 / (60 + i))
            for i, n in enumerate("abc", start=1)
        ]

    async def load_chunks(db, ids):
        return {i: by_id[i] for i in ids}

    monkeypatch.setattr(pipeline, "plan_queries", plan_queries)
    monkeypatch.setattr(pipeline, "hybrid_candidates", hybrid_candidates)
    monkeypatch.setattr(pipeline, "load_chunks", load_chunks)
    monkeypatch.setattr(pipeline, "embed_queries", lambda texts: [[0.0] for _ in texts])
    monkeypatch.setattr(pipeline, "embed_texts", lambda texts: [[0.0] for _ in texts])

    def score(query, passages):
        seen["rerank_query"] = query
        return [rerank[p.split("\n\n")[-1]] for p in passages]

    monkeypatch.setattr(pipeline.reranker, "score", score)
    return SimpleNamespace(rows=rows, rerank=rerank, seen=seen)


async def _run(question: str = "q", **kwargs) -> tuple[list[str], pipeline.RetrievalResult]:
    stages, result = [], None
    async for step in pipeline.run(None, uuid.uuid4(), question, [], **kwargs):
        if isinstance(step, pipeline.RetrievalResult):
            result = step
        else:
            stages.append(step)
    assert result is not None
    return stages, result


async def test_rerank_reorders_and_keeps_top_k(fakes):
    stages, result = await _run(document_ids=[uuid.uuid4()])
    assert stages == ["plan", "search", "rerank"]
    assert [item["chunk"].content for item in result.selected] == ["c", "a"]
    assert result.confidence == "high" and result.top_score == 0.9 and not result.abstain
    assert fakes.seen["queries"] == ["q standalone", "v1"]
    assert fakes.seen["rerank_query"] == "q standalone"
    assert fakes.seen["document_ids"] is not None


async def test_weak_rerank_and_similarity_abstain(fakes):
    fakes.rerank.update(a=0.01, b=0.02, c=0.03)
    fakes.seen["similarity"] = 0.4
    _, result = await _run()
    assert result.confidence == "low" and result.abstain


async def test_weak_rerank_alone_does_not_abstain(fakes):
    """A correct passage worded unlike the question can get a near-zero cross-encoder score."""
    fakes.rerank.update(a=0.01, b=0.02, c=0.03)
    _, result = await _run()  # similarity 0.7
    assert result.confidence == "medium" and not result.abstain


async def test_broad_questions_never_abstain(fakes):
    fakes.rerank.update(a=0.01, b=0.02, c=0.03)
    fakes.seen["similarity"] = 0.4
    _, result = await _run("Summarize these sources in a few paragraphs")
    assert result.confidence == "low" and not result.abstain


async def test_without_reranker_fused_order_is_kept_and_no_abstention(monkeypatch, fakes):
    monkeypatch.setattr(settings, "ENABLE_RERANKER", False)
    stages, result = await _run()
    assert "rerank" not in stages
    assert [item["chunk"].content for item in result.selected] == ["a", "b"]
    assert result.confidence == "medium" and not result.abstain  # similarity 0.7


async def test_trace_records_every_candidate(fakes):
    _, result = await _run()
    c_id = str(fakes.rows["c"][0].id)
    trace = pipeline.build_trace(result, markers={c_id: "C1"}, answer_usage={"prompt_tokens": 10})
    assert trace["standalone_query"] == "q standalone" and trace["variants"] == ["v1"]
    assert len(trace["candidates"]) == 3
    top = trace["candidates"][0]
    assert (top["chunk_id"], top["rerank_score"], top["selected"], top["marker"]) == (c_id, 0.9, True, "C1")
    assert trace["candidates"][-1]["selected"] is False
    assert set(trace["timings_ms"]) >= {"plan", "embed", "search", "rerank"}
    assert trace["tokens"]["answer"] == {"prompt_tokens": 10}


def test_confidence_levels(monkeypatch):
    monkeypatch.setattr(settings, "CONFIDENCE_HIGH", 0.5)
    monkeypatch.setattr(settings, "CONFIDENCE_LOW", 0.05)
    monkeypatch.setattr(settings, "SIMILARITY_HIGH", 0.75)
    monkeypatch.setattr(settings, "SIMILARITY_LOW", 0.55)

    def cand(rerank=None, sim=None):
        return Candidate(uuid.uuid4(), rerank_score=rerank, vector_similarity=sim)

    assert pipeline.assess_confidence([cand(0.3, 0.6), cand(0.04, 0.5)], reranked=True) == ("medium", 0.3)
    assert pipeline.assess_confidence([cand(0.9, 0.3)], reranked=True) == ("high", 0.9)
    assert pipeline.assess_confidence([cand(0.01, 0.5)], reranked=True) == ("low", 0.01)
    assert pipeline.assess_confidence([], reranked=True) == (None, None)
    assert pipeline.assess_confidence([cand(sim=0.8)], reranked=False) == ("high", 0.8)
    assert pipeline.assess_confidence([cand(sim=0.5)], reranked=False) == ("low", 0.5)


def test_abstention_follows_flag_and_scope(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_ABSTENTION", True)
    assert pipeline.should_abstain("low")
    assert not pipeline.should_abstain("low", broad=True)
    assert not pipeline.should_abstain("medium")
    monkeypatch.setattr(settings, "ENABLE_ABSTENTION", False)
    assert not pipeline.should_abstain("low")


def test_broad_question_detection():
    assert pipeline.is_broad_question("Summarize these sources in a few paragraphs")
    assert pipeline.is_broad_question("What are the key points or findings?")
    assert pipeline.is_broad_question("What questions do these sources leave open?")
    assert pipeline.is_broad_question("x", "what is this paper about")
    assert not pipeline.is_broad_question("What is the exam date?")
