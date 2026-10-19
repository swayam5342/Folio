import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { FlashcardItem, Source, StudySet } from '../../api/types'
import { ChevronLeft, ChevronRight } from '../ui/icons'
import { Button, IconButton, Menu, cx } from '../ui/primitives'
import { CitationChip } from './CitationChip'
import { sourceLabel } from '../../lib/sourceLocation'

function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** One field for CSV: quoted, inner quotes doubled. */
const csvField = (v: string) => `"${v.replace(/"/g, '""')}"`

/** Downloads text as a file named after the deck. */
function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportDeck(set: StudySet, cards: FlashcardItem[], format: 'csv' | 'anki') {
  const base = set.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'flashcards'
  if (format === 'csv') {
    const rows = [['Front', 'Back', 'Source'], ...cards.map((c) => [c.front, c.back, sourceLabel(c.source)])]
    download(`${base}.csv`, '\ufeff' + rows.map((r) => r.map(csvField).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
  } else {
    // Anki's text import: tab-separated front/back, with headers telling it how to read the file.
    const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ')
    const lines = ['#separator:tab', '#html:false', '#notetype:Basic', `#deck:${clean(set.title)}`]
    lines.push(...cards.map((c) => `${clean(c.front)}\t${clean(c.back)} (${clean(sourceLabel(c.source))})`))
    download(`${base}-anki.txt`, lines.join('\n'), 'text/plain;charset=utf-8')
  }
}

export default function FlashcardPlayer({
  set,
  onOpenSource,
  onBack,
}: {
  set: StudySet
  onOpenSource: (source: Source) => void
  onBack: () => void
}) {
  const deck = set.items as FlashcardItem[]
  // The cards in this pass: the whole deck, or only the ones marked "Still learning".
  const [cards, setCards] = useState(deck)
  const [reviewing, setReviewing] = useState(false)
  const [learning, setLearning] = useState<Set<number>>(new Set())
  const [known, setKnown] = useState<Set<number>>(new Set())
  const [order, setOrder] = useState(() => deck.map((_, i) => i))
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = cards[order[position]]
  const marked = learning.size + known.size

  const mark = (stillLearning: boolean) => {
    const id = order[position]
    setLearning((s) => {
      const next = new Set(s)
      if (stillLearning) next.add(id)
      else next.delete(id)
      return next
    })
    setKnown((s) => {
      const next = new Set(s)
      if (stillLearning) next.delete(id)
      else next.add(id)
      return next
    })
    if (position < cards.length - 1) go(1)
  }

  const startPass = (pass: FlashcardItem[], review: boolean) => {
    setCards(pass)
    setOrder(pass.map((_, i) => i))
    setReviewing(review)
    setLearning(new Set())
    setKnown(new Set())
    setPosition(0)
    setFlipped(false)
  }

  const go = (delta: number) => {
    setPosition((p) => Math.min(Math.max(0, p + delta), cards.length - 1))
    setFlipped(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // Ignore keys while this player is on a hidden panel (e.g. the user switched to Chat).
      if (!root.current || root.current.offsetParent === null) return
      if (e.key === ' ' || e.key === 'Enter') {
        // Let Enter/Space activate a focused button (e.g. a citation chip) normally.
        if (e.target instanceof HTMLButtonElement && !e.target.dataset.card) return
        e.preventDefault()
        setFlipped((f) => !f)
      } else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div ref={root} className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted hover:text-ink"
        >
          <ChevronLeft size={16} /> Study
        </button>
        <span className="min-w-0 flex-1 truncate text-right text-sm text-muted">{set.title}</span>
        <Menu
          trigger={(props) => (
            <IconButton label="Export deck" {...props}>
              <Download size={16} />
            </IconButton>
          )}
          items={[
            { label: 'Export for Anki (.txt)', onSelect: () => exportDeck(set, deck, 'anki') },
            { label: 'Export as CSV', onSelect: () => exportDeck(set, deck, 'csv') },
          ]}
        />
      </div>

      <div className="mt-6 flex items-center justify-between text-sm text-muted">
        <span>
          {reviewing ? 'Review · ' : ''}Card {position + 1} of {cards.length}
          {marked > 0 && (
            <span className="ml-2 text-faint">
              · {known.size} known, {learning.size} still learning
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          className="h-8 px-2.5"
          onClick={() => {
            setOrder(shuffled(cards.length))
            setPosition(0)
            setFlipped(false)
          }}
        >
          Shuffle
        </Button>
      </div>

      <div className="flashcard-scene mt-3">
        <button
          type="button"
          data-card="1"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? 'Show the front of the card' : 'Show the answer'}
          className={`flashcard ${flipped ? 'is-flipped' : ''}`}
        >
          <span className="flashcard-face flashcard-front" aria-hidden={flipped}>
            <span className="text-xs font-medium text-faint">Front</span>
            <span className="font-serif text-2xl font-semibold leading-snug">{card.front}</span>
            <span className="text-xs text-faint">Click or press Space to flip</span>
          </span>
          <span className="flashcard-face flashcard-back" aria-hidden={!flipped}>
            <span className="text-xs font-medium text-faint">Back</span>
            <span className="font-serif text-xl leading-relaxed">{card.back}</span>
            <span className="text-xs text-faint">
              {sourceLabel(card.source)}
            </span>
          </span>
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <IconButton label="Previous card" onClick={() => go(-1)} disabled={position === 0} className="size-10">
          <ChevronLeft />
        </IconButton>
        <div className="flex items-center gap-2 text-sm text-muted">
          {flipped ? (
            <>
              <CitationChip citation={{ n: 1, source: card.source }} onOpen={onOpenSource} />
              <Button
                className={cx('h-8 px-2.5', learning.has(order[position]) && 'border-warn text-warn')}
                onClick={() => mark(true)}
              >
                Still learning
              </Button>
              <Button
                className={cx('h-8 px-2.5', known.has(order[position]) && 'border-ok text-ok')}
                onClick={() => mark(false)}
              >
                Got it
              </Button>
            </>
          ) : (
            <span className="text-xs text-faint">Flip to mark the card</span>
          )}
        </div>
        <IconButton
          label="Next card"
          onClick={() => go(1)}
          disabled={position === cards.length - 1}
          className="size-10"
        >
          <ChevronRight />
        </IconButton>
      </div>
      {(learning.size > 0 || reviewing) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {learning.size > 0 && (
            <Button variant="primary" onClick={() => startPass([...learning].map((i) => cards[i]), true)}>
              Review {learning.size} {learning.size === 1 ? 'card' : 'cards'} still learning
            </Button>
          )}
          {reviewing && <Button onClick={() => startPass(deck, false)}>Back to the full deck</Button>}
        </div>
      )}
      <p className="mt-3 text-center text-xs text-faint">Keys: Space to flip, ← → to move</p>
    </div>
  )
}
