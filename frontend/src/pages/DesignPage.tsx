import { CheckCircle2, Quote, ShieldAlert, TriangleAlert, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { ThemeMenu } from '../components/ui/ThemeMenu'
import { Button, IconButton, Menu, Spinner, Wordmark, cx } from '../components/ui/primitives'
import { AA_LARGE_OR_UI, AA_TEXT, contrastRatio } from '../lib/contrast'
import { duration, spring, STAGGER } from '../lib/motion'
import { SOURCE_COLOR_COUNT, sourceColorStyle } from '../lib/sourceColors'
import { THEMES, useTheme } from '../lib/theme'

function readVars(names: readonly string[]): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(`--${n}`).trim()]))
}

/** Reads CSS custom properties from <html> and re-reads them whenever the theme changes. */
function useCssVars(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState(() => readVars(names))
  useEffect(() => {
    // The theme switch lands inside a view transition, after React state changes; watch the attribute.
    const observer = new MutationObserver(() => setValues(readVars(names)))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [names])
  return values
}

function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-line py-14">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-faint">{kicker}</p>
      <h2 id={id} className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      <div className="mt-8">{children}</div>
    </section>
  )
}

/** Pass/fail shown with an icon and words, never color alone. */
function ContrastBadge({ ratio, min }: { ratio: number | null; min: number }) {
  if (ratio === null) return <span className="font-mono text-xs text-faint">n/a</span>
  const pass = ratio >= min
  const Icon = pass ? CheckCircle2 : TriangleAlert
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 font-mono text-[11px]',
        pass ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
      )}
    >
      <Icon size={12} aria-hidden />
      {ratio.toFixed(1)}:1 {pass ? 'AA' : 'fails AA'}
    </span>
  )
}

const SURFACES = ['paper', 'surface', 'sunken'] as const
const TEXTS = [
  { name: 'ink', role: 'Body text, headings' },
  { name: 'muted', role: 'Secondary text' },
  { name: 'faint', role: 'Metadata, captions' },
  { name: 'accent', role: 'Links, focus, primary action' },
  { name: 'danger', role: 'Errors, destructive actions' },
] as const
const SOURCES = Array.from({ length: SOURCE_COLOR_COUNT }, (_, i) => i + 1)
const VAR_NAMES = [
  ...SURFACES,
  ...TEXTS.map((t) => t.name),
  'accent-ink',
  ...SOURCES.flatMap((n) => [`src-${n}`, `src-${n}-soft`, `src-${n}-ink`]),
]

function ColorSection() {
  const v = useCssVars(VAR_NAMES)
  return (
    <Section id="color" kicker="01 · Color" title="Ink, paper and one loud accent">
      <div className="grid gap-4 md:grid-cols-3">
        {SURFACES.map((bg) => (
          <div key={bg} className="overflow-hidden rounded-card border border-line" style={{ background: `var(--${bg})` }}>
            <div className="flex items-baseline justify-between px-4 pt-4">
              <span className="font-display text-lg font-semibold">--{bg}</span>
              <code className="font-mono text-xs text-faint">{v[bg]}</code>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {TEXTS.map((t) => (
                <li key={t.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span style={{ color: `var(--${t.name})` }} className="text-sm font-medium">
                    {t.name}
                    <span className="sr-only"> on {bg}</span>
                  </span>
                  <ContrastBadge ratio={contrastRatio(v[t.name], v[bg])} min={AA_TEXT} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-2xl text-sm text-muted">
        Ratios are measured live from the active theme. The same pairs are checked for every theme in CI
        (<code className="font-mono text-xs">src/styles/tokens.test.ts</code>), so a palette change that breaks WCAG AA
        fails the build.
      </p>
    </Section>
  )
}

function SourceSection() {
  const v = useCssVars(VAR_NAMES)
  return (
    <Section id="sources" kicker="02 · Source hues" title="Every source keeps its color">
      <p className="mb-6 max-w-2xl text-muted">
        A source's hue follows it everywhere: its card, its citation chips, its highlights in the viewer and its nodes
        in the mind map. Hues are derived from the document id, so they survive reloads and devices.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SOURCES.map((n) => (
          <div
            key={n}
            style={sourceColorStyle(n)}
            className="rounded-card border border-line bg-surface p-4 shadow-float"
          >
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-src" aria-hidden />
              <span className="font-mono text-xs text-faint">--src-{n}</span>
            </div>
            <p className="mt-3 text-sm">
              Lecture notes, week {n}{' '}
              <span className="inline-flex items-center rounded-chip bg-src-soft px-1.5 font-mono text-[11px] font-medium text-src-ink">
                p.{n * 3}
              </span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="h-full rounded-full bg-src" style={{ width: `${40 + n * 7}%` }} />
            </div>
            <div className="mt-3 flex gap-2">
              <ContrastBadge ratio={contrastRatio(v[`src-${n}-ink`], v[`src-${n}-soft`])} min={AA_TEXT} />
              <ContrastBadge ratio={contrastRatio(v[`src-${n}`], v.surface)} min={AA_LARGE_OR_UI} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function TypeSection() {
  return (
    <Section id="type" kicker="03 · Typography" title="Editorial display, quiet text">
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="font-mono text-xs text-faint">Fraunces Variable · display · weight animates on hover</p>
          <p className="type-flex mt-2 font-display text-6xl leading-[0.95] tracking-[-0.03em] sm:text-7xl lg:text-8xl">
            Ask your sources anything.
          </p>
          <p className="mt-8 font-mono text-xs text-faint">Fraunces · answer body</p>
          <div className="answer-md mt-2 max-w-xl">
            <p>
              Photosynthesis converts light energy into chemical energy stored in glucose{' '}
              <span className="inline-flex items-center rounded-chip bg-highlight px-1.5 font-mono text-[11px] font-medium text-highlight-ink">
                1
              </span>
              , releasing oxygen as a by-product of splitting water.
            </p>
          </div>
        </div>
        <dl className="space-y-6">
          {[
            { label: 'Inter Variable · interface', className: 'font-sans text-base', sample: 'Upload a PDF to get started' },
            { label: 'Inter · small', className: 'font-sans text-sm text-muted', sample: '3 sources · 142 pages · indexed' },
            { label: 'JetBrains Mono · metadata & scores', className: 'font-mono text-sm', sample: 'rerank 0.913 · 412 ms' },
            { label: 'Display numerals', className: 'font-display text-5xl font-semibold tabular-nums', sample: '87.4%' },
          ].map((row) => (
            <div key={row.label}>
              <dt className="font-mono text-xs text-faint">{row.label}</dt>
              <dd className={cx('mt-1', row.className)}>{row.sample}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  )
}

function DepthSection() {
  return (
    <Section id="depth" kicker="04 · Depth" title="Glass, grain, glow">
      <div className="mesh-bg overflow-hidden rounded-panel border border-line p-6 sm:p-10">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="glass rounded-card p-5">
            <p className="font-mono text-xs text-faint">.glass · shadow-float</p>
            <p className="mt-2 font-display text-xl font-semibold">Frosted panel</p>
            <p className="mt-1 text-sm text-muted">Layered blur over the gradient mesh, with an inner top highlight.</p>
          </div>
          <div className="border-gradient rounded-card p-5 shadow-lift">
            <p className="font-mono text-xs text-faint">.border-gradient · shadow-lift</p>
            <p className="mt-2 font-display text-xl font-semibold">Hairline gradient</p>
            <p className="mt-1 text-sm text-muted">A one-pixel gradient border that keeps the corner radius.</p>
          </div>
          <div className="rounded-card bg-surface p-5 shadow-glow">
            <p className="font-mono text-xs text-faint">shadow-glow</p>
            <p className="mt-2 font-display text-xl font-semibold">Accent glow</p>
            <p className="mt-1 text-sm text-muted">Reserved for the one thing on screen that matters most.</p>
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-4">
        {(['chip', 'control', 'card', 'panel'] as const).map((r) => (
          <div key={r} className="text-center">
            <div className="size-20 border border-line-strong bg-sunken" style={{ borderRadius: `var(--radius-${r})` }} />
            <p className="mt-2 font-mono text-xs text-faint">rounded-{r}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

function MotionSection() {
  const [run, setRun] = useState(0)
  const rows = [
    { name: 'snappy', note: 'chips, toggles', transition: spring.snappy },
    { name: 'gentle', note: 'cards, panels', transition: spring.gentle },
    { name: 'pop', note: 'hover cards', transition: spring.pop },
    { name: `tween ${duration.slow * 1000}ms`, note: 'fades, reduced motion', transition: { duration: duration.slow } },
  ]
  return (
    <Section id="motion" kicker="05 · Motion" title="Springs, not stopwatches">
      <div className="flex items-center gap-3">
        <Button variant="accent" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
        <p className="text-sm text-muted">Respects reduced motion and Calm mode: movement becomes an instant change.</p>
      </div>
      <div className="mt-6 space-y-3">
        {rows.map((row, i) => (
          <div key={row.name} className="flex items-center gap-4">
            <span className="w-36 shrink-0 font-mono text-xs text-faint">
              {row.name}
              <span className="block text-[10px]">{row.note}</span>
            </span>
            <div className="relative h-10 flex-1 rounded-control border border-line bg-sunken">
              <motion.div
                key={run}
                initial={{ left: '0%' }}
                animate={{ left: 'calc(100% - 2.5rem)' }}
                transition={{ ...row.transition, delay: i * STAGGER }}
                className="absolute top-0 size-10 rounded-control shadow-glow"
                style={{ background: `var(--src-${i + 1})` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function ComponentSection() {
  return (
    <Section id="components" kicker="06 · Components" title="The parts bin">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="font-mono text-xs text-faint">Button</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="accent">Ask sources</Button>
            <Button variant="primary">Create notebook</Button>
            <Button variant="secondary">
              <Upload size={15} aria-hidden /> Upload
            </Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="secondary" busy>
              Indexing
            </Button>
          </div>
          <p className="font-mono text-xs text-faint">IconButton · Spinner · Menu · ThemeMenu</p>
          <div className="flex items-center gap-2">
            <IconButton label="Quote">
              <Quote size={16} aria-hidden />
            </IconButton>
            <Spinner />
            <Menu
              trigger={(props) => (
                <Button variant="secondary" {...props}>
                  Actions
                </Button>
              )}
              items={[
                { label: 'Rename', onSelect: () => {} },
                { label: 'Delete', onSelect: () => {}, danger: true },
              ]}
            />
            <ThemeMenu />
          </div>
        </div>
        <div className="space-y-4">
          <p className="font-mono text-xs text-faint">Status</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-ok">
              <CheckCircle2 size={14} aria-hidden /> Ready
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-warn">
              <TriangleAlert size={14} aria-hidden /> Low support
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-danger">
              <ShieldAlert size={14} aria-hidden /> Quarantined
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-ink">
              ⚡ Cached
            </span>
          </div>
          <p className="font-mono text-xs text-faint">Text input</p>
          <input
            aria-label="Example input"
            placeholder="Ask about your sources…"
            className="h-11 w-full rounded-control border border-line-strong bg-surface px-3.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      </div>
    </Section>
  )
}

/** /design: the living style guide. Public, no data, renders every token and primitive. */
export default function DesignPage() {
  const theme = useTheme((s) => s.theme)
  const calm = useTheme((s) => s.calm)
  return (
    <div className="h-full overflow-y-auto">
      <header className="mesh-bg overflow-hidden border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
          <div className="flex items-center justify-between">
            <Link to="/" className="rounded" aria-label="Folio home">
              <Wordmark />
            </Link>
            <ThemeMenu />
          </div>
          <p className="mt-16 font-mono text-xs uppercase tracking-[0.18em] text-muted">Design system · v2</p>
          <h1 className="type-flex mt-3 max-w-4xl font-display text-6xl leading-[0.92] tracking-[-0.035em] sm:text-8xl">
            Neo-maximalist research cockpit.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Dense, layered and colorful, yet orchestrated. One set of tokens drives three themes; every pairing on this
            page is checked against WCAG AA.
          </p>
          <p className="mt-6 font-mono text-xs text-faint">
            theme: {theme} · calm: {calm ? 'on' : 'off'} · themes: {THEMES.filter((t) => t.value !== 'system').length}
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
        <ColorSection />
        <SourceSection />
        <TypeSection />
        <DepthSection />
        <MotionSection />
        <ComponentSection />
      </main>
    </div>
  )
}
