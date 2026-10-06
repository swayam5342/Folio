# NotebookLM-style RAG API

A minimal, working core for a "chat with your documents" tool: upload PDFs
into a notebook, ask questions, get answers grounded in the source text with
page-level citations.

## How it works

1. **Upload** — a PDF is uploaded to a notebook. Text is extracted per page
   (`app/services/pdf_parser.py`), split into overlapping chunks that keep
   their page number (`app/services/chunking.py`), embedded
   (`app/services/embeddings.py`), and stored in Postgres/pgvector.
2. **Chat** — a question is embedded and compared against stored chunk
   vectors with cosine similarity (`app/services/retrieval.py`). The top
   matches are handed to an LLM with a prompt that forces it to cite which
   excerpt(s) support each claim using `[[C1]]`-style markers
   (`app/services/llm.py`). Those markers are parsed back into structured
   sources (filename + page number + snippet) so a frontend can render
   clickable citations, like NotebookLM's side panel.

## Setup

### 1. Start Postgres with pgvector

```bash
docker compose up -d
```

This also runs `db/schema.sql` automatically on first boot. If you're
pointing at an existing Postgres instance instead, run that file manually:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

### 2. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment

```bash
cp .env.example .env
# edit .env — set GROQ_API_KEY (free at https://console.groq.com/keys)
```

The embedding model (`BAAI/bge-small-en-v1.5`) runs locally via
`sentence-transformers` — no API key needed for embeddings, and it downloads
automatically on first use (~130MB).

### 4. Run the API

```bash
uvicorn app.main:app --reload
```

Visit `http://localhost:8000/docs` for interactive Swagger docs.

## Trying it out

```bash
# 1. Create a notebook
curl -X POST localhost:8000/notebooks -H "Content-Type: application/json" \
  -d '{"name": "My Notebook"}'
# → note the returned "id"

# 2. Upload a PDF
curl -X POST localhost:8000/notebooks/<notebook_id>/documents \
  -F "file=@/path/to/your.pdf"

# 3. Ask a question
curl -X POST localhost:8000/notebooks/<notebook_id>/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What does this document say about X?"}'
```

The chat response looks like:

```json
{
  "answer": "The document states that X happens because Y [[C1]].",
  "sources": [
    {
      "chunk_id": "...",
      "document_id": "...",
      "filename": "your.pdf",
      "page_number": 4,
      "snippet": "...the relevant excerpt..."
    }
  ]
}
```

Note the raw `answer` still contains the `[[C1]]` markers — a frontend
should replace them with clickable citation chips linked to the matching
entry in `sources`.

## What's deliberately left out of this MVP

- **Auth** — no user accounts; every notebook is open. Add before any real
  deployment.
- **Frontend** — this is backend-only. Pair it with a simple React/Next.js
  chat UI + PDF viewer that highlights the cited page.
- **Non-PDF sources** — web links, YouTube transcripts, etc. The chunking
  and retrieval pipeline doesn't care about source type once you have plain
  text, so adding a new parser (e.g. a URL scraper) mostly means writing an
  equivalent of `pdf_parser.py`.
- **Reranking** — retrieval is pure cosine similarity top-k. A reranker
  (e.g. a cross-encoder) would improve answer quality once you have real
  usage to tune against.
- **Streaming answers** — `generate_answer` returns the full response at
  once; swap in streaming (`stream=True`) from the Groq SDK if you want a
  typing effect in the UI.

## Project layout

```
app/
  main.py              # FastAPI app + router registration
  config.py            # settings (env-driven)
  database.py          # async SQLAlchemy engine/session
  models.py            # Notebook, Document, Chunk ORM models
  schemas.py           # Pydantic request/response models
  routers/
    documents.py       # notebook + document upload endpoints
    chat.py             # chat endpoint
  services/
    pdf_parser.py       # PDF → per-page text
    chunking.py          # text → overlapping chunks with page numbers
    embeddings.py        # sentence-transformers wrapper
    retrieval.py          # pgvector cosine similarity search
    llm.py                 # citation-forcing prompt + Groq call
db/
  schema.sql            # Postgres + pgvector schema
docker-compose.yml       # local Postgres w/ pgvector
requirements.txt
.env.example
```
