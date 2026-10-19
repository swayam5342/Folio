"""Evaluation harness: metrics, configuration ladder, report rendering and the results endpoint."""
import json

import pytest

from app.config import settings
from eval import metrics, report
from eval.run_eval import ALL_OFF, LADDER, LLM_FLAGS, load_dataset, overrides, smoke_configs
from eval.samples import DOCUMENTS


def test_retrieval_scores_rank_the_first_gold_page():
    gold = {("a.pdf", 2)}
    ranked = [("a.pdf", 1), ("b.pdf", 2), ("a.pdf", 2), ("a.pdf", 2)]
    assert metrics.retrieval_scores(ranked, gold) == {"hit@1": 0.0, "hit@3": 1.0, "hit@6": 1.0, "rr": pytest.approx(1 / 3)}
    assert metrics.retrieval_scores([("a.pdf", 1)], gold) == {"hit@1": 0.0, "hit@3": 0.0, "hit@6": 0.0, "rr": 0.0}


def test_gold_pages_need_a_document():
    assert metrics.gold_pages({"document": "a.pdf", "gold_pages": [1, 3]}) == {("a.pdf", 1), ("a.pdf", 3)}
    assert metrics.gold_pages({"document": None, "gold_pages": []}) == set()


def test_summarize_retrieval_scores_abstention_both_ways():
    rows = [
        {"type": "factual", "answerable": True, "abstained": False, "hit@1": 1.0, "hit@3": 1.0, "hit@6": 1.0, "rr": 1.0, "confidence": "high"},
        {"type": "keyword", "answerable": True, "abstained": True, "hit@1": 0.0, "hit@3": 1.0, "hit@6": 1.0, "rr": 0.5, "confidence": "low"},
        {"type": "unanswerable", "answerable": False, "abstained": True, "confidence": "low"},
        {"type": "unanswerable", "answerable": False, "abstained": False, "confidence": "medium"},
    ]
    s = metrics.summarize_retrieval(rows)
    assert (s["hit@1"], s["hit@3"], s["mrr"]) == (0.5, 1.0, 0.75)
    assert (s["abstain_unanswerable"], s["false_abstain"]) == (0.5, 0.5)
    assert s["by_type"] == {"factual": {"n": 1, "hit@3": 1.0, "mrr": 1.0}, "keyword": {"n": 1, "hit@3": 1.0, "mrr": 0.5}}
    assert s["confidence"] == {"high": 1, "medium": 1, "low": 2}


def test_summarize_answers_skips_failed_rows():
    base = {"declined": False, "faithfulness": 1.0, "key_fact_recall": 0.5}
    rows = [
        {**base, "answerable": True, "abstained": False, "citations_correct": 2, "citations_total": 3},
        {**base, "answerable": True, "abstained": False, "citations_correct": 0, "citations_total": 0, "faithfulness": None},
        {**base, "answerable": False, "abstained": False, "declined": True, "citations_correct": 0, "citations_total": 0},
        {**base, "answerable": True, "abstained": False, "citations_correct": 0, "citations_total": 5, "error": "quota"},
    ]
    s = metrics.summarize_answers(rows)
    assert (s["n"], s["failed"]) == (3, 1)
    assert s["citation_precision"] == pytest.approx(2 / 3, abs=1e-4)
    assert (s["cited_answers"], s["faithfulness"], s["unanswerable_handled"]) == (0.5, 1.0, 1.0)


def test_latency_summary():
    s = metrics.summarize_latency([{"embed": 10, "search": 20}, {"embed": 30, "search": 40, "generate": 999}])
    assert s == {"embed": 20.0, "generate": 999.0, "search": 30.0, "retrieval_median": 50.0}


def test_ladder_adds_one_stage_at_a_time():
    assert LADDER[0].flags == ALL_OFF and LADDER[0].strategy == "fixed"
    for before, after in zip(LADDER, LADDER[1:], strict=False):
        turned_on = {k for k, v in after.flags.items() if v and not before.flags[k]}
        assert len(turned_on) + (after.strategy != before.strategy) >= 1
        assert all(after.flags[k] for k, v in before.flags.items() if v), "a later step never turns a stage off"
    assert LADDER[-1].strategy == "structured"


def test_smoke_configs_never_call_the_llm():
    assert all(not c.uses_llm for c in smoke_configs())
    assert all(not c.flags[f] for c in smoke_configs() for f in LLM_FLAGS)


def test_overrides_restore_settings():
    before = settings.ENABLE_RERANKER
    with overrides({"ENABLE_RERANKER": not before}):
        assert settings.ENABLE_RERANKER is (not before)
    assert settings.ENABLE_RERANKER is before


def test_dataset_is_consistent_with_the_corpus():
    items = load_dataset()
    assert len({i["id"] for i in items}) == len(items) >= 30
    for item in items:
        if item["type"] == "unanswerable":
            assert item["document"] is None and not item["gold_pages"]
            continue
        pages = len(DOCUMENTS[item["document"]]["pages"])
        assert item["gold_pages"] and all(1 <= p <= pages for p in item["gold_pages"]), item["id"]
        assert item["key_facts"], item["id"]
    assert len(load_dataset(limit=10)) == 10


def _results(mode: str = "full") -> dict:
    retrieval = {"hit@1": 0.5, "hit@3": 0.75, "hit@6": 1.0, "mrr": 0.6, "abstain_unanswerable": 0.5, "false_abstain": 0.0,
                 "by_type": {"factual": {"n": 2, "hit@3": 0.5, "mrr": 0.5}}, "confidence": {"high": 1, "medium": 0, "low": 1}}
    config = {"name": "baseline", "label": "Vector search only", "retrieval": retrieval,
              "latency_ms": {"embed": 12.0, "retrieval_median": 30.0}, "planner_errors": 0, "items": [{"id": "x"}]}
    return {"generated_at": "2026-10-11T00:00:00+00:00", "mode": mode, "commit": "abc1234", "duration_s": 60, "llm_tokens": 0,
            "dataset": {"questions": 4, "answerable": 3, "unanswerable": 1, "documents": ["a.pdf"], "types": {}},
            "settings": {"EMBEDDING_MODEL": "e", "RERANKER_MODEL": "r", "GROQ_MODEL": "g", "TOP_K": 6},
            "configs": [config, {**config, "name": "full", "label": "+ everything"}]}


def test_markdown_report_and_chart(tmp_path):
    md = report.render_markdown(_results())
    assert "| Vector search only | 50% | 75% | 100% | 0.600 | 50% | 0% | 30 |" in md
    assert "Hit@1 50% → 50%" in md
    svg = report.render_svg(_results()["configs"])
    assert svg.startswith("<svg") and svg.count("<path") == 6  # 2 configs x 3 panels
    report.write_chart(_results()["configs"], tmp_path)
    assert (tmp_path / "chart.png").stat().st_size > 1000


async def test_results_endpoint(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "EVAL_RESULTS_PATH", str(tmp_path / "missing.json"))
    assert (await client.get("/api/eval/results")).status_code == 404

    path = tmp_path / "latest.json"
    path.write_text(json.dumps(_results()), encoding="utf-8")
    monkeypatch.setattr(settings, "EVAL_RESULTS_PATH", str(path))
    response = await client.get("/api/eval/results")
    assert response.status_code == 200
    body = response.json()
    assert body["configs"][0]["retrieval"]["hit@3"] == 0.75
    assert "items" not in body["configs"][0]  # per-question rows stay out of the API
