/** The platform's positive/negative pair. Money, deltas, statuses and any other
 *  "good/bad" signal read from here so there is one red and one green, not the
 *  four near-misses this file replaced.
 *
 *  These are the tokens, not values: a theme decides what its green and red
 *  are, and the tints have to move with the surfaces they sit on. Held as
 *  fixed hexes they were Sunlit's — a pale cream-pink chip under a dark
 *  theme, with dark-theme ink on it. */

export const POSITIVE      = 'var(--sb-positive)'
export const POSITIVE_DEEP = 'var(--sb-positive-deep)'
export const POSITIVE_TINT = 'var(--sb-positive-tint)'

export const NEGATIVE      = 'var(--sb-negative)'
export const NEGATIVE_DEEP = 'var(--sb-negative-deep)'
export const NEGATIVE_TINT = 'var(--sb-negative-tint)'

/** The colour a signed figure should be drawn in. Zero is neither. */
export function signColor(n: number, neutral = 'var(--sb-ink-4)'): string {
  return n > 0 ? POSITIVE : n < 0 ? NEGATIVE : neutral
}
