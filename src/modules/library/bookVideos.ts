// ─── Videos about a book ─────────────────────────────────────────────────────
// Asks the `library-videos` edge function (the YouTube key and its daily quota
// are the project's, so the browser never holds them) and always has an answer
// for the person: when the function cannot help — no key set, quota spent,
// YouTube down, function not deployed — the screen still offers a plain YouTube
// search link, which costs no quota and cannot be wrong.
//
// Each video arrives marked `strict` by the function: its title names THIS book.
// The dialog shows those and keeps the rest (`strict: false`) one press away.
import { supabase } from '@/lib/supabase'

export type VideoTopic = 'review' | 'author'

export interface BookVideo {
  id: string
  title: string
  channel: string
  thumb: string
  publishedAt: string
  /** The title names this book. False = probably about something nearby. */
  strict: boolean
  /** Times watched; `null` when unknown (never 0 for "unknown"). */
  views: number | null
  /** Likes; `null` when unknown or hidden by the channel. */
  likes: number | null
}

export type VideoStatus = 'not_configured' | 'quota' | 'unreachable' | 'unavailable'
export type MoreStatus = 'not_configured' | 'quota' | 'unreachable'
export type VideoResult =
  | { status: 'ok'; items: BookVideo[]; stale: boolean; canMore: boolean; moreStatus?: MoreStatus }
  | { status: VideoStatus; items: []; canMore: false }

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** The link a video opens. Only a well-formed id ever reaches a URL. */
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`

/** The picture is derived from the id, never taken from a response. */
export const thumbUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

/** A search page, for when nothing better is available. The title is quoted: it is the book we want, not its neighbours. */
export function youtubeSearchUrl(b: { title: string; authors: string[] }, topic: VideoTopic): string {
  const main = (b.title.split(/\s*[:–—]\s+|\s+-\s+/)[0] || b.title).replace(/"/g, '').trim()
  const first = b.authors[0] ?? ''
  const q = topic === 'author'
    ? `${first ? first + ' ' : ''}"${main}" interview`
    : `"${main}" ${first} book summary review`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`
}

/** A count is a whole number that is not negative; anything else is "not said", which is not zero. */
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)

/** What a response is allowed to say about a video — anything else is dropped. */
export function readVideos(data: unknown): BookVideo[] {
  const items = (data as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((v: Partial<BookVideo>): BookVideo[] => {
    if (typeof v?.id !== 'string' || !VIDEO_ID.test(v.id) || typeof v.title !== 'string' || !v.title) return []
    return [{
      id: v.id, title: v.title, channel: typeof v.channel === 'string' ? v.channel : '',
      thumb: thumbUrl(v.id),
      publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt : '',
      // Only an explicit yes counts: a response that does not say is not vouched for.
      strict: v.strict === true,
      views: count(v.views), likes: count(v.likes),
    }]
  })
}

const memory = new Map<string, VideoResult>()
/** A search already on its way is shared, not repeated: the quota is the project's, and a dialog that mounts twice must not spend it twice. */
const inflight = new Map<string, Promise<VideoResult>>()
const keyOf = (bookId: string, topic: VideoTopic) => `${bookId}|${topic}`

type AskBook = { id: string; title: string; authors: string[] }

/**
 * `more` asks YouTube for the next page of the same search (the one thing here that spends more quota).
 * A search is remembered for the session; so is what `more` added to it.
 */
export function findVideos(b: AskBook, topic: VideoTopic, more = false): Promise<VideoResult> {
  const k = keyOf(b.id, topic)
  if (!more) {
    const hit = memory.get(k)
    if (hit) return Promise.resolve(hit)
  }
  const flight = `${k}|${more ? 'more' : 'first'}`
  const pending = inflight.get(flight)
  if (pending) return pending
  const run = ask(b, topic, more).then(out => {
    // An empty answer is not remembered: a retry may find something, and nothing is lost by asking.
    if (out.status === 'ok' && out.items.length) memory.set(k, out)
    return out
  }).finally(() => inflight.delete(flight))
  inflight.set(flight, run)
  return run
}

async function ask(b: AskBook, topic: VideoTopic, more: boolean): Promise<VideoResult> {
  let data: unknown
  try {
    const r = await supabase.functions.invoke('library-videos', { body: { title: b.title, authors: b.authors, topic, ...(more ? { more: true } : {}) } })
    if (r.error) return { status: 'unavailable', items: [], canMore: false }
    data = r.data
  } catch { return { status: 'unavailable', items: [], canMore: false } }

  const d = data as { status?: string; stale?: unknown; canMore?: unknown; moreStatus?: unknown }
  if (d?.status === 'ok') {
    const ms = d.moreStatus
    return {
      status: 'ok', items: readVideos(data), stale: d.stale === true, canMore: d.canMore === true,
      ...(ms === 'quota' || ms === 'unreachable' || ms === 'not_configured' ? { moreStatus: ms } : {}),
    }
  }
  if (d?.status === 'not_configured' || d?.status === 'quota' || d?.status === 'unreachable') return { status: d.status, items: [], canMore: false }
  return { status: 'unavailable', items: [], canMore: false }
}
