/**
 * mail-smart-run — Supabase Edge Function
 *
 * The daily half of the smart mail view, run without a browser open.
 *
 * **It deliberately does only the free half.** Fetching mail, telling a
 * newsletter from a person, working out whether you have replied and which of
 * the three sections a thread belongs in costs nothing but Gmail quota — so it
 * happens here, every night, for every mailbox marked as work. Writing the
 * one-line need and the drafted reply needs a language model, and the key for
 * that belongs to the user and lives in their browser. It is never sent here.
 *
 * So the split is: this leaves rows with `need` and `draft` null, and the app
 * fills those in the next time it is opened — cheaply, because the fetching and
 * the classification are already done and only genuinely new threads remain.
 *
 * That also means a user with no model configured still gets the whole view:
 * three sections, reply states, who is waiting on them. Only the sentences are
 * missing.
 *
 * POST { user_id? } — one user, or every user with a work mailbox when omitted.
 * Invoked nightly by pg_cron (see 20260016_mail_smart_schedule.sql), or by hand.
 *
 * Required secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET
 * Auto-injected:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID          = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET      = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const CRON_SECRET               = Deno.env.get('CRON_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const WINDOW_DAYS = 30
/** A ceiling per mailbox per run. What is left is picked up by the next run,
 *  because the watermark only advances over what was actually read. */
const MAX_PER_BOX = 40

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

import {
  looksAutomated, readThread, parseAddressList, displayName, headerOf, DAY,
  type MailHeader, type NeutralMessage, type NeutralThread,
} from '../_shared/mailRules.ts'

// ─── Gmail, as this function's provider ──────────────────────────────────────

function b64urlDecode(data: string): string {
  try {
    const s = data.replace(/-/g, '+').replace(/_/g, '/')
    return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)))
  } catch { return '' }
}

// deno-lint-ignore no-explicit-any
function bodyOf(payload: any): string {
  if (!payload) return ''
  const walk = (p: any, want: string): string => {
    if (p.mimeType === want && p.body?.data) return b64urlDecode(p.body.data)
    for (const c of p.parts ?? []) {
      const got = walk(c, want)
      if (got) return got
    }
    return ''
  }
  const text = walk(payload, 'text/plain')
  if (text) return text
  const html = walk(payload, 'text/html')
  return html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

// deno-lint-ignore no-explicit-any
function toNeutral(m: any): NeutralMessage {
  const hs: MailHeader[] = m.payload?.headers ?? []
  const from = headerOf(hs, 'From')
  return {
    id: m.id,
    sentAt: Number(m.internalDate),
    from: parseAddressList(from)[0] ?? '',
    fromName: displayName(from),
    to: parseAddressList(headerOf(hs, 'To')),
    cc: parseAddressList(headerOf(hs, 'Cc')),
    subject: headerOf(hs, 'Subject'),
    snippet: m.snippet ?? '',
    body: bodyOf(m.payload),
    headers: hs,
  }
}

async function gmail<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return await res.json() as T
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

interface TokenRow {
  account_id: string; account_email?: string
  access_token: string; refresh_token: string; expires_at: string
}

// deno-lint-ignore no-explicit-any
async function freshToken(admin: any, row: TokenRow): Promise<string | null> {
  if (Date.now() + 5 * 60 * 1000 < new Date(row.expires_at).getTime()) return row.access_token
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !row.refresh_token) return null
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET, refresh_token: row.refresh_token,
    }),
  })
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!res.ok || !data.access_token) return null
  await admin.from('google_account_tokens').update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('account_id', row.account_id)
  return data.access_token
}

// ─── One user ────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function runForUser(admin: any, userId: string, now: number): Promise<{ read: number; stored: number }> {
  // Which mailboxes are work. The browser keeps this in a shared preference,
  // which prefSync mirrors into users.schedule_rules.shared_prefs — so the flag
  // the person set on their laptop is the flag this reads at 3am.
  const { data: u } = await admin.from('users')
    .select('id, email, full_name, schedule_rules').eq('id', userId).maybeSingle()
  if (!u) return { read: 0, stored: 0 }

  const prefs = (u.schedule_rules?.shared_prefs ?? {}) as Record<string, string>
  let business: string[] = []
  try {
    const raw = prefs['mail-business-accounts']
    const list = raw ? JSON.parse(raw) : []
    if (Array.isArray(list)) business = list.filter(x => typeof x === 'string').map(x => x.toLowerCase())
  } catch { /* a malformed preference is no mailboxes, not a crash */ }
  if (business.length === 0) return { read: 0, stored: 0 }

  const { data: tokens } = await admin.from('google_account_tokens')
    .select('account_id, account_email, access_token, refresh_token, expires_at')
    .eq('user_id', userId)
  const rows = (tokens ?? []) as TokenRow[]

  const me = new Set<string>([String(u.email ?? '').toLowerCase(), ...business])
  const firstName = String(u.full_name ?? '').trim().split(/\s+/)[0] ?? ''
  const from = now - WINDOW_DAYS * DAY

  let read = 0
  const out: Record<string, unknown>[] = []

  for (const box of business) {
    const row = rows.find(r => (r.account_email ?? '').toLowerCase() === box)
    if (!row) continue                       // no server-side token for it yet
    const token = await freshToken(admin, row)
    if (!token) continue

    const { data: mark } = await admin.from('mail_smart_sync')
      .select('synced_to').eq('user_id', userId).eq('account_email', box).maybeSingle()
    const since = Math.max(mark?.synced_to ? new Date(mark.synced_to).getTime() : 0, from)
    const after = Math.floor(Math.max(0, since - 1000) / 1000)

    const list = await gmail<{ threads?: { id: string }[] }>(token,
      `/users/me/threads?maxResults=${MAX_PER_BOX}&q=${encodeURIComponent(`after:${after} -in:chats -in:spam -in:trash`)}`)
    if (!list) continue

    const { data: known } = await admin.from('mail_smart_threads')
      .select('thread_id, last_message_id')
      .eq('user_id', userId).eq('account_email', box)
    const seen = new Map<string, string>()
    for (const k of known ?? []) seen.set(k.thread_id, k.last_message_id)

    let newest = since
    for (const { id } of list.threads ?? []) {
      const full = await gmail<{ id: string; messages?: unknown[] }>(token, `/users/me/threads/${id}?format=full`)
      if (!full) continue
      read++
      // deno-lint-ignore no-explicit-any
      const msgs = ((full.messages ?? []) as any[]).map(toNeutral).sort((a, b) => a.sentAt - b.sentAt)
      const thread: NeutralThread = { id: full.id, messages: msgs }
      const f = readThread(thread, me, firstName, now)
      if (!f) continue
      newest = Math.max(newest, f.lastAt)
      // Already read, and nothing has happened since.
      if (seen.get(f.threadId) === f.lastMessageId) continue

      const newestMsg = msgs.filter(m => !me.has(m.from.toLowerCase())).pop() ?? msgs[msgs.length - 1]
      const accountIsBusiness = business.includes(box)
      if (looksAutomated(newestMsg)) continue
      if (!accountIsBusiness && !f.internal) continue

      out.push({
        user_id: userId, account_email: box, thread_id: f.threadId,
        last_message_id: f.lastMessageId, last_at: new Date(f.lastAt).toISOString(),
        subject: f.subject, from_name: f.fromName, from_email: f.fromEmail,
        section: f.section, reply_state: f.replyState,
        // Left for the browser, which is where the model key is.
        need: null, draft: null, direct: false,
        addressed_to: f.addressedTo, named_in_body: f.namedInBody,
        bottleneck: f.bottleneck, awaiting_customer: f.awaitingCustomer,
        handled_at: null, analyzed_at: new Date().toISOString(),
      })
    }

    await admin.from('mail_smart_sync').upsert({
      user_id: userId, account_email: box,
      synced_to: new Date(newest).toISOString(), last_run_at: new Date().toISOString(),
    }, { onConflict: 'user_id,account_email' })
  }

  if (out.length) {
    await admin.from('mail_smart_threads')
      .upsert(out, { onConflict: 'user_id,account_email,thread_id' })
  }
  await admin.from('mail_smart_threads')
    .delete().eq('user_id', userId).lt('last_at', new Date(from).toISOString())

  return { read, stored: out.length }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Two ways in: the nightly schedule, which carries the shared secret, and a
  // signed-in user asking for their own. Nothing else.
  const auth = req.headers.get('authorization') ?? ''
  const secret = req.headers.get('x-cron-secret') ?? ''
  const isCron = !!CRON_SECRET && secret === CRON_SECRET

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = Date.now()

  let userIds: string[] = []
  if (isCron) {
    const body = await req.json().catch(() => ({})) as { user_id?: string }
    if (body.user_id) userIds = [body.user_id]
    else {
      // Everyone who has marked a mailbox as work. A user who never did is not
      // asked about, which is most of the cost of a nightly sweep avoided.
      const { data } = await admin.from('users')
        .select('id, schedule_rules')
        .not('schedule_rules', 'is', null)
      userIds = (data ?? [])
        .filter((r: { schedule_rules?: { shared_prefs?: Record<string, string> } }) =>
          !!r.schedule_rules?.shared_prefs?.['mail-business-accounts'])
        .map((r: { id: string }) => r.id)
    }
  } else {
    const jwt = auth.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'not signed in' }, 401)
    const { data, error } = await admin.auth.getUser(jwt)
    if (error || !data.user) return json({ error: 'not signed in' }, 401)
    userIds = [data.user.id]
  }

  const results: Record<string, { read: number; stored: number }> = {}
  for (const id of userIds) {
    try {
      results[id] = await runForUser(admin, id, now)
    } catch (e) {
      // One user's broken token is not the others' problem.
      results[id] = { read: 0, stored: 0 }
      console.error('mail-smart-run failed for', id, e instanceof Error ? e.message : e)
    }
  }
  return json({ users: userIds.length, results })
})
