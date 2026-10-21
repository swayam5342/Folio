from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

JWT_SECRET_PLACEHOLDER = "change-me"  # noqa: S105 - the value startup refuses, not a secret

# The single .env lives at the repository root (shared with Docker Compose).
# In the Docker image it doesn't exist; Compose passes the values as env vars instead.
ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV, extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://raguser:ragpass@127.0.0.1:5432/notebooklm"

    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIM: int = 384

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # Auth
    JWT_SECRET: str = JWT_SECRET_PLACEHOLDER
    JWT_EXPIRE_DAYS: int = 7
    COOKIE_SECURE: bool = False  # set true when served over HTTPS

    # Uploads
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 50
    MAX_PDF_PAGES: int = 1000

    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150
    # "structured": chunk within headings/sections (detected from font size and weight);
    # "fixed": the original sliding character window. Re-index documents after changing it.
    CHUNK_STRATEGY: Literal["structured", "fixed"] = "structured"
    TOP_K: int = 6
    BROAD_TOP_K: int = 12  # coverage-aware context for summaries/overviews
    CONTEXT_MAX_CHARS: int = 18000
    MAX_CHUNKS_PER_DOCUMENT: int = 4
    HISTORY_MESSAGES: int = 6

    # Retrieval pipeline
    RETRIEVE_K: int = 30  # candidates per search, and how many the reranker scores
    QUERY_VARIANTS: int = 2  # paraphrases searched alongside the question (multi-query)
    RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L6-v2"
    # Confidence. "high": best reranker score (0-1) >= CONFIDENCE_HIGH. "low" (and abstain) needs
    # both weak signals: reranker < CONFIDENCE_LOW and best cosine similarity < SIMILARITY_LOW.
    # Without the reranker, SIMILARITY_HIGH / SIMILARITY_LOW alone decide. Tuned 2026-10-20 on the eval set:
    # 0 answerable questions refused, 4 of 7 unanswerable refused (the rest have strong look-alike passages).
    CONFIDENCE_HIGH: float = 0.5
    CONFIDENCE_LOW: float = 0.01
    SIMILARITY_HIGH: float = 0.75
    SIMILARITY_LOW: float = 0.60
    # A cited claim whose cross-encoder score against its excerpt is below this is "low support".
    SUPPORT_LOW: float = 0.01
    MIN_CITATION_COVERAGE: float = 0.8

    # Evaluation results served at /api/eval/results (default: backend/eval/results/latest.json)
    EVAL_RESULTS_PATH: str = ""

    # Logging: "json" (one object per line) or "text" (readable, for development)
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "text"] = "json"

    # Feature flags. Every pipeline stage can be switched off so the evaluation
    # harness can measure what each one contributes. Names must start with ENABLE_.
    ENABLE_HYBRID_SEARCH: bool = True  # false = vector search only (the evaluation baseline)
    ENABLE_QUERY_REWRITE: bool = True  # follow-ups rewritten into standalone questions using chat history
    ENABLE_MULTI_QUERY: bool = False  # also search QUERY_VARIANTS paraphrases (off: hurt Hit@1 once reranking was on)
    ENABLE_HYDE: bool = False  # also search with a short hypothetical answer (vector search only)
    ENABLE_RERANKER: bool = True  # local cross-encoder reorders the fused candidates
    ENABLE_ABSTENTION: bool = True  # say "not in the sources" instead of answering on weak evidence
    ENABLE_CITATION_CHECK: bool = True  # flag citations whose excerpt doesn't support the claim (cross-encoder)
    ENABLE_PROMPT_INJECTION_SCAN: bool = True  # quarantine source passages that try to control the model
    ENABLE_PII_REDACTION: bool = True  # allow per-notebook PII masking during indexing
    ENABLE_NEIGHBOR_EXPANSION: bool = True  # add the chunks around each chosen passage (same page and section)
    ENABLE_ANSWER_CACHE: bool = True  # reuse stored answers for repeat questions over unchanged sources
    ENABLE_SOURCE_SUMMARIES: bool = True  # one short Groq summary per source, written after indexing

    def feature_flags(self) -> dict[str, bool]:
        """All ENABLE_* settings, keyed by lower-case name without the prefix."""
        return {
            name.removeprefix("ENABLE_").lower(): bool(getattr(self, name))
            for name in type(self).model_fields
            if name.startswith("ENABLE_")
        }

    def validate_secrets(self) -> None:
        """Called at startup so a missing secret fails loudly instead of silently signing tokens with a known key."""
        if not self.JWT_SECRET or self.JWT_SECRET == JWT_SECRET_PLACEHOLDER:
            raise RuntimeError(
                "JWT_SECRET is not set. Generate one with "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` and put it in .env"
            )


settings = Settings()
