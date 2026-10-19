import { BookOpen, Command, FileText, Files, MessageSquare, PanelLeft, PanelRight } from 'lucide-react'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import { Link, useParams } from 'react-router'

import { ApiError } from '../api/client'
import { useDocuments, useNotebook } from '../api/queries'
import AppHeader from '../components/AppHeader'
import { ChevronLeft } from '../components/ui/icons'
import { IconButton, Spinner, cx } from '../components/ui/primitives'
import ChatPanel from '../components/workspace/ChatPanel'
import RightPane from '../components/workspace/RightPane'
import SourcesPanel from '../components/workspace/SourcesPanel'
import StudyPanel from '../components/workspace/StudyPanel'
import { SourceColorsContext, useSourceColors } from '../lib/useSourceColors'
import { useWorkspace, type MobileTab } from '../lib/workspace'

function ModeSwitch() {
  const center = useWorkspace((s) => s.center)
  const setCenter = useWorkspace((s) => s.setCenter)
  return (
    <div className="inline-flex rounded-md border border-line-strong p-0.5" role="tablist" aria-label="Chat or study">
      {(['chat', 'study'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={center === m}
          onClick={() => setCenter(m)}
          className={cx(
            'h-7 rounded px-3 font-serif text-[15px] font-semibold capitalize transition-colors',
            center === m ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

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

/** Keeps a collapsible panel in step with an open/closed flag in the store, both ways. */
function useCollapsible(ref: RefObject<PanelImperativeHandle | null>, open: boolean) {
  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    if (open && panel.isCollapsed()) panel.expand()
    if (!open && !panel.isCollapsed()) panel.collapse()
  }, [ref, open])
}

const LAYOUT_STORAGE = (() => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
})()

const MOBILE_TABS: { id: MobileTab; label: string; Icon: typeof Files }[] = [
  { id: 'sources', label: 'Sources', Icon: Files },
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'side', label: 'Viewer', Icon: FileText },
  { id: 'study', label: 'Study', Icon: BookOpen },
]

function Workspace({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId)
  const documents = useDocuments(notebookId)
  const colors = useSourceColors(notebookId)
  const wide = useIsWide()
  const ws = useWorkspace()
  const { reset, center, excluded, rightOpen, sourcesOpen, mobileTab } = ws

  useEffect(() => reset(notebookId), [notebookId, reset])

  const docs = documents.data ?? []
  const readyDocs = useMemo(() => (documents.data ?? []).filter((d) => d.status === 'ready'), [documents.data])
  const processingCount = docs.filter((d) => d.status === 'processing').length
  // null = search every ready source (no filter sent); otherwise the ticked ready sources.
  const chatDocumentIds = useMemo(
    () => (readyDocs.some((d) => excluded.has(d.id)) ? readyDocs.filter((d) => !excluded.has(d.id)).map((d) => d.id) : null),
    [readyDocs, excluded],
  )

  const sourcesRef = usePanelRef()
  const rightRef = usePanelRef()
  useCollapsible(sourcesRef, sourcesOpen)
  useCollapsible(rightRef, rightOpen)
  const layout = useDefaultLayout({ id: 'folio-workspace', storage: LAYOUT_STORAGE, onlySaveAfterUserInteractions: true })

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

  const sources = <SourcesPanel notebookId={notebookId} />
  const switcher = <ModeSwitch />
  // Both stay mounted so a streaming answer or an open quiz survives switching.
  const centerPane = (
    <>
      <div className={cx('h-full', center !== 'chat' && 'hidden')}>
        <ChatPanel
          notebookId={notebookId}
          readyDocs={readyDocs}
          processingCount={processingCount}
          documentIds={chatDocumentIds}
          switcher={switcher}
        />
      </div>
      <div className={cx('h-full', center !== 'study' && 'hidden')}>
        <StudyPanel notebookId={notebookId} switcher={switcher} />
      </div>
    </>
  )

  return (
    <SourceColorsContext.Provider value={colors}>
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
            <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
              <button
                type="button"
                onClick={() => ws.setPaletteOpen(true)}
                className="hidden h-8 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
              >
                <Command aria-hidden size={13} /> Commands
                <kbd className="rounded bg-sunken px-1 font-mono text-[10px]">Ctrl K</kbd>
              </button>
              {wide && (
                <>
                  <IconButton
                    label={sourcesOpen ? 'Hide sources' : 'Show sources'}
                    aria-pressed={sourcesOpen}
                    onClick={() => ws.setSourcesOpen(!sourcesOpen)}
                  >
                    <PanelLeft size={17} />
                  </IconButton>
                  <IconButton
                    label={rightOpen ? 'Hide viewer and inspector' : 'Show viewer and inspector'}
                    aria-pressed={rightOpen}
                    onClick={() => ws.setRightOpen(!rightOpen)}
                  >
                    <PanelRight size={17} />
                  </IconButton>
                </>
              )}
            </div>
          </div>
        </AppHeader>

        {wide ? (
          <Group
            orientation="horizontal"
            id="folio-workspace"
            className="min-h-0 flex-1"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
          >
            <Panel
              id="sources"
              panelRef={sourcesRef}
              defaultSize="22%"
              minSize="15%"
              maxSize="35%"
              collapsible
              collapsedSize="0%"
              onResize={(size) => ws.setSourcesOpen(size.asPercentage > 0)}
            >
              <aside className="h-full border-r border-line">{sources}</aside>
            </Panel>
            <Separator className="pane-handle" />
            <Panel id="center" minSize="30%">
              <main className="h-full min-w-0">{centerPane}</main>
            </Panel>
            <Separator className="pane-handle" />
            <Panel
              id="right"
              panelRef={rightRef}
              defaultSize="38%"
              minSize="24%"
              collapsible
              collapsedSize="0%"
              onResize={(size) => ws.setRightOpen(size.asPercentage > 0)}
            >
              <aside className="h-full border-l border-line">
                <RightPane notebookId={notebookId} docs={docs} onCollapse={() => ws.setRightOpen(false)} />
              </aside>
            </Panel>
          </Group>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              {/* Chat and study stay mounted so a streaming answer survives tab switches. */}
              <div className={cx('h-full', mobileTab !== 'sources' && 'hidden')}>{sources}</div>
              <div className={cx('h-full', mobileTab !== 'chat' && mobileTab !== 'study' && 'hidden')}>{centerPane}</div>
              {mobileTab === 'side' && <RightPane notebookId={notebookId} docs={docs} />}
            </div>
            <nav
              aria-label="Workspace sections"
              className="flex shrink-0 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
            >
              {MOBILE_TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => ws.setMobileTab(id)}
                  aria-current={mobileTab === id ? 'page' : undefined}
                  className={cx(
                    'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                    mobileTab === id ? 'text-ink' : 'text-muted',
                  )}
                >
                  <Icon aria-hidden size={19} strokeWidth={mobileTab === id ? 2.2 : 1.8} />
                  {id === 'sources' && docs.length ? `${label} (${docs.length})` : label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </SourceColorsContext.Provider>
  )
}

export default function WorkspacePage() {
  const { notebookId } = useParams()
  // Keyed so switching notebooks resets all panel state.
  return <Workspace key={notebookId} notebookId={notebookId!} />
}
