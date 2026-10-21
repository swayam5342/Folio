import { BookmarkPlus } from 'lucide-react'

import { useCreateNote } from '../../api/queries'
import type { FaqItem, GlossaryItem, Source, StudioItem, StudioKind, StudySet, StudyGuideItem, TimelineItem } from '../../api/types'
import { sourceLabel } from '../../lib/sourceLocation'
import { ChevronLeft } from '../ui/icons'
import { useToast } from '../ui/overlay'
import { Button } from '../ui/primitives'
import { CopyButton } from './AnswerText'
import { CitationChip } from './CitationChip'

/** Each item's citation as a chip numbered by its position among the document's distinct sources. */
function useNumbering(items: StudioItem[]) {
  const numbers = new Map<string, number>()
  for (const item of items) {
    const key = item.source.marker ?? item.source.chunk_id
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1)
  }
  return (source: Source) => numbers.get(source.marker ?? source.chunk_id) ?? 1
}

/** The document as Markdown with [[Cn]] markers, so a saved note keeps working citations. */
function toMarkdown(kind: StudioKind, title: string, items: StudioItem[]): string {
  const cite = (s: Source) => (s.marker ? ` [[${s.marker}]]` : '')
  const lines: string[] = []
  for (const item of items) {
    if (kind === 'study_guide') {
      const it = item as StudyGuideItem
      lines.push(`## ${it.heading}`, '', `${it.body}${cite(it.source)}`, '')
    } else if (kind === 'faq') {
      const it = item as FaqItem
      lines.push(`**${it.question}**`, '', `${it.answer}${cite(it.source)}`, '')
    } else if (kind === 'timeline') {
      const it = item as TimelineItem
      lines.push(`- **${it.when}**: ${it.event}${cite(it.source)}`)
    } else {
      const it = item as GlossaryItem
      lines.push(`- **${it.term}**: ${it.definition}${cite(it.source)}`)
    }
  }
  return lines.join('\n').trim() || title
}

function plainText(kind: StudioKind, title: string, items: StudioItem[], number: (s: Source) => number): string {
  const sources = new Map<number, Source>()
  items.forEach((i) => sources.set(number(i.source), i.source))
  const body = toMarkdown(kind, title, items).replace(/ \[\[C\d+\]\]/g, '').replace(/\*\*/g, '').replace(/^## /gm, '')
  const list = [...sources.entries()].sort(([a], [b]) => a - b).map(([n, s]) => `[${n}] ${sourceLabel(s)}`)
  return `${title}\n\n${body}\n\nSources:\n${list.join('\n')}`
}

/** Reader for study guides, FAQs, timelines and glossaries: every item cites the passage it came from. */
export default function StudioView({
  set,
  onOpenSource,
  onBack,
}: {
  set: StudySet
  onOpenSource: (source: Source) => void
  onBack: () => void
}) {
  const kind = set.kind as StudioKind
  const items = set.items as StudioItem[]
  const number = useNumbering(items)
  const createNote = useCreateNote(set.notebook_id)
  const toast = useToast()
  const chip = (s: Source) => <CitationChip citation={{ n: number(s), source: s }} onOpen={onOpenSource} />

  const saveNote = () => {
    const unique = new Map(items.map((i) => [i.source.marker ?? i.source.chunk_id, i.source]))
    createNote.mutate(
      { title: set.title, content: toMarkdown(kind, set.title, items), sources: [...unique.values()] },
      { onSuccess: () => toast('Saved to notes'), onError: (e) => toast(e.message, 'error') },
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted hover:text-ink">
          <ChevronLeft size={16} /> Study
        </button>
      </div>
      <h3 className="mt-4 font-serif text-3xl font-semibold tracking-tight">{set.title}</h3>
      {set.topic && <p className="mt-1 text-sm text-muted">Focus: {set.topic}</p>}
      <div className="mt-3 -ml-2 flex flex-wrap items-center gap-1">
        <CopyButton label="Copy" text={() => plainText(kind, set.title, items, number)} />
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={saveNote} busy={createNote.isPending}>
          <BookmarkPlus aria-hidden size={13} /> Save to notes
        </Button>
      </div>

      {kind === 'study_guide' && (
        <div className="mt-6 space-y-6">
          {(items as StudyGuideItem[]).map((it, i) => (
            <section key={i}>
              <h4 className="font-serif text-xl font-semibold">
                <span className="mr-2 font-mono text-sm text-faint">{String(i + 1).padStart(2, '0')}</span>
                {it.heading}
              </h4>
              <p className="mt-1.5 font-serif text-[1.05rem] leading-relaxed">
                {it.body}
                {chip(it.source)}
              </p>
            </section>
          ))}
        </div>
      )}

      {kind === 'faq' && (
        <dl className="mt-6 divide-y divide-line rounded-lg border border-line bg-surface">
          {(items as FaqItem[]).map((it, i) => (
            <div key={i} className="px-4 py-3.5">
              <dt className="font-medium">{it.question}</dt>
              <dd className="mt-1 font-serif leading-relaxed text-ink/90">
                {it.answer}
                {chip(it.source)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {kind === 'timeline' && (
        <ol className="relative mt-6 ml-3 border-l-2 border-line">
          {(items as TimelineItem[]).map((it, i) => (
            <li key={i} className="relative pb-6 pl-6 last:pb-0">
              <span aria-hidden className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-paper bg-ink" />
              <p className="font-mono text-sm font-semibold">{it.when}</p>
              <p className="mt-0.5 font-serif text-[1.05rem] leading-relaxed">
                {it.event}
                {chip(it.source)}
              </p>
            </li>
          ))}
        </ol>
      )}

      {kind === 'glossary' && (
        <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(8rem,auto)_1fr]">
          {(items as GlossaryItem[]).map((it, i) => (
            <div key={i} className="contents">
              <dt className="font-semibold">{it.term}</dt>
              <dd className="-mt-3 font-serif leading-relaxed sm:mt-0">
                {it.definition}
                {chip(it.source)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
