# FOLIO v2 — MASTER PROMPT

You are a senior full-stack + ML engineer and a world-class product designer. You are upgrading **Folio**, an existing NotebookLM-style RAG app (FastAPI + Postgres/pgvector + React/TS/Vite/Tailwind/TanStack Query/react-pdf, Groq LLM `openai/gpt-oss-120b`, local `BAAI/bge-small-en-v1.5` embeddings, RapidOCR, Alembic, Docker Compose + nginx). The repository README describes the current architecture, API and layout. Read the whole codebase before changing anything.

Goal: turn Folio into a **showpiece project** with (1) measurably better retrieval, (2) a rich feature set, and (3) a superior **maximalist** UI that stands out from every generic chat-with-PDF app. This is a university project review, so every upgrade must be **demoable in under two minutes** and, where possible, **measurable**.

---

## 0. GROUND RULES

1. **Do not break what works.** Existing auth, notebooks, upload, hybrid search, streaming chat, citations, quizzes and flashcards must keep working. Keep the API under `/api` and keep `docker compose up --build` as the one-command start.
2. **Work in phases** (see section 5). Before each phase: write a short plan listing files to create/change. After each phase: run tests, summarize what changed, and list how to demo it. Do not ask questions unless truly blocked; choose sensible defaults and note them.
3. **Free-tier friendly.** Groq's free tier is about 8,000 tokens/minute. Every new LLM call (rewrite, multi-query, summary, mind map) must be small, cached where possible, and degrade gracefully on `429`. Prefer local models (embeddings, reranker, PII, injection heuristics) for anything high-volume.
4. **Everything configurable** via `.env` with sane defaults, and every new feature has a **feature flag** (e.g. `ENABLE_RERANKER=true`) so the eval harness can A/B each stage.
5. **Database changes only through Alembic migrations.** Keep ownership checks: other users' resources return `404`.
6. **Security-first** (the author specializes in cybersecurity): validate all input, no secrets in code, httpOnly cookies, rate-limit new expensive endpoints, treat document text as untrusted.
7. **Code quality:** typed Python (mypy-clean where practical), typed React, small modules following the existing layout, docstrings on services, no dead code.
8. Update `README.md` at the end of every phase (features, config table, API table, limitations, architecture diagram).

---

## 1. PART ONE — ENHANCE THE RAG PIPELINE

Target pipeline:

```
question → [injection scan] → query rewrite (standalone) → multi-query expansion
        → hybrid search (vector + FTS, RRF) per query → fuse → cross-encoder rerank
        → confidence gate → context assembly → LLM (stream) → citation parse + verify
        → store answer + retrieval trace
```

### 1.1 Query rewriting (conversation-aware)
- Before retrieval, rewrite the user question into a **standalone query** using the last `HISTORY_MESSAGES` turns (small, low-temperature LLM call, max ~150 tokens, skipped when there is no history or the question is already self-contained).
- Store the rewritten query in the message's retrieval trace.

### 1.2 Multi-query expansion (+ optional HyDE)
- Generate 2–3 paraphrases (and optionally a short hypothetical answer for HyDE) in the **same** LLM call as the rewrite to save tokens (return JSON).
- Run hybrid search for each variant and merge with reciprocal rank fusion.

### 1.3 Cross-encoder reranking
- Retrieve top `RETRIEVE_K=30`, rerank with a local cross-encoder (`BAAI/bge-reranker-base` or a lighter MiniLM cross-encoder, CPU-friendly, loaded once at startup, cached in the Docker image), keep top `TOP_K=6`.
- Expose `RERANKER_MODEL`, `ENABLE_RERANKER`, `RETRIEVE_K`.

### 1.4 Structure-aware chunking
- Detect headings/sections (font size/bold via PyMuPDF) and chunk within sections; keep tables and code blocks intact; add **chunk metadata**: `section_title`, `page`, `chunk_index`, `char_start/end`.
- Prepend section title to the chunk text for embedding ("contextual chunks").
- Keep a migration path: add a `chunk_strategy` setting and a re-index endpoint/CLI for existing documents.

### 1.5 Source filtering
- Chat requests accept `document_ids` to restrict retrieval. UI: checkbox per source.

### 1.6 Confidence gate & grounded abstention
- Compute a confidence score from reranker scores. If below a threshold, answer "The sources don't contain this" with the nearest excerpts shown, instead of hallucinating.
- Return `confidence: high|medium|low` with the answer.

### 1.7 Citation verification
- After generation, verify each cited claim against its excerpt (cheap local NLI/embedding-similarity check). Mark weakly supported citations as "low support" and expose it to the UI.

### 1.8 Retrieval trace ("How was this answered?")
- Persist per-answer: original question, rewritten query, query variants, retrieved chunks with vector rank, keyword rank, fused score, rerank score, selected chunks, timings per stage, token usage. Endpoint: `GET /api/messages/{id}/trace`.

### 1.9 Semantic cache
- Cache answers keyed by (notebook, normalized-question embedding, source-set hash) with a similarity threshold; invalidate on document add/delete. Show a "⚡ cached" badge.

### 1.10 Security layer for RAG (document text is untrusted input)
- **Prompt-injection defense:** scan chunks at ingest and at retrieval (regex + heuristic classifier for phrases like "ignore previous instructions", role-override, exfiltration requests, hidden/white-on-white text, zero-width characters). Flag chunks (`risk_score`, `risk_reasons`), quarantine high-risk ones from the LLM context, and show a shield warning in the UI. Add a system-prompt guard that tells the LLM to treat excerpts as data, never instructions.
- **PII redaction (optional per-notebook toggle):** detect with Microsoft Presidio (+ regex for Indian identifiers such as Aadhaar/PAN/phone), redact or mask in stored chunks, and show a PII summary per document.
- **Safe uploads:** reject encrypted/malformed PDFs gracefully, cap page count, sanitize filenames, and scan for embedded JavaScript/launch actions.
- Ship a **threat-model section** in the README and a sample malicious PDF in `docs/samples/` for the demo.

### 1.11 Evaluation harness (the credibility piece)
- Create `backend/eval/` with:
  - `dataset.jsonl`: 30–50 Q&A pairs over 3–4 sample PDFs, each with expected page(s) and key facts.
  - `run_eval.py`: runs the pipeline under configurable flags and computes **Hit@k, MRR, citation accuracy (cited page ∈ gold pages), answer faithfulness (LLM-as-judge or Ragas, rate-limit aware), abstention accuracy on unanswerable questions, latency per stage**.
  - Output a Markdown table and JSON to `docs/eval/results.md`.
- Compare configurations: **baseline vector → + hybrid → + rewrite → + multi-query → + reranker → + structure-aware chunking**. Auto-generate a chart (PNG) for the README.
- Add an in-app **"Evaluation" page** (read-only) that renders the latest results.

### 1.12 Observability
- Structured JSON logs with request IDs, per-stage timings, token counters. Optional `/api/admin/metrics` (Prometheus format) and a small in-app admin stats panel (queries/day, avg latency, cache hit rate, abstain rate).

---

## 2. PART TWO — FEATURES

Implement with migrations, API endpoints, and UI.

**Chat & knowledge**
1. **Multiple chat threads per notebook** with auto-generated titles, rename, delete, pin.
2. **Notebook overview on source-ready:** auto summary + 4 clickable suggested questions + key topics (tags).
3. **Studio outputs** (like NotebookLM), all cited: *Briefing doc, Study guide, FAQ, Timeline, Glossary*. Render as rich documents, editable, exportable.
4. **Mind map:** LLM extracts entities/relations per notebook (cached), rendered as an interactive force/radial graph (e.g. `reactflow` or `d3-force`); clicking a node asks a pre-filled question or jumps to the source page.
5. **Answer actions:** copy, regenerate, edit-and-resend question, 👍/👎 feedback (stored, feeds the eval set), "show sources only", "explain simpler", "give example".
6. **Cross-notebook search** and an "Ask all notebooks" mode (with per-notebook grouping in citations).
7. **Pinned notes:** save any answer or snippet to a notebook notes board; notes can be cited later.

**Study tools**
8. **Spaced repetition (SM-2)** for flashcards: due queue, Again/Hard/Good/Easy, streak counter, daily goal, retention stats chart.
9. **Quiz upgrades:** timed mode, explanations with source jump, weak-topic report, retry-wrong-only, difficulty setting.
10. **Export:** answers/briefs to Markdown and PDF, flashcards to Anki (`.apkg` or CSV), quiz results to CSV.

**Sources**
11. **Multi-format ingestion:** DOCX, PPTX, TXT/Markdown, web URL (readability extraction, SSRF-protected: block private IP ranges and redirects to them), YouTube transcript.
12. **OCR bounding-box highlighting:** store RapidOCR boxes and render overlays in the viewer so OCR'd pages highlight too (removes a listed limitation).
13. **Source previews:** page thumbnails, page count, word count, detected language, per-source summary.

**Platform**
14. **Task queue:** replace FastAPI background tasks with ARQ/Celery + Redis (retries, progress %, resumable after restart). Live progress via SSE.
15. **Accounts:** password reset (tokenized email via SMTP/Resend with a dev "print link to console" mode), email verification, change password, delete account + data export.
16. **Sharing:** read-only share links for a notebook (revocable, expiring), plus viewer/editor roles for invited users.
17. **Optional local LLM:** provider abstraction (`LLM_PROVIDER=groq|ollama|openai-compatible`) so the app can run fully offline.
18. **Optional Audio Overview:** a short two-voice spoken summary using a local/free TTS; keep behind a flag.
19. **Redis-backed rate limiting** for login and expensive endpoints; storage abstraction (local disk or S3/MinIO).

---

## 3. PART THREE — MAXIMALIST UI/UX (the "wow" layer)

**Art direction: "Neo-maximalist research cockpit."** More is more — but *orchestrated*: dense, layered, colorful, tactile, alive — never messy. Think editorial magazine + sci-fi instrument panel + glassmorphism + bento dashboards. It must still be fast, legible, and accessible.

### 3.1 Design system (build first, one source of truth)
- **Tokens in CSS variables + Tailwind theme:** color scales, radii, shadows, blur, gradients, spacing, z-layers, motion durations/easings. Light, dark, and one extra bold theme ("Aurora" or "Ink & Neon"); theme switcher with animated transition.
- **Color:** rich multi-hue palette (e.g. electric violet, hot coral, acid lime, cyan, amber) used with intent: each *source* gets its own persistent color that appears on its card, its citation chips, its highlights and its mind-map nodes. Gradient accents, duotone cards, glow borders.
- **Typography:** pair an expressive display face (e.g. *Fraunces*, *Instrument Serif*, *Clash Display* or *Space Grotesk*) for headlines and hero numbers with a refined text sans (*Inter*/*Geist*) and a mono (*JetBrains Mono*) for metadata and scores. Oversized hero type, tight tracking, variable-font weight animations on hover. Serif for answer body text. Self-host fonts via Fontsource.
- **Texture & depth:** film-grain noise overlay, animated gradient mesh backgrounds, glassmorphic panels with layered blur, inner highlights, soft colored shadows, hairline gradient borders, subtle parallax and tilt on cards.
- **Iconography:** Lucide with consistent stroke, plus custom animated icons for key moments (upload, thinking, success).
- **Component library:** build on shadcn/ui + Radix primitives, restyled to the system. Document in a `/design` route (living style guide / Storybook-lite) — this doubles as a review demo.

### 3.2 Layout & screens
- **Landing/Sign-in:** full-bleed animated mesh hero, giant headline, floating 3D-tilt feature cards, a live looping demo of a cited answer, glass sign-in card.
- **Notebook dashboard:** bento grid of notebook cards with generated cover art (gradient + pattern seeded from title), source avatars stack, activity sparkline, quick actions, "continue where you left off" strip, global stats ribbon (documents, questions asked, flashcards due).
- **Workspace (three resizable panes with `react-resizable-panels`):**
  - *Left — Sources:* colorful source cards with processing progress rings, page thumbnails, include/exclude toggles, risk shield and PII badges, drag-and-drop zone that glows and ripples.
  - *Center — Chat/Studio:* tabbed (Chat · Studio · Mind map · Notes · Study). Threads sidebar. Rich message cards, suggested-question chips, sticky composer with slash-commands (`/summarize`, `/quiz`, `/compare`) and `@source` mentions.
  - *Right — Viewer/Inspector:* PDF viewer, **Retrieval Inspector** tab (pipeline waterfall chart of stages and timings, chunk scores as bars, rewritten query, confidence meter), and **Citations** tab.
- **Command palette (`⌘/Ctrl+K`, `cmdk`):** navigate notebooks, switch threads/themes, upload, generate outputs, jump to any source page, run quick actions; fuzzy search with recent items and keyboard hints.
- **Mobile:** bottom tab bar (Sources · Chat · Viewer · Study), swipe gestures, sheet-style panels, safe-area aware.

### 3.3 Signature interactions (the memorable moments)
1. **Pipeline theater:** while answering, show an animated stepper: *Rewriting → Searching (vector + keyword) → Reranking → Reading → Writing* with live mini-visualizations (chunks flying into a "context tray"). Real timings from the trace.
2. **Citation chips:** color-coded to the source, with spring hover cards showing page thumbnail, section title, snippet with matched words highlighted, relevance bar, and "low support" warning when applicable.
3. **Marker-stroke highlight:** clicking a citation slides the viewer in, smooth-scrolls to the page, and animates a highlighter stroke across the passage; a connecting beam/line animates from chip to highlight on wide screens.
4. **Streaming text** with soft per-word fade, caret glow, and confidence meter that fills as the answer completes.
5. **Mind map playground:** physics-based nodes with source-colored clusters, zoom/pan, minimap, hover previews, click to ask.
6. **Flashcards:** real 3D flip, swipe-to-rate on touch, keyboard (`Space` flip, `1–4` rate), confetti on streak milestones, animated retention charts.
7. **Quiz results:** animated score ring, per-topic radar chart, shareable result card.
8. **Easter-egg polish:** animated empty states with illustrations, a satisfying "indexed ✓" burst when a source becomes ready, cursor-following glow on hero areas.
9. **Security theater done right:** a shield animation when a malicious chunk is quarantined, with a clear explanation drawer.

### 3.4 Motion & performance rules
- Framer Motion (`motion`) with spring physics; durations 150–350 ms; stagger lists; shared-layout transitions between dashboard card → workspace.
- Respect `prefers-reduced-motion` (replace with fades); animations on `transform`/`opacity` only; lazy-load heavy views (PDF, graph, charts); virtualize long lists; skeleton shimmers instead of spinners; Lighthouse performance ≥ 85 on the dashboard despite the visual weight.

### 3.5 Accessibility (non-negotiable even in maximalism)
- WCAG AA contrast in every theme, visible focus rings, full keyboard navigation, ARIA labels/live regions for streaming answers, screen-reader text for citation chips, color never the sole carrier of meaning (icons + labels as well), "Calm mode" toggle that disables grain, parallax and heavy animation.

### 3.6 Libraries (suggested)
`shadcn/ui`, `radix-ui`, `framer-motion`, `cmdk`, `sonner`, `react-resizable-panels`, `reactflow` or `d3-force`, `recharts` or `visx`, `lucide-react`, `@fontsource/*`, `react-confetti`/`canvas-confetti`, `react-hotkeys-hook`, `zustand` (UI state). Keep bundle size in check with route-level code splitting.

---

## 4. TESTING, CI, DOCS

- **Backend:** pytest for chunking, retrieval fusion, reranker wiring, citation parsing/verification, auth/ownership, injection scanner, PII redaction, SM-2 scheduler, SSRF guard. Use a test Postgres via Compose/testcontainers. Target ≥ 70% coverage on `services/`.
- **Frontend:** Vitest + Testing Library for components; **Playwright** e2e for: sign up → create notebook → upload sample PDF → ask question → click citation → viewer highlights → generate flashcards → review.
- **CI:** GitHub Actions running lint (ruff, eslint, tsc), tests, Docker build, and the eval harness in "smoke" mode.
- **Docs:** README with updated feature list, a new architecture diagram (Mermaid) showing the full pipeline, config table, API table, security/threat model, eval results table + chart, "Review 1 → Review 2" changelog, screenshots/GIFs of the signature interactions, and a one-page `DEMO_SCRIPT.md` for the review presentation.
- Seed script: `scripts/seed_demo.py` creates a demo user, notebooks and sample documents so the demo starts rich, not empty.

---

## 5. PHASED EXECUTION PLAN

Execute in this order; each phase ends with working software, tests, README updates and a demo checklist.

| Phase | Scope | Done when |
|---|---|---|
| **1. Foundations** | Design system + tokens + themes, feature flags, structured logging, test/CI scaffolding | `/design` style guide page renders; CI green |
| **2. RAG core** | 1.1–1.6, 1.8, source filtering, retrieval trace API | Rewrite + multi-query + rerank + abstention work behind flags |
| **3. Evaluation** | 1.11 harness + dataset + results page | Table shows baseline → full pipeline improvement |
| **4. Workspace UI** | Three-pane layout, citation chips + hover cards, marker-stroke highlight, pipeline theater, Retrieval Inspector, command palette | Full chat flow feels premium end to end |
| **5. Threads & Studio** | Threads, overview/suggested questions, Studio outputs, notes, answer actions | Demo-ready content features |
| **6. Study** | SM-2 flashcards, quiz upgrades, exports, results visuals | Review queue + stats work |
| **7. Security layer** | 1.10 injection/PII/safe upload + shield UI + sample malicious PDF | Malicious sample is caught live |
| **8. Sources & platform** | Multi-format ingestion, OCR boxes, task queue, accounts (reset/verify), sharing | Limitations section shrinks |
| **9. Wow extras** | Mind map, cross-notebook search, semantic cache, audio overview (flagged), landing page, dashboard bento | Visual showpiece complete |
| **10. Polish & ship** | Accessibility pass, performance pass, Playwright e2e, final docs, demo script, seed data | Lighthouse/a11y checks pass; one-command demo works |

If time is limited, **never skip**: phases 1, 2, 3, 4 and 7, then as many of 5, 6 and 9 as time allows.

---

## 6. OUTPUT FORMAT FOR EACH PHASE

1. **Plan** — files to add/change, migrations, new env vars.
2. **Implementation** — complete code (no placeholders or TODO stubs).
3. **Verification** — commands run, test results, screenshots/GIF descriptions.
4. **Demo steps** — a 60–90 second script for the review.
5. **README/CHANGELOG diff summary.**

Start now with **Phase 1**. First, scan the repository and give me a short summary of the current state, any risks you see in the existing code, and your Phase 1 plan; then implement it.
