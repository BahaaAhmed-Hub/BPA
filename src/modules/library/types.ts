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

export const STATUS_LABEL: Record<BookStatus, string> = {
  want: 'Want to read', reading: 'Reading', finished: 'Finished', paused: 'Paused', abandoned: 'Set aside',
}
export const FORMAT_LABEL: Record<BookFormat, string> = {
  print: 'Print', ebook: 'E-book', pdf: 'PDF', audio: 'Audio',
}
