import { AtSign, Slash, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { SourceDocument } from '../../api/types'
import {
  compareQuestion,
  matchingCommands,
  mentionQuery,
  parseComposer,
  summarizeQuestion,
} from '../../lib/commands'
import { sourceColorStyle } from '../../lib/sourceColors'
import { useSourceColors } from '../../lib/useSourceColors'
import { useWorkspace } from '../../lib/workspace'
import { SendIcon, StopIcon } from '../ui/icons'
import { useToast } from '../ui/overlay'
import { IconButton, cx } from '../ui/primitives'

type Option = { id: string; label: string; hint: string; apply: () => void; color?: number }

/**
 * Chat input. Besides questions it understands slash commands (/summarize,
 * /compare, /quiz, /flashcards) and @mentions of sources: mentioned sources
 * become chips, and the next question searches only them.
 */
export default function Composer({
  notebookId,
  readyDocs,
  selectedIds,
  streaming,
  disabledReason,
  onAsk,
  onStop,
}: {
  notebookId: string
  readyDocs: SourceDocument[]
  /** Sources ticked in the Sources panel, or null for all. */
  selectedIds: string[] | null
  streaming: boolean
  /** Why asking is impossible right now, e.g. no ready sources (shown as the placeholder), or null. */
  disabledReason: string | null
  onAsk: (question: string, documentIds: string[] | null) => void
  onStop: () => void
}) {
  const colors = useSourceColors(notebookId)
  const requestStudy = useWorkspace((s) => s.requestStudy)
  const focusNonce = useWorkspace((s) => s.focusComposerNonce)
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [mentions, setMentions] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focusNonce) textarea.current?.focus()
  }, [focusNonce])

  // Mentioned sources that stopped being ready (removed, re-indexing) drop out.
  const readyIds = new Set(readyDocs.map((d) => d.id))
  const liveMentions = mentions.filter((id) => readyIds.has(id))

  // Auto-grow up to ~8 lines.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const setText = (text: string, nextCaret = text.length) => {
    setDraft(text)
    setCaret(nextCaret)
    setActive(0)
    setDismissed(false)
    // Place the caret after React has applied the text, unless the user has typed since.
    requestAnimationFrame(() => {
      const el = textarea.current
      if (el && el.value === text) el.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const mention = mentionQuery(draft, caret)
  const options: Option[] = dismissed
    ? []
    : mention
      ? readyDocs
          .filter((d) => !liveMentions.includes(d.id) && d.filename.toLowerCase().includes(mention.query.toLowerCase()))
          .slice(0, 8)
          .map((d) => ({
            id: d.id,
            label: d.filename,
            hint: `${d.page_count} pages`,
            color: colors.get(d.id),
            apply: () => {
              setMentions((m) => [...m, d.id])
              const before = draft.slice(0, mention.start)
              setText(before + draft.slice(caret).replace(/^\s*/, before && !before.endsWith(' ') ? ' ' : ''), before.length)
            },
          }))
      : matchingCommands(draft).map((c) => ({
          id: c.name,
          label: `/${c.name}`,
          hint: `${c.hint} · /${c.name} [${c.arg}]`,
          apply: () => setText(`/${c.name} `),
        }))
  const menuOpen = options.length > 0
  const listId = `composer-menu-${notebookId}`

  const scope = liveMentions.length ? liveMentions : selectedIds
  // Every source unticked and none mentioned: nothing to search.
  const blocked = disabledReason ?? (scope !== null && scope.length === 0 ? 'Tick a source, or @mention one, to ask' : null)
  const nameOf = (id: string) => readyDocs.find((d) => d.id === id)?.filename.replace(/\.pdf$/i, '') ?? 'source'

  const submit = () => {
    if (streaming || !draft.trim()) return
    const input = parseComposer(draft)
    const studyCommand = input.kind === 'command' && (input.name === 'quiz' || input.name === 'flashcards')
    if (blocked && !studyCommand) return
    if (input.kind === 'unknown') {
      toast(`Unknown command /${input.name}. Try /summarize, /compare, /quiz or /flashcards.`, 'error')
      return
    }
    if (input.kind === 'command' && (input.name === 'quiz' || input.name === 'flashcards')) {
      requestStudy(input.name, input.arg || undefined)
    } else if (input.kind === 'command' && input.name === 'compare') {
      const ids = scope ?? readyDocs.map((d) => d.id)
      if (ids.length < 2) {
        toast('Pick at least two sources to compare: @mention them or tick them in Sources.', 'error')
        return
      }
      onAsk(compareQuestion(ids.map(nameOf), input.arg), ids)
    } else if (input.kind === 'command') {
      onAsk(summarizeQuestion(input.arg), scope)
    } else {
      onAsk(input.question, scope)
    }
    setText('')
    setMentions([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        options[Math.min(active, options.length - 1)].apply()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (e.key === 'Backspace' && !draft && liveMentions.length) {
      setMentions((m) => m.slice(0, -1))
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const canSend = !streaming && !!draft.trim() && (!blocked || draft.trim().startsWith('/'))

  return (
    <div className="shrink-0 border-t border-line bg-paper px-4 py-3 sm:px-6">
      <div className="relative mx-auto max-w-3xl">
        {menuOpen && (
          <ul
            id={listId}
            role="listbox"
            aria-label={mention ? 'Sources' : 'Commands'}
            className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-[0_14px_40px_-14px_rgba(20,25,35,0.45)]"
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault() // keep focus in the textarea
                  o.apply()
                }}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
                  i === active && 'bg-sunken',
                )}
              >
                {o.color ? (
                  <span aria-hidden style={sourceColorStyle(o.color)} className="size-2.5 shrink-0 rounded-full bg-[var(--src)]" />
                ) : (
                  <Slash aria-hidden size={14} className="shrink-0 text-faint" />
                )}
                <span className="min-w-0 truncate font-medium">{o.label}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-muted">{o.hint}</span>
              </li>
            ))}
          </ul>
        )}

        <div
          className={cx(
            'rounded-lg border bg-surface p-2 transition-colors focus-within:border-ink',
            blocked ? 'border-line' : 'border-line-strong',
          )}
        >
          {liveMentions.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
              {liveMentions.map((id) => (
                <span
                  key={id}
                  style={sourceColorStyle(colors.get(id) ?? 1)}
                  className="flex items-center gap-1 rounded-md bg-[var(--src-soft)] py-0.5 pl-2 pr-1 text-xs text-[var(--src-ink)]"
                >
                  <AtSign aria-hidden size={11} />
                  <span className="max-w-48 truncate">{nameOf(id)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${nameOf(id)}`}
                    onClick={() => setMentions((m) => m.filter((x) => x !== id))}
                    className="rounded p-0.5 hover:bg-[var(--src)]/20"
                  >
                    <X aria-hidden size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textarea}
              rows={1}
              value={draft}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value)
                setCaret(e.target.selectionStart)
                setActive(0)
                setDismissed(false)
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              disabled={readyDocs.length === 0}
              placeholder={blocked ?? 'Ask about your sources…  (/ for commands, @ to pick sources)'}
              aria-label="Your question"
              role="combobox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={menuOpen ? `${listId}-${Math.min(active, options.length - 1)}` : undefined}
              className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-faint disabled:cursor-not-allowed"
            />
            {streaming ? (
              <IconButton label="Stop generating" onClick={onStop} className="size-9 bg-sunken">
                <StopIcon />
              </IconButton>
            ) : (
              <IconButton
                label="Send question"
                onClick={submit}
                disabled={!canSend}
                className="size-9 bg-ink text-paper hover:bg-ink hover:text-paper hover:opacity-90"
              >
                <SendIcon />
              </IconButton>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-xs text-faint">
          {liveMentions.length > 0 ? (
            <span className="font-medium text-muted">Only the mentioned sources · </span>
          ) : (
            selectedIds !== null &&
            selectedIds.length > 0 && (
              <span className="font-medium text-muted">
                Searching {selectedIds.length} of {readyDocs.length} sources ·{' '}
              </span>
            )
          )}
          Enter to send, Shift+Enter for a new line. Answers can be wrong — check the cited pages.
        </p>
      </div>
    </div>
  )
}
