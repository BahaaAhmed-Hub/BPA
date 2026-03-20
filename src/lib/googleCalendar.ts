import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GCalEvent {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end:   { dateTime?: string; date?: string; timeZone?: string }
  location?: string
  description?: string
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] }
  status?: string
}

export interface GCalError {
  code: number
  message: string
}

// ─── Token ───────────────────────────────────────────────────────────────────

async function getProviderToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.provider_token ?? null
}

// ─── API call ────────────────────────────────────────────────────────────────

export async function fetchWeekEvents(
  weekStart: Date,
  weekEnd: Date,
): Promise<{ events: GCalEvent[]; noAuth: boolean }> {
  const token = await getProviderToken()
  if (!token) return { events: [], noAuth: true }

  const params = new URLSearchParams({
    timeMin:       weekStart.toISOString(),
    timeMax:       weekEnd.toISOString(),
    singleEvents:  'true',
    orderBy:       'startTime',
    maxResults:    '100',
  })

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (res.status === 401) return { events: [], noAuth: true }
  if (!res.ok) throw new Error(`Google Calendar API ${res.status}: ${await res.text()}`)

  const data = (await res.json()) as { items?: GCalEvent[] }
  const events = (data.items ?? []).filter(e => e.status !== 'cancelled')
  return { events, noAuth: false }
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
