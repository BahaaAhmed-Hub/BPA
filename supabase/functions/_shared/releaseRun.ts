// ─── One pass of the new-release check — pure, with its I/O handed in ─────────
// The function (`library-follow-check/index.ts`) supplies a database and a
// network; the test supplies stand-ins that can fail on demand. Nothing here
// imports Deno or a client, so what runs in the test is what runs in production.
import { freshReleases, onShelf, workKey, type Candidate, type ShelfBook } from './releases.ts'

export interface FollowRow { id: string; user_id: string; name: string; query: string; seen_keys: string[] | null; last_checked_at?: string | null }
export interface NewsRow { work_key: string; title: string; authors: string[]; isbn?: string | null }
export interface NewNews extends NewsRow { follow_id: string; user_id: string; published_year?: number | null; cover_url?: string | null }

export interface RunIO {
  /** Throws if the catalogue cannot be read — "could not look" is not "nothing new". */
  fetchWorks(query: string): Promise<Candidate[]>
  /** Throws if the shelf cannot be read: announcing books the person owns is worse than a late alert. */
  shelfOf(userId: string): Promise<ShelfBook[]>
  hasModule(userId: string): Promise<boolean>
  existingNews(followId: string): Promise<NewsRow[]>
  saveNews(rows: NewNews[]): Promise<void>
  clearNews(followId: string, workKeys: string[]): Promise<void>
  markChecked(followId: string, ok: boolean, at: string): Promise<void>
  now(): number
  pause?(ms: number): Promise<void>
}

export interface RunOptions {
  /** Most follows in one pass; the rest wait for the next. */
  maxFollows?: number
  /** Stop starting new follows after this many ms, and say so. */
  budgetMs?: number
  /** Be polite to a free catalogue. */
  gapMs?: number
  /** Most new works announced for one follow in one pass. */
  perFollowCap?: number
}

export interface RunSummary {
  checked: number
  failed: number
  announced: number
  cleared: number
  /** Follows left for the next pass (over the cap or the time budget). */
  deferred: number
  /** Users skipped: Library not on their plan, or their shelf could not be read. */
  skippedUsers: number
  /** A follow with no baseline is never announced from: it would be the whole catalogue. */
  noBaseline: number
}

export async function runChecks(all: FollowRow[], io: RunIO, o: RunOptions = {}): Promise<RunSummary> {
  const { maxFollows = 300, budgetMs = 50_000, gapMs = 250, perFollowCap = 20 } = o
  const s: RunSummary = { checked: 0, failed: 0, announced: 0, cleared: 0, deferred: 0, skippedUsers: 0, noBaseline: 0 }
  const start = io.now()
  // Never-checked first, then the longest ago — so a pass that runs out of time continues where it stopped.
  const ordered = [...all].sort((a, b) => (a.last_checked_at ?? '').localeCompare(b.last_checked_at ?? ''))
  const todo = ordered.slice(0, maxFollows)
  s.deferred += ordered.length - todo.length

  const shelves = new Map<string, ShelfBook[] | null>()   // null: this user is skipped
  const stop = new Set<string>()
  let first = true
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i]
    if (io.now() - start > budgetMs) { s.deferred += todo.length - i; break }

    if (!shelves.has(f.user_id)) {
      let shelf: ShelfBook[] | null = null
      try { if (await io.hasModule(f.user_id)) shelf = await io.shelfOf(f.user_id) } catch { shelf = null }
      shelves.set(f.user_id, shelf)
      if (!shelf) { stop.add(f.user_id); s.skippedUsers++ }
    }
    if (stop.has(f.user_id)) continue
    const shelf = shelves.get(f.user_id)!

    if (!first && gapMs > 0) await (io.pause ?? (ms => new Promise(r => setTimeout(r, ms))))(gapMs)
    first = false

    const at = new Date(io.now()).toISOString()
    let found: Candidate[]
    try { found = await io.fetchWorks(f.query) }
    catch { s.failed++; await io.markChecked(f.id, false, at).catch(() => {}); continue }
    s.checked++

    const seen = f.seen_keys ?? []
    const existing = await io.existingNews(f.id).catch(() => [] as NewsRow[])
    const seenSet = new Set(seen)

    // Take back what is no longer news: it was marked seen elsewhere, or it reached the shelf.
    const stale = existing.filter(n => seenSet.has(n.work_key) || onShelf(shelf, { title: n.title, authors: n.authors, isbn: n.isbn ?? undefined })).map(n => n.work_key)
    if (stale.length) { await io.clearNews(f.id, stale); s.cleared += stale.length }

    if (seen.length === 0 && found.length > 0) { s.noBaseline++; await io.markChecked(f.id, true, at); continue }

    const have = new Set(existing.map(n => n.work_key))
    const fresh = freshReleases(seen, found, shelf).filter(c => !have.has(workKey(c))).slice(0, perFollowCap)
    if (fresh.length) {
      await io.saveNews(fresh.map(c => ({
        follow_id: f.id, user_id: f.user_id, work_key: workKey(c), title: c.title, authors: c.authors,
        isbn: c.isbn ?? null, published_year: c.year ?? null, cover_url: c.coverUrl ?? null,
      })))
      s.announced += fresh.length
    }
    await io.markChecked(f.id, true, at)
  }
  return s
}
