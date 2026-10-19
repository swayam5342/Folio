import pytest

from app.services.retrieval import RRF_K, reciprocal_rank_fusion


def test_items_in_both_rankings_rise_to_the_top():
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["c", "d"]])
    assert fused[0][0] == "c"


def test_scores_follow_the_rrf_formula():
    fused = dict(reciprocal_rank_fusion([["a", "b"], ["b"]]))
    assert fused["a"] == pytest.approx(1 / (RRF_K + 1))
    assert fused["b"] == pytest.approx(1 / (RRF_K + 2) + 1 / (RRF_K + 1))


def test_single_ranking_keeps_its_order():
    assert [i for i, _ in reciprocal_rank_fusion([["x", "y", "z"]])] == ["x", "y", "z"]


def test_ties_keep_first_seen_order_and_empty_input_is_empty():
    assert [i for i, _ in reciprocal_rank_fusion([["a"], ["b"]])] == ["a", "b"]
    assert reciprocal_rank_fusion([]) == []
    assert reciprocal_rank_fusion([[], []]) == []
