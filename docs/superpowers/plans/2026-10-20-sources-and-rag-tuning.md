# New Source Types and RAG Tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept DOCX, PPTX, TXT, MD and pasted text as sources with a highlighted text viewer.
Also tune the RAG pipeline: abstention thresholds, multi-query off, neighbouring text, an
answer cache, tables, and per-source summaries.

**Architecture:** Every source becomes the parser's existing page/block structure. A shared
"sanitize, then assemble" step masks the block text first and then builds page text with
block offsets. That lets the chunk offsets, the stored viewer text and the viewer highlight
all agree. Retrieval is unchanged, except that the selected passages get neighbour text.
Chat gains a cache lookup between planning and search.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, pgvector, PyMuPDF, python-docx, python-pptx,
Groq, React/TS, TanStack Query, zustand.

**Spec:** `docs/superpowers/specs/2026-10-20-sources-and-rag-tuning-design.md`

## Global Constraints

- No pytest/vitest suites are added (project preference, which overrides the skill's TDD
  steps). Every task is verified by running it against the Docker stack, the eval harness,
  or a throwaway script in the scratchpad that is never committed.
- Web URLs are out of scope. Office files get a text view only (no LibreOffice).
- DB changes only through migration `0005`. Other users' resources return 404.
- New Python deps: only `python-docx` and `python-pptx`.
- Office zip caps: 200 MB total uncompressed, 5,000 entries. Text sources: at most
  2,000,000 characters. PPTX: at most 500 slides.
- New flags in `config.py`/`.env.example`: `ENABLE_NEIGHBOR_EXPANSION=True`,
  `ENABLE_ANSWER_CACHE=True`, `ENABLE_SOURCE_SUMMARIES=True`, `ENABLE_MULTI_QUERY=False`.
- The eval harness forces `ENABLE_ANSWER_CACHE` off.
- Non-PDF page text joins blocks with `"\n\n"`. PDF keeps `"\n"`, so existing PDF chunk
  text doesn't change.

## Review Focus

1. A `.docx`/`.pptx` that is really some other file, or a zip bomb → a clear 400 error,
   never a 500 and never a hung worker.
2. A citation into a PII-masked source → the highlight lands on exactly the masked chunk
   text.
3. Re-indexing a source, or toggling PII and re-indexing → the old cached answers stop
   matching.
4. A Groq rate limit during summary generation → the document stays `ready`, and the
   summary status becomes `failed`.
5. PDFs uploaded before this change (kind defaults to `pdf`, no pages file) → still open in
   the PDF viewer and chat normally.

Each is checked in the verification step of the task that owns it.

---

### Task 1: Quick config wins (spec Part C, eval ladder)

**Files:** `backend/app/config.py`, `.env.example`, `backend/eval/run_eval.py`

- [ ] Set `ENABLE_MULTI_QUERY: bool = False`. Add `ENABLE_NEIGHBOR_EXPANSION`,
  `ENABLE_ANSWER_CACHE` and `ENABLE_SOURCE_SUMMARIES` (all `True`). Mirror them in
  `.env.example` with one-line comments.
- [ ] In `run_eval.py`, add the three new flags to `ALL_OFF` (False). Move `multi_query`
  out of `LADDER` into `EXTRA`. Add a final ladder step,
  `("neighbors", "+ neighbouring text", "structured", {"ENABLE_NEIGHBOR_EXPANSION": True})`.
- [ ] Verify: `python -c "from eval.run_eval import LADDER, EXTRA; print([c.name for c in LADDER], [c.name for c in EXTRA])"`
  prints the ladder without multi_query, ending in `neighbors`.

### Task 2: Migration 0005 and model fields

**Files:** `backend/alembic/versions/0005_sources_cache_summaries.py`, `backend/app/models.py`, `backend/app/schemas.py`

**Produces:**
- `Document.kind`: String(8), not null, server default `'pdf'`.
- `Document.summary`: Text, nullable.
- `Document.summary_status`: String(16), nullable (`pending|done|failed`).
- `Document.indexed_at`: DateTime(tz), nullable.
- Model `AnswerCache(id, notebook_id FK→notebooks ON DELETE CASCADE, key String(64), answer Text, sources JSONB, confidence String(8), trace JSONB, created_at)`,
  with a unique index on `(notebook_id, key)`.
- `DocumentOut` gains `kind`, `summary`, `summary_status`.
- `SourceOut` and `TraceCandidate` gain `document_kind: str = "pdf"`,
  `char_start: int | None`, `char_end: int | None`.
- `TraceOut` gains `cached: bool = False`.

- [ ] Write the migration (downgrade drops everything it adds). Update the models and
  schemas.
- [ ] Verify: `docker compose up -d --build backend`. The logs show `0005` applied.
  `GET /api/notebooks/{id}/documents` shows old docs with `"kind": "pdf"`.

### Task 3: Sanitize-then-assemble, and PDF tables (Part A core + Part G tables)

**Files:** `backend/app/services/content_security.py`, `backend/app/services/pdf_parser.py`, `backend/app/services/chunking.py`, `backend/app/services/ingest.py`

**Produces:**
- `content_security.sanitize_pages(pages: list[dict], *, redact_pii: bool) -> tuple[list[dict], dict[str, int], bool]`.
  It runs normalisation and masking on each block's text, and returns
  `(pages, pii_counts, had_invisible)`.
- `chunking.assemble_pages(pages: list[dict], sep: str) -> list[dict]`. It sets
  `page["text"] = sep.join(block texts)`, and sets each block's `start`/`end` offsets
  within that text.
- Every extractor returns pages as `{"page_number", "blocks": [{"kind", "text"}]}`, with no
  `text` key. OCR pages become one body block.
- `pdf_parser` adds `table` blocks. It uses `page.find_tables()` and `Table.to_markdown()`,
  drops the text blocks whose bbox centre is inside a table bbox, and inserts the table
  where the first dropped block was (else by y-position). Everything is wrapped in a
  try/except fallback.
- `_StructuredChunker` handles `table` like this: flush the buffer, emit the table as its
  own chunk when `len <= 2*size`, else split by rows with the header (the first 2 lines)
  repeated in each piece. A piece's offsets cover its own rows.
- `ingest.extract_and_embed(data, kind, strategy, *, redact_pii)` returns the same tuple
  as today plus `pages` (assembled) as the last element. The per-chunk scan now only
  scores injection risk. Document `pii_summary` comes from `sanitize_pages`, and
  `invisible_unicode` is added to the document's reasons with risk +2.

- [ ] Implement. `chunk_structured` must use the block offsets from `assemble_pages`
  instead of `str.find`.
- [ ] Verify (scratch script, run inside the backend container): chunk a sample PDF from
  `docs/samples`. For every chunk with no repeated table header,
  `page["text"][char_start:char_end] == content`, and the chunk count is within ±5% of
  before. Check that a generated PDF with a table yields a `table` chunk in Markdown.

### Task 4: Office/text extractors and upload endpoints (Part A)

**Files:**
- Create `backend/app/services/extractors.py`.
- Modify `backend/pyproject.toml` (+`uv.lock`), `backend/app/services/storage.py`,
  `backend/app/routers/documents.py`, `backend/app/services/ingest.py`,
  `backend/app/reindex.py`, `backend/eval/run_eval.py` (call-site update).

**Produces:**
- `extractors.KINDS = {"pdf", "docx", "pptx", "txt", "md", "text"}`.
- `extractors.kind_for_filename(name) -> str | None`.
- `extractors.validate(kind, data) -> None`. It raises `UnsafeSourceError`, a subclass of
  `ValueError` with a user-safe message. `UnsafePDFError` becomes an alias, or a subclass
  of it.
- `extractors.extract(kind, data) -> tuple[int, list[dict], int]`, returning
  `(page_count, pages, ocr_pages)`.
  - DOCX: walks the body in order (`w:p` and `w:tbl`). Heading/Title styles become
    `heading`, tables become Markdown `table`, other non-empty paragraphs become `body`.
    One page.
  - PPTX: one page per slide. The title placeholder becomes `heading`, other text frames
    become `body` (one block per shape), tables become `table`, and speaker notes become
    `body` prefixed `"Notes: "`. Slides with no text are skipped, but `page_count` is the
    total number of slides.
  - MD: `#` lines become `heading`, fenced code becomes `code`, consecutive `|` lines
    become `table`, and blank-line-separated paragraphs become `body`.
  - TXT/text: blank-line-separated paragraphs become `body`. Decoded as UTF-8, falling
    back to cp1252. NUL bytes are rejected.
- `storage.save_file(user_id, document_id, data, ext) -> str`.
- `storage.save_pages(storage_path, pages) / load_pages(storage_path) -> list | None`,
  stored at `<storage_path>.pages.json` as
  `[{"page_number", "text", "blocks": [{"kind", "start", "end"}]}]`.
- `delete_file` also removes the pages file.
- Endpoints:
  - `POST /notebooks/{id}/documents` accepts all file kinds.
  - `POST /notebooks/{id}/documents/text` takes `{title: 1-120 chars, text: 1-2,000,000 chars}`.
    It stores the text as a `.txt` file with kind `text`, and the filename is the title.
  - `GET /documents/{id}/pages` returns the pages JSON. It returns 404 for PDFs or when
    the file is missing.
  - `GET /documents/{id}/file` serves the right media type per kind.
- `process_document` passes `document.kind` into `extract_and_embed`, saves pages for
  non-PDF kinds, and sets `indexed_at`.

- [ ] `uv add python-docx python-pptx`, then rebuild the backend image.
- [ ] Implement.
- [ ] Verify with curl on the running stack. Upload a generated `.docx` (headings + a
  table), a `.pptx` (title, bullets, table, notes), a `.md`, a `.txt` and pasted text. All
  reach `ready`, and `/pages` returns the text. Hostile inputs get a 400 with a clear
  message: random bytes named `.docx`, a zip without `word/document.xml`, a zip bomb
  (one entry declared at 300 MB), and a binary file named `.txt`.

### Task 5: Citation fields and prompt labels

**Files:** `backend/app/services/llm.py`, `backend/app/services/pipeline.py` (`build_trace`)

- [ ] `build_context` adds `document_kind`, `char_start` and `char_end` to every
  citation-map entry. The location label is `page N` (pdf), `slide N` (pptx), or omitted
  (other kinds), plus the section when there is one. `build_trace` candidates gain the
  same three fields.
- [ ] Verify: in a notebook with a PPTX, ask a question. The SSE `done` message sources
  show `document_kind: "pptx"` and the char offsets.

### Task 6: Neighbouring text (Part D)

**Files:** `backend/app/services/pipeline.py`, `backend/app/services/llm.py`, `backend/app/routers/chat.py`

**Produces:**
- `pipeline.expand_neighbors(db, selected: list[dict]) -> None`. It sets
  `item["before"]` / `item["after"]` (str or None) on the selected items.
- `llm.passage_text(item) -> str`, which joins before/content/after with `"\n"`.
- `build_context` puts `passage_text(item)` in the `<source>` block. The citation snippet
  stays `chunk.content[:240]`.

- [ ] A neighbour is `chunk_index ± 1` in the same document, with the same `page_number`
  and `section_title`, not quarantined, not selected, not already used, and with no
  `[char_start, char_end)` overlap with the chosen chunk. Add neighbours in rank order
  while the total context stays ≤ `CONTEXT_MAX_CHARS`. Do it in one query for all
  selected items. Called from `pipeline.run` after `select_context` when the flag is on.
- [ ] The citation check in `chat.py` uses `passage_text` (with the section title prefix,
  as now).
- [ ] Verify: ask a question. The trace shows the same candidates, and a debug log line in
  `llm.build_context` (temporary, then removed) shows the expanded text for a
  structured-chunk source.

### Task 7: Per-source summaries and broad-question overviews (Part G)

**Files:** `backend/app/services/summaries.py` (create), `backend/app/services/ingest.py`, `backend/app/routers/chat.py`, `backend/app/services/llm.py`

**Produces:**
- `summaries.summary_input(chunks: list[Chunk]) -> str`. For a short source (≤ 6,000
  chars) it is the whole text. Otherwise it walks the chunks in order, takes each new
  section title plus that section's first chunk, and stops at 6,000 chars.
- `async summaries.generate(document_id) -> None`. It sets `summary_status`
  `pending → done|failed`. It uses `llm.complete_json` with `{"summary": str}`,
  `max_tokens=1200` and `reasoning_effort="low"`, and logs failures.
- `llm.build_messages(question, context, history, overviews: str | None = None)`. When
  `overviews` is given, it inserts
  `"Source overviews (orientation only, not citable):\n…"` before `<sources>`.

- [ ] `process_document` sets `summary=None, summary_status="pending"` in the same commit
  that marks the document ready (only when the flag is on), then awaits
  `summaries.generate`.
- [ ] `chat.py`: when `pipeline.is_broad_question(question, plan.standalone)`, load the
  summaries of the in-scope ready docs and pass them as `"- {filename}: {summary}"` lines.
- [ ] Verify: upload a source. `summary_status` goes from pending to done and the summary
  text appears. Point `GROQ_API_KEY` at a bad key in a scratch run, or simulate a failure
  by raising: the document stays ready with status `failed`. "Summarize everything" gets
  an answer that still has citations.

### Task 8: Answer cache (Part E)

**Files:** `backend/app/services/answer_cache.py` (create), `backend/app/services/pipeline.py`, `backend/app/routers/chat.py`, `backend/app/routers/documents.py`

**Produces:**
- `answer_cache.cache_key(notebook_id, standalone: str, document_ids, fingerprint: str) -> str`.
  It is the sha256 hex of JSON containing: the normalised query (casefolded, whitespace
  collapsed), the sorted ids or `"all"`, the fingerprint, `GROQ_MODEL` and
  `feature_flags()`.
- `async answer_cache.fingerprint(db, notebook_id) -> str`, built from the sorted
  `(id, indexed_at)` of the ready docs.
- `async lookup(db, notebook_id, key) -> AnswerCache | None`.
- `async store(db, notebook_id, key, answer, sources, confidence, trace)`. It upserts and
  keeps at most 200 rows per notebook, deleting the oldest.
- `async clear(db, notebook_id)`.
- `pipeline.run(..., plan: QueryPlan | None = None)`. When a plan is given, the plan stage
  is skipped.

- [ ] In `chat.events`: yield the `plan` stage and run `plan_queries` under
  `timer.stage("plan")`.
  - If the flag is on, look up the cache. On a hit: send the cached answer as one `token`,
    save the assistant message (trace copied with `cached: True`), and send `done`.
  - On a miss: `pipeline.run(..., plan=plan)` as before. After a normal answer (not an
    abstention, no replace/warning, has sources), store it.
- [ ] `delete_document` calls `answer_cache.clear`.
- [ ] Inspector: the trace's `cached` field is shown in Task 10.
- [ ] Verify: ask a question twice. The second reply's trace has `cached: true` and comes
  back in about the planner time. Re-index a source, ask again, and it misses. A question
  that got abstained is asked twice, and both run the pipeline.

### Task 9: Tune the abstention gate (Part B)

**Files:** `backend/app/config.py`, `.env.example`, `docs/eval/results.md` (regenerated)

- [ ] Write a scratch script (scratchpad, not committed). It reuses
  `run_eval.prepare_corpus` and `_retrieve` with the `structured` ladder flags, and
  records for each question: answerable, the best rerank score and the best similarity
  among the selected passages. Then sweep `CONFIDENCE_LOW ∈ {0.01…0.3}` and
  `SIMILARITY_LOW ∈ {0.5…0.8}`.
- [ ] Choose the pair that wrongly refuses 0 answerable questions and refuses the most
  unanswerable ones. Ties go to the lower thresholds. Set it as the default in `config.py`
  and `.env.example`.
- [ ] Verify: the sweep table is printed, and the chosen pair is reported to the user with
  its counts.

### Task 10: Frontend — sources, viewer, labels, cache badge

**Files:**
- Modify `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`,
  `frontend/src/lib/workspace.ts`, `frontend/src/components/workspace/{SourcesPanel,RightPane,CitationChip,CitationsPanel,ChatPanel,PipelineTheater,RetrievalInspector,QuizPlayer,FlashcardPlayer}.tsx`,
  `frontend/src/components/CommandPalette.tsx`, and the PDF-only copy in `pages/*`.
- Create `frontend/src/lib/sourceLocation.ts` and
  `frontend/src/components/workspace/TextViewer.tsx`.

**Produces:**
- `sourceLocation(s: {page_number, section_title?, document_kind?}) -> string`. It returns
  `"p. N"` (pdf), `"slide N"` (pptx), the section title, or `""`.
- `ViewerTarget` gains `charStart?` and `charEnd?`.
- `openSource` accepts `char_start`/`char_end`.
- `useDocumentPages(id)` and `useAddTextSource(notebookId)`.
- The documents query polls while any doc is `processing` or has
  `summary_status === 'pending'`.

- [ ] SourcesPanel:
  - `accept=".pdf,.docx,.pptx,.txt,.md"` and extension validation.
  - The label is "Add source". A "Paste text" button opens a dialog with title + textarea,
    using the existing dialog/overlay primitives.
  - A kind badge on each source.
  - The meta line reads "N slides" for pptx, "N pages" for pdf, and only the size for the
    other kinds.
  - The summary shows under a ready source, clamped to 3 lines with a "More" toggle.
- [ ] TextViewer:
  - Fetches the pages and renders each page. PPTX pages get a "Slide N" header.
  - Each block renders by kind: heading `h3`, code and table as monospace `pre` with
    horizontal scroll, body `p` with `whitespace-pre-wrap`.
  - The `[charStart, charEnd)` range of the target page is split into `<mark>` segments
    across the blocks it touches, in the source colour.
  - Scrolls the first mark into view and aims the beam at it, the same as PdfViewer.
  - Without a char range, falls back to finding the snippet with `indexOf`.
- [ ] RightPane chooses `TextViewer` when the doc's kind isn't `pdf`.
- [ ] Every "page N" label goes through `sourceLocation`. PDF-only copy becomes
  "sources".
- [ ] The Inspector shows an "Answered from cache" note when `trace.cached`.
- [ ] Verify: `npm run build` passes. In the browser (scratch Playwright script), upload
  every kind, ask questions, and click a citation for each kind. Screenshot each
  highlight and check it covers the cited text.

### Task 11: Docs, eval re-run, final check

**Files:** `README.md`, `.env.example`, `docs/eval/*`, `backend/eval/results/latest.json`

- [ ] README: add the supported source types, the new flags in the config table, and the
  new endpoints in the API table.
- [ ] Run `python -m eval.run_eval --answers final` (cache off) in the backend container.
  Confirm Hit@k and MRR are ≥ the previous "+ structure-aware chunks" row
  (Hit@1 93%, Hit@3 98%, MRR 0.952).
- [ ] Do the Review Focus checks 1–5 end to end, then commit.
