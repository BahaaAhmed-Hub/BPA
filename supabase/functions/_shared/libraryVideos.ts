/**
 * libraryVideos.ts — the rules behind the Library's "Videos" button.
 *
 * Pure (no Deno, no network) so `scripts/library-book-media-rules.mjs` can run the
 * real thing. `library-videos/index.ts` is only the database and YouTube handed
 * to these.
 *
 * Three decisions live here:
 *  • **What is asked.** The book's title as a quoted phrase and its first author.
 *  • **What is believed.** YouTube's answer is data. An id that is not an
 *    11-character id is dropped, and the thumbnail is *derived from the id*
 *    (`i.ytimg.com/vi/<id>/mqdefault.jpg`) instead of trusting a URL the response
 *    carries — the same rule `linkPreview.ts` follows on the client.
 *  • **What is about THIS book.** YouTube ranks by what people watch, not by what a
 *    title says, so a search for one book returns videos about its neighbours. Each
 *    candidate is judged against the book (`isAboutBook`) and marked `strict` or
 *    not; the app shows the strict ones and keeps the rest one press away. A page of
 *    50 candidates costs the same quota as a page of 1, so we ask for 50 and filter,
 *    rather than asking for few and hoping.
 */

export type VideoTopic = 'review' | 'author'

export interface BookRef { title: string; authors: string[] }

export interface VideoItem {
  id: string
  title: string
  channel: string
  thumb: string
  publishedAt: string
  /** The title names this book (and, for a short title, its author). False = probably about something nearby. */
  strict: boolean
  /** Times watched, or `null` when YouTube did not say (the count could not be fetched). */
  views: number | null
  /** Likes, or `null` — a channel can hide them, and that is not the same as zero. */
  likes: number | null
}

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
/** `search.list` costs the same whatever `maxResults` is, up to 50 — so every page asks for all of them. */
export const PAGE_SIZE = 50
/** What one search may keep in total, across "find more". */
export const MAX_STORED = 150
/** A week: what a channel has said about a book does not change by the hour, and the quota does not refill by the hour. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Bumped when the shape or the rules change, so older cached rows are not trusted. */
export const CACHE_VERSION = 'v3'

const clip = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** Case, accents and punctuation set aside, words separated by single spaces — in any script. */
export const norm = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The title without its subtitle: "Atomic Habits: An Easy…" is called "Atomic Habits" by everyone. */
export const mainTitle = (title: string): string => title.split(/\s*[:–—]\s+|\s+-\s+/)[0].trim()

/** The first author's last name, normalised — what a video's title or description is likely to say. */
export function surnameOf(authors: string[]): string {
  const first = norm(authors[0] ?? '')
  const last = first.split(' ').filter(Boolean).pop() ?? ''
  return last.length >= 2 ? last : ''
}

/** The search for a book. `null` when there is nothing to search for. */
export function videoQuery(title: unknown, authors: unknown, topic: VideoTopic): string | null {
  const t = clip(title, 160)
  if (!t) return null
  const main = mainTitle(t).replace(/"/g, '').trim() || t.replace(/"/g, '')
  const first = Array.isArray(authors) ? clip(authors[0], 80) : ''
  if (topic === 'author') return `${first ? `${first} ` : ''}"${main}" ${first ? 'interview' : 'author interview'}`
  return `"${main}"${first ? ` ${first}` : ''} book summary review`
}

/** Two spellings of one question share one cache row — and an older version of the rules does not. */
export const cacheKey = (q: string): string => `${CACHE_VERSION}|${q.toLowerCase().replace(/\s+/g, ' ').trim()}`

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }
/** The Data API returns titles HTML-escaped. */
export const unescapeTitle = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#39);/g, m => ENTITIES[m] ?? m)

export const thumbOf = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

/* ── is it about THIS book? ────────────────────────────────────────────── */

const hasPhrase = (hay: string, needle: string): boolean => !!needle && ` ${hay} `.includes(` ${needle} `)

/** Things that name a book without being about it: a list of other books, a film's trailer, a game, the whole thing read aloud. */
const NEARBY = /\b(books? like|similar to|better than|alternatives? to|instead of|vs|trailer|soundtrack|ost|gameplay|walkthrough|full audio ?book)\b/

/**
 * The rule, and why each half is there:
 *  • the **video's title** must contain the book's title as whole words. A description is a poor witness — a
 *    "top 10 books" video lists a dozen titles in its description — and "Habit" must not match "Habits";
 *  • a **short** title (one or two words — "Dune", "Atomic Habits", "It") is common enough to name other things, so
 *    the author's surname must also appear in the title, the channel or the description. A longer title names the
 *    book by itself;
 *  • with **no author on record** the title is all there is to go on;
 *  • a title that says it is about something nearby (see `NEARBY`) is not about this book.
 */
export function isAboutBook(v: { title: string; channel: string; description: string }, book: BookRef): boolean {
  const wanted = norm(mainTitle(book.title))
  if (!wanted) return false
  const title = norm(v.title)
  if (!hasPhrase(title, wanted)) return false
  if (NEARBY.test(title)) return false
  const surname = surnameOf(book.authors)
  if (wanted.split(' ').length >= 3 || !surname) return true
  return hasPhrase(norm(`${v.title} ${v.channel} ${v.description}`), surname)
}

/* ── YouTube's answer, read ────────────────────────────────────────────── */

/** The `search.list` response → what the app shows. Anything unreadable is left out, never guessed. */
export function parseSearch(json: unknown, book: BookRef): VideoItem[] {
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
    const channel = unescapeTitle(clip(sn.channelTitle, 100))
    out.push({
      id, title, channel, thumb: thumbOf(id), publishedAt: clip(sn.publishedAt, 40),
      strict: isAboutBook({ title, channel, description: unescapeTitle(clip(sn.description, 400)) }, book),
      // The search does not say how many watched it; `applyStats` fills these from `videos.list`.
      views: null, likes: null,
    })
    if (out.length >= PAGE_SIZE) break
  }
  return out
}

/* ── how many watched it, and how many liked it ────────────────────────── */

export interface Stats { views: number | null; likes: number | null }

/** YouTube sends counts as digit strings. Anything else — a negative, a float, text, an absurd length — is "not said", never 0. */
const toCount = (v: unknown): number | null => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null)

/** The `videos.list?part=statistics` response → a count per video. A hidden like count is `null`, not zero. */
export function parseStats(json: unknown): Map<string, Stats> {
  const out = new Map<string, Stats>()
  const items = (json as { items?: unknown })?.items
  if (!Array.isArray(items)) return out
  for (const it of items) {
    const id = (it as { id?: unknown })?.id
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) continue
    const s = (it as { statistics?: Record<string, unknown> }).statistics ?? {}
    out.set(id, { views: toCount(s.viewCount), likes: toCount(s.likeCount) })
  }
  return out
}

/** The counts put on the videos they belong to. A video with no entry keeps what it had. */
export function applyStats(items: VideoItem[], stats: Map<string, Stats>): VideoItem[] {
  return items.map(v => { const s = stats.get(v.id); return s ? { ...v, views: s.views, likes: s.likes } : v })
}

/** The token for the next page, only if it is shaped like one. */
export function nextToken(json: unknown): string | null {
  const t = (json as { nextPageToken?: unknown })?.nextPageToken
  return typeof t === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(t) ? t : null
}

/** A later page added to what was kept: nothing twice, the first sighting wins, never more than `cap`. */
export function mergeItems(kept: VideoItem[], more: VideoItem[], cap = MAX_STORED): VideoItem[] {
  const seen = new Set(kept.map(v => v.id))
  const out = [...kept]
  for (const v of more) { if (!seen.has(v.id)) { seen.add(v.id); out.push(v) } }
  return out.slice(0, cap)
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
