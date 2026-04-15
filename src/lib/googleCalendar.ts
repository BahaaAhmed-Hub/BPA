import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GCalEvent {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end:   { dateTime?: string; date?: string; timeZone?: string }
  location?: string
  description?: string
  attendees?: { email: string; displayName?: string; responseStatus?: string; self?: boolean }[]
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string; label?: string; pin?: string }[] }
  status?: string
  organizer?: { email?: string; displayName?: string; self?: boolean }
  recurringEventId?: string
  recurrence?: string[]
  htmlLink?: string
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] }
}

export interface GCalEventWithCalendar extends GCalEvent {
  calendarId: string
  calendarColor?: string
}

export interface GCalCalendar {
  id: string
  summary: string
  backgroundColor?: string
  foregroundColor?: string
  primary?: boolean
  accessRole?: string
}

export interface GCalEventCreate {
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email: string }[]
  conferenceData?: {
    createRequest: {
      requestId: string
      conferenceSolutionKey: { type: 'hangoutsMeet' }
    }
  }
}

export interface GCalError {
  code: number
  message: string
}

// ─── Token ───────────────────────────────────────────────────────────────────

const TOKEN_KEY      = 'google_provider_token'
const TOKEN_SAVED_AT = 'google_provider_token_saved_at'
const TOKEN_TTL_MS   = 55 * 60 * 1000  // 55 min — refresh before Google's 60-min expiry

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TOKEN_SAVED_AT, Date.now().toString())
}

function isTokenStale(): boolean {
  const savedAt = parseInt(localStorage.getItem(TOKEN_SAVED_AT) ?? '0', 10)
  if (!savedAt) return true
  return Date.now() - savedAt > TOKEN_TTL_MS
}

/** Refresh the primary Google access token via the google-oauth Edge Function. */
async function refreshPrimaryViaEdgeFn(accessToken: string, email: string): Promise<string | null> {
  try {
    const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL     as string ?? ''
    const SUPABASE_ANON    = import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? ''
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey':        SUPABASE_ANON,
      },
      body: JSON.stringify({ action: 'refresh', email }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token?: string; error?: string }
    if (data.access_token) {
      saveToken(data.access_token)
      return data.access_token
    }
    return null
  } catch { return null }
}


async function getProviderToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()

  // 1. Live session has a fresh provider token (right after OAuth) — cache and return
  if (data.session?.provider_token) {
    saveToken(data.session.provider_token)
    return data.session.provider_token
  }

  // No active session — user is signed out
  if (!data.session) return null

  // 2. Return cached token — Edge Function keeps it fresh via refreshPrimaryToken()
  return localStorage.getItem(TOKEN_KEY)
}

/**
 * Refreshes the primary account's Google access token.
 * 1. If the Supabase session contains a fresh provider_token (right after OAuth) — use it.
 * 2. If the cached token is still within 55-min TTL — use it.
 * 3. Otherwise call the google-oauth Edge Function which exchanges the stored
 *    Google refresh_token for a new access token and updates google_account_tokens.
 *    We intentionally do NOT dispatch 'cal:reconnect-required' for the primary account
 *    to avoid showing error badges on primary calendars.
 */
export async function refreshPrimaryToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return localStorage.getItem(TOKEN_KEY)

  // 1. Right after OAuth sign-in the session carries a fresh provider_token — cache it
  if (data.session.provider_token) {
    saveToken(data.session.provider_token)
    return data.session.provider_token
  }

  // 2. Cached token is still fresh — return it
  if (!isTokenStale()) return localStorage.getItem(TOKEN_KEY)

  // 3. Token is stale — refresh via Edge Function (uses stored Google refresh_token)
  const email = data.session.user?.email
  if (email) {
    const fresh = await refreshPrimaryViaEdgeFn(data.session.access_token, email)
    if (fresh) return fresh
  }

  // 4. Edge Function failed — try supabase.auth.refreshSession() as last resort.
  //    GoTrue's token refresh response includes provider_token when the original
  //    session was created via Google OAuth.
  try {
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (refreshed.session?.provider_token) {
      saveToken(refreshed.session.provider_token)
      return refreshed.session.provider_token
    }
  } catch { /* ignore */ }

  // Fall back to cached token (possibly stale, but better than null)
  return localStorage.getItem(TOKEN_KEY)
}

// ─── Core API helper ──────────────────────────────────────────────────────────

const BASE = 'https://www.googleapis.com/calendar/v3'

async function gcalRequest(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers as Record<string, string> | undefined ?? {}),
    },
  })
}

/** Resolve a valid token, call fn(token), retry once on 401 with refreshed token. */
async function withAuth(
  fn: (token: string) => Promise<Response>,
): Promise<{ res: Response; noAuth: false } | { res: null; noAuth: true }> {
  const token = await getProviderToken()
  if (!token) return { res: null, noAuth: true }

  let res = await fn(token)

  if (res.status === 401) {
    // Token expired — force stale so refreshPrimaryToken() calls the Edge Function
    localStorage.removeItem(TOKEN_SAVED_AT)
    const fresh = await refreshPrimaryToken()
    if (fresh && fresh !== token) {
      res = await fn(fresh)
    }
  }

  if (res.status === 401) return { res: null, noAuth: true }
  return { res, noAuth: false }
}

// ─── List calendars ───────────────────────────────────────────────────────────

const CAL_CACHE_KEY = 'cal-list-cache'

export function getCalendarCache(): GCalCalendar[] {
  try {
    const raw = localStorage.getItem(CAL_CACHE_KEY)
    return raw ? (JSON.parse(raw) as GCalCalendar[]) : []
  } catch { return [] }
}

function saveCalendarCache(cals: GCalCalendar[]) {
  try { localStorage.setItem(CAL_CACHE_KEY, JSON.stringify(cals)) } catch { /* quota */ }
}

export async function listCalendars(): Promise<{ calendars: GCalCalendar[]; noAuth: boolean }> {
  const result = await withAuth(token =>
    gcalRequest(token, '/users/me/calendarList')
  )
  if (result.noAuth) return { calendars: [], noAuth: true }

  const { res } = result
  if (!res.ok) return { calendars: [], noAuth: false }

  const data = (await res.json()) as { items?: GCalCalendar[] }
  const calendars = data.items ?? []   // include ALL calendars (freeBusyReader etc. for Gmail events)
  saveCalendarCache(calendars)
  return { calendars, noAuth: false }
}

/** List calendars using a specific token (for multi-account). Logs errors for debugging. */
export async function listCalendarsWithToken(
  token: string,
): Promise<{ calendars: GCalCalendar[]; authFailed: boolean }> {
  try {
    const res = await gcalRequest(token, '/users/me/calendarList')
    if (res.status === 401 || res.status === 403) {
      console.warn(`[CalIntel] listCalendarsWithToken auth error HTTP ${res.status} — token expired`)
      return { calendars: [], authFailed: true }
    }
    if (!res.ok) {
      console.warn(`[CalIntel] listCalendarsWithToken HTTP ${res.status}`)
      return { calendars: [], authFailed: false }
    }
    const data = (await res.json()) as { items?: GCalCalendar[] }
    const calendars = data.items ?? []   // include ALL calendars
    return { calendars, authFailed: false }
  } catch (err) {
    console.warn('[CalIntel] listCalendarsWithToken error:', err)
    return { calendars: [], authFailed: false }
  }
}

/** Fetch events from a calendar using a specific token (for multi-account). */
export async function fetchCalendarEventsWithToken(
  token: string,
  calendarId: string,
  weekStart: Date,
  weekEnd: Date,
  calendarColor?: string,
): Promise<GCalEvent[]> {
  try {
    const params = new URLSearchParams({
      timeMin:      weekStart.toISOString(),
      timeMax:      weekEnd.toISOString(),
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '250',
    })
    const res = await gcalRequest(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
    if (!res.ok) return []
    const data = (await res.json()) as { items?: GCalEvent[] }
    return (data.items ?? [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({ ...e, calendarId, calendarColor }))
  } catch { return [] }
}

// ─── Fetch events from one calendar ──────────────────────────────────────────

export async function fetchCalendarEvents(
  calendarId: string,
  weekStart: Date,
  weekEnd: Date,
  calendarColor?: string,
): Promise<GCalEventWithCalendar[]> {
  const params = new URLSearchParams({
    timeMin:      weekStart.toISOString(),
    timeMax:      weekEnd.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '250',
  })

  const result = await withAuth(token =>
    gcalRequest(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
  )
  if (result.noAuth) return []
  const { res } = result
  if (!res.ok) return []

  const data = (await res.json()) as { items?: GCalEvent[] }
  return (data.items ?? [])
    .filter(e => e.status !== 'cancelled')
    .map(e => ({ ...e, calendarId, calendarColor }))
}

// ─── Fetch events from multiple calendars ────────────────────────────────────

export async function fetchAllCalendarsEvents(
  calendars: GCalCalendar[],
  weekStart: Date,
  weekEnd: Date,
): Promise<{ events: GCalEventWithCalendar[]; noAuth: boolean }> {
  if (!calendars.length) return { events: [], noAuth: false }

  // Check auth first
  const token = await getProviderToken()
  if (!token) return { events: [], noAuth: true }

  try {
    const allResults = await Promise.all(
      calendars.map(cal =>
        fetchCalendarEvents(cal.id, weekStart, weekEnd, cal.backgroundColor)
      )
    )
    const events = allResults.flat()
    return { events, noAuth: false }
  } catch {
    return { events: [], noAuth: true }
  }
}

// ─── Fetch events for a specific day ─────────────────────────────────────────

export async function fetchDayEvents(
  calendarId: string,
  dateStr: string, // YYYY-MM-DD
): Promise<GCalEventWithCalendar[]> {
  const dayStart = new Date(dateStr + 'T00:00:00')
  const dayEnd   = new Date(dateStr + 'T23:59:59')
  return fetchCalendarEvents(calendarId, dayStart, dayEnd)
}

// ─── Create event ─────────────────────────────────────────────────────────────

export async function createCalendarEvent(
  calendarId: string,
  event: GCalEventCreate,
): Promise<{ event: GCalEvent | null; noAuth: boolean; error?: string }> {
  const result = await withAuth(token =>
    gcalRequest(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  )
  if (result.noAuth) return { event: null, noAuth: true }
  const { res } = result
  if (!res.ok) {
    const text = await res.text()
    return { event: null, noAuth: false, error: `${res.status}: ${text}` }
  }
  const created = (await res.json()) as GCalEvent
  return { event: created, noAuth: false }
}

// ─── Update event ─────────────────────────────────────────────────────────────

export async function updateCalendarEvent(
  calendarId: string,
  eventId: string,
  event: Partial<GCalEventCreate>,
): Promise<{ event: GCalEvent | null; noAuth: boolean; error?: string }> {
  const result = await withAuth(token =>
    gcalRequest(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify(event),
    })
  )
  if (result.noAuth) return { event: null, noAuth: true }
  const { res } = result
  if (!res.ok) {
    const text = await res.text()
    return { event: null, noAuth: false, error: `${res.status}: ${text}` }
  }
  const updated = (await res.json()) as GCalEvent
  return { event: updated, noAuth: false }
}

/** Create an event using a specific token (for multi-account). */
export async function createCalendarEventWithToken(
  token: string,
  calendarId: string,
  event: GCalEventCreate,
): Promise<{ event: GCalEvent | null; error?: string }> {
  try {
    // conferenceDataVersion=1 is required for Google Meet link generation
    const qs  = event.conferenceData ? '?conferenceDataVersion=1' : ''
    const res = await gcalRequest(token, `/calendars/${encodeURIComponent(calendarId)}/events${qs}`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
    if (!res.ok) { const t = await res.text(); return { event: null, error: `${res.status}: ${t}` } }
    return { event: (await res.json()) as GCalEvent }
  } catch (e) { return { event: null, error: String(e) } }
}

/** Patch an existing event to add a Google Meet link. */
export async function addMeetingToEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<GCalEvent | null> {
  try {
    const res = await gcalRequest(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          conferenceData: {
            createRequest: {
              requestId: `bpa-meet-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }),
      },
    )
    if (!res.ok) return null
    return (await res.json()) as GCalEvent
  } catch { return null }
}

// ─── Reschedule event to a new date (same time) ──────────────────────────────

/** Move an event to a different calendar day, preserving start time and duration.
 *  Uses a specific token (for multi-account support). */
export async function updateCalendarEventDate(
  token: string,
  calendarId: string,
  eventId: string,
  newDateStr: string,   // YYYY-MM-DD
  originalEvent: GCalEvent,
): Promise<boolean> {
  try {
    const isAllDay = !originalEvent.start.dateTime
    let body: Record<string, unknown>

    if (isAllDay) {
      body = {
        start: { date: newDateStr },
        end:   { date: newDateStr },
      }
    } else {
      const origStart = new Date(originalEvent.start.dateTime!)
      const origEnd   = new Date(originalEvent.end.dateTime!)
      const duration  = origEnd.getTime() - origStart.getTime()
      const [y, m, d] = newDateStr.split('-').map(Number)
      const newStart  = new Date(origStart)
      newStart.setFullYear(y, m - 1, d)
      const newEnd = new Date(newStart.getTime() + duration)
      body = {
        start: { dateTime: newStart.toISOString(), timeZone: originalEvent.start.timeZone ?? 'UTC' },
        end:   { dateTime: newEnd.toISOString(),   timeZone: originalEvent.end.timeZone ?? 'UTC' },
      }
    }

    const res = await gcalRequest(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    )
    return res.ok
  } catch {
    return false
  }
}

/** Move an event to an arbitrary start+end datetime (for DnD move and resize).
 *  Uses a specific token (for multi-account support). */
export async function updateCalendarEventTimes(
  token: string,
  calendarId: string,
  eventId: string,
  newStart: Date,
  newEnd: Date,
  timeZone = 'UTC',
): Promise<boolean> {
  try {
    const body = {
      start: { dateTime: newStart.toISOString(), timeZone },
      end:   { dateTime: newEnd.toISOString(),   timeZone },
    }
    const res = await gcalRequest(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    )
    return res.ok
  } catch {
    return false
  }
}

// ─── Delete event ─────────────────────────────────────────────────────────────

export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string,
): Promise<{ success: boolean; noAuth: boolean; error?: string }> {
  const result = await withAuth(token =>
    gcalRequest(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    })
  )
  if (result.noAuth) return { success: false, noAuth: true }
  const { res } = result
  if (res.status === 204 || res.ok) return { success: true, noAuth: false }
  const text = await res.text()
  return { success: false, noAuth: false, error: `${res.status}: ${text}` }
}

/** Delete an event using a specific token (for multi-account). */
export async function deleteCalendarEventWithToken(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  try {
    const res = await gcalRequest(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
    return res.status === 204 || res.ok
  } catch { return false }
}

// ─── Legacy: fetch primary calendar (kept for backward compat) ────────────────

export async function fetchWeekEvents(
  weekStart: Date,
  weekEnd: Date,
): Promise<{ events: GCalEventWithCalendar[]; noAuth: boolean }> {
  return fetchAllCalendarsEvents(
    [{ id: 'primary', summary: 'Primary' }],
    weekStart,
    weekEnd,
  )
}

// ─── Meeting type detection ───────────────────────────────────────────────────

export function detectMeetingType(event: GCalEvent): string {
  const loc = (event.location ?? '').toLowerCase()
  const hasVideo = !!event.conferenceData?.entryPoints?.length
  if (hasVideo) return 'video'
  if (loc && !loc.includes('zoom') && !loc.includes('meet') && !loc.includes('teams')) {
    return 'physical'
  }
  const desc = (event.description ?? '').toLowerCase()
  if (desc.includes('1:1') || (event.summary ?? '').toLowerCase().includes('1:1')) return 'one_on_one'
  return 'internal'
}

// ─── Edge-function-backed write operations ────────────────────────────────────
// These call the google-calendar-write edge function so tokens never reach the
// browser. Use accountId (from google_accounts.id) instead of a raw token.

/**
 * Create an event via the google-calendar-write edge function.
 */
export async function efCreateEvent(
  accountId: string,
  calendarId: string,
  event: GCalEventCreate,
): Promise<{ event: GCalEvent | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke('google-calendar-write', {
    body: { action: 'create_event', account_id: accountId, calendar_id: calendarId, event },
  })
  if (error) return { event: null, error: error.message }
  if (data?.error === 'reconnect_required') {
    window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { accountId } }))
    return { event: null, error: 'reconnect_required' }
  }
  return { event: data?.event ?? null, error: data?.error }
}

/**
 * Patch an event via the google-calendar-write edge function.
 */
export async function efUpdateEvent(
  accountId: string,
  calendarId: string,
  eventId: string,
  patch: Partial<GCalEventCreate>,
): Promise<{ event: GCalEvent | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke('google-calendar-write', {
    body: { action: 'update_event', account_id: accountId, calendar_id: calendarId, event_id: eventId, patch },
  })
  if (error) return { event: null, error: error.message }
  if (data?.error === 'reconnect_required') {
    window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { accountId } }))
    return { event: null, error: 'reconnect_required' }
  }
  return { event: data?.event ?? null, error: data?.error }
}

/**
 * Delete an event via the google-calendar-write edge function.
 */
export async function efDeleteEvent(
  accountId: string,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('google-calendar-write', {
    body: { action: 'delete_event', account_id: accountId, calendar_id: calendarId, event_id: eventId },
  })
  if (error) { console.warn('[efDeleteEvent]', error); return false }
  if (data?.error === 'reconnect_required') {
    window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { accountId } }))
    return false
  }
  return !!data?.deleted
}

/**
 * Add a Google Meet link to an event via the google-calendar-write edge function.
 */
export async function efAddMeet(
  accountId: string,
  calendarId: string,
  eventId: string,
): Promise<GCalEvent | null> {
  const { data, error } = await supabase.functions.invoke('google-calendar-write', {
    body: { action: 'add_meet', account_id: accountId, calendar_id: calendarId, event_id: eventId },
  })
  if (error) { console.warn('[efAddMeet]', error); return null }
  if (data?.error === 'reconnect_required') {
    window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { accountId } }))
    return null
  }
  return data?.event ?? null
}

// ─── Supabase sync ────────────────────────────────────────────────────────────

export async function syncEventsToSupabase(
  events: GCalEvent[],
  userId: string,
): Promise<void> {
  if (!events.length) return

  const rows = events.map(e => ({
    user_id:         userId,
    google_event_id: e.id,
    title:           e.summary ?? '(No title)',
    start_time:      e.start.dateTime ?? e.start.date ?? '',
    end_time:        e.end.dateTime   ?? e.end.date   ?? '',
    location:        e.location ?? null,
    meeting_type:    detectMeetingType(e),
    is_synced:       true,
  }))

  await supabase
    .from('calendar_events')
    .upsert(rows, { onConflict: 'google_event_id', ignoreDuplicates: false })
}
