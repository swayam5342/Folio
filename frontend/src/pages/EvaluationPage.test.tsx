import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import type { EvalConfig, EvalResults } from '../api/types'
import EvaluationPage from './EvaluationPage'

const config = (name: string, label: string, hit1: number, hit3: number, extra: Partial<EvalConfig> = {}): EvalConfig => ({
  name,
  label,
  strategy: 'fixed',
  flags: {},
  retrieval: {
    'hit@1': hit1,
    'hit@3': hit3,
    'hit@6': 1,
    mrr: hit1,
    abstain_unanswerable: name === 'full' ? 0.57 : 0,
    false_abstain: 0,
    by_type: { factual: { n: 10, 'hit@3': hit3, mrr: hit1 }, keyword: { n: 8, 'hit@3': hit3, mrr: hit1 } },
    confidence: { high: 1, medium: 1, low: 1 },
  },
  latency_ms: { embed: 15, search: 20, retrieval_median: 40 },
  planner_errors: 0,
  ...extra,
})

const RESULTS: EvalResults = {
  generated_at: '2026-10-11T12:00:00+00:00',
  commit: 'abc1234',
  mode: 'full',
  duration_s: 1800,
  llm_tokens: 123456,
  dataset: { questions: 50, answerable: 43, unanswerable: 7, documents: ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'], types: {} },
  settings: { JUDGE_MODEL: 'openai/gpt-oss-20b' },
  configs: [
    config('baseline', 'Vector search only (v1 baseline)', 0.6, 0.8),
    config('full', '+ structure-aware chunks', 0.75, 0.9, {
      answers: { n: 50, failed: 0, citation_precision: 0.91, cited_answers: 0.95, faithfulness: 0.88, key_fact_recall: 0.8, unanswerable_handled: 1 },
    }),
  ],
}

afterEach(() => vi.unstubAllGlobals())

function renderPage(response: Response) {
  // The header asks who is signed in; answer "nobody" so only the results request returns `response`.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.endsWith('/eval/results') ? response : new Response('{}', { status: 401 }))),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EvaluationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('shows headline deltas, the configuration table and answer quality', async () => {
  renderPage(new Response(JSON.stringify(RESULTS), { status: 200 }))

  expect(await screen.findByText('▲ +15 points')).toBeInTheDocument() // Hit@1 60% → 75%
  const table = screen.getByRole('table', { name: /retrieval quality by configuration/i })
  const rows = within(table).getAllByRole('row')
  expect(rows).toHaveLength(3)
  expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('+ structure-aware chunks')
  expect(within(rows[2]).getByText('57%')).toBeInTheDocument() // unanswerable refused
  expect(screen.getByText('Citation precision').nextSibling).toHaveTextContent('91%')
  expect(screen.getByText('openai/gpt-oss-20b')).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: /Exact term/ })).toBeInTheDocument()
})

it('explains how to produce results when none exist', async () => {
  renderPage(new Response(JSON.stringify({ detail: 'No evaluation results yet.' }), { status: 404 }))
  expect(await screen.findByText('No evaluation has been run yet.')).toBeInTheDocument()
})
