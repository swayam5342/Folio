import { describe, expect, it } from 'vitest'

import { AA_LARGE_OR_UI, AA_TEXT, contrastRatio } from '../lib/contrast'
import { SOURCE_COLOR_COUNT } from '../lib/sourceColors'
import { THEMES } from '../lib/theme'
import tokensCss from './tokens.css?raw'

const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** Custom properties a theme ends up with: shared :root blocks first, then its own blocks. */
function themeVars(theme: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector.split(',').map((s) => s.trim()),
    body,
  }))
  const applies = (selectors: string[], own: boolean) =>
    selectors.some((s) => (own ? s === `:root[data-theme='${theme}']` : s === ':root'))
  for (const own of [false, true]) {
    for (const block of blocks.filter((b) => applies(b.selectors, own))) {
      for (const [, name, value] of block.body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[name] = value.trim()
    }
  }
  return vars
}

const textPairs: [fg: string, bg: string][] = [
  ...['ink', 'muted', 'faint'].flatMap((fg) => ['paper', 'surface', 'sunken'].map((bg): [string, string] => [fg, bg])),
  ['accent', 'paper'],
  ['accent', 'surface'],
  ['accent-ink', 'accent'],
  ['ink', 'accent-soft'],
  ['highlight-ink', 'highlight'],
  ['ink', 'highlight-soft'],
  ['danger', 'surface'],
  ['danger', 'danger-soft'],
  ['ok', 'ok-soft'],
  ['warn', 'warn-soft'],
  ...Array.from({ length: SOURCE_COLOR_COUNT }, (_, i): [string, string] => [`src-${i + 1}-ink`, `src-${i + 1}-soft`]),
]

const uiPairs: [fg: string, bg: string][] = [
  ['focus', 'paper'],
  ['focus', 'surface'],
  ...Array.from({ length: SOURCE_COLOR_COUNT }, (_, i): [string, string] => [`src-${i + 1}`, 'surface']),
]

describe.each(THEMES.map((t) => t.value).filter((t) => t !== 'system'))('%s theme', (theme) => {
  const vars = themeVars(theme)

  it.each(textPairs)('%s on %s meets AA for text (4.5:1)', (fg, bg) => {
    const ratio = contrastRatio(vars[fg] ?? '', vars[bg] ?? '')
    expect(ratio, `--${fg} / --${bg} must both be hex colors`).not.toBeNull()
    expect(ratio!).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(uiPairs)('%s on %s meets AA for UI graphics (3:1)', (fg, bg) => {
    const ratio = contrastRatio(vars[fg] ?? '', vars[bg] ?? '')
    expect(ratio, `--${fg} / --${bg} must both be hex colors`).not.toBeNull()
    expect(ratio!).toBeGreaterThanOrEqual(AA_LARGE_OR_UI)
  })
})
