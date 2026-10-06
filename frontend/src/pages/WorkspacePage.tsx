import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { ApiError } from '../api/client'
import { useDocuments, useNotebook } from '../api/queries'
import type { Source, SourceDocument, ViewerTarget } from '../api/types'
import AppHeader from '../components/AppHeader'
import ErrorBoundary from '../components/ErrorBoundary'
import { ChevronLeft } from '../components/ui/icons'
import { useToast } from '../components/ui/overlay'
import { Spinner, cx } from '../components/ui/primitives'
import ChatPanel from '../components/workspace/ChatPanel'
import SourcesPanel from '../components/workspace/SourcesPanel'

// pdf.js is large; load it only when a document is first opened.
const PdfViewer = lazy(() => import('../components/workspace/PdfViewer'))

type Tab = 'sources' | 'chat' | 'viewer'

function useIsWide() {
  const query = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setWide(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return wide
}

function Workspace({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId)
  const documents = useDocuments(notebookId)
  const toast = useToast()
  const wide = useIsWide()
  const [tab, setTab] = useState<Tab>('chat')
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)

  const docs = documents.data ?? []
  const readyCount = docs.filter((d) => d.status === 'ready').length
  const processingCount = docs.filter((d) => d.status === 'processing').length

  const open = useCallback(
    (target: Omit<ViewerTarget, 'nonce'>) => {
      setViewer({ ...target, nonce: Date.now() })
      setTab('viewer')
    },
    [],
  )

  const openSource = (source: Source) => {
    if (!docs.some((d) => d.id === source.document_id)) {
      toast('That source was removed from this notebook.', 'error')
      return
    }
    open({ documentId: source.document_id, page: source.page_number, snippet: source.snippet })
  }
  const openDocument = (doc: SourceDocument) => open({ documentId: doc.id, page: 1 })
  const closeViewer = () => {
    setViewer(null)
    setTab('chat')
  }

  if (notebook.isError) {
    const missing = notebook.error instanceof ApiError && notebook.error.status === 404
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-serif text-2xl font-semibold">{missing ? 'Notebook not found' : 'Couldn’t open notebook'}</h1>
        <p className="mt-2 text-muted">
          {missing ? 'It may have been deleted, or it belongs to another account.' : notebook.error.message}
        </p>
        <Link to="/" className="mt-6 inline-block font-medium underline underline-offset-4">
          Back to notebooks
        </Link>
      </div>
    )
  }

  const sources = (
    <SourcesPanel
      notebookId={notebookId}
      activeDocumentId={viewer?.documentId ?? null}
      onOpen={openDocument}
      onRemoved={(id) => viewer?.documentId === id && closeViewer()}
    />
  )
  const chat = (
    <ChatPanel
      notebookId={notebookId}
      readyCount={readyCount}
      processingCount={processingCount}
      onOpenSource={openSource}
    />
  )
  const pdf = viewer && (
    <ErrorBoundary
      key={viewer.nonce}
      fallback={() => (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-sunken px-6 text-center">
          <p className="font-medium">This PDF couldn’t be displayed.</p>
          <p className="text-sm text-muted">Try reloading the page. The cited text is still shown when you hover a citation.</p>
          <button type="button" onClick={closeViewer} className="text-sm font-medium underline underline-offset-4">
            Close viewer
          </button>
        </div>
      )}
    >
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-sunken text-muted">
          <Spinner size={22} />
        </div>
      }
    >
      <PdfViewer target={viewer} document={docs.find((d) => d.id === viewer.documentId)} onClose={closeViewer} />
    </Suspense>
    </ErrorBoundary>
  )

  return (
    <div className="flex h-full flex-col">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to="/"
            className="flex shrink-0 items-center rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
            aria-label="All notebooks"
            title="All notebooks"
          >
            <ChevronLeft />
          </Link>
          <h1 className="truncate font-serif text-lg font-semibold" title={notebook.data?.name}>
            {notebook.data?.name ?? <Spinner size={14} />}
          </h1>
        </div>
      </AppHeader>

      {wide ? (
        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 border-r border-line">{sources}</aside>
          <main className="min-w-0 flex-1">{chat}</main>
          {pdf && <aside className="w-[46%] max-w-[860px] shrink-0 border-l border-line">{pdf}</aside>}
        </div>
      ) : (
        <>
          <nav className="flex shrink-0 border-b border-line" aria-label="Workspace sections">
            {(['sources', 'chat', 'viewer'] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={t === 'viewer' && !viewer}
                onClick={() => setTab(t)}
                aria-current={tab === t ? 'page' : undefined}
                className={cx(
                  'flex-1 border-b-2 py-2.5 text-sm font-medium capitalize disabled:opacity-40',
                  tab === t ? 'border-ink text-ink' : 'border-transparent text-muted',
                )}
              >
                {t === 'sources' ? `Sources${docs.length ? ` (${docs.length})` : ''}` : t}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            {/* Chat stays mounted so a streaming answer survives tab switches. */}
            <div className={cx('h-full', tab !== 'sources' && 'hidden')}>{sources}</div>
            <div className={cx('h-full', tab !== 'chat' && 'hidden')}>{chat}</div>
            {tab === 'viewer' && pdf}
          </div>
        </>
      )}
    </div>
  )
}

export default function WorkspacePage() {
  const { notebookId } = useParams()
  // Keyed so switching notebooks resets all panel state.
  return <Workspace key={notebookId} notebookId={notebookId!} />
}
