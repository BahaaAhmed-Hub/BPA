import type { Book } from './types'

// A spine's colour is the book's own identity on the shelf, so it is chosen
// once and kept — from the theme's categorical ramp and deep semantics, which
// is what makes a shelf in Glass & Depth read as Glass rather than as a cream
// shelf pasted onto a dark page. `inkOn()` picks the label ink per spine.
export const SPINE_COLORS = [
  'var(--sb-cat-1)', 'var(--sb-cat-2)', 'var(--sb-cat-3)', 'var(--sb-cat-4)',
  'var(--sb-cat-5)', 'var(--sb-cat-6)', 'var(--sb-accent-deep)', 'var(--sb-positive-deep)',
  'var(--sb-negative-deep)', 'var(--sb-ink-2)',
] as const

export function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const spineColorOf = (b: Pick<Book, 'id' | 'spineColor'>): string =>
  b.spineColor ?? SPINE_COLORS[hash(b.id) % SPINE_COLORS.length]

/** Thickness follows page count, height varies a little by id — stable across
 *  loads, so the shelf does not reshuffle itself. Never under 34px: a spine is
 *  a touch target, and a finger needs more than a sliver. */
export function spineSize(b: Pick<Book, 'id' | 'pages'>): { w: number; h: number } {
  const w = Math.min(60, Math.max(34, Math.round(30 + (b.pages ?? 280) / 14)))
  const h = 158 + (hash(b.id) % 5) * 9
  return { w, h }
}

export const authorLine = (b: Pick<Book, 'authors'>): string => b.authors.join(', ')
