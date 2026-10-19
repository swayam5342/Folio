const STOP_WORDS = new Set(
  (
    'about above after again also among another because been before being below between both could does doing ' +
    'down during each explain from further give have having here into just more most much other over same should ' +
    'some such than that their them then there these they this those through under until very were what when ' +
    'where which while whom whose will with would your tell show list describe summarize summarise mean means'
  ).split(' '),
)

/** Content words of a question (4+ letters, no stop words), lower-cased and de-duplicated. */
export function questionTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu) ?? []
  return [...new Set(words.filter((w) => !STOP_WORDS.has(w)))]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Splits text into runs that do / don't match any term. A term matches at a word
 * start and may continue into a longer word ("window" matches "windows").
 */
export function highlightSegments(text: string, terms: string[]): { text: string; match: boolean }[] {
  if (!terms.length) return [{ text, match: false }]
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})[\\p{L}\\p{N}]*`, 'giu')
  const out: { text: string; match: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), match: false })
    out.push({ text: m[0], match: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false })
  return out
}
