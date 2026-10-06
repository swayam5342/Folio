# Backend: FastAPI + local embedding model (CPU-only PyTorch).
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.7.6 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    HF_HOME=/opt/hf \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first so code changes don't reinstall them.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Bake the embedding model into the image so the container never needs Hugging Face at runtime.
ARG EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')"
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN useradd --create-home --uid 1000 folio \
    && mkdir -p /data/uploads \
    && chown -R folio /data \
    && chmod +x /usr/local/bin/entrypoint.sh
USER folio

ENV UPLOAD_DIR=/data/uploads
EXPOSE 8000
ENTRYPOINT ["entrypoint.sh"]
