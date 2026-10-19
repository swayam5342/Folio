import { Command } from 'cmdk'
import {
  Activity,
  BookA,
  BookOpen,
  CheckSquare,
  FileText,
  FlaskConical,
  Layers,
  ListTree,
  HelpCircle,
  MessageSquare,
  MessageSquarePlus,
  Milestone,
  Moon,
  NotebookPen,
  NotebookText,
  Palette,
  PanelLeft,
  PanelRight,
  ScrollText,
  Sparkles,
  Sun,
  Upload,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMatch, useNavigate } from 'react-router'

import { useCreateThread, useDocuments, useNotebooks } from '../api/queries'
import { sourceColorStyle } from '../lib/sourceColors'
import { useTheme, type ThemePref } from '../lib/theme'
import { useSourceColors } from '../lib/useSourceColors'
import { useWorkspace } from '../lib/workspace'

type Item = {
  id: string
  label: string
  group: string
  run: () => void
  icon?: LucideIcon
  color?: number
  keywords?: string[]
  hint?: string
}

const THEME_ICON: Record<ThemePref, LucideIcon> = { system: Palette, light: Sun, dark: Moon, aurora: Sparkles }

const RECENT_KEY = 'folio.palette.recent'
const RECENT_MAX = 5

function loadRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {
    /* storage blocked: recents just won't persist */
  }
}

/** Notebook-specific commands, only available inside a workspace. */
function useWorkspaceItems(notebookId: string | undefined, search: string): Item[] {
  const documents = useDocuments(notebookId ?? '')
  const colors = useSourceColors(notebookId ?? '')
  const ws = useWorkspace()
  const createThread = useCreateThread(notebookId ?? '')
  if (!notebookId) return []
  const docs = documents.data ?? []
  const ready = docs.filter((d) => d.status === 'ready')
  const pageMatch = search.trim().match(/(?:^|\s)(?:p|page\s*)?(\d+)\s*$/i)
  const requestedPage = pageMatch ? Number(pageMatch[1]) : null
  const pageItems: Item[] = requestedPage
    ? ready
        .filter((d) => (d.kind === 'pdf' || d.kind === 'pptx') && requestedPage <= d.page_count)
        .map((d) => ({
          id: `page:${d.id}:${requestedPage}`,
          label: `${d.filename.replace(/\.(pdf|pptx)$/i, '')} · ${d.kind === 'pptx' ? 'slide' : 'page'} ${requestedPage}`,
          group: 'Jump to page',
          color: colors.get(d.id),
          keywords: [`p${requestedPage}`, `page ${requestedPage}`],
          run: () => ws.openDocument(d.id, requestedPage),
        }))
    : []
  return [
    { id: 'ask', label: 'Ask a question', group: 'Actions', icon: MessageSquare, run: ws.focusComposer, hint: 'Chat' },
    { id: 'upload', label: 'Add a source (PDF, Word, PowerPoint, text)', group: 'Actions', icon: Upload, run: ws.requestUpload },
    {
      id: 'new-chat',
      label: 'New chat',
      group: 'Actions',
      icon: MessageSquarePlus,
      keywords: ['thread', 'conversation'],
      run: () => createThread.mutate(undefined, { onSuccess: (t) => ws.setThread(t.id) }),
    },
    { id: 'quiz', label: 'New quiz', group: 'Actions', icon: FlaskConical, run: () => ws.requestStudy('quiz') },
    { id: 'flashcards', label: 'New flashcards', group: 'Actions', icon: Layers, run: () => ws.requestStudy('flashcards') },
    { id: 'study-guide', label: 'New study guide', group: 'Actions', icon: ScrollText, run: () => ws.requestStudy('study_guide') },
    { id: 'faq', label: 'New FAQ', group: 'Actions', icon: HelpCircle, run: () => ws.requestStudy('faq') },
    { id: 'timeline', label: 'New timeline', group: 'Actions', icon: Milestone, run: () => ws.requestStudy('timeline') },
    { id: 'glossary', label: 'New glossary', group: 'Actions', icon: BookA, run: () => ws.requestStudy('glossary') },
    { id: 'inspector', label: 'Open Retrieval Inspector', group: 'Actions', icon: Activity, run: () => ws.inspect(null), keywords: ['trace', 'how'] },
    { id: 'citations', label: 'Show citations of the latest answer', group: 'Actions', icon: ListTree, run: () => ws.inspect(null, 'citations') },
    { id: 'select-all', label: 'Search all sources', group: 'Actions', icon: CheckSquare, run: () => ws.setExcluded(new Set()), keywords: ['select', 'include'] },
    { id: 'toggle-sources', label: ws.sourcesOpen ? 'Hide sources pane' : 'Show sources pane', group: 'Layout', icon: PanelLeft, run: () => ws.setSourcesOpen(!ws.sourcesOpen) },
    { id: 'toggle-right', label: ws.rightOpen ? 'Hide viewer pane' : 'Show viewer pane', group: 'Layout', icon: PanelRight, run: () => ws.setRightOpen(!ws.rightOpen) },
    { id: 'study', label: 'Switch to Study', group: 'Layout', icon: BookOpen, run: () => ws.setCenter('study') },
    { id: 'chat', label: 'Switch to Chat', group: 'Layout', icon: MessageSquare, run: () => ws.setCenter('chat') },
    { id: 'notes', label: 'Switch to Notes', group: 'Layout', icon: NotebookPen, run: () => ws.setCenter('notes') },
    ...ready.map((d) => ({
      id: `source:${d.id}`,
      label: d.filename,
      group: 'Open source',
      color: colors.get(d.id),
      hint: `${d.page_count} pages`,
      run: () => ws.openDocument(d.id),
    })),
    // Page commands are created only for a typed page number, avoiding thousands
    // of objects for long documents while preserving queries such as "notes page 42".
    ...pageItems,
  ]
}

/**
 * Ctrl/⌘+K: jump to notebooks, sources and pages, run workspace actions, switch
 * themes. Recently used commands are listed first.
 */
export default function CommandPalette() {
  const open = useWorkspace((s) => s.paletteOpen)
  const setOpen = useWorkspace((s) => s.setPaletteOpen)
  const navigate = useNavigate()
  const match = useMatch('/notebooks/:notebookId')
  const notebookId = match?.params.notebookId
  const notebooks = useNotebooks()
  const { pref, calm, setPref, setCalm } = useTheme()
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState(loadRecent)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useWorkspace.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const workspaceItems = useWorkspaceItems(notebookId, search)
  const items: Item[] = [
      ...workspaceItems,
      ...(notebooks.data ?? [])
        .filter((n) => n.id !== notebookId)
        .map((n) => ({
          id: `notebook:${n.id}`,
          label: n.name,
          group: 'Notebooks',
          icon: NotebookText,
          hint: `${n.source_count} source${n.source_count === 1 ? '' : 's'}`,
          run: () => navigate(`/notebooks/${n.id}`),
        })),
      ...(['system', 'light', 'dark', 'aurora'] as const).map((t) => ({
        id: `theme:${t}`,
        label: `Theme: ${t[0].toUpperCase()}${t.slice(1)}${pref === t ? ' (current)' : ''}`,
        group: 'Appearance',
        icon: THEME_ICON[t],
        run: () => setPref(t),
      })),
      { id: 'calm', label: calm ? 'Turn off Calm mode' : 'Turn on Calm mode', group: 'Appearance', icon: Wind, keywords: ['motion', 'animation'], run: () => setCalm(!calm) },
      { id: 'go:home', label: 'All notebooks', group: 'Go to', icon: NotebookText, run: () => navigate('/') },
      { id: 'go:evaluation', label: 'Evaluation results', group: 'Go to', icon: Activity, run: () => navigate('/evaluation') },
      { id: 'go:design', label: 'Design system', group: 'Go to', icon: Palette, run: () => navigate('/design') },
  ]

  const run = (item: Item) => {
    setOpen(false)
    setSearch('')
    const next = [item.id, ...recent.filter((id) => id !== item.id)].slice(0, RECENT_MAX)
    setRecent(next)
    saveRecent(next)
    item.run()
  }

  // Page jumps would swamp the list, so they only appear once the user types.
  const visible = search ? items : items.filter((i) => i.group !== 'Jump to page')
  const recentItems = search ? [] : recent.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => !!i)
  const groups = [...new Set(visible.map((i) => i.group))]

  const renderItem = (item: Item, keyPrefix = '') => {
    const Icon = item.icon ?? FileText
    return (
      <Command.Item
        key={keyPrefix + item.id}
        value={keyPrefix + item.id}
        keywords={[item.label, item.group, ...(item.keywords ?? [])]}
        onSelect={() => run(item)}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink aria-selected:bg-sunken"
      >
        {item.color ? (
          <span aria-hidden style={sourceColorStyle(item.color)} className="flex size-4 shrink-0 items-center justify-center">
            <span className="size-2.5 rounded-full bg-[var(--src)]" />
          </span>
        ) : (
          <Icon aria-hidden size={16} className="shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint && <span className="shrink-0 text-xs text-faint">{item.hint}</span>}
      </Command.Item>
    )
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setSearch('')
      }}
      label="Command palette"
      overlayClassName="fixed inset-0 z-[70] bg-ink/25 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[12vh] z-[71] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_70px_-20px_rgba(20,25,35,0.55)]"
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Type a command, notebook, source or page…"
        className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-faint"
      />
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{search}”.</Command.Empty>
        {recentItems.length > 0 && (
          <Command.Group heading="Recent" className="pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-faint">
            {recentItems.map((item) => renderItem(item, 'recent:'))}
          </Command.Group>
        )}
        {groups.map((group) => (
          <Command.Group
            key={group}
            heading={group}
            className="pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-faint"
          >
            {visible.filter((i) => i.group === group).map((item) => renderItem(item))}
          </Command.Group>
        ))}
      </Command.List>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-faint">
        <span>
          <kbd className="font-mono">↑↓</kbd> move
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> run
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> close
        </span>
        <span className="ml-auto">
          <kbd className="font-mono">Ctrl/⌘ K</kbd> toggle
        </span>
      </div>
    </Command.Dialog>
  )
}
