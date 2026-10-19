import pytest

from app.config import settings
from app.services import citation_check
from app.services.citation_check import check_citations, citation_coverage, claims_by_marker


def test_claims_follow_their_markers():
    answer = (
        "Slow start doubles the window every RTT [[C1]]. It ends at ssthresh [[C1]][[C2]].\n"
        "- **Fast retransmit** resends after three duplicate ACKs [[C3]]"
    )
    assert claims_by_marker(answer) == {
        "C1": ["Slow start doubles the window every RTT .", "It ends at ssthresh ."],
        "C2": ["It ends at ssthresh ."],
        "C3": ["Fast retransmit resends after three duplicate ACKs"],
    }


def test_markers_after_the_full_stop_belong_to_the_previous_sentence():
    assert claims_by_marker("The page offset is twelve bits. [[C2]]") == {"C2": ["The page offset is twelve bits."]}


def test_short_fragments_are_not_claims():
    assert claims_by_marker("Yes [[C1]].") == {}


def test_weakest_claim_decides_and_unknown_markers_are_ignored(monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_LOW", 0.01)
    seen = []

    def score_pairs(pairs):
        seen.extend(pairs)
        return [0.99 if "doubles" in claim else 0.001 for claim, _ in pairs]

    monkeypatch.setattr(citation_check.reranker, "score_pairs", score_pairs)
    answer = "Slow start doubles the window [[C1]]. The moon is made of cheese [[C1]]. Another claim here [[C9]]."
    verdicts = check_citations(answer, {"C1": "passage one"})
    assert verdicts == {"C1": {"support": "low", "support_score": 0.001}}
    assert all(passage == "passage one" for _, passage in seen) and len(seen) == 2


def test_no_claims_means_no_model_call(monkeypatch):
    monkeypatch.setattr(citation_check.reranker, "score_pairs", lambda pairs: pytest.fail("should not be called"))
    assert check_citations("No citations at all.", {"C1": "x"}) == {}


def test_citation_coverage_requires_valid_markers():
    answer = "First supported claim [[C1]]. Second uncited factual claim. Invented marker claim [[C9]]."
    coverage, uncited = citation_coverage(answer, {"C1", "C2"})
    assert coverage == pytest.approx(1 / 3)
    assert len(uncited) == 2
