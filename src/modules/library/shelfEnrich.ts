// ─── Covers and details for books that came off a photograph ─────────────────
// A spine gives a title and perhaps an author — no cover, no ISBN, no page count.
// This asks the two catalogues about each book and takes what they say **only
// when they are clearly talking about the same book**. A wrong cover on a real
// book is worse than none, so the matcher is strict, and a book it cannot match
// confidently is left exactly as the spine gave it.
import { lookupBooks, type BookCandidate } from './bookLookup'
import { applyCandidate } from './applyCandidate'
import { useLibraryStore } from './libraryStore'
import { notify } from '@/lib/undo'
import { normCategory as norm } from './shelfCategories'
import type { Book } from './types'

/** The title before a subtitle: "Atomic Habits: An Easy & Proven Way…" is "Atomic Habits". */
const mainTitle = (s: string) => norm(s.split(/\s[-–—]\s|[:–—]/)[0])

/** The last word of the first author — a surname is what two catalogues agree on, where "J. Clear" and "James Clear" do not. */
const surname = (name: string | undefined) => {
  const w = norm(name ?? '').split(' ').filter(Boolean)
  return w.length ? w[w.length - 1] : ''
}

const richness = (c: BookCandidate) => (c.coverUrl ? 4 : 0) + (c.isbn ? 2 : 0) + (c.pages ? 1 : 0)

/**
 * The one candidate that is plainly this book, or null.
 * - The title must match whole (case and punctuation aside), or match once a subtitle is set aside.
 * - With an author on the spine, the candidate must share its surname.
 * - With none, a very short title ("It", "Us") is refused outright, and the candidate must have a
 *   cover to be worth taking — a bare title match on a common word proves nothing.
 * Of those that pass, the one with the most to give (cover, ISBN, pages) wins.
 */
export function pickMatch(book: Pick<Book, 'title' | 'authors'>, candidates: BookCandidate[]): BookCandidate | null {
  const full = norm(book.title), main = mainTitle(book.title)
  if (!full) return null
  const sn = surname(book.authors[0])
  if (!sn && full.length < 4) return null
  const ok = candidates.filter(c => {
    const titleOk = norm(c.title) === full || mainTitle(c.title) === main || (!!c.subtitle && norm(`${c.title} ${c.subtitle}`) === full)
    if (!titleOk) return false
    if (sn) return c.authors.some(a => norm(a).split(' ').includes(sn))
    return !!c.coverUrl
  })
  return ok.sort((a, b) => richness(b) - richness(a))[0] ?? null
}

export interface EnrichSummary {
  total: number
  /** Books actually looked up: fewer than `total` when some were taken back meanwhile. */
  looked: number
  matched: number
  unreachable: boolean
}

/** Three at a time: two catalogues per book is six requests in flight, which is plenty to ask of someone else's server. */
const CONCURRENCY = 3

export async function enrichBooks(ids: string[]): Promise<EnrichSummary> {
  const patches = new Map<string, Partial<Book>>()
  let reached = 0, asked = 0
  const queue = [...ids]
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const book = useLibraryStore.getState().books.find(b => b.id === id)
      if (!book) continue                      // taken back (undo) while we were looking
      asked++
      try {
        const r = await lookupBooks(`${book.title} ${book.authors[0] ?? ''}`, undefined, 8)
        // Both catalogues down for this one is "could not look", not "no match".
        if (r.failed.length < 2) reached++
        const hit = pickMatch(book, r.candidates)
        if (hit) patches.set(id, applyCandidate(book, hit))
      } catch { /* one book failing to look up costs that book, not the rest */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
  // The lookups take seconds, and the books may have been taken back (undo) in that time. Only what is
  // still on the shelf is patched, and only that is reported — "found covers for 2 of 5" about books
  // that are gone would be a lie.
  const alive = new Set(useLibraryStore.getState().books.map(b => b.id))
  const live = ids.filter(id => alive.has(id))
  const keep = [...patches].filter(([id]) => alive.has(id))
  if (keep.length) useLibraryStore.getState().patchBooks(keep.map(([id, patch]) => ({ id, patch })))
  return { total: live.length, looked: live.length ? asked : 0, matched: keep.length, unreachable: live.length > 0 && asked > 0 && reached === 0 }
}

/** `enrichBooks` plus the one line that tells the person how it went: it runs after the dialog has closed. */
export async function enrichAndReport(ids: string[]): Promise<EnrichSummary> {
  const r = await enrichBooks(ids)
  // Every book was taken back (undo) while we were looking: there is nothing to say about them.
  if (r.looked === 0) return r
  const n = (k: number) => `${k} book${k === 1 ? '' : 's'}`
  notify(r.unreachable
    ? `Could not reach the book catalogues, so ${n(r.total)} were added without covers or details.`
    : r.matched
      ? `Found covers and details for ${r.matched} of ${n(r.total)}. The rest are as the spines read.`
      : `No confident matches for covers or details — ${n(r.total)} kept as the spines read.`)
  return r
}
