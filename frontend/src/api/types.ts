export type User = {
  id: string
  username: string
  created_at: string
}

export type Notebook = {
  id: string
  name: string
  created_at: string
  updated_at: string
  source_count: number
  pii_redaction_enabled: boolean
}

export type DocumentStatus = 'processing' | 'ready' | 'failed'

export type SourceDocument = {
  id: string
  notebook_id: string
  filename: string
  page_count: number
  ocr_pages: number
  size_bytes: number
  status: DocumentStatus
  error: string | null
  risk_score: number
  risk_reasons: string[]
  pii_summary: Record<string, number>
  created_at: string
}

export type Source = {
  marker?: string | null
  chunk_id: string
  document_id: string
  filename: string
  page_number: number
  section_title?: string | null
  snippet: string
  /** Relevance to the question: reranker score (0-1), else cosine similarity. */
  score?: number | null
  /** Whether the excerpt supports the claims citing it (citation check). */
  support?: 'ok' | 'low' | null
  support_score?: number | null
}

export type Confidence = 'high' | 'medium' | 'low'

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
  /** Answers only; null for answers saved before confidence existed. */
  confidence?: Confidence | null
  /** The sources didn't support an answer: `sources` are the nearest excerpts, not citations. */
  abstained?: boolean
  created_at: string
}

/** Pipeline stages streamed while an answer is being prepared. */
export type ChatStage = 'plan' | 'search' | 'rerank' | 'generate' | 'verify'

/** Sent once retrieval finishes: what was searched and which passages the model will read. */
export type RetrievalEvent = {
  question: string
  queries: string[]
  rewritten: boolean
  candidates: number
  reranked: boolean
  confidence: Confidence | null
  abstain: boolean
  passages: {
    marker: string
    document_id: string
    filename: string
    page_number: number
    section_title: string | null
    score: number | null
  }[]
  timings_ms: Record<string, number>
}

export type TraceCandidate = {
  chunk_id: string
  document_id: string
  filename: string
  page_number: number
  section_title: string | null
  snippet: string
  vector_rank: number | null
  keyword_rank: number | null
  vector_similarity: number | null
  fused_score: number
  rerank_score: number | null
  selected: boolean
  marker: string | null
  support?: 'ok' | 'low' | null
}

type TokenUsage = { prompt_tokens: number | null; completion_tokens: number | null } | null

/** "How was this answered?" — GET /messages/{id}/trace */
export type RetrievalTrace = {
  message_id: string
  question: string
  standalone_query: string
  variants: string[]
  hypothetical: string | null
  planner: { llm_called: boolean; cached: boolean; error: string | null }
  document_ids: string[] | null
  features: Record<string, boolean>
  candidates: TraceCandidate[]
  reranked: boolean
  confidence: Confidence | null
  top_score: number | null
  abstained: boolean
  timings_ms: Record<string, number>
  total_ms: number
  tokens: { planner: TokenUsage; answer: TokenUsage }
  citation_coverage?: number | null
}

/** What the PDF viewer should show. */
export type ViewerTarget = {
  documentId: string
  page: number
  snippet?: string
  /** Changes on every open so re-clicking the same citation re-triggers the highlight. */
  nonce: number
}

export type StudyKind = 'quiz' | 'flashcards'

export type QuizItem = {
  question: string
  options: string[]
  answer_index: number
  explanation: string
  source: Source
}

export type FlashcardItem = {
  front: string
  back: string
  source: Source
}

export type StudySetSummary = {
  id: string
  notebook_id: string
  kind: StudyKind
  title: string
  topic: string | null
  item_count: number
  last_score: number | null
  created_at: string
}

export type StudySet = StudySetSummary & {
  document_ids: string[]
  items: QuizItem[] | FlashcardItem[]
}

export type StudySetCreate = {
  kind: StudyKind
  count: number
  topic?: string
  document_ids?: string[]
}

// --- Evaluation (GET /eval/results) -----------------------------------------

export type EvalRetrieval = {
  'hit@1': number | null
  'hit@3': number | null
  'hit@6': number | null
  mrr: number | null
  abstain_unanswerable: number | null
  false_abstain: number | null
  by_type: Record<string, { n: number; 'hit@3': number | null; mrr: number | null }>
  confidence: Record<'high' | 'medium' | 'low', number>
}

export type EvalAnswers = {
  n: number
  failed: number
  citation_precision: number | null
  cited_answers: number | null
  faithfulness: number | null
  key_fact_recall: number | null
  unanswerable_handled: number | null
}

export type EvalConfig = {
  name: string
  label: string
  strategy: 'fixed' | 'structured'
  flags: Record<string, boolean>
  retrieval: EvalRetrieval
  latency_ms: Record<string, number>
  planner_errors: number
  answers?: EvalAnswers
}

export type EvalResults = {
  generated_at: string
  commit: string | null
  mode: 'full' | 'smoke'
  duration_s: number
  llm_tokens: number
  dataset: {
    questions: number
    answerable: number
    unanswerable: number
    documents: string[]
    types: Record<string, number>
  }
  settings: Record<string, string | number | null>
  configs: EvalConfig[]
}
