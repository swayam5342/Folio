import type { Source } from '../api/types'

// Same tolerance as the backend's normalize_citations: [[C1]], [C1], [[C1, C2]], 【C1】, 【C1†L3】.
const LOOSE = /(?:\[\[?|【)\s*(C\d+(?:\s*[,;]\s*C?\d+)*)[^\]】\n]{0,20}?(?:\]\]?|】)/g
const CANONICAL = /\[\[C(\d+)\]\]/g
// A marker still being streamed in, e.g. "...budget [[C" — hidden until complete.
const PARTIAL_TAIL = /(?:\[\[?C?\d*,?\s*\d*\]?|【[^】\n]{0,20})$/

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

export type Segment = { kind: 'text'; text: string } | { kind: 'cite'; citation: Citation }

/**
 * Splits an answer into text and citation segments, renumbering [[Cn]] markers
 * 1..k by first appearance. Markers that don't match a known source are dropped
 * once sources are available (the model occasionally invents one).
 */
export function segmentAnswer(
  content: string,
  sources: Source[] | null,
): { segments: Segment[]; citations: Citation[] } {
  const text = normalizeCitations(content)
  const byMarker = new Map(sources?.filter((s) => s.marker).map((s) => [s.marker!, s]) ?? [])
  // Older messages saved before markers were stored: sources are in ascending marker order.
  if (sources && byMarker.size === 0 && sources.length) {
    const used = [...new Set([...text.matchAll(CANONICAL)].map((m) => Number(m[1])))].sort((a, b) => a - b)
    used.forEach((n, i) => sources[i] && byMarker.set(`C${n}`, sources[i]))
  }

  const segments: Segment[] = []
  const numbers = new Map<string, Citation>()
  let last = 0
  for (const m of text.matchAll(CANONICAL)) {
    if (m.index > last) segments.push({ kind: 'text', text: text.slice(last, m.index) })
    last = m.index + m[0].length
    const marker = `C${m[1]}`
    const source = byMarker.get(marker) ?? null
    if (sources && !source) continue // unknown marker
    let citation = numbers.get(marker)
    if (!citation) {
      citation = { n: numbers.size + 1, source }
      numbers.set(marker, citation)
    }
    // Collapse the same citation repeated back-to-back ([[C1]][[C1]]).
    const prev = segments.at(-1)
    if (prev?.kind === 'cite' && prev.citation === citation) continue
    segments.push({ kind: 'cite', citation })
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })

  return { segments, citations: [...numbers.values()] }
}
