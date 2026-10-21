# Folio retrieval evaluation

Generated 2026-10-19T20:28:10+00:00 by `python -m eval.run_eval`.

Dataset: 50 questions over 4 sample PDFs in `docs/samples/` (43 answerable, 7 unanswerable). Models: embeddings `BAAI/bge-small-en-v1.5`, reranker `cross-encoder/ms-marco-MiniLM-L6-v2`, LLM `openai/gpt-oss-120b`. Top 6 passages reach the model.

![Retrieval quality by configuration](chart.png)

## Retrieval

| Configuration | Hit@1 | Hit@3 | Hit@6 | MRR | Refused unanswerable | Refused answerable | Retrieval ms (median) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Vector search only (v1 baseline) | 77% | 93% | 98% | 0.852 | 0% | 0% | 116 |
| + keyword search (RRF) | 79% | 88% | 98% | 0.857 | 0% | 0% | 120 |
| + query rewrite | 79% | 93% | 98% | 0.867 | 0% | 0% | 31 |
| + reranker & confidence gate | 91% | 95% | 100% | 0.937 | 57% | 2% | 2,179 |
| + structure-aware chunks | 93% | 95% | 100% | 0.948 | 57% | 0% | 1,678 |
| + neighbouring text | 93% | 95% | 100% | 0.948 | 57% | 0% | 1,998 |

From **Vector search only (v1 baseline)** to **+ neighbouring text**: Hit@1 77% → 93%, Hit@3 93% → 95%, MRR 0.852 → 0.948.

### Hit@3 by question type

| Configuration | factual (n=18) | follow_up (n=5) | keyword (n=9) | paraphrase (n=11) |
|---|---:|---:|---:|---:|
| Vector search only (v1 baseline) | 100% | 60% | 89% | 100% |
| + keyword search (RRF) | 94% | 40% | 100% | 91% |
| + query rewrite | 94% | 80% | 100% | 91% |
| + reranker & confidence gate | 100% | 80% | 100% | 91% |
| + structure-aware chunks | 100% | 80% | 100% | 91% |
| + neighbouring text | 100% | 80% | 100% | 91% |

### Mean latency per stage (ms)

| Configuration | plan | embed | search | rerank |
|---|---:|---:|---:|---:|
| Vector search only (v1 baseline) | — | 94 | 26 | — |
| + keyword search (RRF) | — | 93 | 31 | — |
| + query rewrite | 2,472 | 33 | 21 | — |
| + reranker & confidence gate | 2,472 | 76 | 25 | 1,952 |
| + structure-aware chunks | 2,472 | 84 | 26 | 1,316 |
| + neighbouring text | 2,472 | 87 | 28 | 1,674 |

Plan is a Groq call; its time is measured on uncached calls. Embed, search and rerank run locally on CPU.

## Answers

Judged by `openai/gpt-oss-20b` against the excerpts each answer was given.

| Configuration | Citation precision | Answers with citations | Faithfulness | Key-fact recall | Unanswerable handled |
|---|---:|---:|---:|---:|---:|
| + neighbouring text | 96% | 100% | 97% | 95% | 100% |

Citation precision: cited pages that are gold pages. Faithfulness: claims supported by the cited excerpts. Unanswerable handled: refused by the confidence gate or declined by the model.

## Notes

- Small, purpose-written corpus: differences of one or two questions move a percentage by 2–3 points, so read the trends rather than the decimals.
- Gold labels are pages, so a passage counts as a hit if it comes from a gold page.
- The answer judge is a smaller LLM and errs strict (it sometimes marks a fully supported claim as unsupported); every graded answer is in `backend/eval/results/latest.json` for spot checks.
- Latency depends heavily on the machine: embedding, search and reranking run on the local CPU, and reranking 30 passages is the most expensive local step. Lower `RETRIEVE_K` to trade recall for speed.
- The query planner's output is cached within a run, so configurations after the first one that uses it reuse its rewrites and paraphrases.
- Planner errors (after retries): baseline: 0, hybrid: 0, rewrite: 0, reranker: 0, structured: 0, neighbors: 0.
