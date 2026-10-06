import { useEffect, useRef, useState } from 'react'

import { useSaveScore } from '../../api/queries'
import type { QuizItem, Source, StudySet } from '../../api/types'
import { ChevronLeft } from '../ui/icons'
import { Button, cx } from '../ui/primitives'
import { CitationChip } from './AnswerText'

const LETTERS = ['A', 'B', 'C', 'D']

export default function QuizPlayer({
  set,
  onOpenSource,
  onBack,
}: {
  set: StudySet
  onOpenSource: (source: Source) => void
  onBack: () => void
}) {
  const items = set.items as QuizItem[]
  const saveScore = useSaveScore(set.notebook_id)
  const root = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correct, setCorrect] = useState(0)
  const [finished, setFinished] = useState(false)

  const item = items[index]
  const last = index === items.length - 1

  const pick = (option: number) => {
    if (picked !== null || finished) return
    setPicked(option)
    if (option === item.answer_index) setCorrect((c) => c + 1)
  }

  const next = () => {
    if (picked === null) return
    if (last) {
      setFinished(true)
      saveScore.mutate({ id: set.id, score: correct })
    } else {
      setIndex((i) => i + 1)
      setPicked(null)
    }
  }

  const retake = () => {
    setIndex(0)
    setPicked(null)
    setCorrect(0)
    setFinished(false)
  }

  // Keyboard: 1–4 (or A–D) to answer, Enter for the next question.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // Ignore keys while this player is on a hidden panel (e.g. the user switched to Chat).
      if (!root.current || root.current.offsetParent === null) return
      const n = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase())
      if (n >= 0 && e.key.length === 1) pick(n)
      else if (e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const header = (
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
  )

  if (finished) {
    const pct = Math.round((correct / items.length) * 100)
    return (
      <div ref={root} className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        {header}
        <div className="mt-10 text-center">
          <p className="text-sm text-muted">Your score</p>
          <p className="mt-1 font-serif text-5xl font-semibold tracking-tight">
            {correct} / {items.length}
          </p>
          <p className="mt-2 text-muted">
            {pct >= 80 ? 'Strong result.' : pct >= 50 ? 'Good progress — review the questions you missed.' : 'Worth another pass through the sources.'}
          </p>
          <div className="mt-8 flex justify-center gap-2">
            <Button variant="primary" onClick={retake}>
              Retake quiz
            </Button>
            <Button onClick={onBack}>Back to study</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={root} className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      {header}
      <div className="mt-6 flex items-center gap-3">
        <span className="text-sm font-medium text-muted">
          Question {index + 1} of {items.length}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <div className="h-full bg-ink transition-[width]" style={{ width: `${(index / items.length) * 100}%` }} />
        </div>
      </div>

      <h3 className="mt-5 font-serif text-[1.35rem] font-semibold leading-snug">{item.question}</h3>

      <div className="mt-5 space-y-2" role="group" aria-label="Answer options">
        {item.options.map((option, i) => {
          const isAnswer = i === item.answer_index
          const state = picked === null ? 'idle' : isAnswer ? 'correct' : i === picked ? 'wrong' : 'dim'
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={picked !== null}
              aria-label={`${LETTERS[i]}: ${option}${state === 'correct' ? ' (correct answer)' : state === 'wrong' ? ' (your answer, incorrect)' : ''}`}
              className={cx(
                'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                state === 'idle' && 'border-line-strong bg-surface hover:border-ink',
                state === 'correct' && 'border-ok bg-ok-soft',
                state === 'wrong' && 'border-danger bg-danger-soft',
                state === 'dim' && 'border-line bg-surface opacity-60',
              )}
            >
              <span
                className={cx(
                  'mt-px flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                  state === 'correct' ? 'bg-ok text-paper' : state === 'wrong' ? 'bg-danger text-paper' : 'bg-sunken text-muted',
                )}
              >
                {LETTERS[i]}
              </span>
              <span className="pt-px">{option}</span>
            </button>
          )
        })}
      </div>

      {picked !== null && (
        <div className="mt-5 rounded-lg border border-line bg-surface p-4" role="status">
          <p className="font-medium">{picked === item.answer_index ? 'Correct.' : 'Not quite.'}</p>
          <p className="mt-1 font-serif text-[1.05rem] leading-relaxed">
            {item.explanation}
            <CitationChip citation={{ n: 1, source: item.source }} onOpen={onOpenSource} />
          </p>
          <p className="mt-2 text-sm text-muted">
            {item.source.filename}, page {item.source.page_number}
          </p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <span className="text-xs text-faint">Keys: 1–4 to answer, Enter for next</span>
        <Button variant="primary" onClick={next} disabled={picked === null}>
          {last ? 'See score' : 'Next question'}
        </Button>
      </div>
    </div>
  )
}
