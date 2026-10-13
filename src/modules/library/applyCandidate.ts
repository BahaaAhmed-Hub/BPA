import type { BookCandidate } from './bookLookup'
import type { Book } from './types'

/** The book a lookup result becomes when it is put on the shelf as wanted. */
export const bookFromCandidate = (c: BookCandidate): Partial<Book> & { title: string } => ({
  title: c.title, subtitle: c.subtitle, authors: c.authors, isbn: c.isbn, publisher: c.publisher, publishedYear: c.publishedYear,
  pages: c.pages, language: c.language, description: c.description, coverUrl: c.coverUrl, source: c.source, sourceKey: c.sourceKey, status: 'want',
})

/**
 * What to take from a lookup result for a book that already exists: the cover
 * always (that is usually why you asked), everything else only where the book
 * has nothing — a page count you typed is not replaced by a catalogue's guess.
 */
export function applyCandidate(book: Book, c: BookCandidate): Partial<Book> {
  const p: Partial<Book> = { source: c.source, sourceKey: c.sourceKey }
  if (c.coverUrl) p.coverUrl = c.coverUrl
  if (!book.subtitle && c.subtitle) p.subtitle = c.subtitle
  if (!book.authors.length && c.authors.length) p.authors = c.authors
  if (!book.isbn && c.isbn) p.isbn = c.isbn
  if (!book.publisher && c.publisher) p.publisher = c.publisher
  if (!book.publishedYear && c.publishedYear) p.publishedYear = c.publishedYear
  if (!book.pages && c.pages) p.pages = c.pages
  if (!book.language && c.language) p.language = c.language
  if (!book.description && c.description) p.description = c.description
  return p
}
