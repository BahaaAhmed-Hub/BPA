/** The platform's positive/negative pair. Money, deltas, statuses and any other
 *  "good/bad" signal read from here so there is one red and one green, not the
 *  four near-misses this file replaced.
 *
 *  Both are chosen to clear 4.5:1 against the page ground (#F7F4EA) at the small
 *  bold sizes figures are usually set in, and to carry white text when used as a
 *  fill. The tints are for chip and row backgrounds. */

export const POSITIVE      = '#0C8140'
export const POSITIVE_DEEP = '#0A6B36'
export const POSITIVE_TINT = '#E2F0E7'

export const NEGATIVE      = '#C62828'
export const NEGATIVE_DEEP = '#A31C1C'
export const NEGATIVE_TINT = '#FAE3E3'

/** The colour a signed figure should be drawn in. Zero is neither. */
export function signColor(n: number, neutral = '#9B9180'): string {
  return n > 0 ? POSITIVE : n < 0 ? NEGATIVE : neutral
}
