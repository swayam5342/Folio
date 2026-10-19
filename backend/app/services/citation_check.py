"""Citation verification: does each cited excerpt actually support the claim citing it?

After an answer is written, every sentence carrying [[Cn]] markers becomes a claim,
and the local cross-encoder scores each (claim, cited excerpt) pair. A marker whose
weakest claim scores below SUPPORT_LOW is flagged "low" support, which the UI shows
as a warning on the citation chip.

The cross-encoder was chosen over embedding similarity on the evaluation answers:
at its threshold it flagged 1 of 26 supported claims and passed none of the
best-matching excerpts from the wrong document, while embedding similarity could
not separate the two groups (8% flagged / 15% passed at its best threshold).
"""
import re

from app.config import settings
from app.services import reranker
from app.services.llm import CITATION_PATTERN

MIN_CLAIM_CHARS = 15
# Sentence ends, line breaks and list/table boundaries; markdown decoration is stripped from claims.
_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_DECORATION = re.compile(r"^[\s>*#|+-]+|[\s*|_]+$|\*\*|__")


def claims_by_marker(answer: str) -> dict[str, list[str]]:
    """Map each marker ("C2") to the claims citing it, in order.

    A sentence that is only markers (the model put them after the full stop) gives
    its markers to the sentence before it."""
    claims: dict[str, list[str]] = {}
    previous: str | None = None
    for sentence in _SPLIT.split(answer):
        markers = [f"C{n}" for n in CITATION_PATTERN.findall(sentence)]
        text = _DECORATION.sub("", CITATION_PATTERN.sub("", sentence)).strip()
        if len(text) >= MIN_CLAIM_CHARS:
            previous = text
        elif not text and markers and previous:
            text = previous
        else:
            continue
        for marker in dict.fromkeys(markers):
            claims.setdefault(marker, []).append(text)
    return claims


def citation_coverage(answer: str, valid_markers: set[str]) -> tuple[float, list[str]]:
    """Fraction of substantive answer claims carrying at least one valid citation."""
    total = 0
    cited = 0
    uncited: list[str] = []
    for sentence in _SPLIT.split(answer):
        text = _DECORATION.sub("", CITATION_PATTERN.sub("", sentence)).strip()
        if len(text) < MIN_CLAIM_CHARS:
            continue
        # Headings and explicit uncertainty do not assert a source fact.
        if sentence.lstrip().startswith("#") or text.casefold().startswith(("i couldn't", "the sources don't")):
            continue
        total += 1
        markers = {f"C{n}" for n in CITATION_PATTERN.findall(sentence)}
        if markers & valid_markers:
            cited += 1
        else:
            uncited.append(text)
    return (1.0 if total == 0 else cited / total), uncited


def check_citations(answer: str, passages: dict[str, str]) -> dict[str, dict]:
    """{marker: {"support": "ok" | "low", "support_score": weakest claim's score}} for cited markers.

    passages maps markers to the excerpt text the model was given."""
    claims = claims_by_marker(answer)
    pairs = [(marker, claim) for marker, texts in claims.items() if marker in passages for claim in texts]
    if not pairs:
        return {}
    scores = reranker.score_pairs([(claim, passages[marker]) for marker, claim in pairs])
    by_marker: dict[str, list[float]] = {}
    for (marker, _), score in zip(pairs, scores, strict=True):
        by_marker.setdefault(marker, []).append(score)
    return {
        marker: {
            "support": "low" if min(scores) < settings.SUPPORT_LOW else "ok",
            "support_score": round(min(scores), 4),
        }
        for marker, scores in by_marker.items()
    }
