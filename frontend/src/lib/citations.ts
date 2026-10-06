import type { Source } from '../api/types'

// Same tolerance as the backend's normalize_citations: [[C1]], [C1], [[C1, C2]], 【C1】, 【C1†L3】.
const LOOSE = /(?:\[\[?|【)\s*(C\d+(?:\s*[,;]\s*C?\d+)*)[^\]】\n]{0,20}?(?:\]\]?|】)/g
const CANONICAL = /\[\[C(\d+)\]\]/g
// A marker still being streamed in, e.g. "...budget [[C" — hidden until complete.
const PARTIAL_TAIL = /(?:\[\[?C?\d*,?\s*\d*\]?|【[^】\n]{0,20})$/

/** Links with this href prefix are rendered as citation chips by AnswerText. */
export const CITE_HREF = '#cite-'

export function normalizeCitations(text: string): string {
  return text.replace(LOOSE, (_, group: string) =>
    (group.match(/\d+/g) ?? []).map((n) => `[[C${n}]]`).join(''),
  )
}

export function stripPartialMarker(text: string): string {
  return text.replace(PARTIAL_TAIL, '')
}

export type Citation = {
  /** Display number, by order of first appearance in this answer (1, 2, 3...). */
  n: number
  /** Null while streaming, before sources are known. */
  source: Source | null
}

/**
 * Turns an answer into markdown for rendering: every [[Cn]] marker becomes a
 * link `[k](#cite-k)`, numbered 1..k by first appearance, which AnswerText
 * draws as a chip. Markers that don't match a known source are dropped once
 * sources are available (the model occasionally invents one).
 */
export function prepareAnswer(
  content: string,
  sources: Source[] | null,
): { markdown: string; citations: Citation[] } {
  const text = normalizeCitations(content)
  const byMarker = new Map(sources?.filter((s) => s.marker).map((s) => [s.marker!, s]) ?? [])
  // Older messages saved before markers were stored: sources are in ascending marker order.
  if (sources && byMarker.size === 0 && sources.length) {
    const used = [...new Set([...text.matchAll(CANONICAL)].map((m) => Number(m[1])))].sort((a, b) => a - b)
    used.forEach((n, i) => sources[i] && byMarker.set(`C${n}`, sources[i]))
  }

  const numbers = new Map<string, Citation>()
  let previous: Citation | null = null
  const markdown = text.replace(CANONICAL, (_, num: string, offset: number, whole: string) => {
    const marker = `C${num}`
    const source = byMarker.get(marker) ?? null
    if (sources && !source) return '' // unknown marker
    let citation = numbers.get(marker)
    if (!citation) {
      citation = { n: numbers.size + 1, source }
      numbers.set(marker, citation)
    }
    // Collapse the same citation repeated back-to-back ([[C1]][[C1]]).
    const adjacent = whole.slice(0, offset).endsWith(']]')
    if (adjacent && previous === citation) return ''
    previous = citation
    return `[${citation.n}](${CITE_HREF}${citation.n})`
  })

  return { markdown, citations: [...numbers.values()] }
}

/** Plain text for the clipboard: markers become [1], [2]. */
export function answerToPlainText(markdown: string): string {
  return markdown.replace(/\[(\d+)\]\(#cite-\d+\)/g, '[$1]')
}
