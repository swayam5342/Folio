# Folio

Folio is a NotebookLM-style app for asking questions about your own documents:
PDFs, Word files, PowerPoint decks, Markdown, text files and pasted text. You
add sources to a notebook, ask questions in a chat, and every claim in the
answer is marked with a citation. Clicking a citation opens the source at the
cited page or slide (or, for Word and text sources, in a reader view) with the
supporting passage highlighted.

It is a full-stack retrieval-augmented generation (RAG) application: a FastAPI
backend with Postgres/pgvector, a React frontend, and a free LLM (Groq), all
started with one `docker compose up`.

![Workspace: sources, a cited answer, and the PDF viewer highlighting the cited passage](docs/screenshots/workspace.png)

## Features

- **Accounts.** Username and password sign-in. Each user only sees their own
  notebooks, files and chats.
- **Notebooks.** Create, rename and delete notebooks; each holds its own set of
  sources and its own chat.
- **Many kinds of source.** Drag-and-drop PDF, Word (`.docx`), PowerPoint
  (`.pptx`), Markdown and text files (up to 50 MB each), or paste text with a
  title. Files are stored and indexed in the background, with a live
  "processing → ready / failed" status. Scanned PDF pages with no text layer
  are read with OCR (RapidOCR, runs locally and offline). PowerPoint slides are
  cited as "slide N" (speaker notes included); Word, Markdown and text sources
  are cited by section and open in a reader view with the passage highlighted.
- **Source summaries.** After indexing, each source gets a short overview
  (one small Groq call), shown in the Sources panel and given to the model as
  orientation for "summarize everything" questions.
- **Tables kept whole.** Tables in PDFs, Word, PowerPoint and Markdown become
  Markdown tables and are chunked on their own (large ones split by rows with
  the header repeated), so answers can read rows and columns.
- **Cited answers.** Answers stream in word by word. Folio measures valid
  citation coverage, refuses completely uncited generations and warns on
  partially uncited answers. Hovering a numbered citation shows the source snippet; clicking opens the
  page in the built-in PDF viewer with the passage highlighted.
- **Quizzes and flashcards.** Generate a multiple-choice quiz (5, 10 or 15
  questions, easy / medium / hard) or a flashcard deck (10, 20 or 30 cards)
  from chosen sources and an optional focus topic. Every question and card
  cites its source; sets and quiz scores are saved per notebook. After a quiz,
  **Review mistakes** replays only the questions you got wrong; flashcards can
  be marked *Got it* / *Still learning* and the missed ones reviewed again.
  Decks export to **Anki** (tab-separated import file) or **CSV**.
- **Studio.** One click writes a **study guide**, **FAQ**, **timeline** or
  **glossary** from the sources, every item with a citation chip that opens the
  passage. A timeline is refused politely when the sources have no dated or
  ordered events. Any studio document can be copied or saved to notes.
- **Notebook overview.** Before the first question, the chat shows each
  source's summary and suggested questions (written with the summary, no extra
  LLM call) that you can click to ask.
- **Chats and notes.** A notebook can hold several chat threads (each named
  after its first question; rename, clear or delete). The latest answer can be
  **regenerated** (skipping the answer cache), any answer **copied with its
  source list**, or **saved to notes**: saved answers keep working citation
  chips, and you can write your own notes too.
- **Exact-term search.** Retrieval combines meaning-based vector search with
  keyword search, so course codes and function names find the right page.
- **Smarter retrieval.** Follow-ups ("why is it slower?") are rewritten into
  standalone questions and a local cross-encoder reranks the candidates. Each
  chosen passage is given to the model with the chunks just before and after it
  (same page and section), so it reads whole thoughts rather than cut-off
  excerpts. Multi-query paraphrasing is available but off by default (it lowered
  Hit@1 once reranking was on).
- **Answer cache.** Asking the same question again over unchanged sources
  returns the stored answer instantly (`ENABLE_ANSWER_CACHE`). Follow-ups are
  matched on their rewritten, standalone form; adding, removing or re-indexing
  a source invalidates old answers. Queries use BGE's asymmetric search
  instruction; summaries use a larger, source-balanced context while focused
  questions use a compact de-duplicated context.
- **Section-aware chunks.** Headings and code blocks are detected from the
  PDF's fonts; chunks follow sections and paragraphs and carry their section
  title, which is embedded with them.
- **Choose your sources.** Tick the sources a question should search; the rest
  are ignored for that answer.
- **Knows when it doesn't know.** Each answer shows a confidence badge. When
  nothing in the sources matches, Folio says so and lists the closest
  passages instead of guessing.
- **"How was this answered?"** Every answer opens a retrieval trace: the
  rewritten query and variants, every candidate passage with its vector,
  keyword, fused and rerank scores, which ones the model saw, per-stage
  timings and token counts.
- **Measured, not claimed.** An evaluation harness runs 50 questions over four
  sample PDFs through the real pipeline, adding one stage at a time, and
  reports Hit@k, MRR, abstention, citation precision, faithfulness and
  latency. Results are in [Evaluation](#evaluation) and on the in-app
  **Evaluation** page (`/evaluation`).
- **Follow-up questions.** Chat history is saved per notebook and the last few
  turns are sent with each question, so "tell me more about that" works.
- **Grounded by design.** The model is instructed to answer only from the
  retrieved excerpts and to say so when they don't contain the answer.
- **PDF viewer toolbar.** Page jump, zoom (50–300 %), search inside the PDF
  (every matching page listed, matches highlighted), a sidebar of lazily
  rendered page thumbnails or the PDF's own contents, and download.
- **Live indexing progress.** While a source is processed the Sources panel
  shows what is happening: "Reading page 12 of 240", "OCR on page 3 of 40",
  "Embedding 96 of 480 passages", with a progress bar.
- **Production touches.** Hashed passwords, httpOnly session cookies, login
  rate limiting, database migrations, upload validation, graceful handling of
  the LLM's free-tier rate limits, and a mobile layout.
- **Hostile-source protection.** PDFs are deeply parsed before storage, with
  encrypted files, active scripts/launch actions, embedded files and excessive
  page counts rejected. Invisible Unicode is normalized; likely prompt-injection
  passages are quarantined; optional per-notebook masking covers Aadhaar, PAN,
  email and Indian phone numbers. The source list explains detected risks.
- **Design system.** One set of tokens drives three themes (Light, Dark and the
  bold Aurora), eight persistent source colors, self-hosted variable fonts
  (Fraunces, Inter, JetBrains Mono), glass/grain/glow depth effects and spring
  motion. A **Calm mode** turns off grain and animation, and reduced-motion
  settings are respected. Every text/background pairing is checked against
  WCAG AA in CI. The living style guide is at `/design` (no sign-in needed).
- **Observability.** Structured JSON logs with a request id on every line
  (echoed as `X-Request-ID`), one log line per request with status and
  duration, and per-stage timings (plan, embed, search, rerank, generate) for
  each answer.
- **Feature flags.** Optional pipeline stages can be switched off in `.env`
  (`ENABLE_*`) so the evaluation harness can measure what each one adds;
  `GET /api/features` reports the active set.

## How it works

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

### Adding a source

1. The backend checks the file (type by extension, then content: PDF
   signature and deep parse; Office files must be valid archives with no
   macros and a capped uncompressed size; text must decode and contain no
   binary data), saves it to disk, and returns immediately with status
   `processing`. Pasted text arrives as JSON and is stored as a text file.
2. A background task turns the source into pages of labelled blocks
   (heading, body, code, table). PDFs: text page by page (PyMuPDF), OCR for
   pages without a text layer (RapidOCR at 200 DPI), headings and code from
   fonts, tables via PyMuPDF table detection. PowerPoint: one page per slide,
   the title as heading. Word: heading styles, paragraphs and tables in order.
   Markdown: `#` headings, fenced code, pipe tables. Normalisation and optional
   PII masking run on these blocks *before* chunking, so chunk offsets, the
   stored reader text and the highlights always agree.
3. Structure-aware chunking (`CHUNK_STRATEGY=structured`): a heading starts a
   section; paragraphs are packed into chunks of up to ~800 characters without
   being cut; code blocks stay whole; only an over-long paragraph falls back to
   an overlapping window. Chunks never cross pages and record their page,
   section title and character offsets. Each chunk is embedded together with
   its section title (`BAAI/bge-small-en-v1.5`, running locally).
4. Chunks and their 384-dimension vectors are stored in Postgres (and, for
   non-PDF sources, the page text the reader view shows); the document
   becomes `ready` and its summary is written in the background. `POST /api/documents/{id}/reindex` (or
   `python -m app.reindex`) re-chunks existing documents after the strategy
   changes.

### Asking a question

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

1. **Plan.** One small JSON-mode Groq call (low reasoning effort, cached)
   rewrites a follow-up into a standalone question using recent history and
   writes two paraphrases (optionally a hypothetical answer, HyDE). It is
   skipped when there's nothing to do; on a rate limit or bad output, the
   question is searched as asked.
2. **Search.** Every query is embedded locally. Each runs a cosine-similarity
   search (pgvector, HNSW) and a PostgreSQL full-text search over the
   selected sources; all rankings are merged with reciprocal rank fusion into
   30 candidates.
3. **Rerank.** A local cross-encoder (`cross-encoder/ms-marco-MiniLM-L6-v2`)
   reads the question with each candidate and reorders them; the top six go
   on.
4. **Confidence gate.** High confidence needs a strong reranker score. Low
   confidence needs two weak signals: a low reranker score *and* low
   embedding similarity, because cross-encoders score a correct passage worded
   unlike the question near zero. On low confidence the answer abstains and
   shows the closest passages, unless the question is about the sources as a
   whole ("summarize", "key points").
5. **Answer.** The excerpts go to the LLM labelled `[C1]…[C6]` (with their
   file, page and section), together with recent chat history and
   instructions to cite every claim as `[[C1]]`. Stage names, then the answer,
   stream to the browser over Server-Sent Events.
6. The citation markers are parsed into structured sources, saved with the
   message, its confidence, and the full retrieval trace.

### Generating a quiz or flashcards

1. Excerpts are chosen within a budget that fits Groq's free tier (8,000
   tokens per minute): with a focus topic, the best hybrid-search matches;
   without one, an even spread across the selected sources.
2. The model returns JSON in which every item cites an excerpt label.
3. The backend drops malformed items or items citing a missing excerpt,
   shuffles answer positions, resolves each citation to a file and page, and
   saves the set.

## Evaluation

Every retrieval stage was measured, not assumed. The harness in
`backend/eval/` ingests four sample PDFs from `docs/samples/` (a networking
lecture, an operating-systems chapter, a synthetic research study and a
fictional campus policy, 20 pages in all) and asks 50 questions with known
answer pages: factual, exact-term, paraphrased, follow-up (with chat history)
and 7 that the documents can't answer. It runs the real pipeline once per
configuration, adding one stage at a time.

![Retrieval quality by configuration](docs/eval/chart.png)

| Configuration | Hit@1 | Hit@3 | MRR | Unanswerable refused | Answerable refused |
|---|---:|---:|---:|---:|---:|
| Vector search only (v1 baseline) | 77% | 88% | 0.830 | 0% | 0% |
| + keyword search (RRF) | 74% | 88% | 0.821 | 0% | 0% |
| + query rewrite | 77% | 93% | 0.847 | 0% | 0% |
| + multi-query | 72% | 95% | 0.830 | 0% | 0% |
| + reranker & confidence gate | 91% | 95% | 0.937 | 43% | 0% |
| + structure-aware chunks (v2) | **93%** | **98%** | **0.952** | 29% | 0% |

With the full pipeline, answers were generated with the chat prompt and graded
by a second model (`openai/gpt-oss-20b`): **96%** of citations point to a
correct page, **95%** of claims are supported by the cited excerpts, **96%**
of expected key facts are stated, and **all 7** unanswerable questions were
handled: two refused by the confidence gate, five declined by the model.

What the numbers say:

- **The reranker is the biggest single win** (Hit@1 72% → 91%). The stages
  before it widen the net (Hit@3 rises) but put more near-misses at the top;
  the cross-encoder sorts them.
- **Query rewriting fixes follow-ups** ("How did the older Tahoe variant
  differ?"): Hit@3 on follow-up questions rises from 40% to 80%, and to 100%
  with structured chunks.
- **Keyword search alone didn't help this corpus.** It lifted exact-term
  questions to 100% Hit@3 but cost a follow-up and one top-1 hit. It is kept
  for exact codes and names, and the later stages more than recover the loss.
- **The confidence gate is deliberately cautious:** it never refused an
  answerable question. It catches clearly off-topic questions; borderline
  ones are left to the model, which declined all of them here.
- **Cost:** reranking 30 passages is the most expensive local step (about 5 s
  on the test laptop's busy CPU, well under a second on a typical server);
  planning adds one Groq call of about 1.4 s.

The full report, including results by question type and per-stage latency, is
in [`docs/eval/results.md`](docs/eval/results.md); every per-question result
and graded answer is in `backend/eval/results/latest.json`. The same summary
is on the in-app **Evaluation** page.

Reproduce it from `backend/` against a migrated database:

```bash
python -m eval.build_samples           # (re)build docs/samples/*.pdf (deterministic)
python -m eval.run_eval --answers final  # ~30 min on Groq's free tier, ~120k tokens
python -m eval.run_eval --smoke        # no LLM, 12 questions; what CI runs
```

## Running it

**Requirements:** Docker Desktop, and a free Groq API key from
<https://console.groq.com/keys>.

```bash
cp .env.example .env
```

Edit `.env` and set:

- `GROQ_API_KEY` — your Groq key.
- `JWT_SECRET` — any long random string. To generate one:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`

Then:

```bash
docker compose up --build
```

Open <http://localhost:8080> and create an account.

The first build takes several minutes: it downloads CPU-only PyTorch and the
embedding model (~130 MB) into the image. After that, the app needs no
internet access except for calls to Groq.

Data persists in two Docker volumes, `pgdata` (database) and `uploads` (PDF
files). `docker compose down` keeps them; `docker compose down -v` deletes
everything.

## Development

Run the database in Docker and the app on your machine, with hot reload for the
frontend. Requires [uv](https://docs.astral.sh/uv/) and Node.js 22+.

```bash
docker compose up -d db                 # Postgres on localhost:5432

cd backend
uv sync                                 # Python dependencies
uv run alembic upgrade head             # create / update tables
uv run uvicorn app.main:app --port 8000 # API on :8000

cd frontend                             # in a second terminal, from the repo root
npm install
npm run dev                             # app on http://localhost:5173
```

Vite forwards `/api` to `http://localhost:8000`; to use another port, start it
with `API_TARGET=http://localhost:8001 npm run dev`. Interactive API docs are at
<http://localhost:8000/docs>.

The backend reads the `.env` at the repository root. After changing the database
models, add a migration in `backend/alembic/versions/`. Set `LOG_FORMAT=text`
for readable logs while developing.

### Tests and checks

The same checks run in GitHub Actions (`.github/workflows/ci.yml`) on every push
and pull request, followed by a build of both Docker images.

```bash
cd backend
uv sync --group dev
uv run ruff check .                     # lint
uv run mypy                             # type check (typed modules listed in pyproject.toml)
uv run pytest --cov                     # unit tests; API tests need a database:
TEST_DATABASE_URL=postgresql+asyncpg://raguser:ragpass@127.0.0.1:5432/notebooklm uv run pytest
uv run python -m eval.run_eval --smoke  # evaluation without LLM stages (what CI runs)

cd frontend
npm run lint                            # oxlint
npm run typecheck                       # tsc
npm test                                # Vitest + Testing Library (incl. WCAG contrast of every theme)
```

Tests marked `db` are skipped when no migrated Postgres is reachable, so the
unit tests run anywhere.

## Configuration

All settings come from `.env` (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | — | Required. Groq key for answer generation. |
| `JWT_SECRET` | — | Required. Signs session cookies; startup fails without it. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Chat model on Groq. |
| `POSTGRES_PASSWORD` | `ragpass` | Database password used by Docker Compose. |
| `DATABASE_URL` | localhost | Database URL when running the backend outside Docker. |
| `MAX_UPLOAD_MB` | `50` | Largest accepted file (or pasted text). |
| `MAX_PDF_PAGES` | `1000` | Maximum pages accepted after parsing. |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS. |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | `BAAI/bge-small-en-v1.5` / `384` | Local embedding model. |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `800` / `150` | Chunking, in characters. |
| `CHUNK_STRATEGY` | `structured` | `structured` (sections and paragraphs) or `fixed` (plain window). Re-index after changing. |
| `TOP_K` | `6` | Excerpts given to the model per question. |
| `BROAD_TOP_K` | `12` | Source-balanced excerpt budget for summaries and overviews. |
| `CONTEXT_MAX_CHARS` | `18000` | Hard character budget for assembled source context. |
| `MAX_CHUNKS_PER_DOCUMENT` | `4` | Diversity cap before fallback fills unused context. |
| `RETRIEVE_K` | `30` | Candidates per search, and how many the reranker scores. |
| `QUERY_VARIANTS` | `2` | Paraphrases searched alongside the question. |
| `RERANKER_MODEL` | `cross-encoder/ms-marco-MiniLM-L6-v2` | Local cross-encoder (`BAAI/bge-reranker-base` is more accurate, ~10× slower). |
| `CONFIDENCE_HIGH` / `CONFIDENCE_LOW` | `0.5` / `0.01` | Reranker score (0-1) for high confidence / below which (with low similarity) the answer abstains. |
| `SIMILARITY_HIGH` / `SIMILARITY_LOW` | `0.75` / `0.60` | Embedding-similarity thresholds for the same gate (tuned on the eval set: no answerable question refused). |
| `HISTORY_MESSAGES` | `6` | Previous messages sent for follow-up context. |
| `LOG_LEVEL` | `INFO` | Log level. |
| `LOG_FORMAT` | `json` | `json` (one object per line) or `text` (readable, for development). |
| `ENABLE_HYBRID_SEARCH` | `true` | `false` = vector search only, the evaluation baseline. |
| `ENABLE_QUERY_REWRITE` | `true` | Rewrite follow-ups into standalone questions. |
| `ENABLE_MULTI_QUERY` | `false` | Also search `QUERY_VARIANTS` paraphrases (off: it lowered Hit@1 with reranking on). |
| `ENABLE_HYDE` | `false` | Also search with a hypothetical answer (costs extra tokens). |
| `ENABLE_RERANKER` | `true` | Cross-encoder reranking. |
| `ENABLE_ABSTENTION` | `true` | Say "not in your sources" on low confidence instead of answering. |
| `ENABLE_CITATION_CHECK` | `true` | Verify cited claim/excerpt pairs with the local cross-encoder. |
| `MIN_CITATION_COVERAGE` | `0.8` | Minimum fraction of substantive claims with a valid citation before warning. |
| `ENABLE_PROMPT_INJECTION_SCAN` | `true` | Quarantine high-risk instructions embedded in source text. |
| `ENABLE_PII_REDACTION` | `true` | Enable per-notebook masking while indexing. |
| `ENABLE_NEIGHBOR_EXPANSION` | `true` | Give the model the chunks around each chosen passage (same page and section). |
| `ENABLE_ANSWER_CACHE` | `true` | Reuse stored answers for repeat questions over unchanged sources (always off in the eval harness). |
| `ENABLE_SOURCE_SUMMARIES` | `true` | Write a short summary of each source after indexing (one Groq call per source). |
| `EVAL_RESULTS_PATH` | `backend/eval/results/latest.json` | Results file served to the Evaluation page. |

## API

All endpoints are under `/api`. Authentication is a session cookie set by
register/login. Resources owned by another user return `404`. Every response
carries an `X-Request-ID` header (a well-formed incoming one is reused), which
matches the `request_id` in the server logs.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create an account and sign in |
| `POST` | `/auth/login` | Sign in (10 failed attempts per 15 min → `429`) |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user |
| `GET` `POST` | `/notebooks` | List / create notebooks |
| `GET` `PATCH` `DELETE` | `/notebooks/{id}` | Get / rename / delete a notebook |
| `GET` `POST` | `/notebooks/{id}/documents` | List / upload sources (`.pdf`, `.docx`, `.pptx`, `.md`, `.txt`) |
| `POST` | `/notebooks/{id}/documents/text` | Add pasted text (`{"title", "text"}`) as a source |
| `GET` `DELETE` | `/documents/{id}` | Document status (incl. `kind`, `summary`) / delete |
| `GET` | `/documents/{id}/file` | The original file (PDFs inline, others as a download) |
| `GET` | `/documents/{id}/pages` | Page text of a non-PDF source with block offsets, for the reader view |
| `POST` | `/documents/{id}/reindex` | Re-chunk and re-embed with the current `CHUNK_STRATEGY` (`409` while processing) |
| `GET` `POST` | `/notebooks/{id}/threads` | List (most recent first) / create chat threads |
| `PATCH` `DELETE` | `/threads/{id}` | Rename / delete a thread |
| `GET` `DELETE` | `/threads/{id}/messages` | A thread's messages / clear it |
| `DELETE` | `/messages/{id}` | Remove a thread's latest message (before regenerating; `409` otherwise) |
| `GET` `DELETE` | `/notebooks/{id}/messages` | Every message in the notebook / clear all |
| `POST` | `/notebooks/{id}/chat` | Ask a question (`{"question", "document_ids"?, "thread_id"?, "regenerate"?}`); streams `stage` and `token` events, then `done` or `error` |
| `GET` `POST` | `/notebooks/{id}/notes` | List / create notes (`{"title", "content", "sources"?}`) |
| `PATCH` `DELETE` | `/notes/{id}` | Edit / delete a note |
| `GET` | `/messages/{id}/trace` | Retrieval trace of an answer: queries, candidates with all scores, timings, tokens |
| `GET` `POST` | `/notebooks/{id}/study-sets` | List / generate quizzes, flashcards, study guides, FAQs, timelines and glossaries (`{"kind", "count", "difficulty"?, "topic"?, "document_ids"?}`) |
| `GET` `DELETE` | `/study-sets/{id}` | Open / delete a study set |
| `POST` | `/study-sets/{id}/score` | Save a quiz score |
| `GET` | `/eval/results` | Latest evaluation summary (public; sample corpus only) |
| `GET` | `/health` | Liveness check |
| `GET` | `/features` | Active feature flags (`{"hybrid_search": true, ...}`) |

## Project layout

```text
backend/                   FastAPI backend (Python, managed with uv)
  app/
    main.py                app setup, startup tasks
    reindex.py             CLI: re-index documents after a chunking change
    config.py              settings and feature flags from the root .env
    observability.py       JSON logging, request ids, stage timer
    models.py              User, Notebook, Document, Chunk, Message
    security.py            password hashing, session tokens, login rate limit
    deps.py                current user + ownership checks
    routers/               auth, notebooks, documents, chat, threads, notes, study
    services/
      ingest.py            background processing: extract → sanitize → chunk → embed
      extractors.py        every source kind → pages of blocks; upload validation
      pdf_parser.py        PDF → text per page, blocks labelled heading/code/body/table
      summaries.py         per-source summary after indexing
      answer_cache.py      stored answers for repeat questions
      chunking.py          structured (section-aware) or fixed-window chunks
      embeddings.py        local sentence-transformers model
      query_planner.py     query rewrite, multi-query, HyDE (one LLM call)
      retrieval.py         hybrid vector + keyword search per query (RRF)
      reranker.py          local cross-encoder
      pipeline.py          plan → search → rerank → confidence gate, trace
      ocr.py               OCR for pages without a text layer
      study.py             quizzes, flashcards and studio documents (guide, FAQ, timeline, glossary)
      progress.py          live indexing progress (in memory)
      llm.py               prompt, Groq streaming, citation parsing
      storage.py           uploaded files (and reader text) on disk
  eval/                    evaluation harness
    samples.py             sample-corpus content (one HTML fragment per PDF page)
    build_samples.py       renders it to docs/samples/*.pdf
    dataset.jsonl          50 questions with gold pages and key facts
    run_eval.py            runs the configuration ladder, writes results
    metrics.py, report.py  Hit@k / MRR / answer metrics; Markdown + chart
    results/latest.json    latest full run (served to the Evaluation page)
  alembic/                 database migrations
  tests/                   pytest (unit + API tests against Postgres)
  Dockerfile               backend image
  pyproject.toml, uv.lock  Python dependencies
frontend/                  React + TypeScript (Vite, Tailwind, TanStack Query, react-pdf)
  src/api/                 API client, SSE stream reader, data hooks
  src/pages/               sign-in, notebooks, workspace, evaluation, design (style guide)
  src/components/          sources panel, chat, retrieval trace, PDF viewer, UI parts
  src/styles/tokens.css    design tokens: themes, source colors, shape, motion
  src/lib/                 theme store, source colors, motion tokens, contrast math
  nginx.conf               serves the app and proxies /api
docs/samples/              sample PDFs (the evaluation corpus; also good demo sources)
docs/eval/                 latest evaluation report and chart
docker-compose.yml         db + backend + frontend
.github/workflows/ci.yml   lint, type check, tests, Docker builds
.env.example               configuration template (copy to .env)
```

## Design decisions

- **Local embeddings, hosted LLM.** Embedding every chunk is the high-volume
  step, so it runs locally for free; only answer generation calls Groq.
- **Citations as markers, not free text.** Numbering excerpts and requiring
  `[[Cn]]` markers turns citations into data the UI can link to a page. Models
  don't always follow the format exactly (gpt-oss prefers `【C1】`), so the
  backend and frontend both normalise variants and drop markers that don't
  match a retrieved excerpt.
- **Highlighting across parsers.** The backend extracts text with PyMuPDF and
  the browser renders it with pdf.js; their whitespace differs. The viewer
  compares text with whitespace removed to find the cited passage reliably.
- **Background processing.** Embedding a long PDF takes seconds to minutes, so
  uploads return immediately and the UI polls status. Jobs interrupted by a
  restart are marked failed on startup instead of staying "processing" forever.
- **Planning can only help.** Rewrite, paraphrases and HyDE share one small
  LLM call that is cached and skipped when there's nothing to do. Any failure,
  including a free-tier rate limit, falls back to searching the question as
  asked, so the extra stage never blocks an answer.
- **A cautious abstention gate.** Cross-encoder scores are sharply polarised:
  in testing, correct passages phrased unlike the question scored ~0.0001,
  the same as unrelated ones. So Folio only refuses when the reranker *and*
  the embedding similarity are both weak, and never for whole-source
  questions such as summaries. Borderline cases are answered, and the model is
  still instructed to say when the excerpts don't contain the answer.
- **Same-origin cookies.** nginx serves the app and proxies the API, so the
  session cookie is `httpOnly` and `SameSite=Lax` with no CORS setup.

## Security and threat model

Uploaded PDFs and all extracted text are untrusted. Folio never builds storage
paths from filenames, checks ownership on every document/notebook route, parses
the full PDF before accepting it, rejects active content, and keeps suspicious
chunks out of both retrieval and the model context. Source blocks are explicitly
delimited and the model is told never to follow instructions inside them. The
scanner is intentionally explainable and conservative: it records the matched
rule on each document rather than silently deleting the whole source.

PII masking affects indexed chunks sent to search and the LLM; the original PDF
is retained so citations can still open it. It is therefore a prompt/privacy
control, not encrypted document redaction. Regex and heuristic scanners cannot
guarantee detection of every obfuscated injection or identifier. Production
deployments should also isolate ingestion workers, use TLS/object storage, add
durable queues and per-user quotas, rotate secrets, and monitor abuse.

## Limitations

- OCR'd pages have no text layer in the viewer, so their citations open the
  right page without highlighting the passage.
- Generated quiz questions are usually right but not guaranteed; each answer
  shows its explanation and source page so it can be checked.
- No password reset or email verification.
- One backend process: the login rate limiter is in memory and files live on
  a local volume, so it isn't set up for multiple servers.
- Notebooks can't be shared between users.
- Groq's free tier has rate limits; when hit, the app shows how long to wait.
  Query planning adds one small call per question (skipped when unnecessary
  and cached).
- Heading detection relies on font size and weight, so PDFs that style
  headings like body text are chunked by paragraph without section titles.
  PDF table detection needs ruled (bordered) tables; borderless tables stay as
  text.
- Word and PowerPoint sources open in a text reader, not their original
  layout (no slide designs or images). `.doc`/`.ppt` and macro-enabled files
  aren't accepted; web links aren't supported yet.
- The confidence gate refuses only clearly off-topic questions (4 of 7 in the
  evaluation); the model handles the rest. The thresholds were tuned so that
  no answerable question was refused, with a small margin on this small set.
- Reranking runs on the CPU and is the slowest local step (about 5 s for 30
  passages on a busy laptop). `RETRIEVE_K` trades recall for speed.
- The evaluation corpus is small (50 questions, 20 pages), so a single
  question moves a percentage by two or three points.
- PDF ingestion still runs as an in-process background task. A production
  deployment should move OCR/embedding to a bounded durable worker queue.
- PII and injection detection are deterministic safety layers, not guarantees;
  unusual formats and adversarial obfuscation may evade them.

## Changelog: Review 1 → Review 2

Folio v2 is being built in phases (retrieval upgrades, evaluation, a new
workspace UI, study tools, a security layer). Done so far:

**Phase 1: Foundations**
- Design system: tokens for three themes (Light, Dark, Aurora), eight source
  colors, shape, depth and motion; self-hosted fonts; theme menu with an
  animated circular reveal; Calm mode; living style guide at `/design`.
- Automated WCAG AA contrast checks for every theme.
- Structured JSON logging with request ids and per-stage answer timings.
- Feature flags (`ENABLE_*`, `GET /api/features`); hybrid search can be
  switched off as the evaluation baseline.
- Test suites (pytest, Vitest + Testing Library), ruff and mypy, and a GitHub
  Actions pipeline.
- Fixed: an explicit chunk overlap of `0` was silently replaced by the
  default (found by the new chunking tests). The database port is now bound
  to localhost only.

**Phase 2: RAG core**
- Query planning: conversation-aware rewrite, multi-query expansion and
  optional HyDE in one cached, rate-limit-tolerant LLM call.
- Every query runs vector + keyword search; all rankings fuse with RRF.
- Local cross-encoder reranking of the top 30 candidates (baked into the
  Docker image).
- Structure-aware chunking with section titles, character offsets and
  contextual embeddings; re-index endpoint and `python -m app.reindex`.
- Source filtering: per-source checkboxes restrict what chat searches.
- Confidence badge and grounded abstention with the closest passages.
- Retrieval trace stored with every answer (`GET /api/messages/{id}/trace`)
  and shown under "How was this answered?"; live stage labels while an
  answer is prepared.
- Migration `0003`. Feature flags `ENABLE_QUERY_REWRITE`,
  `ENABLE_MULTI_QUERY`, `ENABLE_HYDE`, `ENABLE_RERANKER`, `ENABLE_ABSTENTION`.

**Phase 3: Evaluation**
- Four sample PDFs (`docs/samples/`, generated reproducibly) and a 50-question
  dataset with gold pages, key facts and question types.
- `python -m eval.run_eval`: runs the configuration ladder through the real
  pipeline; reports Hit@1/3/6, MRR, abstention on both sides and per-stage
  latency, and optionally citation precision, faithfulness and key-fact recall
  graded by a second LLM. Paced for Groq's free tier, with retries and
  `--retry-failed`.
- Results: Hit@1 77% → 93%, Hit@3 88% → 98%, MRR 0.83 → 0.95 from the v1
  baseline to the full pipeline (see [Evaluation](#evaluation)).
- Markdown report and chart in `docs/eval/`; read-only **Evaluation** page
  (`/evaluation`, `GET /api/eval/results`); smoke run in CI.
- Fixed: ligatures in PDFs ("ﬁ" for "fi") are now expanded, so keyword search
  matches words such as "find" and "office". The local `DATABASE_URL` now
  uses `127.0.0.1`, which avoids a ~2 s IPv6 fallback per connection on
  Windows.

**Phase 4: Workspace UI**
- Three responsive panes, source scoping, live pipeline theater, citation hover
  cards, PDF page jumps/highlights, Retrieval Inspector and citations audit.
- Command palette, mobile tabs, Calm mode, source colors and accessible themes.
- Page-jump commands are generated from the typed page number instead of
  materializing every page of every PDF.

**Phase 7: Source security (first complete slice)**
- Migration `0004` adds per-chunk quarantine/risk reasons, per-document risk and
  PII summaries, plus the per-notebook PII masking option.
- Rejects encrypted, malformed, over-page-limit, embedded-file, JavaScript and
  launch-action PDFs; normalizes invisible Unicode before embedding.
- Quarantines high-confidence prompt injection and isolates excerpts in the LLM
  prompt. Claim-level valid-citation coverage is stored in the retrieval trace;
  completely uncited generations are refused and partial coverage is warned.
