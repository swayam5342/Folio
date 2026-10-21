# New source types and RAG tuning — design

Date: 2026-10-20
Status: draft, awaiting approval

## Intent

Folio is a college demo of a NotebookLM-style "chat with your sources" app. It runs on one
laptop with Docker Compose and uses only free AI: Groq (free tier, about 8,000 tokens per
minute) and local models for embeddings and reranking.

This round makes two kinds of improvement:

1. **More kinds of source** (the most important part). Today a notebook only accepts PDFs.
   NotebookLM accepts many kinds, and this is the biggest visible gap.
2. **Better and cheaper answers.** The "not in the sources" gate gets tuned, a stage that
   hurts the top result is switched off, chosen passages get more surrounding text, repeat
   questions can be answered from a cache, tables survive extraction, and each source gets
   a short summary.

Success means that in a live demo, someone can add a Word file, a PowerPoint deck, a
Markdown or text file, or pasted text next to a PDF. Questions are then answered across
all of them with clickable citations. Clicking a citation shows the exact text that
supports the answer. The eval numbers must stay at least as good as they are now.

## Goals

- Accept these sources: `.pdf` (existing), `.docx`, `.pptx`, `.txt`, `.md`, and pasted
  text with a title.
- Every source goes through the existing pipeline: security scan, PII masking, chunking,
  embedding, hybrid search, reranking, citations, citation check, and quizzes/flashcards.
- Clicking a citation on a non-PDF source opens a **clean text view** of that source. The
  view scrolls to the cited passage and highlights it. PDFs keep their current viewer.
- PowerPoint: each slide is a "page", and citations read "slide N".
- Re-tune the abstention thresholds against the eval set.
- Make multi-query off by default.
- Add neighbouring text to chosen passages.
- Add an answer cache behind an `.env` switch.
- Keep tables whole as Markdown tables.
- Write a short per-source summary at ingest. Show it in the Sources panel, and use it for
  broad "summarize" questions.

## Non-goals

- **Web links/URLs.** The user explicitly deferred these. Don't build URL fetching.
- Rendering the original layout of Word or PowerPoint (slide design, images). The user
  chose a text view, so LibreOffice and conversion to PDF are not wanted.
- Older or macro formats: `.doc`, `.ppt`, `.docm`, `.pptm`, `.rtf`, `.odt`, EPUB, audio,
  YouTube.
- An in-app settings screen. The cache switch lives in `.env` only, because it's for the
  developers.
- Automated test suites. The user does not want pytest or vitest tests added. Verify by
  running the app and the eval harness (see Verification).

## Anti-goals (failure even if it "works")

- A citation that opens the wrong place, or highlights text other than the cited passage.
- Breaking existing PDF behaviour or making PDF eval scores worse.
- A cached answer shown for a question whose meaning depended on earlier chat. A cached
  answer shown after the notebook's sources changed.
- A slow or failed summary call that blocks or fails a source's ingestion.
- New spending on Groq tokens that pushes ordinary chat into rate limits during a demo.

## Constraints

- Stack stays as it is: FastAPI, Postgres/pgvector, Alembic, React/TS/Vite, and Docker
  Compose with `docker compose up --build`.
- Database changes go only through Alembic, as migration `0005`.
- Ownership rules stay the same: other users' resources return 404.
- New Python dependencies are limited to small, pure-Python libraries:
  `python-docx` and `python-pptx`.
- Uploaded content is untrusted. Office files are zip archives, so guard against zip bombs
  by capping the total uncompressed size and the number of entries. Text files are capped
  by the same `MAX_UPLOAD_MB`.

## Part A — new source types

### What the user sees

- The Sources panel's add button accepts `.pdf, .docx, .pptx, .txt, .md` by click and by
  drag-and-drop. The label changes from "Add PDF" to "Add source".
- A second action, **"Paste text"**, opens a small dialog with a title and a text area.
  The text is stored as a source whose name is that title.
- Each source row shows a small type indicator (PDF / DOCX / PPTX / TXT / MD / Text).
- Citation chips and the citations panel show the location as follows:
  - PDF: "p. N" (unchanged).
  - PPTX: "slide N".
  - All other kinds: the section title when there is one, otherwise nothing extra.
- Clicking a citation:
  - PDF: the existing `PdfViewer` (unchanged).
  - Any other kind: a new **text viewer** in the same right-pane "Viewer" tab. It shows the
    source's extracted text, split into its pages or slides, with headings rendered as
    headings and tables as tables. It scrolls to the cited passage and highlights it, in
    the source's colour, like the PDF highlight. For PPTX, each slide is a block labelled
    "Slide N". The citation beam animation should target the highlight if that is simple.
    If not, skip the beam for text sources (builder's call).
- Opening a source from the Sources panel without a citation shows the same viewer from the
  top.

### How it works

**One shape for every source.** Every extractor returns the same structure the PDF parser
already returns:
`[{"page_number": int, "text": str, "blocks": [{"kind": "heading"|"body"|"code"|"table", "text": str}]}]`.
Chunking (`chunk_document`) and everything after it stay the same, apart from the new
`table` block kind described in Part G.

**Extractors, one per kind:**

| Kind | "Pages" | Blocks |
|---|---|---|
| `pdf` | real pages (existing parser, plus tables from Part G) | existing heading/body/code detection |
| `pptx` | one page per slide, in slide order | slide title → `heading`; text frames → `body`; tables → `table` (Markdown); speaker notes → a final `body` block prefixed "Notes:" (*builder's call to keep or drop*) |
| `docx` | **one page** for the whole document | Word heading styles (Heading 1–6, Title) → `heading`; paragraphs → `body`; tables → `table` (Markdown), in document order |
| `md` | one page | lines starting with `#` → `heading`; fenced code → `code`; Markdown tables → `table`; the rest split into `body` paragraphs on blank lines |
| `txt`, pasted text | one page | paragraphs split on blank lines, all `body` |

Word, Markdown and text sources have no meaningful pages. They are a single page, and the
citation shows the section title that structured chunking already records. `char_start` /
`char_end` locate the chunk in that page's text, which is exactly what the text viewer
needs to highlight it.

**Text encoding.** Read `.txt` and `.md` as UTF-8, falling back to cp1252. Reject files
that look binary (NUL bytes).

**Storing what the viewer shows.** The viewer must show the *exact* page text that chunk
offsets point into. That text exists only after extraction and PII masking. So at ingest,
store the final per-page text for every non-PDF source. The builder chooses where: a JSON
file next to the original in storage, or a JSONB column. Add an owned endpoint
`GET /api/documents/{id}/pages` that returns
`[{"page_number", "text", "blocks"?}]`. Blocks are needed only if the viewer uses them to
render headings and tables. The original upload is still kept, so re-indexing works.

Important: PII masking currently runs on chunks *after* chunking (`ingest.py`). For the
viewer text and the chunk offsets to agree, the builder must make the stored page text and
the chunk contents come from the same masked text. One way is to mask the page text before
chunking. Make sure PDF highlighting still works, because PDF highlighting matches snippet
text against the rendered PDF, not against stored text.

**Data model (migration 0005).**
- `documents.kind`: `pdf | docx | pptx | txt | md | text`. Not null. Existing rows become
  `pdf`.
- `documents.summary`: nullable text (Part G).
- Answer cache storage (Part E).

The API's `DocumentOut` adds `kind` and `summary`. Citation source objects gain
`document_kind` so the frontend can choose the label and viewer without looking it up.

**Upload validation.**
- Dispatch on extension, then check the content matches. PDF: existing `%PDF-` check and
  `validate_pdf`. DOCX/PPTX: a valid zip with the expected main part
  (`word/document.xml` / `ppt/presentation.xml`), within the zip-bomb caps. TXT/MD: decodes
  as text.
- `MAX_PDF_PAGES` applies to PDFs only. Add a sensible slide cap for PPTX and a character
  cap for one-page kinds (builder's call on the values).
- Pasted text uses a JSON endpoint, e.g. `POST /api/notebooks/{id}/documents/text` with
  `{title, text}`. It goes through the same ingest job.
- Error messages say "file" or "source" instead of "PDF" where that's now wrong.

**The prompt.** `llm.build_context` currently says `page N`. For PPTX use `slide N`. For
single-page kinds, leave out the page and show only the section, when there is one.

**Study sets** (quizzes/flashcards) use chunks, so they work unchanged. Their citation
labels follow the same rules as chat.

## Part B — tune the "not in the sources" gate

- Run `python -m eval.run_eval` with the full current pipeline, then move `CONFIDENCE_LOW`
  and `SIMILARITY_LOW` (and `CONFIDENCE_HIGH` only if needed).
- Target: no answerable question refused, and as many of the 7 unanswerable ones refused as
  possible. Wrongly refusing a real question is worse than missing a refusal, because the
  LLM still declines most of them.
- If the eval set can't separate the two cleanly, choose the setting with zero wrong
  refusals and report the result honestly.
- Put the new defaults in `config.py` and `.env.example`, and record the before/after
  numbers in `docs/eval/results.md`.

## Part C — multi-query off by default

Set `ENABLE_MULTI_QUERY` to `False` in `config.py` and `.env.example`. Keep the code.

## Part D — neighbouring text

- After `select_context` picks passages, add the text of the chunks immediately before and
  after each chosen chunk (`chunk_index ± 1`). Only add a neighbour if it is in the **same
  document, same page and same section_title**. Skip a neighbour that is already selected,
  or that overlaps text already included. Skip quarantined chunks.
- The chosen chunk stays the cited unit. Its `snippet`, `page_number` and highlight are
  unchanged, so citation targets stay exactly as they are. Only the text the LLM reads
  gets longer.
- The citation check should score claims against the same expanded text the LLM saw.
- Respect `CONTEXT_MAX_CHARS`. When the budget is tight, expand the best-ranked passages
  first.
- Feature flag: `ENABLE_NEIGHBOR_EXPANSION=true`, so the eval harness can measure it. Give
  the harness a configuration step for it.

## Part E — answer cache

- Switch: `ENABLE_ANSWER_CACHE` in `.env`. It is an ordinary `ENABLE_*` flag, so it appears
  in `feature_flags()` and the eval harness can turn it off. Default **on** (*my call*).
  The eval harness must run with it **off** so measurements stay real.
- **Key:** notebook id + the *standalone query* produced by the planner (normalised:
  case-folded, whitespace collapsed) + the selected source ids (or "all") + a fingerprint
  of the notebook's ready sources (their ids and how they were indexed).
  - *My call, refining what was agreed:* the agreement was "follow-up questions skip the
    cache". Keying on the planner's standalone query handles that automatically. A
    follow-up like "what about the second one?" is rewritten into a full question before
    lookup. So a follow-up only hits the cache when it means the same thing as an earlier
    question, and genuinely new follow-ups miss. The planner call still runs on a cache
    hit (it's small and has its own in-memory cache). Retrieval, reranking, generation
    and verification are skipped.
- **Invalidation:** adding, deleting or re-indexing a source changes the fingerprint, so old
  entries simply stop matching. Also delete a notebook's entries when a source is deleted,
  and cascade on notebook delete.
- Don't cache abstentions, errors, "no sources" replies, or answers that got the
  low-coverage warning or replacement.
- **On a hit:** store a new assistant message with the cached answer, sources, confidence
  and trace. Mark the trace `cached: true` so the Retrieval Inspector can say "answered
  from cache". Stream the text to the client the same way as a normal answer. The UI's
  pipeline animation should not pretend that search and rerank ran.
- Storage: a Postgres table (survives restarts). The builder may cap entries per notebook.

## Part G — tables and per-source summaries

**Tables (PDF).**
- Use PyMuPDF's `page.find_tables()`. Convert each table to Markdown, and add it as a
  `table` block at the table's position in reading order.
- Drop the ordinary text blocks that fall inside a table's bounding box, so the table's
  text isn't duplicated.
- If table detection throws or finds nothing, fall back to today's behaviour. A bad table
  must never fail an ingest.

**Tables in chunking.** A `table` block is kept whole up to `2 × CHUNK_SIZE`, like `code`.
A larger table is split by rows, and **the header row is repeated** in each piece. A table
is never merged into the middle of an unrelated paragraph chunk.

**Per-source summaries.**
- After a source is ready, one small Groq call (`complete_json` or a plain completion,
  low reasoning effort) writes a 3–5 sentence summary. It is stored in
  `documents.summary`.
- Input: for long sources, the section titles plus the start of each section, capped at
  about 6,000 characters. Short sources are sent whole. This keeps one summary well within
  the free tier.
- The summary is generated after the document is marked ready, so chat works immediately.
  A failure or rate limit leaves `summary` null and is logged. It never marks the document
  failed. Re-indexing regenerates it. Feature flag: `ENABLE_SOURCE_SUMMARIES=true`.
- UI: the Sources panel shows the summary under the source, collapsed or expandable
  (builder's call). While it is still being written, show nothing or a subtle placeholder.
- Chat: for broad questions (`is_broad_question`), add the summaries of the in-scope
  sources to the prompt as a clearly labelled **"Source overviews (orientation only, not
  citable)"** block, separate from the `<source>` excerpts. The model must still cite
  excerpts for its claims. Overviews must not get citation markers, and they don't count
  toward the citation check.

## Verification (no test suites)

Following the project's standing preference, check by running things. Don't commit any
verification scripts.

- `docker compose up --build`. Run migration `0005` on a database with existing PDFs, and
  confirm they show as `pdf` and still chat correctly.
- Upload one sample of each kind (`.docx` with headings and a table, `.pptx` with a table
  and notes, `.md`, `.txt`, pasted text). Ask a question that needs each one, click every
  citation, and confirm the viewer highlights the cited text. Confirm slide labels.
- Ask the same question twice: the second answer is instant and marked cached. Add a
  source, ask again, and confirm it misses.
- Ask a "summarize everything" question with several sources present. Check that
  summaries appear in the Sources panel.
- Re-run the eval harness (cache off). Hit@k and MRR must not fall below the current
  "+ structure-aware chunks" row. Add configuration rows for neighbour expansion and the
  re-tuned gate, and update `docs/eval/results.md` and its chart.
- Upload hostile inputs: a renamed binary as `.txt`, a zip bomb as `.docx`, an oversized
  file. Each gives a clear error.

## Left to the builder

- Library details, module layout (e.g. `app/services/extractors/`), endpoint naming.
- Where the viewer text is stored (file vs column).
- Speaker notes in PPTX: include or drop.
- Exact caps (slides, characters, zip limits, cache entries).
- How the text viewer renders (plain paragraphs vs Markdown rendering), as long as the
  cited range is highlighted precisely.
- Whether the citation beam targets text-viewer highlights.
- Order of work. Suggested order: C → B (quick wins with an eval baseline), then A, G, D
  and E. Re-run the eval at the end.

## Calls made by Claude (not explicitly decided by the user)

- The answer cache is on by default, and keyed on the planner's standalone query rather
  than skipping every follow-up.
- Word/Markdown/text sources are one "page", cited by section title.
- Pasted text needs a title.
- PPTX speaker notes are included by default.
- Summaries are not citable and are used only for broad questions.
- Neighbour expansion and summaries get their own `ENABLE_*` flags (default on).
