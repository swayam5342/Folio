import json

import pytest

from app.config import settings
from app.services import llm, query_planner
from app.services.query_planner import looks_self_contained, parse_plan, plan_queries

HISTORY = [("user", "What is TCP slow start?"), ("assistant", "It grows the window exponentially [[C1]].")]


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_QUERY_REWRITE", True)
    monkeypatch.setattr(settings, "ENABLE_MULTI_QUERY", True)
    monkeypatch.setattr(settings, "ENABLE_HYDE", False)
    monkeypatch.setattr(settings, "QUERY_VARIANTS", 2)
    query_planner._cache.clear()


@pytest.fixture
def fake_llm(monkeypatch):
    calls: list[list[dict]] = []
    reply = {"standalone": "Why does TCP slow start grow exponentially?", "variants": ["a", "b", "c"]}

    async def complete_json(messages, max_tokens=0, reasoning_effort="low", usage=None):
        calls.append(messages)
        if usage is not None:
            usage.update(prompt_tokens=50, completion_tokens=20)
        return json.dumps(reply)

    monkeypatch.setattr(llm, "complete_json", complete_json)
    return calls


async def test_follow_up_is_rewritten_with_variants(fake_llm):
    plan = await plan_queries("why is it so fast?", HISTORY)
    assert plan.standalone == "Why does TCP slow start grow exponentially?"
    assert plan.variants == ["a", "b"]  # capped at QUERY_VARIANTS
    assert plan.search_queries[0] == plan.standalone
    assert plan.usage == {"prompt_tokens": 50, "completion_tokens": 20}
    prompt = fake_llm[0][1]["content"]
    assert "Conversation so far" in prompt and "[[C1]]" not in prompt  # old markers stripped


async def test_no_call_when_nothing_to_do(monkeypatch, fake_llm):
    monkeypatch.setattr(settings, "ENABLE_MULTI_QUERY", False)
    plan = await plan_queries("why is it so fast?", [])  # no history → nothing to rewrite
    assert (plan.standalone, plan.variants, plan.llm_called) == ("why is it so fast?", [], False)
    assert fake_llm == []


async def test_self_contained_question_is_not_rewritten(fake_llm):
    plan = await plan_queries("Explain the TCP congestion window growth policy", HISTORY)
    assert plan.standalone == "Explain the TCP congestion window growth policy"
    assert "Conversation so far" not in fake_llm[0][1]["content"]  # multi-query only


async def test_results_are_cached(fake_llm):
    await plan_queries("why is it so fast?", HISTORY)
    plan = await plan_queries("why is it so fast?", HISTORY)
    assert plan.cached and len(fake_llm) == 1


async def test_rate_limit_falls_back_to_the_question(monkeypatch):
    async def limited(*args, **kwargs):
        raise llm.RateLimited(12)

    monkeypatch.setattr(llm, "complete_json", limited)
    plan = await plan_queries("why is it so fast?", HISTORY)
    assert plan.standalone == "why is it so fast?" and plan.variants == []
    assert "rate limited" in (plan.error or "")


async def test_malformed_output_falls_back(monkeypatch):
    async def garbage(*args, **kwargs):
        return "not json"

    monkeypatch.setattr(llm, "complete_json", garbage)
    plan = await plan_queries("why is it so fast?", HISTORY)
    assert plan.standalone == "why is it so fast?" and plan.error


async def test_hyde_passage_is_returned_when_enabled(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_HYDE", True)

    async def complete_json(*args, **kwargs):
        return json.dumps({"variants": [], "hypothetical": "Slow start doubles cwnd each RTT."})

    monkeypatch.setattr(llm, "complete_json", complete_json)
    plan = await plan_queries("Explain the TCP congestion window growth policy", [])
    assert plan.hypothetical == "Slow start doubles cwnd each RTT."


def test_parse_plan_validates_and_dedupes():
    raw = json.dumps({"standalone": "  Q  one ", "variants": ["q one", "Other", 5, "", "other"], "hypothetical": 3})
    assert parse_plan(raw, "orig", 5) == {"standalone": "Q one", "variants": ["Other"], "hypothetical": None}
    assert parse_plan(json.dumps({}), "orig", 2)["standalone"] == "orig"
    with pytest.raises(ValueError):
        parse_plan("[1, 2]", "orig", 2)


def test_self_contained_heuristic():
    assert looks_self_contained("Explain the TCP congestion window growth policy")
    assert not looks_self_contained("what about it?")
    assert not looks_self_contained("Tell me more about those results please")
