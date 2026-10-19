import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, json } from './client'
import type { ChatThread, EvalResults, Message, Note, Notebook, RetrievalTrace, SourceDocument, SourcePage, StudySet, StudySetCreate, StudySetSummary, User } from './types'

export const keys = {
  me: ['me'] as const,
  notebooks: ['notebooks'] as const,
  notebook: (id: string) => ['notebooks', id] as const,
  documents: (notebookId: string) => ['notebooks', notebookId, 'documents'] as const,
  pages: (documentId: string) => ['documents', documentId, 'pages'] as const,
  messages: (notebookId: string) => ['notebooks', notebookId, 'messages'] as const,
  threads: (notebookId: string) => ['notebooks', notebookId, 'threads'] as const,
  threadMessages: (threadId: string) => ['threads', threadId, 'messages'] as const,
  notes: (notebookId: string) => ['notebooks', notebookId, 'notes'] as const,
  trace: (messageId: string) => ['messages', messageId, 'trace'] as const,
  evalResults: ['eval-results'] as const,
  studySets: (notebookId: string) => ['notebooks', notebookId, 'study-sets'] as const,
  studySet: (id: string) => ['study-sets', id] as const,
}

// --- Auth ---------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<User>('/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}

type Credentials = { username: string; password: string }

function useAuthMutation(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Credentials) => api<User>(path, { method: 'POST', ...json(c) }),
    onSuccess: (user) => {
      qc.clear()
      qc.setQueryData(keys.me, user)
    },
  })
}

export const useLogin = () => useAuthMutation('/auth/login')
export const useRegister = () => useAuthMutation('/auth/register')

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.clear()
      qc.setQueryData(keys.me, null)
    },
  })
}

// --- Notebooks ----------------------------------------------------------

export const useNotebooks = () =>
  useQuery({ queryKey: keys.notebooks, queryFn: () => api<Notebook[]>('/notebooks') })

export const useNotebook = (id: string) =>
  useQuery({ queryKey: keys.notebook(id), queryFn: () => api<Notebook>(`/notebooks/${id}`) })

export function useCreateNotebook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api<Notebook>('/notebooks', { method: 'POST', ...json({ name }) }),
    onSuccess: (nb) => {
      qc.setQueryData(keys.notebook(nb.id), nb)
      qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
    },
  })
}

export function useRenameNotebook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<Notebook>(`/notebooks/${id}`, { method: 'PATCH', ...json({ name }) }),
    onSuccess: (nb) => {
      qc.setQueryData(keys.notebook(nb.id), nb)
      qc.setQueryData<Notebook[]>(keys.notebooks, (list) => list?.map((n) => (n.id === nb.id ? nb : n)))
    },
  })
}

export function useUpdateNotebookSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, piiRedactionEnabled }: { id: string; piiRedactionEnabled: boolean }) =>
      api<Notebook>(`/notebooks/${id}`, { method: 'PATCH', ...json({ pii_redaction_enabled: piiRedactionEnabled }) }),
    onSuccess: (nb) => {
      qc.setQueryData(keys.notebook(nb.id), nb)
      qc.setQueryData<Notebook[]>(keys.notebooks, (list) => list?.map((n) => (n.id === nb.id ? nb : n)))
    },
  })
}

export function useDeleteNotebook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notebooks/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.setQueryData<Notebook[]>(keys.notebooks, (list) => list?.filter((n) => n.id !== id))
      qc.removeQueries({ queryKey: keys.notebook(id) })
    },
  })
}

// --- Documents ----------------------------------------------------------

export const useDocuments = (notebookId: string) =>
  useQuery({
    queryKey: keys.documents(notebookId),
    queryFn: () => api<SourceDocument[]>(`/notebooks/${notebookId}/documents`),
    enabled: !!notebookId,
    // Poll while anything is still being processed or summarized.
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === 'processing' || d.summary_status === 'pending') ? 2000 : false,
  })

export function useUploadDocument(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return api<SourceDocument>(`/notebooks/${notebookId}/documents`, { method: 'POST', body })
    },
    onSuccess: (doc) => {
      qc.setQueryData<SourceDocument[]>(keys.documents(notebookId), (list) => [...(list ?? []), doc])
      qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
    },
  })
}

export function useAddTextSource(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; text: string }) =>
      api<SourceDocument>(`/notebooks/${notebookId}/documents/text`, { method: 'POST', ...json(body) }),
    onSuccess: (doc) => {
      qc.setQueryData<SourceDocument[]>(keys.documents(notebookId), (list) => [...(list ?? []), doc])
      qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
    },
  })
}

/** Page text of a non-PDF source, for the text viewer. Re-fetched when the source is re-indexed. */
export function useDocumentPages(documentId: string, indexedKey?: string) {
  return useQuery({
    queryKey: [...keys.pages(documentId), indexedKey ?? ''],
    queryFn: () => api<SourcePage[]>(`/documents/${documentId}/pages`),
    staleTime: Infinity,
  })
}

export function useDeleteDocument(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.setQueryData<SourceDocument[]>(keys.documents(notebookId), (list) => list?.filter((d) => d.id !== id))
      qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
    },
  })
}

export function useReindexDocument(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<SourceDocument>(`/documents/${id}/reindex`, { method: 'POST' }),
    onSuccess: (doc) => {
      qc.setQueryData<SourceDocument[]>(keys.documents(notebookId), (list) => list?.map((d) => (d.id === doc.id ? doc : d)))
    },
  })
}

export const documentFileUrl = (id: string) => `/api/documents/${id}/file`

// --- Messages -----------------------------------------------------------

/** Retrieval trace of one answer; fetched only when the panel is opened. Traces never change. */
export const useTrace = (messageId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.trace(messageId),
    queryFn: () => api<RetrievalTrace>(`/messages/${messageId}/trace`),
    enabled,
    staleTime: Infinity,
    retry: false,
  })

// --- Chat threads ---------------------------------------------------------

export const useThreads = (notebookId: string) =>
  useQuery({
    queryKey: keys.threads(notebookId),
    queryFn: () => api<ChatThread[]>(`/notebooks/${notebookId}/threads`),
    enabled: !!notebookId,
  })

/** Messages of one thread; disabled (empty) when there's no thread yet. */
export const useThreadMessages = (threadId: string | null) =>
  useQuery({
    queryKey: keys.threadMessages(threadId ?? 'none'),
    queryFn: () => api<Message[]>(`/threads/${threadId}/messages`),
    enabled: !!threadId,
  })

export function useCreateThread(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<ChatThread>(`/notebooks/${notebookId}/threads`, { method: 'POST', ...json({}) }),
    onSuccess: (thread) => {
      qc.setQueryData<ChatThread[]>(keys.threads(notebookId), (list = []) => [thread, ...list])
      qc.setQueryData<Message[]>(keys.threadMessages(thread.id), [])
    },
  })
}

export function useRenameThread(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<ChatThread>(`/threads/${id}`, { method: 'PATCH', ...json({ title }) }),
    onSuccess: (thread) =>
      qc.setQueryData<ChatThread[]>(keys.threads(notebookId), (list = []) => list.map((t) => (t.id === thread.id ? thread : t))),
  })
}

export function useDeleteThread(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/threads/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => qc.setQueryData<ChatThread[]>(keys.threads(notebookId), (list = []) => list.filter((t) => t.id !== id)),
  })
}

export function useClearThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) => api<void>(`/threads/${threadId}/messages`, { method: 'DELETE' }),
    onSuccess: (_, threadId) => qc.setQueryData<Message[]>(keys.threadMessages(threadId), []),
  })
}

/** Deletes a thread's last message (used before regenerating an answer). */
export const deleteMessage = (id: string) => api<void>(`/messages/${id}`, { method: 'DELETE' })

// --- Notes -------------------------------------------------------------------

export const useNotes = (notebookId: string) =>
  useQuery({
    queryKey: keys.notes(notebookId),
    queryFn: () => api<Note[]>(`/notebooks/${notebookId}/notes`),
    enabled: !!notebookId,
  })

export function useCreateNote(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; content: string; sources?: Note['sources'] }) =>
      api<Note>(`/notebooks/${notebookId}/notes`, { method: 'POST', ...json(body) }),
    onSuccess: (note) => qc.setQueryData<Note[]>(keys.notes(notebookId), (list = []) => [note, ...list]),
  })
}

export function useUpdateNote(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; content?: string }) =>
      api<Note>(`/notes/${id}`, { method: 'PATCH', ...json(body) }),
    onSuccess: (note) =>
      qc.setQueryData<Note[]>(keys.notes(notebookId), (list = []) => [note, ...list.filter((n) => n.id !== note.id)]),
  })
}

export function useDeleteNote(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => qc.setQueryData<Note[]>(keys.notes(notebookId), (list = []) => list.filter((n) => n.id !== id)),
  })
}

// --- Evaluation -----------------------------------------------------------

export const useEvalResults = () =>
  useQuery({
    queryKey: keys.evalResults,
    queryFn: () => api<EvalResults>('/eval/results'),
    staleTime: 5 * 60_000,
    retry: false,
  })

// --- Study sets ---------------------------------------------------------

export const useStudySets = (notebookId: string) =>
  useQuery({
    queryKey: keys.studySets(notebookId),
    queryFn: () => api<StudySetSummary[]>(`/notebooks/${notebookId}/study-sets`),
  })

export const useStudySet = (id: string) =>
  useQuery({ queryKey: keys.studySet(id), queryFn: () => api<StudySet>(`/study-sets/${id}`) })

const summarize = ({ document_ids: _d, items: _i, ...summary }: StudySet): StudySetSummary => summary

export function useCreateStudySet(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: StudySetCreate) =>
      api<StudySet>(`/notebooks/${notebookId}/study-sets`, { method: 'POST', ...json(body) }),
    onSuccess: (set) => {
      qc.setQueryData(keys.studySet(set.id), set)
      qc.setQueryData<StudySetSummary[]>(keys.studySets(notebookId), (list) => [summarize(set), ...(list ?? [])])
      qc.invalidateQueries({ queryKey: keys.notebooks, exact: true })
    },
  })
}

export function useDeleteStudySet(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/study-sets/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.setQueryData<StudySetSummary[]>(keys.studySets(notebookId), (list) => list?.filter((s) => s.id !== id))
      qc.removeQueries({ queryKey: keys.studySet(id) })
    },
  })
}

export function useSaveScore(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, score }: { id: string; score: number }) =>
      api<StudySet>(`/study-sets/${id}/score`, { method: 'POST', ...json({ score }) }),
    onSuccess: (set) => {
      qc.setQueryData(keys.studySet(set.id), set)
      qc.setQueryData<StudySetSummary[]>(keys.studySets(notebookId), (list) =>
        list?.map((s) => (s.id === set.id ? summarize(set) : s)),
      )
    },
  })
}
