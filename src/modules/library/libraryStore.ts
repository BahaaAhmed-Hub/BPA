import { create } from 'zustand'
import { pushUndo, notify, suppressUndo } from '@/lib/undo'
import { markLocalWrite } from '@/lib/liveSync'
import {
  loadLibrary, saveBooks, removeBook, saveList, removeList, setBookLists,
} from './libraryDb'
import type { Book, LibList, ListBook, ListKind } from './types'

// ─── Library store ───────────────────────────────────────────────────────────
// Authoritative-from-the-server, like Finance: `loadFromDB` replaces the lists
// and every write goes straight to Postgres. Nothing is persisted locally, so
// there is no second copy to disagree with the first.
//
// Writes are optimistic — the shelf must answer a tap now — and a failed write
// says so and reloads, which puts the screen back to what is true rather than
// leaving a book on it that the server never heard of.

interface LibraryState {
  books: Book[]
  lists: LibList[]
  links: ListBook[]
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
}

const nowISO = () => new Date().toISOString()

function failed(what: string, reload: () => Promise<void>) {
  return (e: unknown) => {
    notify(`Could not ${what} — ${e instanceof Error ? e.message : 'the server refused it'}`)
    void reload()
  }
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  books: [], lists: [], links: [], loading: true, missing: false,

  async loadFromDB() {
    const data = await loadLibrary()
    // A failed read is not evidence the shelf is empty: keep what is on screen.
    if (data === null) { set({ loading: false }); return }
    if (data === 'missing') { set({ loading: false, missing: true }); return }
    set({ books: data.books, lists: data.lists, links: data.links, loading: false, missing: false })
  },

  clearAll() { set({ books: [], lists: [], links: [], loading: true, missing: false }) },

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
    set(s => ({ books: s.books.filter(b => b.id !== id), links: s.links.filter(l => l.bookId !== id) }))
    // Undo puts the book and its lists back, not just the row.
    pushUndo(`Delete “${book.title}”`, () => {
      set(s => ({ books: [...s.books, book], links: [...s.links, ...mine] }))
      void saveBooks([book])
        .then(() => mine.length ? setBookLists(id, mine.map(l => l.listId), []) : undefined)
        .catch(failed('restore the book', get().loadFromDB))
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
}))
