import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { ApiError } from '../../api/client'
import { keys, useClearMessages, useMessages } from '../../api/queries'
import { streamChat } from '../../api/stream'
import type { Message, Source } from '../../api/types'
import { segmentAnswer, stripPartialMarker } from '../../lib/citations'
import { AlertIcon, RetryIcon, SendIcon, StopIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { Button, IconButton, Spinner, cx } from '../ui/primitives'
import AnswerText, { CitationChip } from './AnswerText'

const STARTERS = [
  'Summarize these sources in a few paragraphs',
  'What are the key points or findings?',
  'What questions do these sources leave open?',
]

type Pending = {
  question: string
  text: string
  error: ApiError | null
  /** Seconds left before a rate-limited retry is allowed. */
  wait: number
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-sunken px-4 py-2.5 [overflow-wrap:anywhere]">{text}</p>
    </div>
  )
}

function AssistantMessage({
  content,
  sources,
  streaming,
  onOpen,
}: {
  content: string
  sources: Source[] | null
  streaming?: boolean
  onOpen: (source: Source) => void
}) {
  const { segments, citations } = segmentAnswer(content, sources)
  const listed = citations.filter((c) => c.source)
  return (
    <div className="max-w-[68ch]">
      <AnswerText segments={segments} onOpen={onOpen} streaming={streaming} />
      {listed.length > 0 && (
        <ol className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
          {listed.map((c) => (
            <li key={c.n} className="flex items-baseline gap-2">
              <CitationChip citation={c} onOpen={onOpen} />
              <button
                type="button"
                onClick={() => onOpen(c.source!)}
                className="min-w-0 truncate text-left text-muted hover:text-ink hover:underline"
              >
                {c.source!.filename}, page {c.source!.page_number}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function ChatPanel({
  notebookId,
  readyCount,
  processingCount,
  onOpenSource,
}: {
  notebookId: string
  readyCount: number
  processingCount: number
  onOpenSource: (source: Source) => void
}) {
  const messages = useMessages(notebookId)
  const clear = useClearMessages(notebookId)
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)

  const streaming = !!pending && !pending.error
  const canAsk = readyCount > 0 && !streaming

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
  }, [messages.data, pending?.text, pending?.error])

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q || streaming) return
    stickToBottom.current = true
    const controller = new AbortController()
    abort.current = controller
    setPending({ question: q, text: '', error: null, wait: 0 })

    await streamChat(
      notebookId,
      q,
      {
        onToken: (text) => setPending((p) => p && { ...p, text: p.text + text }),
        onDone: (message: Message) => {
          qc.setQueryData<Message[]>(keys.messages(notebookId), (list = []) => {
            // The server stored the question too; mirror it locally unless it's already there (a retry).
            const last = list.at(-1)
            const hasQuestion = last?.role === 'user' && last.content === q
            const question: Message = { id: `local-${message.id}`, role: 'user', content: q, sources: [], created_at: message.created_at }
            return [...list, ...(hasQuestion ? [] : [question]), message]
          })
          qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
          setPending(null)
        },
        onError: (error) => setPending((p) => p && { ...p, error, wait: error.retryAfter ?? 0 }),
      },
      controller.signal,
    )
    if (controller.signal.aborted) {
      // Stopped by the user: the server kept the question; resync so history matches.
      setPending(null)
      void qc.invalidateQueries({ queryKey: keys.messages(notebookId) })
    }
  }

  const submit = () => {
    if (!canAsk || !draft.trim()) return
    const q = draft
    setDraft('')
    void ask(q)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  // Auto-grow the composer up to ~8 lines.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

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

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6">
        <h2 className="font-serif text-lg font-semibold">Chat</h2>
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
              <h3 className="font-serif text-2xl font-semibold tracking-tight">
                {readyCount > 0 ? 'Ask about your sources' : 'Add a source to begin'}
              </h3>
              <p className="mt-2 max-w-md text-muted">
                {readyCount > 0
                  ? 'Answers are written only from your PDFs. Each claim is marked so you can open the exact page it came from.'
                  : processingCount > 0
                    ? 'Your PDF is being indexed. You can ask questions as soon as it’s ready.'
                    : 'Upload a PDF from the Sources panel. Once it’s indexed you can ask questions about it here.'}
              </p>
              {readyCount > 0 && (
                <div className="mt-6 flex flex-col items-start gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask(s)}
                      className="rounded-md border border-line bg-surface px-3.5 py-2 text-left text-sm transition-colors hover:border-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            shown.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} text={m.content} />
              ) : (
                <AssistantMessage key={m.id} content={m.content} sources={m.sources} onOpen={onOpenSource} />
              ),
            )
          )}

          {pending && (
            <>
              <UserBubble text={pending.question} />
              {(pending.text || !pending.error) && (
                <AssistantMessage
                  content={stripPartialMarker(pending.text)}
                  sources={null}
                  streaming={!pending.error}
                  onOpen={onOpenSource}
                />
              )}
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
                    onClick={() => void ask(pending.question)}
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

      <div className="shrink-0 border-t border-line bg-paper px-4 py-3 sm:px-6">
        <div
          className={cx(
            'mx-auto flex max-w-3xl items-end gap-2 rounded-lg border bg-surface p-2 transition-colors focus-within:border-ink',
            canAsk ? 'border-line-strong' : 'border-line',
          )}
        >
          <textarea
            ref={textarea}
            rows={1}
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={readyCount === 0}
            placeholder={readyCount > 0 ? 'Ask about your sources…' : 'Add a ready source to start asking'}
            aria-label="Your question"
            className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-faint disabled:cursor-not-allowed"
          />
          {streaming ? (
            <IconButton label="Stop generating" onClick={() => abort.current?.abort()} className="size-9 bg-sunken">
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton
              label="Send question"
              onClick={submit}
              disabled={!canAsk || !draft.trim()}
              className="size-9 bg-ink text-paper hover:bg-ink hover:text-paper hover:opacity-90"
            >
              <SendIcon />
            </IconButton>
          )}
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl px-1 text-xs text-faint">
          Enter to send, Shift+Enter for a new line. Answers can be wrong — check the cited pages.
        </p>
      </div>
    </section>
  )
}
