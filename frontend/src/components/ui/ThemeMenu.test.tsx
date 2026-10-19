import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'

import { useTheme } from '../../lib/theme'
import { ThemeMenu } from './ThemeMenu'

beforeEach(() => {
  useTheme.setState({ pref: 'system', theme: 'light', calm: false })
})

it('switches theme from the menu', async () => {
  const user = userEvent.setup()
  render(<ThemeMenu />)

  await user.click(screen.getByRole('button', { name: 'Theme and display' }))
  expect(screen.getByRole('menuitemradio', { name: /System/ })).toHaveAttribute('aria-checked', 'true')

  await user.click(screen.getByRole('menuitemradio', { name: /Aurora/ }))
  expect(document.documentElement.dataset.theme).toBe('aurora')
})

it('turns on calm mode from the menu', async () => {
  const user = userEvent.setup()
  render(<ThemeMenu />)

  await user.click(screen.getByRole('button', { name: 'Theme and display' }))
  await user.click(screen.getByRole('menuitemcheckbox', { name: /Calm mode/ }))

  expect(document.documentElement).toHaveAttribute('data-calm')
  expect(useTheme.getState().calm).toBe(true)
})
