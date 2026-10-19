import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '../ui/primitives'

const MAX_TITLE = 120

/** Modal for adding pasted text as a source: a title (its name in the Sources list) and the text. */
export default function PasteTextDialog({
  busy,
  onSubmit,
  onClose,
}: {
  busy: boolean
  onSubmit: (title: string, text: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const ready = title.trim().length > 0 && text.trim().length > 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready && !busy) onSubmit(title.trim(), text)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,23,29,0.45)] px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-title"
        onSubmit={submit}
        className="flex w-full max-w-lg flex-col rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="paste-title" className="font-serif text-lg font-semibold">
          Paste text
        </h2>
        <p className="mt-1 text-sm text-muted">Lecture notes, an article, an email: it becomes a source you can ask about.</p>
        <label className="mt-4 text-xs font-medium text-muted" htmlFor="paste-name">
          Title
        </label>
        <input
          id="paste-name"
          ref={titleRef}
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Week 3 lecture notes"
          className="mt-1 h-9 rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
        />
        <label className="mt-3 text-xs font-medium text-muted" htmlFor="paste-text">
          Text
        </label>
        <textarea
          id="paste-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Paste or type the text here…"
          className="mt-1 resize-y rounded-md border border-line bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink"
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-faint tabular-nums">{text.length.toLocaleString()} characters</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
            Add source
          </Button>
        </div>
      </form>
    </div>
  )
}
