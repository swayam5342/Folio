import { Check, ClipboardType, ShieldAlert, ShieldCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type DragEvent } from 'react'

import {
  useAddTextSource,
  useDeleteDocument,
  useDocuments,
  useNotebook,
  useReindexDocument,
  useUpdateNotebookSettings,
  useUploadDocument,
} from '../../api/queries'
import type { SourceDocument } from '../../api/types'
import { formatBytes } from '../../lib/format'
import { spring, STAGGER } from '../../lib/motion'
import { sourceColorStyle } from '../../lib/sourceColors'
import { useSourceColor } from '../../lib/useSourceColors'
import { KIND_LABEL, UPLOAD_ACCEPT, UPLOAD_EXTENSIONS } from '../../lib/sourceLocation'
import { useWorkspace } from '../../lib/workspace'
import { AlertIcon, FileIcon, MoreIcon, UploadIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { IconButton, Menu, Spinner, cx } from '../ui/primitives'
import PasteTextDialog from './PasteTextDialog'

const MAX_MB = 50

/** Spinning gradient ring shown while a source is being read and indexed. */
function ProcessingRing() {
  return (
    <span className="relative flex size-9 items-center justify-center" role="status" aria-label="Indexing">
      <span
        aria-hidden
        className="absolute inset-0 animate-spin rounded-full [animation-duration:1.4s] [background:conic-gradient(var(--src),transparent_70%)] [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-2px))]"
      />
      <FileIcon size={16} className="text-[var(--src-ink)]" />
    </span>
  )
}

/** One-off burst when a source finishes indexing while the user is watching. */
function ReadyBurst() {
  return (
    <motion.span
      aria-hidden
      className="absolute inset-0 rounded-full border-2 border-[var(--src)]"
      initial={{ scale: 0.6, opacity: 1 }}
      animate={{ scale: 1.9, opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    />
  )
}

/** What indexing is doing right now: "Reading page 12 of 240", "Embedding 96 of 480 passages"… */
function progressLabel(doc: SourceDocument): string {
  const p = doc.progress
  if (!p) return 'Queued…'
  const of = p.done != null && p.total ? ` ${p.done} of ${p.total}` : ''
  switch (p.stage) {
    case 'reading':
      return doc.kind === 'pdf' && of ? `Reading page${of}` : 'Reading…'
    case 'ocr':
      return `OCR on page${of} (scanned)`
    case 'chunking':
      return 'Splitting into passages…'
    case 'embedding':
      return of ? `Embedding${of} passages` : 'Embedding…'
    default:
      return 'Saving…'
  }
}

/** Determinate bar for stages that know their total. */
function ProgressBar({ doc }: { doc: SourceDocument }) {
  const p = doc.progress
  if (!p || p.done == null || !p.total) return null
  const pct = Math.round((100 * p.done) / p.total)
  return (
    <span
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={progressLabel(doc)}
      className="mt-1.5 block h-1 overflow-hidden rounded-full bg-sunken"
    >
      <span className="block h-full rounded-full bg-[var(--src)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </span>
  )
}

/** "12 pages, 2 OCR · 1.2 MB", "8 slides · 300 KB", or just the size for single-page kinds. */
function sourceMeta(doc: SourceDocument): string {
  const size = formatBytes(doc.size_bytes)
  if (doc.kind === 'pptx') return `${doc.page_count} ${doc.page_count === 1 ? 'slide' : 'slides'} · ${size}`
  if (doc.kind !== 'pdf') return size
  return `${doc.page_count} ${doc.page_count === 1 ? 'page' : 'pages'}${doc.ocr_pages ? `, ${doc.ocr_pages} OCR` : ''} · ${size}`
}

/** The source's LLM-written overview: clamped to three lines, expandable. */
function SourceSummary({ doc }: { doc: SourceDocument }) {
  const [open, setOpen] = useState(false)
  if (doc.summary_status === 'pending') {
    return <p className="w-full px-3 pb-2.5 pl-[3.25rem] text-xs italic text-faint">Writing a summary…</p>
  }
  if (!doc.summary) return null
  return (
    <div className="w-full px-3 pb-2.5 pl-[3.25rem] text-xs leading-relaxed text-muted">
      <p className={cx(!open && 'line-clamp-3')}>{doc.summary}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-0.5 font-medium text-ink underline-offset-2 hover:underline"
      >
        {open ? 'Less' : 'More'}
      </button>
    </div>
  )
}

function SourceCard({
  doc,
  index,
  active,
  included,
  onToggle,
  onOpen,
  onReindex,
  onDelete,
}: {
  doc: SourceDocument
  index: number
  active: boolean
  /** Whether chat searches this source. */
  included: boolean
  onToggle: () => void
  onOpen: () => void
  onReindex: () => void
  onDelete: () => void
}) {
  const color = useSourceColor(doc.id)
  const ready = doc.status === 'ready'
  // Celebrate a processing → ready transition seen in this session (not sources that were already ready).
  const previous = useRef(doc.status)
  const [justReady, setJustReady] = useState(false)
  useEffect(() => {
    if (previous.current === 'processing' && doc.status === 'ready') {
      setJustReady(true)
      const t = window.setTimeout(() => setJustReady(false), 2400)
      previous.current = doc.status
      return () => window.clearTimeout(t)
    }
    previous.current = doc.status
  }, [doc.status])

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ ...spring.gentle, delay: Math.min(index, 8) * STAGGER }}
      style={sourceColorStyle(color)}
      className={cx(
        'group relative flex flex-wrap items-start overflow-hidden rounded-lg border bg-surface transition-colors',
        active ? 'border-[var(--src)] shadow-[0_0_0_3px_var(--src-soft)]' : 'border-line hover:border-line-strong',
      )}
    >
      <span aria-hidden className={cx('absolute inset-y-0 left-0 w-1 bg-[var(--src)]', !ready && 'opacity-40')} />
      <input
        type="checkbox"
        checked={ready && included}
        disabled={!ready}
        onChange={onToggle}
        aria-label={`Search ${doc.filename} in chat`}
        title={ready ? 'Include in chat answers' : undefined}
        className="ml-3 mt-4 size-4 shrink-0 cursor-pointer accent-[var(--src)] disabled:cursor-default disabled:opacity-30"
      />
      <button
        type="button"
        disabled={!ready}
        onClick={onOpen}
        className={cx(
          'flex min-w-0 flex-1 items-start gap-3 rounded-md p-2.5 pr-10 text-left disabled:cursor-default',
          ready && !included && 'opacity-60',
        )}
      >
        {doc.status === 'processing' ? (
          <ProcessingRing />
        ) : (
          <span
            className={cx(
              'relative flex size-9 shrink-0 items-center justify-center rounded-full',
              doc.status === 'failed' ? 'bg-danger-soft text-danger' : 'bg-[var(--src-soft)] text-[var(--src-ink)]',
            )}
          >
            {doc.status === 'failed' ? <AlertIcon size={16} /> : justReady ? <Check size={16} strokeWidth={3} /> : <FileIcon size={16} />}
            {justReady && <ReadyBurst />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium" title={doc.filename}>
              {doc.filename}
            </span>
            <span className="shrink-0 rounded-sm bg-sunken px-1 font-mono text-[9px] font-semibold tracking-wide text-muted">
              {KIND_LABEL[doc.kind] ?? 'PDF'}
            </span>
          </span>
          <span className={cx('mt-0.5 block text-xs', doc.status === 'failed' ? 'text-danger' : 'text-muted')}>
            {doc.status === 'processing'
              ? progressLabel(doc)
              : doc.status === 'failed'
                ? doc.error
                : justReady
                  ? 'Indexed and ready'
                  : sourceMeta(doc)}
          </span>
          {doc.status === 'processing' && <ProgressBar doc={doc} />}
          {ready && doc.risk_score > 0 && (
            <span
              className={cx(
                'mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                doc.risk_score >= 5 ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted',
              )}
              title={doc.risk_reasons.join(', ')}
            >
              <ShieldAlert aria-hidden size={11} />
              {doc.risk_score >= 5 ? 'Unsafe passages quarantined' : 'Source normalized'}
            </span>
          )}
          {ready && Object.keys(doc.pii_summary).length > 0 && (
            <span className="mt-1 ml-1 inline-flex rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              PII detected · {Object.values(doc.pii_summary).reduce((a, b) => a + b, 0)}
            </span>
          )}
        </span>
      </button>
      {ready && <SourceSummary doc={doc} />}
      <div className="absolute right-1.5 top-2">
        <Menu
          trigger={(props) => (
            <IconButton label={`Options for ${doc.filename}`} {...props}>
              <MoreIcon size={16} />
            </IconButton>
          )}
          items={[
            ...(doc.status !== 'processing' ? [{ label: 'Re-index', onSelect: onReindex }] : []),
            { label: 'Remove source', danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </motion.li>
  )
}

/** Left pane: upload, the notebook's sources, and which of them chat searches. */
export default function SourcesPanel({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId)
  const documents = useDocuments(notebookId)
  const upload = useUploadDocument(notebookId)
  const addText = useAddTextSource(notebookId)
  const remove = useDeleteDocument(notebookId)
  const reindex = useReindexDocument(notebookId)
  const settings = useUpdateNotebookSettings()
  const { excluded, setExcluded, openDocument, viewer, closeViewer, uploadNonce } = useWorkspace()
  const toast = useToast()
  const confirm = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [pasting, setPasting] = useState(false)

  const submitText = (title: string, text: string) =>
    addText.mutate(
      { title, text },
      {
        onSuccess: () => {
          setPasting(false)
          toast(`Added “${title}”. Indexing…`)
        },
        onError: (e) => toast(e.message, 'error'),
      },
    )

  // The command palette's "Add a source" opens the file picker.
  useEffect(() => {
    if (uploadNonce) input.current?.click()
  }, [uploadNonce])

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!UPLOAD_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        toast(`${file.name}: supported files are PDF, Word (.docx), PowerPoint (.pptx), Markdown and text.`, 'error')
        continue
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        toast(`${file.name} is larger than ${MAX_MB} MB.`, 'error')
        continue
      }
      // mutateAsync per file: mutate()'s callbacks only fire for the most recent call.
      setUploading((n) => n + 1)
      upload
        .mutateAsync(file)
        .catch((e: Error) => toast(`${file.name}: ${e.message}`, 'error'))
        .finally(() => setUploading((n) => n - 1))
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const removeDoc = async (doc: SourceDocument) => {
    const ok = await confirm({
      title: `Remove “${doc.filename}”?`,
      body: 'Answers will no longer draw on it. Past answers keep their text, but its citations will stop opening.',
      confirmLabel: 'Remove source',
      danger: true,
    })
    if (!ok) return
    remove.mutate(doc.id, {
      onSuccess: () => {
        if (viewer?.documentId === doc.id) closeViewer()
      },
      onError: (e) => toast(e.message, 'error'),
    })
  }

  const docs = documents.data ?? []
  const readyIds = docs.filter((d) => d.status === 'ready').map((d) => d.id)
  const includedCount = readyIds.filter((id) => !excluded.has(id)).length

  const toggle = (id: string) => {
    const next = new Set(excluded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExcluded(next)
  }

  const reindexDoc = (doc: SourceDocument) =>
    reindex.mutate(doc.id, {
      onSuccess: () => toast(`Re-indexing ${doc.filename}…`),
      onError: (e) => toast(e.message, 'error'),
    })

  return (
    <section
      aria-label="Sources"
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="font-display text-xl font-semibold tracking-tight">Sources</h2>
        {readyIds.length > 1 ? (
          <button
            type="button"
            onClick={() => setExcluded(includedCount === readyIds.length ? new Set(readyIds) : new Set())}
            className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {includedCount === readyIds.length ? 'Deselect all' : 'Select all'}
          </button>
        ) : (
          <span className="text-xs text-muted">{docs.length > 0 && `${docs.length} total`}</span>
        )}
      </div>

      <div className="mx-3 mb-2 flex items-center justify-between rounded-md border border-line bg-sunken px-2.5 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted" title="Masks Aadhaar, PAN, email addresses and Indian phone numbers in new or re-indexed chunks">
          <ShieldCheck aria-hidden size={14} className="text-accent" /> Mask PII
        </span>
        <input
          type="checkbox"
          aria-label="Mask personal information when indexing sources"
          checked={notebook.data?.pii_redaction_enabled ?? false}
          disabled={!notebook.data || settings.isPending}
          onChange={(e) =>
            settings.mutate(
              { id: notebookId, piiRedactionEnabled: e.target.checked },
              {
                onSuccess: () => toast('PII setting saved. Re-index existing sources to apply it.'),
                onError: (error) => toast(error.message, 'error'),
              },
            )
          }
          className="size-4 accent-accent"
        />
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cx(
            'relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-dashed px-3 py-3 text-left text-sm transition-all',
            dragging
              ? 'border-accent bg-accent-soft text-ink shadow-glow'
              : 'border-line-strong text-muted hover:border-ink hover:text-ink',
          )}
        >
          <AnimatePresence>
            {dragging &&
              [0, 1].map((i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute left-6 top-1/2 size-10 -translate-y-1/2 rounded-full border border-accent"
                  initial={{ scale: 0.4, opacity: 0.8 }}
                  animate={{ scale: 4, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.7, ease: 'easeOut' }}
                />
              ))}
          </AnimatePresence>
          {uploading > 0 ? <Spinner size={18} /> : <UploadIcon />}
          <span>
            <span className="block font-medium text-ink">
              {dragging ? 'Drop to add' : uploading > 0 ? 'Uploading…' : 'Add source'}
            </span>
            <span className="block text-xs">PDF, Word, PowerPoint, Markdown or text, up to {MAX_MB} MB each</span>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => setPasting(true)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <ClipboardType aria-hidden size={14} /> Paste text
        </button>
        {pasting && <PasteTextDialog busy={addText.isPending} onSubmit={submitText} onClose={() => setPasting(false)} />}
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-3 pb-4">
        {documents.isPending ? (
          <div className="p-3 text-muted">
            <Spinner />
          </div>
        ) : documents.isError ? (
          <p className="p-3 text-sm text-danger">{documents.error.message}</p>
        ) : docs.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">
            No sources yet. Add a file or paste some text and Folio will index it so you can ask questions about it.
          </p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {docs.map((doc, i) => (
                <SourceCard
                  key={doc.id}
                  doc={doc}
                  index={i}
                  active={doc.id === viewer?.documentId}
                  included={!excluded.has(doc.id)}
                  onToggle={() => toggle(doc.id)}
                  onOpen={() => openDocument(doc.id)}
                  onReindex={() => reindexDoc(doc)}
                  onDelete={() => removeDoc(doc)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  )
}
