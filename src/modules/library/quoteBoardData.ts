import { useMemo } from 'react'
import { useLibraryStore } from './libraryStore'
import type { Book, Quote } from './types'

export interface BoardItem { quote: Quote; book: Book }
export interface BoardFilter { query: string; bookId: string; onlyMarked: boolean }

/**
 * Every quote across the library, joined to its book, newest first. A quote
 * whose book is not loaded yet (or is gone) is left out rather than shown with
 * a blank source — attribution is the point of a quote board.
 */
export function useBoardQuotes(f: BoardFilter): { items: BoardItem[]; all: number } {
  const quotes = useLibraryStore(s => s.quotes)
  const books = useLibraryStore(s => s.books)
  const bookmarks = useLibraryStore(s => s.bookmarks)
  return useMemo(() => {
    const byId = new Map(books.map(b => [b.id, b]))
    const marked = new Set(bookmarks.filter(m => m.kind === 'quote').map(m => m.quoteId))
    const needle = f.query.trim().toLowerCase()
    const joined = quotes.flatMap(q => { const book = byId.get(q.bookId); return book ? [{ quote: q, book }] : [] })
    const items = joined
      .filter(({ quote, book }) =>
        (!f.bookId || book.id === f.bookId) &&
        (!f.onlyMarked || marked.has(quote.id)) &&
        (!needle || [quote.body, book.title, ...book.authors].some(s => s?.toLowerCase().includes(needle))))
      .sort((a, b) => b.quote.createdAt.localeCompare(a.quote.createdAt))
    return { items, all: joined.length }
  }, [quotes, books, bookmarks, f.query, f.bookId, f.onlyMarked])
}

/** The quotes a poster or an explanation can use: the ones with words. A photo
 *  with no text typed yet is a quote, but there is nothing on it to set in type
 *  or to explain. */
export const withText = (items: BoardItem[]): BoardItem[] => items.filter(i => !!i.quote.body?.trim())
