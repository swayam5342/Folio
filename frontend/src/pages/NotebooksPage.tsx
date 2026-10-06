import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { useCreateNotebook, useDeleteNotebook, useNotebooks, useRenameNotebook } from '../api/queries'
import type { Notebook } from '../api/types'
import AppHeader from '../components/AppHeader'
import { MoreIcon, PlusIcon } from '../components/ui/icons'
import { useConfirm, useToast } from '../components/ui/overlay'
import { Button, IconButton, Menu, Spinner } from '../components/ui/primitives'
import { relativeTime } from '../lib/format'

function NameForm({
  initial = '',
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: string
  submitLabel: string
  busy?: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) onSubmit(name.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        autoFocus
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="Notebook name"
        aria-label="Notebook name"
        className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 font-serif text-lg outline-none focus:border-ink"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function NotebookCard({ notebook }: { notebook: Notebook }) {
  const [renaming, setRenaming] = useState(false)
  const rename = useRenameNotebook()
  const remove = useDeleteNotebook()
  const confirm = useConfirm()
  const toast = useToast()

  if (renaming) {
    return (
      <div className="rounded-lg border border-ink bg-surface p-5">
        <NameForm
          initial={notebook.name}
          submitLabel="Rename"
          busy={rename.isPending}
          onCancel={() => setRenaming(false)}
          onSubmit={(name) =>
            rename.mutate(
              { id: notebook.id, name },
              {
                onSuccess: () => setRenaming(false),
                onError: (e) => toast(e.message, 'error'),
              },
            )
          }
        />
      </div>
    )
  }

  const sources = notebook.source_count === 1 ? '1 source' : `${notebook.source_count} sources`

  return (
    <div className="group relative flex min-h-40 flex-col rounded-lg border border-line bg-surface transition-colors hover:border-line-strong">
      <Link
        to={`/notebooks/${notebook.id}`}
        className="flex flex-1 flex-col rounded-lg p-5 pr-12 focus-visible:outline-offset-[-2px]"
      >
        <h2 className="font-serif text-xl font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">
          {notebook.name}
        </h2>
        <p className="mt-auto pt-6 text-sm text-muted">
          {sources}, edited {relativeTime(notebook.updated_at)}
        </p>
      </Link>
      <div className="absolute right-3 top-3">
        <Menu
          trigger={(props) => (
            <IconButton label={`Options for ${notebook.name}`} {...props}>
              <MoreIcon />
            </IconButton>
          )}
          items={[
            { label: 'Rename', onSelect: () => setRenaming(true) },
            {
              label: 'Delete',
              danger: true,
              onSelect: async () => {
                const ok = await confirm({
                  title: `Delete “${notebook.name}”?`,
                  body: 'Its sources and chat history will be permanently deleted.',
                  confirmLabel: 'Delete notebook',
                  danger: true,
                })
                if (ok)
                  remove.mutate(notebook.id, {
                    onSuccess: () => toast('Notebook deleted'),
                    onError: (e) => toast(e.message, 'error'),
                  })
              },
            },
          ]}
        />
      </div>
    </div>
  )
}

function NewNotebookCard() {
  const [open, setOpen] = useState(false)
  const create = useCreateNotebook()
  const navigate = useNavigate()
  const toast = useToast()

  if (open) {
    return (
      <div className="rounded-lg border border-ink bg-surface p-5">
        <NameForm
          submitLabel="Create notebook"
          busy={create.isPending}
          onCancel={() => setOpen(false)}
          onSubmit={(name) =>
            create.mutate(name, {
              onSuccess: (nb) => navigate(`/notebooks/${nb.id}`),
              onError: (e) => toast(e.message, 'error'),
            })
          }
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex min-h-40 flex-col items-start justify-between rounded-lg border border-dashed border-line-strong p-5 text-left text-muted transition-colors hover:border-ink hover:text-ink"
    >
      <PlusIcon size={22} />
      <span className="font-serif text-xl font-semibold tracking-tight">New notebook</span>
    </button>
  )
}

export default function NotebooksPage() {
  const notebooks = useNotebooks()

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-8">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">Notebooks</h1>
        <p className="mt-2 max-w-xl text-muted">
          A notebook holds a set of PDFs you want to ask questions about. Answers only draw on the sources in that
          notebook.
        </p>

        {notebooks.isPending ? (
          <div className="mt-10 text-muted">
            <Spinner />
          </div>
        ) : notebooks.isError ? (
          <p role="alert" className="mt-10 text-danger">
            {notebooks.error.message}
          </p>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NewNotebookCard />
            {notebooks.data.map((nb) => (
              <NotebookCard key={nb.id} notebook={nb} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
