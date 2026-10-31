/**
 * videoMarksDb.ts — what a person decided about a book's videos (20260047, `library_video_marks`).
 *
 * Read and written on demand by the Videos dialog, not by the store: nothing on
 * the shelf needs them. A project that has not run the migration costs the shelf
 * nothing — only this dialog says so (`'missing'`, 42P01 / PGRST205, as
 * everywhere in the Library) and simply cannot keep a favourite.
 */
import { supabase } from '@/lib/supabase'

export type MarkKind = 'favorite' | 'hidden'

export interface VideoMark {
  videoId: string
  mark: MarkKind
  title: string
  channel: string
  publishedAt: string
}

interface Row { video_id: string; mark: string; title: string | null; channel: string | null; published_at: string | null }

export type MarksLoad = { status: 'ok'; marks: VideoMark[] } | { status: 'missing' } | { status: 'error' }
export type MarkSave = 'ok' | 'missing' | 'error'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const isMissing = (code?: string) => code === '42P01' || code === 'PGRST205'

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

/** Newest decision first — what you just did is what you want to find. */
export async function loadMarks(bookId: string): Promise<MarksLoad> {
  const r = await supabase.from('library_video_marks').select('video_id, mark, title, channel, published_at').eq('book_id', bookId).order('created_at', { ascending: false })
  if (r.error) return isMissing(r.error.code) ? { status: 'missing' } : { status: 'error' }
  const marks = ((r.data ?? []) as Row[]).flatMap((x): VideoMark[] =>
    VIDEO_ID.test(x.video_id) && (x.mark === 'favorite' || x.mark === 'hidden')
      ? [{ videoId: x.video_id, mark: x.mark, title: x.title ?? '', channel: x.channel ?? '', publishedAt: x.published_at ?? '' }]
      : [])
  return { status: 'ok', marks }
}

/** One row per (book, video): a new decision replaces the old one. */
export async function saveMark(bookId: string, m: VideoMark): Promise<MarkSave> {
  if (!VIDEO_ID.test(m.videoId)) return 'error'
  const r = await supabase.from('library_video_marks').upsert({
    book_id: bookId, video_id: m.videoId, user_id: await uid(), mark: m.mark,
    title: m.title.slice(0, 200), channel: m.channel.slice(0, 100), published_at: m.publishedAt.slice(0, 40),
    created_at: new Date().toISOString(),
  }, { onConflict: 'book_id,video_id' })
  if (!r.error) return 'ok'
  return isMissing(r.error.code) ? 'missing' : 'error'
}

export async function clearMark(bookId: string, videoId: string): Promise<MarkSave> {
  const r = await supabase.from('library_video_marks').delete().eq('book_id', bookId).eq('video_id', videoId)
  if (!r.error) return 'ok'
  return isMissing(r.error.code) ? 'missing' : 'error'
}
