/**
 * health-ingest — Supabase Edge Function
 *
 * The far end of an iPhone Shortcut. Apple gives a web app no way to read
 * Health, so the phone pushes instead: a Shortcut reads a sample and POSTs the
 * number here, and this writes it as that day's quantity for one habit.
 *
 *   POST /functions/v1/health-ingest?token=<token>
 *   { "value": 8213, "date": "2026-09-07" }
 *
 * Add `&dry=1` to check the wiring without writing: it validates the token and
 * finds the habit, then stops.
 *
 * `value` may also be sent as a bare body, a form field, or `?value=`, because
 * Shortcuts makes some of those easier than others. `date` defaults to today in
 * the phone's own offset when it sends one, and to UTC otherwise.
 *
 * The token is the whole credential and identifies exactly one habit of one
 * user. It cannot read anything, and it cannot write anywhere else.
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers: { ...CORS, 'Content-Type': 'application/json' }, status })

/** Shortcuts will send "8,213" or "8213 steps" as happily as a number. */
function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const m = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const url   = new URL(req.url)
  const token = url.searchParams.get('token') ?? req.headers.get('x-health-token') ?? ''
  if (!token) return json({ error: 'Missing token' }, 401)

  // The body, in whichever shape the Shortcut found easiest.
  let value: number | null = toNumber(url.searchParams.get('value'))
  let date  = url.searchParams.get('date') ?? ''
  if (req.method === 'POST') {
    const raw = await req.text()
    if (raw) {
      try {
        const body = JSON.parse(raw) as Record<string, unknown>
        value = value ?? toNumber(body.value ?? body.quantity ?? body.steps ?? body.amount)
        const d = body.date
        if (!date && typeof d === 'string' && isDate(d)) date = d
      } catch {
        value = value ?? toNumber(raw)
      }
    }
  }
  // `?dry=1` answers "is this wired up?" without writing anything: it checks
  // the token and finds the habit, and stops there. The settings screen uses it
  // so "it is not working" can be told apart from "you have not walked yet".
  const dry = url.searchParams.get('dry') !== null
  if (value === null && !dry) return json({ error: 'No number in the request' }, 400)
  if (!isDate(date)) date = new Date().toISOString().slice(0, 10)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: link } = await admin
    .from('health_links')
    .select('id, user_id, habit_id, metric')
    .eq('token', token)
    .maybeSingle() as { data: { id: string; user_id: string; habit_id: string; metric: string } | null }

  if (!link) return json({ error: 'Unknown token' }, 403)

  if (dry) return json({ ok: true, dry: true, habit_id: link.habit_id, metric: link.metric, date })

  // Whether the day counts as done is the habit's own goal, not this
  // function's opinion — 400 steps against a 10,000 goal is a log, not a tick.
  const { data: habit } = await admin
    .from('habits')
    .select('goal')
    .eq('id', link.habit_id)
    .eq('user_id', link.user_id)
    .maybeSingle() as { data: { goal: number | null } | null }

  const goal = habit?.goal ?? null
  const completed = goal && goal > 0 ? value! >= goal : value! > 0

  // One row per habit per day — the table's own unique (habit_id, date). A
  // daily automation sending twice corrects the day rather than doubling it.
  const { error } = await admin
    .from('habit_logs')
    .upsert({
      user_id:  link.user_id,
      habit_id: link.habit_id,
      date,
      quantity: value!,
      completed,
    }, { onConflict: 'habit_id,date' })

  if (error) return json({ error: error.message }, 500)

  await admin.from('health_links').update({ last_seen_at: new Date().toISOString() }).eq('id', link.id)

  return json({ ok: true, habit_id: link.habit_id, metric: link.metric, date, value, completed })
})
