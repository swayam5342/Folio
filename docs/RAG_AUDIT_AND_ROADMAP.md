# Folio RAG audit and delivery roadmap

Last reviewed: 2026-10-18

“Perfect RAG” is not a one-time model choice: it is a measured system spanning ingestion,
retrieval, grounded generation, product workflows, security and operations. This file is the
ordered backlog and acceptance record for Folio.

## Completed in the current hardening pass

- [x] Preserve an explicit empty source selection instead of silently searching every source.
- [x] Reject malformed/encrypted/active-content/embedded-file PDFs and enforce a page cap.
- [x] Normalize invisible Unicode; detect explainable injection patterns; quarantine unsafe chunks.
- [x] Delimit source text as untrusted data and strengthen the generation guard prompt.
- [x] Add per-notebook PII masking with Aadhaar, PAN, email and Indian-phone summaries.
- [x] Surface document risk and PII badges in the Sources panel.
- [x] Add migration `0004` for source-security metadata and the notebook setting.
- [x] Use BGE's asymmetric query instruction and validate embedding dimensions at startup.
- [x] Align confidence with the passages actually selected for generation.
- [x] De-duplicate context, cap per-document dominance and round-robin sources for broad summaries.
- [x] Give summaries a larger bounded context than focused factual questions.
- [x] Measure valid claim citation coverage; refuse fully uncited generations and warn on partial coverage.
- [x] Expose citation coverage in the Retrieval Inspector and label confidence as retrieval match.
- [x] Fix expired-session handling for streamed chat and distinguish outages from sign-out.
- [x] Stop pre-allocating a command for every page of every PDF.
- [x] Split liveness/readiness and make Compose gate on DB/storage readiness.
- [x] Add baseline CSP, anti-framing, MIME, referrer and permissions headers in nginx.
- [x] Repair the evaluation corpus builder for the new secure-ingestion return shape.

## P0 — required before claiming production readiness

- [ ] Move OCR/embedding from FastAPI background tasks to a bounded durable worker queue with
  retries, leases, idempotency, cancellation, progress and dead-letter handling.
- [ ] Stream uploads to temporary storage rather than buffering 50 MB per request; add per-user
  source/page/storage quotas and duplicate detection.
- [ ] Replace the relevance cross-encoder citation check with claim-level entailment/contradiction
  verification and an answer-repair pass.
- [ ] Add Redis-backed rate limits for registration, upload, chat and study generation; trust
  forwarded IP headers only from configured proxies.
- [ ] Add revocable/rotating sessions, TLS deployment, secret rotation and backup/restore runbooks.
- [ ] Add unskippable Postgres integration tests and Playwright flows covering upload → ingest →
  ask → citation → PDF evidence, tenant isolation and malicious sources.

## P1 — retrieval and answer quality

- [ ] Token-aware parent/child chunks with table, figure, caption, list and bounding-box metadata.
- [ ] Neighbor-window expansion and semantic MMR rather than exact-text de-duplication alone.
- [ ] Hierarchical document summaries and incremental notebook synthesis for very long corpora.
- [ ] Multilingual OCR, embeddings and lexical search with language-aware routing.
- [ ] Metadata/entity/date filters and contradiction-aware synthesis across conflicting sources.
- [ ] Conversation/turn IDs, idempotency keys, explicit failed/completed state and multiple threads.
- [ ] Semantic answer cache keyed by notebook version, source set and normalized query embedding.
- [ ] Provider abstraction for Groq, OpenAI-compatible endpoints and a fully local Ollama path.

## P1 — NotebookLM-competitive product surface

- [ ] Source types: URL, pasted text, Markdown/TXT, DOCX, PPTX, CSV, EPUB, audio and YouTube.
- [ ] Studio artifacts: editable cited briefing, study guide, FAQ, timeline and glossary.
- [ ] Notes/canvas with save-answer/save-snippet and note citation.
- [ ] Mind maps, audio overview, configurable chat style/language and export to common formats.
- [ ] Spaced repetition, quiz difficulty/timing/weak-topic reports and Anki/CSV export.
- [ ] Sharing/collaboration, roles, expiring links, cross-notebook search and source sync.
- [ ] Full PDF toolbar: thumbnails/outline, search, zoom, page entry, download and robust fuzzy anchors.

## P1 — evaluation credibility

- [ ] Split calibration from held-out evaluation; add real long/noisy/scanned/table/multilingual PDFs.
- [ ] Add adversarial injection, conflicting sources, duplicate sources and temporal questions.
- [ ] Measure answer correctness, citation precision/recall/coverage/entailment, calibration/AURC,
  security attack success, success rate, p50/p95/p99 latency, memory and token/cost budgets.
- [ ] Randomize configuration order, run repeated trials, report confidence intervals and include
  a blinded human comparison against NotebookLM. Never exclude failed generations from the
  end-to-end reliability score.

## Current verification record

- Backend Ruff: pass.
- Backend mypy (configured strict module set): pass.
- New security/citation tests: 10 passed.
- Frontend TypeScript: pass.
- Frontend lint: pass with only existing Fast Refresh module-boundary warnings.
- Frontend production build: pass.
- Compose configuration: valid; runtime migration/integration test not run because Docker Desktop
  was not active.
- Full Vitest run is not reliable in the current Windows sandbox: worker temp files disappear with
  `ENOENT`; this must be confirmed in CI or a normal host before release.
