import { create } from 'zustand'
import { pushUndo, notify, suppressUndo } from '@/lib/undo'
import { markLocalWrite } from '@/lib/liveSync'
import {
  loadLibrary, saveBooks, removeBook, saveList, removeList, setBookLists,
  loadLibraryExtras, saveQuote, removeQuote, saveNote, removeNote, saveBookmark, removeBookmark,
} from './libraryDb'
import type { Book, Bookmark, LibList, ListBook, ListKind, Note, Quote } from './types'

// ─── Library store ───────────────────────────────────────────────────────────
// Authoritative-from-the-server, like Finance: `loadFromDB` replaces the lists
// and every write goes straight to Postgres. Nothing is persisted locally, so
// there is no second copy to disagree with the first.
//
// Writes are optimistic — the shelf must answer a tap now — and a failed write
// says so and reloads, which puts the screen back to what is true rather than
// leaving a book on it that the server never heard of.

export type BookmarkTarget =
  | { kind: 'book'; bookId: string }
  | { kind: 'quote'; bookId: string; quoteId: string }
  | { kind: 'page'; bookId: string; page: number }

const sameMark = (m: Bookmark, t: BookmarkTarget) =>
  m.kind === t.kind && m.bookId === t.bookId &&
  (t.kind === 'book' || (t.kind === 'quote' ? m.quoteId === t.quoteId : m.page === t.page))

interface LibraryState {
  books: Book[]
  lists: LibList[]
  links: ListBook[]
  quotes: Quote[]
  notes: Note[]
  bookmarks: Bookmark[]
  /** 20260026 has not run: the shelf works, quotes and notes cannot be saved. */
  extrasMissing: boolean
  /** True until the first answer. Distinguishes "fetching" from "empty" — a
   *  reload is not an empty ledger, and "No books yet" about a shelf that is on
   *  its way is the most misleading thing this screen could say. */
  loading: boolean
  /** The tables are not there: migration 20260025 has not run. */
  missing: boolean

  loadFromDB: () => Promise<void>
  clearAll: () => void

  addBook: (b: Partial<Book> & { title: string }, listIds?: string[]) => Book
  updateBook: (id: string, patch: Partial<Book>) => void
  deleteBook: (id: string) => void

  addList: (name: string, kind: ListKind, extra?: Partial<LibList>) => LibList
  updateList: (id: string, patch: Partial<LibList>) => void
  deleteList: (id: string) => void

  listsOf: (bookId: string) => string[]
  setBookLists: (bookId: string, listIds: string[]) => void

  addQuote: (bookId: string, q: Partial<Quote>) => Quote
  updateQuote: (id: string, patch: Partial<Quote>) => void
  deleteQuote: (id: string) => void

  addNote: (anchor: Pick<Note, 'scope'> & Partial<Note>, body: string) => Note
  updateNote: (id: string, body: string) => void
  deleteNote: (id: string) => void

  /** A bookmark on a book (a favourite), a quote, or a page of its file. */
  isBookmarked: (target: BookmarkTarget) => boolean
  toggleBookmark: (target: BookmarkTarget) => void
}

const nowISO = () => new Date().toISOString()

function failed(what: string, reload: () => Promise<void>) {
  return (e: unknown) => {
    notify(`Could not ${what} — ${e instanceof Error ? e.message : 'the server refused it'}`)
    void reload()
  }
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  books: [], lists: [], links: [], quotes: [], notes: [], bookmarks: [], extrasMissing: false, loading: true, missing: false,

  async loadFromDB() {
    const data = await loadLibrary()
    // A failed read is not evidence the shelf is empty: keep what is on screen.
    if (data === null) { set({ loading: false }); return }
    if (data === 'missing') { set({ loading: false, missing: true }); return }
    set({ books: data.books, lists: data.lists, links: data.links, loading: false, missing: false })

    // The second half, read after the shelf so a missing 20260026 never costs
    // the books. A failed read keeps what is on screen.
    const extras = await loadLibraryExtras()
    if (extras === 'missing') set({ extrasMissing: true })
    else if (extras) set({ quotes: extras.quotes, notes: extras.notes, bookmarks: extras.bookmarks, extrasMissing: false })
  },

  clearAll() { set({ books: [], lists: [], links: [], quotes: [], notes: [], bookmarks: [], extrasMissing: false, loading: true, missing: false }) },

  addBook(input, listIds = []) {
    const { books } = get()
    const book: Book = {
      authors: [], source: 'manual', status: 'want', format: 'print', rating: 0,
      ...input,
      id: crypto.randomUUID(),
      // New books go to the end of the shelf.
      shelfOrder: books.reduce((m, b) => Math.max(m, b.shelfOrder), -1) + 1,
      addedAt: nowISO(), updatedAt: nowISO(),
    }
    const links: ListBook[] = listIds.map(listId => ({ listId, bookId: book.id, sortOrder: 0 }))
    set(s => ({ books: [...s.books, book], links: [...s.links, ...links] }))
    pushUndo(`Add “${book.title}”`, () => suppressUndo(() => get().deleteBook(book.id)))
    void saveBooks([book])
      .then(() => listIds.length ? setBookLists(book.id, listIds, []) : undefined)
      .catch(failed('save the book', get().loadFromDB))
    return book
  },

  updateBook(id, patch) {
    const before = get().books.find(b => b.id === id)
    if (!before) return
    const next: Book = { ...before, ...patch, id, updatedAt: nowISO() }
    set(s => ({ books: s.books.map(b => (b.id === id ? next : b)) }))
    void saveBooks([next]).catch(failed('save the change', get().loadFromDB))
  },

  deleteBook(id) {
    const { books, links } = get()
    const book = books.find(b => b.id === id)
    if (!book) return
    const mine = links.filter(l => l.bookId === id)
    const { quotes, notes, bookmarks } = get()
    const myQuotes = quotes.filter(q => q.bookId === id)
    const myNotes = notes.filter(n => n.bookId === id || myQuotes.some(q => q.id === n.quoteId))
    const myMarks = bookmarks.filter(m => m.bookId === id)
    set(s => ({
      books: s.books.filter(b => b.id !== id), links: s.links.filter(l => l.bookId !== id),
      quotes: s.quotes.filter(q => q.bookId !== id), bookmarks: s.bookmarks.filter(m => m.bookId !== id),
      notes: s.notes.filter(n => !myNotes.includes(n)),
    }))
    // Undo puts back everything the delete took — the book, its lists, and (the
    // server cascades them away) every quote, note and bookmark it carried.
    pushUndo(`Delete “${book.title}”`, () => {
      set(s => ({
        books: [...s.books, book], links: [...s.links, ...mine],
        quotes: [...s.quotes, ...myQuotes], notes: [...s.notes, ...myNotes], bookmarks: [...s.bookmarks, ...myMarks],
      }))
      void (async () => {
        await saveBooks([book])
        if (mine.length) await setBookLists(id, mine.map(l => l.listId), [])
        for (const q of myQuotes) await saveQuote(q)
        for (const n of myNotes) await saveNote(n)
        for (const m of myMarks) await saveBookmark(m)
      })().catch(failed('restore the book', get().loadFromDB))
    })
    void removeBook(id).catch(failed('delete the book', get().loadFromDB))
  },

  addList(name, kind, extra = {}) {
    const { lists } = get()
    const list: LibList = {
      ...extra, id: crypto.randomUUID(), name: name.trim(), kind,
      sortOrder: lists.reduce((m, l) => Math.max(m, l.sortOrder), -1) + 1,
    }
    set(s => ({ lists: [...s.lists, list] }))
    void saveList(list).catch(failed('save the list', get().loadFromDB))
    return list
  },

  updateList(id, patch) {
    const before = get().lists.find(l => l.id === id)
    if (!before) return
    const next = { ...before, ...patch, id }
    set(s => ({ lists: s.lists.map(l => (l.id === id ? next : l)) }))
    void saveList(next).catch(failed('save the list', get().loadFromDB))
  },

  deleteList(id) {
    const { lists, links } = get()
    const list = lists.find(l => l.id === id)
    if (!list) return
    const mine = links.filter(l => l.listId === id)
    set(s => ({ lists: s.lists.filter(l => l.id !== id), links: s.links.filter(l => l.listId !== id) }))
    // The books stay: deleting a list takes the grouping, never the books in it.
    pushUndo(`Delete “${list.name}”`, () => {
      set(s => ({ lists: [...s.lists, list], links: [...s.links, ...mine] }))
      void saveList(list).then(async () => {
        for (const l of mine) await setBookLists(l.bookId, [id], [])
      }).catch(failed('restore the list', get().loadFromDB))
    })
    void removeList(id).catch(failed('delete the list', get().loadFromDB))
  },

  listsOf(bookId) {
    return get().links.filter(l => l.bookId === bookId).map(l => l.listId)
  },

  setBookLists(bookId, listIds) {
    const existing = get().listsOf(bookId)
    markLocalWrite('library')
    set(s => ({
      links: [
        ...s.links.filter(l => l.bookId !== bookId),
        ...listIds.map(listId => ({ listId, bookId, sortOrder: 0 })),
      ],
    }))
    void setBookLists(bookId, listIds, existing).catch(failed('save the lists', get().loadFromDB))
  },

  addQuote(bookId, input) {
    const q: Quote = { kind: 'text', ...input, id: crypto.randomUUID(), bookId, createdAt: nowISO(), updatedAt: nowISO() }
    set(s => ({ quotes: [...s.quotes, q] }))
    pushUndo('Add a quote', () => suppressUndo(() => get().deleteQuote(q.id)))
    void saveQuote(q).catch(failed('save the quote', get().loadFromDB))
    return q
  },

  updateQuote(id, patch) {
    const before = get().quotes.find(q => q.id === id)
    if (!before) return
    const next: Quote = { ...before, ...patch, id, updatedAt: nowISO() }
    set(s => ({ quotes: s.quotes.map(q => (q.id === id ? next : q)) }))
    void saveQuote(next).catch(failed('save the quote', get().loadFromDB))
  },

  deleteQuote(id) {
    const { quotes, notes, bookmarks } = get()
    const q = quotes.find(x => x.id === id)
    if (!q) return
    const myNotes = notes.filter(n => n.quoteId === id)
    const myMarks = bookmarks.filter(m => m.quoteId === id)
    set(s => ({ quotes: s.quotes.filter(x => x.id !== id), notes: s.notes.filter(n => n.quoteId !== id), bookmarks: s.bookmarks.filter(m => m.quoteId !== id) }))
    pushUndo('Delete a quote', () => {
      set(s => ({ quotes: [...s.quotes, q], notes: [...s.notes, ...myNotes], bookmarks: [...s.bookmarks, ...myMarks] }))
      void (async () => {
        await saveQuote(q)
        for (const n of myNotes) await saveNote(n)
        for (const m of myMarks) await saveBookmark(m)
      })().catch(failed('restore the quote', get().loadFromDB))
    })
    void removeQuote(id).catch(failed('delete the quote', get().loadFromDB))
  },

  addNote(anchor, body) {
    const n: Note = { ...anchor, id: crypto.randomUUID(), body, createdAt: nowISO(), updatedAt: nowISO() }
    set(s => ({ notes: [...s.notes, n] }))
    void saveNote(n).catch(failed('save the note', get().loadFromDB))
    return n
  },

  updateNote(id, body) {
    const before = get().notes.find(n => n.id === id)
    if (!before) return
    const next = { ...before, body, updatedAt: nowISO() }
    set(s => ({ notes: s.notes.map(n => (n.id === id ? next : n)) }))
    void saveNote(next).catch(failed('save the note', get().loadFromDB))
  },

  deleteNote(id) {
    const n = get().notes.find(x => x.id === id)
    if (!n) return
    set(s => ({ notes: s.notes.filter(x => x.id !== id) }))
    pushUndo('Delete a note', () => {
      set(s => ({ notes: [...s.notes, n] }))
      void saveNote(n).catch(failed('restore the note', get().loadFromDB))
    })
    void removeNote(id).catch(failed('delete the note', get().loadFromDB))
  },

  isBookmarked(t) {
    return get().bookmarks.some(m => sameMark(m, t))
  },

  toggleBookmark(t) {
    const hit = get().bookmarks.find(m => sameMark(m, t))
    if (hit) {
      set(s => ({ bookmarks: s.bookmarks.filter(m => m.id !== hit.id) }))
      void removeBookmark(hit.id).catch(failed('remove the bookmark', get().loadFromDB))
      return
    }
    const m: Bookmark = {
      id: crypto.randomUUID(), kind: t.kind, bookId: t.bookId, createdAt: nowISO(),
      quoteId: t.kind === 'quote' ? t.quoteId : undefined, page: t.kind === 'page' ? t.page : undefined,
    }
    set(s => ({ bookmarks: [...s.bookmarks, m] }))
    void saveBookmark(m).catch(failed('save the bookmark', get().loadFromDB))
  },
}))
