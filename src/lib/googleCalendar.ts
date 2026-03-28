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
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] }
  status?: string
  organizer?: { email?: string; displayName?: string }
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
}

export interface GCalError {
  code: number
  message: string
}

// ─── Token ───────────────────────────────────────────────────────────────────

const TOKEN_KEY      = 'google_provider_token'
const TOKEN_SAVED_AT = 'google_provider_token_saved_at'
const TOKEN_TTL_MS   = 50 * 60 * 1000  // refresh after 50 min (token expires at 60 min)

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TOKEN_SAVED_AT, Date.now().toString())
}

function isTokenStale(): boolean {
  const savedAt = parseInt(localStorage.getItem(TOKEN_SAVED_AT) ?? '0', 10)
  return Date.now() - savedAt > TOKEN_TTL_MS
}

async function getProviderToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()

  // Fresh token from live session — use it
  if (data.session?.provider_token) {
    saveToken(data.session.provider_token)
    return data.session.provider_token
  }

  // Token in localStorage but stale — try refreshing first
  const cached = localStorage.getItem(TOKEN_KEY)
  if (!cached || isTokenStale()) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed.session?.provider_token) {
        saveToken(refreshed.session.provider_token)
        return refreshed.session.provider_token
      }
    } catch { /* ignore */ }
  }

  return cached
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
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_SAVED_AT)
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      const fresh = refreshed.session?.provider_token
      if (fresh) {
        saveToken(fresh)
        res = await fn(fresh)
      }
    } catch { /* ignore */ }
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
  const calendars = (data.items ?? []).filter(c =>
    c.accessRole === 'owner' || c.accessRole === 'writer' || c.accessRole === 'reader'
  )
  saveCalendarCache(calendars)
  return { calendars, noAuth: false }
}

/** List calendars using a specific token (for multi-account). */
export async function listCalendarsWithToken(
  token: string,
): Promise<GCalCalendar[]> {
  try {
    const res = await gcalRequest(token, '/users/me/calendarList')
    if (!res.ok) return []
    const data = (await res.json()) as { items?: GCalCalendar[] }
    return (data.items ?? []).filter(c =>
      c.accessRole === 'owner' || c.accessRole === 'writer' || c.accessRole === 'reader'
    )
  } catch { return [] }
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
