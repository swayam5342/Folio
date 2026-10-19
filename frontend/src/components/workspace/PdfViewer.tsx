import { Download, LayoutGrid, Minus, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Document, Outline, Page, Thumbnail, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'

import { documentFileUrl } from '../../api/queries'
import type { SourceDocument, ViewerTarget } from '../../api/types'
import { sourceColorStyle } from '../../lib/sourceColors'
import CitationBeam, { type Point } from './CitationBeam'
import { ChevronLeft, ChevronRight, CloseIcon } from '../ui/icons'
import { IconButton, Spinner, cx } from '../ui/primitives'

// Must be configured in the module that renders react-pdf components.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type TextItem = { str: string }
type PdfProxy = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }
type SearchHit = { page: number; excerpt: string }

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const MAX_HITS = 200

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase()

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Finds which text-layer items cover the snippet. pdf.js and the backend's
 * PDF parser split whitespace differently, so both sides are compared with
 * all whitespace removed. Falls back to the snippet's first 60 characters.
 */
function findSnippetItems(items: TextItem[], snippet: string): Set<number> {
  const offsets: number[] = []
  let joined = ''
  for (const item of items) {
    offsets.push(joined.length)
    joined += squash(item.str)
  }
  const target = squash(snippet)
  for (const needle of [target, target.slice(0, 60), target.slice(-60)]) {
    if (needle.length < 12) continue
    const start = joined.indexOf(needle)
    if (start === -1) continue
    const end = start + needle.length
    const hit = new Set<number>()
    items.forEach((item, i) => {
      const a = offsets[i]
      const b = a + squash(item.str).length
      if (b > a && a < end && b > start) hit.add(i)
    })
    return hit
  }
  return new Set()
}

/** Every page whose text contains the query, with a short excerpt around the first match. */
async function searchPdf(pdf: PdfProxy, query: string): Promise<SearchHit[]> {
  const needle = query.toLowerCase()
  const hits: SearchHit[] = []
  for (let n = 1; n <= pdf.numPages && hits.length < MAX_HITS; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    const text = (content.items as TextItem[]).map((i) => i.str).join(' ').replace(/\s+/g, ' ')
    const at = text.toLowerCase().indexOf(needle)
    if (at === -1) continue
    const from = Math.max(0, at - 40)
    hits.push({ page: n, excerpt: `${from > 0 ? '…' : ''}${text.slice(from, at + needle.length + 60)}…` })
  }
  return hits
}

/** A page thumbnail rendered only once it scrolls into view (long PDFs have hundreds). */
function LazyThumb({ page, current, onPick }: { page: number; current: boolean; onPick: (n: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [current])
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onPick(page)}
      aria-label={`Page ${page}`}
      aria-current={current ? 'page' : undefined}
      className={cx(
        'block w-full rounded-md border-2 p-1 text-center transition-colors',
        current ? 'border-[var(--src)]' : 'border-transparent hover:border-line-strong',
      )}
    >
      <span className="block min-h-[110px] overflow-hidden rounded-sm bg-paper">
        {visible && <Thumbnail pageNumber={page} width={96} onItemClick={() => onPick(page)} />}
      </span>
      <span className="mt-1 block font-mono text-[10px] text-muted">{page}</span>
    </button>
  )
}

export default function PdfViewer({
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
  const [numPages, setNumPages] = useState<number>(0)
  const [page, setPage] = useState(target.page)
  const [pageInput, setPageInput] = useState(String(target.page))
  const [zoom, setZoom] = useState(1)
  const [sidebar, setSidebar] = useState<'pages' | 'contents' | null>(null)
  const [hasOutline, setHasOutline] = useState(false)
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [width, setWidth] = useState(0)
  const [beamTo, setBeamTo] = useState<Point | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('') // the searched term, highlighted on every page
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const pdfRef = useRef<PdfProxy | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // The page frame mounts only once the PDF has loaded (it's inside <Document>), so observe it via a callback ref.
  const observer = useRef<ResizeObserver | null>(null)
  const frame = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.current.observe(el)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])

  useEffect(() => setPageInput(String(page)), [page])

  const file = useMemo(
    () => ({ url: documentFileUrl(target.documentId), withCredentials: true }),
    [target.documentId],
  )

  const highlightOnThisPage = page === target.page && !!target.snippet

  const onText = useCallback(
    ({ items }: { items: unknown[] }) => {
      setMarked(highlightOnThisPage ? findSnippetItems(items as TextItem[], target.snippet!) : new Set())
    },
    [highlightOnThisPage, target.snippet],
  )

  // Marked runs are numbered so the highlighter stroke sweeps through them in reading order.
  const order = useMemo(() => [...marked].sort((a, b) => a - b), [marked])
  const termPattern = useMemo(() => (term ? new RegExp(`(${escapeRegExp(term)})`, 'gi') : null), [term])
  const textRenderer = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) => {
      if (marked.has(itemIndex)) return `<mark style="--i:${Math.min(order.indexOf(itemIndex), 12)}">${escapeHtml(str)}</mark>`
      if (termPattern) return str.split(termPattern).map((part, i) => (i % 2 ? `<mark class="search-hit">${escapeHtml(part)}</mark>` : escapeHtml(part))).join('')
      return escapeHtml(str)
    },
    [marked, order, termPattern],
  )

  // Scroll the first highlight into view once the text layer is drawn, then aim the beam at it.
  const onTextLayer = useCallback(() => {
    const mark = scroller.current?.querySelector('.textLayer mark')
    if (!mark) return
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (beamFrom && !mark.classList.contains('search-hit')) {
      window.setTimeout(() => {
        const r = mark.getBoundingClientRect()
        setBeamTo({ x: r.left, y: r.top + r.height / 2 })
      }, 420)
    }
  }, [beamFrom])

  const goTo = (n: number) => setPage(Math.min(Math.max(1, n), numPages || 1))
  const go = (delta: number) => goTo(page + delta)

  const jump = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(pageInput)
    if (Number.isFinite(n) && n >= 1) goTo(Math.round(n))
    else setPageInput(String(page))
  }

  const zoomBy = (step: number) => {
    const i = ZOOMS.findIndex((z) => z >= zoom)
    setZoom(ZOOMS[Math.min(Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + step), ZOOMS.length - 1)])
  }

  const runSearch = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2 || !pdfRef.current) return
    setSearching(true)
    try {
      const found = await searchPdf(pdfRef.current, q)
      setHits(found)
      setTerm(q)
      if (found.length) goTo(found[0].page)
    } finally {
      setSearching(false)
    }
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setHits(null)
    setTerm('')
    setQuery('')
  }

  return (
    <section aria-label="Document viewer" className="flex h-full flex-col bg-sunken" style={sourceColorStyle(color)}>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-paper px-2">
        <span aria-hidden className="ml-1 size-2.5 shrink-0 rounded-full bg-[var(--src)]" />
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium" title={doc?.filename}>
            {doc?.filename ?? 'Document'}
          </p>
        </div>
        <IconButton label="Search in document" onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
          <Search size={16} />
        </IconButton>
        <IconButton label="Pages and contents" onClick={() => setSidebar((s) => (s ? null : hasOutline ? 'contents' : 'pages'))}>
          <LayoutGrid size={16} />
        </IconButton>
        <a
          href={documentFileUrl(target.documentId)}
          download={doc?.filename}
          aria-label="Download PDF"
          title="Download PDF"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <Download size={16} />
        </a>
        <IconButton label="Close viewer" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-paper px-2 text-sm">
        <IconButton label="Previous page" onClick={() => go(-1)} disabled={page <= 1}>
          <ChevronLeft />
        </IconButton>
        <form onSubmit={jump} className="flex items-center gap-1 text-muted">
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onBlur={jump}
            inputMode="numeric"
            aria-label="Page number"
            className="h-7 w-11 rounded-md border border-line bg-surface text-center tabular-nums text-ink outline-none focus:border-ink"
          />
          <span className="tabular-nums">/ {numPages || '–'}</span>
        </form>
        <IconButton label="Next page" onClick={() => go(1)} disabled={!numPages || page >= numPages}>
          <ChevronRight />
        </IconButton>
        <span className="flex-1" />
        <IconButton label="Zoom out" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]}>
          <Minus size={15} />
        </IconButton>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Fit to width"
          className="h-7 min-w-14 rounded-md px-1.5 text-xs tabular-nums text-muted hover:bg-sunken hover:text-ink"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]}>
          <Plus size={15} />
        </IconButton>
      </div>

      {searchOpen && (
        <div className="shrink-0 border-b border-line bg-paper px-3 py-2">
          <form onSubmit={runSearch} className="flex items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
              placeholder="Search this PDF…"
              aria-label="Search text"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm outline-none focus:border-ink"
            />
            {searching ? <Spinner size={16} /> : hits && <span className="shrink-0 text-xs text-muted">{hits.length} {hits.length === 1 ? "page" : "pages"}</span>}
            <IconButton label="Close search" onClick={closeSearch}>
              <X size={15} />
            </IconButton>
          </form>
          {hits && hits.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
              {hits.map((h) => (
                <li key={h.page}>
                  <button
                    type="button"
                    onClick={() => goTo(h.page)}
                    className={cx(
                      'flex w-full gap-2 rounded px-1.5 py-1 text-left hover:bg-sunken',
                      h.page === page && 'bg-sunken',
                    )}
                  >
                    <span className="w-8 shrink-0 font-mono text-muted">p.{h.page}</span>
                    <span className="min-w-0 truncate">{h.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hits && hits.length === 0 && <p className="mt-2 text-xs text-muted">No matches.</p>}
        </div>
      )}

      {beamFrom && beamTo && <CitationBeam key={target.nonce} from={beamFrom} to={beamTo} color={color} />}
      <Document
        file={file}
        onLoadSuccess={(pdf) => {
          pdfRef.current = pdf as unknown as PdfProxy
          setNumPages(pdf.numPages)
          pdf.getOutline().then((outline) => setHasOutline(!!outline?.length)).catch(() => setHasOutline(false))
        }}
        loading={
          <div className="flex justify-center py-16 text-muted">
            <Spinner size={22} />
          </div>
        }
        error={<p className="py-16 text-center text-sm text-danger">This PDF couldn't be loaded.</p>}
        className="flex min-h-0 flex-1"
      >
        {sidebar && (
          <aside aria-label="Pages" className="flex w-32 shrink-0 flex-col border-r border-line bg-paper">
            {hasOutline && (
              <div className="flex shrink-0 gap-1 border-b border-line p-1.5 text-xs">
                {(['contents', 'pages'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSidebar(s)}
                    className={cx('flex-1 rounded px-1 py-1 capitalize', sidebar === s ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {sidebar === 'contents' ? (
                <Outline
                  className="pdf-outline text-xs"
                  onItemClick={({ pageNumber }) => goTo(pageNumber)}
                />
              ) : (
                <div className="space-y-1.5">
                  {Array.from({ length: numPages }, (_, i) => (
                    <LazyThumb key={i} page={i + 1} current={page === i + 1} onPick={goTo} />
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
        <div ref={scroller} className="min-w-0 flex-1 overflow-auto p-4">
          <div ref={frame} className="mx-auto w-full max-w-[900px]">
            {width > 0 && (
              <Page
                key={`${target.documentId}-${page}-${target.nonce}`}
                pageNumber={page}
                width={Math.round(width * zoom)}
                className="pdf-page mx-auto w-fit overflow-hidden rounded-sm shadow-[0_2px_12px_-4px_rgba(20,25,35,0.25)]"
                renderAnnotationLayer={false}
                onGetTextSuccess={onText}
                customTextRenderer={textRenderer}
                onRenderTextLayerSuccess={onTextLayer}
                loading={<div style={{ height: width * zoom * 1.3 }} />}
              />
            )}
          </div>
        </div>
      </Document>
    </section>
  )
}
