"""Local cross-encoder reranking.

Hybrid search finds candidates fast but judges the question and a passage
separately. A cross-encoder reads them together, so it orders the candidates
far more precisely; it is too slow to run over a whole notebook, which is why
it only rescores the RETRIEVE_K fused candidates. Scores are probabilities
(0-1) that the passage answers the question, which also drives the confidence
gate.
"""
from collections.abc import Sequence

import torch
from sentence_transformers import CrossEncoder

from app.config import settings

_model: CrossEncoder | None = None


def get_model() -> CrossEncoder:
    """Lazy-loaded, process-wide singleton so the model loads once."""
    global _model
    if _model is None:
        _model = CrossEncoder(settings.RERANKER_MODEL)
    return _model


def score(query: str, passages: Sequence[str]) -> list[float]:
    """Relevance of each passage to the query, 0-1, in the order given."""
    return score_pairs([(query, p) for p in passages])


def score_pairs(pairs: Sequence[tuple[str, str]]) -> list[float]:
    """Relevance (0-1) for each (text, passage) pair, in one batch."""
    if not pairs:
        return []
    # Explicit sigmoid: some cross-encoders ship configured to return raw logits.
    scores = get_model().predict(
        list(pairs),
        activation_fn=torch.nn.Sigmoid(),
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    return [float(s) for s in scores]
