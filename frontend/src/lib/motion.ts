/** Motion tokens for Framer Motion, mirroring the CSS variables in styles/tokens.css. */

export const duration = {
  instant: 0.09,
  fast: 0.15,
  base: 0.22,
  slow: 0.35,
} as const

export const ease = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const

export const spring = {
  /** Buttons, chips, toggles: quick with a little bounce. */
  snappy: { type: 'spring', stiffness: 520, damping: 32, mass: 0.7 },
  /** Cards and panels moving into place. */
  gentle: { type: 'spring', stiffness: 260, damping: 28 },
  /** Hover cards and popovers. */
  pop: { type: 'spring', stiffness: 420, damping: 22 },
} as const

/** Delay between items in a list entrance. */
export const STAGGER = 0.04
