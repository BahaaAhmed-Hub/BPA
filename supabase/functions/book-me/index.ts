// ─── book-me — the only thing an outsider ever talks to ─────────────────────
//
// The public booking page is served out of the same JavaScript bundle as the
// app, which means the anon key is in the hands of everyone who opens it. So
// the boundary cannot be the client: `20260024_booking.sql` gives the booking
// tables **no policy for anybody but the owner**, and this function — service
// role, `--no-verify-jwt` — is the whole of the public surface.
//
// What it will say:
//   profile   who the page is and which calls can be booked
//   slots     free starts, as instants. No titles, ever.
//   book      one booking, and the calendar event behind it
//   manage    cancel or move, by the token in the confirmation
//   decide    the owner accepting or declining one that needs approval
//
// Three rules it keeps, each of them a mistake this project has made before:
//
// - **A diary it could not read is never answered as an empty one.** A refused
//   token or one calendar erroring means "cannot say", not "nothing on" — the
//   difference between a stranger waiting and a stranger booking over your
//   afternoon.
// - **Nothing the client sends about *when* is trusted.** The slot is
//   recomputed from the windows and the live diary on every write; the
//   unique index decides who got there first.
// - **A stranger's words never reach a calendar unchecked.** A name is capped
//   and stripped of newlines, a note is capped, an address has to look like one.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CalendarHub } from '../_shared/googleCalendars.ts'
import { askableRange, slotsFor, knownZone } from '../_shared/slots.ts'
import type { Interval, PlanRules, WindowRow } from '../_shared/slots.ts'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')     ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const CAL_API = 'https://www.googleapis.com/calendar/v3'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
const fail = (why: string, status = 400, extra: Record<string, unknown> = {}) =>
  json({ error: why, ...extra }, status)

// ─── What the tables hold ────────────────────────────────────────────────────

interface Profile {
  user_id: string; handle: string; display_name: string | null
  blurb: string | null; timezone: string; active: boolean
}

interface Plan extends PlanRules {
  id: string; user_id: string; slug: string; title: string; blurb: string | null
  target_calendar_id: string | null; target_account_id: string | null
  busy_calendar_ids: string[]
  location_mode: 'meet' | 'place' | 'phone' | 'none'
  location_text: string | null
  requires_approval: boolean; active: boolean
}

const PLAN_COLS =
  'id, user_id, slug, title, blurb, duration_minutes, slot_step_minutes, buffer_before, ' +
  'buffer_after, min_notice_minutes, horizon_days, max_per_day, narrow, target_calendar_id, ' +
  'target_account_id, busy_calendar_ids, location_mode, location_text, requires_approval, active'

async function profileOf(handle: string): Promise<Profile | null> {
  const { data } = await sb.from('booking_profile')
    .select('user_id, handle, display_name, blurb, timezone, active')
    .eq('handle', handle.toLowerCase()).maybeSingle()
  const p = data as Profile | null
  return p && p.active ? p : null
}

async function planOf(userId: string, slug: string): Promise<Plan | null> {
  const { data } = await sb.from('meeting_plans').select(PLAN_COLS)
    .eq('user_id', userId).eq('slug', slug).maybeSingle()
  const p = data as Plan | null
  return p && p.active ? p : null
}

// ─── What a stranger may say ─────────────────────────────────────────────────

/** One line, bounded. A name goes into a calendar title that other people read. */
function clean(s: unknown, max: number): string {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(s)
}

/** A rate limit, not a record of who visited — the address is never stored. */
async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const bytes = new TextEncoder().encode(`book-me:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** True when this caller has had enough for now. Failing open is deliberate:
 *  a ledger that cannot be read must not take the booking page down with it. */
async function tooMany(hash: string, planId: string | null, perHour: number): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await sb.from('booking_hits')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', hash).gte('at', since)
    await sb.from('booking_hits').insert({ ip_hash: hash, plan_id: planId })
    return (count ?? 0) >= perHour
  } catch { return false }
}

// ─── The diary ───────────────────────────────────────────────────────────────

function hubFor(userId: string): CalendarHub {
  return new CalendarHub(sb, userId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
}

/** Free starts for one plan over a range — or why it cannot say.
 *
 *  Any calendar it could not read refuses the whole answer. Offering the hours
 *  it *did* manage to read would be worse than refusing: the gap is exactly
 *  where the meeting it could not see is sitting.
 */
async function freeStarts(prof: Profile, plan: Plan, fromQ?: string, toQ?: string): Promise<
  { ok: true; slots: string[]; from: string; to: string } | { ok: false; why: string; accounts: string[] }
> {
  const tz = knownZone(prof.timezone) ? prof.timezone : 'UTC'
  const now = Date.now()
  const { from, to } = askableRange(plan, now, tz, fromQ, toQ)

  const { data: wrows } = await sb.from('booking_windows')
    .select('on_date, start_min, end_min, repeat, skips')
    .eq('user_id', prof.user_id).lte('on_date', to).limit(500)
  const windows = (wrows ?? []) as WindowRow[]
  if (!windows.length) return { ok: true, slots: [], from, to }

  // The range as instants, a day either side so a window on the edge is whole.
  const timeMin = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString()
  const timeMax = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86400000).toISOString()

  const hub = hubFor(prof.user_id)
  if (!hub.configured) return { ok: false, why: 'calendar_not_configured', accounts: [] }
  const { busy, failed } = await hub.freeBusy(plan.busy_calendar_ids ?? [], timeMin, timeMax)
  if (failed.length) return { ok: false, why: 'diary_unreadable', accounts: failed }

  const { data: brows } = await sb.from('bookings')
    .select('start_at, end_at').eq('user_id', prof.user_id)
    .neq('status', 'cancelled').gte('start_at', timeMin).lte('start_at', timeMax)
  const taken: Interval[] = ((brows ?? []) as { start_at: string; end_at: string }[])
    .map(b => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))

  const slots = slotsFor({
    windows, plan, tz, from, to,
    busy: busy.map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
    taken, now,
  })
  return { ok: true, slots, from, to }
}

/** Where this plan's bookings go, and the token to write them with. */
async function writeTarget(plan: Plan, hub: CalendarHub): Promise<{ calendarId: string; token: string } | null> {
  const cals = await hub.calendars()
  const wanted = plan.target_calendar_id
    ? cals.find(c => c.calendarId === plan.target_calendar_id && c.writable)
    : undefined
  // A plan naming a calendar that is no longer there does **not** fall back to
  // your own diary: a client's call landing on the personal calendar is the
  // planner's old mistake, and silence about it is the worse half.
  if (plan.target_calendar_id && !wanted) return null
  const cal = wanted ?? cals.find(c => c.primary && c.writable) ?? cals.find(c => c.writable)
  if (!cal) return null
  const token = await hub.token(cal.accountId)
  return token ? { calendarId: cal.calendarId, token } : null
}

interface BookingRow {
  id: string; plan_id: string; user_id: string
  start_at: string; end_at: string
  invitee_name: string; invitee_email: string; invitee_note: string | null
  status: string; gcal_event_id: string | null; gcal_calendar_id: string | null
  manage_token: string
}

/** Writes the event for a booking and remembers where it went. */
async function writeEvent(plan: Plan, b: BookingRow): Promise<{ ok: true } | { ok: false; why: string }> {
  const hub = hubFor(plan.user_id)
  if (!hub.configured) return { ok: false, why: 'calendar_not_configured' }
  const target = await writeTarget(plan, hub)
  if (!target) return { ok: false, why: 'no_writable_calendar' }

  const body: Record<string, unknown> = {
    summary: `${plan.title} · ${b.invitee_name}`,
    description: [
      b.invitee_note ? b.invitee_note : null,
      b.invitee_note ? '' : null,
      `Booked by ${b.invitee_name} <${b.invitee_email}>`,
    ].filter(x => x !== null).join('\n'),
    start: { dateTime: b.start_at },
    end:   { dateTime: b.end_at },
    attendees: [{ email: b.invitee_email, displayName: b.invitee_name }],
    reminders: { useDefault: true },
  }
  if (plan.location_mode === 'place' && plan.location_text) body.location = plan.location_text
  if (plan.location_mode === 'phone' && plan.location_text) body.location = plan.location_text
  if (plan.location_mode === 'meet') {
    body.conferenceData = {
      createRequest: { requestId: `book-${b.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    }
  }

  const res = await fetch(
    `${CAL_API}/calendars/${encodeURIComponent(target.calendarId)}/events` +
    `?sendUpdates=all&conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) return { ok: false, why: `calendar_refused_${res.status}` }
  const created = await res.json() as { id?: string }
  await sb.from('bookings').update({
    gcal_event_id: created.id ?? null, gcal_calendar_id: target.calendarId,
  }).eq('id', b.id)
  return { ok: true }
}

async function removeEvent(plan: Plan, b: BookingRow): Promise<boolean> {
  if (!b.gcal_event_id || !b.gcal_calendar_id) return true   // nothing was written
  const hub = hubFor(plan.user_id)
  const cals = await hub.calendars()
  const cal = cals.find(c => c.calendarId === b.gcal_calendar_id)
  const token = cal ? await hub.token(cal.accountId) : null
  if (!token) return false
  const res = await fetch(
    `${CAL_API}/calendars/${encodeURIComponent(b.gcal_calendar_id)}/events/${encodeURIComponent(b.gcal_event_id)}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  // 404 and 410 mean it is already gone, which is the state we wanted.
  return res.ok || res.status === 404 || res.status === 410
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function doProfile(handle: string): Promise<Response> {
  const prof = await profileOf(handle)
  if (!prof) return fail('no_such_page', 404)
  const { data } = await sb.from('meeting_plans')
    .select('slug, title, blurb, duration_minutes, location_mode, requires_approval')
    .eq('user_id', prof.user_id).eq('active', true).order('sort_order', { ascending: true })
  return json({
    handle: prof.handle,
    name: prof.display_name ?? prof.handle,
    blurb: prof.blurb,
    timezone: knownZone(prof.timezone) ? prof.timezone : 'UTC',
    plans: data ?? [],
  })
}

async function doSlots(url: URL): Promise<Response> {
  const prof = await profileOf(url.searchParams.get('handle') ?? '')
  if (!prof) return fail('no_such_page', 404)
  const plan = await planOf(prof.user_id, url.searchParams.get('plan') ?? '')
  if (!plan) return fail('no_such_plan', 404)

  const got = await freeStarts(prof, plan, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined)
  if (!got.ok) {
    // 200 with a reason, not an empty list: the page has to be able to tell
    // "he has nothing free" from "we could not look".
    return json({ unreadable: true, why: got.why, accounts: got.accounts.length }, 200)
  }
  return json({
    slots: got.slots, from: got.from, to: got.to,
    timezone: knownZone(prof.timezone) ? prof.timezone : 'UTC',
    duration: plan.duration_minutes,
    title: plan.title, blurb: plan.blurb,
    location_mode: plan.location_mode,
    requires_approval: plan.requires_approval,
  })
}

async function doBook(req: Request, body: Record<string, unknown>): Promise<Response> {
  const prof = await profileOf(String(body.handle ?? ''))
  if (!prof) return fail('no_such_page', 404)
  const plan = await planOf(prof.user_id, String(body.plan ?? ''))
  if (!plan) return fail('no_such_plan', 404)

  const hash = await ipHash(req)
  if (await tooMany(hash, plan.id, 10)) return fail('too_many', 429)

  const name  = clean(body.name, 60)
  const email = clean(body.email, 160).toLowerCase()
  const note  = clean(body.note, 2000)
  const start = String(body.start ?? '')
  if (!name)                  return fail('name_needed')
  if (!looksLikeEmail(email)) return fail('email_needed')
  if (!Date.parse(start))     return fail('slot_needed')

  // **Never trust the client about when.** The offer is recomputed here, from
  // the windows and the live diary, and the start has to be in it.
  const got = await freeStarts(prof, plan)
  if (!got.ok) return json({ unreadable: true, why: got.why }, 503)
  const startIso = new Date(start).toISOString()
  if (!got.slots.includes(startIso)) return json({ error: 'slot_gone', slots: got.slots }, 409)

  const endIso = new Date(Date.parse(startIso) + plan.duration_minutes * 60000).toISOString()
  const pending = plan.requires_approval
  const { data, error } = await sb.from('bookings').insert({
    plan_id: plan.id, user_id: prof.user_id,
    start_at: startIso, end_at: endIso,
    invitee_name: name, invitee_email: email,
    invitee_note: note || null,
    invitee_timezone: clean(body.timezone, 60) || null,
    status: pending ? 'pending' : 'confirmed',
    ip_hash: hash,
  }).select('id, plan_id, user_id, start_at, end_at, invitee_name, invitee_email, invitee_note, status, gcal_event_id, gcal_calendar_id, manage_token').maybeSingle()

  if (error) {
    // 23505: the slot index. Somebody else was a moment quicker.
    if ((error as { code?: string }).code === '23505') {
      const fresh = await freeStarts(prof, plan)
      return json({ error: 'slot_gone', slots: fresh.ok ? fresh.slots : [] }, 409)
    }
    return fail('could_not_book', 500)
  }
  const row = data as BookingRow

  if (!pending) {
    const wrote = await writeEvent(plan, row)
    if (!wrote.ok) {
      // A booking nobody can see is worse than a refusal, so it is taken back.
      await sb.from('bookings').delete().eq('id', row.id)
      return fail(wrote.why, 502)
    }
  }

  return json({
    status: row.status, start: row.start_at, end: row.end_at,
    manage_token: row.manage_token,
    name: prof.display_name ?? prof.handle,
    title: plan.title,
    location_mode: plan.location_mode,
  }, 201)
}

async function doManage(body: Record<string, unknown>): Promise<Response> {
  const token = String(body.token ?? '')
  if (!token) return fail('token_needed')
  const { data } = await sb.from('bookings')
    .select('id, plan_id, user_id, start_at, end_at, invitee_name, invitee_email, invitee_note, status, gcal_event_id, gcal_calendar_id, manage_token')
    .eq('manage_token', token).maybeSingle()
  const row = data as BookingRow | null
  if (!row) return fail('no_such_booking', 404)

  const { data: pdata } = await sb.from('meeting_plans').select(PLAN_COLS).eq('id', row.plan_id).maybeSingle()
  const plan = pdata as Plan | null
  if (!plan) return fail('no_such_plan', 404)
  const { data: prdata } = await sb.from('booking_profile')
    .select('user_id, handle, display_name, blurb, timezone, active').eq('user_id', row.user_id).maybeSingle()
  const prof = prdata as Profile | null
  if (!prof) return fail('no_such_page', 404)

  const what = String(body.what ?? 'look')

  if (what === 'look') {
    return json({
      status: row.status, start: row.start_at, end: row.end_at,
      title: plan.title, name: prof.display_name ?? prof.handle,
      timezone: prof.timezone, duration: plan.duration_minutes,
    })
  }

  if (what === 'cancel') {
    if (row.status === 'cancelled') return json({ status: 'cancelled' })
    // The event comes off the calendar first. If Google refuses, the booking
    // stays as it is: a row marked cancelled beside an event still sitting on
    // the owner's morning is the one state nobody can act on.
    const gone = await removeEvent(plan, row)
    if (!gone) return fail('calendar_refused', 502)
    await sb.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', row.id)
    return json({ status: 'cancelled' })
  }

  if (what === 'move') {
    const to = String(body.start ?? '')
    if (!Date.parse(to)) return fail('slot_needed')
    const got = await freeStarts(prof, plan)
    if (!got.ok) return json({ unreadable: true, why: got.why }, 503)
    const startIso = new Date(to).toISOString()
    if (!got.slots.includes(startIso)) return json({ error: 'slot_gone', slots: got.slots }, 409)
    const endIso = new Date(Date.parse(startIso) + plan.duration_minutes * 60000).toISOString()

    const { error } = await sb.from('bookings')
      .update({ start_at: startIso, end_at: endIso }).eq('id', row.id)
    if (error) {
      if ((error as { code?: string }).code === '23505') return json({ error: 'slot_gone', slots: got.slots }, 409)
      return fail('could_not_move', 500)
    }
    if (row.gcal_event_id && row.gcal_calendar_id) {
      const hub = hubFor(plan.user_id)
      const cals = await hub.calendars()
      const cal = cals.find(c => c.calendarId === row.gcal_calendar_id)
      const tok = cal ? await hub.token(cal.accountId) : null
      if (tok) {
        await fetch(
          `${CAL_API}/calendars/${encodeURIComponent(row.gcal_calendar_id)}/events/${encodeURIComponent(row.gcal_event_id)}?sendUpdates=all`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ start: { dateTime: startIso }, end: { dateTime: endIso } }),
          },
        )
      }
    }
    return json({ status: row.status, start: startIso, end: endIso })
  }

  return fail('unknown_action')
}

/** The owner, accepting or declining one that needed approval. The only action
 *  here that is about a signed-in person, so the only one that reads a JWT. */
async function doDecide(req: Request, body: Record<string, unknown>): Promise<Response> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return fail('sign_in_needed', 401)
  const { data: who } = await sb.auth.getUser(jwt)
  const userId = who?.user?.id
  if (!userId) return fail('sign_in_needed', 401)

  const { data } = await sb.from('bookings')
    .select('id, plan_id, user_id, start_at, end_at, invitee_name, invitee_email, invitee_note, status, gcal_event_id, gcal_calendar_id, manage_token')
    .eq('id', String(body.id ?? '')).eq('user_id', userId).maybeSingle()
  const row = data as BookingRow | null
  if (!row) return fail('no_such_booking', 404)
  if (row.status !== 'pending') return fail('not_pending', 409)

  const { data: pdata } = await sb.from('meeting_plans').select(PLAN_COLS).eq('id', row.plan_id).maybeSingle()
  const plan = pdata as Plan | null
  if (!plan) return fail('no_such_plan', 404)

  if (String(body.what) === 'accept') {
    const wrote = await writeEvent(plan, row)
    if (!wrote.ok) return fail(wrote.why, 502)
    await sb.from('bookings').update({ status: 'confirmed' }).eq('id', row.id)
    return json({ status: 'confirmed' })
  }
  await sb.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', row.id)
  return json({ status: 'cancelled' })
}

// ─── The door ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  let body: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try { body = await req.json() as Record<string, unknown> } catch { body = {} }
  }
  const action = String(url.searchParams.get('action') ?? body.action ?? '')

  try {
    switch (action) {
      case 'profile': return await doProfile(url.searchParams.get('handle') ?? String(body.handle ?? ''))
      case 'slots':   return await doSlots(url)
      case 'book':    return await doBook(req, body)
      case 'manage':  return await doManage(body)
      case 'decide':  return await doDecide(req, body)
      case '':        return json({ ok: true, service: 'book-me' })
      default:        return fail('unknown_action', 404)
    }
  } catch (e) {
    console.error('[book-me]', action, e)
    return fail('server_error', 500)
  }
})
