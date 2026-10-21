import { useThreadMessages, useThreads } from '../api/queries'
import { useWorkspace } from './workspace'

/**
 * The chat thread the workspace shows: the one the user picked, else the most
 * recently used. threadId is null before the notebook's first question (the
 * server creates the thread then).
 */
export function useActiveThread(notebookId: string) {
  const threads = useThreads(notebookId)
  const chosen = useWorkspace((s) => s.threadId)
  const list = threads.data ?? []
  const thread = list.find((t) => t.id === chosen) ?? list[0] ?? null
  const messages = useThreadMessages(thread?.id ?? null)
  return {
    threads: list,
    thread,
    threadId: thread?.id ?? null,
    messages: messages.data ?? [],
    isPending: threads.isPending || (!!thread && messages.isPending),
    error: threads.error ?? messages.error,
  }
}
