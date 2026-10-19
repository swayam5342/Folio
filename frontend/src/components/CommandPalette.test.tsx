import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import { useTheme } from '../lib/theme'
import { useWorkspace } from '../lib/workspace'
import CommandPalette from './CommandPalette'

const NOTEBOOKS = [{ id: 'n1', name: 'Networks', created_at: '', updated_at: '', source_count: 2 }]
const DOCS = [
  { id: 'd1', notebook_id: 'n1', filename: 'tcp.pdf', page_count: 3, ocr_pages: 0, size_bytes: 1, status: 'ready', error: null, created_at: '2026-01-01' },
]

beforeEach(() => {
  useWorkspace.getState().reset(`nb-${Math.random()}`)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/documents') ? DOCS : NOTEBOOKS), { status: 200 })),
  )
})
afterEach(() => vi.unstubAllGlobals())

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<CommandPalette />} />
        </Routes>
        <Routes>
          <Route path="/evaluation" element={<p>evaluation page</p>} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

it('opens with Ctrl+K and navigates to a page', async () => {
  const user = renderAt('/')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.keyboard('{Control>}k{/Control}')
  const input = await screen.findByPlaceholderText('Type a command, notebook, source or page…')
  await user.type(input, 'evaluation')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('evaluation page')).toBeInTheDocument()
  expect(useWorkspace.getState().paletteOpen).toBe(false)
})

it('lists notebooks and switches theme', async () => {
  const user = renderAt('/')
  useWorkspace.getState().setPaletteOpen(true)
  expect(await screen.findByRole('option', { name: /Networks/ })).toBeInTheDocument()
  await user.type(screen.getByRole('combobox'), 'theme dark')
  await user.keyboard('{Enter}')
  expect(useTheme.getState().pref).toBe('dark')
})

it('inside a notebook, jumps to a source page', async () => {
  const user = renderAt('/notebooks/n1')
  useWorkspace.getState().setPaletteOpen(true)
  await user.type(await screen.findByRole('combobox'), 'tcp page 3')
  expect(await screen.findByRole('option', { name: /tcp · page 3/ })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(useWorkspace.getState().viewer).toMatchObject({ documentId: 'd1', page: 3 })
})
