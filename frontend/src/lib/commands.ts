/** Slash commands understood by the chat composer. */
export const COMMANDS = [
  { name: 'summarize', arg: 'focus', hint: 'Summarize the selected sources' },
  { name: 'compare', arg: 'aspect', hint: 'Compare two or more sources' },
  { name: 'quiz', arg: 'topic', hint: 'Make a quiz' },
  { name: 'flashcards', arg: 'topic', hint: 'Make flashcards' },
] as const

export type CommandName = (typeof COMMANDS)[number]['name']

export type ComposerInput =
  | { kind: 'ask'; question: string }
  | { kind: 'command'; name: CommandName; arg: string }
  | { kind: 'unknown'; name: string }

/** "/quiz tcp" → the quiz command with "tcp"; anything not starting with "/" is a question. */
export function parseComposer(text: string): ComposerInput {
  const trimmed = text.trim()
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(trimmed)
  if (!m) return { kind: 'ask', question: trimmed }
  const command = COMMANDS.find((c) => c.name === m[1].toLowerCase())
  return command ? { kind: 'command', name: command.name, arg: m[2].trim() } : { kind: 'unknown', name: m[1] }
}

/** Commands matching a partly typed "/na", while no argument has been started. */
export function matchingCommands(text: string): (typeof COMMANDS)[number][] {
  const m = /^\/(\w*)$/.exec(text)
  return m ? COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase())) : []
}

/** The "@query" being typed just before the caret, or null. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return m ? { query: m[2], start: caret - m[2].length - 1 } : null
}

export function summarizeQuestion(focus: string): string {
  return focus ? `Summarize these sources, focusing on ${focus}.` : 'Summarize these sources in a few paragraphs.'
}

export function compareQuestion(names: string[], aspect: string): string {
  const list = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ')
  return `Compare ${list}${aspect ? ` on ${aspect}` : ''}: where do they agree, and where do they differ?`
}
