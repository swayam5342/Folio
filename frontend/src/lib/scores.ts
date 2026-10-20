/**
 * Display helpers for retrieval scores.
 *
 * The cross-encoder's probabilities are sharply polarised: the best passage is
 * often ~0.99 and every other one ~0.0001, so printing them with two decimals
 * shows "0.00" for nearly everything. These keep small values readable and draw
 * bars on the model's own (logit) scale, where those passages still differ.
 */

/** 0.93 → "0.93", 0.00012 → "1e-4", 0 → "0". */
export function formatScore(p: number): string {
  if (p >= 0.01) return p.toFixed(2)
  if (p <= 0) return '0'
  return p.toExponential(0)
}

/** Bar width (0.03-1) for a reranker probability, on a logit scale: ~1e-5 → short, 0.5 → 3/4, 0.98 → full. */
export function rerankBar(p: number): number {
  const q = Math.min(Math.max(p, 1e-7), 1 - 1e-7)
  const logit = Math.log(q / (1 - q))
  return Math.min(Math.max((logit + 12) / 16, 0.03), 1)
}
