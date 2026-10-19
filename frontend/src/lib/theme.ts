import { create } from 'zustand'

/**
 * Theme and Calm mode. The preference is saved in localStorage and applied to <html>
 * as data-theme (always a concrete theme) and data-calm. index.html applies the saved
 * values before first paint with the same keys, so keep the two in step.
 */

export type ThemePref = 'system' | 'light' | 'dark' | 'aurora'
export type Theme = Exclude<ThemePref, 'system'>

export const THEMES: { value: ThemePref; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follow the device setting' },
  { value: 'light', label: 'Light', hint: 'Warm paper' },
  { value: 'dark', label: 'Dark', hint: 'Low light' },
  { value: 'aurora', label: 'Aurora', hint: 'Midnight and neon' },
]

const THEME_KEY = 'folio-theme'
const CALM_KEY = 'folio-calm'

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage blocked (private mode, policy): fall back to defaults
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the choice still applies for this visit */
  }
}

function isThemePref(value: string | null): value is ThemePref {
  return THEMES.some((t) => t.value === value)
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): Theme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return pref
}

function apply(theme: Theme, calm: boolean): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.toggleAttribute('data-calm', calm)
}

function motionAllowed(calm: boolean): boolean {
  return !calm && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Switches theme with a circular reveal from `origin` (View Transitions API) when the
 * browser supports it and motion is allowed; otherwise switches instantly.
 */
function transition(theme: Theme, calm: boolean, origin?: { x: number; y: number }): void {
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown }
  if (!doc.startViewTransition || !motionAllowed(calm)) {
    apply(theme, calm)
    return
  }
  const root = document.documentElement
  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? 0
  root.style.setProperty('--vt-x', `${x}px`)
  root.style.setProperty('--vt-y', `${y}px`)
  doc.startViewTransition(() => apply(theme, calm))
}

interface ThemeState {
  pref: ThemePref
  theme: Theme
  calm: boolean
  setPref: (pref: ThemePref, origin?: { x: number; y: number }) => void
  setCalm: (calm: boolean) => void
}

const initialPref = ((): ThemePref => {
  const saved = load(THEME_KEY)
  return isThemePref(saved) ? saved : 'system'
})()

export const useTheme = create<ThemeState>((set, get) => ({
  pref: initialPref,
  theme: resolveTheme(initialPref, systemPrefersDark()),
  calm: load(CALM_KEY) === '1',
  setPref: (pref, origin) => {
    const theme = resolveTheme(pref, systemPrefersDark())
    save(THEME_KEY, pref)
    if (theme !== get().theme) transition(theme, get().calm, origin)
    set({ pref, theme })
  },
  setCalm: (calm) => {
    save(CALM_KEY, calm ? '1' : '0')
    apply(get().theme, calm)
    set({ calm })
  },
}))

/** Applies the stored theme and follows OS light/dark changes while the preference is "system". */
export function initTheme(): void {
  const { theme, calm } = useTheme.getState()
  apply(theme, calm)
  if (typeof window.matchMedia !== 'function') return
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    const state = useTheme.getState()
    if (state.pref !== 'system') return
    const next = resolveTheme('system', event.matches)
    apply(next, state.calm)
    useTheme.setState({ theme: next })
  })
}
