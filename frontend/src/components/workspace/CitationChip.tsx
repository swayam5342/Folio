import { TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { HoverCard } from 'radix-ui'
import { useRef, useState, type MouseEvent } from 'react'

import type { Source } from '../../api/types'
import type { Citation } from '../../lib/citations'
import { spring } from '../../lib/motion'
import { sourceColorStyle } from '../../lib/sourceColors'
import { highlightSegments } from '../../lib/terms'
import { useSourceColor } from '../../lib/useSourceColors'
import { cx } from '../ui/primitives'
import { isPaged, sourceLabel, sourceLocation } from '../../lib/sourceLocation'

export type OpenSource = (source: Source, origin?: { x: number; y: number }) => void

function Snippet({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-[2px] bg-[var(--src-soft)] px-px text-[var(--src-ink)]">
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </>
  )
}

function Relevance({ score }: { score: number }) {
  return (
    <span className="mt-3 flex items-center gap-2 text-xs text-muted">
      <span className="shrink-0">Relevance</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <span className="block h-full rounded-full bg-[var(--src)]" style={{ width: `${Math.max(score * 100, 3)}%` }} />
      </span>
      <span className="font-mono tabular-nums text-ink">{score.toFixed(2)}</span>
    </span>
  )
}

/**
 * Numbered citation in an answer, tinted with its source's color. Hovering or
 * focusing it shows a card with the file, page, section, the snippet with the
 * question's words highlighted, the passage's relevance and, when the citation
 * check failed, a low-support warning. Clicking opens the page in the viewer.
 */
export function CitationChip({
  citation,
  onOpen,
  terms = [],
}: {
  citation: Citation
  onOpen?: OpenSource
  terms?: string[]
}) {
  const { n, source } = citation
  const color = useSourceColor(source?.document_id)
  const [open, setOpen] = useState(false)
  // Set by a click: the hover card's open timer (started when the pointer entered) may still fire
  // after the click, and the viewer opening shifts the chip away, so no "leave" would ever close it.
  const suppressed = useRef(false)

  if (!source) {
    return (
      <span className="ml-0.5 inline-flex h-[1.3em] min-w-[1.5em] items-center justify-center rounded-sm bg-sunken px-1 align-[0.12em] font-sans text-[0.68em] font-semibold text-muted">
        {n}
      </span>
    )
  }

  const low = source.support === 'low'
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    suppressed.current = true
    setOpen(false)
    onOpen?.(source, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  return (
    <HoverCard.Root
      open={open}
      onOpenChange={(next) => setOpen(next && suppressed.current ? false : next)}
      openDelay={150}
      closeDelay={80}
    >
      <HoverCard.Trigger asChild>
        <button
          type="button"
          onClick={click}
          onPointerEnter={() => {
            suppressed.current = false
          }}
          // Keyboard focus shows the card; a mouse click (which also focuses) shouldn't pin it open.
          onFocus={(e) => e.currentTarget.matches(':focus-visible') && setOpen(true)}
          onBlur={() => setOpen(false)}
          style={sourceColorStyle(color)}
          aria-label={`Source ${n}: ${sourceLabel(source)}${low ? ' (low support)' : ''}`}
          className={cx(
            'relative ml-0.5 inline-flex h-[1.3em] min-w-[1.5em] items-center justify-center gap-0.5 rounded-sm px-1 align-[0.12em] font-sans text-[0.68em] font-semibold leading-none',
            'bg-[var(--src-soft)] text-[var(--src-ink)] ring-1 ring-[var(--src)]/40 transition-transform hover:-translate-y-px',
            low && 'ring-2 ring-warn',
          )}
        >
          {n}
          {low && <TriangleAlert aria-hidden size={9} strokeWidth={3} />}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="top" sideOffset={8} collisionPadding={12} asChild>
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={spring.pop}
            style={sourceColorStyle(color)}
            className="z-50 w-80 rounded-lg border border-line bg-surface p-3.5 font-sans text-[13px] leading-snug text-ink shadow-[0_14px_40px_-14px_rgba(20,25,35,0.45)]"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--src)]" />
              <span className="min-w-0 truncate font-medium">{source.filename}</span>
              {isPaged(source) && <span className="ml-auto shrink-0 font-mono text-xs text-muted">{sourceLocation(source)}</span>}
            </span>
            {source.section_title && <span className="mt-1 block truncate text-xs text-muted">{source.section_title}</span>}
            <span className="mt-2 line-clamp-5 block border-l-2 border-[var(--src)] pl-2.5 text-muted">
              <Snippet text={source.snippet} terms={terms} />
            </span>
            {typeof source.score === 'number' && <Relevance score={source.score} />}
            {low && (
              <span className="mt-3 flex gap-2 rounded-md bg-warn-soft px-2.5 py-2 text-xs text-warn">
                <TriangleAlert aria-hidden size={14} className="mt-px shrink-0" />
                <span>
                  <span className="font-semibold">Low support.</span> This passage may not back the sentence citing it; check
                  the page.
                </span>
              </span>
            )}
            <span className="mt-2.5 block text-xs text-faint">{source.document_kind === 'pptx' ? 'Click to open the slide' : isPaged(source) ? 'Click to open the page' : 'Click to open the passage'}</span>
          </motion.div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
