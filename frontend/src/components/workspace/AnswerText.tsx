import type { Root, RootContent } from 'mdast'
import { useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Source } from '../../api/types'
import { CITE_HREF, type Citation } from '../../lib/citations'
import { cx } from '../ui/primitives'

/**
 * Models write `<br>` for line breaks inside table cells. Raw HTML is never
 * rendered, so turn exactly that tag into a markdown line break and leave
 * every other HTML node to be dropped.
 */
function remarkBrTags() {
  const visit = (node: Root | RootContent) => {
    if (!('children' in node)) return
    node.children = node.children.map((child) =>
      child.type === 'html' && /^<br\s*\/?>$/i.test(child.value.trim()) ? { type: 'break' } : child,
    ) as typeof node.children
    node.children.forEach(visit)
  }
  return (tree: Root) => visit(tree)
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
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded-md border border-line bg-surface p-3 text-left font-sans text-[13px] font-normal leading-snug text-ink opacity-0 shadow-[0_10px_30px_-12px_rgba(20,25,35,0.35)] transition-opacity group-hover/chip:visible group-hover/chip:opacity-100 group-focus-within/chip:visible group-focus-within/chip:opacity-100"
      >
        <span className="block font-medium">
          {source.filename}, page {source.page_number}
        </span>
        <span className="mt-1 line-clamp-4 block text-muted">{source.snippet}</span>
      </span>
    </span>
  )
}

export function CopyButton({ text, label = 'Copy', className }: { text: () => string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text())
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
      className={cx(
        'rounded px-2 py-0.5 font-sans text-xs text-muted transition-colors hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

function CodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="answer-code group/code relative">
      <CopyButton
        text={() => ref.current?.innerText ?? ''}
        className="absolute right-2 top-2 bg-surface opacity-0 group-hover/code:opacity-100 focus:opacity-100"
      />
      <pre ref={ref} {...props} />
    </div>
  )
}

export default function AnswerText({
  markdown,
  citations,
  onOpen,
  streaming,
}: {
  markdown: string
  citations: Citation[]
  onOpen?: (source: Source) => void
  streaming?: boolean
}) {
  const components: Components = {
    a: ({ href, children, node: _node, ...rest }) => {
      if (href?.startsWith(CITE_HREF)) {
        const citation = citations[Number(href.slice(CITE_HREF.length)) - 1]
        return citation ? <CitationChip citation={citation} onOpen={onOpen} /> : null
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      )
    },
    table: ({ node: _node, ...props }) => (
      <div className="answer-table">
        <table {...props} />
      </div>
    ),
    pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  }

  return (
    <div className={cx('answer-md', streaming && 'streaming')}>
      {markdown.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBrTags]} components={components} skipHtml>
          {markdown}
        </ReactMarkdown>
      ) : (
        streaming && <p className="stream-caret" />
      )}
    </div>
  )
}
