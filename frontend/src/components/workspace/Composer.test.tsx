import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { SourceDocument } from '../../api/types'
import { useWorkspace } from '../../lib/workspace'
import Composer from './Composer'

const doc = (id: string, filename: string): SourceDocument => ({
  id,
  notebook_id: 'nb',
  filename,
  page_count: 5,
  ocr_pages: 0,
  size_bytes: 1000,
  status: 'ready',
  error: null,
  risk_score: 0,
  risk_reasons: [],
  pii_summary: {},
  created_at: `2026-10-0${id.length}T00:00:00Z`,
})

const DOCS = [doc('d1', 'networks.pdf'), doc('d22', 'memory.pdf')]

beforeEach(() => {
  useWorkspace.getState().reset(`nb-${Math.random()}`)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DOCS), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onAsk = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Composer
        notebookId="nb"
        readyDocs={DOCS}
        selectedIds={null}
        streaming={false}
        disabledReason={null}
        onAsk={onAsk}
        onStop={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onAsk, user: userEvent.setup(), box: screen.getByRole('combobox', { name: 'Your question' }) }
}

it('sends a question with no source restriction', async () => {
  const { onAsk, user, box } = setup()
  await user.type(box, 'What is slow start?{Enter}')
  expect(onAsk).toHaveBeenCalledWith('What is slow start?', null)
  expect(box).toHaveValue('')
})

it('offers slash commands and completes the highlighted one', async () => {
  const { user, box } = setup()
  await user.type(box, '/')
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
    expect.stringContaining('/summarize'),
    expect.stringContaining('/compare'),
    expect.stringContaining('/quiz'),
    expect.stringContaining('/flashcards'),
  ])
  await user.keyboard('{ArrowDown}{Enter}')
  expect(box).toHaveValue('/compare ')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('@mentions restrict the next question to those sources', async () => {
  const { onAsk, user, box } = setup()
  await user.type(box, 'see @mem')
  expect(screen.getByRole('option', { name: /memory\.pdf/ })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Remove memory' })).toBeInTheDocument()
  await user.type(box, 'page tables{Enter}')
  expect(onAsk).toHaveBeenCalledWith('see page tables', ['d22'])
})

it('/compare needs two sources and asks a comparison over them', async () => {
  const one = setup({ readyDocs: [DOCS[0]] })
  await one.user.type(one.box, '/compare{Escape}{Enter}')
  expect(one.onAsk).not.toHaveBeenCalled()
})

it('/compare over every ready source', async () => {
  const { onAsk, user, box } = setup()
  await user.type(box, '/compare cost{Enter}')
  expect(onAsk).toHaveBeenCalledWith(
    'Compare networks and memory on cost: where do they agree, and where do they differ?',
    ['d1', 'd22'],
  )
})

it('/quiz opens the study generator instead of asking', async () => {
  const { onAsk, user, box } = setup()
  await user.type(box, '/quiz paging{Enter}')
  expect(onAsk).not.toHaveBeenCalled()
  expect(useWorkspace.getState()).toMatchObject({ center: 'study', studyRequest: { kind: 'quiz', topic: 'paging' } })
})

it('with every source unticked, asking is blocked until a source is mentioned', async () => {
  const { onAsk, user, box } = setup({ selectedIds: [] })
  expect(box).toHaveAttribute('placeholder', 'Tick a source, or @mention one, to ask')
  await user.type(box, 'anything{Enter}')
  expect(onAsk).not.toHaveBeenCalled()
  await user.clear(box)
  await user.type(box, '@net{Enter}why{Enter}')
  expect(onAsk).toHaveBeenCalledWith('why', ['d1'])
})
