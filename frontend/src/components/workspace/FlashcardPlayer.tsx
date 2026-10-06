import { useEffect, useRef, useState } from 'react'

import type { FlashcardItem, Source, StudySet } from '../../api/types'
import { ChevronLeft, ChevronRight } from '../ui/icons'
import { Button, IconButton } from '../ui/primitives'
import { CitationChip } from './AnswerText'

function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
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
  const cards = set.items as FlashcardItem[]
  const [order, setOrder] = useState(() => cards.map((_, i) => i))
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = cards[order[position]]

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
      </div>

      <div className="mt-6 flex items-center justify-between text-sm text-muted">
        <span>
          Card {position + 1} of {cards.length}
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
              {card.source.filename}, page {card.source.page_number}
            </span>
          </span>
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <IconButton label="Previous card" onClick={() => go(-1)} disabled={position === 0} className="size-10">
          <ChevronLeft />
        </IconButton>
        <div className="flex items-center gap-2 text-sm text-muted">
          {flipped && (
            <>
              <span>Source</span>
              <CitationChip citation={{ n: 1, source: card.source }} onOpen={onOpenSource} />
            </>
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
      <p className="mt-3 text-center text-xs text-faint">Keys: Space to flip, ← → to move</p>
    </div>
  )
}
