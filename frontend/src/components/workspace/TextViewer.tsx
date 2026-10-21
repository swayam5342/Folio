import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { useDocumentPages } from '../../api/queries'
import type { SourceDocument, SourcePage, ViewerTarget } from '../../api/types'
import { KIND_LABEL } from '../../lib/sourceLocation'
import { sourceColorStyle } from '../../lib/sourceColors'
import CitationBeam, { type Point } from './CitationBeam'
import { CloseIcon } from '../ui/icons'
import { IconButton, Spinner } from '../ui/primitives'

type Range = { start: number; end: number }

/** The cited range on the target page: the chunk's offsets, else where the snippet occurs. */
function citedRange(page: SourcePage, target: ViewerTarget): Range | null {
  if (page.page_number !== target.page) return null
  if (target.charStart != null && target.charEnd != null && target.charEnd > target.charStart) {
    return { start: target.charStart, end: Math.min(target.charEnd, page.text.length) }
  }
  if (!target.snippet) return null
  const at = page.text.indexOf(target.snippet)
  return at === -1 ? null : { start: at, end: at + target.snippet.length }
}

/** text[start, end) with the part inside `range` wrapped in numbered <mark>s. */
function marked(text: string, start: number, end: number, range: Range | null, order: { n: number }): ReactNode {
  if (!range || range.end <= start || range.start >= end) return text.slice(start, end)
  const a = Math.max(start, range.start)
  const b = Math.min(end, range.end)
  return (
    <>
      {text.slice(start, a)}
      <mark style={{ '--i': Math.min(order.n++, 12) } as CSSProperties}>{text.slice(a, b)}</mark>
      {text.slice(b, end)}
    </>
  )
}

function PageBody({ page, range }: { page: SourcePage; range: Range | null }) {
  const order = { n: 0 }
  const blocks = page.blocks.length ? page.blocks : [{ kind: 'body' as const, start: 0, end: page.text.length }]
  return (
    <>
      {blocks.map((block, i) => {
        const content = marked(page.text, block.start, block.end, range, order)
        if (block.kind === 'heading')
          return (
            <h3 key={i} className="mt-5 font-display text-lg font-semibold tracking-tight first:mt-0">
              {content}
            </h3>
          )
        if (block.kind === 'table' || block.kind === 'code')
          return (
            <pre key={i} className="my-3 overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed">
              {content}
            </pre>
          )
        return (
          <p key={i} className="my-3 whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
        )
      })}
    </>
  )
}

/** Reader for non-PDF sources: their extracted text, with the cited passage highlighted. */
export default function TextViewer({
  target,
  document: doc,
  color,
  beamFrom,
  onClose,
}: {
  target: ViewerTarget
  document: SourceDocument | undefined
  /** The source's hue: tints its highlight and the beam. */
  color: number
  /** Where the clicked citation was, to draw a beam from it to the highlight. */
  beamFrom: Point | null
  onClose: () => void
}) {
  const pages = useDocumentPages(target.documentId, doc?.indexed_at ?? undefined)
  const scroller = useRef<HTMLDivElement>(null)
  const [beamTo, setBeamTo] = useState<Point | null>(null)
  const slides = doc?.kind === 'pptx'

  const ranges = useMemo(
    () => new Map((pages.data ?? []).map((page) => [page.page_number, citedRange(page, target)])),
    [pages.data, target],
  )

  // Bring the highlight (or the cited slide) into view, then aim the beam at it.
  useEffect(() => {
    if (!pages.data) return
    const root = scroller.current
    const el = root?.querySelector('mark') ?? root?.querySelector(`[data-page="${target.page}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (!beamFrom) return
    const t = window.setTimeout(() => {
      const r = el.getBoundingClientRect()
      setBeamTo({ x: r.left, y: r.top + Math.min(r.height, 24) / 2 })
    }, 420)
    return () => window.clearTimeout(t)
  }, [pages.data, target, beamFrom])

  return (
    <section aria-label="Document viewer" className="flex h-full flex-col bg-sunken" style={sourceColorStyle(color)}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--src)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={doc?.filename}>
            {doc?.filename ?? 'Source'}
          </p>
        </div>
        {doc && <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-semibold text-muted">{KIND_LABEL[doc.kind]}</span>}
        <IconButton label="Close viewer" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {beamFrom && beamTo && <CitationBeam key={target.nonce} from={beamFrom} to={beamTo} color={color} />}
      <div ref={scroller} className="flex-1 overflow-auto p-4">
        {pages.isPending ? (
          <div className="flex justify-center py-16 text-muted">
            <Spinner size={22} />
          </div>
        ) : pages.isError ? (
          <p className="py-16 text-center text-sm text-danger">{pages.error.message}</p>
        ) : (
          <article className="text-source mx-auto w-full max-w-[760px] space-y-4 text-[15px]">
            {pages.data.map((page) => (
              <div
                key={page.page_number}
                data-page={page.page_number}
                className="rounded-md border border-line bg-paper px-6 py-5 shadow-[0_2px_12px_-4px_rgba(20,25,35,0.18)]"
              >
                {slides && (
                  <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Slide {page.page_number}
                  </p>
                )}
                <PageBody page={page} range={ranges.get(page.page_number) ?? null} />
              </div>
            ))}
          </article>
        )}
      </div>
    </section>
  )
}
