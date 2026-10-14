import { estimateDims } from './bookDimensions'
import type { Book } from './types'

// A spine's colour is the book's own identity on the shelf, so it is chosen
// once and kept — from the theme's categorical ramp and deep semantics, which
// is what makes a shelf in Glass & Depth read as Glass rather than as a cream
// shelf pasted onto a dark page. `inkOn()` picks the label ink per spine.
// (A book with a readable cover takes its colour from the cover instead: see `coverTone.ts`.)
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

/** Screen pixels per millimetre of real book. One scale for the whole shelf, so a pocket paperback stands
 *  visibly shorter than a hardback and a 900-page novel visibly thicker than a 120-page one. */
export const PX_PER_MM = 1.1

export interface Box {
  /** Thickness of the spine on screen. */
  w: number
  /** Height. */
  h: number
  /** Depth (the cover's width) — only seen when a book is turned. */
  d: number
  /** True when no catalogue gave a size and it is worked out from the pages. */
  estimated: boolean
}

/** The book as a box. A measured size is used as it is; otherwise the same estimate the lookup falls back to.
 *  A spine is never thinner than 16px: real booklets are, but a finger needs something to land on. */
export function boxOf(b: Pick<Book, 'pages' | 'format' | 'heightMm' | 'widthMm' | 'thicknessMm' | 'dimsSource'>): Box {
  const e = estimateDims({ pages: b.pages })
  const h = b.heightMm ?? e.heightMm, w = b.widthMm ?? e.widthMm, t = b.thicknessMm ?? e.thicknessMm
  return {
    w: Math.max(16, Math.round(t * PX_PER_MM)),
    h: Math.round(h * PX_PER_MM),
    d: Math.round(w * PX_PER_MM),
    estimated: b.heightMm === undefined || b.dimsSource === 'estimate',
  }
}

/** How a spine is dressed. Stable per book, so the shelf never reshuffles its own look. */
export type SpineStyle = 'plain' | 'bands' | 'label' | 'stripe'
export function spineStyleOf(b: Pick<Book, 'id'>, w: number): SpineStyle {
  const s = (['plain', 'bands', 'label', 'stripe'] as const)[hash(b.id + 's') % 4]
  return s === 'label' && w < 26 ? 'bands' : s
}

export const authorLine = (b: Pick<Book, 'authors'>): string => b.authors.join(', ')
