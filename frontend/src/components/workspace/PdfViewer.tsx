import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'

import { documentFileUrl } from '../../api/queries'
import type { SourceDocument, ViewerTarget } from '../../api/types'
import { ChevronLeft, ChevronRight, CloseIcon } from '../ui/icons'
import { IconButton, Spinner } from '../ui/primitives'

// Must be configured in the module that renders react-pdf components.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type TextItem = { str: string }

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase()

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

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

export default function PdfViewer({
  target,
  document: doc,
  onClose,
}: {
  target: ViewerTarget
  document: SourceDocument | undefined
  onClose: () => void
}) {
  const [numPages, setNumPages] = useState<number>(0)
  const [page, setPage] = useState(target.page)
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [width, setWidth] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // New target (citation click) → jump to its page.
  useEffect(() => {
    setPage(target.page)
    setMarked(new Set())
  }, [target.documentId, target.page, target.nonce])

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  const textRenderer = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) =>
      marked.has(itemIndex) ? `<mark>${escapeHtml(str)}</mark>` : escapeHtml(str),
    [marked],
  )

  // Scroll the first highlight into view once the text layer is drawn.
  const onTextLayer = useCallback(() => {
    const mark = scroller.current?.querySelector('.textLayer mark')
    mark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const go = (delta: number) => setPage((p) => Math.min(Math.max(1, p + delta), numPages || 1))

  return (
    <section aria-label="Document viewer" className="flex h-full flex-col bg-sunken">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={doc?.filename}>
            {doc?.filename ?? 'Document'}
          </p>
        </div>
        <IconButton label="Previous page" onClick={() => go(-1)} disabled={page <= 1}>
          <ChevronLeft />
        </IconButton>
        <span className="min-w-16 text-center text-sm tabular-nums text-muted">
          {page} / {numPages || '–'}
        </span>
        <IconButton label="Next page" onClick={() => go(1)} disabled={!numPages || page >= numPages}>
          <ChevronRight />
        </IconButton>
        <IconButton label="Close viewer" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      <div ref={scroller} className="flex-1 overflow-auto p-4">
        <div ref={frame} className="mx-auto w-full max-w-[900px]">
          <Document
            file={file}
            onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
            loading={
              <div className="flex justify-center py-16 text-muted">
                <Spinner size={22} />
              </div>
            }
            error={<p className="py-16 text-center text-sm text-danger">This PDF couldn't be loaded.</p>}
          >
            {width > 0 && (
              <Page
                key={`${target.documentId}-${page}-${target.nonce}`}
                pageNumber={page}
                width={width}
                className="pdf-page overflow-hidden rounded-sm shadow-[0_2px_12px_-4px_rgba(20,25,35,0.25)]"
                renderAnnotationLayer={false}
                onGetTextSuccess={onText}
                customTextRenderer={textRenderer}
                onRenderTextLayerSuccess={onTextLayer}
                loading={<div style={{ height: width * 1.3 }} />}
              />
            )}
          </Document>
        </div>
      </div>
    </section>
  )
}
