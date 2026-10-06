import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, json } from './client'
import type { Message, Notebook, SourceDocument, StudySet, StudySetCreate, StudySetSummary, User } from './types'

export const keys = {
  me: ['me'] as const,
  notebooks: ['notebooks'] as const,
  notebook: (id: string) => ['notebooks', id] as const,
  documents: (notebookId: string) => ['notebooks', notebookId, 'documents'] as const,
  messages: (notebookId: string) => ['notebooks', notebookId, 'messages'] as const,
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
    // Poll while anything is still being processed.
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'processing') ? 2000 : false),
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

export const documentFileUrl = (id: string) => `/api/documents/${id}/file`

// --- Messages -----------------------------------------------------------

export const useMessages = (notebookId: string) =>
  useQuery({
    queryKey: keys.messages(notebookId),
    queryFn: () => api<Message[]>(`/notebooks/${notebookId}/messages`),
  })

export function useClearMessages(notebookId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/notebooks/${notebookId}/messages`, { method: 'DELETE' }),
    onSuccess: () => qc.setQueryData<Message[]>(keys.messages(notebookId), []),
  })
}

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
