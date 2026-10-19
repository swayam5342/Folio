import type { Root, RootContent } from 'mdast'
import { useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

import { CITE_HREF, type Citation } from '../../lib/citations'
import { CitationChip, type OpenSource } from './CitationChip'
import { normalizeMath } from '../../lib/math'
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
  terms,
}: {
  markdown: string
  citations: Citation[]
  onOpen?: OpenSource
  streaming?: boolean
  /** Question words to highlight in citation snippets. */
  terms?: string[]
}) {
  const components: Components = {
    a: ({ href, children, node: _node, ...rest }) => {
      if (href?.startsWith(CITE_HREF)) {
        const citation = citations[Number(href.slice(CITE_HREF.length)) - 1]
        return citation ? <CitationChip citation={citation} onOpen={onOpen} terms={terms} /> : null
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
        <ReactMarkdown
          // Single $ is not math (prices); \( \) and \[ \] are converted to $$ by normalizeMath.
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkBrTags]}
          rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
          components={components}
          skipHtml
        >
          {normalizeMath(markdown)}
        </ReactMarkdown>
      ) : (
        streaming && <p className="stream-caret" />
      )}
    </div>
  )
}
