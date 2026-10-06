/**
 * Models write LaTeX with \( … \) and \[ … \]; remark-math reads dollar
 * delimiters. Convert both to $$ … $$: a display block when \[ starts its own
 * line, inline otherwise (inside a table cell or mid-sentence, a block would
 * break the table or list). Single $ is deliberately not math, so prices like
 * "$100 and $200" in a source stay as text.
 *
 * Fenced code blocks and inline code are left untouched. Unclosed delimiters
 * (an answer still streaming) are left as-is until their closing half arrives.
 */
const FENCE = /^(```|~~~)/
const DISPLAY = /\\\[([\s\S]+?)\\\]/g
const INLINE = /\\\(([\s\S]+?)\\\)/g

function convertProse(text: string): string {
  // Split on inline code spans so their contents are never rewritten.
  return text
    .split(/(`+[^`]*`+)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part
        .replace(DISPLAY, (_match: string, body: string, offset: number, whole: string) => {
          const lineStart = whole.lastIndexOf('\n', offset - 1) + 1
          const startsLine = whole.slice(lineStart, offset).trim() === ''
          const tex = body.trim()
          return startsLine && !tex.includes('|') ? `\n$$\n${tex}\n$$\n` : `$$${tex}$$`
        })
        .replace(INLINE, (_match: string, body: string) => `$$${body.trim()}$$`)
    })
    .join('')
}

export function normalizeMath(markdown: string): string {
  if (!markdown.includes('\\[') && !markdown.includes('\\(')) return markdown
  const out: string[] = []
  let prose: string[] = []
  let inFence = false
  const flush = () => {
    if (prose.length) out.push(convertProse(prose.join('\n')))
    prose = []
  }
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line.trim())) {
      if (!inFence) flush()
      inFence = !inFence
      out.push(line)
    } else if (inFence) {
      out.push(line)
    } else {
      prose.push(line)
    }
  }
  flush()
  return out.join('\n')
}
