/**
 * libraryDb.ts — Supabase CRUD for the Library tables (20260025).
 *
 * Every write calls `markLocalWrite('library')` first, or a live-sync reload
 * can land while the write is in flight and pull the old row back over it.
 */
import { supabase } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/liveSync'
import type {
  Book, BookFormat, BookSource, BookStatus, Bookmark, BookmarkKind, LibList, ListBook, ListKind,
  Follow, FollowKind, Note, PlanPer, QuoteReview, ReadingGoal, GoalKind, ReadingPlan, ReadingSession, SessionKind, NoteScope, Quote, QuoteKind,
} from './types'

interface BookRow {
  id: string; user_id: string; title: string; subtitle: string | null; authors: string[] | null
  isbn: string | null; publisher: string | null; published_year: number | null; pages: number | null
  language: string | null; description: string | null; cover_url: string | null
  source: string; source_key: string | null; status: string; format: string
  rating: number; review: string | null; spine_color: string | null; file_path: string | null
  shelf_order: number; started_on: string | null; finished_on: string | null
  added_at: string; updated_at: string
  /** 20260028 — absent from a project that has not run it. */
  to_buy?: boolean | null
}
interface ListRow {
  id: string; user_id: string; name: string; kind: string; description: string | null
  thumb_url: string | null; color: string | null; sort_order: number
}
interface LinkRow { list_id: string; book_id: string; user_id: string; sort_order: number }

// `null` from the server means "nothing here"; the app's types use absence.
const opt = <T,>(v: T | null | undefined): T | undefined => (v ?? undefined)

const toBook = (r: BookRow): Book => ({
  id: r.id, title: r.title, subtitle: opt(r.subtitle), authors: r.authors ?? [],
  isbn: opt(r.isbn), publisher: opt(r.publisher), publishedYear: opt(r.published_year),
  pages: opt(r.pages), language: opt(r.language), description: opt(r.description),
  coverUrl: opt(r.cover_url), source: r.source as BookSource, sourceKey: opt(r.source_key),
  status: r.status as BookStatus, format: r.format as BookFormat, rating: r.rating,
  review: opt(r.review), spineColor: opt(r.spine_color), filePath: opt(r.file_path), toBuy: opt(r.to_buy),
  shelfOrder: r.shelf_order, startedOn: opt(r.started_on), finishedOn: opt(r.finished_on),
  addedAt: r.added_at, updatedAt: r.updated_at,
})

// `?? null` on every optional: `undefined` is dropped on the way to JSON, so an
// upsert would never *clear* a field the person emptied — the same hole
// `parent_id` once had in Finance.
const fromBook = (b: Book, userId: string) => ({
  id: b.id, user_id: userId, title: b.title, subtitle: b.subtitle ?? null, authors: b.authors,
  isbn: b.isbn ?? null, publisher: b.publisher ?? null, published_year: b.publishedYear ?? null,
  pages: b.pages ?? null, language: b.language ?? null, description: b.description ?? null,
  cover_url: b.coverUrl ?? null, source: b.source, source_key: b.sourceKey ?? null,
  status: b.status, format: b.format, rating: b.rating, review: b.review ?? null,
  spine_color: b.spineColor ?? null, file_path: b.filePath ?? null, shelf_order: b.shelfOrder,
  started_on: b.startedOn ?? null, finished_on: b.finishedOn ?? null,
  added_at: b.addedAt, updated_at: new Date().toISOString(),
  // Sent only once it has a value, so a project without 20260028 keeps saving
  // every other change to a book — the same shape as a quote's `explanation`.
  ...(b.toBuy !== undefined ? { to_buy: b.toBuy } : {}),
})

const toList = (r: ListRow): LibList => ({
  id: r.id, name: r.name, kind: r.kind as ListKind, description: opt(r.description),
  thumbUrl: opt(r.thumb_url), color: opt(r.color), sortOrder: r.sort_order,
})
const fromList = (l: LibList, userId: string) => ({
  id: l.id, user_id: userId, name: l.name, kind: l.kind, description: l.description ?? null,
  thumb_url: l.thumbUrl ?? null, color: l.color ?? null, sort_order: l.sortOrder,
})

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

export interface LibraryData { books: Book[]; lists: LibList[]; links: ListBook[] }

/** `null` for a failed read, which is not the same as an empty library — the
 *  caller must keep what it has. `'missing'` means the tables are not there
 *  (migration 20260025 has not run), which deserves its own sentence. */
export async function loadLibrary(): Promise<LibraryData | null | 'missing'> {
  const [b, l, k] = await Promise.all([
    supabase.from('library_books').select('*').order('shelf_order').order('added_at'),
    supabase.from('library_lists').select('*').order('sort_order').order('created_at'),
    supabase.from('library_list_books').select('*'),
  ])
  for (const r of [b, l, k]) {
    if (r.error) {
      // 42P01: undefined_table. PGRST205: PostgREST's cache has no such table.
      return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
    }
  }
  return {
    books: (b.data as BookRow[]).map(toBook),
    lists: (l.data as ListRow[]).map(toList),
    links: (k.data as LinkRow[]).map(r => ({ listId: r.list_id, bookId: r.book_id, sortOrder: r.sort_order })),
  }
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function saveBooks(books: Book[]): Promise<void> {
  if (!books.length) return
  markLocalWrite('library')
  const userId = await uid()
  // One request for the batch: sent one at a time, a reload landing mid-batch
  // replaces the list with what the server has so far.
  const { error } = await supabase.from('library_books').upsert(books.map(b => fromBook(b, userId)), { onConflict: 'id' })
  fail(error)
}

export async function removeBook(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_books').delete().eq('id', id)
  fail(error)
}

export async function saveList(list: LibList): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_lists').upsert(fromList(list, await uid()), { onConflict: 'id' })
  fail(error)
}

export async function removeList(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_lists').delete().eq('id', id)
  fail(error)
}

/** Make `bookId` belong to exactly `listIds` — adds what is missing and removes
 *  what is not wanted, in that order, so a failure half-way leaves the book on
 *  too many lists rather than none. */
export async function setBookLists(bookId: string, listIds: string[], existing: string[]): Promise<void> {
  markLocalWrite('library')
  const userId = await uid()
  const add = listIds.filter(id => !existing.includes(id))
  const drop = existing.filter(id => !listIds.includes(id))
  if (add.length) {
    const { error } = await supabase.from('library_list_books').upsert(
      add.map(list_id => ({ list_id, book_id: bookId, user_id: userId, sort_order: 0 })),
      { onConflict: 'list_id,book_id' },
    )
    fail(error)
  }
  if (drop.length) {
    const { error } = await supabase.from('library_list_books').delete().eq('book_id', bookId).in('list_id', drop)
    fail(error)
  }
}

// ─── Phase 2: quotes, notes, bookmarks (20260026) ────────────────────────────
interface QuoteRow {
  id: string; user_id: string; book_id: string; kind: string; body: string | null; image_path: string | null
  page: number | null; line: number | null; color: string | null; explanation?: string | null
  created_at: string; updated_at: string
}
interface NoteRow {
  id: string; user_id: string; scope: string; book_id: string | null; quote_id: string | null; list_id: string | null
  page: number | null; line: number | null; body: string; created_at: string; updated_at: string
}
interface BookmarkRow {
  id: string; user_id: string; kind: string; book_id: string; quote_id: string | null
  page: number | null; line: number | null; label: string | null; created_at: string
}

const toQuote = (r: QuoteRow): Quote => ({
  id: r.id, bookId: r.book_id, kind: r.kind as QuoteKind, body: opt(r.body), imagePath: opt(r.image_path),
  page: opt(r.page), line: opt(r.line), color: opt(r.color), explanation: opt(r.explanation), createdAt: r.created_at, updatedAt: r.updated_at,
})
// `explanation` is sent only when it has been set (or cleared to null). The
// column comes from 20260027; naming it in every quote write would make every
// quote write fail on an account that has not run it yet.
const fromQuote = (q: Quote, userId: string) => ({
  id: q.id, user_id: userId, book_id: q.bookId, kind: q.kind, body: q.body ?? null, image_path: q.imagePath ?? null,
  page: q.page ?? null, line: q.line ?? null, color: q.color ?? null, created_at: q.createdAt, updated_at: new Date().toISOString(),
  ...(q.explanation !== undefined ? { explanation: q.explanation } : {}),
})
const toNote = (r: NoteRow): Note => ({
  id: r.id, scope: r.scope as NoteScope, bookId: opt(r.book_id), quoteId: opt(r.quote_id), listId: opt(r.list_id),
  page: opt(r.page), line: opt(r.line), body: r.body, createdAt: r.created_at, updatedAt: r.updated_at,
})
const fromNote = (n: Note, userId: string) => ({
  id: n.id, user_id: userId, scope: n.scope, book_id: n.bookId ?? null, quote_id: n.quoteId ?? null, list_id: n.listId ?? null,
  page: n.page ?? null, line: n.line ?? null, body: n.body, created_at: n.createdAt, updated_at: new Date().toISOString(),
})
const toBookmark = (r: BookmarkRow): Bookmark => ({
  id: r.id, kind: r.kind as BookmarkKind, bookId: r.book_id, quoteId: opt(r.quote_id),
  page: opt(r.page), line: opt(r.line), label: opt(r.label), createdAt: r.created_at,
})
const fromBookmark = (b: Bookmark, userId: string) => ({
  id: b.id, user_id: userId, kind: b.kind, book_id: b.bookId, quote_id: b.quoteId ?? null,
  page: b.page ?? null, line: b.line ?? null, label: b.label ?? null, created_at: b.createdAt,
})

export interface LibraryExtras { quotes: Quote[]; notes: Note[]; bookmarks: Bookmark[] }

/** Read separately from the shelf: an account that has run 20260025 but not
 *  20260026 still has a working shelf, and `'missing'` says only that this half
 *  is not there yet. `null` is a failed read, which is not an empty answer. */
export async function loadLibraryExtras(): Promise<LibraryExtras | null | 'missing'> {
  const [q, n, b] = await Promise.all([
    supabase.from('library_quotes').select('*').order('created_at'),
    supabase.from('library_notes').select('*').order('created_at'),
    supabase.from('library_bookmarks').select('*').order('created_at'),
  ])
  for (const r of [q, n, b]) {
    if (r.error) return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
  }
  return {
    quotes: (q.data as QuoteRow[]).map(toQuote),
    notes: (n.data as NoteRow[]).map(toNote),
    bookmarks: (b.data as BookmarkRow[]).map(toBookmark),
  }
}

interface FollowRow { id: string; user_id: string; kind: string; name: string; query: string; author_key: string | null; seen_keys: string[] | null; created_at: string }
const toFollow = (r: FollowRow): Follow => ({
  id: r.id, kind: r.kind as FollowKind, name: r.name, query: r.query, authorKey: opt(r.author_key), seenKeys: r.seen_keys ?? [], createdAt: r.created_at,
})
const fromFollow = (f: Follow, userId: string) => ({
  id: f.id, user_id: userId, kind: f.kind, name: f.name, query: f.query, author_key: f.authorKey ?? null, seen_keys: f.seenKeys, created_at: f.createdAt,
})

/** Its own read, like the extras: an account that has not run 20260029 keeps a
 *  working shelf. `null` = a failed read (keep what is on screen). */
export async function loadFollows(): Promise<Follow[] | null | 'missing'> {
  const r = await supabase.from('library_follows').select('*').order('created_at')
  if (r.error) return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
  return (r.data as FollowRow[]).map(toFollow)
}
export async function saveFollow(f: Follow): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_follows').upsert(fromFollow(f, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removeFollow(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_follows').delete().eq('id', id)
  fail(error)
}

interface SessionRow { id: string; user_id: string; book_id: string; kind: string; on_date: string; minutes: number; pages: number | null; to_page: number | null; created_at: string }
const toSession = (r: SessionRow): ReadingSession => ({
  id: r.id, bookId: r.book_id, kind: r.kind as SessionKind, on: r.on_date, minutes: r.minutes,
  pages: opt(r.pages), toPage: opt(r.to_page), createdAt: r.created_at,
})
const fromSession = (s: ReadingSession, userId: string) => ({
  id: s.id, user_id: userId, book_id: s.bookId, kind: s.kind, on_date: s.on, minutes: s.minutes,
  pages: s.pages ?? null, to_page: s.toPage ?? null, created_at: s.createdAt,
})

/** Read on its own like follows: without 20260030 the shelf is untouched. */
export async function loadSessions(): Promise<ReadingSession[] | null | 'missing'> {
  const r = await supabase.from('library_sessions').select('*').order('on_date', { ascending: false }).order('created_at', { ascending: false })
  if (r.error) return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
  return (r.data as SessionRow[]).map(toSession)
}
export async function saveSession(s: ReadingSession): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_sessions').upsert(fromSession(s, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removeSession(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_sessions').delete().eq('id', id)
  fail(error)
}

interface PlanRow { id: string; user_id: string; book_id: string; finish_by: string | null; minutes: number | null; per: string; created_at: string; block_at?: string | null; block_event_id?: string | null; block_sig?: string | null }
/** Set once a row has come back carrying the 20260032 columns: only then can a cleared block be written as null. */
let blockColumns = false
const toPlan = (r: PlanRow): ReadingPlan => ({
  id: r.id, bookId: r.book_id, finishBy: opt(r.finish_by), minutes: opt(r.minutes), per: r.per as PlanPer, createdAt: r.created_at,
  blockAt: opt(r.block_at), blockEventId: opt(r.block_event_id), blockSig: opt(r.block_sig),
})
// `?? null`: undefined is dropped on the way to JSON, so a cleared date would never be cleared.
// The block columns follow the optional-column rule: sent once there is something in them, or once
// the project is known to have them (so a cleared block really clears) — never to one that lacks them.
const fromPlan = (p: ReadingPlan, userId: string) => ({
  id: p.id, user_id: userId, book_id: p.bookId, finish_by: p.finishBy ?? null, minutes: p.minutes ?? null, per: p.per, created_at: p.createdAt,
  ...(p.blockEventId || blockColumns ? { block_at: p.blockAt ?? null, block_event_id: p.blockEventId ?? null, block_sig: p.blockSig ?? null } : {}),
})

/** Read on its own like sessions: without 20260031 the shelf is untouched. */
export async function loadPlans(): Promise<ReadingPlan[] | null | 'missing'> {
  const r = await supabase.from('library_plans').select('*')
  if (r.error) return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
  const rows = r.data as PlanRow[]
  if (rows.some(x => 'block_event_id' in x)) blockColumns = true
  return rows.map(toPlan)
}
interface ReviewRow { quote_id: string; user_id: string; due_on: string; interval_days: number; ease: number; reps: number; lapses: number; first_on: string; last_on: string }
const toReview = (r: ReviewRow): QuoteReview => ({ quoteId: r.quote_id, dueOn: r.due_on, intervalDays: r.interval_days, ease: r.ease, reps: r.reps, lapses: r.lapses, firstOn: r.first_on, lastOn: r.last_on })
const fromReview = (v: QuoteReview, userId: string) => ({ quote_id: v.quoteId, user_id: userId, due_on: v.dueOn, interval_days: v.intervalDays, ease: v.ease, reps: v.reps, lapses: v.lapses, first_on: v.firstOn, last_on: v.lastOn })

/** Read on its own like goals: without 20260034 the quotes themselves are untouched. */
export async function loadReviews(): Promise<QuoteReview[] | null | 'missing'> {
  const r = await supabase.from('library_quote_reviews').select('*')
  if (r.error) return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
  return (r.data as ReviewRow[]).map(toReview)
}
export async function saveReview(v: QuoteReview): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_quote_reviews').upsert(fromReview(v, await uid()), { onConflict: 'quote_id' })
  fail(error)
}
export async function removeReview(quoteId: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_quote_reviews').delete().eq('quote_id', quoteId)
  fail(error)
}

interface GoalRow { id: string; user_id: string; year: number; kind: string; target: number; list_id: string | null; created_at: string }
const toGoal = (r: GoalRow): ReadingGoal => ({ id: r.id, year: r.year, kind: r.kind as GoalKind, target: r.target, listId: opt(r.list_id), createdAt: r.created_at })
const fromGoal = (g: ReadingGoal, userId: string) => ({ id: g.id, user_id: userId, year: g.year, kind: g.kind, target: g.target, list_id: g.listId ?? null, created_at: g.createdAt })

/** Read on its own like plans: without 20260033 the shelf is untouched. */
export async function loadGoals(): Promise<ReadingGoal[] | null | 'missing'> {
  const r = await supabase.from('library_goals').select('*').order('year', { ascending: false })
  if (r.error) return r.error.code === '42P01' || r.error.code === 'PGRST205' ? 'missing' : null
  return (r.data as GoalRow[]).map(toGoal)
}
export async function saveGoal(g: ReadingGoal): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_goals').upsert(fromGoal(g, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removeGoal(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_goals').delete().eq('id', id)
  fail(error)
}

/** Does this project have the 20260032 columns? Asked once: a block written to a project without them
 *  would create the calendar event and then fail to remember it, leaving an event nothing can find. */
let blockProbe: Promise<boolean> | null = null
export function blocksSupported(): Promise<boolean> {
  blockProbe ??= Promise.resolve(supabase.from('library_plans').select('block_event_id').limit(1)).then(r => {
    if (!r.error) blockColumns = true
    return !r.error
  }, () => false)
  return blockProbe
}
export async function savePlan(p: ReadingPlan): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_plans').upsert(fromPlan(p, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removePlan(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_plans').delete().eq('id', id)
  fail(error)
}

export async function saveQuote(q: Quote): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_quotes').upsert(fromQuote(q, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removeQuote(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_quotes').delete().eq('id', id)
  fail(error)
}
export async function saveNote(n: Note): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_notes').upsert(fromNote(n, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removeNote(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_notes').delete().eq('id', id)
  fail(error)
}
export async function saveBookmark(b: Bookmark): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_bookmarks').upsert(fromBookmark(b, await uid()), { onConflict: 'id' })
  fail(error)
}
export async function removeBookmark(id: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.from('library_bookmarks').delete().eq('id', id)
  fail(error)
}
