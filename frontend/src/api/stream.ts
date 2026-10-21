import { ApiError, notifyUnauthorized, toApiError } from './client'
import type { ChatStage, Message, RetrievalEvent } from './types'

export type StreamHandlers = {
  /** A pipeline stage started; timings are the durations (ms) of the stages finished so far. */
  onStage?: (stage: ChatStage, timings: Record<string, number>) => void
  onRetrieval?: (event: RetrievalEvent) => void
  onToken: (text: string) => void
  onReplace?: (text: string) => void
  onDone: (message: Message) => void
  onError: (error: ApiError) => void
}

/**
 * POSTs a question and reads the Server-Sent Events response
 * (`stage` / `retrieval` / `token` / `done` / `error`). EventSource can't POST, so this parses
 * the stream from fetch directly. `documentIds` limits retrieval to those
 * sources (omit to search all of them).
 */
export async function streamChat(
  notebookId: string,
  question: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  documentIds?: string[] | null,
  options: { threadId?: string | null; regenerate?: boolean } = {},
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/notebooks/${notebookId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        question,
        ...(documentIds !== undefined && documentIds !== null ? { document_ids: documentIds } : {}),
        ...(options.threadId ? { thread_id: options.threadId } : {}),
        ...(options.regenerate ? { regenerate: true } : {}),
      }),
      credentials: 'same-origin',
      signal,
    })
  } catch {
    if (signal?.aborted) return
    handlers.onError(new ApiError(0, "Can't reach the server. Check your connection and retry."))
    return
  }

  if (!res.ok || !res.body) {
    if (res.status === 401) notifyUnauthorized()
    handlers.onError(await toApiError(res))
    return
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finished = false

  const dispatch = (raw: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return
    const data = JSON.parse(dataLines.join('\n'))
    if (event === 'stage') handlers.onStage?.(data.stage, data.timings_ms ?? {})
    else if (event === 'retrieval') handlers.onRetrieval?.(data)
    else if (event === 'token') handlers.onToken(data.text)
    else if (event === 'replace') handlers.onReplace?.(data.text)
    else if (event === 'done') {
      finished = true
      handlers.onDone(data.message)
    } else if (event === 'error') {
      finished = true
      handlers.onError(new ApiError(503, data.detail, data.retry_after ?? null))
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        dispatch(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
    }
    if (buffer.trim()) dispatch(buffer)
  } catch {
    if (signal?.aborted) return
  }

  if (!finished && !signal?.aborted) {
    handlers.onError(new ApiError(0, 'Response interrupted before it finished.'))
  }
}
