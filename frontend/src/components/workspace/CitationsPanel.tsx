import { TriangleAlert } from 'lucide-react'

import type { Message, Source } from '../../api/types'
import { prepareAnswer } from '../../lib/citations'
import { formatScore } from '../../lib/scores'
import { sourceColorStyle } from '../../lib/sourceColors'
import { useSourceColor } from '../../lib/useSourceColors'
import type { OpenSource } from './CitationChip'
import { isPaged, sourceLocationLong } from '../../lib/sourceLocation'

type Cited = { n: number; source: Source }

function Group({ filename, items, onOpen }: { filename: string; items: Cited[]; onOpen: OpenSource }) {
  const color = useSourceColor(items[0].source.document_id)
  return (
    <section style={sourceColorStyle(color)} className="rounded-lg border border-line bg-surface">
      <h3 className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm font-medium">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--src)]" />
        <span className="min-w-0 truncate">{filename}</span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted">
          {items.length} citation{items.length === 1 ? '' : 's'}
        </span>
      </h3>
      <ul>
        {items.map(({ n, source }) => (
          <li key={n} className="border-b border-line/60 last:border-0">
            <button
              type="button"
              onClick={() => onOpen(source)}
              className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-sunken/60"
            >
              <span className="flex items-center gap-2 text-xs">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-[var(--src-soft)] px-1 font-semibold text-[var(--src-ink)]">
                  {n}
                </span>
                {isPaged(source) && <span className="font-medium capitalize">{sourceLocationLong(source)}</span>}
                {source.section_title && (
                  <span className="min-w-0 truncate text-muted">
                    {isPaged(source) ? '· ' : ''}
                    {source.section_title}
                  </span>
                )}
                {typeof source.support_score === 'number' ? (
                  <span className="ml-auto shrink-0 font-mono text-muted" title="How well this passage supports the sentence citing it">
                    support {formatScore(source.support_score)}
                  </span>
                ) : typeof source.similarity === 'number' ? (
                  <span className="ml-auto shrink-0 font-mono text-muted" title="How close this passage is to the question in meaning">
                    match {formatScore(source.similarity)}
                  </span>
                ) : (
                  typeof source.score === 'number' && (
                    <span className="ml-auto shrink-0 font-mono text-muted" title="Relevance to the question">
                      {formatScore(source.score)}
                    </span>
                  )
                )}
              </span>
              <span className="mt-1.5 line-clamp-3 block text-sm text-muted">{source.snippet}</span>
              {source.support === 'low' && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn">
                  <TriangleAlert aria-hidden size={12} /> Low support: this passage may not back the sentence citing it
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The Citations tab: one answer's citations, grouped by source in order of first use. */
export default function CitationsPanel({ message, onOpen }: { message: Message | null; onOpen: OpenSource }) {
  if (!message) return <p className="p-5 text-sm text-muted">Citations of the latest answer appear here.</p>
  const cited = prepareAnswer(message.content, message.abstained ? [] : message.sources).citations.filter(
    (c): c is Cited => !!c.source,
  )
  if (!cited.length) return <p className="p-5 text-sm text-muted">This answer has no citations.</p>
  const groups = new Map<string, Cited[]>()
  for (const c of cited) groups.set(c.source.document_id, [...(groups.get(c.source.document_id) ?? []), c])
  const low = cited.filter((c) => c.source.support === 'low').length
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <p className="text-xs text-muted">
        {cited.length} citation{cited.length === 1 ? '' : 's'} from {groups.size} source{groups.size === 1 ? '' : 's'}
        {low > 0 && `; ${low} flagged for low support by the citation check`}.
      </p>
      {[...groups.values()].map((items) => (
        <Group key={items[0].source.document_id} filename={items[0].source.filename} items={items} onOpen={onOpen} />
      ))}
    </div>
  )
}
