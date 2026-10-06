from sentence_transformers import SentenceTransformer

from app.config import settings

_model = None


def get_model() -> SentenceTransformer:
    """Lazy-loaded, process-wide singleton so the model loads once."""
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.EMBEDDING_MODEL)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_model()
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
