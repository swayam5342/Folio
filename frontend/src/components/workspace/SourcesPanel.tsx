import { useRef, useState, type DragEvent } from 'react'

import { useDeleteDocument, useDocuments, useUploadDocument } from '../../api/queries'
import type { SourceDocument } from '../../api/types'
import { formatBytes } from '../../lib/format'
import { AlertIcon, FileIcon, MoreIcon, UploadIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { IconButton, Menu, Spinner, cx } from '../ui/primitives'

const MAX_MB = 50

function SourceRow({
  doc,
  active,
  onOpen,
  onDelete,
}: {
  doc: SourceDocument
  active: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const ready = doc.status === 'ready'
  return (
    <li
      className={cx(
        'group relative rounded-md border transition-colors',
        active ? 'border-line-strong bg-surface' : 'border-transparent hover:bg-surface',
      )}
    >
      <button
        type="button"
        disabled={!ready}
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-md p-2.5 pr-10 text-left disabled:cursor-default"
      >
        <span
          className={cx(
            'mt-0.5 shrink-0',
            doc.status === 'failed' ? 'text-danger' : ready ? 'text-ink' : 'text-faint',
          )}
        >
          {doc.status === 'processing' ? <Spinner size={18} /> : doc.status === 'failed' ? <AlertIcon /> : <FileIcon />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={doc.filename}>
            {doc.filename}
          </span>
          <span className={cx('mt-0.5 block text-xs', doc.status === 'failed' ? 'text-danger' : 'text-muted')}>
            {doc.status === 'processing'
              ? 'Reading and indexing…'
              : doc.status === 'failed'
                ? doc.error
                : `${doc.page_count} ${doc.page_count === 1 ? 'page' : 'pages'}${doc.ocr_pages ? `, ${doc.ocr_pages} read with OCR` : ''}, ${formatBytes(doc.size_bytes)}`}
          </span>
        </span>
      </button>
      <div className="absolute right-1.5 top-1.5">
        <Menu
          trigger={(props) => (
            <IconButton label={`Options for ${doc.filename}`} {...props}>
              <MoreIcon size={16} />
            </IconButton>
          )}
          items={[{ label: 'Remove source', danger: true, onSelect: onDelete }]}
        />
      </div>
    </li>
  )
}

export default function SourcesPanel({
  notebookId,
  activeDocumentId,
  onOpen,
  onRemoved,
}: {
  notebookId: string
  activeDocumentId: string | null
  onOpen: (doc: SourceDocument) => void
  onRemoved: (documentId: string) => void
}) {
  const documents = useDocuments(notebookId)
  const upload = useUploadDocument(notebookId)
  const remove = useDeleteDocument(notebookId)
  const toast = useToast()
  const confirm = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        toast(`${file.name} isn't a PDF — only PDFs are supported.`, 'error')
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
      onSuccess: () => onRemoved(doc.id),
      onError: (e) => toast(e.message, 'error'),
    })
  }

  const docs = documents.data ?? []

  return (
    <section
      aria-label="Sources"
      className={cx('flex h-full flex-col', dragging && 'bg-highlight-soft')}
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
        <h2 className="font-serif text-lg font-semibold">Sources</h2>
        <span className="text-xs text-muted">{docs.length > 0 && `${docs.length} total`}</span>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full items-center gap-3 rounded-md border border-dashed border-line-strong px-3 py-3 text-left text-sm text-muted transition-colors hover:border-ink hover:text-ink"
        >
          {uploading > 0 ? <Spinner size={18} /> : <UploadIcon />}
          <span>
            <span className="block font-medium text-ink">{uploading > 0 ? 'Uploading…' : 'Add PDF'}</span>
            <span className="block text-xs">Click or drop files, up to {MAX_MB} MB each</span>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
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
            No sources yet. Add a PDF and Folio will index it so you can ask questions about it.
          </p>
        ) : (
          <ul className="space-y-1">
            {docs.map((doc) => (
              <SourceRow
                key={doc.id}
                doc={doc}
                active={doc.id === activeDocumentId}
                onOpen={() => onOpen(doc)}
                onDelete={() => removeDoc(doc)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
