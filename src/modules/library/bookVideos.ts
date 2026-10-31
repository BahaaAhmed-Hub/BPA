// ─── Videos about a book ─────────────────────────────────────────────────────
// Asks the `library-videos` edge function (the YouTube key and its daily quota
// are the project's, so the browser never holds them) and always has an answer
// for the person: when the function cannot help — no key set, quota spent,
// YouTube down, function not deployed — the screen still offers a plain YouTube
// search link, which costs no quota and cannot be wrong.
import { supabase } from '@/lib/supabase'

export type VideoTopic = 'review' | 'author'

export interface BookVideo {
  id: string
  title: string
  channel: string
  thumb: string
  publishedAt: string
}

export type VideoStatus = 'not_configured' | 'quota' | 'unreachable' | 'unavailable'
export type VideoResult =
  | { status: 'ok'; items: BookVideo[]; stale: boolean }
  | { status: VideoStatus; items: [] }

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** The link a video opens. Only a well-formed id ever reaches a URL. */
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`

/** A search page, for when nothing better is available. */
export function youtubeSearchUrl(b: { title: string; authors: string[] }, topic: VideoTopic): string {
  const q = topic === 'author'
    ? `${b.authors[0] ?? b.title} interview ${b.authors[0] ? b.title : ''}`
    : `${b.title} ${b.authors[0] ?? ''} book summary review`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`
}

/** What a response is allowed to say about a video — anything else is dropped. */
export function readVideos(data: unknown): BookVideo[] {
  const items = (data as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((v: Partial<BookVideo>): BookVideo[] => {
    if (typeof v?.id !== 'string' || !VIDEO_ID.test(v.id) || typeof v.title !== 'string' || !v.title) return []
    return [{
      id: v.id, title: v.title, channel: typeof v.channel === 'string' ? v.channel : '',
      // The picture is derived from the id, not taken from the response.
      thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt : '',
    }]
  })
}

const memory = new Map<string, VideoResult>()
/** A search already on its way is shared, not repeated: the quota is the project's, and a dialog that mounts twice must not spend it twice. */
const inflight = new Map<string, Promise<VideoResult>>()
const keyOf = (bookId: string, topic: VideoTopic) => `${bookId}|${topic}`

type AskBook = { id: string; title: string; authors: string[] }

export function findVideos(b: AskBook, topic: VideoTopic): Promise<VideoResult> {
  const k = keyOf(b.id, topic)
  const hit = memory.get(k)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(k)
  if (pending) return pending
  const run = ask(b, topic).finally(() => inflight.delete(k))
  inflight.set(k, run)
  return run
}

async function ask(b: AskBook, topic: VideoTopic): Promise<VideoResult> {
  let data: unknown
  try {
    const r = await supabase.functions.invoke('library-videos', { body: { title: b.title, authors: b.authors, topic } })
    if (r.error) return { status: 'unavailable', items: [] }
    data = r.data
  } catch { return { status: 'unavailable', items: [] } }

  const status = (data as { status?: string })?.status
  if (status === 'ok') {
    const out: VideoResult = { status: 'ok', items: readVideos(data), stale: (data as { stale?: unknown }).stale === true }
    // An empty answer is not remembered: a retry may find something, and nothing is lost by asking.
    if (out.items.length) memory.set(keyOf(b.id, topic), out)
    return out
  }
  if (status === 'not_configured' || status === 'quota' || status === 'unreachable') return { status, items: [] }
  return { status: 'unavailable', items: [] }
}
