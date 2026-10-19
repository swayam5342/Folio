import { useQueryClient } from '@tanstack/react-query'
import { Activity, BookmarkPlus, ListTree, RefreshCw, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../../api/client'
import { deleteMessage, keys, useCreateNote } from '../../api/queries'
import { streamChat } from '../../api/stream'
import type { ChatStage, Message, RetrievalEvent, Source, SourceDocument } from '../../api/types'
import { answerToPlainText, prepareAnswer, stripPartialMarker } from '../../lib/citations'
import { spring } from '../../lib/motion'
import { questionTerms } from '../../lib/terms'
import { useSourceColors } from '../../lib/useSourceColors'
import { useActiveThread } from '../../lib/useActiveThread'
import { useWorkspace } from '../../lib/workspace'
import { AlertIcon, RetryIcon } from '../ui/icons'
import { useToast } from '../ui/overlay'
import { Button, Spinner, cx } from '../ui/primitives'
import AnswerText, { CopyButton } from './AnswerText'
import { CitationChip, type OpenSource } from './CitationChip'
import Composer from './Composer'
import PipelineTheater from './PipelineTheater'
import { ConfidenceBadge } from './RetrievalInspector'
import ThreadBar from './ThreadBar'
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

/** The answer as plain text with its numbered sources listed underneath, for the clipboard. */
function copyText(markdown: string, citations: { n: number; source?: Source | null }[]): string {
  const listed = citations.filter((c) => c.source)
  const body = answerToPlainText(markdown).trim()
  if (!listed.length) return body
  return `${body}\n\nSources:\n${listed.map((c) => `[${c.n}] ${sourceLabel(c.source!)}`).join('\n')}`
}

function AssistantMessage({
  message,
  content,
  sources,
  streaming,
  terms,
  onOpen,
  onRegenerate,
  onSaveNote,
}: {
  /** The stored answer; absent while streaming. */
  message?: Message
  content: string
  sources: Source[] | null
  streaming?: boolean
  terms: string[]
  onOpen: OpenSource
  /** Offered on the latest answer only. */
  onRegenerate?: () => void
  onSaveNote?: () => void
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
          <CopyButton label="Copy answer" text={() => copyText(markdown, citations)} />
          {onSaveNote && !abstained && (
            <button
              type="button"
              onClick={onSaveNote}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              <BookmarkPlus aria-hidden size={13} /> Save to notes
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              <RefreshCw aria-hidden size={13} /> Regenerate
            </button>
          )}
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

/** Up to four suggested questions, taken in turn from each source so every source is represented. */
function suggestedQuestions(docs: SourceDocument[]): string[] {
  const lists = docs.map((d) => d.suggested_questions ?? []).filter((l) => l.length)
  const out: string[] = []
  for (let i = 0; out.length < 4 && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < 4) out.push(l[i])
  }
  return out
}

/** "What's in this notebook": each source's summary, shown before the first question. */
function NotebookOverview({ docs }: { docs: SourceDocument[] }) {
  const colors = useSourceColors(docs[0]?.notebook_id ?? '')
  const summarized = docs.filter((d) => d.summary)
  const pending = docs.some((d) => d.summary_status === 'pending')
  if (!summarized.length && !pending) return null
  return (
    <div className="mt-6 rounded-lg border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        <Sparkles aria-hidden size={13} /> Notebook overview
      </p>
      <ul className="mt-3 space-y-3">
        {summarized.map((d) => (
          <li key={d.id} className="line-clamp-2 text-sm leading-relaxed" title={d.summary ?? undefined}>
            <span
              className="mr-1.5 inline-block size-2 rounded-full align-middle"
              style={{ background: `var(--src-${colors.get(d.id) ?? 1})` }}
              aria-hidden
            />
            <span className="font-medium">{d.filename}</span>
            <span className="text-muted"> — {d.summary}</span>
          </li>
        ))}
      </ul>
      {pending && <p className={cx('text-xs italic text-faint', summarized.length > 0 && 'mt-3')}>Summarizing new sources…</p>}
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
  const active = useActiveThread(notebookId)
  const setThread = useWorkspace((s) => s.setThread)
  const createNote = useCreateNote(notebookId)
  const colors = useSourceColors(notebookId)
  const openSource = useWorkspace((s) => s.openSource)
  const qc = useQueryClient()
  const toast = useToast()

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
  }, [active.messages, pending?.text, pending?.error, pending?.stage, pending?.retrieval])

  const threadId = active.threadId
  const ask = async (question: string, scope: string[] | null, regenerate = false) => {
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
          const target = message.thread_id ?? threadId ?? 'none'
          qc.setQueryData<Message[]>(keys.threadMessages(target), (list = []) => {
            // The server stored the question too; mirror it locally unless it's already there (a retry).
            const last = list.at(-1)
            const hasQuestion = last?.role === 'user' && last.content === q
            const asked: Message = { id: `local-${message.id}`, role: 'user', content: q, sources: [], created_at: message.created_at }
            return [...list, ...(hasQuestion ? [] : [asked]), message]
          })
          qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
          // A new chat gets its title from the first question; the order changes too.
          void qc.invalidateQueries({ queryKey: keys.threads(notebookId) })
          if (message.thread_id && message.thread_id !== threadId) setThread(message.thread_id)
          setPending(null)
        },
        onError: (error) => setPending((p) => p && { ...p, error, wait: error.retryAfter ?? 0 }),
      },
      controller.signal,
      scope,
      { threadId, regenerate },
    )
    if (controller.signal.aborted) {
      // Stopped by the user: the server kept the question; resync so history matches.
      setPending(null)
      void qc.invalidateQueries({ queryKey: ['threads'] })
      void qc.invalidateQueries({ queryKey: keys.threads(notebookId) })
    }
  }

  /** Replace the latest answer with a freshly written one (skipping the answer cache). */
  const regenerate = async (answer: Message, question: string) => {
    if (streaming || !threadId) return
    try {
      await deleteMessage(answer.id)
    } catch (e) {
      toast((e as Error).message, 'error')
      return
    }
    qc.setQueryData<Message[]>(keys.threadMessages(threadId), (list = []) => list.filter((m) => m.id !== answer.id))
    void ask(question, documentIds, true)
  }

  const saveNote = (answer: Message, question: string) =>
    createNote.mutate(
      { title: question.slice(0, 200) || 'Saved answer', content: answer.content, sources: answer.sources },
      {
        onSuccess: () => toast('Saved to notes'),
        onError: (e) => toast(e.message, 'error'),
      },
    )

  const history = active.messages
  // While a retry is pending, the stored unanswered question is shown by the pending block instead.
  const shown =
    pending && history.at(-1)?.role === 'user' && history.at(-1)?.content === pending.question
      ? history.slice(0, -1)
      : history
  const empty = shown.length === 0 && !pending
  const lastAnswer = [...shown].reverse().find((m) => m.role === 'assistant')
  const suggestions = suggestedQuestions(readyDocs)
  const noneSelected = documentIds !== null && documentIds.length === 0

  // Each answer highlights the words of the question before it.
  let lastQuestion = ''

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <div className="@container flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:px-6">
        {switcher}
        <ThreadBar
          notebookId={notebookId}
          threads={active.threads}
          thread={active.thread}
          hasMessages={history.length > 0}
          busy={streaming}
        />
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
          {active.isPending ? (
            <div className="text-muted">
              <Spinner />
            </div>
          ) : active.error ? (
            <p className="text-danger">{active.error.message}</p>
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
                  {(suggestions.length ? suggestions : STARTERS).map((s, i) => (
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
              {readyCount > 0 && <NotebookOverview docs={readyDocs} />}
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
                  onSaveNote={((q) => () => saveNote(m, q))(lastQuestion)}
                  onRegenerate={
                    m === lastAnswer && !pending && !m.id.startsWith('local-')
                      ? ((q) => () => void regenerate(m, q))(lastQuestion)
                      : undefined
                  }
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
