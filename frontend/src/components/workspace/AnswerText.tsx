import { Fragment, type ReactNode } from 'react'

import type { Source } from '../../api/types'
import type { Citation, Segment } from '../../lib/citations'
import { cx } from '../ui/primitives'

type Inline = { kind: 'text'; text: string } | { kind: 'cite'; citation: Citation }
type Line = Inline[]

/** Renders **bold** and *italic* as elements — never as HTML. */
function emphasis(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={`${key}-${i}`} className="font-semibold">{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={`${key}-${i}`}>{part.slice(1, -1)}</em>
    return <Fragment key={`${key}-${i}`}>{part}</Fragment>
  })
}

function toLines(segments: Segment[]): Line[] {
  const lines: Line[] = [[]]
  for (const seg of segments) {
    if (seg.kind === 'cite') {
      lines.at(-1)!.push(seg)
      continue
    }
    seg.text.split('\n').forEach((piece, i) => {
      if (i > 0) lines.push([])
      if (piece) lines.at(-1)!.push({ kind: 'text', text: piece })
    })
  }
  return lines
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/
const HEADING = /^\s*#{1,6}\s+/

function lineText(line: Line) {
  return line.map((i) => (i.kind === 'text' ? i.text : '')).join('')
}

/** Strip a prefix (list bullet / heading hashes) from the first text item of a line. */
function stripPrefix(line: Line, re: RegExp): Line {
  const [first, ...rest] = line
  if (first?.kind !== 'text') return line
  return [{ kind: 'text', text: first.text.replace(re, '') }, ...rest]
}

export function CitationChip({
  citation,
  onOpen,
}: {
  citation: Citation
  onOpen?: (source: Source) => void
}) {
  const { n, source } = citation
  if (!source) {
    return (
      <span className="ml-0.5 inline-flex h-[1.3em] min-w-[1.5em] items-center justify-center rounded-sm bg-sunken px-1 align-[0.12em] font-sans text-[0.68em] font-semibold text-muted">
        {n}
      </span>
    )
  }
  return (
    <span className="group/chip relative ml-0.5 inline-block align-[0.12em]">
      <button
        type="button"
        onClick={() => onOpen?.(source)}
        aria-label={`Source ${n}: ${source.filename}, page ${source.page_number}`}
        className="hl-mark inline-flex h-[1.3em] min-w-[1.5em] items-center justify-center rounded-sm px-1 font-sans text-[0.68em] font-semibold leading-none transition-transform hover:-translate-y-px"
      >
        {n}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded-md border border-line bg-surface p-3 text-left font-sans text-[13px] leading-snug text-ink opacity-0 shadow-[0_10px_30px_-12px_rgba(20,25,35,0.35)] transition-opacity group-hover/chip:visible group-hover/chip:opacity-100 group-focus-within/chip:visible group-focus-within/chip:opacity-100"
      >
        <span className="block font-medium">
          {source.filename}, page {source.page_number}
        </span>
        <span className="mt-1 line-clamp-4 block text-muted">{source.snippet}</span>
      </span>
    </span>
  )
}

export default function AnswerText({
  segments,
  onOpen,
  streaming,
}: {
  segments: Segment[]
  onOpen?: (source: Source) => void
  streaming?: boolean
}) {
  const lines = toLines(segments)
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: Line[] } | null = null
  let para: Line[] = []

  const renderInline = (line: Line, key: string) =>
    line.map((item, i) =>
      item.kind === 'text' ? (
        emphasis(item.text, `${key}-${i}`)
      ) : (
        <CitationChip key={`${key}-${i}`} citation={item.citation} onOpen={onOpen} />
      ),
    )

  const flushPara = () => {
    if (!para.length) return
    const k = `p${blocks.length}`
    blocks.push(
      <p key={k}>
        {para.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && ' '}
            {renderInline(line, `${k}-${i}`)}
          </Fragment>
        ))}
      </p>,
    )
    para = []
  }
  const flushList = () => {
    if (!list) return
    const k = `l${blocks.length}`
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={k} className={cx('space-y-1 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
        {list.items.map((item, i) => (
          <li key={i} className="pl-1 marker:text-faint">
            {renderInline(item, `${k}-${i}`)}
          </li>
        ))}
      </Tag>,
    )
    list = null
  }

  for (const line of lines) {
    const text = lineText(line)
    if (!text.trim() && !line.some((i) => i.kind === 'cite')) {
      flushPara()
      flushList()
    } else if (LIST_ITEM.test(text)) {
      flushPara()
      const ordered = /^\s*\d/.test(text)
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push(stripPrefix(line, LIST_ITEM))
    } else if (HEADING.test(text)) {
      flushPara()
      flushList()
      blocks.push(
        <p key={`h${blocks.length}`} className="font-semibold">
          {renderInline(stripPrefix(line, HEADING), `h${blocks.length}`)}
        </p>,
      )
    } else if (list && line[0]?.kind === 'cite') {
      // Citation that wrapped onto its own line after a bullet.
      list.items[list.items.length - 1].push(...line)
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()

  return (
    <div className={cx('space-y-3 font-serif text-[1.075rem] leading-[1.65]', streaming && 'streaming')}>
      {blocks.length ? blocks : streaming ? <p className="stream-caret" /> : null}
    </div>
  )
}
