import { NotebookPen } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '../../api/queries'
import type { Note } from '../../api/types'
import { answerToPlainText, prepareAnswer } from '../../lib/citations'
import { relativeTime } from '../../lib/format'
import { sourceLabel } from '../../lib/sourceLocation'
import { useWorkspace } from '../../lib/workspace'
import { MoreIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { Button, IconButton, Menu, Spinner } from '../ui/primitives'
import AnswerText, { CopyButton } from './AnswerText'
import { CitationChip } from './CitationChip'

function NoteEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: { title: string; content: string }
  busy: boolean
  onSave: (title: string, content: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() && content.trim()) onSave(title.trim(), content)
  }
  return (
    <form onSubmit={submit} className="rounded-lg border border-ink bg-surface p-4">
      <input
        autoFocus
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Note title"
        className="w-full bg-transparent font-serif text-lg font-semibold outline-none placeholder:text-faint"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        placeholder="Write your note… (Markdown works)"
        aria-label="Note text"
        className="mt-2 w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!title.trim() || !content.trim()}>
          Save note
        </Button>
      </div>
    </form>
  )
}

function NoteCard({ note, notebookId }: { note: Note; notebookId: string }) {
  const openSource = useWorkspace((s) => s.openSource)
  const update = useUpdateNote(notebookId)
  const remove = useDeleteNote(notebookId)
  const confirm = useConfirm()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const { markdown, citations } = prepareAnswer(note.content, note.sources)
  const listed = citations.filter((c) => c.source)

  if (editing) {
    return (
      <li>
        <NoteEditor
          initial={note}
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSave={(title, content) =>
            update.mutate(
              { id: note.id, title, content },
              { onSuccess: () => setEditing(false), onError: (e) => toast(e.message, 'error') },
            )
          }
        />
      </li>
    )
  }

  const deleteNote = async () => {
    const ok = await confirm({ title: `Delete “${note.title}”?`, confirmLabel: 'Delete note', danger: true })
    if (ok) remove.mutate(note.id, { onError: (e) => toast(e.message, 'error') })
  }

  return (
    <li className="group relative rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start gap-2 pr-8">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg font-semibold leading-snug">{note.title}</h3>
          <p className="text-xs text-faint">
            {note.sources.length ? 'Saved answer' : 'Note'} · {relativeTime(note.updated_at)}
          </p>
        </div>
      </div>
      <div className="mt-3 text-[15px]">
        <AnswerText markdown={markdown} citations={citations} onOpen={openSource} terms={[]} />
      </div>
      {listed.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-line pt-2.5 text-sm">
          {listed.map((c) => (
            <li key={c.n} className="flex items-baseline gap-2">
              <CitationChip citation={c} onOpen={openSource} terms={[]} />
              <button
                type="button"
                onClick={() => openSource(c.source!)}
                className="min-w-0 truncate text-left text-muted hover:text-ink hover:underline"
              >
                {sourceLabel(c.source!)}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2 -ml-2">
        <CopyButton
          label="Copy note"
          text={() => {
            const body = answerToPlainText(markdown).trim()
            return listed.length
              ? `${note.title}\n\n${body}\n\nSources:\n${listed.map((c) => `[${c.n}] ${sourceLabel(c.source!)}`).join('\n')}`
              : `${note.title}\n\n${body}`
          }}
        />
      </div>
      <div className="absolute right-2 top-2">
        <Menu
          trigger={(props) => (
            <IconButton label={`Options for ${note.title}`} {...props}>
              <MoreIcon size={16} />
            </IconButton>
          )}
          items={[
            { label: 'Edit', onSelect: () => setEditing(true) },
            { label: 'Delete', danger: true, onSelect: () => void deleteNote() },
          ]}
        />
      </div>
    </li>
  )
}

/** Center pane: answers saved from the chat (with working citations) and notes written by hand. */
export default function NotesPanel({ notebookId, switcher }: { notebookId: string; switcher: ReactNode }) {
  const notes = useNotes(notebookId)
  const create = useCreateNote(notebookId)
  const toast = useToast()
  const [writing, setWriting] = useState(false)

  return (
    <section aria-label="Notes" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4 sm:px-6">
        {switcher}
        {!writing && (
          <Button className="h-8 px-2.5" onClick={() => setWriting(true)}>
            New note
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-3 px-4 py-6 sm:px-6">
          {writing && (
            <NoteEditor
              busy={create.isPending}
              onCancel={() => setWriting(false)}
              onSave={(title, content) =>
                create.mutate({ title, content }, { onSuccess: () => setWriting(false), onError: (e) => toast(e.message, 'error') })
              }
            />
          )}
          {notes.isPending ? (
            <div className="text-muted">
              <Spinner />
            </div>
          ) : notes.isError ? (
            <p className="text-danger">{notes.error.message}</p>
          ) : notes.data.length === 0 && !writing ? (
            <div className="py-6">
              <NotebookPen aria-hidden size={28} className="text-faint" />
              <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight">No notes yet</h3>
              <p className="mt-2 max-w-md text-muted">
                Use <span className="font-medium text-ink">Save to notes</span> under any answer to keep it here with its
                citations, or write your own note.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {notes.data.map((note) => (
                <NoteCard key={note.id} note={note} notebookId={notebookId} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
