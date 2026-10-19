import { describe, expect, it } from 'vitest'

import { assignSourceColors, SOURCE_COLOR_COUNT, sourceColorStyle } from './sourceColors'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)

describe('assignSourceColors', () => {
  it('is deterministic', () => {
    expect(assignSourceColors(ids(5))).toEqual(assignSourceColors(ids(5)))
  })

  it('gives up to eight sources distinct hues in range', () => {
    const colors = [...assignSourceColors(ids(SOURCE_COLOR_COUNT)).values()]
    expect(new Set(colors).size).toBe(SOURCE_COLOR_COUNT)
    expect(colors.every((c) => c >= 1 && c <= SOURCE_COLOR_COUNT)).toBe(true)
  })

  it('keeps existing sources stable when a new one is added', () => {
    const before = assignSourceColors(ids(4))
    const after = assignSourceColors(ids(5))
    for (const [id, color] of before) expect(after.get(id)).toBe(color)
  })

  it('reuses hues beyond eight sources instead of failing', () => {
    const colors = assignSourceColors(ids(12))
    expect(colors.size).toBe(12)
    expect([...colors.values()].every((c) => c >= 1 && c <= SOURCE_COLOR_COUNT)).toBe(true)
  })

  it('ignores duplicate ids', () => {
    expect(assignSourceColors(['a', 'a', 'b']).size).toBe(2)
  })
})

it('sourceColorStyle points the generic variables at one hue', () => {
  expect(sourceColorStyle(3)).toEqual({
    '--src': 'var(--src-3)',
    '--src-soft': 'var(--src-3-soft)',
    '--src-ink': 'var(--src-3-ink)',
  })
})
