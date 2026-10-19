import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import type { Message, RetrievalEvent, RetrievalTrace, Source } from '../../api/types'
import CitationsPanel from './CitationsPanel'
import { CitationChip } from './CitationChip'
import PipelineTheater from './PipelineTheater'
import RetrievalInspector from './RetrievalInspector'

afterEach(() => vi.unstubAllGlobals())

const SOURCE: Source = {
  marker: 'C1',
  chunk_id: 'c1',
  document_id: 'd1',
  filename: 'networks.pdf',
  page_number: 2,
  section_title: 'Slow Start',
  snippet: 'During slow start the sender grows the congestion window every round trip.',
  score: 0.91,
  support: 'low',
  support_score: 0.004,
}

const RETRIEVAL: RetrievalEvent = {
  question: 'why so fast',
  queries: ['Why does slow start grow quickly?', 'slow start growth rate'],
  rewritten: true,
  candidates: 30,
  reranked: true,
  confidence: 'high',
  abstain: false,
  passages: [
    { marker: 'C1', document_id: 'd1', filename: 'networks.pdf', page_number: 2, section_title: 'Slow Start', score: 0.91 },
    { marker: 'C2', document_id: 'd2', filename: 'memory.pdf', page_number: 4, section_title: null, score: 0.4 },
  ],
  timings_ms: { plan: 1200, embed: 40, search: 25, rerank: 900 },
}

it('the pipeline theater shows finished stages with real timings and the context tray', () => {
  render(<PipelineTheater stage="generate" timings={{ ...RETRIEVAL.timings_ms }} retrieval={RETRIEVAL} colors={new Map()} writing />)
  expect(screen.getByText('Rewrote the question')).toBeInTheDocument()
  expect(screen.getByText(/2 queries: “Why does slow start grow quickly\?” \+ 1 more/)).toBeInTheDocument()
  expect(screen.getByText('vector + keyword · 30 candidate passages')).toBeInTheDocument()
  expect(screen.getByText('1.2 s')).toBeInTheDocument() // plan
  expect(screen.getByText('65 ms')).toBeInTheDocument() // embed + search
  expect(screen.getByText('Writing')).toBeInTheDocument()
  const tray = screen.getByRole('list', { name: 'Passages given to the model' })
  expect(within(tray).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['C1networks · p.2', 'C2memory · p.4'])
})

it('before retrieval finishes, later steps are pending and unlabelled', () => {
  render(<PipelineTheater stage="search" timings={{ plan: 300 }} retrieval={null} colors={new Map()} writing={false} />)
  expect(screen.getByText('Planning queries')).toBeInTheDocument()
  expect(screen.getByText('300 ms')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Passages given to the model' })).not.toBeInTheDocument()
})

it('a citation chip announces low support and shows a hover card with highlighted question words', async () => {
  const onOpen = vi.fn()
  const user = userEvent.setup()
  render(<CitationChip citation={{ n: 3, source: SOURCE }} onOpen={onOpen} terms={['congestion']} />)
  const chip = screen.getByRole('button', { name: 'Source 3: networks.pdf, page 2 (low support)' })
  await user.tab()
  expect(chip).toHaveFocus()
  expect(await screen.findByText('Slow Start')).toBeInTheDocument()
  expect(screen.getByText('congestion', { selector: 'mark' })).toBeInTheDocument()
  expect(screen.getByText('0.91')).toBeInTheDocument()
  expect(screen.getByText('Low support.')).toBeInTheDocument()
  await user.click(chip)
  expect(onOpen).toHaveBeenCalledWith(SOURCE, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
})

const TRACE: RetrievalTrace = {
  message_id: 'm1',
  question: 'why so fast',
  standalone_query: 'Why does slow start grow quickly?',
  variants: ['slow start growth rate'],
  hypothetical: null,
  planner: { llm_called: true, cached: false, error: null },
  document_ids: null,
  features: { hybrid_search: true, reranker: true, hyde: false },
  candidates: Array.from({ length: 12 }, (_, i) => ({
    chunk_id: `c${i}`,
    document_id: 'd1',
    filename: 'networks.pdf',
    page_number: i + 1,
    section_title: i === 0 ? 'Slow Start' : null,
    snippet: `passage ${i}`,
    vector_rank: i + 1,
    keyword_rank: null,
    vector_similarity: 0.7,
    fused_score: 0.03,
    rerank_score: i < 2 ? 0.9 : 0.01,
    selected: i < 6,
    marker: i < 6 ? `C${i + 1}` : null,
    support: i === 1 ? 'low' : null,
  })),
  reranked: true,
  confidence: 'high',
  top_score: 0.9,
  abstained: false,
  timings_ms: { plan: 1200, embed: 40, search: 25, rerank: 900, generate: 2400 },
  total_ms: 4600,
  tokens: { planner: { prompt_tokens: 100, completion_tokens: 50 }, answer: { prompt_tokens: 1500, completion_tokens: 250 } },
}

it('the inspector shows confidence, a stage waterfall, queries and ranked passages', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(TRACE), { status: 200 })))
  const onOpen = vi.fn()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RetrievalInspector messageId="m1" onOpen={onOpen} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('High retrieval match')).toBeInTheDocument()
  const pipeline = screen.getByRole('region', { name: 'Pipeline' })
  expect(within(pipeline).getByText('2.4 s')).toBeInTheDocument()
  expect(within(pipeline).getByText('4.6 s')).toBeInTheDocument()
  expect(screen.getByText('“Why does slow start grow quickly?”')).toBeInTheDocument()
  expect(screen.getByText(/12 candidates ranked by cross-encoder relevance; the top 6/)).toBeInTheDocument()
  expect(screen.getByLabelText('Low support')).toBeInTheDocument()
  expect(screen.getByText('1,900')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show all 12' }))
  await user.click(screen.getByRole('button', { name: 'Open networks.pdf, page 1 (cited as C1)' }))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ chunk_id: 'c0', score: 0.9 }))
})

it('the citations panel groups an answer’s citations by source', () => {
  const message: Message = {
    id: 'm1',
    role: 'assistant',
    content: 'Grows fast [[C1]]. Pages are 4 KiB [[C2]]. Again [[C1]].',
    sources: [SOURCE, { ...SOURCE, marker: 'C2', chunk_id: 'c2', document_id: 'd2', filename: 'memory.pdf', page_number: 1, support: 'ok' }],
    confidence: 'high',
    created_at: '2026-10-11T00:00:00Z',
  }
  render(<CitationsPanel message={message} onOpen={() => {}} />)
  expect(screen.getByText(/2 citations from 2 sources; 1 flagged for low support/)).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
    expect.stringContaining('networks.pdf'),
    expect.stringContaining('memory.pdf'),
  ])
})
