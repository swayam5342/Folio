/** WCAG 2.x contrast helpers, used by the token tests and the /design style guide. */

export const AA_TEXT = 4.5
export const AA_LARGE_OR_UI = 3

/** Parses #rgb or #rrggbb into [r, g, b] (0-255); null for anything else (rgba, names, vars). */
export function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex)
  if (short) return [short[1], short[2], short[3]].map((c) => parseInt(c + c, 16)) as [number, number, number]
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex)
  if (long) return [long[1], long[2], long[3]].map((c) => parseInt(c, 16)) as [number, number, number]
  return null
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio between two hex colors (1-21), or null if either isn't a hex color. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return null
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
