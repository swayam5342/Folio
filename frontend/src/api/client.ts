export class ApiError extends Error {
  status: number
  retryAfter: number | null

  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

let onUnauthorized: (() => void) | null = null

/** Registered once by the app so any 401 sends the user back to sign in. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

function detailFrom(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  // FastAPI validation errors: [{loc, msg}, ...]
  if (Array.isArray(detail) && detail[0]?.msg) {
    const field = detail[0].loc?.at(-1)
    return field ? `${field}: ${detail[0].msg}` : detail[0].msg
  }
  if (status >= 500) return 'The server ran into a problem. Try again in a moment.'
  return `Request failed (${status})`
}

export async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null)
  const retry = Number(res.headers.get('retry-after'))
  return new ApiError(res.status, detailFrom(body, res.status), Number.isFinite(retry) && retry > 0 ? retry : null)
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the backend is running.")
  }

  if (!res.ok) {
    const error = await toApiError(res)
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.()
    throw error
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const json = (data: unknown): RequestInit => ({ body: JSON.stringify(data) })
