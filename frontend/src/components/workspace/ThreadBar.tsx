import { ChevronDown, MessageSquarePlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { useClearThread, useCreateThread, useDeleteThread, useRenameThread } from '../../api/queries'
import type { ChatThread } from '../../api/types'
import { relativeTime } from '../../lib/format'
import { useWorkspace } from '../../lib/workspace'
import { MoreIcon } from '../ui/icons'
import { useConfirm, useToast } from '../ui/overlay'
import { IconButton, Menu, cx } from '../ui/primitives'

/** Chat header controls: switch between the notebook's chats, start a new one, rename / clear / delete. */
export default function ThreadBar({
  notebookId,
  threads,
  thread,
  hasMessages,
  busy,
}: {
  notebookId: string
  threads: ChatThread[]
  thread: ChatThread | null
  hasMessages: boolean
  /** An answer is streaming: switching or deleting now would orphan it. */
  busy: boolean
}) {
  const setThread = useWorkspace((s) => s.setThread)
  const create = useCreateThread(notebookId)
  const rename = useRenameThread(notebookId)
  const remove = useDeleteThread(notebookId)
  const clear = useClearThread()
  const confirm = useConfirm()
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)

  const newChat = () =>
    create.mutate(undefined, {
      onSuccess: (t) => setThread(t.id),
      onError: (e) => toast(e.message, 'error'),
    })

  const saveTitle = (e: FormEvent) => {
    e.preventDefault()
    const title = editing?.trim()
    if (thread && title && title !== thread.title) {
      rename.mutate({ id: thread.id, title }, { onError: (err) => toast(err.message, 'error') })
    }
    setEditing(null)
  }

  const deleteChat = async () => {
    if (!thread) return
    const ok = await confirm({
      title: `Delete “${thread.title}”?`,
      body: 'This chat and its answers will be deleted. Your sources and notes stay.',
      confirmLabel: 'Delete chat',
      danger: true,
    })
    if (!ok) return
    remove.mutate(thread.id, {
      onSuccess: () => setThread(threads.find((t) => t.id !== thread.id)?.id ?? null),
      onError: (e) => toast(e.message, 'error'),
    })
  }

  const clearChat = async () => {
    if (!thread) return
    const ok = await confirm({
      title: 'Clear this chat?',
      body: 'All questions and answers in this chat will be deleted. Your sources stay.',
      confirmLabel: 'Clear chat',
      danger: true,
    })
    if (ok) clear.mutate(thread.id, { onError: (e) => toast(e.message, 'error') })
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {editing !== null ? (
        <form onSubmit={saveTitle} className="min-w-0">
          <input
            autoFocus
            value={editing}
            maxLength={120}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
            aria-label="Chat name"
            className="h-8 w-48 rounded-md border border-ink bg-surface px-2 text-sm outline-none"
          />
        </form>
      ) : (
        threads.length > 0 && (
          <Menu
            trigger={(props) => (
              <button
                type="button"
                {...props}
                disabled={busy}
                title={thread?.title}
                className="inline-flex h-8 min-w-0 max-w-[6.5rem] items-center gap-1 rounded-md px-1.5 text-sm text-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50 @lg:max-w-[14rem] @lg:px-2"
              >
                <span className="truncate">{thread?.title ?? 'Chats'}</span>
                <ChevronDown aria-hidden size={14} className="shrink-0" />
              </button>
            )}
            items={threads.map((t) => ({
              label: `${t.id === thread?.id ? '● ' : ''}${t.title} · ${relativeTime(t.updated_at)}`,
              onSelect: () => setThread(t.id),
            }))}
          />
        )
      )}
      <IconButton label="New chat" onClick={newChat} disabled={busy || create.isPending}>
        <MessageSquarePlus size={17} />
      </IconButton>
      {thread && (
        <Menu
          trigger={(props) => (
            <IconButton label="Chat options" {...props} disabled={busy}>
              <MoreIcon size={16} />
            </IconButton>
          )}
          items={[
            { label: 'Rename chat', onSelect: () => setEditing(thread.title) },
            ...(hasMessages ? [{ label: 'Clear chat', onSelect: () => void clearChat() }] : []),
            { label: 'Delete chat', danger: true, onSelect: () => void deleteChat() },
          ]}
        />
      )}
      <span className={cx('sr-only')} aria-live="polite">
        {thread ? `Chat: ${thread.title}` : ''}
      </span>
    </div>
  )
}
