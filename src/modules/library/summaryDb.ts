/**
 * summaryDb.ts — the saved summary of a book (20260046, `library_summaries`).
 *
 * Read and written on demand by the summary dialog, not by the store: a summary
 * is large, belongs to one book, and nothing on the shelf needs it. So a project
 * that has not run the migration costs the shelf nothing — only this dialog
 * says so (`'missing'`, 42P01 / PGRST205, as everywhere in the Library).
 */
import { supabase } from '@/lib/supabase'
import { LENGTH_ORDER, type OutlineItem, type SummaryDoc, type SummaryLength, type SummarySection } from './summaryPlan'

interface Row {
  book_id: string; user_id: string; length: string; premise: string | null
  outline: unknown; sections: unknown; model: string | null; updated_at: string
}

export type LoadResult =
  | { status: 'ok'; doc: SummaryDoc | null }
  | { status: 'missing' }
  | { status: 'error' }
export type SaveResult = 'ok' | 'missing' | 'error'

const isMissing = (code?: string) => code === '42P01' || code === 'PGRST205'

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A stored row, read defensively — what is in jsonb is data, not a type. */
function toDoc(r: Row): SummaryDoc | null {
  if (!LENGTH_ORDER.includes(r.length as SummaryLength)) return null
  const outline: OutlineItem[] = Array.isArray(r.outline)
    ? r.outline.map((o: { title?: unknown; focus?: unknown }) => ({ title: text(o?.title), focus: text(o?.focus) })).filter(o => o.title)
    : []
  const sections: SummarySection[] = Array.isArray(r.sections)
    ? r.sections.map((s: { title?: unknown; text?: unknown }) => ({ title: text(s?.title), text: text(s?.text) })).filter(s => s.text)
    : []
  return {
    bookId: r.book_id, length: r.length as SummaryLength, premise: text(r.premise),
    outline, sections, model: text(r.model), updatedAt: r.updated_at,
  }
}

export async function loadSummary(bookId: string): Promise<LoadResult> {
  const r = await supabase.from('library_summaries').select('*').eq('book_id', bookId).maybeSingle()
  if (r.error) return isMissing(r.error.code) ? { status: 'missing' } : { status: 'error' }
  if (!r.data) return { status: 'ok', doc: null }
  const doc = toDoc(r.data as Row)
  return doc ? { status: 'ok', doc } : { status: 'error' }
}

/** One row per book: a new outline replaces the old summary, a new section adds to this one. */
export async function saveSummary(d: SummaryDoc): Promise<SaveResult> {
  const r = await supabase.from('library_summaries').upsert({
    book_id: d.bookId, user_id: await uid(), length: d.length, premise: d.premise,
    outline: d.outline, sections: d.sections, model: d.model || null, updated_at: d.updatedAt,
  }, { onConflict: 'book_id' })
  if (!r.error) return 'ok'
  return isMissing(r.error.code) ? 'missing' : 'error'
}

export async function removeSummary(bookId: string): Promise<SaveResult> {
  const r = await supabase.from('library_summaries').delete().eq('book_id', bookId)
  if (!r.error) return 'ok'
  return isMissing(r.error.code) ? 'missing' : 'error'
}
