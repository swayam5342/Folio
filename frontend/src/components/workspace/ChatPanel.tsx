import { useQueryClient } from '@tanstack/react-query'
import { Activity, ListTree } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../../api/client'
import { keys, useClearMessages, useMessages } from '../../api/queries'
import { streamChat } from '../../api/stream'
import type { ChatStage, Message, RetrievalEvent, Source, SourceDocument } from '../../api/types'
import { answerToPlainText, prepareAnswer, stripPartialMarker } from '../../lib/citations'
import { spring } from '../../lib/motion'
import { questionTerms } from '../../lib/terms'
import { useSourceColors } from '../../lib/useSourceColors'
import { useWorkspace } from '../../lib/workspace'
import { AlertIcon, RetryIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { Button, Spinner } from '../ui/primitives'
import AnswerText, { CopyButton } from './AnswerText'
import { CitationChip, type OpenSource } from './CitationChip'
import Composer from './Composer'
import PipelineTheater from './PipelineTheater'
import { ConfidenceBadge } from './RetrievalInspector'
import { isPaged, sourceLabel } from '../../lib/sourceLocation'

const STARTERS = [
  'Summarize these sources in a few paragraphs',
  'What are the key points or findings?',
  'What questions do these sources leave open?',
]

type Pending = {
  question: string
  documentIds: string[] | null
  text: string
  stage: ChatStage | null
  timings: Record<string, number>
  retrieval: RetrievalEvent | null
  error: ApiError | null
  /** Seconds left before a rate-limited retry is allowed. */
  wait: number
}

function UserBubble({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.gentle} className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-sunken px-4 py-2.5 [overflow-wrap:anywhere]">{text}</p>
    </motion.div>
  )
}

function NearestExcerpts({ sources, onOpen }: { sources: Source[]; onOpen: OpenSource }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Closest passages</h4>
      <ul className="mt-2 space-y-2">
        {sources.map((s) => (
          <li key={s.chunk_id}>
            <button
              type="button"
              onClick={() => onOpen(s)}
              className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-line-strong"
            >
              <span className="block font-medium">
                {sourceLabel(s)}
                {s.section_title && isPaged(s) && <span className="font-normal text-muted"> · {s.section_title}</span>}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-muted">{s.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AssistantMessage({
  message,
  content,
  sources,
  streaming,
  terms,
  onOpen,
}: {
  /** The stored answer; absent while streaming. */
  message?: Message
  content: string
  sources: Source[] | null
  streaming?: boolean
  terms: string[]
  onOpen: OpenSource
}) {
  const inspect = useWorkspace((s) => s.inspect)
  const abstained = !!message?.abstained
  const { markdown, citations } = prepareAnswer(content, abstained ? [] : sources)
  const listed = citations.filter((c) => c.source)
  const lowSupport = listed.filter((c) => c.source?.support === 'low').length
  return (
    <div className="min-w-0 max-w-[72ch]">
      <AnswerText markdown={markdown} citations={citations} onOpen={onOpen} streaming={streaming} terms={terms} />
      {abstained && message.sources.length > 0 && <NearestExcerpts sources={message.sources} onOpen={onOpen} />}
      {listed.length > 0 && (
        <ol className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
          {listed.map((c) => (
            <li key={c.n} className="flex items-baseline gap-2">
              <CitationChip citation={c} onOpen={onOpen} terms={terms} />
              <button
                type="button"
                onClick={() => onOpen(c.source!)}
                className="min-w-0 truncate text-left text-muted hover:text-ink hover:underline"
              >
                {sourceLabel(c.source!)}
                {c.source!.section_title && isPaged(c.source!) && <span className="text-faint"> · {c.source!.section_title}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
      {!streaming && markdown.trim() && (
        <div className="mt-2 -ml-2 flex flex-wrap items-center gap-1">
          <CopyButton label="Copy answer" text={() => answerToPlainText(markdown)} />
          {message?.confidence && (
            <>
              <span className="mx-1">
                <ConfidenceBadge level={message.confidence} />
              </span>
              <button
                type="button"
                onClick={() => inspect(message.id)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
              >
                <Activity aria-hidden size={13} /> How was this answered?
              </button>
              {listed.length > 0 && (
                <button
                  type="button"
                  onClick={() => inspect(message.id, 'citations')}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
                >
                  <ListTree aria-hidden size={13} /> Citations
                  {lowSupport > 0 && <span className="rounded-full bg-warn-soft px-1.5 text-warn">{lowSupport} low support</span>}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatPanel({
  notebookId,
  readyDocs,
  processingCount,
  documentIds,
  switcher,
}: {
  notebookId: string
  readyDocs: SourceDocument[]
  processingCount: number
  /** Sources the user ticked, or null to search all of them. */
  documentIds: string[] | null
  /** Chat | Study switch shown in place of the panel title. */
  switcher: ReactNode
}) {
  const messages = useMessages(notebookId)
  const clear = useClearMessages(notebookId)
  const colors = useSourceColors(notebookId)
  const openSource = useWorkspace((s) => s.openSource)
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [pending, setPending] = useState<Pending | null>(null)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const readyCount = readyDocs.length
  const streaming = !!pending && !pending.error

  // Abort an in-flight answer when leaving the notebook.
  useEffect(() => () => abort.current?.abort(), [notebookId])

  // Rate-limit countdown.
  useEffect(() => {
    if (!pending?.error || pending.wait <= 0) return
    const t = window.setTimeout(() => setPending((p) => p && { ...p, wait: p.wait - 1 }), 1000)
    return () => window.clearTimeout(t)
  }, [pending])

  // Follow the stream unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.data, pending?.text, pending?.error, pending?.stage, pending?.retrieval])

  const ask = async (question: string, scope: string[] | null) => {
    const q = question.trim()
    if (!q || streaming) return
    stickToBottom.current = true
    const controller = new AbortController()
    abort.current = controller
    setPending({ question: q, documentIds: scope, text: '', stage: null, timings: {}, retrieval: null, error: null, wait: 0 })

    await streamChat(
      notebookId,
      q,
      {
        onStage: (stage, timings) => setPending((p) => p && { ...p, stage, timings }),
        onRetrieval: (retrieval) => setPending((p) => p && { ...p, retrieval, timings: retrieval.timings_ms }),
        onToken: (text) => setPending((p) => p && { ...p, text: p.text + text }),
        onReplace: (text) => setPending((p) => p && { ...p, text }),
        onDone: (message: Message) => {
          qc.setQueryData<Message[]>(keys.messages(notebookId), (list = []) => {
            // The server stored the question too; mirror it locally unless it's already there (a retry).
            const last = list.at(-1)
            const hasQuestion = last?.role === 'user' && last.content === q
            const asked: Message = { id: `local-${message.id}`, role: 'user', content: q, sources: [], created_at: message.created_at }
            return [...list, ...(hasQuestion ? [] : [asked]), message]
          })
          qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
          setPending(null)
        },
        onError: (error) => setPending((p) => p && { ...p, error, wait: error.retryAfter ?? 0 }),
      },
      controller.signal,
      scope,
    )
    if (controller.signal.aborted) {
      // Stopped by the user: the server kept the question; resync so history matches.
      setPending(null)
      void qc.invalidateQueries({ queryKey: keys.messages(notebookId) })
    }
  }

  const clearChat = async () => {
    const ok = await confirm({
      title: 'Clear this chat?',
      body: 'All questions and answers in this notebook will be deleted. Your sources stay.',
      confirmLabel: 'Clear chat',
      danger: true,
    })
    if (ok) clear.mutate(undefined, { onError: (e) => toast(e.message, 'error') })
  }

  const history = messages.data ?? []
  // While a retry is pending, the stored unanswered question is shown by the pending block instead.
  const shown =
    pending && history.at(-1)?.role === 'user' && history.at(-1)?.content === pending.question
      ? history.slice(0, -1)
      : history
  const empty = shown.length === 0 && !pending
  const noneSelected = documentIds !== null && documentIds.length === 0

  // Each answer highlights the words of the question before it.
  let lastQuestion = ''

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6">
        {switcher}
        {history.length > 0 && (
          <Button variant="ghost" className="h-8 px-2.5" onClick={clearChat} disabled={streaming}>
            Clear chat
          </Button>
        )}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-7 px-4 py-6 sm:px-6">
          {messages.isPending ? (
            <div className="text-muted">
              <Spinner />
            </div>
          ) : messages.isError ? (
            <p className="text-danger">{messages.error.message}</p>
          ) : empty ? (
            <div className="py-6">
              <h3 className="font-display text-3xl font-semibold tracking-tight">
                {readyCount > 0 ? 'Ask about your sources' : 'Add a source to begin'}
              </h3>
              <p className="mt-2 max-w-md text-muted">
                {readyCount > 0
                  ? 'Answers are written only from your sources. Each claim is marked so you can open the exact passage it came from.'
                  : processingCount > 0
                    ? 'Your source is being indexed. You can ask questions as soon as it’s ready.'
                    : 'Add a source from the Sources panel (PDF, Word, PowerPoint, Markdown, text, or pasted text). Once it’s indexed you can ask questions about it here.'}
              </p>
              {readyCount > 0 && (
                <div className="mt-6 flex flex-col items-start gap-2">
                  {STARTERS.map((s, i) => (
                    <motion.button
                      key={s}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring.gentle, delay: 0.05 * i }}
                      disabled={noneSelected}
                      onClick={() => void ask(s, documentIds)}
                      className="rounded-md border border-line bg-surface px-3.5 py-2 text-left text-sm transition-colors hover:border-ink disabled:opacity-50"
                    >
                      {s}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            shown.map((m) => {
              if (m.role === 'user') {
                lastQuestion = m.content
                return <UserBubble key={m.id} text={m.content} />
              }
              return (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  content={m.content}
                  sources={m.sources}
                  terms={questionTerms(lastQuestion)}
                  onOpen={openSource}
                />
              )
            })
          )}

          {pending && (
            <>
              <UserBubble text={pending.question} />
              <div className="min-w-0 max-w-[72ch]">
                {!pending.error && (
                  <PipelineTheater
                    stage={pending.stage}
                    timings={pending.timings}
                    retrieval={pending.retrieval}
                    colors={colors}
                    writing={!!pending.text}
                  />
                )}
                {pending.text && (
                  <AssistantMessage
                    content={stripPartialMarker(pending.text)}
                    sources={null}
                    streaming={!pending.error}
                    terms={questionTerms(pending.question)}
                    onOpen={openSource}
                  />
                )}
              </div>
              {pending.error && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm">
                  <AlertIcon className="shrink-0 text-danger" />
                  <span className="min-w-0 flex-1 text-ink">
                    {pending.error.status === 0 && pending.text
                      ? 'Response interrupted before it finished.'
                      : pending.error.message}
                  </span>
                  <Button
                    className="h-8"
                    disabled={pending.wait > 0}
                    onClick={() => void ask(pending.question, pending.documentIds)}
                  >
                    <RetryIcon size={15} />
                    {pending.wait > 0 ? `Retry in ${pending.wait}s` : 'Retry'}
                  </Button>
                  <Button variant="ghost" className="h-8" onClick={() => setPending(null)}>
                    Dismiss
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Composer
        notebookId={notebookId}
        readyDocs={readyDocs}
        selectedIds={documentIds}
        streaming={streaming}
        disabledReason={readyCount === 0 ? (processingCount > 0 ? 'Your source is still being indexed…' : 'Add a ready source to start asking') : null}
        onAsk={(question, scope) => void ask(question, scope)}
        onStop={() => abort.current?.abort()}
      />
    </section>
  )
}
