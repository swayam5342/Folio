import type { SourceKind } from '../api/types'

type Located = { page_number: number; section_title?: string | null; document_kind?: SourceKind | null }

/** Short location of a cited passage: "p. 4" for PDFs, "slide 4" for decks, else its section (or ""). */
export function sourceLocation(s: Located): string {
  const kind = s.document_kind ?? 'pdf'
  if (kind === 'pdf') return `p. ${s.page_number}`
  if (kind === 'pptx') return `slide ${s.page_number}`
  return s.section_title ?? ''
}

/** Long form for labels and tooltips: "page 4", "slide 4", "section Findings" (or ""). */
export function sourceLocationLong(s: Located): string {
  const kind = s.document_kind ?? 'pdf'
  if (kind === 'pdf') return `page ${s.page_number}`
  if (kind === 'pptx') return `slide ${s.page_number}`
  return s.section_title ? `section “${s.section_title}”` : ''
}

/** "file.pdf, page 4" / "Notes" when there's no location. */
export function sourceLabel(s: Located & { filename: string }): string {
  const where = sourceLocationLong(s)
  return where ? `${s.filename}, ${where}` : s.filename
}

export const KIND_LABEL: Record<SourceKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  pptx: 'PPTX',
  txt: 'TXT',
  md: 'MD',
  text: 'Text',
}

/** File types the upload accepts (keep in step with backend services/extractors.py). */
export const UPLOAD_ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown'
export const UPLOAD_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.txt', '.md', '.markdown']

/** PDFs and decks are located by page/slide (the section is extra detail); other kinds by section only. */
export const isPaged = (s: { document_kind?: SourceKind | null }) => (s.document_kind ?? 'pdf') === 'pdf' || s.document_kind === 'pptx'
