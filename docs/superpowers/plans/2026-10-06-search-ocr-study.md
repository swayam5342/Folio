# Hybrid search, OCR, and study tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deviation from the standard template (user instruction, standing):** no automated
> test suite. Each task ends with an end-to-end verification (curl / Python probe /
> browser via throwaway Playwright in the scratchpad) instead of a TDD cycle.

**Goal:** Add hybrid (vector + keyword) retrieval, OCR for image-only PDF pages, and saved multiple-choice quizzes and flashcard decks with page citations.

**Architecture:** One Alembic migration adds `chunks.content_tsv` (generated tsvector + GIN), `documents.ocr_pages`, and `study_sets`. Retrieval fuses pgvector and full-text rankings with RRF. The PDF parser OCRs pages lacking a text layer with RapidOCR. A study service selects ≤16k chars of excerpts, asks Groq for JSON items citing `Cn` markers, validates, and saves; the frontend adds a Chat | Study switch with generate form, quiz player and flashcard player.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, PostgreSQL FTS + pgvector, rapidocr-onnxruntime, PyMuPDF, Groq (JSON mode), React + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-06-search-ocr-study-design.md`

## Global Constraints

- Groq free tier: 8,000 tokens/min, 1,000 requests/day — study generation sends ≤ ~16,000 characters of excerpts, ≤ 18 chunks, `max_tokens` 6,000.
- Retrieval: vector top 30 + keyword top 30, RRF `1/(60+rank)`, return `TOP_K` (6) for chat.
- OCR threshold: page text with < 20 non-whitespace chars → render 200 DPI → OCR.
- Failure message with no text after OCR: "No readable text found, even with OCR."
- Quiz count ∈ {5,10,15}; flashcards ∈ {10,20,30}; topic ≤ 200 chars.
- Quiz item: `{question, options[4], answer_index 0–3, explanation, source}`; flashcard: `{front, back, source}`; `source` = chat SourceOut shape.
- < half of requested items valid → 502 "Couldn't generate a good set — try again"; invalid JSON → one retry.
- Groq 429 → HTTP 429 with `Retry-After`; other Groq errors → 502 with friendly message.
- Not-owned study set → 404. All API under `/api`.
- Backend lives in `backend/`; run commands from there. No automated tests.

## Review Focus

1. Question made only of stop words / punctuation ("what is this?") → keyword list empty, vector results still returned (no SQL error on empty tsquery).
2. A PDF mixing text pages and scanned pages → only scanned pages OCR'd; page numbers stay correct; `ocr_pages` counts only those.
3. Model returns duplicate options, answer_index out of range, or cites `C42` → item dropped; set still saves if ≥ half valid.
4. Study generation on a notebook whose only sources are processing/failed → 400 "Add a ready source first", not a 500.
5. Deleting a source used by a saved study set → set still opens; its citation chips toast "source was removed" instead of crashing.

Each is exercised in the owning task's verification.

## File Map

| File | Change |
|---|---|
| `backend/alembic/versions/0002_search_ocr_study.py` | new migration |
| `backend/app/models.py` | `Chunk.content_tsv` (Computed, deferred), `Document.ocr_pages`, `StudySet`, `StudyKind` |
| `backend/app/services/retrieval.py` | hybrid search with RRF, `document_ids` filter |
| `backend/app/services/ocr.py` | new: lazy RapidOCR singleton, `ocr_page(page) -> str` |
| `backend/app/services/pdf_parser.py` | OCR fallback per page; returns `(page_count, pages, ocr_pages)` |
| `backend/app/services/ingest.py` | store `ocr_pages`; new failure message |
| `backend/app/services/llm.py` | `complete_json(messages)` non-streamed JSON call with same error mapping |
| `backend/app/services/study.py` | new: excerpt selection, prompt, validation, shuffling |
| `backend/app/routers/study.py` | new: study endpoints |
| `backend/app/routers/chat.py` | pass question text to hybrid search |
| `backend/app/schemas.py` | `DocumentOut.ocr_pages`, study request/response models |
| `backend/app/deps.py` | `get_owned_study_set` |
| `backend/app/main.py` | mount study router |
| `backend/Dockerfile`, `backend/pyproject.toml` | rapidocr dep, libgl1/libglib2.0-0 |
| `frontend/src/api/types.ts`, `queries.ts` | study types + hooks; `ocr_pages` |
| `frontend/src/components/workspace/SourcesPanel.tsx` | "read with OCR" line |
| `frontend/src/components/workspace/StudyPanel.tsx` | new: list + generate form |
| `frontend/src/components/workspace/QuizPlayer.tsx` | new |
| `frontend/src/components/workspace/FlashcardPlayer.tsx` | new |
| `frontend/src/pages/WorkspacePage.tsx`, `ChatPanel.tsx` | Chat \| Study switch |
| `README.md`, project report | docs |

---

### Task 1: Migration + hybrid search

**Produces:** `similarity_search(db, notebook_id, query_text: str, query_embedding, top_k=None, document_ids: list[UUID] | None = None, candidates=30) -> list[{"chunk","document"}]`.

- [ ] Migration 0002: `content_tsv` generated column + GIN index; `documents.ocr_pages int not null default 0`; `study_sets` table + index.
- [ ] Models: `Chunk.content_tsv = Column(TSVECTOR, Computed(...), deferred=True)`; `Document.ocr_pages`; `StudySet`.
- [ ] Retrieval: two ranked subqueries (vector, keyword OR-query guarded by `numnode(q) > 0`), RRF in Python, load chunk+document rows.
- [ ] Chat passes `payload.question`.
- [ ] **Verify:** alembic upgrade/downgrade/upgrade; existing chunks have non-null `content_tsv`; probe PDF with `XQZ-4471` buried on page 3 among unrelated text → keyword hit ranks page 3 first, vector-only does not; chat question naming it cites page 3; stop-word-only question ("what is this?") returns 6 results without error (RF1).
- [ ] Commit.

### Task 2: OCR

**Produces:** `extract_pages_from_pdf(bytes) -> (page_count, pages, ocr_pages)`; `DocumentOut.ocr_pages`.

- [ ] `uv add rapidocr-onnxruntime`; `services/ocr.py` singleton; parser fallback below 20 chars at 200 DPI; ingest stores `ocr_pages`, new no-text message.
- [ ] Dockerfile apt `libgl1 libglib2.0-0`.
- [ ] Sources panel: "N pages, M read with OCR".
- [ ] **Verify:** image-of-text PDF (rendered text as image, no text layer) → ready, `ocr_pages` = pages, chat cites it; mixed PDF (page 1 text, page 2 image) → `ocr_pages` 1, page numbers right (RF2); blank-image PDF → failed with new message; text PDF unchanged and fast.
- [ ] Commit.

### Task 3: Study backend

**Produces:** endpoints of spec §4.3–4.4; `StudySetOut{id, notebook_id, kind, title, topic, document_ids, items, last_score, item_count, created_at}`, `StudySetSummary` (no items).

- [ ] `llm.complete_json`, `services/study.py` (selection, prompt, validation, shuffle), `routers/study.py`, deps, schemas, main.
- [ ] **Verify (curl, real Groq):** quiz with topic on Module 5 PDF → 201, items cite valid pages, options 4 distinct, answer positions vary; 20 flashcards without topic span pages 1–3; list/get/score/delete; user B → 404; only-processing notebook → 400 (RF4); validator probe with bad items (dup options, idx 7, cite C42) drops them (RF3); simulated 429 via patched `complete_json` → 429 + Retry-After.
- [ ] Commit.

### Task 4: Study frontend

- [ ] Types/hooks; StudyPanel (list, generate form, errors with countdown); QuizPlayer; FlashcardPlayer; Chat | Study switch (desktop + mobile).
- [ ] **Verify (Playwright):** generate quiz with topic → answer all (keyboard 1–4, Enter) → score shown + saved → reload shows "Last score"; citation chip opens viewer at page; flashcards flip (Space), navigate (←/→), shuffle; delete with confirm; source deleted → chip toasts (RF5); mocked 429 shows countdown; 390 px layout; chat still works after switching back.
- [ ] Commit.

### Task 5: Docker + docs

- [ ] Rebuild image (no NVIDIA, OCR works offline), isolated stack smoke test incl. OCR upload and quiz generation via nginx.
- [ ] README features/API; project report sections (retrieval, ingestion/OCR, new study section, API, verification).
- [ ] Commit.
