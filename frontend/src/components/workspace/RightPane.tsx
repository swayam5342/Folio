import { Activity, FileText, ListTree, PanelRightClose } from 'lucide-react'
import { lazy, Suspense } from 'react'

import { useMessages } from '../../api/queries'
import type { SourceDocument } from '../../api/types'
import { useSourceColors } from '../../lib/useSourceColors'
import { useWorkspace, type RightTab } from '../../lib/workspace'
import ErrorBoundary from '../ErrorBoundary'
import { IconButton, Spinner, cx } from '../ui/primitives'
import CitationsPanel from './CitationsPanel'
import RetrievalInspector from './RetrievalInspector'

// pdf.js is large; load it only when a document is first opened.
const PdfViewer = lazy(() => import('./PdfViewer'))

const TABS: { id: RightTab; label: string; Icon: typeof FileText }[] = [
  { id: 'viewer', label: 'Viewer', Icon: FileText },
  { id: 'inspector', label: 'Inspector', Icon: Activity },
  { id: 'citations', label: 'Citations', Icon: ListTree },
]

/** Right-hand pane: the PDF viewer, the Retrieval Inspector and the Citations list. */
export default function RightPane({
  notebookId,
  docs,
  onCollapse,
}: {
  notebookId: string
  docs: SourceDocument[]
  /** Hide the pane (wide layout); absent on mobile, where the bottom bar switches panes. */
  onCollapse?: () => void
}) {
  const { rightTab, setRightTab, viewer, closeViewer, inspectedId, beam, openSource } = useWorkspace()
  const messages = useMessages(notebookId)
  const colors = useSourceColors(notebookId)

  // Inspector and Citations follow the chosen answer, else the latest one that has a trace.
  const answers = (messages.data ?? []).filter((m) => m.role === 'assistant')
  const latest = [...answers].reverse().find((m) => m.confidence) ?? answers.at(-1) ?? null
  const message = (inspectedId && answers.find((m) => m.id === inspectedId)) || latest
  const traceId = message?.confidence ? message.id : null

  return (
    <section aria-label="Viewer and inspector" className="flex h-full min-h-0 flex-col bg-paper">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
        <div role="tablist" aria-label="Right pane" className="flex flex-1 items-center gap-0.5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`right-tab-${id}`}
              aria-selected={rightTab === id}
              aria-controls={`right-panel-${id}`}
              onClick={() => setRightTab(id)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                rightTab === id ? 'bg-sunken text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <Icon aria-hidden size={15} />
              {label}
            </button>
          ))}
        </div>
        {onCollapse && (
          <IconButton label="Hide pane" onClick={onCollapse}>
            <PanelRightClose size={17} />
          </IconButton>
        )}
      </div>

      <div
        role="tabpanel"
        id={`right-panel-${rightTab}`}
        aria-labelledby={`right-tab-${rightTab}`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {rightTab === 'viewer' ? (
          viewer ? (
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
                <PdfViewer
                  target={viewer}
                  document={docs.find((d) => d.id === viewer.documentId)}
                  color={colors.get(viewer.documentId) ?? 1}
                  beamFrom={beam && beam.nonce === viewer.nonce ? beam : null}
                  onClose={closeViewer}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <FileText aria-hidden size={28} className="text-faint" />
              <p className="font-medium">No page open</p>
              <p className="max-w-xs text-sm text-muted">Click a citation in an answer, or a source on the left, to read it here.</p>
            </div>
          )
        ) : rightTab === 'inspector' ? (
          <RetrievalInspector messageId={traceId} onOpen={openSource} />
        ) : (
          <CitationsPanel message={message} onOpen={openSource} />
        )}
      </div>
    </section>
  )
}
