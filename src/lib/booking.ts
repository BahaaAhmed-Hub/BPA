// ─── Booking, from the browser's side ───────────────────────────────────────
//
// Everything public goes through the `book-me` edge function. That is not a
// convenience: the booking tables have no policy for anybody but their owner,
// so the anon key in this bundle cannot read a plan, a window or a booking,
// and the function with the service role is the whole of the public surface.
//
// So a stranger's page never touches Postgres, and nothing here imports a
// store. The owner's own screens read and write their rows directly, under
// RLS, like every other module.

import { supabase, supabaseUrl } from '@/lib/supabase'

const FN = `${supabaseUrl}/functions/v1/book-me`

// ─── The URL a stranger arrives on ──────────────────────────────────────────
//
// There is no router in this app and GitHub Pages has no SPA fallback, so a
// query string is the only deep link that survives a hard load: `/BPA/book/x`
// would 404 before any JavaScript ran.

export interface BookingRequest { handle: string; plan?: string; manage?: string }

/** What this URL is asking for, or null for the app itself. */
export function bookingRequest(search = window.location.search): BookingRequest | null {
  const q = new URLSearchParams(search)
  const handle = (q.get('book') ?? '').trim().toLowerCase()
  const manage = (q.get('manage') ?? '').trim()
  if (manage) return { handle, manage }
  if (!handle || !/^[a-z0-9][a-z0-9-]{1,38}$/.test(handle)) return null
  const plan = (q.get('plan') ?? '').trim()
  return { handle, ...(plan ? { plan } : {}) }
}

/** The link to send somebody. Built from where this build is actually served,
 *  never a hardcoded host — the app runs under /BPA/ on Pages and at / in dev. */
export function bookingUrl(handle: string, plan?: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`
  return `${base}?book=${encodeURIComponent(handle)}${plan ? `&plan=${encodeURIComponent(plan)}` : ''}`
}

export function manageUrl(token: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`
  return `${base}?manage=${encodeURIComponent(token)}`
}

// ─── What the function says ─────────────────────────────────────────────────

export interface PublicPlan {
  slug: string
  title: string
  blurb: string | null
  duration_minutes: number
  location_mode: 'meet' | 'place' | 'phone' | 'none'
  requires_approval: boolean
}

export interface PublicProfile {
  handle: string
  name: string
  blurb: string | null
  timezone: string
  plans: PublicPlan[]
}

export interface SlotAnswer {
  slots: string[]
  from: string
  to: string
  timezone: string
  duration: number
  title: string
  blurb: string | null
  location_mode: PublicPlan['location_mode']
  requires_approval: boolean
}

/** A failed read is its own answer. **An empty list and "we could not look"
 *  are different facts**, and showing the second as the first tells a stranger
 *  you have no time for a month when the truth is that a token expired. */
export type Asked<T> = { ok: true; value: T } | { ok: false; unreadable: boolean; why: string }

async function ask<T>(url: string, init?: RequestInit): Promise<Asked<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    if (body.unreadable) return { ok: false, unreadable: true, why: String(body.why ?? 'unreadable') }
    if (!res.ok) return { ok: false, unreadable: false, why: String(body.error ?? `http_${res.status}`) }
    return { ok: true, value: body as T }
  } catch {
    return { ok: false, unreadable: false, why: 'offline' }
  }
}

export function loadPublicProfile(handle: string): Promise<Asked<PublicProfile>> {
  return ask<PublicProfile>(`${FN}?action=profile&handle=${encodeURIComponent(handle)}`)
}

export function loadSlots(handle: string, plan: string, from?: string, to?: string): Promise<Asked<SlotAnswer>> {
  const q = new URLSearchParams({ action: 'slots', handle, plan })
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  return ask<SlotAnswer>(`${FN}?${q}`)
}

export interface BookResult {
  status: 'confirmed' | 'pending'
  start: string
  end: string
  manage_token: string
  name: string
  title: string
  location_mode: PublicPlan['location_mode']
}

/** The one call that writes. A 409 carries the fresh list, because "that one
 *  has just gone" is only useful beside what is still there. */
export async function book(args: {
  handle: string; plan: string; start: string
  name: string; email: string; note?: string
}): Promise<Asked<BookResult> & { slots?: string[] }> {
  try {
    const res = await fetch(`${FN}?action=book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    if (res.ok) return { ok: true, value: body as unknown as BookResult }
    if (body.unreadable) return { ok: false, unreadable: true, why: String(body.why ?? 'unreadable') }
    return {
      ok: false, unreadable: false, why: String(body.error ?? `http_${res.status}`),
      ...(Array.isArray(body.slots) ? { slots: body.slots as string[] } : {}),
    }
  } catch {
    return { ok: false, unreadable: false, why: 'offline' }
  }
}

export interface ManageView {
  status: 'confirmed' | 'pending' | 'cancelled'
  start: string; end: string; title: string; name: string
  timezone: string; duration: number
}

export function lookUpBooking(token: string): Promise<Asked<ManageView>> {
  return ask<ManageView>(`${FN}?action=manage`, {
    method: 'POST', body: JSON.stringify({ token, what: 'look' }),
  })
}

export function cancelBooking(token: string): Promise<Asked<{ status: string }>> {
  return ask<{ status: string }>(`${FN}?action=manage`, {
    method: 'POST', body: JSON.stringify({ token, what: 'cancel' }),
  })
}

export function moveBooking(token: string, start: string): Promise<Asked<{ status: string; start: string }>> {
  return ask<{ status: string; start: string }>(`${FN}?action=manage`, {
    method: 'POST', body: JSON.stringify({ token, what: 'move', start }),
  })
}

/** The owner accepting or declining one that needed approval — the only call
 *  here that is about a signed-in person, so the only one that sends a JWT. */
export async function decideBooking(id: string, what: 'accept' | 'decline'): Promise<Asked<{ status: string }>> {
  const { data } = await supabase.auth.getSession()
  const jwt = data.session?.access_token
  if (!jwt) return { ok: false, unreadable: false, why: 'sign_in_needed' }
  return ask<{ status: string }>(`${FN}?action=decide`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ id, what }),
  })
}

// ─── The owner's own rows, under RLS ────────────────────────────────────────

export interface BookingProfileRow {
  user_id: string; handle: string; display_name: string | null
  blurb: string | null; timezone: string; active: boolean
}

export interface WindowRow {
  id: string
  on_date: string
  start_min: number
  end_min: number
  repeat: { kind: 'none' | 'weekly'; interval?: number; until?: string | null }
  skips: string[]
  label: string | null
}

export interface PlanRow {
  id: string; user_id: string; slug: string; title: string; blurb: string | null
  duration_minutes: number; slot_step_minutes: number
  buffer_before: number; buffer_after: number
  min_notice_minutes: number; horizon_days: number
  max_per_day: number | null
  narrow: { days?: number[]; from?: number; to?: number } | null
  target_calendar_id: string | null; target_account_id: string | null
  busy_calendar_ids: string[]
  location_mode: PublicPlan['location_mode']; location_text: string | null
  requires_approval: boolean; active: boolean; sort_order: number
}

export interface BookingRow {
  id: string; plan_id: string
  start_at: string; end_at: string
  invitee_name: string; invitee_email: string; invitee_note: string | null
  invitee_timezone: string | null
  status: 'confirmed' | 'pending' | 'cancelled'
  gcal_event_id: string | null
  manage_token: string
}

/** `null` is "could not look", `[]` is "nothing there" — the two lead to
 *  opposite decisions, so they are never collapsed. `googleScopes.ts`' rule. */
export async function loadBookingProfile(): Promise<BookingProfileRow | null> {
  const { data, error } = await supabase.from('booking_profile')
    .select('user_id, handle, display_name, blurb, timezone, active').maybeSingle()
  if (error) return null
  return (data as BookingProfileRow | null) ?? null
}

export async function saveBookingProfile(row: Partial<BookingProfileRow> & { user_id: string }): Promise<string | null> {
  const { error } = await supabase.from('booking_profile').upsert(row, { onConflict: 'user_id' })
  if (!error) return null
  // A handle is one person's, and the only error worth spelling out.
  return /duplicate key|unique/i.test(error.message) ? 'That handle is taken' : error.message
}

export async function loadWindows(): Promise<WindowRow[] | null> {
  const { data, error } = await supabase.from('booking_windows')
    .select('id, on_date, start_min, end_min, repeat, skips, label')
    .order('on_date', { ascending: true })
  if (error) return null
  return (data ?? []) as WindowRow[]
}

export async function addWindow(w: Omit<WindowRow, 'id'> & { user_id: string }): Promise<WindowRow | null> {
  const { data, error } = await supabase.from('booking_windows').insert(w)
    .select('id, on_date, start_min, end_min, repeat, skips, label').maybeSingle()
  return error ? null : (data as WindowRow)
}

export async function updateWindow(id: string, patch: Partial<WindowRow>): Promise<boolean> {
  const { error } = await supabase.from('booking_windows').update(patch).eq('id', id)
  return !error
}

export async function deleteWindow(id: string): Promise<boolean> {
  const { error } = await supabase.from('booking_windows').delete().eq('id', id)
  return !error
}

export async function loadPlans(): Promise<PlanRow[] | null> {
  const { data, error } = await supabase.from('meeting_plans')
    .select('*').order('sort_order', { ascending: true })
  if (error) return null
  return (data ?? []) as PlanRow[]
}

export async function savePlan(row: Partial<PlanRow> & { user_id: string }): Promise<string | null> {
  const { error } = row.id
    ? await supabase.from('meeting_plans').update(row).eq('id', row.id)
    : await supabase.from('meeting_plans').insert(row)
  if (!error) return null
  return /duplicate key|unique/i.test(error.message) ? 'That link name is already used' : error.message
}

export async function deletePlan(id: string): Promise<boolean> {
  const { error } = await supabase.from('meeting_plans').delete().eq('id', id)
  return !error
}

/** What is booked from now on. Cancelled rows are kept in the table and left
 *  out here: the owner's question is "what is coming", not "what ever was". */
export async function loadBookings(): Promise<BookingRow[] | null> {
  const { data, error } = await supabase.from('bookings')
    .select('id, plan_id, start_at, end_at, invitee_name, invitee_email, invitee_note, invitee_timezone, status, gcal_event_id, manage_token')
    .neq('status', 'cancelled')
    .gte('start_at', new Date(Date.now() - 86400000).toISOString())
    .order('start_at', { ascending: true })
  if (error) return null
  return (data ?? []) as BookingRow[]
}

/** A handle out of a name: lower case, no spaces, nothing that needs escaping
 *  in a URL. Offered as a starting point, never forced on anybody. */
export function suggestHandle(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return base.length >= 2 ? base : `me-${Math.random().toString(36).slice(2, 6)}`
}

export function slugify(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return base.length >= 1 ? base : 'call'
}

// ─── Which hours are open on a given day ────────────────────────────────────
//
// The grid draws the week, so it has to expand a repeat too. This is the same
// rule as `windowDates` in `supabase/functions/_shared/slots.ts` — it exists
// twice because Deno cannot import this bundle and Vite should not reach into
// a function's folder, the same split the mail rules have — and
// `scripts/booking-slots.mjs` runs both over the same windows and fails on any
// disagreement. The server's answer is the one that decides a booking; this
// one only decides what you see.

const DAY_MS = 86400000

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** Whether a window falls on `date` (YYYY-MM-DD). */
export function windowFallsOn(w: Pick<WindowRow, 'on_date' | 'repeat' | 'skips'>, date: string): boolean {
  if ((w.skips ?? []).includes(date)) return false
  const first = dayNumber(w.on_date)
  const here = dayNumber(date)
  if (here < first) return false
  if ((w.repeat?.kind ?? 'none') !== 'weekly') return here === first
  const everyDays = Math.max(1, w.repeat?.interval ?? 1) * 7
  if ((here - first) % everyDays !== 0) return false
  if (w.repeat?.until && here > dayNumber(w.repeat.until)) return false
  return true
}

/** The open hours on one day, earliest first. */
export function windowsOnDate(windows: WindowRow[], date: string): WindowRow[] {
  return windows.filter(w => windowFallsOn(w, date)).sort((a, b) => a.start_min - b.start_min)
}

/** "09:00" from minutes past midnight. */
export function hhmmOf(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Minutes past midnight from "09:00", or null if it is not a time. */
export function minOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const mins = Number(m[1]) * 60 + Number(m[2])
  return mins >= 0 && mins <= 1440 ? mins : null
}
