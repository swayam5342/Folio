import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'

import { useTheme } from '../../lib/theme'

/** Framer Motion follows the OS reduced-motion setting, and Calm mode turns motion off entirely. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const calm = useTheme((s) => s.calm)
  return <MotionConfig reducedMotion={calm ? 'always' : 'user'}>{children}</MotionConfig>
}
