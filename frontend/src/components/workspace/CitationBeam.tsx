import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTheme } from '../../lib/theme'

export type Point = { x: number; y: number }

const VISIBLE_MS = 1100

/**
 * A short-lived curved line from a clicked citation chip to the passage it
 * highlighted in the viewer, so the eye can follow the jump across panes.
 * Purely decorative (aria-hidden); skipped on narrow screens, with reduced
 * motion and in Calm mode.
 */
export default function CitationBeam({ from, to, color }: { from: Point; to: Point; color: number }) {
  const reduced = useReducedMotion()
  const calm = useTheme((s) => s.calm)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [])

  if (!visible || reduced || calm || !window.matchMedia('(min-width: 1024px)').matches) return null

  // Horizontal-tangent cubic curve: leaves the chip sideways and arrives sideways.
  const midX = (from.x + to.x) / 2
  const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
  return createPortal(
    <svg aria-hidden className="pointer-events-none fixed inset-0 z-[60] h-full w-full" style={{ color: `var(--src-${color})` }}>
      <motion.path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0.9 }}
        animate={{ pathLength: 1, opacity: [0.9, 0.9, 0] }}
        transition={{ pathLength: { duration: 0.45, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: VISIBLE_MS / 1000, times: [0, 0.6, 1] } }}
      />
      <motion.circle
        cx={to.x}
        cy={to.y}
        r={5}
        fill="currentColor"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.6, 1], opacity: [0, 1, 0] }}
        transition={{ delay: 0.35, duration: 0.7 }}
      />
    </svg>,
    document.body,
  )
}
