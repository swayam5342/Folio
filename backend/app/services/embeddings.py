from sentence_transformers import SentenceTransformer

from app.config import settings

_model = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        model = SentenceTransformer(settings.EMBEDDING_MODEL)
        dimension = model.get_sentence_embedding_dimension()
        if dimension != settings.EMBEDDING_DIM:
            raise RuntimeError(
                f"EMBEDDING_DIM={settings.EMBEDDING_DIM} does not match {settings.EMBEDDING_MODEL} ({dimension}). "
                "Update the setting/migration and re-index every document."
            )
        _model = model
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed source passages/documents."""
    model = get_model()
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    return embed_queries([text])[0]


def embed_queries(texts: list[str]) -> list[list[float]]:
    """Embed search queries with the asymmetric instruction expected by BGE models."""
    if "bge-" in settings.EMBEDDING_MODEL.casefold():
        texts = [f"Represent this sentence for searching relevant passages: {text}" for text in texts]
    return embed_texts(texts)
