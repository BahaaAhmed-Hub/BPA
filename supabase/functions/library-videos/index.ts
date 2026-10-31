/**
 * library-videos — Supabase Edge Function
 *
 * The Library's **Videos** button: reviews and summaries of a book, or the
 * author talking about it, as titles with thumbnails.
 *
 * It is a function and not a browser call for one reason: the YouTube Data API
 * key and its daily quota belong to the whole project. Every search is cached
 * for a week in `library_video_cache` (20260046), so the same book asked twice
 * costs one call, and a failing YouTube still answers from an older row.
 *
 * Always answers 200 with a `status` the app can word — only a missing sign-in
 * or a malformed body is an HTTP error:
 *   ok              items (maybe `stale: true` — an older cached answer)
 *   not_configured  no YOUTUBE_API_KEY secret; the app shows a plain YouTube link
 *   quota           the project's daily quota is spent
 *   unreachable     YouTube did not answer
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Secret: YOUTUBE_API_KEY.
 * Rules (pure, tested): `_shared/libraryVideos.ts`.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  MAX_RESULTS, cacheKey, isFresh, isQuotaReason, parseSearch, videoQuery,
  type VideoItem, type VideoTopic,
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

  let body: { title?: unknown; authors?: unknown; topic?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad body' }, 400) }
  const topic: VideoTopic = body.topic === 'author' ? 'author' : 'review'
  const q = videoQuery(body.title, body.authors, topic)
  if (!q) return json({ error: 'a title is needed' }, 400)
  const key = cacheKey(q)

  const { data: cached } = await admin.from('library_video_cache').select('items, fetched_at').eq('query', key).maybeSingle()
  const cachedItems = Array.isArray(cached?.items) ? (cached!.items as VideoItem[]) : null
  if (cachedItems && cached && isFresh(cached.fetched_at)) return json({ status: 'ok', items: cachedItems, cached: true })

  // Out of date or never asked. If we cannot ask, an old answer beats none.
  const fallback = (status: 'not_configured' | 'quota' | 'unreachable') =>
    cachedItems?.length ? json({ status: 'ok', items: cachedItems, cached: true, stale: true }) : json({ status, items: [] })

  if (!YOUTUBE_API_KEY) return fallback('not_configured')

  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.search = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: String(MAX_RESULTS), safeSearch: 'moderate', q, key: YOUTUBE_API_KEY,
  }).toString()

  let res: Response
  try { res = await fetch(url, { signal: AbortSignal.timeout(10_000) }) }
  catch { return fallback('unreachable') }

  let payload: unknown = null
  try { payload = await res.json() } catch { /* handled by status below */ }

  if (!res.ok) return fallback(res.status === 403 && isQuotaReason(payload) ? 'quota' : 'unreachable')

  const items = parseSearch(payload)
  // An empty answer is a real answer ("nothing found"), but it is not worth a week of silence.
  if (items.length) {
    await admin.from('library_video_cache').upsert({ query: key, items, fetched_at: new Date().toISOString() }, { onConflict: 'query' })
  }
  return json({ status: 'ok', items, cached: false })
})
