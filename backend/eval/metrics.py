"""Retrieval and answer-quality metrics for the evaluation harness.

Gold labels are pages: a retrieved chunk counts as a hit when its document and
page are among the question's gold (document, page) pairs. That works the same
for every chunking strategy, so configurations with different chunks compare
fairly.
"""
from collections.abc import Sequence
from statistics import mean, median

Page = tuple[str, int]  # (filename, page number)

HIT_KS = (1, 3, 6)


def gold_pages(item: dict) -> set[Page]:
    return {(item["document"], page) for page in item["gold_pages"]} if item.get("document") else set()


def first_hit_rank(ranked: Sequence[Page], gold: set[Page]) -> int | None:
    """1-based rank of the first gold page in a best-first list, or None."""
    for rank, page in enumerate(ranked, start=1):
        if page in gold:
            return rank
    return None


def retrieval_scores(ranked: Sequence[Page], gold: set[Page]) -> dict[str, float]:
    """Hit@k for each k in HIT_KS and the reciprocal rank, for one answerable question."""
    rank = first_hit_rank(ranked, gold)
    scores = {f"hit@{k}": float(rank is not None and rank <= k) for k in HIT_KS}
    scores["rr"] = 1.0 / rank if rank else 0.0
    return scores


def _avg(values: Sequence[float]) -> float | None:
    return round(mean(values), 4) if values else None


def summarize_retrieval(rows: Sequence[dict]) -> dict:
    """Aggregate per-question rows into one configuration's retrieval metrics.

    Each row has "type", "answerable", "abstained" and, for answerable questions,
    the keys of retrieval_scores. Abstention is scored on both sides: how many
    unanswerable questions were refused, and how many answerable ones were wrongly
    refused."""
    answerable = [r for r in rows if r["answerable"]]
    unanswerable = [r for r in rows if not r["answerable"]]
    summary: dict = {f"hit@{k}": _avg([r[f"hit@{k}"] for r in answerable]) for k in HIT_KS}
    summary["mrr"] = _avg([r["rr"] for r in answerable])
    summary["abstain_unanswerable"] = _avg([float(r["abstained"]) for r in unanswerable])
    summary["false_abstain"] = _avg([float(r["abstained"]) for r in answerable])
    summary["by_type"] = {
        kind: {
            "n": len(group),
            "hit@3": _avg([r["hit@3"] for r in group]),
            "mrr": _avg([r["rr"] for r in group]),
        }
        for kind in sorted({r["type"] for r in answerable})
        if (group := [r for r in answerable if r["type"] == kind])
    }
    summary["confidence"] = {
        level: sum(1 for r in rows if r.get("confidence") == level) for level in ("high", "medium", "low")
    }
    return summary


def summarize_latency(timings: Sequence[dict[str, float]]) -> dict[str, float]:
    """Mean milliseconds per stage, plus the median of the summed retrieval time."""
    stages = sorted({name for t in timings for name in t})
    out = {name: round(mean(t[name] for t in timings if name in t), 1) for name in stages}
    if timings:
        out["retrieval_median"] = round(median(sum(v for k, v in t.items() if k != "generate") for t in timings), 1)
    return out


def citation_precision(cited: Sequence[Page], gold: set[Page]) -> tuple[int, int]:
    """(correct, total) citations for one answer: a citation is correct if its page is gold."""
    return sum(1 for page in cited if page in gold), len(cited)


def summarize_answers(rows: Sequence[dict]) -> dict:
    """Answer-quality metrics from per-question judged rows.

    Rows carry "answerable", "abstained", "declined" (the answer said the sources
    don't cover it), "citations_correct"/"citations_total", "faithfulness" (share of
    the answer's claims supported by its excerpts; None if it made none) and
    "key_fact_recall" (share of key facts stated; answerable only). Rows with an "error"
    (the LLM call failed after retries) are counted as failed and left out."""
    failed = sum(1 for r in rows if r.get("error"))
    rows = [r for r in rows if not r.get("error")]
    answerable = [r for r in rows if r["answerable"]]
    unanswerable = [r for r in rows if not r["answerable"]]
    correct = sum(r["citations_correct"] for r in answerable)
    total = sum(r["citations_total"] for r in answerable)
    return {
        "n": len(rows),
        "failed": failed,
        "citation_precision": round(correct / total, 4) if total else None,
        "cited_answers": _avg([float(r["citations_total"] > 0) for r in answerable]),
        "faithfulness": _avg([r["faithfulness"] for r in rows if r.get("faithfulness") is not None]),
        "key_fact_recall": _avg([r["key_fact_recall"] for r in answerable if r.get("key_fact_recall") is not None]),
        "unanswerable_handled": _avg([float(r["abstained"] or r["declined"]) for r in unanswerable]),
    }
