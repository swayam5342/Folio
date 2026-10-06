import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '../../api/client'
import { useCreateStudySet, useDeleteStudySet, useDocuments, useStudySet, useStudySets } from '../../api/queries'
import type { Source, StudyKind, StudySetSummary } from '../../api/types'
import { relativeTime } from '../../lib/format'
import { AlertIcon, MoreIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { Button, IconButton, Menu, Spinner, cx } from '../ui/primitives'
import FlashcardPlayer from './FlashcardPlayer'
import QuizPlayer from './QuizPlayer'

type View = { mode: 'list' } | { mode: 'new'; kind: StudyKind } | { mode: 'open'; id: string }

const COUNTS: Record<StudyKind, number[]> = { quiz: [5, 10, 15], flashcards: [10, 20, 30] }
const DEFAULT_COUNT: Record<StudyKind, number> = { quiz: 10, flashcards: 20 }
const LABEL: Record<StudyKind, { one: string; many: string; item: string }> = {
  quiz: { one: 'quiz', many: 'Quiz', item: 'question' },
  flashcards: { one: 'flashcard deck', many: 'Flashcards', item: 'card' },
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function GenerateForm({
  notebookId,
  kind,
  onCancel,
  onCreated,
}: {
  notebookId: string
  kind: StudyKind
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const documents = useDocuments(notebookId)
  const ready = (documents.data ?? []).filter((d) => d.status === 'ready')
  const create = useCreateStudySet(notebookId)
  const [selected, setSelected] = useState<string[] | null>(null) // null = all ready sources
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(DEFAULT_COUNT[kind])
  const [wait, setWait] = useState(0)

  const chosen = selected ?? ready.map((d) => d.id)
  const error = create.error instanceof ApiError ? create.error : null

  useEffect(() => {
    if (wait <= 0) return
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(t)
  }, [wait])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!chosen.length || create.isPending || wait > 0) return
    create.mutate(
      {
        kind,
        count,
        topic: topic.trim() || undefined,
        document_ids: selected === null ? undefined : chosen,
      },
      {
        onSuccess: (set) => onCreated(set.id),
        onError: (err) => setWait(err instanceof ApiError && err.status === 429 ? (err.retryAfter ?? 20) : 0),
      },
    )
  }

  const toggle = (id: string) => setSelected(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])

  if (create.isPending) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center" role="status">
        <Spinner size={24} className="text-muted" />
        <p className="mt-4 font-serif text-xl font-semibold">
          Writing {plural(count, LABEL[kind].item)} from {plural(chosen.length, 'source')}…
        </p>
        <p className="mt-1 text-sm text-muted">
          This usually takes {kind === 'quiz' ? '5–15' : '3–10'} seconds. Every {LABEL[kind].item} will cite its page.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h3 className="font-serif text-2xl font-semibold tracking-tight">New {LABEL[kind].one}</h3>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Sources</legend>
        {ready.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No ready sources yet. Add a PDF and wait for it to finish indexing.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {ready.map((doc) => (
              <label key={doc.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(doc.id)}
                  onChange={() => toggle(doc.id)}
                  className="size-4 accent-[var(--ink)]"
                />
                <span className="truncate">{doc.filename}</span>
                <span className="shrink-0 text-faint">{plural(doc.page_count, 'page')}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="mt-6 block">
        <span className="text-sm font-medium">Focus topic</span>
        <span className="ml-2 text-sm text-faint">optional</span>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={200}
          placeholder="e.g. boundary value analysis"
          className="mt-1.5 h-10 w-full rounded-md border border-line-strong bg-surface px-3 outline-none placeholder:text-faint focus:border-ink"
        />
        <span className="mt-1 block text-xs text-faint">
          Leave empty to cover all selected sources from start to end.
        </span>
      </label>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Number of {LABEL[kind].item}s</legend>
        <div className="mt-2 inline-flex rounded-md border border-line-strong p-0.5">
          {COUNTS[kind].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              aria-pressed={count === n}
              className={cx(
                'h-8 min-w-12 rounded px-3 text-sm font-medium',
                count === n ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-md bg-danger-soft px-3.5 py-3 text-sm">
          <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
          <span>{error.message}</span>
        </div>
      )}

      <div className="mt-8 flex gap-2">
        <Button type="submit" variant="primary" disabled={!chosen.length || wait > 0}>
          {wait > 0 ? `Retry in ${wait}s` : error ? 'Try again' : `Generate ${LABEL[kind].one}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function StudySetRow({ set, onOpen, onDelete }: { set: StudySetSummary; onOpen: () => void; onDelete: () => void }) {
  return (
    <li className="group relative rounded-lg border border-line bg-surface transition-colors hover:border-line-strong">
      <button type="button" onClick={onOpen} className="block w-full rounded-lg p-4 pr-12 text-left">
        <span className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className={cx('rounded px-1.5 py-0.5', set.kind === 'quiz' ? 'bg-sunken' : 'hl-mark')}>
            {LABEL[set.kind].many}
          </span>
          <span>{plural(set.item_count, LABEL[set.kind].item)}</span>
          <span aria-hidden="true">·</span>
          <span>{relativeTime(set.created_at)}</span>
        </span>
        <span className="mt-1.5 block font-serif text-lg font-semibold leading-snug">{set.title}</span>
        {set.topic && <span className="mt-0.5 block text-sm text-muted">Focus: {set.topic}</span>}
        {set.kind === 'quiz' && (
          <span className="mt-2 block text-sm text-muted">
            {set.last_score === null ? 'Not taken yet' : `Last score ${set.last_score}/${set.item_count}`}
          </span>
        )}
      </button>
      <div className="absolute right-2 top-2">
        <Menu
          trigger={(props) => (
            <IconButton label={`Options for ${set.title}`} {...props}>
              <MoreIcon size={16} />
            </IconButton>
          )}
          items={[{ label: 'Delete', danger: true, onSelect: onDelete }]}
        />
      </div>
    </li>
  )
}

function OpenSet({ id, onOpenSource, onBack }: { id: string; onOpenSource: (s: Source) => void; onBack: () => void }) {
  const set = useStudySet(id)
  if (set.isPending)
    return (
      <div className="p-8 text-muted">
        <Spinner />
      </div>
    )
  if (set.isError)
    return (
      <div className="p-8">
        <p className="text-danger">{set.error.message}</p>
        <Button className="mt-4" onClick={onBack}>
          Back to study
        </Button>
      </div>
    )
  return set.data.kind === 'quiz' ? (
    <QuizPlayer set={set.data} onOpenSource={onOpenSource} onBack={onBack} />
  ) : (
    <FlashcardPlayer set={set.data} onOpenSource={onOpenSource} onBack={onBack} />
  )
}

export default function StudyPanel({
  notebookId,
  switcher,
  onOpenSource,
}: {
  notebookId: string
  switcher: ReactNode
  onOpenSource: (source: Source) => void
}) {
  const [view, setView] = useState<View>({ mode: 'list' })
  const sets = useStudySets(notebookId)
  const remove = useDeleteStudySet(notebookId)
  const confirm = useConfirm()
  const toast = useToast()

  const deleteSet = async (set: StudySetSummary) => {
    const ok = await confirm({
      title: `Delete “${set.title}”?`,
      body: `This ${LABEL[set.kind].one} will be permanently deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) remove.mutate(set.id, { onError: (e) => toast(e.message, 'error') })
  }

  const back = () => setView({ mode: 'list' })

  return (
    <section aria-label="Study" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4 sm:px-6">
        {switcher}
        {view.mode === 'list' && (sets.data?.length ?? 0) > 0 && (
          <div className="flex gap-1.5">
            <Button className="h-8 px-2.5" onClick={() => setView({ mode: 'new', kind: 'quiz' })}>
              New quiz
            </Button>
            <Button className="h-8 px-2.5" onClick={() => setView({ mode: 'new', kind: 'flashcards' })}>
              New flashcards
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.mode === 'new' ? (
          <GenerateForm
            notebookId={notebookId}
            kind={view.kind}
            onCancel={back}
            onCreated={(id) => setView({ mode: 'open', id })}
          />
        ) : view.mode === 'open' ? (
          <OpenSet id={view.id} onOpenSource={onOpenSource} onBack={back} />
        ) : sets.isPending ? (
          <div className="p-8 text-muted">
            <Spinner />
          </div>
        ) : sets.isError ? (
          <p className="p-8 text-danger">{sets.error.message}</p>
        ) : sets.data.length === 0 ? (
          <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
            <h3 className="font-serif text-2xl font-semibold tracking-tight">Test yourself on your sources</h3>
            <p className="mt-2 max-w-md text-muted">
              Generate a multiple-choice quiz or a deck of flashcards from this notebook. Every question and card links to
              the page it came from, and sets are saved here so you can come back to them.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setView({ mode: 'new', kind: 'quiz' })}>
                New quiz
              </Button>
              <Button onClick={() => setView({ mode: 'new', kind: 'flashcards' })}>New flashcards</Button>
            </div>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl space-y-2.5 px-4 py-6 sm:px-6">
            {sets.data.map((set) => (
              <StudySetRow
                key={set.id}
                set={set}
                onOpen={() => setView({ mode: 'open', id: set.id })}
                onDelete={() => deleteSet(set)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
