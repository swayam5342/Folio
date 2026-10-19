import { describe, expect, it } from 'vitest'

import { compareQuestion, matchingCommands, mentionQuery, parseComposer, summarizeQuestion } from './commands'
import { highlightSegments, questionTerms } from './terms'

describe('composer commands', () => {
  it('parses questions, commands with arguments and unknown commands', () => {
    expect(parseComposer('  What is paging? ')).toEqual({ kind: 'ask', question: 'What is paging?' })
    expect(parseComposer('/quiz tcp congestion')).toEqual({ kind: 'command', name: 'quiz', arg: 'tcp congestion' })
    expect(parseComposer('/SUMMARIZE')).toEqual({ kind: 'command', name: 'summarize', arg: '' })
    expect(parseComposer('/translate it')).toEqual({ kind: 'unknown', name: 'translate' })
  })

  it('suggests commands only while the name is being typed', () => {
    expect(matchingCommands('/').map((c) => c.name)).toEqual(['summarize', 'compare', 'quiz', 'flashcards'])
    expect(matchingCommands('/q').map((c) => c.name)).toEqual(['quiz'])
    expect(matchingCommands('/quiz ')).toEqual([])
    expect(matchingCommands('what /q')).toEqual([])
  })

  it('finds the @mention being typed before the caret', () => {
    expect(mentionQuery('compare @net', 12)).toEqual({ query: 'net', start: 8 })
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionQuery('mail me@example', 15)).toBeNull() // not at a word start
    expect(mentionQuery('@net and more', 13)).toBeNull() // caret past the mention
  })

  it('writes summarize and compare questions', () => {
    expect(summarizeQuestion('')).toBe('Summarize these sources in a few paragraphs.')
    expect(summarizeQuestion('methods')).toBe('Summarize these sources, focusing on methods.')
    expect(compareQuestion(['a', 'b'], '')).toBe('Compare a and b: where do they agree, and where do they differ?')
    expect(compareQuestion(['a', 'b', 'c'], 'cost')).toBe('Compare a, b and c on cost: where do they agree, and where do they differ?')
  })
})

describe('question terms', () => {
  it('keeps content words of four or more letters, without stop words', () => {
    expect(questionTerms('What does the TCP slow start do with the window?')).toEqual(['slow', 'start', 'window'])
    expect(questionTerms('Why is RM-204 closed?')).toEqual(['rm-204', 'closed'])
  })

  it('highlights terms at word starts, including longer forms', () => {
    const segs = highlightSegments('Windows grow; a window shrinks. Rewindow no.', ['window'])
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['Windows', 'window'])
    expect(segs.map((s) => s.text).join('')).toBe('Windows grow; a window shrinks. Rewindow no.')
    expect(highlightSegments('plain', [])).toEqual([{ text: 'plain', match: false }])
  })

  it('treats regex characters in terms literally', () => {
    expect(highlightSegments('a (b) c', ['(b)']).filter((s) => s.match)).toEqual([{ text: '(b)', match: true }])
    expect(highlightSegments('abc a.c', ['a.c']).filter((s) => s.match)).toEqual([{ text: 'a.c', match: true }])
  })
})
