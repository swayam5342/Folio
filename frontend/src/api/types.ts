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
  created_at: string
}

export type Source = {
  marker?: string | null
  chunk_id: string
  document_id: string
  filename: string
  page_number: number
  snippet: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
  created_at: string
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
