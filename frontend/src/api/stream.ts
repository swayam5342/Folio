import { ApiError, toApiError } from './client'
import type { Message } from './types'

export type StreamHandlers = {
  onToken: (text: string) => void
  onDone: (message: Message) => void
  onError: (error: ApiError) => void
}

/**
 * POSTs a question and reads the Server-Sent Events response
 * (`token` / `done` / `error`). EventSource can't POST, so this parses the
 * stream from fetch directly.
 */
export async function streamChat(
  notebookId: string,
  question: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/notebooks/${notebookId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ question }),
      credentials: 'same-origin',
      signal,
    })
  } catch (e) {
    if (signal?.aborted) return
    handlers.onError(new ApiError(0, "Can't reach the server. Check your connection and retry."))
    return
  }

  if (!res.ok || !res.body) {
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
    if (event === 'token') handlers.onToken(data.text)
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
