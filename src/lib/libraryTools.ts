// ─── What the assistant may do with the books ────────────────────────────────
//
// The Library had no tools, so "add this book to my shelf" or "what am I reading"
// could only be answered by sending the person to a screen. These are its tools.
// They follow `financeTools.ts`:
//
// - **Names, not ids.** A model handed a uuid guesses. Every book and list is found by name,
//   an ambiguous name is refused with what matched, and nothing is touched on a guess.
// - **The app's own rules.** Adding looks the book up the way the Add panel does (and is as
//   strict about a match: a wrong cover is worse than none); status changes date themselves the
//   way the book panel does; progress is `progressOf` / `pagesCovered`, the Tracker's own.
// - **Scope is the signed-in person's own shelf**: the store is theirs, loaded for them.
// - **Switched off means off.** Library off (the plan, or Settings → Library) answers "it is off",
//   and a project without the migration says so, instead of pretending the shelf is empty.
// - **A delete is a delete**: it goes through the store's own undo entry, and `assistantPolicy`
//   puts an approval card in front of it.

import type Anthropic from '@anthropic-ai/sdk'
import { useLibraryStore } from '@/modules/library/libraryStore'
import { libraryIsOff } from '@/modules/library/libraryPrefs'
import { lookupBooks, shelfMatch } from '@/modules/library/bookLookup'
import { pickMatch } from '@/modules/library/shelfEnrich'
import { bookFromCandidate } from '@/modules/library/applyCandidate'
import { pagesCovered, progressOf, todayISO } from '@/modules/library/readingStats'
import { STATUS_LABEL, type Book, type BookStatus, type LibList } from '@/modules/library/types'
import { notify } from '@/lib/undo'

const STATUSES = Object.keys(STATUS_LABEL) as BookStatus[]
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export const LIBRARY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'library_overview',
    description: "The user's Library at a glance: how many books in each state, what they are reading now, and their categories and lists with counts. Use it for \"what am I reading\", \"how many books have I read\", \"what lists do I have\".",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'library_find_books',
    description: "Find books on the user's shelf by words in the title or author, a status, or a category/list name. Returns each book's title, authors, status, rating, pages, progress and the lists it is on.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Words from the title or author (optional)' },
        status: { type: 'string', enum: STATUSES, description: 'want, reading, finished, paused or abandoned (optional)' },
        shelf: { type: 'string', description: 'A category or list name (optional)' },
        limit: { type: 'number', description: 'At most this many (default 15)' },
      },
      required: [],
    },
  },
  {
    name: 'library_add_book',
    description: "Add a book to the user's shelf. Give the title (and the author if you know it): the cover, year, pages and ISBN are looked up online and filled in when a catalogue clearly matches; otherwise it is added as typed. If the book is already on the shelf nothing is added. Optionally shelve it under existing categories/lists by name.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        author: { type: 'string', description: 'Author, if known (several separated by commas)' },
        status: { type: 'string', enum: STATUSES, description: 'Default want (want to read)' },
        shelves: { type: 'array', items: { type: 'string' }, description: 'Names of existing categories or lists to file it under' },
      },
      required: ['title'],
    },
  },
  {
    name: 'library_update_book',
    description: "Change a book on the shelf: its status (starting or finishing a book dates itself), rating (0–5, 0 clears it) or review. Name the book by title.",
    input_schema: {
      type: 'object' as const,
      properties: {
        book: { type: 'string', description: 'The book\'s title (or part of it)' },
        status: { type: 'string', enum: STATUSES },
        rating: { type: 'number', description: '0 to 5' },
        review: { type: 'string' },
      },
      required: ['book'],
    },
  },
  {
    name: 'library_shelve_book',
    description: "File a book under categories/lists, or take it off some, by name. Names must be ones the user already has (library_overview lists them); to make a new one use library_create_list.",
    input_schema: {
      type: 'object' as const,
      properties: {
        book: { type: 'string' },
        add_to: { type: 'array', items: { type: 'string' } },
        remove_from: { type: 'array', items: { type: 'string' } },
      },
      required: ['book'],
    },
  },
  {
    name: 'library_create_list',
    description: "Make a new category (what a book IS — Fiction, Business) or list (what the user is DOING with it — Summer reading, Lend out).",
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['category', 'list'] }, description: { type: 'string' } },
      required: ['name', 'kind'],
    },
  },
  {
    name: 'library_add_quote',
    description: "Save a quote from a book, with the page if known.",
    input_schema: {
      type: 'object' as const,
      properties: { book: { type: 'string' }, text: { type: 'string', description: 'The words, exactly as written' }, page: { type: 'number' } },
      required: ['book', 'text'],
    },
  },
  {
    name: 'library_log_reading',
    description: "Log a reading or listening sitting on a book: minutes, and the page reached if known. The first sitting on a want-to-read book starts it.",
    input_schema: {
      type: 'object' as const,
      properties: {
        book: { type: 'string' },
        minutes: { type: 'number', description: '1 to 1440' },
        to_page: { type: 'number', description: 'The page reached (reading only)' },
        kind: { type: 'string', enum: ['read', 'listen'], description: 'Default read' },
        date: { type: 'string', description: 'YYYY-MM-DD, default today; never in the future' },
      },
      required: ['book', 'minutes'],
    },
  },
  {
    name: 'library_delete_book',
    description: "Remove a book from the shelf, with its quotes, notes and reading log. The app asks the user to approve first; it can be undone for a short while afterwards.",
    input_schema: { type: 'object' as const, properties: { book: { type: 'string' } }, required: ['book'] },
  },
]

export const LIBRARY_TOOL_NAMES = new Set(LIBRARY_TOOLS.map(t => t.name))

class LibraryRefusal extends Error {}
const refuse = (m: string): never => { throw new LibraryRefusal(m) }

async function ready() {
  if (libraryIsOff()) refuse('The Library is switched off (Settings → Library, or the plan). Say so, and do not work around it.')
  const st = useLibraryStore.getState()
  if (st.loading) await st.loadFromDB()
  const now = useLibraryStore.getState()
  if (now.missing) refuse('The Library is not set up on this account yet (its database migration has not run).')
  return now
}

function bookNamed(name: string, books: Book[]): Book {
  const q = norm(name)
  if (!q) refuse('Which book? Give its title.')
  const exact = books.filter(b => norm(b.title) === q)
  if (exact.length === 1) return exact[0]
  const hits = exact.length ? exact : books.filter(b => norm(b.title).includes(q) || norm(`${b.title} ${b.authors.join(' ')}`).includes(q))
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) return refuse(`No book on the shelf matches "${name}".`)
  return refuse(`"${name}" matches ${hits.length} books: ${hits.slice(0, 6).map(b => `“${b.title}”`).join(', ')}. Say which one.`)
}

function listNamed(name: string, lists: LibList[]): LibList {
  const q = norm(name)
  const hit = lists.find(l => norm(l.name) === q)
  if (!hit) refuse(`There is no category or list called "${name}". They are: ${lists.map(l => l.name).join(', ') || 'none yet'}. Use library_create_list to make one.`)
  return hit as LibList
}

const today = () => todayISO()

export async function executeLibraryTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try { return await run(name, input) } catch (e) {
    if (e instanceof LibraryRefusal) return { error: e.message }
    throw e
  }
}

async function run(name: string, input: Record<string, unknown>): Promise<unknown> {
  const st = await ready()
  const { books, lists, links, sessions } = st
  const listsOf = (id: string) => links.filter(l => l.bookId === id).map(l => lists.find(x => x.id === l.listId)?.name).filter(Boolean) as string[]
  const progress = (b: Book) => { const p = progressOf(b, sessions.filter(s => s.bookId === b.id)); return { page: p.page, percent: p.pct } }
  const row = (b: Book) => ({ title: b.title, authors: b.authors, status: b.status, rating: b.rating || undefined, pages: b.pages, progress: b.status === 'reading' ? progress(b) : undefined, shelves: listsOf(b.id), finished_on: b.finishedOn, to_buy: b.toBuy || undefined })

  switch (name) {
    case 'library_overview': {
      const by: Record<string, number> = {}
      for (const b of books) by[b.status] = (by[b.status] ?? 0) + 1
      const count = (id: string) => links.filter(l => l.listId === id).length
      return {
        total: books.length, by_status: by,
        reading_now: books.filter(b => b.status === 'reading').slice(0, 10).map(row),
        categories: lists.filter(l => l.kind === 'category').map(l => ({ name: l.name, books: count(l.id) })),
        lists: lists.filter(l => l.kind === 'list').map(l => ({ name: l.name, books: count(l.id) })),
        to_buy: books.filter(b => b.toBuy).length,
      }
    }

    case 'library_find_books': {
      const q = norm(String(input.query ?? ''))
      const status = STATUSES.includes(input.status as BookStatus) ? (input.status as BookStatus) : null
      const shelf = typeof input.shelf === 'string' && input.shelf.trim() ? listNamed(input.shelf, lists) : null
      const inShelf = shelf ? new Set(links.filter(l => l.listId === shelf.id).map(l => l.bookId)) : null
      const limit = Math.max(1, Math.min(40, Number(input.limit) || 15))
      const hits = books.filter(b => (!q || norm(`${b.title} ${b.subtitle ?? ''} ${b.authors.join(' ')}`).includes(q)) && (!status || b.status === status) && (!inShelf || inShelf.has(b.id)))
      return { total: hits.length, books: hits.slice(0, limit).map(row) }
    }

    case 'library_add_book': {
      const title = String(input.title ?? '').trim()
      if (!title) refuse('A title is needed.')
      const authors = String(input.author ?? '').split(',').map(a => a.trim()).filter(Boolean)
      const status = STATUSES.includes(input.status as BookStatus) ? (input.status as BookStatus) : 'want'
      const shelves = Array.isArray(input.shelves) ? (input.shelves as unknown[]).map(String).filter(Boolean).map(n => listNamed(n, lists)) : []
      const dup = shelfMatch(books, { title, authors, source: 'manual' })
      if (dup) return { added: false, already_on_shelf: true, book: row(dup) }
      // Found the way the Add panel finds it — and as strictly: a wrong cover is worse than none.
      let found: ReturnType<typeof bookFromCandidate> | null = null
      let lookedUp = true
      try {
        const r = await lookupBooks(`${title} ${authors[0] ?? ''}`.trim(), undefined, 8)
        lookedUp = r.failed.length < 2
        const hit = pickMatch({ title, authors }, r.candidates)
        if (hit) found = bookFromCandidate(hit)
      } catch { lookedUp = false }
      const made = st.addBook({
        ...(found ?? {}), title: found?.title ?? title, authors: found?.authors?.length ? found.authors : authors, status,
        startedOn: status === 'reading' ? today() : undefined,
        finishedOn: status === 'finished' ? today() : undefined,
      }, shelves.map(l => l.id))
      notify(`Added “${made.title}” to your shelf`)
      return { added: true, matched_online: !!found, looked_up: lookedUp, book: row(made) }
    }

    case 'library_update_book': {
      const b = bookNamed(String(input.book ?? ''), books)
      const p: Partial<Book> = {}
      if (input.status !== undefined) {
        if (!STATUSES.includes(input.status as BookStatus)) refuse(`status must be one of ${STATUSES.join(', ')}.`)
        const status = input.status as BookStatus
        p.status = status
        // Starting and finishing are dated by the act, as in the book panel.
        if (status === 'reading' && !b.startedOn) p.startedOn = today()
        if (status === 'finished') { p.finishedOn = b.finishedOn ?? today(); p.startedOn = b.startedOn ?? p.finishedOn }
        if (status !== 'finished' && b.status === 'finished') p.finishedOn = undefined
      }
      if (input.rating !== undefined) {
        const r = Math.round(Number(input.rating))
        if (!(r >= 0 && r <= 5)) refuse('rating must be 0 to 5.')
        p.rating = r
      }
      if (typeof input.review === 'string') p.review = input.review.trim() || undefined
      if (!Object.keys(p).length) refuse('Nothing to change: give a status, rating or review.')
      st.updateBook(b.id, p)
      notify(`Updated “${b.title}”`)
      return { updated: true, book: row({ ...b, ...p }) }
    }

    case 'library_shelve_book': {
      const b = bookNamed(String(input.book ?? ''), books)
      const add = (Array.isArray(input.add_to) ? input.add_to : []).map(n => listNamed(String(n), lists))
      const remove = (Array.isArray(input.remove_from) ? input.remove_from : []).map(n => listNamed(String(n), lists))
      if (!add.length && !remove.length) refuse('Give add_to or remove_from.')
      const drop = new Set(remove.map(l => l.id))
      const next = [...new Set([...links.filter(l => l.bookId === b.id).map(l => l.listId), ...add.map(l => l.id)])].filter(id => !drop.has(id))
      st.setBookLists(b.id, next)
      notify(`Shelved “${b.title}”`)
      return { shelved: true, book: b.title, shelves: next.map(id => lists.find(l => l.id === id)?.name).filter(Boolean) }
    }

    case 'library_create_list': {
      const n = String(input.name ?? '').trim()
      if (!n) refuse('A name is needed.')
      if (input.kind !== 'category' && input.kind !== 'list') refuse('kind must be "category" or "list".')
      if (lists.some(l => norm(l.name) === norm(n))) refuse(`There is already a category or list called "${n}".`)
      const made = st.addList(n, input.kind as 'category' | 'list', typeof input.description === 'string' && input.description.trim() ? { description: input.description.trim() } : undefined)
      notify(`Made the ${made.kind} “${made.name}”`)
      return { created: true, name: made.name, kind: made.kind }
    }

    case 'library_add_quote': {
      const b = bookNamed(String(input.book ?? ''), books)
      if (st.extrasMissing) refuse('Quotes are not set up on this account yet (migration 20260026).')
      const text = String(input.text ?? '').trim()
      if (!text) refuse('The quote is empty.')
      const page = Number(input.page)
      const q = st.addQuote(b.id, { kind: 'text', body: text, ...(Number.isFinite(page) && page > 0 ? { page: Math.round(page) } : {}) })
      notify(`Saved a quote from “${b.title}”`)
      return { saved: true, book: b.title, page: q.page }
    }

    case 'library_log_reading': {
      const b = bookNamed(String(input.book ?? ''), books)
      if (st.sessionsMissing) refuse('Reading logs are not set up on this account yet (migration 20260030).')
      const minutes = Math.round(Number(input.minutes))
      if (!(minutes >= 1 && minutes <= 1440)) refuse('minutes must be 1 to 1440.')
      const kind = input.kind === 'listen' ? 'listen' : 'read'
      const on = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today()
      if (on > today()) refuse('A sitting cannot be logged for a day that has not happened.')
      let to: number | undefined
      if (kind === 'read' && input.to_page !== undefined) {
        to = Math.round(Number(input.to_page))
        if (!(to > 0)) refuse('to_page must be a positive page number.')
        if (b.pages && to > b.pages) refuse(`“${b.title}” has ${b.pages} pages; ${to} is past the end (fix the book's page count if it is wrong).`)
      }
      const prev = progressOf(b, sessions.filter(s => s.bookId === b.id)).page
      st.addSession({ bookId: b.id, kind, on, minutes, ...(to !== undefined ? { toPage: to, pages: pagesCovered(prev, to) } : {}) })
      notify(`Logged ${minutes} min on “${b.title}”`)
      // Read again: `sessions` above is the list from before this sitting was added.
      const after = useLibraryStore.getState()
      const nb = after.books.find(x => x.id === b.id) ?? b
      const prog = progressOf(nb, after.sessions.filter(x => x.bookId === b.id))
      return { logged: true, book: { ...row(nb), progress: { page: prog.page, percent: prog.pct } }, progress: { page: prog.page, percent: prog.pct } }
    }

    case 'library_delete_book': {
      const b = bookNamed(String(input.book ?? ''), books)
      st.deleteBook(b.id)
      notify(`Removed “${b.title}” from your shelf`)
      return { deleted: true, title: b.title, undo: 'Undo (⌘Z / Ctrl+Z) brings it back for a short while.' }
    }
  }
  return { error: `Unknown library tool ${name}` }
}
