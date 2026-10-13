// ─── Library — the shapes ────────────────────────────────────────────────────
// camelCase here, snake_case in `libraryDb.ts`. The mapping lives in one place
// so a column rename is one edit rather than a hunt through the screens.

export type BookStatus = 'want' | 'reading' | 'finished' | 'paused' | 'abandoned'
export type BookFormat = 'print' | 'ebook' | 'pdf' | 'audio'
export type BookSource = 'manual' | 'openlibrary' | 'google'

export interface Book {
  id: string
  title: string
  subtitle?: string
  authors: string[]
  isbn?: string
  publisher?: string
  publishedYear?: number
  pages?: number
  language?: string
  description?: string
  coverUrl?: string
  source: BookSource
  sourceKey?: string
  status: BookStatus
  format: BookFormat
  /** 0 is unrated. */
  rating: number
  review?: string
  /** The spine's own colour, so the shelf does not repaint itself each load. */
  spineColor?: string
  /** Phase 2: an uploaded PDF in the `library` bucket. */
  filePath?: string
  /** 3b: on the buy-later list. Absent until the migration (20260028) has run. */
  toBuy?: boolean
  shelfOrder: number
  startedOn?: string
  finishedOn?: string
  addedAt: string
  updatedAt: string
}

export type ListKind = 'list' | 'category'

export interface LibList {
  id: string
  name: string
  kind: ListKind
  description?: string
  thumbUrl?: string
  color?: string
  sortOrder: number
}

export interface ListBook {
  listId: string
  bookId: string
  sortOrder: number
}

// ─── Phase 3d: authors and series you follow ────────────────────────────────

export type FollowKind = 'author' | 'series'

export interface Follow {
  id: string
  kind: FollowKind
  name: string
  /** The Open Library search this follow asks. */
  query: string
  authorKey?: string
  /** Works that existed when you followed (or last said "seen"). */
  seenKeys: string[]
  createdAt: string
}

// ─── Phase 4a: reading and listening sessions ───────────────────────────────

export type SessionKind = 'read' | 'listen'

export interface ReadingSession {
  id: string
  bookId: string
  kind: SessionKind
  /** The day it happened, YYYY-MM-DD (local) — not when it was logged. */
  on: string
  minutes: number
  /** Pages read in this sitting, when reading. */
  pages?: number
  /** The page you had reached at the end of it. */
  toPage?: number
  createdAt: string
}

export const STATUS_LABEL: Record<BookStatus, string> = {
  want: 'Want to read', reading: 'Reading', finished: 'Finished', paused: 'Paused', abandoned: 'Set aside',
}
export const FORMAT_LABEL: Record<BookFormat, string> = {
  print: 'Print', ebook: 'E-book', pdf: 'PDF', audio: 'Audio',
}

// ─── Phase 2: quotes, notes, bookmarks ───────────────────────────────────────

export type QuoteKind = 'text' | 'image'

export interface Quote {
  id: string
  bookId: string
  kind: QuoteKind
  body?: string
  /** A photograph of the page, in the `library` bucket (2c). */
  imagePath?: string
  page?: number
  line?: number
  color?: string
  /** The explainer's JSON (see `explainQuote.ts`), or `null` to clear it. Absent
   *  means never asked — which is not the same as asked and emptied. */
  explanation?: string | null
  createdAt: string
  updatedAt: string
}

/** Which of a note's anchors is the one it hangs off. */
export type NoteScope = 'book' | 'quote' | 'list' | 'page' | 'line'

export interface Note {
  id: string
  scope: NoteScope
  bookId?: string
  quoteId?: string
  listId?: string
  page?: number
  line?: number
  body: string
  createdAt: string
  updatedAt: string
}

export type BookmarkKind = 'book' | 'page' | 'line' | 'quote'

export interface Bookmark {
  id: string
  kind: BookmarkKind
  bookId: string
  quoteId?: string
  page?: number
  line?: number
  label?: string
  createdAt: string
}

/** Where a thing sits in a book, for display: "p. 42 · line 3". */
export const placeOf = (x: { page?: number; line?: number }): string =>
  [x.page != null ? `p. ${x.page}` : '', x.line != null ? `line ${x.line}` : ''].filter(Boolean).join(' · ')

// ─── Phase 4c: reading plans ────────────────────────────────────────────────

export type PlanPer = 'day' | 'week'

/** What you mean to do with a book. Pace and status are derived (`planStats`). */
export interface ReadingPlan {
  id: string
  bookId: string
  /** The day you want to be done by, YYYY-MM-DD (local). */
  finishBy?: string
  /** Minutes you mean to give it … */
  minutes?: number
  /** … each day or each week. */
  per: PlanPer
  createdAt: string
}
