/**
 * libraryDb.ts — Supabase CRUD for the Library tables (20260025).
 *
 * Every write calls `markLocalWrite('library')` first, or a live-sync reload
 * can land while the write is in flight and pull the old row back over it.
 */
import { supabase } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/liveSync'
import type { Book, BookFormat, BookSource, BookStatus, LibList, ListBook, ListKind } from './types'

interface BookRow {
  id: string; user_id: string; title: string; subtitle: string | null; authors: string[] | null
  isbn: string | null; publisher: string | null; published_year: number | null; pages: number | null
  language: string | null; description: string | null; cover_url: string | null
  source: string; source_key: string | null; status: string; format: string
  rating: number; review: string | null; spine_color: string | null; file_path: string | null
  shelf_order: number; started_on: string | null; finished_on: string | null
  added_at: string; updated_at: string
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
  review: opt(r.review), spineColor: opt(r.spine_color), filePath: opt(r.file_path),
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
