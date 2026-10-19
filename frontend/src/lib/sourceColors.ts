import type { CSSProperties } from 'react'

/** Number of source hues defined in styles/tokens.css (--src-1 ... --src-8). */
export const SOURCE_COLOR_COUNT = 8

/** FNV-1a: a small, stable string hash, so a source keeps its hue across sessions and devices. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Gives every source a hue (1-8). Each source prefers the slot its id hashes to; on a clash
 * it takes the next free slot, so up to eight sources in one notebook never share a color.
 * Pass ids oldest first: earlier sources keep their preferred slot when new ones arrive.
 */
export function assignSourceColors(ids: readonly string[]): Map<string, number> {
  const assigned = new Map<string, number>()
  const taken = new Set<number>()
  for (const id of ids) {
    if (assigned.has(id)) continue
    let slot = hash(id) % SOURCE_COLOR_COUNT
    if (taken.size < SOURCE_COLOR_COUNT) {
      while (taken.has(slot)) slot = (slot + 1) % SOURCE_COLOR_COUNT
    }
    taken.add(slot)
    assigned.set(id, slot + 1)
  }
  return assigned
}

/**
 * CSS variables that point a subtree at one source hue. Components then use
 * var(--src) / var(--src-soft) / var(--src-ink) without knowing which hue it is.
 */
export function sourceColorStyle(color: number): CSSProperties {
  return {
    '--src': `var(--src-${color})`,
    '--src-soft': `var(--src-${color}-soft)`,
    '--src-ink': `var(--src-${color}-ink)`,
  } as CSSProperties
}
