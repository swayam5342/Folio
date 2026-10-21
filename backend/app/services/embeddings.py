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


EMBED_BATCH = 32


def embed_texts(texts: list[str], report=None) -> list[list[float]]:
    """Embed source passages/documents. report(stage, done, total), when given, hears
    about every batch so the UI can show "Embedding 120/480"."""
    model = get_model()
    if report is None:
        return model.encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist()
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        report("embedding", start, len(texts))
        batch = texts[start:start + EMBED_BATCH]
        vectors += model.encode(batch, normalize_embeddings=True, show_progress_bar=False).tolist()
    report("embedding", len(texts), len(texts))
    return vectors


def embed_query(text: str) -> list[float]:
    return embed_queries([text])[0]


def embed_queries(texts: list[str]) -> list[list[float]]:
    """Embed search queries with the asymmetric instruction expected by BGE models."""
    if "bge-" in settings.EMBEDDING_MODEL.casefold():
        texts = [f"Represent this sentence for searching relevant passages: {text}" for text in texts]
    return embed_texts(texts)
