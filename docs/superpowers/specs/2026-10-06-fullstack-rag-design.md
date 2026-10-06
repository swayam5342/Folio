# Full-stack NotebookLM-style RAG app — design

**Date:** 2026-10-06
**Status:** Approved in conversation, pending written-spec review

## 1. Goal and context

Turn the existing backend-only RAG API into a complete, polished, deployable
"chat with your PDFs" application for a college project / demo.

**Stated by the user**
- Demo piece: should look polished and NotebookLM-like.
- Username + password auth; each user sees only their own notebooks.
- Uploaded PDFs are stored (so citations can open the real page).
- Chat history is saved.
- "Production-ready"; runs on the user's laptop only.
- No backend test suite required.

**Assumptions (accepted)**
- LLM stays on Groq (free tier); embeddings stay local (`BAAI/bge-small-en-v1.5`, 384-dim).
- "Production-ready" means: hashed passwords, per-user data isolation,
  migrations, clean error handling (incl. Groq 429s), one-command
  `docker compose up`. Not: horizontal scaling, email verification,
  password reset by email.

**Success criteria**
1. `docker compose up --build` from a fresh clone (with a `.env` containing a
   Groq key) yields a working app at `http://localhost:8080`.
2. A new user can register, create a notebook, upload a PDF, watch it go
   processing → ready, ask questions, get streamed cited answers, click a
   citation and see the cited page in the PDF viewer.
3. Reloading the page preserves notebooks, documents, and chat history.
4. User A cannot read, list, download, chat with, or delete user B's data
   (all such requests return 404).
5. Every phase is verified by running it end to end (no automated test suite).

## 2. Architecture

```
Browser ──► nginx (frontend container, :8080)
              ├─ /        → built React SPA (static)
              └─ /api/*   → backend:8000 (proxy_buffering off for streaming)
backend (FastAPI) ──► Postgres + pgvector (db container)
                  ──► uploads volume (PDF files)
                  ──► Groq API (answer generation)
                  ──  local sentence-transformers model (embeddings, offline)
```

Same-origin via nginx means the auth cookie works without CORS.
In development, Vite's dev server proxies `/api` to `localhost:8000`.

## 3. Backend

### 3.1 Data model

| Table | Columns |
|---|---|
| `users` | `id` uuid pk, `username` text unique (case-insensitive, stored lowercased; 3–32 chars `[a-z0-9_]`), `password_hash` text, `created_at` |
| `notebooks` | existing + `user_id` fk→users (cascade delete), `updated_at` (bumped on rename, document upload/delete, and each saved message) |
| `documents` | existing + `storage_path` text, `size_bytes` int, `status` enum(`processing`,`ready`,`failed`), `error` text null |
| `chunks` | unchanged |
| `messages` | `id` uuid pk, `notebook_id` fk→notebooks (cascade), `role` enum(`user`,`assistant`), `content` text, `sources` jsonb (list of SourceOut, `[]` for user messages), `created_at` |

One chat thread per notebook. Schema is managed by **Alembic**; the
`db/schema.sql` docker-entrypoint init is removed (Alembic creates the
`vector` extension in its first migration). The initial migration drops any
pre-existing ownerless rows (current smoke-test data).

### 3.2 Auth

- Passwords: bcrypt (min length 8).
- Session: JWT (HS256, `JWT_SECRET`, 7-day expiry, claim `sub` = user id) in an
  `httpOnly`, `SameSite=Lax` cookie named `session`. `Secure` flag configurable
  (off for localhost).
- `get_current_user` dependency on every non-auth route; 401 if missing/invalid.
- Login rate limit: max 10 failed attempts per (username, IP) per 15 minutes,
  in-memory (single-process deployment). Exceeding → 429.
- Ownership: every notebook/document/message lookup joins through
  `notebooks.user_id = current_user.id`; not-owned resources return **404**
  (don't reveal existence).

### 3.3 API (all under `/api`)

| Method & path | Purpose |
|---|---|
| `POST /auth/register` `{username,password}` | Create user, set cookie, return user |
| `POST /auth/login` | Verify, set cookie, return user |
| `POST /auth/logout` | Clear cookie |
| `GET /auth/me` | Current user or 401 |
| `GET /notebooks` | Current user's notebooks with `source_count`, `updated_at`, newest first |
| `POST /notebooks` `{name}` | Create |
| `PATCH /notebooks/{id}` `{name}` | Rename |
| `DELETE /notebooks/{id}` | Delete notebook + its documents' files on disk |
| `GET /notebooks/{id}` | Single notebook |
| `GET /notebooks/{id}/documents` | List with status |
| `POST /notebooks/{id}/documents` (multipart) | Upload; returns doc with `status=processing` |
| `GET /documents/{id}` | Single doc (for status polling) |
| `GET /documents/{id}/file` | Stream the PDF (`application/pdf`), owner only |
| `DELETE /documents/{id}` | Delete row, chunks, and file |
| `GET /notebooks/{id}/messages` | Chat history, oldest first |
| `DELETE /notebooks/{id}/messages` | Clear chat |
| `POST /notebooks/{id}/chat` `{question}` | Streamed answer (SSE, see 3.5) |
| `GET /health` | Liveness |

Error bodies keep FastAPI's `{"detail": "..."}` shape.

### 3.4 Upload pipeline

1. Validate: filename ends `.pdf`, file starts with `%PDF-` magic bytes, size ≤
   `MAX_UPLOAD_MB` (default 50). Otherwise 400/413.
2. Save to `UPLOAD_DIR/<user_id>/<document_id>.pdf` (never the user-supplied
   filename on disk).
3. Insert document `status=processing`, return immediately.
4. Background task (FastAPI `BackgroundTasks`, own DB session): extract pages →
   chunk → embed (run in a thread so the event loop isn't blocked) → insert
   chunks → `status=ready`. On any exception: `status=failed`, `error` set to a
   user-safe message ("No extractable text — is this a scanned PDF?" etc.).
5. On startup, any documents left in `processing` (server crashed mid-job) are
   marked `failed` with "Processing was interrupted — please re-upload."

### 3.5 Chat pipeline

1. Verify ownership; reject empty question or > 2000 chars.
2. Save user message.
3. Embed question; similarity search over chunks of the notebook's **ready**
   documents only (top-k = `TOP_K`).
4. If no ready documents → stream a fixed message ("Upload a source to start
   chatting"), save it, done.
5. Build prompt = existing citation-forcing prompt + last 6 messages of history
   (as prior chat turns). Retrieval uses the raw question (no LLM query rewrite).
6. Stream from Groq (`stream=True`). Response is **Server-Sent Events**:
   - `event: token` `data: {"text": "..."}` — repeated
   - `event: done` `data: {"message": <MessageOut with parsed sources>}`
   - `event: error` `data: {"detail": "...", "retry_after": <seconds|null>}`
7. On completion, parse `[[Cn]]` markers into sources and save the assistant
   message. On Groq 429, emit `error` with `retry_after` from the response
   header; no assistant message saved (the user message stays, so the UI can
   offer "retry").

Request uses `fetch` + ReadableStream on the client (POST body), not EventSource.

### 3.6 Configuration (`.env`)

`DATABASE_URL`, `GROQ_API_KEY`, `GROQ_MODEL`, `JWT_SECRET` (required — startup
fails if unset or the placeholder value), `COOKIE_SECURE` (default false),
`UPLOAD_DIR` (default `./uploads`), `MAX_UPLOAD_MB`, `EMBEDDING_MODEL`,
`EMBEDDING_DIM`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `TOP_K`, `POSTGRES_PASSWORD`.

## 4. Frontend (`frontend/`)

**Stack:** React + Vite + TypeScript, Tailwind CSS, TanStack Query, React Router,
`react-pdf` (pdf.js). No component-library dependency beyond small headless
primitives if needed.

### 4.1 Routes

| Route | Screen |
|---|---|
| `/login` | Sign in / Create account (single card, toggle). Inline field errors. |
| `/` | Notebooks home — card grid (name, source count, last updated), "New notebook" card, per-card menu: rename / delete (with confirm). |
| `/notebooks/:id` | Workspace (below). |

Auth guard: unauthenticated → `/login`; any 401 from the API → clear cached
user, redirect to `/login`.

### 4.2 Workspace (three panels)

- **Sources (left):** drag-and-drop / "Add PDF" button; list with filename, page
  count, status badge (processing spinner / ready / failed + error + Remove).
  Polls `GET /documents/{id}` every 2 s while any doc is processing. Clicking a
  ready source opens it in the viewer at page 1. Delete via item menu.
- **Chat (centre):** history loads on open; streamed assistant replies;
  `[[Cn]]` rendered as numbered citation chips (numbered by order of first
  appearance in that answer). Hover chip → snippet tooltip; click → open viewer
  at that document/page and highlight the snippet text. Empty state shows
  generic starter prompts ("Summarize these sources", "What are the key
  points?", "What questions does this raise?"). Composer: Enter to send,
  Shift+Enter newline, disabled while streaming or with no ready sources.
  "Clear chat" in panel header. Rate-limit error shows retry countdown + Retry.
- **PDF viewer (right):** hidden until a citation/source is opened; shows
  filename, page N / total, prev/next, close. Highlight: search the page's text
  layer for the snippet (normalized whitespace, first ~80 chars) and mark
  matching spans; if not found, just show the page.
- **Mobile (< 1024 px):** panels become tabs (Sources / Chat / Viewer);
  clicking a citation switches to Viewer.

### 4.3 Visual direction

Calm "research desk": warm off-white paper background, ink-dark text, one
accent colour reserved for citations/primary actions; serif display face for
headings, clean sans for UI/body; subtle borders over heavy shadows; light and
dark themes (follows system, toggle in header). Explicitly avoid generic
purple-gradient AI styling.

### 4.4 Errors

Toasts for failed mutations; inline errors on forms; failed document shows its
error; network failure during stream shows partial answer + "Response
interrupted — retry".

## 5. Packaging

`docker-compose.yml` services:

- **db** — `pgvector/pgvector:pg16`, `pgdata` volume, healthcheck.
- **backend** — Python 3.13 image, deps via uv with **CPU-only torch** index;
  embedding model downloaded at build time; runtime `HF_HUB_OFFLINE=1`;
  entrypoint runs `alembic upgrade head` then uvicorn; `uploads` volume;
  waits for db healthy.
- **frontend** — multi-stage: node build → nginx serving `dist/`; nginx proxies
  `/api` to `backend:8000` with `proxy_buffering off` and
  `client_max_body_size` matching `MAX_UPLOAD_MB`; SPA fallback to
  `index.html`. Exposed on host port **8080**.

Run: `cp .env.example .env` → set `GROQ_API_KEY`, `JWT_SECRET` →
`docker compose up --build` → `http://localhost:8080`.

Dev mode: `docker compose up db`, `uv run alembic upgrade head`,
`uv run uvicorn app.main:app --reload`, `cd frontend && npm run dev`.

README rewritten: overview, architecture diagram, features, setup (Docker +
dev), configuration table, API summary, design decisions, known limitations.

## 6. Build phases

1. **Backend** — config, Alembic + migration, auth, ownership, new endpoints,
   PDF storage, background processing, chat history + streaming. Verified by
   driving the API with curl (two users, isolation checks, upload → ready,
   streamed chat, history persists).
2. **Frontend** — all screens and workspace behaviour against the dev backend.
   Verified in a browser (golden path + failed upload + rate-limit display +
   mobile width).
3. **Packaging** — Dockerfiles, nginx, compose, README. Verified with a clean
   `docker compose up --build` and the golden path at `:8080`.

## 7. Out of scope

Automated tests; password reset / email; OAuth; multi-instance scaling
(in-memory rate limiter and local-disk storage assume one backend process);
non-PDF sources; OCR for scanned PDFs; reranking; multiple chat threads per
notebook; sharing notebooks between users.
