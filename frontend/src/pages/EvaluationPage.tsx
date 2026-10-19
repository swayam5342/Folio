import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { ApiError } from '../api/client'
import { useEvalResults } from '../api/queries'
import type { EvalConfig, EvalResults } from '../api/types'
import AppHeader from '../components/AppHeader'
import { Spinner, cx } from '../components/ui/primitives'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const dec = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2))
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString()} ms`)

const TYPE_LABELS: Record<string, string> = {
  factual: 'Factual',
  keyword: 'Exact term',
  paraphrase: 'Paraphrased',
  follow_up: 'Follow-up',
}

const STAGES: [string, string][] = [
  ['plan', 'Plan (LLM)'],
  ['embed', 'Embed'],
  ['search', 'Search'],
  ['rerank', 'Rerank'],
]

/** A value with a thin bar behind it, so a column reads as a chart and still as numbers. */
function BarCell({ value, format, best }: { value: number | null; format: (v: number | null) => string; best?: boolean }) {
  return (
    <td className="px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max((value ?? 0) * 100, 1)}%` }} />
        </span>
        <span className={cx('tabular-nums', best && 'font-semibold')}>{format(value)}</span>
      </div>
    </td>
  )
}

function Headline({ label, from, to, format }: { label: string; from: number | null; to: number | null; format: (v: number | null) => string }) {
  const delta = from !== null && to !== null ? to - from : null
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight">
        {format(from)} <span className="text-faint">→</span> {format(to)}
      </p>
      {delta !== null && (
        <p className={cx('mt-1 text-sm tabular-nums', delta > 0 ? 'text-ok' : delta < 0 ? 'text-danger' : 'text-muted')}>
          {delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}
          {format === pct ? `${Math.round(delta * 100)} points` : delta.toFixed(2)}
        </p>
      )}
    </div>
  )
}

function RetrievalTable({ configs }: { configs: EvalConfig[] }) {
  const best = (key: 'hit@1' | 'hit@3' | 'mrr') => Math.max(...configs.map((c) => c.retrieval[key] ?? 0))
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <caption className="sr-only">Retrieval quality by configuration; each row adds one stage to the row above.</caption>
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Configuration</th>
            <th scope="col" className="px-3 py-2.5 font-medium" title="A gold page is the top passage">Hit@1</th>
            <th scope="col" className="px-3 py-2.5 font-medium" title="A gold page is in the top three">Hit@3</th>
            <th scope="col" className="px-3 py-2.5 font-medium" title="Mean reciprocal rank of the first gold passage">MRR</th>
            <th scope="col" className="px-3 py-2.5 font-medium" title="Unanswerable questions the confidence gate refused">Refused unanswerable</th>
            <th scope="col" className="px-3 py-2.5 font-medium" title="Answerable questions wrongly refused">Refused answerable</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Retrieval time</th>
          </tr>
        </thead>
        <tbody>
          {configs.map((c, i) => (
            <tr key={c.name} className="border-b border-line/60 last:border-0">
              <th scope="row" className="px-3 py-2.5 font-medium">
                <span className="mr-2 font-mono text-xs text-faint">{i + 1}</span>
                {c.label}
              </th>
              <BarCell value={c.retrieval['hit@1']} format={pct} best={c.retrieval['hit@1'] === best('hit@1')} />
              <BarCell value={c.retrieval['hit@3']} format={pct} best={c.retrieval['hit@3'] === best('hit@3')} />
              <BarCell value={c.retrieval.mrr} format={dec} best={c.retrieval.mrr === best('mrr')} />
              <td className="px-3 py-2.5 tabular-nums">{pct(c.retrieval.abstain_unanswerable)}</td>
              <td className="px-3 py-2.5 tabular-nums">{pct(c.retrieval.false_abstain)}</td>
              <td className="px-3 py-2.5 tabular-nums text-muted">{ms(c.latency_ms.retrieval_median)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ByTypeTable({ results }: { results: EvalResults }) {
  const types = Object.keys(TYPE_LABELS).filter((t) => results.configs[0]?.retrieval.by_type[t])
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[620px] border-collapse text-left text-sm">
        <caption className="sr-only">Hit@3 by question type and configuration.</caption>
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Configuration</th>
            {types.map((t) => (
              <th key={t} scope="col" className="px-3 py-2.5 font-medium">
                {TYPE_LABELS[t]} <span className="text-faint">(n={results.configs[0].retrieval.by_type[t].n})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.configs.map((c) => (
            <tr key={c.name} className="border-b border-line/60 last:border-0">
              <th scope="row" className="px-3 py-2.5 font-medium">{c.label}</th>
              {types.map((t) => (
                <BarCell key={t} value={c.retrieval.by_type[t]?.['hit@3'] ?? null} format={pct} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AnswerCards({ config, judge }: { config: EvalConfig; judge: string | number | null }) {
  const a = config.answers!
  const cards: [string, number | null, string][] = [
    ['Citation precision', a.citation_precision, 'Cited pages that are gold pages'],
    ['Faithfulness', a.faithfulness, 'Claims supported by the excerpts the model was given'],
    ['Key-fact recall', a.key_fact_recall, 'Expected facts the answer states'],
    ['Unanswerable handled', a.unanswerable_handled, 'Refused by the gate or declined by the model'],
  ]
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{pct(value)}</p>
            <p className="mt-1 text-xs text-faint">{hint}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        {config.label}: {a.n} questions answered by the full chat pipeline and graded by <code className="font-mono text-xs">{judge}</code>
        {a.failed > 0 && `; ${a.failed} skipped after rate-limit retries`}.
      </p>
    </>
  )
}

function LatencyTable({ configs }: { configs: EvalConfig[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <caption className="sr-only">Mean time per pipeline stage, in milliseconds.</caption>
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Configuration</th>
            {STAGES.map(([key, label]) => (
              <th key={key} scope="col" className="px-3 py-2.5 text-right font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {configs.map((c) => (
            <tr key={c.name} className="border-b border-line/60 last:border-0">
              <th scope="row" className="px-3 py-2.5 font-medium">{c.label}</th>
              {STAGES.map(([key]) => (
                <td key={key} className="px-3 py-2.5 text-right tabular-nums text-muted">{ms(c.latency_ms[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      {note && <p className="mt-1 max-w-2xl text-sm text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Results({ results }: { results: EvalResults }) {
  const { configs, dataset } = results
  const first = configs[0]
  const last = configs.at(-1)!
  const answered = configs.find((c) => c.answers)
  return (
    <>
      <p className="mt-3 max-w-2xl text-muted">
        {dataset.questions} questions over {dataset.documents.length} sample PDFs ({dataset.answerable} answerable,{' '}
        {dataset.unanswerable} deliberately unanswerable), run through the real retrieval pipeline with one stage added at a time.
        Generated {new Date(results.generated_at).toLocaleString()}
        {results.commit && <> at commit <code className="font-mono text-xs">{results.commit}</code></>}.
      </p>
      {results.mode === 'smoke' && (
        <p className="mt-3 inline-block rounded-md bg-warn-soft px-3 py-1.5 text-sm text-warn">
          Smoke run: no LLM stages and only a subset of questions. Run the full evaluation for real numbers.
        </p>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Headline label="Hit@1: right page ranked first" from={first.retrieval['hit@1']} to={last.retrieval['hit@1']} format={pct} />
        <Headline label="Hit@3: right page in the top three" from={first.retrieval['hit@3']} to={last.retrieval['hit@3']} format={pct} />
        <Headline label="Unanswerable questions refused" from={first.retrieval.abstain_unanswerable} to={last.retrieval.abstain_unanswerable} format={pct} />
      </div>
      <p className="mt-2 text-xs text-faint">
        {first.label} → {last.label}
      </p>

      <Section title="Retrieval" note="Each row adds one stage to the row above. Answerable questions only for Hit@k and MRR; the best value in each column is bold.">
        <RetrievalTable configs={configs} />
      </Section>

      <Section title="By question type" note="Hit@3 for each kind of question: exact terms favour keyword search, paraphrases favour multi-query and reranking, follow-ups need the rewrite.">
        <ByTypeTable results={results} />
      </Section>

      {answered && (
        <Section title="Answer quality" note="Answers generated with the full chat prompt, then graded by a second model against the excerpts each answer was given.">
          <AnswerCards config={answered} judge={results.settings.JUDGE_MODEL} />
        </Section>
      )}

      <Section title="Latency" note="Mean per stage. Planning is a Groq call (measured on uncached calls); embedding, search and reranking run locally on CPU.">
        <LatencyTable configs={configs} />
      </Section>

      <Section title="Method">
        <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Gold labels are pages: a passage counts as a hit if it comes from a page that answers the question, so fixed and structured chunks compare fairly.</li>
          <li>The corpus is small and purpose-written (a networking lecture, an OS chapter, a synthetic study and a fictional policy), so one question moves a percentage by two or three points.</li>
          <li>
            Reproduce with <code className="font-mono text-xs">python -m eval.run_eval --answers final</code> from{' '}
            <code className="font-mono text-xs">backend/</code>; it took {Math.round(results.duration_s / 60)} minutes and{' '}
            {results.llm_tokens.toLocaleString()} LLM tokens.
          </li>
        </ul>
      </Section>
    </>
  )
}

export default function EvaluationPage() {
  const results = useEvalResults()
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-faint">Evaluation</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">What each retrieval stage adds</h1>
        {results.isPending ? (
          <div className="mt-8 text-muted">
            <Spinner />
          </div>
        ) : results.isError ? (
          <div className="mt-6 max-w-xl rounded-lg border border-line bg-surface p-5">
            <p className="font-medium">
              {results.error instanceof ApiError && results.error.status === 404 ? 'No evaluation has been run yet.' : results.error.message}
            </p>
            <p className="mt-1 text-sm text-muted">
              From <code className="font-mono text-xs">backend/</code>, run <code className="font-mono text-xs">python -m eval.run_eval</code>, then reload this page.
            </p>
            <Link to="/" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">Back to notebooks</Link>
          </div>
        ) : (
          <Results results={results.data} />
        )}
      </main>
    </div>
  )
}
