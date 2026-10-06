# Full-stack NotebookLM-style RAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deviation from the standard template (user instruction):** the user asked for
> no automated test suite and to start building immediately. Each task therefore
> ends with a concrete end-to-end verification (curl / browser) instead of a
> TDD cycle, and the plan carries file responsibilities + interfaces rather than
> full code listings.

**Goal:** Turn the backend-only RAG API into an authenticated, multi-user,
full-stack app (React frontend, stored PDFs, saved + streamed chat) that runs
with one `docker compose up`.

**Architecture:** FastAPI under `/api` with cookie-JWT auth and per-user
ownership checks; Postgres/pgvector managed by Alembic; PDFs on a local volume
processed by background tasks; Groq streaming over SSE. React/Vite SPA served by
nginx, which also proxies `/api`.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 async + asyncpg, Alembic,
pgvector, bcrypt, PyJWT, sentence-transformers (CPU torch), Groq SDK; React,
Vite, TypeScript, Tailwind CSS v4, TanStack Query, React Router, react-pdf;
nginx; Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-06-fullstack-rag-design.md`

## Global Constraints

- All API routes under `/api`; error bodies `{"detail": "..."}`.
- Not-owned resources return **404**, never 403.
- Username: 3–32 chars `[a-z0-9_]`, stored lowercased. Password: min 8 chars.
- Session cookie `session`, httpOnly, SameSite=Lax, 7-day JWT (HS256, `sub`=user id).
- Login rate limit: 10 failed attempts per (username, IP) per 15 min → 429.
- Upload: `.pdf` + `%PDF-` magic + ≤ `MAX_UPLOAD_MB` (default 50). Stored at `UPLOAD_DIR/<user_id>/<document_id>.pdf`.
- Chat question: 1–2000 chars; history window = last 6 messages; retrieval only over `ready` documents.
- SSE events: `token {text}`, `done {message}`, `error {detail, retry_after}`.
- `JWT_SECRET` required; startup fails if unset or placeholder.
- Frontend served on host port **8080**; runtime `HF_HUB_OFFLINE=1` in Docker; CPU-only torch.
- No automated tests (user instruction).

## Review Focus

1. Scanned/image-only PDF → document goes `failed` with "No extractable text — is this a scanned PDF?", not stuck in `processing`.
2. Server restarted mid-processing → doc becomes `failed` "Processing was interrupted — please re-upload." on startup.
3. Groq 429 / network drop mid-stream → client shows partial text + retry; user message kept, no half-saved assistant message.
4. User B guessing user A's notebook/document UUID (incl. `/documents/{id}/file`) → 404.
5. Model emits a `[[C9]]` marker that doesn't exist → chip not rendered as a broken link; text stays readable.

Each of these is exercised in the verification step of the owning task.

## File Map

### Backend (`app/`)
| File | Responsibility |
|---|---|
| `config.py` | Settings incl. `JWT_SECRET`, `COOKIE_SECURE`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`; validates secret |
| `database.py` | Engine, `AsyncSessionLocal`, `Base`, `get_db` (unchanged API) |
| `models.py` | `User`, `Notebook`, `Document`, `Chunk`, `Message` |
| `schemas.py` | Pydantic in/out models |
| `security.py` | `hash_password`, `verify_password`, `create_token`, `decode_token`, `LoginRateLimiter` |
| `deps.py` | `get_current_user`, `get_owned_notebook`, `get_owned_document` |
| `routers/auth.py` | register / login / logout / me |
| `routers/notebooks.py` | notebook CRUD + list with source counts |
| `routers/documents.py` | upload, list, get, file download, delete |
| `routers/chat.py` | history, clear, streamed chat |
| `services/storage.py` | `save_pdf`, `delete_file`, `absolute` (path building under `UPLOAD_DIR`) |
| `services/ingest.py` | `process_document(document_id)` background job, `fail_interrupted_documents()` |
| `services/llm.py` | prompt building w/ history, `stream_answer`, `parse_citations`, `RateLimited` |
| `services/retrieval.py` | similarity search restricted to ready docs |
| `services/embeddings.py`, `chunking.py`, `pdf_parser.py` | unchanged (pdf_parser: `import pymupdf`) |
| `main.py` | app, lifespan (startup recovery), `/api` routers, `/api/health` |
| `alembic.ini`, `alembic/env.py`, `alembic/versions/0001_initial.py` | migrations |

### Frontend (`frontend/src/`)
| File | Responsibility |
|---|---|
| `api/types.ts` | TS types mirroring API schemas |
| `api/client.ts` | `api<T>(path, init)` fetch wrapper, `ApiError`, 401 hook |
| `api/stream.ts` | `streamChat(notebookId, question, handlers, signal)` SSE parser |
| `api/queries.ts` | TanStack Query hooks for all endpoints |
| `lib/citations.ts` | `renumberCitations(answer, sources)` → segments + ordered sources |
| `components/ui/*` | `Button`, `Spinner`, `Toaster`/`toast`, `ConfirmDialog`, `Menu`, `ThemeToggle` |
| `components/AppHeader.tsx` | logo, user, theme toggle, logout |
| `pages/LoginPage.tsx` | sign in / create account |
| `pages/NotebooksPage.tsx` | grid, create, rename, delete |
| `pages/WorkspacePage.tsx` | 3-panel / tabs layout, viewer state |
| `components/workspace/SourcesPanel.tsx` | upload (drag-drop), list, status, poll |
| `components/workspace/ChatPanel.tsx` | history, composer, streaming, errors |
| `components/workspace/AnswerText.tsx` | answer markdown-lite + citation chips |
| `components/workspace/PdfViewer.tsx` | react-pdf page view + snippet highlight |
| `App.tsx`, `main.tsx`, `index.css` | routing, auth guard, providers, theme tokens |

### Packaging
`Dockerfile` (backend), `docker/entrypoint.sh`, `.dockerignore`, `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`, `docker-compose.yml`, `.env.example`, `README.md`. Delete `db/schema.sql`, root `main.py`.

---

## Phase 1 — Backend

### Task 1: Config, models, Alembic migration

**Interfaces — Produces:** ORM models `User(id, username, password_hash, created_at)`, `Notebook(+user_id, updated_at)`, `Document(+storage_path, size_bytes, status, error)`, `Message(id, notebook_id, role, content, sources, created_at)`; `DocumentStatus` / `MessageRole` str enums; `settings.JWT_SECRET`, `COOKIE_SECURE`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`.

- [ ] Add deps: `uv add alembic bcrypt pyjwt`; sync `requirements.txt`.
- [ ] Extend `config.py`; `validate_secret()` called at app startup.
- [ ] Rewrite `models.py` with new columns/tables (`server_default`s, enums as SQLAlchemy `Enum(native_enum=False)` strings).
- [ ] `alembic init alembic`; async `env.py` using `settings.DATABASE_URL` and `Base.metadata`.
- [ ] Hand-write `0001_initial.py`: `CREATE EXTENSION vector`; create all five tables idempotently from the existing DB (drop old tables, since only smoke data exists), HNSW index on `chunks.embedding vector_cosine_ops` (replaces ivfflat, which with `lists=100` on small data returns too few rows), FK indexes.
- [ ] Remove `db/schema.sql` mount from compose; delete file and root `main.py`.
- [ ] **Verify:** `uv run alembic upgrade head` → `\d` shows 5 tables + `alembic_version`; `alembic downgrade base && upgrade head` round-trips.
- [ ] Commit.

### Task 2: Auth (security, deps, routes)

**Interfaces — Produces:** `hash_password(str)->str`, `verify_password(str,str)->bool`, `create_token(uuid)->str`, `decode_token(str)->uuid|None`, `get_current_user(request, db)->User`; routes `/api/auth/*`; `UserOut{id, username, created_at}`.

- [ ] `security.py`, `deps.get_current_user`, `routers/auth.py`, `main.py` mounting under `/api` + lifespan calling `validate_secret()`.
- [ ] **Verify (curl with cookie jar):** register → 200 + `Set-Cookie`; duplicate username (any case) → 409; short password → 422; `/me` with cookie → user, without → 401; bad password ×11 → 429 on 11th; logout → `/me` 401.
- [ ] Commit.

### Task 3: Notebooks + ownership

**Interfaces — Produces:** `get_owned_notebook(notebook_id, user, db)->Notebook` (404 otherwise); `NotebookOut{id, name, created_at, updated_at, source_count}`.

- [ ] `routers/notebooks.py`: list (with `source_count` subquery, `updated_at desc`), create, get, rename, delete (also removes files via storage helper).
- [ ] **Verify:** user A creates/renames/lists; user B lists → empty, GET/PATCH/DELETE A's id → 404; empty/whitespace name → 422.
- [ ] Commit.

### Task 4: PDF storage + background ingestion

**Interfaces — Produces:** `storage.save_pdf(user_id, document_id, bytes)->str`, `storage.delete_file(path)`, `storage.absolute(path)->Path`; `ingest.process_document(document_id)`; `ingest.fail_interrupted_documents()`; `get_owned_document(document_id, user, db)->Document`; `DocumentOut{id, notebook_id, filename, page_count, size_bytes, status, error, created_at}`.

- [ ] `services/storage.py`, `services/ingest.py` (own session, embedding via `asyncio.to_thread`), `pdf_parser.py` → `import pymupdf`.
- [ ] `routers/documents.py`: upload (validate ext, magic, size with streamed read cap), list, get, `/file` (`FileResponse`, `application/pdf`, inline disposition), delete (row + file); bump `notebook.updated_at`.
- [ ] Startup: `fail_interrupted_documents()` in lifespan.
- [ ] **Verify:** upload text PDF → `processing` then `ready` with page_count; image-only PDF → `failed` with scanned-PDF message (Review Focus 1); `.txt` renamed `.pdf` → 400; >limit → 413; `/file` returns PDF bytes for owner, 404 for user B (RF 4); delete removes file from disk; insert a `processing` row, restart → `failed` interrupted (RF 2).
- [ ] Commit.

### Task 5: Chat history + streaming

**Interfaces — Produces:** `MessageOut{id, role, content, sources: SourceOut[], created_at}`; `llm.stream_answer(question, retrieved, history) -> AsyncIterator[str]`, `llm.RateLimited(retry_after)`; SSE stream from `POST /api/notebooks/{id}/chat`.

- [ ] `services/retrieval.py`: add `Document.status == ready` filter.
- [ ] `services/llm.py`: system prompt (rules) + history turns + user turn with excerpts; Groq `stream=True`; map `groq.RateLimitError` → `RateLimited` with `retry-after` header.
- [ ] `routers/chat.py`: GET/DELETE messages; POST chat → `StreamingResponse(media_type="text/event-stream")`, headers `Cache-Control: no-cache`, `X-Accel-Buffering: no`; save user msg first, assistant msg on completion with parsed sources; empty-sources fixed message path.
- [ ] **Verify:** `curl -N` shows incremental `token` events then `done`; history GET returns both messages with sources; follow-up "tell me more about that" uses context; no-ready-docs notebook → fixed message; question >2000 → 422; clear → empty history; user B → 404 (RF 4). RF 3 server side: throwaway script (scratchpad, not committed) that patches `llm.stream_answer` to yield two tokens then raise `RateLimited(12)`, runs the chat endpoint via `httpx.ASGITransport`, and asserts the stream ends with `event: error` `retry_after: 12` and no assistant message is saved.
- [ ] Commit.

## Phase 2 — Frontend

### Task 6: Scaffold, theme, API layer, auth screens

**Interfaces — Produces:** `api<T>()`, `ApiError{status, detail, retryAfter}`, query hooks `useMe`, `useLogin`, `useRegister`, `useLogout`; `<RequireAuth>`; CSS tokens (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-ink`) for light/dark.

- [ ] `npm create vite@latest frontend -- --template react-ts`; add tailwind v4 (`@tailwindcss/vite`), `@tanstack/react-query`, `react-router`, `react-pdf`; Vite proxy `/api` → `http://localhost:8000`.
- [ ] Fonts (Google Fonts: serif display + sans UI), tokens, ThemeToggle (system default, persisted in localStorage with try/catch).
- [ ] `LoginPage` with toggle, inline errors, redirect to `/` on success; `RequireAuth` redirects to `/login`; global 401 → clear `me` cache → `/login`.
- [ ] **Verify (browser):** register, reload stays logged in, logout, wrong password shows inline error, `npm run build` passes typecheck.
- [ ] Commit.

### Task 7: Notebooks home

- [ ] `useNotebooks`, `useCreateNotebook`, `useRenameNotebook`, `useDeleteNotebook`; `NotebooksPage` grid, new-notebook card (inline name), card menu, `ConfirmDialog`, toasts, empty state.
- [ ] **Verify:** create → navigates to workspace; rename/delete reflect immediately; second user sees none of them.
- [ ] Commit.

### Task 8: Workspace — sources + PDF viewer

**Interfaces — Produces:** `ViewerTarget{documentId, page, snippet?}`; `SourcesPanel({notebookId, onOpen(target)})`; `PdfViewer({target, documents, onClose})`.

- [ ] `useDocuments` (refetchInterval 2000 while any `processing`), `useUploadDocument` (multipart, multiple files), `useDeleteDocument`.
- [ ] `SourcesPanel` with drag-drop, status badges, failed error + Remove.
- [ ] `PdfViewer` with react-pdf worker config, page nav, fit-to-width via ResizeObserver, snippet highlight via `customTextRenderer` matching normalized snippet prefix.
- [ ] `WorkspacePage` layout: 3 columns ≥1024px, tabs below; viewer hidden until opened.
- [ ] **Verify:** upload → spinner → ready; scanned PDF shows error + Remove (RF 1); click source opens page 1; mobile width shows tabs.
- [ ] Commit.

### Task 9: Workspace — chat

**Interfaces — Consumes:** `streamChat`, `useMessages`, `useClearMessages`, `ViewerTarget`. **Produces:** `renumberCitations(text, sources)`.

- [ ] `api/stream.ts` SSE parser over `fetch` ReadableStream (handles chunk boundaries, `\r\n`).
- [ ] `lib/citations.ts`: map `[[Cn]]` → display numbers by first appearance; unknown markers dropped (RF 5).
- [ ] `AnswerText` (paragraphs, lists, bold via tiny renderer — no HTML injection) with chips + hover snippet tooltip; click → `onOpen({documentId, page, snippet})`.
- [ ] `ChatPanel`: history, starter prompts, composer (Enter/Shift+Enter, disabled states), optimistic user bubble, streaming bubble, `done` → replace with saved message + invalidate notebooks; `error` → rate-limit countdown + Retry; network drop → partial + "Response interrupted — retry" (RF 3); Clear chat with confirm.
- [ ] **Verify:** golden path end to end incl. citation click → viewer at page with highlight; reload keeps history; follow-up question; clear chat.
- [ ] Commit.

## Phase 3 — Packaging

### Task 10: Docker, nginx, compose, README

- [ ] Backend `Dockerfile`: `python:3.13-slim`, uv, CPU torch via `[tool.uv.sources]` torch → `pytorch-cpu` index (explicit), pre-download embedding model in build, `HF_HUB_OFFLINE=1`, `entrypoint.sh` = `alembic upgrade head && uvicorn`.
- [ ] `frontend/Dockerfile` (node build → nginx), `nginx.conf` (SPA fallback, `/api` proxy, `proxy_buffering off`, `client_max_body_size 50m`, long read timeout).
- [ ] `docker-compose.yml`: db (healthcheck), backend (depends healthy, `uploads` volume, env_file), frontend (8080:80). Drop obsolete `version:`.
- [ ] `.env.example` complete; README rewrite per spec §5.
- [ ] **Verify:** `docker compose down -v && docker compose up --build` → golden path at `http://localhost:8080`; restart containers → data persists.
- [ ] Commit.
