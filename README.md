<div align="center">

<img src="frontend/public/favicon.svg" width="88" height="88" alt="Folio">

# Folio

**Every claim, back to its page.**

`Folio` is a NotebookLM-style app for asking questions about your own documents: PDFs, Word files, PowerPoint decks, Markdown, text files and pasted text. Every claim in an answer **carries a citation**, and clicking it **opens the source at the cited page or slide with the passage highlighted**. It is a full-stack RAG application, a **FastAPI** backend with **Postgres/pgvector**, a **React** frontend and a free LLM (**Groq**), all started with one `docker compose up`.

[![Python](https://img.shields.io/badge/Python-3.13%2B-4cb3f0?style=flat-square&logo=python&logoColor=white&labelColor=0d3a55)](backend/pyproject.toml)
[![React](https://img.shields.io/badge/React-TypeScript-4cb3f0?style=flat-square&logo=react&logoColor=white&labelColor=0d3a55)](frontend/package.json)
[![Postgres](https://img.shields.io/badge/Postgres-pgvector-4cb3f0?style=flat-square&logo=postgresql&logoColor=white&labelColor=0d3a55)](docker-compose.yml)
[![Docker](https://img.shields.io/badge/run%20with-Docker%20Compose-4cb3f0?style=flat-square&logo=docker&logoColor=white&labelColor=0d3a55)](#option-a-docker-compose-recommended)
[![Hit@1](https://img.shields.io/badge/Hit%401-93%25-4cb3f0?style=flat-square&logo=target&logoColor=white&labelColor=0d3a55)](#evaluation)

[**Website**](https://github.swayam.li/Folio/) &nbsp;&middot;&nbsp; [How It Works](#how-it-works) &nbsp;&middot;&nbsp; [Evaluation](#evaluation) &nbsp;&middot;&nbsp; [Running Folio](#running-folio) &nbsp;&middot;&nbsp; [Limitations](#limitations)

<br>

![Workspace: sources, a cited answer, and the PDF viewer highlighting the cited passage](docs/screenshots/workspace.png)

</div>

<br>

## Table of Contents

| | |
| :--- | :--- |
| **Overview** | [Features](#features) &middot; [How It Works](#how-it-works) &middot; [Evaluation](#evaluation) |
| **Setup** | [Running Folio](#running-folio) &middot; [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended) &middot; [Option B: Development (Hot Reload)](#option-b-development-hot-reload) |
| **Reference** | [Design Decisions](#design-decisions) |
| **Trust** | [Security and Threat Model](#security-and-threat-model) &middot; [Limitations](#limitations) &middot; [Changelog: Review 1 → Review 2](#changelog-review-1--review-2) |
| **Testing** | [Verification & Testing](#verification--testing) |

<br>

## Features

| Feature | What it means |
| :--- | :--- |
| **Many kinds of source** | PDF, Word, PowerPoint, Markdown, text and pasted text, up to 50 MB each. Scanned pages are read with local OCR; slides are cited as "slide N". |
| **Cited answers** | Answers stream in with a citation on every claim. Click one to open the page with the passage highlighted; uncited answers are refused or flagged. |
| **Hybrid retrieval** | Vector plus keyword search, follow-up rewriting and a local cross-encoder reranker, with section-aware chunks and tables kept whole. |
| **Knows when it doesn't know** | A confidence badge on every answer. When nothing matches, Folio says so and shows the closest passages. |
| **Retrieval trace** | "How was this answered?" shows every candidate passage with its scores, per-stage timings and token counts. |
| **Study tools** | Cited quizzes and flashcards (export to Anki or CSV), plus a one-click study guide, FAQ, timeline or glossary. |
| **Chats and notes** | Several threads per notebook; regenerate, copy or save any answer to notes with its citations intact. |
| **Hostile-source protection** | Active or encrypted PDFs are rejected, prompt-injection passages quarantined, and optional PII masking per notebook. |
| **Accounts** | Hashed passwords, httpOnly session cookies and login rate limiting; each user sees only their own notebooks. |
| **Measured** | An evaluation harness and an in-app **Evaluation** page. See [Evaluation](#evaluation). |

All settings live in `.env`; [`.env.example`](.env.example) lists every one with its default.

<br>

## How It Works

```text
                 ┌──────────────────────── Docker Compose ───────────────────────┐
 Browser ──────► │ nginx (frontend)  ── /        → React app (static files)      │
 localhost:8080  │                   ── /api/*   → FastAPI backend ──┐           │
                 │                                                   │           │
                 │   FastAPI ── SQL + vector search ──► Postgres + pgvector      │
                 │           ── PDF files ─────────────► uploads volume          │
                 │           ── embeddings ────────────► local model (CPU)       │
                 └───────────────────────────────────────────┬───────────────────┘
                                                             └──► Groq API (LLM)
```

### Adding a Source

| | Step | What happens |
| :---: | :--- | :--- |
| 1 | **Validate** | Type by extension, then content: PDF signature and deep parse; Office files must be valid archives with no macros and a capped uncompressed size; text must decode and contain no binary data. The file is saved and the request returns at once with status `processing`. Pasted text arrives as JSON and is stored as a text file. |
| 2 | **Extract** | A background task turns the source into pages of labelled blocks (heading, body, code, table). PDFs: text page by page (PyMuPDF), OCR for pages without a text layer (RapidOCR at 200 DPI), headings and code from fonts, tables via PyMuPDF table detection. PowerPoint: one page per slide, title as heading. Word: heading styles, paragraphs and tables in order. Markdown: `#` headings, fenced code, pipe tables. Normalisation and optional PII masking run *before* chunking, so offsets, reader text and highlights always agree. |
| 3 | **Chunk and embed** | `CHUNK_STRATEGY=structured`: a heading starts a section; paragraphs are packed into chunks of up to ~800 characters without being cut; code blocks stay whole; only an over-long paragraph falls back to an overlapping window. Chunks never cross pages and record page, section title and character offsets. Each is embedded with its section title (`BAAI/bge-small-en-v1.5`, local). |
| 4 | **Store** | Chunks and their 384-dimension vectors go into Postgres (plus, for non-PDF sources, the page text the reader view shows). The document becomes `ready` and its summary is written in the background. `POST /api/documents/{id}/reindex` (or `python -m app.reindex`) re-chunks existing documents after the strategy changes. |

### Asking a Question

```mermaid
flowchart LR
    Q[Question + history] --> P["Plan (1 small LLM call)<br/>rewrite · 2 variants · HyDE?"]
    P --> E[Embed queries<br/>bge-small, local]
    E --> V[Vector search<br/>per query]
    E --> K[Keyword search<br/>per query]
    V --> F[RRF fuse<br/>top 30]
    K --> F
    F --> R[Cross-encoder rerank<br/>MiniLM, local]
    R --> G{Confidence gate}
    G -- low --> A[Abstain:<br/>closest passages]
    G -- ok --> L[LLM streams answer<br/>with C1..C6 markers]
    L --> C[Parse citations]
    C --> S[(Answer + trace)]
    A --> S
```

| | Step | What happens |
| :---: | :--- | :--- |
| 1 | **Plan** | One small JSON-mode Groq call (low reasoning effort, cached) rewrites a follow-up into a standalone question using recent history and writes two paraphrases (optionally a hypothetical answer, HyDE). Skipped when there's nothing to do; on a rate limit or bad output, the question is searched as asked. |
| 2 | **Search** | Every query is embedded locally and runs a cosine-similarity search (pgvector, HNSW) and a PostgreSQL full-text search over the selected sources. All rankings merge with reciprocal rank fusion into 30 candidates. |
| 3 | **Rerank** | A local cross-encoder (`cross-encoder/ms-marco-MiniLM-L6-v2`) reads the question with each candidate and reorders them; the top six go on. |
| 4 | **Confidence gate** | High confidence needs a strong reranker score. Low confidence needs two weak signals, a low reranker score *and* low embedding similarity, because cross-encoders score a correct passage worded unlike the question near zero. On low confidence the answer abstains and shows the closest passages, unless the question is about the sources as a whole ("summarize", "key points"). |
| 5 | **Answer** | Excerpts go to the LLM labelled `[C1]…[C6]` (with file, page and section), with recent history and instructions to cite every claim as `[[C1]]`. Stage names, then the answer, stream to the browser over Server-Sent Events. |
| 6 | **Save** | Citation markers are parsed into structured sources and saved with the message, its confidence and the full retrieval trace. |

### Generating a Quiz or Flashcards

Excerpts are chosen within a budget that fits Groq's free tier (8,000 tokens per minute): the best hybrid-search matches for a focus topic, otherwise an even spread across the selected sources. The model returns JSON in which every item cites an excerpt label; malformed items and items citing a missing excerpt are dropped, answer positions are shuffled, and each citation resolves to a file and page.

<br>

## Evaluation

Every retrieval stage was measured, not assumed. The harness in `backend/eval/` ingests four sample PDFs from `docs/samples/` (a networking lecture, an operating-systems chapter, a synthetic research study and a fictional campus policy, 20 pages in all) and asks 50 questions with known answer pages: factual, exact-term, paraphrased, follow-up (with chat history) and 7 that the documents can't answer. It runs the real pipeline once per configuration, adding one stage at a time.

![Retrieval quality by configuration](docs/eval/chart.png)

| Configuration | Hit@1 | Hit@3 | MRR | Unanswerable refused | Answerable refused |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Vector search only (v1 baseline) | 77% | 88% | 0.830 | 0% | 0% |
| + keyword search (RRF) | 74% | 88% | 0.821 | 0% | 0% |
| + query rewrite | 77% | 93% | 0.847 | 0% | 0% |
| + multi-query | 72% | 95% | 0.830 | 0% | 0% |
| + reranker & confidence gate | 91% | 95% | 0.937 | 43% | 0% |
| + structure-aware chunks (v2) | **93%** | **98%** | **0.952** | 29% | 0% |

With the full pipeline, answers were graded by a second model (`openai/gpt-oss-20b`): **96%** of citations point to a correct page, **95%** of claims are supported by the cited excerpts, **96%** of expected key facts are stated, and **all 7** unanswerable questions were handled (two refused by the confidence gate, five declined by the model).

| Finding | Detail |
| :--- | :--- |
| **The reranker is the biggest single win** | Hit@1 72% → 91%. The stages before it widen the net (Hit@3 rises) but put more near-misses at the top; the cross-encoder sorts them. |
| **Query rewriting fixes follow-ups** | ("How did the older Tahoe variant differ?") Hit@3 on follow-ups rises from 40% to 80%, and to 100% with structured chunks. |
| **Keyword search alone didn't help this corpus** | It lifted exact-term questions to 100% Hit@3 but cost a follow-up and one top-1 hit. It is kept for exact codes and names; later stages more than recover the loss. |
| **The confidence gate is deliberately cautious** | It never refused an answerable question. It catches clearly off-topic questions; borderline ones are left to the model, which declined all of them here. |
| **Cost** | Reranking 30 passages is the most expensive local step (about 5 s on the test laptop's busy CPU, well under a second on a typical server); planning adds one Groq call of about 1.4 s. |

The full report, including results by question type and per-stage latency, is in [`docs/eval/results.md`](docs/eval/results.md); every per-question result and graded answer is in `backend/eval/results/latest.json`. The same summary is on the in-app **Evaluation** page.

<details>
<summary><b>Reproduce it</b> (from <code>backend/</code>, against a migrated database)</summary>

```bash
python -m eval.build_samples             # (re)build docs/samples/*.pdf (deterministic)
python -m eval.run_eval --answers final  # ~30 min on Groq's free tier, ~120k tokens
python -m eval.run_eval --smoke          # no LLM, 12 questions
```

</details>

<br>

## Running Folio

### Option A: Docker Compose (Recommended)

Needs Docker Desktop and a free Groq API key from <https://console.groq.com/keys>.

**1. Create the config**

```bash
cp .env.example .env
```

**2. Set `GROQ_API_KEY` and `JWT_SECRET` in `.env`**

For `JWT_SECRET`, any long random string works:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

> [!IMPORTANT]
> `JWT_SECRET` signs every session cookie: anyone who knows it can forge one. The backend refuses to start while it is empty or still the placeholder from `.env.example`.

**3. Start it**

```bash
docker compose up --build
```

**4. Open <http://localhost:8080> and create an account**

> [!NOTE]
> The first build takes several minutes: it downloads CPU-only PyTorch and the embedding model (~130 MB) into the image. After that, the app needs no internet access except for calls to Groq.

> [!WARNING]
> Data persists in two Docker volumes, `pgdata` (database) and `uploads` (files). `docker compose down` keeps them; `docker compose down -v` deletes everything.

### Option B: Development (Hot Reload)

Run the database in Docker and the app on your machine, with hot reload for the frontend.

**1. Start the database** (Postgres on `127.0.0.1:5432`)

```bash
docker compose up -d db
```

**2. Run the backend** (API on `:8000`)

```bash
cd backend
uv sync                                 # Python dependencies
uv run alembic upgrade head             # create / update tables
uv run uvicorn app.main:app --port 8000
```

**3. Run the frontend** (in a second terminal, from the repo root; app on <http://localhost:5173>)

```bash
cd frontend
npm install
npm run dev
```

> [!TIP]
> Vite forwards `/api` to `http://localhost:8000`; to use another port, start it with `API_TARGET=http://localhost:8001 npm run dev`. Interactive API docs are at <http://localhost:8000/docs>. Set `LOG_FORMAT=text` for readable logs.

The backend reads the `.env` at the repository root. After changing the database models, add a migration in `backend/alembic/versions/`.

<br>

## Design Decisions

| Decision | Why |
| :--- | :--- |
| **Local embeddings, hosted LLM** | Embedding every chunk is the high-volume step, so it runs locally for free; only answer generation calls Groq. |
| **Citations as markers, not free text** | Numbering excerpts and requiring `[[Cn]]` markers turns citations into data the UI can link to a page. Models don't always follow the format exactly (gpt-oss prefers `【C1】`), so backend and frontend both normalise variants and drop markers that don't match a retrieved excerpt. |
| **Highlighting across parsers** | The backend extracts text with PyMuPDF and the browser renders with pdf.js; their whitespace differs. The viewer compares text with whitespace removed to find the cited passage reliably. |
| **Background processing** | Embedding a long PDF takes seconds to minutes, so uploads return immediately and the UI polls status. Jobs interrupted by a restart are marked failed on startup instead of staying "processing" forever. |
| **Planning can only help** | Rewrite, paraphrases and HyDE share one small LLM call that is cached and skipped when there's nothing to do. Any failure, including a free-tier rate limit, falls back to searching the question as asked. |
| **A cautious abstention gate** | Cross-encoder scores are sharply polarised: in testing, correct passages phrased unlike the question scored ~0.0001, the same as unrelated ones. So Folio only refuses when the reranker *and* the embedding similarity are both weak, and never for whole-source questions such as summaries. |
| **Same-origin cookies** | nginx serves the app and proxies the API, so the session cookie is `httpOnly` and `SameSite=Lax` with no CORS setup. |

<br>

## Security and Threat Model

Uploaded files and all extracted text are untrusted. Folio never builds storage paths from filenames, checks ownership on every document and notebook route, parses the full PDF before accepting it, rejects active content, and keeps suspicious chunks out of both retrieval and the model context. Source blocks are explicitly delimited and the model is told never to follow instructions inside them. The scanner is intentionally explainable and conservative: it records the matched rule on each document rather than silently deleting the whole source.

> [!IMPORTANT]
> PII masking affects indexed chunks sent to search and the LLM; the original file is retained so citations can still open it. It is a prompt and privacy control, not encrypted document redaction.

> [!WARNING]
> Regex and heuristic scanners cannot guarantee detection of every obfuscated injection or identifier. Production deployments should also isolate ingestion workers, use TLS and object storage, add durable queues and per-user quotas, rotate secrets, and monitor abuse.

<br>

## Limitations

| Area | Limitation |
| :--- | :--- |
| **OCR'd pages** | They have no text layer in the viewer, so their citations open the right page without highlighting the passage. |
| **Generated quizzes** | Usually right but not guaranteed; each answer shows its explanation and source page so it can be checked. |
| **Accounts** | No password reset or email verification. Notebooks can't be shared between users. |
| **Scale** | One backend process: the login rate limiter is in memory and files live on a local volume, so it isn't set up for multiple servers. PDF ingestion runs as an in-process background task; a production deployment should move OCR and embedding to a bounded durable worker queue. |
| **Groq free tier** | Rate limits apply; when hit, the app shows how long to wait. Query planning adds one small call per question (skipped when unnecessary and cached). |
| **Headings and tables** | Heading detection relies on font size and weight, so PDFs that style headings like body text are chunked by paragraph without section titles. PDF table detection needs ruled (bordered) tables; borderless tables stay as text. |
| **Office files** | Word and PowerPoint sources open in a text reader, not their original layout (no slide designs or images). `.doc`/`.ppt` and macro-enabled files aren't accepted; web links aren't supported yet. |
| **Confidence gate** | Refuses only clearly off-topic questions (4 of 7 in the evaluation); the model handles the rest. Thresholds were tuned so that no answerable question was refused, with a small margin on this small set. |
| **Reranking speed** | Runs on the CPU and is the slowest local step (about 5 s for 30 passages on a busy laptop). `RETRIEVE_K` trades recall for speed. |
| **Evaluation size** | 50 questions over 20 pages, so a single question moves a percentage by two or three points. |
| **Safety layers** | PII and injection detection are deterministic, not guarantees; unusual formats and adversarial obfuscation may evade them. |

<br>

## Changelog: Review 1 → Review 2

Folio v2 is being built in phases (retrieval upgrades, evaluation, a new workspace UI, study tools, a security layer).

<details>
<summary><b>Phase 1: Foundations</b></summary>

- Design system: tokens for three themes (Light, Dark, Aurora), eight source colors, shape, depth and motion; self-hosted fonts; theme menu with an animated circular reveal; Calm mode; living style guide at `/design`.
- Automated WCAG AA contrast checks for every theme.
- Structured JSON logging with request ids and per-stage answer timings.
- Feature flags (`ENABLE_*`, `GET /api/features`); hybrid search can be switched off as the evaluation baseline.
- Test suites (pytest, Vitest + Testing Library), ruff and mypy, and a GitHub Actions pipeline (since removed; run the checks locally, see [Verification & Testing](#verification--testing)).
- Fixed: an explicit chunk overlap of `0` was silently replaced by the default (found by the new chunking tests). The database port is now bound to localhost only.

</details>

<details>
<summary><b>Phase 2: RAG core</b></summary>

- Query planning: conversation-aware rewrite, multi-query expansion and optional HyDE in one cached, rate-limit-tolerant LLM call.
- Every query runs vector + keyword search; all rankings fuse with RRF.
- Local cross-encoder reranking of the top 30 candidates (baked into the Docker image).
- Structure-aware chunking with section titles, character offsets and contextual embeddings; re-index endpoint and `python -m app.reindex`.
- Source filtering: per-source checkboxes restrict what chat searches.
- Confidence badge and grounded abstention with the closest passages.
- Retrieval trace stored with every answer (`GET /api/messages/{id}/trace`) and shown under "How was this answered?"; live stage labels while an answer is prepared.
- Migration `0003`. Feature flags `ENABLE_QUERY_REWRITE`, `ENABLE_MULTI_QUERY`, `ENABLE_HYDE`, `ENABLE_RERANKER`, `ENABLE_ABSTENTION`.

</details>

<details>
<summary><b>Phase 3: Evaluation</b></summary>

- Four sample PDFs (`docs/samples/`, generated reproducibly) and a 50-question dataset with gold pages, key facts and question types.
- `python -m eval.run_eval`: runs the configuration ladder through the real pipeline; reports Hit@1/3/6, MRR, abstention on both sides and per-stage latency, and optionally citation precision, faithfulness and key-fact recall graded by a second LLM. Paced for Groq's free tier, with retries and `--retry-failed`.
- Results: Hit@1 77% → 93%, Hit@3 88% → 98%, MRR 0.83 → 0.95 from the v1 baseline to the full pipeline (see [Evaluation](#evaluation)).
- Markdown report and chart in `docs/eval/`; read-only **Evaluation** page (`/evaluation`, `GET /api/eval/results`); a no-LLM smoke run.
- Fixed: ligatures in PDFs ("ﬁ" for "fi") are now expanded, so keyword search matches words such as "find" and "office". The local `DATABASE_URL` now uses `127.0.0.1`, which avoids a ~2 s IPv6 fallback per connection on Windows.

</details>

<details>
<summary><b>Phase 4: Workspace UI</b></summary>

- Three responsive panes, source scoping, live pipeline theater, citation hover cards, PDF page jumps and highlights, Retrieval Inspector and citations audit.
- Command palette, mobile tabs, Calm mode, source colors and accessible themes.
- Page-jump commands are generated from the typed page number instead of materializing every page of every PDF.

</details>

<details>
<summary><b>Phase 7: Source security (first complete slice)</b></summary>

- Migration `0004` adds per-chunk quarantine and risk reasons, per-document risk and PII summaries, plus the per-notebook PII masking option.
- Rejects encrypted, malformed, over-page-limit, embedded-file, JavaScript and launch-action PDFs; normalizes invisible Unicode before embedding.
- Quarantines high-confidence prompt injection and isolates excerpts in the LLM prompt. Claim-level valid-citation coverage is stored in the retrieval trace; completely uncited generations are refused and partial coverage is warned.

</details>

<br>

## Verification & Testing

**Backend** (from `backend/`)

```bash
uv sync --group dev
uv run ruff check .                     # lint
uv run mypy                             # type check (typed modules listed in pyproject.toml)
uv run pytest --cov                     # unit tests
TEST_DATABASE_URL=postgresql+asyncpg://raguser:ragpass@127.0.0.1:5432/notebooklm uv run pytest   # plus API tests
uv run python -m eval.run_eval --smoke  # evaluation without LLM stages
```

**Frontend** (from `frontend/`)

```bash
npm run lint                            # oxlint
npm run typecheck                       # tsc
npm test                                # Vitest + Testing Library (incl. WCAG contrast of every theme)
```

> [!NOTE]
> Tests marked `db` are skipped when no migrated Postgres is reachable, so the unit tests run anywhere. The GitHub Actions CI workflow was removed (commit `83f2509`), so these checks now run only when you run them.
