import { TriangleAlert, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'

import { useTrace } from '../../api/queries'
import type { Confidence, RetrievalTrace as Trace, Source, TraceCandidate } from '../../api/types'
import { spring } from '../../lib/motion'
import { sourceColorStyle } from '../../lib/sourceColors'
import { useSourceColor } from '../../lib/useSourceColors'
import { Spinner, cx } from '../ui/primitives'
import type { OpenSource } from './CitationChip'
import { isPaged, sourceLabel, sourceLocation } from '../../lib/sourceLocation'

const CONFIDENCE: Record<Confidence, { label: string; className: string; hint: string; fill: number }> = {
  high: { label: 'High retrieval match', className: 'bg-ok-soft text-ok', hint: 'The best passage clearly matches the question.', fill: 1 },
  medium: {
    label: 'Medium retrieval match',
    className: 'bg-warn-soft text-warn',
    hint: 'The passages are related but may not answer every part of the question. Check the cited pages.',
    fill: 0.6,
  },
  low: { label: 'Low retrieval match', className: 'bg-danger-soft text-danger', hint: 'No passage closely matches the question.', fill: 0.25 },
}

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const c = CONFIDENCE[level]
  return (
    <span title={c.hint} className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', c.className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  )
}

function ConfidenceMeter({ trace }: { trace: Trace }) {
  if (!trace.confidence) return null
  const c = CONFIDENCE[trace.confidence]
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <ConfidenceBadge level={trace.confidence} />
        {trace.top_score !== null && (
          <span className="font-mono text-xs text-muted">
            best {trace.reranked ? 'relevance' : 'similarity'} <span className="text-ink">{trace.top_score.toFixed(3)}</span>
          </span>
        )}
      </div>
      <div className={cx('mt-2 h-2 overflow-hidden rounded-full bg-sunken', c.className)} aria-hidden>
        <motion.div
          className="h-full rounded-full bg-current"
          initial={{ width: 0 }}
          animate={{ width: `${c.fill * 100}%` }}
          transition={spring.gentle}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {c.hint}
        {trace.abstained && ' The answer abstained instead of guessing.'}
      </p>
      {trace.citation_coverage !== null && trace.citation_coverage !== undefined && (
        <p className="mt-2 text-xs text-muted">
          Valid citation coverage{' '}
          <span className={cx('font-mono font-semibold', trace.citation_coverage >= 0.8 ? 'text-ok' : 'text-warn')}>
            {Math.round(trace.citation_coverage * 100)}%
          </span>{' '}
          of substantive claims.
        </p>
      )}
    </div>
  )
}

const STAGES: { key: string; label: string; remote: boolean }[] = [
  { key: 'plan', label: 'Plan', remote: true },
  { key: 'embed', label: 'Embed', remote: false },
  { key: 'search', label: 'Search', remote: false },
  { key: 'rerank', label: 'Rerank', remote: false },
  { key: 'generate', label: 'Answer', remote: true },
  { key: 'verify', label: 'Verify', remote: false },
]

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

/** Stages as a waterfall: each bar starts where the previous one ended. */
function Waterfall({ timings, total }: { timings: Record<string, number>; total: number }) {
  const rows = STAGES.filter((s) => (timings[s.key] ?? 0) > 0)
  const span = Math.max(total, rows.reduce((sum, s) => sum + timings[s.key], 0)) || 1
  // Each stage starts where the ones before it ended.
  const starts = rows.map((_, i) => rows.slice(0, i).reduce((sum, s) => sum + timings[s.key], 0))
  return (
    <div>
      <ul className="space-y-1.5">
        {rows.map((s, i) => {
          const ms = timings[s.key]
          const left = (starts[i] / span) * 100
          return (
            <li key={s.key} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 text-xs">
              <span className="text-muted">{s.label}</span>
              <span className="relative h-3 rounded-sm bg-sunken/60" title={`${s.label}: ${fmtMs(ms)} (${s.remote ? 'Groq' : 'local CPU'})`}>
                <motion.span
                  className={cx('absolute inset-y-0 rounded-sm', s.remote ? 'bg-accent' : 'bg-ink/70')}
                  style={{ left: `${left}%` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max((ms / span) * 100, 0.8)}%` }}
                  transition={{ ...spring.gentle, delay: i * 0.05 }}
                />
              </span>
              <span className="text-right font-mono tabular-nums text-ink">{fmtMs(ms)}</span>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-accent" /> Groq (LLM)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-ink/70" /> Local CPU
        </span>
        <span className="ml-auto">
          Total <span className="font-mono text-ink">{fmtMs(total)}</span>
        </span>
      </div>
    </div>
  )
}

function Queries({ trace }: { trace: Trace }) {
  const rewritten = trace.standalone_query !== trace.question
  return (
    <dl className="space-y-2 text-sm">
      <div>
        <dt className="text-xs text-muted">Question</dt>
        <dd className="mt-0.5">“{trace.question}”</dd>
      </div>
      {rewritten && (
        <div>
          <dt className="text-xs text-muted">Rewritten as a standalone question</dt>
          <dd className="mt-0.5">“{trace.standalone_query}”</dd>
        </div>
      )}
      {trace.variants.length > 0 && (
        <div>
          <dt className="text-xs text-muted">Also searched for</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {trace.variants.map((v) => (
              <span key={v} className="rounded-md border border-line bg-sunken px-2 py-0.5">
                {v}
              </span>
            ))}
          </dd>
        </div>
      )}
      {trace.hypothetical && (
        <div>
          <dt className="text-xs text-muted">Hypothetical answer searched (HyDE)</dt>
          <dd className="mt-0.5 italic text-muted">{trace.hypothetical}</dd>
        </div>
      )}
      {trace.planner.error && (
        <div className="text-xs text-warn">Query rewriting was skipped ({trace.planner.error}); the question was searched as asked.</div>
      )}
    </dl>
  )
}

const asSource = (c: TraceCandidate): Source => ({
  marker: c.marker,
  chunk_id: c.chunk_id,
  document_id: c.document_id,
  filename: c.filename,
  document_kind: c.document_kind,
  page_number: c.page_number,
  section_title: c.section_title,
  char_start: c.char_start,
  char_end: c.char_end,
  snippet: c.snippet,
  score: c.rerank_score ?? c.vector_similarity,
  support: c.support,
})

function CandidateRow({ c, rank, reranked, onOpen }: { c: TraceCandidate; rank: number; reranked: boolean; onOpen: OpenSource }) {
  const color = useSourceColor(c.document_id)
  const value = reranked ? (c.rerank_score ?? 0) : (c.vector_similarity ?? 0)
  return (
    <li style={sourceColorStyle(color)}>
      <button
        type="button"
        onClick={() => onOpen(asSource(c))}
        aria-label={`Open ${sourceLabel(c)}${c.marker ? ` (cited as ${c.marker})` : ''}`}
        title={c.snippet}
        className={cx(
          'grid w-full grid-cols-[1.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-sunken',
          !c.selected && 'opacity-60',
        )}
      >
        <span className="font-mono tabular-nums text-faint">{rank}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--src)]" />
            <span className="truncate font-medium">
              {c.filename}
              {isPaged(c) && `, ${sourceLocation(c)}`}
            </span>
            {c.marker && <span className="shrink-0 rounded-sm bg-ink px-1 font-mono text-[10px] text-paper">{c.marker}</span>}
            {c.support === 'low' && <TriangleAlert aria-label="Low support" size={12} className="shrink-0 text-warn" />}
          </span>
          <span className="mt-0.5 block truncate text-muted">
            {c.section_title ?? 'No section'} · vector {c.vector_rank ?? '—'} · keyword {c.keyword_rank ?? '—'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <span className="block h-full rounded-full bg-[var(--src)]" style={{ width: `${Math.max(value * 100, 2)}%` }} />
          </span>
          <span className="w-8 text-right font-mono tabular-nums">{value.toFixed(2)}</span>
        </span>
      </button>
    </li>
  )
}

function Candidates({ trace, onOpen }: { trace: Trace; onOpen: OpenSource }) {
  const [all, setAll] = useState(false)
  const rows = all ? trace.candidates : trace.candidates.slice(0, 10)
  const selected = trace.candidates.filter((c) => c.selected).length
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">
        {trace.candidates.length} candidates ranked by {trace.reranked ? 'cross-encoder relevance' : 'fused score (similarity shown)'};
        the top {selected} were given to the model.
      </p>
      <ol className="space-y-0.5">
        {rows.map((c, i) => (
          <CandidateRow key={c.chunk_id} c={c} rank={i + 1} reranked={trace.reranked} onOpen={onOpen} />
        ))}
      </ol>
      {trace.candidates.length > 10 && (
        <button type="button" className="mt-1.5 text-xs font-medium underline underline-offset-2" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${trace.candidates.length}`}
        </button>
      )}
    </div>
  )
}

function tokenTotal(trace: Trace): number | null {
  const parts = [trace.tokens.planner, trace.tokens.answer].filter(Boolean)
  if (!parts.length) return null
  return parts.reduce((acc, u) => acc + (u!.prompt_tokens ?? 0) + (u!.completion_tokens ?? 0), 0)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{title}</h3>
      {children}
    </section>
  )
}

/** Everything recorded about how one answer was retrieved. */
export function TraceView({ trace, onOpen }: { trace: Trace; onOpen: OpenSource }) {
  const tokens = tokenTotal(trace)
  const off = Object.entries(trace.features).filter(([, on]) => !on).map(([name]) => name.replace(/_/g, ' '))
  return (
    <div className="space-y-6">
      {trace.cached && (
        <div className="flex items-start gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-xs text-accent">
          <Zap aria-hidden size={13} className="mt-px shrink-0" />
          Answered instantly from the cache: this question was asked before over the same sources. The scores and
          timings below are from the original answer.
        </div>
      )}
      <Section title="Confidence">
        <ConfidenceMeter trace={trace} />
      </Section>
      <Section title="Pipeline">
        <Waterfall timings={trace.timings_ms} total={trace.total_ms} />
      </Section>
      <Section title="Queries">
        <Queries trace={trace} />
      </Section>
      <Section title="Passages">
        <Candidates trace={trace} onOpen={onOpen} />
      </Section>
      <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
        {tokens !== null && (
          <span>
            Tokens <span className="font-mono text-ink">{tokens.toLocaleString()}</span>
          </span>
        )}
        {trace.document_ids && (
          <span>
            Limited to {trace.document_ids.length} source{trace.document_ids.length === 1 ? '' : 's'}
          </span>
        )}
        {off.length > 0 && <span>Off: {off.join(', ')}</span>}
      </p>
    </div>
  )
}

/** The Inspector tab: loads and shows one answer's retrieval trace. */
export default function RetrievalInspector({ messageId, onOpen }: { messageId: string | null; onOpen: OpenSource }) {
  const trace = useTrace(messageId ?? '', !!messageId)
  if (!messageId) {
    return <p className="p-5 text-sm text-muted">Ask a question: this tab then shows how the answer was found, stage by stage.</p>
  }
  if (trace.isPending) {
    return (
      <div className="p-5 text-muted">
        <Spinner />
      </div>
    )
  }
  if (trace.isError) return <p className="p-5 text-sm text-muted">{trace.error.message}</p>
  return (
    <div className="p-4 sm:p-5">
      <TraceView trace={trace.data} onOpen={onOpen} />
    </div>
  )
}
