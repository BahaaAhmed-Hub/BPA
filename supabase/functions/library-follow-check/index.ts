/**
 * library-follow-check — Supabase Edge Function
 *
 * The authors and series a person follows (20260029) used to be checked only
 * while the Following view was open. This asks Open Library the same questions
 * on a schedule and writes what it finds to `library_follow_news` (20260037),
 * so the answer is waiting when the app is opened — and the bell can say so.
 *
 * Two ways in, nothing else (the arrangement `mail-smart-run` uses):
 *   • the schedule, carrying `x-cron-secret` = the CRON_SECRET function secret
 *       → every follow of everyone who has the Library;
 *   • a signed-in user → only their own follows ("Check now").
 *
 * The rules are `_shared/releases.ts` and `_shared/releaseRun.ts`, which are
 * pure and tested (`scripts/library-releases-*.mjs`); this file is only the
 * database and the network handed to them.
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Secret: CRON_SECRET.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseDocs, searchUrl } from '../_shared/releases.ts'
import { runChecks, type FollowRow, type NewNews, type RunIO } from '../_shared/releaseRun.ts'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET               = Deno.env.get('CRON_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const secret = req.headers.get('x-cron-secret') ?? ''
  const isCron = !!CRON_SECRET && secret === CRON_SECRET

  let onlyUser: string | null = null
  if (!isCron) {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'not signed in' }, 401)
    const { data, error } = await admin.auth.getUser(jwt)
    if (error || !data.user) return json({ error: 'not signed in' }, 401)
    onlyUser = data.user.id
  }

  let q = admin.from('library_follows').select('id, user_id, name, query, seen_keys, last_checked_at').limit(2000)
  if (onlyUser) q = q.eq('user_id', onlyUser)
  const { data: follows, error: fErr } = await q
  if (fErr) return json({ error: fErr.message }, 500)

  const io: RunIO = {
    async fetchWorks(query) {
      const res = await fetch(searchUrl(query), {
        headers: { 'User-Agent': 'ProfessorApp/1.0 (library release check)', Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) throw new Error(`Open Library ${res.status}`)
      return parseDocs(await res.json())
    },
    async shelfOf(userId) {
      const { data, error } = await admin.from('library_books').select('title, authors, isbn').eq('user_id', userId)
      if (error) throw new Error(error.message)
      return (data ?? []).map((b: { title: string; authors: string[] | null; isbn: string | null }) => ({ title: b.title, authors: b.authors ?? [], isbn: b.isbn ?? undefined }))
    },
    async hasModule(userId) {
      const { data, error } = await admin.rpc('has_module', { uid: userId, mod: 'library' })
      if (error) throw new Error(error.message)
      return data === true
    },
    async existingNews(followId) {
      const { data, error } = await admin.from('library_follow_news').select('work_key, title, authors, isbn').eq('follow_id', followId)
      if (error) throw new Error(error.message)
      return data ?? []
    },
    async saveNews(rows: NewNews[]) {
      const { error } = await admin.from('library_follow_news').upsert(rows, { onConflict: 'follow_id,work_key', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },
    async clearNews(followId, workKeys) {
      const { error } = await admin.from('library_follow_news').delete().eq('follow_id', followId).in('work_key', workKeys)
      if (error) throw new Error(error.message)
    },
    async markChecked(followId, ok, at) {
      await admin.from('library_follows').update({ last_checked_at: at, last_check_ok: ok }).eq('id', followId)
    },
    now: () => Date.now(),
  }

  try {
    const summary = await runChecks((follows ?? []) as FollowRow[], io)
    return json({ follows: follows?.length ?? 0, ...summary })
  } catch (e) {
    console.error('library-follow-check failed', e instanceof Error ? e.message : e)
    return json({ error: 'check failed' }, 500)
  }
})
