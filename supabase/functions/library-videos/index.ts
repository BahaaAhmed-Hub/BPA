/**
 * library-videos — Supabase Edge Function
 *
 * The Library's **Videos** button: reviews and summaries of a book, or the
 * author talking about it, as titles with thumbnails.
 *
 * It is a function and not a browser call for one reason: the YouTube Data API
 * key and its daily quota belong to the whole project. Every search is cached
 * for a week in `library_video_cache` (20260046, `next_page` from 20260047), so
 * the same book asked twice costs one call, and a failing YouTube still answers
 * from an older row.
 *
 * **One search is a page of 50 candidates, judged against the book** (see
 * `_shared/libraryVideos.ts`): each is marked `strict` when its title names this
 * book. The app shows the strict ones and keeps the rest one press away. A page
 * costs the same quota whatever its size, so asking for 50 is free precision.
 * `more: true` fetches the next page of the same search and adds it to the row —
 * up to `MAX_STORED` — which is the only thing that spends more quota.
 *
 * Always answers 200 with a `status` the app can word — only a missing sign-in
 * or a malformed body is an HTTP error:
 *   ok              items, `canMore` (another page exists), maybe `stale: true`
 *                   (an older cached answer) or `moreStatus` (the extra page failed)
 *   not_configured  no YOUTUBE_API_KEY secret; the app shows a plain YouTube link
 *   quota           the project's daily quota is spent
 *   unreachable     YouTube did not answer
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Secret: YOUTUBE_API_KEY.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  MAX_STORED, PAGE_SIZE, cacheKey, isFresh, isQuotaReason, mergeItems, nextToken, parseSearch, videoQuery,
  type BookRef, type VideoItem, type VideoTopic,
} from '../_shared/libraryVideos.ts'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const YOUTUBE_API_KEY           = Deno.env.get('YOUTUBE_API_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Failure = 'not_configured' | 'quota' | 'unreachable'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'not signed in' }, 401)
  const { data: who, error: authErr } = await admin.auth.getUser(jwt)
  if (authErr || !who.user) return json({ error: 'not signed in' }, 401)

  // The Library's own gate: a plan without it does not spend the project's quota.
  const { data: allowed } = await admin.rpc('has_module', { uid: who.user.id, mod: 'library' })
  if (allowed !== true) return json({ error: 'the Library is not on this plan' }, 403)

  let body: { title?: unknown; authors?: unknown; topic?: unknown; more?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad body' }, 400) }
  const topic: VideoTopic = body.topic === 'author' ? 'author' : 'review'
  const q = videoQuery(body.title, body.authors, topic)
  if (!q) return json({ error: 'a title is needed' }, 400)
  const book: BookRef = {
    title: String(body.title).slice(0, 160),
    authors: Array.isArray(body.authors) ? body.authors.filter((a): a is string => typeof a === 'string').slice(0, 3).map(a => a.slice(0, 80)) : [],
  }
  const key = cacheKey(q)
  const more = body.more === true

  // `next_page` arrived with 20260047; a project that has not run it still answers, it just cannot page.
  let cached: { items: VideoItem[]; fetched_at: string; next_page: string | null } | null = null
  {
    let r = await admin.from('library_video_cache').select('items, fetched_at, next_page').eq('query', key).maybeSingle()
    if (r.error) r = await admin.from('library_video_cache').select('items, fetched_at').eq('query', key).maybeSingle()
    const row = r.data as { items?: unknown; fetched_at?: string; next_page?: string | null } | null
    if (row && Array.isArray(row.items) && row.fetched_at) cached = { items: row.items as VideoItem[], fetched_at: row.fetched_at, next_page: row.next_page ?? null }
  }

  const store = async (items: VideoItem[], next: string | null) => {
    const row = { query: key, items, fetched_at: new Date().toISOString(), next_page: next }
    const w = await admin.from('library_video_cache').upsert(row, { onConflict: 'query' })
    if (w.error) { const { next_page: _n, ...base } = row; await admin.from('library_video_cache').upsert(base, { onConflict: 'query' }) }
  }

  const askYouTube = async (pageToken: string | null): Promise<{ ok: true; payload: unknown } | { ok: false; why: Failure }> => {
    if (!YOUTUBE_API_KEY) return { ok: false, why: 'not_configured' }
    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    const params: Record<string, string> = { part: 'snippet', type: 'video', maxResults: String(PAGE_SIZE), safeSearch: 'moderate', q, key: YOUTUBE_API_KEY }
    if (pageToken) params.pageToken = pageToken
    url.search = new URLSearchParams(params).toString()
    let res: Response
    try { res = await fetch(url, { signal: AbortSignal.timeout(10_000) }) } catch { return { ok: false, why: 'unreachable' } }
    let payload: unknown = null
    try { payload = await res.json() } catch { /* handled by status below */ }
    if (!res.ok) return { ok: false, why: res.status === 403 && isQuotaReason(payload) ? 'quota' : 'unreachable' }
    return { ok: true, payload }
  }

  /* ── the next page of a search we already hold ─────────────────────── */
  if (more) {
    const have = cached?.items ?? []
    if (!cached?.next_page || have.length >= MAX_STORED) return json({ status: 'ok', items: have, canMore: false, cached: true })
    const r = await askYouTube(cached.next_page)
    if (!r.ok) return json({ status: 'ok', items: have, canMore: true, cached: true, moreStatus: r.why })
    const merged = mergeItems(have, parseSearch(r.payload, book))
    const next = merged.length >= MAX_STORED ? null : nextToken(r.payload)
    await store(merged, next)
    return json({ status: 'ok', items: merged, canMore: next !== null, cached: false })
  }

  /* ── a search ──────────────────────────────────────────────────────── */
  if (cached && isFresh(cached.fetched_at)) return json({ status: 'ok', items: cached.items, canMore: !!cached.next_page, cached: true })

  // Out of date or never asked. If we cannot ask, an old answer beats none.
  const fallback = (status: Failure) =>
    cached?.items.length ? json({ status: 'ok', items: cached.items, canMore: !!cached.next_page, cached: true, stale: true }) : json({ status, items: [], canMore: false })

  const r = await askYouTube(null)
  if (!r.ok) return fallback(r.why)
  const items = parseSearch(r.payload, book)
  const next = nextToken(r.payload)
  // An empty answer is a real answer ("nothing found"), but it is not worth a week of silence.
  if (items.length) await store(items, next)
  return json({ status: 'ok', items, canMore: next !== null && items.length > 0, cached: false })
})
