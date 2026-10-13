import { create } from 'zustand'
import { pushUndo, notify, suppressUndo } from '@/lib/undo'
import { markLocalWrite } from '@/lib/liveSync'
import {
  loadLibrary, saveBooks, removeBook, saveList, removeList, setBookLists,
  loadLibraryExtras, loadFollows, saveFollow, removeFollow, loadNews, markNewsRead, removeNews, loadSessions, saveSession, removeSession, loadPlans, savePlan, removePlan, loadGoals, saveGoal, removeGoal, loadReviews, saveReview, removeReview, saveQuote, removeQuote, saveNote, removeNote, saveBookmark, removeBookmark,
} from './libraryDb'
import { schedule } from './srs'
import { todayISO } from './readingStats'
import type { Book, Bookmark, Follow, FollowNews, LibList, ListBook, ListKind, Note, Quote, Grade, QuoteReview, ReadingGoal, ReadingPlan, ReadingSession } from './types'

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
  follows: Follow[]
  /** Releases the scheduled check found while the app was closed. */
  news: FollowNews[]
  /** 20260037 has not run: nothing is found in the background; the live check still works. */
  newsMissing: boolean
  sessions: ReadingSession[]
  /** 20260030 has not run: sessions cannot be logged. */
  sessionsMissing: boolean
  plans: ReadingPlan[]
  /** 20260031 has not run: plans cannot be made. */
  plansMissing: boolean
  goals: ReadingGoal[]
  /** 20260033 has not run: goals cannot be set. */
  goalsMissing: boolean
  reviews: QuoteReview[]
  /** 20260034 has not run: quotes cannot be reviewed. */
  reviewsMissing: boolean
  /** 20260029 has not run: following cannot be saved. */
  followsMissing: boolean
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
  /** Many at once — one request, one undo entry. `listIds` applies to every book. */
  /** Fills in details on books that exist (covers, ISBNs from a lookup). One request, no undo entry of its own: if the books were taken back, there is nothing to fill. */
  patchBooks: (patches: { id: string; patch: Partial<Book> }[]) => void
  addBooks: (inputs: (Partial<Book> & { title: string; category?: string })[], listIds?: string[]) => Book[]
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

  /** Logs a sitting. The first one on a want-to-read book starts it. */
  addSession: (s: Omit<ReadingSession, 'id' | 'createdAt'>) => ReadingSession
  deleteSession: (id: string) => void

  /** One plan per book: setting one on a book that has it replaces it. */
  setPlan: (bookId: string, patch: Partial<Pick<ReadingPlan, 'finishBy' | 'minutes' | 'per'>>) => void
  /** Records (or forgets) the calendar block a plan made. Not undoable: the event lives in Google, and a restored row pointing at one that was removed — or missing one that exists — would orphan it. */
  setPlanBlock: (bookId: string, block: Pick<ReadingPlan, 'blockAt' | 'blockEventId' | 'blockSig'>) => void
  deletePlan: (bookId: string) => void

  /** Answers a review card. Undoable: a slipped finger is one ⌘Z, back to exactly what it was. */
  gradeQuote: (quoteId: string, grade: Grade, today?: string) => QuoteReview | null

  /** Refuses a second goal for the same year, kind and scope — the table's unique would anyway. */
  addGoal: (g: Omit<ReadingGoal, 'id' | 'createdAt'>) => ReadingGoal | null
  updateGoalTarget: (id: string, target: number) => void
  deleteGoal: (id: string) => void

  addFollow: (f: Omit<Follow, 'id' | 'createdAt'>) => Follow
  /** Widens what counts as already seen — never narrows it. */
  markSeen: (id: string, keys: string[]) => void
  unfollow: (id: string) => void
  /** Marks announcements as looked at, so the bell lets go of them. */
  readNews: (ids: string[]) => void

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
  books: [], lists: [], links: [], quotes: [], notes: [], bookmarks: [], follows: [], news: [], newsMissing: false, followsMissing: false, sessions: [], sessionsMissing: false, plans: [], plansMissing: false, goals: [], goalsMissing: false, reviews: [], reviewsMissing: false, extrasMissing: false, loading: true, missing: false,

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

    const follows = await loadFollows()
    if (follows === 'missing') set({ followsMissing: true })
    else if (follows) set({ follows, followsMissing: false })

    const news = await loadNews()
    if (news === 'missing') set({ newsMissing: true })
    else if (news) set({ news, newsMissing: false })

    const sessions = await loadSessions()
    if (sessions === 'missing') set({ sessionsMissing: true })
    else if (sessions) set({ sessions, sessionsMissing: false })

    const plans = await loadPlans()
    if (plans === 'missing') set({ plansMissing: true })
    else if (plans) set({ plans, plansMissing: false })

    const goals = await loadGoals()
    if (goals === 'missing') set({ goalsMissing: true })
    else if (goals) set({ goals, goalsMissing: false })

    const reviews = await loadReviews()
    if (reviews === 'missing') set({ reviewsMissing: true })
    else if (reviews) set({ reviews, reviewsMissing: false })
  },

  clearAll() { set({ books: [], lists: [], links: [], quotes: [], notes: [], bookmarks: [], follows: [], news: [], newsMissing: false, followsMissing: false, sessions: [], sessionsMissing: false, plans: [], plansMissing: false, goals: [], goalsMissing: false, reviews: [], reviewsMissing: false, extrasMissing: false, loading: true, missing: false }) },

  addSession(input) {
    const s: ReadingSession = { ...input, id: crypto.randomUUID(), createdAt: nowISO() }
    set(st => ({ sessions: [s, ...st.sessions] }))
    // A want-to-read book you have just spent time with is being read.
    const b = get().books.find(x => x.id === s.bookId)
    if (b && b.status === 'want') get().updateBook(b.id, { status: 'reading', startedOn: b.startedOn ?? s.on })
    pushUndo(`Log ${s.minutes} min`, () => suppressUndo(() => get().deleteSession(s.id)))
    void saveSession(s).catch(failed('log that', get().loadFromDB))
    return s
  },

  setPlan(bookId, patch) {
    const old = get().plans.find(p => p.bookId === bookId)
    const next: ReadingPlan = { ...(old ?? { id: crypto.randomUUID(), bookId, per: 'day' as const, createdAt: nowISO() }), ...patch }
    // A plan that says nothing is not a plan: the table refuses it too.
    if (next.finishBy === undefined && next.minutes === undefined) { get().deletePlan(bookId); return }
    set(st => ({ plans: old ? st.plans.map(p => (p.bookId === bookId ? next : p)) : [...st.plans, next] }))
    pushUndo(old ? 'Change plan' : 'Make a plan', () => suppressUndo(() => {
      if (old) {
        // Put back what was said, not the block as it stood: that belongs to the calendar as it is now.
        const cur = get().plans.find(p => p.bookId === bookId)
        const back: ReadingPlan = { ...old, blockAt: cur?.blockAt, blockEventId: cur?.blockEventId, blockSig: cur?.blockSig }
        set(st => ({ plans: st.plans.map(p => (p.bookId === bookId ? back : p)) })); void savePlan(back).catch(failed('restore that', get().loadFromDB))
      }
      else get().deletePlan(bookId)
    }))
    void savePlan(next).catch(failed('save the plan', get().loadFromDB))
  },

  gradeQuote(quoteId, grade, today = todayISO()) {
    if (!get().quotes.some(q => q.id === quoteId)) return null
    const prev = get().reviews.find(r => r.quoteId === quoteId) ?? null
    const next = schedule(quoteId, prev, grade, today)
    set(st => ({ reviews: prev ? st.reviews.map(r => (r.quoteId === quoteId ? next : r)) : [...st.reviews, next] }))
    // Back to exactly what it was — including "never reviewed", which is no row at all.
    pushUndo('Answer a quote', () => suppressUndo(() => {
      if (prev) { set(st => ({ reviews: st.reviews.map(r => (r.quoteId === quoteId ? prev : r)) })); void saveReview(prev).catch(failed('undo that', get().loadFromDB)) }
      else { set(st => ({ reviews: st.reviews.filter(r => r.quoteId !== quoteId) })); void removeReview(quoteId).catch(failed('undo that', get().loadFromDB)) }
    }))
    void saveReview(next).catch(failed('save that answer', get().loadFromDB))
    return next
  },

  addGoal(input) {
    if (get().goals.some(g => g.year === input.year && g.kind === input.kind && (g.listId ?? '') === (input.listId ?? ''))) return null
    const g: ReadingGoal = { ...input, id: crypto.randomUUID(), createdAt: nowISO() }
    set(st => ({ goals: [...st.goals, g] }))
    pushUndo('Set a goal', () => suppressUndo(() => get().deleteGoal(g.id)))
    void saveGoal(g).catch(failed('save the goal', get().loadFromDB))
    return g
  },

  updateGoalTarget(id, target) {
    const old = get().goals.find(g => g.id === id)
    if (!old || old.target === target) return
    const next = { ...old, target }
    set(st => ({ goals: st.goals.map(g => (g.id === id ? next : g)) }))
    pushUndo('Change goal', () => suppressUndo(() => { set(st => ({ goals: st.goals.map(g => (g.id === id ? old : g)) })); void saveGoal(old).catch(failed('restore that', get().loadFromDB)) }))
    void saveGoal(next).catch(failed('save the goal', get().loadFromDB))
  },

  deleteGoal(id) {
    const old = get().goals.find(g => g.id === id)
    if (!old) return
    set(st => ({ goals: st.goals.filter(g => g.id !== id) }))
    pushUndo('Remove goal', () => suppressUndo(() => { set(st => ({ goals: [...st.goals, old] })); void saveGoal(old).catch(failed('restore that', get().loadFromDB)) }))
    void removeGoal(id).catch(failed('remove the goal', get().loadFromDB))
  },

  setPlanBlock(bookId, block) {
    const old = get().plans.find(p => p.bookId === bookId)
    if (!old) return
    const next: ReadingPlan = { ...old, ...block }
    set(st => ({ plans: st.plans.map(p => (p.bookId === bookId ? next : p)) }))
    void savePlan(next).catch(failed('remember the calendar block', get().loadFromDB))
  },

  deletePlan(bookId) {
    const old = get().plans.find(p => p.bookId === bookId)
    if (!old) return
    set(st => ({ plans: st.plans.filter(p => p.bookId !== bookId) }))
    // What comes back has no block: the card takes the event off the calendar before it removes the plan,
    // so a row restored with the old id would point at an event that no longer exists.
    const back: ReadingPlan = { ...old, blockAt: undefined, blockEventId: undefined, blockSig: undefined }
    pushUndo('Remove plan', () => suppressUndo(() => { set(st => ({ plans: [...st.plans, back] })); void savePlan(back).catch(failed('restore that', get().loadFromDB)) }))
    void removePlan(old.id).catch(failed('remove the plan', get().loadFromDB))
  },

  deleteSession(id) {
    const s = get().sessions.find(x => x.id === id)
    if (!s) return
    set(st => ({ sessions: st.sessions.filter(x => x.id !== id) }))
    pushUndo(`Delete ${s.minutes} min`, () => suppressUndo(() => { set(st => ({ sessions: [s, ...st.sessions] })); void saveSession(s).catch(failed('restore that', get().loadFromDB)) }))
    void removeSession(id).catch(failed('delete that', get().loadFromDB))
  },

  addFollow(input) {
    const f: Follow = { ...input, id: crypto.randomUUID(), createdAt: nowISO() }
    set(s => ({ follows: [...s.follows, f] }))
    pushUndo(`Follow ${f.name}`, () => suppressUndo(() => get().unfollow(f.id)))
    void saveFollow(f).catch(failed('follow that', get().loadFromDB))
    return f
  },

  markSeen(id, keys) {
    const before = get().follows.find(x => x.id === id)
    if (!before) return
    // A set that only grows: "seen" is never un-said, and the cap keeps a
    // prolific author's row from growing without end (oldest dropped first).
    const next: Follow = { ...before, seenKeys: [...new Set([...before.seenKeys, ...keys])].slice(-400) }
    // What is now seen is no longer news: the announcements go with it, here and on the server.
    const gone = get().news.filter(n => n.followId === id && keys.includes(n.workKey)).map(n => n.workKey)
    set(s => ({ follows: s.follows.map(x => (x.id === id ? next : x)), news: s.news.filter(n => !(n.followId === id && keys.includes(n.workKey))) }))
    void saveFollow(next).catch(failed('save that', get().loadFromDB))
    if (gone.length) void removeNews(id, gone).catch(failed('clear that', get().loadFromDB))
  },

  readNews(ids) {
    const at = nowISO()
    const mine = get().news.filter(n => ids.includes(n.id) && !n.readAt).map(n => n.id)
    if (!mine.length) return
    set(s => ({ news: s.news.map(n => (mine.includes(n.id) ? { ...n, readAt: at } : n)) }))
    void markNewsRead(mine, at).catch(failed('save that', get().loadFromDB))
  },

  unfollow(id) {
    const f = get().follows.find(x => x.id === id)
    if (!f) return
    set(s => ({ follows: s.follows.filter(x => x.id !== id), news: s.news.filter(n => n.followId !== id) }))
    pushUndo(`Unfollow ${f.name}`, () => suppressUndo(() => { set(s => ({ follows: [...s.follows, f] })); void saveFollow(f).catch(failed('follow that again', get().loadFromDB)) }))
    void removeFollow(id).catch(failed('unfollow', get().loadFromDB))
  },

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

  patchBooks(patches) {
    const t = nowISO()
    const next: Book[] = []
    set(s => ({
      books: s.books.map(b => {
        const p = patches.find(x => x.id === b.id)
        if (!p) return b
        const n = { ...b, ...p.patch, id: b.id, updatedAt: t }
        next.push(n)
        return n
      }),
    }))
    if (next.length) void saveBooks(next).catch(failed('save the details', get().loadFromDB))
  },

  addBooks(inputs, listIds = []) {
    if (!inputs.length) return []
    const t = nowISO()
    let order = get().books.reduce((m, b) => Math.max(m, b.shelfOrder), -1)
    // A category is filed by name: a name you already have is yours (any case or punctuation),
    // and one you do not is made — once, however many books share it.
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const have = new Map(get().lists.filter(l => l.kind === 'category').map(l => [norm(l.name), l.id]))
    const created: LibList[] = []
    const listFor = (name?: string): string | undefined => {
      const k = name ? norm(name) : ''
      if (!k) return undefined
      let id = have.get(k)
      if (!id) {
        // Made here rather than through addList: the links below must wait for it to be saved, and addList's own
        // save is fire-and-forget — using both wrote the category twice.
        const l: LibList = { id: crypto.randomUUID(), name: name!.replace(/\s+/g, ' ').trim(), kind: 'category', sortOrder: get().lists.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1 + created.length }
        created.push(l); id = l.id; have.set(k, id)
      }
      return id
    }
    const made: Book[] = []
    const lists = new Map<string, string[]>()
    for (const { category, ...input } of inputs) {
      const book: Book = {
        authors: [], source: 'manual', status: 'want', format: 'print', rating: 0,
        ...input, id: crypto.randomUUID(), shelfOrder: ++order, addedAt: t, updatedAt: t,
      }
      made.push(book)
      const own = listFor(category)
      lists.set(book.id, [...new Set([...listIds, ...(own ? [own] : [])])])
    }
    const links: ListBook[] = made.flatMap(b => (lists.get(b.id) ?? []).map(listId => ({ listId, bookId: b.id, sortOrder: 0 })))
    set(s => ({ books: [...s.books, ...made], lists: [...s.lists, ...created], links: [...s.links, ...links] }))
    // One entry, not forty: taking back a shelf you photographed is one gesture, and it takes back
    // the categories it had to make as well, or "undo" would leave empty shelves behind.
    pushUndo(made.length === 1 ? `Add “${made[0].title}”` : `Add ${made.length} books`, () => suppressUndo(() => {
      for (const b of made) get().deleteBook(b.id)
      for (const l of created) get().deleteList(l.id)
    }))
    void saveBooks(made)
      // The categories must exist on the server before a link points at one.
      .then(async () => { await Promise.all(created.map(l => saveList(l))) })
      .then(async () => { for (const b of made) { const ids = lists.get(b.id) ?? []; if (ids.length) await setBookLists(b.id, ids, []) } })
      .catch(failed('save the books', get().loadFromDB))
    return made
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
    const mySessions = get().sessions.filter(x => x.bookId === id)
    const myPlan = get().plans.find(p => p.bookId === id)
    const myReviews = get().reviews.filter(r => myQuotes.some(q => q.id === r.quoteId))
    set(s => ({
      reviews: s.reviews.filter(r => !myReviews.includes(r)),
      plans: s.plans.filter(p => p.bookId !== id),
      sessions: s.sessions.filter(x => x.bookId !== id),
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
        sessions: [...mySessions, ...s.sessions],
        plans: myPlan ? [...s.plans, myPlan] : s.plans,
        reviews: [...s.reviews, ...myReviews],
      }))
      void (async () => {
        await saveBooks([book])
        if (mine.length) await setBookLists(id, mine.map(l => l.listId), [])
        for (const q of myQuotes) await saveQuote(q)
        for (const r of myReviews) await saveReview(r)
        for (const n of myNotes) await saveNote(n)
        for (const m of myMarks) await saveBookmark(m)
        for (const x of mySessions) await saveSession(x)
        if (myPlan) await savePlan(myPlan)
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
    // A challenge on this list goes with it (the server cascades it), and comes back with it on undo.
    const myGoals = get().goals.filter(g => g.listId === id)
    set(s => ({ lists: s.lists.filter(l => l.id !== id), links: s.links.filter(l => l.listId !== id), goals: s.goals.filter(g => g.listId !== id) }))
    // The books stay: deleting a list takes the grouping, never the books in it.
    pushUndo(`Delete “${list.name}”`, () => {
      set(s => ({ lists: [...s.lists, list], links: [...s.links, ...mine], goals: [...s.goals, ...myGoals] }))
      void saveList(list).then(async () => {
        for (const l of mine) await setBookLists(l.bookId, [id], [])
        for (const g of myGoals) await saveGoal(g)
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
    const myReview = get().reviews.find(r => r.quoteId === id)
    set(s => ({ quotes: s.quotes.filter(x => x.id !== id), notes: s.notes.filter(n => n.quoteId !== id), bookmarks: s.bookmarks.filter(m => m.quoteId !== id), reviews: s.reviews.filter(r => r.quoteId !== id) }))
    pushUndo('Delete a quote', () => {
      set(s => ({ quotes: [...s.quotes, q], notes: [...s.notes, ...myNotes], bookmarks: [...s.bookmarks, ...myMarks], reviews: myReview ? [...s.reviews, myReview] : s.reviews }))
      void (async () => {
        await saveQuote(q)
        if (myReview) await saveReview(myReview)
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
