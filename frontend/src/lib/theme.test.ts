import { beforeEach, describe, expect, it } from 'vitest'

import { resolveTheme, useTheme } from './theme'

const root = document.documentElement

beforeEach(() => {
  useTheme.setState({ pref: 'system', theme: 'light', calm: false })
})

describe('resolveTheme', () => {
  it('follows the device for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('keeps an explicit choice regardless of the device', () => {
    expect(resolveTheme('aurora', false)).toBe('aurora')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('useTheme', () => {
  it('applies and saves a theme choice', () => {
    useTheme.getState().setPref('aurora')

    expect(root.dataset.theme).toBe('aurora')
    expect(localStorage.getItem('folio-theme')).toBe('aurora')
    expect(useTheme.getState()).toMatchObject({ pref: 'aurora', theme: 'aurora' })
  })

  it('saves "system" itself, not the theme it resolved to', () => {
    useTheme.getState().setPref('dark')
    useTheme.getState().setPref('system')

    expect(localStorage.getItem('folio-theme')).toBe('system')
    expect(root.dataset.theme).toBe('light') // the test environment reports a light device
  })

  it('toggles calm mode on <html> and remembers it', () => {
    useTheme.getState().setCalm(true)
    expect(root.hasAttribute('data-calm')).toBe(true)
    expect(localStorage.getItem('folio-calm')).toBe('1')

    useTheme.getState().setCalm(false)
    expect(root.hasAttribute('data-calm')).toBe(false)
  })
})
