/**
 * libraryVideos.ts — the rules behind the Library's "Videos" button.
 *
 * Pure (no Deno, no network) so `scripts/library-videos-rules.mjs` can run the
 * real thing. `library-videos/index.ts` is only the database and YouTube handed
 * to these.
 *
 * Two decisions live here:
 *  • **What is asked.** A book is found by its title and first author; the topic
 *    says whether the person wants to understand it or hear from the author.
 *  • **What is believed.** YouTube's answer is data. An id that is not an
 *    11-character id is dropped, and the thumbnail is *derived from the id*
 *    (`i.ytimg.com/vi/<id>/mqdefault.jpg`) instead of trusting a URL the response
 *    carries — the same rule `linkPreview.ts` follows on the client.
 */

export type VideoTopic = 'review' | 'author'

export interface VideoItem {
  id: string
  title: string
  channel: string
  thumb: string
  publishedAt: string
}

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
export const MAX_RESULTS = 8
/** A week: what a channel has said about a book does not change by the hour, and the quota does not refill by the hour. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const clip = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** The search for a book. `null` when there is nothing to search for. */
export function videoQuery(title: unknown, authors: unknown, topic: VideoTopic): string | null {
  const t = clip(title, 160)
  if (!t) return null
  const first = Array.isArray(authors) ? clip(authors[0], 80) : ''
  if (topic === 'author') return `${first || t} interview ${first ? t : ''}`.replace(/\s+/g, ' ').trim()
  return `${t}${first ? ` ${first}` : ''} book summary review`
}

/** Two spellings of one question share one cache row. */
export const cacheKey = (q: string): string => q.toLowerCase().replace(/\s+/g, ' ').trim()

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }
/** The Data API returns titles HTML-escaped. */
export const unescapeTitle = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#39);/g, m => ENTITIES[m] ?? m)

export const thumbOf = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

/** The `search.list` response → what the app shows. Anything unreadable is left out, never guessed. */
export function parseSearch(json: unknown): VideoItem[] {
  const items = (json as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  const out: VideoItem[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const id = (it as { id?: { videoId?: unknown } })?.id?.videoId
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id)) continue
    const sn = (it as { snippet?: Record<string, unknown> }).snippet ?? {}
    const title = unescapeTitle(clip(sn.title, 200))
    if (!title) continue
    seen.add(id)
    out.push({
      id, title,
      channel: unescapeTitle(clip(sn.channelTitle, 100)),
      thumb: thumbOf(id),
      publishedAt: clip(sn.publishedAt, 40),
    })
    if (out.length >= MAX_RESULTS) break
  }
  return out
}

/** A cached row is usable while it is younger than the TTL. */
export const isFresh = (fetchedAt: string, now = Date.now()): boolean => {
  const t = Date.parse(fetchedAt)
  return Number.isFinite(t) && now - t < CACHE_TTL_MS
}

/** The Data API says why it refused in `error.errors[].reason`. */
export const isQuotaReason = (json: unknown): boolean => {
  const errs = (json as { error?: { errors?: { reason?: unknown }[] } })?.error?.errors
  return Array.isArray(errs) && errs.some(e => e?.reason === 'quotaExceeded' || e?.reason === 'dailyLimitExceeded' || e?.reason === 'rateLimitExceeded')
}
