import { Check } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

import type { ChatStage, RetrievalEvent } from '../../api/types'
import { spring, STAGGER } from '../../lib/motion'
import { sourceColorStyle } from '../../lib/sourceColors'
import { cx } from '../ui/primitives'

type StepId = 'plan' | 'search' | 'rerank' | 'read' | 'generate' | 'verify'

const ORDER: StepId[] = ['plan', 'search', 'rerank', 'read', 'generate', 'verify']

function activeStep(stage: ChatStage | null, retrieval: RetrievalEvent | null): number {
  if (stage === 'verify') return 5
  if (stage === 'generate') return 4
  if (retrieval) return 3 // retrieval is done; the model is about to read the passages
  return { plan: 0, search: 1, rerank: 2 }[stage ?? 'plan'] ?? 0
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

/** Milliseconds since `key` last changed, updated ten times a second (0 right after a change). */
function useElapsed(key: unknown): number {
  const [elapsed, setElapsed] = useState<{ key: unknown; ms: number }>({ key, ms: 0 })
  useEffect(() => {
    const start = performance.now()
    const t = window.setInterval(() => setElapsed({ key, ms: performance.now() - start }), 100)
    return () => window.clearInterval(t)
  }, [key])
  return elapsed.key === key ? elapsed.ms : 0
}

function StepDot({ status }: { status: 'done' | 'active' | 'pending' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
        status === 'done' && 'border-transparent bg-ink text-paper',
        status === 'active' && 'border-accent bg-accent-soft',
        status === 'pending' && 'border-line-strong',
      )}
    >
      {status === 'done' && <Check size={12} strokeWidth={3} />}
      {status === 'active' && (
        <>
          <span className="size-1.5 rounded-full bg-accent" />
          <span className="absolute inset-0 animate-ping rounded-full border border-accent opacity-60" />
        </>
      )}
    </span>
  )
}

/**
 * Live view of the answer pipeline: Rewrite → Search → Rerank → Read → Write → Check,
 * with the real duration of each finished stage and the passages the model reads
 * dropping into a "context tray" in their source colors.
 */
export default function PipelineTheater({
  stage,
  timings,
  retrieval,
  colors,
  writing,
}: {
  stage: ChatStage | null
  /** Durations of finished stages from the server (plan, embed, search, rerank, generate). */
  timings: Record<string, number>
  retrieval: RetrievalEvent | null
  colors: Map<string, number>
  /** The first answer text has arrived. */
  writing: boolean
}) {
  const active = activeStep(stage, retrieval)
  const elapsed = useElapsed(active)
  const steps: Record<StepId, { label: string; detail?: string; ms?: number }> = {
    plan: {
      label: retrieval?.rewritten ? 'Rewrote the question' : 'Planning queries',
      detail: retrieval
        ? retrieval.queries.length > 1
          ? `${retrieval.queries.length} queries: “${retrieval.queries[0]}” + ${retrieval.queries.length - 1} more`
          : `“${retrieval.queries[0]}”`
        : undefined,
      ms: timings.plan,
    },
    search: {
      label: 'Searching',
      detail: retrieval ? `vector + keyword · ${retrieval.candidates} candidate passages` : 'vector + keyword',
      ms: timings.search !== undefined ? (timings.embed ?? 0) + timings.search : undefined,
    },
    rerank: {
      label: retrieval && !retrieval.reranked ? 'Ranking (fused scores)' : 'Reranking',
      detail: retrieval ? `best ${retrieval.passages.length} of ${retrieval.candidates}` : 'cross-encoder',
      ms: timings.rerank,
    },
    read: {
      label: retrieval?.abstain ? 'Confidence gate' : 'Reading',
      detail: retrieval?.abstain ? 'no passage answers this closely' : retrieval ? `${retrieval.passages.length} passages` : undefined,
    },
    generate: { label: writing ? 'Writing' : 'Thinking', ms: timings.generate },
    verify: { label: 'Checking citations' },
  }
  const visible = ORDER.filter((id) => id !== 'verify' || stage === 'verify')

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface/70 p-3 text-sm" role="status" aria-live="polite">
      <ol className="space-y-1.5">
        {visible.map((id, i) => {
          const step = steps[id]
          const index = ORDER.indexOf(id)
          const status = index < active ? 'done' : index === active ? 'active' : 'pending'
          const ms = status === 'active' ? elapsed : step.ms
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: status === 'pending' ? 0.45 : 1, x: 0 }}
              transition={{ ...spring.gentle, delay: i * STAGGER }}
              className="flex items-center gap-2.5"
            >
              <StepDot status={status} />
              <span className={cx('font-medium', status === 'active' ? 'text-ink' : status === 'done' ? 'text-ink' : 'text-muted')}>
                {step.label}
              </span>
              {step.detail && status !== 'pending' && (
                <span className="min-w-0 truncate text-muted" title={step.detail}>
                  {step.detail}
                </span>
              )}
              {ms !== undefined && status !== 'pending' && (
                <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-faint">{fmt(ms)}</span>
              )}
            </motion.li>
          )
        })}
      </ol>
      <AnimatePresence>
        {retrieval && retrieval.passages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="overflow-hidden"
          >
            <p className="mb-1.5 mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              {retrieval.abstain ? 'Closest passages' : 'Context tray'}
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Passages given to the model">
              {retrieval.passages.map((p, i) => (
                <motion.li
                  key={p.marker}
                  initial={{ opacity: 0, y: -14, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...spring.pop, delay: i * STAGGER * 2 }}
                  style={sourceColorStyle(colors.get(p.document_id) ?? 1)}
                  className="flex max-w-56 items-center gap-1.5 rounded-md border border-[var(--src)] bg-[var(--src-soft)] px-2 py-1 text-xs text-[var(--src-ink)]"
                  title={`${p.filename}, page ${p.page_number}${p.section_title ? ` · ${p.section_title}` : ''}`}
                >
                  <span className="font-mono font-semibold">{p.marker}</span>
                  <span className="truncate">
                    {p.filename.replace(/\.pdf$/i, '')} · p.{p.page_number}
                  </span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
