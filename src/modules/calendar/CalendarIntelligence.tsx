import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { CAL_COLORS } from '@/lib/palettes'
import { Button, Segmented } from '@/components/ui'
import {
  ChevronLeft, ChevronRight, ChevronDown, Layers, Calendar, Video,
  Sparkles, MapPin, RefreshCw, Eye, EyeOff,
  CheckCircle2, XCircle, Link, Check, ExternalLink, AlertCircle, Shield, Copy, Trash2, CheckSquare, Plus,
} from 'lucide-react'
import { formatTime } from '@/modules/tasks/SchedulePopover'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  detectMeetingType,
  listCalendars,
  listCalendarsWithToken,
  fetchCalendarEventsWithToken,
  updateCalendarEventTimes,
  updateCalendarEvent,
  refreshPrimaryToken,
  createCalendarEventWithToken,
  deleteCalendarEventWithToken,
  addMeetingToEvent,
  removeMeetingFromEvent,
  efUpdateEvent,
  moveCalendarEventWithToken,
  efMoveEvent,
  efCreateEvent,
  efDeleteEvent,
  lookUpEvent,
  efLookUpEvent,
} from '@/lib/googleCalendar'
import type { GCalEvent, GCalCalendar, GCalEventCreate } from '@/lib/googleCalendar'
import { getGoogleToken, seedToken, getGoogleTokenViaSupabaseRefresh } from '@/lib/tokenManager'
import { loadEventStatuses, saveEventStatuses } from '@/lib/eventStatus'
import { isCalendarHiddenByCompany } from '@/lib/companyVisibility'
import { isTaskEvent, stripTaskMark } from '@/lib/taskEvent'
import { loadWeather, weatherGlyph, type WeatherByHour } from '@/lib/weather'
import { T, SANS, DISPLAY, ICON, STROKE } from '@/lib/type'
import { generateMeetingPrep } from '@/lib/professor'
import type { MeetingPrep } from '@/lib/professor'
import { useAuthStore } from '@/store/authStore'
import { NewEventPanel, type ExistingEvent } from './NewEventPanel'
import { pushUndo, notify, inTextField } from '@/lib/undo'
import { loadWeekStart, useWeekStart, rotateDays, type Weekday } from '@/lib/weekStart'
import { syncTaskToEvent } from '@/lib/taskEventLink'
import { parseRecurrence } from './recurrence'
import { useUIStore } from '@/store/uiStore'
import { loadAccounts, loadHiddenAccounts } from '@/lib/multiAccount'
import { connectAdditionalGoogleAccount } from '@/lib/google'
import type { DbUser, DbCompany, DbCalendarEvent } from '@/types/database'
import {
  loadBlockingRules, applyBlockingRules, cleanupStaleBlocks,
  loadApplied, saveApplied, type AppliedBlocksMap, type SourceEvent,
} from '@/lib/blockingRules'
import { alpha } from '@/lib/alpha'

// ─── Grid constants ───────────────────────────────────────────────────────────
const HOUR_PX  = 54     // pixels per hour (Sunlit Bento: 54px/hr)
const SNAP_MIN = 15     // snap to 15-minute increments
const GRID_H   = HOUR_PX * 24  // total grid height (24h)

// ─── Types ────────────────────────────────────────────────────────────────────
type GCalEventExt = GCalEvent & { calendarId?: string; calendarColor?: string }
type EventStatus  = 'done' | 'cancelled'
type DragMode     = 'move' | 'resize-top' | 'resize-bottom'
interface EventLayout { left: number; width: number }
interface CreatingEvt  { dateStr: string; originMin: number; currentMin: number }
interface NewEventDraft { dateStr: string; startMin: number; endMin: number; anchorX: number; anchorY: number }
interface NewEventData {
  title:        string
  calId:        string
  startDate:    string
  startTime:    string     // HH:MM — empty string when allDay
  endDate:      string
  endTime:      string     // HH:MM — empty string when allDay
  allDay:       boolean
  location?:    string
  description?: string
  invitees:     { email: string; optional?: boolean }[]
  addMeet:      boolean
  /** RRULE lines — an event can repeat from the moment it is written. */
  recurrence?:  string[]
  visibility?:  'default' | 'private' | 'public'
  /** Marked done or cancelled from the composer, before it is even saved. */
  status?:      EventStatus
}

interface CalWithAccount extends GCalCalendar {
  accountEmail: string
  accountToken: string
  accountId?: string   // id of the ConnectedAccount for extra accounts (used for token refresh)
}
interface LoadCalendarsResult {
  calendars: CalWithAccount[]
  needsReconnect: string[]
}

// ─── Mock data for AI prep ────────────────────────────────────────────────────
const MOCK_COMPANIES: DbCompany[] = [
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: 'var(--sb-info)', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: 'var(--sb-info)', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: 'var(--sb-positive)', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: 'var(--sb-ink-4)', calendar_id: null, is_active: true },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Date/time helpers ────────────────────────────────────────────────────────
const CAL_ICON_BTN: React.CSSProperties = {
  width: 'var(--sb-h-nav)', height: 'var(--sb-h-nav)', boxSizing: 'border-box', borderRadius: 'var(--sb-r-nav)', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer', padding: 0,
}
const CAL_PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, height: 'var(--sb-h-nav)', boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', cursor: 'pointer',
}

/** Where an online meeting actually happens, as the host you would recognise:
 *  "meet.google.com", "teams.microsoft.com", "zoom.us". Google puts it in
 *  conferenceData when it knows about it, and otherwise it is a link someone
 *  pasted into the location or the description. */
const MEETING_HOSTS = /(meet\.google\.com|teams\.(?:microsoft|live)\.com|zoom\.us|whereby\.com|webex\.com|chime\.aws|meet\.jit\.si|gotomeeting\.com|bluejeans\.com|around\.co|discord\.(?:gg|com)|slack\.com)/i

function meetingHost(event: GCalEvent): string | null {
  const fromConference = event.conferenceData?.entryPoints
    ?.find(ep => ep.entryPointType === 'video')?.uri
  const candidates = [fromConference, event.location, event.description]
  for (const text of candidates) {
    if (!text) continue
    const url = /https?:\/\/[^\s<>"')]+/.exec(text)?.[0] ?? text
    try {
      const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
      if (MEETING_HOSTS.test(host)) return host
    } catch { /* not a URL */ }
    const bare = MEETING_HOSTS.exec(text)?.[0]
    if (bare) return bare.toLowerCase()
  }
  return null
}

/** What the "Where" of an event actually is, so the field can send you there.
 *  A pasted or generated link is something you open; anything else is a place
 *  you can be given directions to. */
export type WhereTarget =
  | { kind: 'link';  url: string; label: string }
  | { kind: 'place'; url: string; label: string }
  | { kind: 'empty' }



/** The week starts on whichever day Settings → Profile says — Sunday until
 *  somebody says otherwise. Every grid here goes through this one function, so
 *  the week strip, the month sheet and "is this this week?" cannot disagree. */
function getWeekStart(date: Date, first: Weekday = loadWeekStart()): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() - first + 7) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}
function getWeekEnd(start: Date): Date {
  const d = new Date(start)
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d
}
function isThisWeek(start: Date): boolean {
  return start.getTime() === getWeekStart(new Date()).getTime()
}
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtWeekRange(start: Date): string {
  const end  = getWeekEnd(start)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}
function getWeekNumber(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d.getTime() - jan1.getTime()) / 86400000)
  return Math.ceil((days + jan1.getDay() + 1) / 7)
}
function fmtShort(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours(), m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12  = h % 12 || 12
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2,'0')} ${ampm}`
}
function fmtHourLabel(h: number): string {
  if (h === 0)  return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h-12} PM`
}
function fmtPopupDate(startIso: string, endIso: string, isAllDay: boolean): string {
  const d = new Date(isAllDay ? startIso + 'T00:00:00' : startIso)
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  if (isAllDay) return date
  return `${date}  ·  ${fmtShort(startIso)} – ${fmtShort(endIso)}`
}
function groupByDay(events: GCalEvent[]): Map<string, GCalEventExt[]> {
  const map = new Map<string, GCalEventExt[]>()
  for (const e of events) {
    const key = localDateStr(new Date(e.start.dateTime ?? (e.start.date + 'T00:00:00')))
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e as GCalEventExt)
  }
  return map
}

// ─── AI prep helpers ──────────────────────────────────────────────────────────
function buildMockUser(user: { id: string; email: string; name?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo', email: user?.email ?? '',
    full_name: user?.name ?? 'User', avatar_url: null,
    active_framework: 'time_blocking',
    schedule_rules: { focus_hours: '09:00–12:00', buffer_minutes: 15, no_meeting_days: 'Wednesday', max_meetings_per_day: 4 },
    created_at: new Date().toISOString(),
  }
}
function gcalToDbEvent(e: GCalEvent): DbCalendarEvent {
  return {
    id: e.id, user_id: 'demo', company_id: null, google_event_id: e.id,
    title: e.summary ?? '(No title)',
    start_time: e.start.dateTime ?? e.start.date ?? '',
    end_time:   e.end.dateTime   ?? e.end.date   ?? '',
    location: e.location ?? null,
    meeting_type: detectMeetingType(e),
    prep_notes: e.description ?? null,
    is_synced: true,
  }
}

// ─── Persistence helpers ──────────────────────────────────────────────────────
function loadHiddenIntel(): Set<string> {
  try { const r = localStorage.getItem('cal-intel-hidden'); return r ? new Set(JSON.parse(r) as string[]) : new Set() } catch { return new Set() }
}
function saveHiddenIntel(s: Set<string>) { localStorage.setItem('cal-intel-hidden', JSON.stringify([...s])) }


function loadCalColors(): Record<string, string> {
  try { const r = localStorage.getItem('cal-intel-colors'); return r ? JSON.parse(r) as Record<string,string> : {} } catch { return {} }
}
function saveCalColors(s: Record<string, string>) { localStorage.setItem('cal-intel-colors', JSON.stringify(s)) }

// ─── Event cache (per week, multi-slot) ──────────────────────────────────────
// Each week gets its own localStorage key so navigating between weeks hits cache.
// Old single-slot key is cleaned up on first write.
const EVENTS_CACHE_PREFIX = 'cal-intel-events-cache:'
const EVENTS_CACHE_TTL    = 10 * 60 * 1000  // 10 min
const EVENTS_CACHE_MAX    = 8                // keep at most 8 weeks

interface EventsCacheEntry { weekKey: string; events: GCalEvent[]; savedAt: number }

function eventsWeekKey(weekStart: Date): string {
  return weekStart.toISOString().slice(0, 10)
}
function saveEventsCache(weekStart: Date, events: GCalEvent[]): void {
  try {
    const weekKey = eventsWeekKey(weekStart)
    localStorage.setItem(`${EVENTS_CACHE_PREFIX}${weekKey}`, JSON.stringify({
      weekKey, events, savedAt: Date.now(),
    } satisfies EventsCacheEntry))
    // Remove legacy single-slot key
    localStorage.removeItem('cal-intel-events-cache')
    // Evict oldest entries when over the cap
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith(EVENTS_CACHE_PREFIX))
    if (allKeys.length > EVENTS_CACHE_MAX) {
      allKeys.sort().slice(0, allKeys.length - EVENTS_CACHE_MAX).forEach(k => localStorage.removeItem(k))
    }
  } catch { /* quota */ }
}
function loadEventsCache(weekStart: Date): GCalEvent[] {
  try {
    const key = `${EVENTS_CACHE_PREFIX}${eventsWeekKey(weekStart)}`
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const entry = JSON.parse(raw) as EventsCacheEntry
    if (Date.now() - entry.savedAt > EVENTS_CACHE_TTL) { localStorage.removeItem(key); return [] }
    return entry.events
  } catch { return [] }
}

// ─── Calendar list cache ──────────────────────────────────────────────────────
const CAL_INTEL_CACHE_KEY = 'cal-intel-cals-cache'
interface CachedCal { id: string; summary: string; backgroundColor?: string; foregroundColor?: string; primary?: boolean; accessRole?: string; accountEmail: string }

function loadCalIntelCache(primaryEmail?: string): CachedCal[] {
  try {
    const r = localStorage.getItem(CAL_INTEL_CACHE_KEY)
    if (!r) return []
    const all = JSON.parse(r) as CachedCal[]
    // Self-heal: remove calendars for extra accounts that no longer exist.
    // This catches stale entries from before removeAccount cleaned the cache.
    const knownExtraEmails = new Set(loadAccounts().map(a => a.email))
    const cleaned = all.filter(c => {
      // Keep primary account calendars always
      if (primaryEmail && c.accountEmail === primaryEmail) return true
      // Keep extra account calendars only if account still exists
      if (knownExtraEmails.has(c.accountEmail)) return true
      // If accountEmail is not in loadAccounts() and not the primary,
      // it's an orphan from a deleted account — purge it.
      if (!primaryEmail) return true  // can't tell yet (initial load before auth)
      return false
    })
    // Persist the cleaned cache if we removed anything
    if (cleaned.length !== all.length) {
      try { localStorage.setItem(CAL_INTEL_CACHE_KEY, JSON.stringify(cleaned)) } catch { /* quota */ }
    }
    return cleaned
  } catch { return [] }
}
function saveCalIntelCache(cals: CalWithAccount[], primaryEmail?: string): void {
  try {
    const existing      = loadCalIntelCache()
    const updatedEmails = new Set(cals.map(c => c.accountEmail))
    // Build the set of all valid account emails so orphaned (deleted) accounts
    // are NOT preserved in the kept list — they get purged on every save.
    const validEmails   = new Set(loadAccounts().map(a => a.email))
    if (primaryEmail) validEmails.add(primaryEmail)
    const kept = existing.filter(c =>
      !updatedEmails.has(c.accountEmail) && validEmails.has(c.accountEmail)
    )
    const fresh: CachedCal[] = cals.map(c => ({ id: c.id, summary: c.summary ?? '', backgroundColor: c.backgroundColor, foregroundColor: c.foregroundColor, primary: c.primary, accessRole: c.accessRole, accountEmail: c.accountEmail }))
    localStorage.setItem(CAL_INTEL_CACHE_KEY, JSON.stringify([...fresh, ...kept]))
  } catch { /* quota */ }
}
function rebuildFromCache(cached: CachedCal[]): CalWithAccount[] {
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''
  const accounts     = loadAccounts()
  return cached.map(c => {
    // Only match non-primary accounts — primary cals must NOT get an accountId
    // or fetchAllEvents will route them through the Edge Function path instead of GoTrue.
    const acct  = accounts.find(a => a.email === c.accountEmail && !a.isPrimary)
    const token = acct ? acct.providerToken : primaryToken
    return { ...c, accountToken: token, accountId: acct?.id } as CalWithAccount
  })
}

// ─── Multi-account calendar loading ──────────────────────────────────────────
async function loadAllCalendars(
  primaryEmail: string,
  /** The cache as it stood before the caller cleared it. An account whose token
   *  has expired falls back to this, so it keeps its place in the list — and its
   *  reconnect badge — instead of disappearing with nothing to click. */
  calCache: CachedCal[] = loadCalIntelCache(),
): Promise<LoadCalendarsResult> {
  // Ensure primary Google token is as fresh as possible before any API calls
  await refreshPrimaryToken()

  const { calendars: primaryCals } = await listCalendars()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  // Fall back to cached primary calendars if API call failed (same as extra accounts)
  const effectivePrimaryCals: GCalCalendar[] = primaryCals.length > 0
    ? primaryCals
    : calCache.filter(c => c.accountEmail === primaryEmail) as unknown as GCalCalendar[]

  const primaryResult: CalWithAccount[] = effectivePrimaryCals.map(c => ({
    ...c, accountEmail: primaryEmail, accountToken: primaryToken,
  }))

  const extraAccounts = loadAccounts().filter(a => !a.isPrimary)
  const needsReconnect: string[] = []

  const extraResults = await Promise.all(
    extraAccounts.map(async account => {
      const cachedCals = calCache.filter(c => c.accountEmail === account.email)
      const withId = (cals: CalWithAccount[]) =>
        cals.map(c => ({ ...c, accountId: account.id }))

      // Seed tokenManager with the stored token if it's still within its TTL —
      // avoids an Edge Function round-trip for the calendar-list call below.
      const age = Date.now() - (account.providerTokenSavedAt ?? 0)
      if (age < 50 * 60 * 1000 && account.providerToken) {
        seedToken(account.email, account.providerToken)
      }

      // Get a fresh token via tokenManager (Edge Function handles expiry/refresh).
      let token = await getGoogleToken(account.email)

      // Edge Function returned reconnect_required — try server-side bootstrap using the
      // stored Supabase refresh token. GoTrue's token endpoint returns provider_token
      // (Google access token) when the session was originally created via Google OAuth,
      // which lets the server bootstrap google_account_tokens for future refreshes too.
      if (!token && account.supabaseRefreshToken) {
        token = await getGoogleTokenViaSupabaseRefresh(account.email, account.supabaseRefreshToken)
      }

      if (!token) {
        // Both paths failed — account needs reconnect
        needsReconnect.push(account.email)
        return cachedCals.length
          ? withId(cachedCals.map(c => ({ ...c, accountToken: '' } as CalWithAccount)))
          : []
      }

      const { calendars: cals, authFailed } = await listCalendarsWithToken(token)
      if (!authFailed) {
        return withId(cals.map(c => ({ ...c, accountEmail: account.email, accountToken: token })))
      }

      // Token rejected by Google even after Edge Function refresh — needs reconnect
      needsReconnect.push(account.email)
      return cachedCals.length
        ? withId(cachedCals.map(c => ({ ...c, accountToken: token } as CalWithAccount)))
        : []
    })
  )

  // Extra-account entries take precedence: if the same calendar ID appears in
  // both the primary account list and an extra account list, keep the extra
  // account's version (it owns the calendar and its token has proper access).
  const allExtra  = extraResults.flat()
  const extraIds  = new Set(allExtra.map(c => c.id))
  const filteredPrimary = primaryResult.filter(c => !extraIds.has(c.id))

  const seen = new Set<string>()
  const calendars = [...filteredPrimary, ...allExtra].filter(c => {
    if (seen.has(c.id)) return false
    seen.add(c.id); return true
  })
  return { calendars, needsReconnect }
}

async function fetchAllEvents(allCals: CalWithAccount[], hidden: Set<string>, hiddenAccts: Set<string>, start: Date, end: Date): Promise<GCalEvent[]> {
  // hiddenAccts applies only to extra accounts (c.accountId set) — primary account is never hidden
  const active = allCals.filter(c =>
    !hidden.has(c.id) &&
    !isCalendarHiddenByCompany(c.id, c.accountId ? c.accountEmail : undefined) &&
    (!c.accountId || !hiddenAccts.has(c.accountEmail))
  )
  if (!active.length) return []

  // Use the return value directly so we get the freshest possible token even when
  // localStorage wasn't updated (e.g. Edge Function fallback returned an older token).
  const primaryToken = await refreshPrimaryToken() ?? ''

  const results = await Promise.all(
    active.map(async c => {
      if (c.accountId) {
        // Extra account — tokenManager / Edge Function path.
        // Pass onAuthFail so that if the bootstrapped token silently fails (401/403),
        // the reconnect badge appears even without a reconnect_required Edge Function error.
        const email = c.accountEmail
        const onAuthFail = () =>
          window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email } }))

        const token = await getGoogleToken(email)
        if (!token) return [] as GCalEvent[]
        return fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor, onAuthFail)
      }

      // Primary account — use the fresh token; retry once on empty result in case
      // the token expired between the refresh call above and this fetch.
      const token = primaryToken || c.accountToken
      if (!token) return [] as GCalEvent[]
      let events = await fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor)

      if (!events.length) {
        // Could be a genuine empty calendar or a silent 401. Force-stale the token
        // and retry once with a freshly fetched token so we don't silently drop events.
        localStorage.removeItem('google_provider_token_saved_at')
        const retryToken = await refreshPrimaryToken()
        if (retryToken && retryToken !== token) {
          events = await fetchCalendarEventsWithToken(retryToken, c.id, start, end, c.backgroundColor)
        }
      }

      return events
    })
  )
  return results.flat()
}

// ─── Time grid helpers ────────────────────────────────────────────────────────
function eventTopPx(startIso: string): number {
  const d = new Date(startIso)
  return (d.getHours() + d.getMinutes() / 60) * HOUR_PX
}
function eventHeightPx(startIso: string, endIso: string): number {
  const mins = Math.max(15, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  return mins / 60 * HOUR_PX
}
function snapMinutes(deltaY: number): number {
  const raw = deltaY / HOUR_PX * 60
  return Math.round(raw / SNAP_MIN) * SNAP_MIN
}
/** Your own titles often carry a ✅ or a ❌. The card already says done with a
 *  tick and cancelled with a strike-through, so the glyph is dropped from what
 *  is drawn — never from the event itself. */
const STATUS_EMOJI = /(?:^|\s)[\u2705\u274C\u2714\u2716\u274E\u2717\u2718\u2713\uFE0F]+(?=\s|$)/gu

function displayTitle(summary?: string): string {
  return (summary ?? '(No title)').replace(STATUS_EMOJI, ' ').replace(/\s{2,}/g, ' ').trim() || '(No title)'
}



function nowTopPx(): number {
  const now = new Date()
  return (now.getHours() + now.getMinutes() / 60) * HOUR_PX
}
function minToIso(dateStr: string, totalMinutes: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, Math.floor(totalMinutes / 60), totalMinutes % 60).toISOString()
}

// ─── Overlap layout calculation ───────────────────────────────────────────────
// Groups overlapping events into columns and returns left%/width% for each.
function computeOverlaps(dayEvents: GCalEventExt[]): Map<string, EventLayout> {
  const layout = new Map<string, EventLayout>()
  const timed  = dayEvents.filter(e => !!e.start.dateTime)
  if (!timed.length) return layout

  const sorted = [...timed].sort((a, b) =>
    new Date(a.start.dateTime!).getTime() - new Date(b.start.dateTime!).getTime()
  )

  // Assign each event to the first column it fits in (no overlap with last in that col)
  const cols: GCalEventExt[][] = []
  for (const ev of sorted) {
    const s = new Date(ev.start.dateTime!).getTime()
    let placed = false
    for (const col of cols) {
      const lastEnd = new Date(col[col.length - 1].end.dateTime ?? col[col.length - 1].start.dateTime!).getTime()
      if (lastEnd <= s) { col.push(ev); placed = true; break }
    }
    if (!placed) cols.push([ev])
  }

  const total = cols.length
  cols.forEach((col, ci) => {
    col.forEach(ev => {
      // Check how many columns to the right this event overlaps with
      const s = new Date(ev.start.dateTime!).getTime()
      const e = new Date(ev.end.dateTime ?? ev.start.dateTime!).getTime()
      let span = 1
      for (let c = ci + 1; c < total; c++) {
        const overlaps = cols[c].some(o => {
          const os = new Date(o.start.dateTime!).getTime()
          const oe = new Date(o.end.dateTime ?? o.start.dateTime!).getTime()
          return os < e && oe > s
        })
        if (overlaps) break
        span++
      }
      layout.set(ev.id, {
        left:  (ci / total) * 100,
        width: (span / total) * 100 - 0.5,
      })
    })
  })

  // All-day events get full width
  dayEvents.filter(e => !e.start.dateTime).forEach(e => {
    layout.set(e.id, { left: 0, width: 99 })
  })

  return layout
}


// ─── Calendar color palette (macOS Calendar colors) ──────────────────────────

// ─── Inline color picker for calendar chips ───────────────────────────────────
function ColorPickerPopover({ current, onPick, onClose }: { current: string; onPick: (c: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])
  return (
    <div className="sb-blur-surface" ref={ref} onClick={e => e.stopPropagation()} style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
      padding: '10px 10px 8px', boxShadow: 'var(--sb-shadow-menu)',
      display: 'grid', gridTemplateColumns: 'repeat(11, 22px)', gap: 7,
    }}>
      {CAL_COLORS.map(c => (
        <button key={c} onClick={() => { onPick(c); onClose() }}
          style={{
            width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', background: c, cursor: 'pointer', padding: 0, flexShrink: 0,
            // The ring sits on a colour nobody here chose, so it needs an edge
            // at both ends: a light gap inside, an ink hairline outside. White
            // alone disappears on a pale swatch.
            border: c === current ? '2px solid var(--sb-card)' : '2px solid transparent',
            boxShadow: c === current ? '0 0 0 1px var(--sb-ink-1)' : 'none',
          }}
        />
      ))}
    </div>
  )
}

// ─── DayColumn (droppable) ────────────────────────────────────────────────────
function DayColumn({ dateStr, isToday, children }: { dateStr: string; isToday: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${dateStr}` })
  return (
    <div ref={setNodeRef} style={{
      flex: 1, position: 'relative', height: GRID_H,
      borderRight: 'var(--sb-border-width) solid var(--sb-border)',
      background: isToday ? 'rgba(var(--sb-accent-rgb),0.045)' : isOver ? 'rgba(var(--sb-accent-rgb),0.09)' : 'transparent',
      transition: 'background 0.1s', minWidth: 0,
    }}>
      {/* Hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} style={{ position: 'absolute', top: h * HOUR_PX, left: 0, right: 0, borderTop: 'var(--sb-border-width) solid var(--sb-field)', pointerEvents: 'none' }} />
      ))}
      {/* Half-hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={`h${h}`} style={{ position: 'absolute', top: h * HOUR_PX + HOUR_PX / 2, left: 0, right: 0, borderTop: '1px dashed var(--sb-field)', opacity: 0.6, pointerEvents: 'none' }} />
      ))}
      {children}
    </div>
  )
}

// ─── ResizeHandle (top or bottom) — invisible hit area on card edge ──────────
function ResizeHandle({ eventId, edge }: { eventId: string; edge: 'top' | 'bottom' }) {
  const dragId = edge === 'top' ? `resize-top:${eventId}` : `resize-bottom:${eventId}`
  const { attributes, listeners, setNodeRef } = useDraggable({ id: dragId })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top:    edge === 'top'    ? 0 : undefined,
        bottom: edge === 'bottom' ? 0 : undefined,
        left: 0, right: 0, height: 8,
        cursor: 'ns-resize', zIndex: 3,
      }}
    />
  )
}

// ─── EventBlock (draggable, positioned in time grid) ─────────────────────────
function EventBlock({ event, layout, status, isSelected, isDragSrc, isDragOverlay, colorOverride, onStatusToggle, onClick, onContextMenu }: {
  event: GCalEventExt
  layout: EventLayout
  status: EventStatus | undefined
  isSelected: boolean
  isDragSrc: boolean
  isDragOverlay?: boolean
  colorOverride?: string
  onStatusToggle: (s: EventStatus) => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  // `transform` is deliberately not taken. A DragOverlay is what follows the
  // pointer here, so translating the card in the grid as well drags two copies
  // of the same event at once — and an absolutely positioned card being
  // transformed inside the grid's own scroller tears as it goes, which is the
  // smear of stripes down the column it leaves behind. The card stays where
  // the event is, dimmed, and the overlay does the moving.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: event.id,
    disabled: isDragOverlay,
  })

  const isAllDay = !event.start.dateTime
  if (isAllDay) return null

  const top    = eventTopPx(event.start.dateTime!)
  const height = eventHeightPx(event.start.dateTime!, event.end.dateTime ?? event.start.dateTime!)
  const color  = colorOverride ?? event.calendarColor ?? 'var(--sb-info)'
  const isDone = status === 'done'
  const isCancelled = status === 'cancelled'
  const isTentative = event.status === 'tentative'
  const fromTask = isTaskEvent(event.summary, event.description)

  // Sunlit Bento event styles
  // Only a cancelled event goes grey. Done and simply-past events keep their
  // calendar's colour — an event you attended is not an event that went away.
  // A solid tint of the calendar's colour, not a wash you can see the grid
  // lines through: the ground is mixed in rather than left to show, so the
  // card is an object on the grid instead of a stain on it. The title is the
  // same colour taken down to text weight, which is what makes a block
  // readable at a glance as *that* calendar rather than as a coloured smear.
  //
  // The mix is into --sb-card because that is what the grid is painted in.
  // On Glass & Depth that token is itself a wash over the page, so the result
  // there is translucent by the theme's own definition — every surface in it
  // is.
  //
  // The card keeps its calendar's colour whether the event is done, cancelled
  // or neither — the tick and the strike-through say what happened to it.
  //
  // Two events are drawn inverted rather than tinted: the one happening right
  // now, and the one you have selected. They are the two an eye should find
  // without looking, and a slightly stronger wash of the same hue is not that.
  // The tokens do the inverting, so on a dark theme — where --sb-ink-1 is the
  // light end of the ramp — the block goes light and its text dark, which is
  // the same statement the other way up.
  const nowMs = Date.now()
  const isNow = new Date(event.start.dateTime!).getTime() <= nowMs
    && new Date(event.end.dateTime ?? event.start.dateTime!).getTime() > nowMs
  const inverted = isNow || isSelected

  const evBg   = inverted
    ? 'var(--sb-ink-1)'
    : `color-mix(in srgb, ${color} 26%, var(--sb-card))`
  const evInk  = inverted
    ? 'var(--sb-ink-on-dark)'
    : `color-mix(in srgb, ${color} 55%, var(--sb-ink-1))`
  const evTimeInk = inverted
    ? 'color-mix(in srgb, var(--sb-ink-on-dark) 76%, transparent)'
    : `color-mix(in srgb, ${color} 30%, var(--sb-ink-2))`
  // No outline in the ordinary case: a solid fill already has an edge. What is
  // left is the two states an edge is the only way to say — a tentative event,
  // and the one you have selected.
  const evBorder = isTentative
    ? `var(--sb-border-width) dashed ${color}`
    : 'var(--sb-border-width) solid transparent'

  // What a card can say depends on how much of it there is — in pixels, not in
  // percent, since a third of a day column is a different size on every screen.
  const [cardW, setCardW] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setCardW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const w = isDragOverlay ? 130 : cardW || 999
  const tiny     = height < 28
  // Wrapping needs enough width for a line to be a line. Under that, three
  // letters and an ellipsis say less than two short wrapped lines do, so the
  // floor is where a word stops fitting rather than where a card looks tidy.
  const canWrap  = w >= 52 && height >= 34
  const showTime = w >= 104 && height >= 38
  const showHost = w >= 104 && height >= 56

  return (
    <div
      ref={node => { setNodeRef(node); boxRef.current = node }}
      {...(isDragOverlay ? {} : listeners)}
      {...(isDragOverlay ? {} : attributes)}
      onClick={onClick}
      onContextMenu={isDragOverlay ? undefined : onContextMenu}
      className="event-card"
      style={{
        position: isDragOverlay ? 'relative' : 'absolute',
        top:    isDragOverlay ? undefined : top,
        left:   isDragOverlay ? undefined : `${layout.left}%`,
        width:  isDragOverlay ? 130 : `${layout.width}%`,
        height: isDragOverlay ? Math.max(38, height) : height,
        background: evBg,
        borderRadius: 'var(--sb-r-nav)',
        border: evBorder,
        padding: tiny ? '3px 6px' : '5px 8px 8px',
        overflow: 'hidden',
        cursor: isDragOverlay ? 'grabbing' : 'pointer',
        // iOS scrolls the grid instead of dragging the event without this.
        touchAction: 'none',
        opacity: isDragSrc ? 0.35 : 1,
        transition: isDragging ? 'none' : 'box-shadow 0.12s, opacity 0.12s',
        boxSizing: 'border-box',
        zIndex: isSelected ? 4 : 2,
        boxShadow: isSelected
          ? `0 0 0 2px ${color}, 0 6px 18px -8px color-mix(in srgb, var(--sb-ink-1) 35.0%, transparent)`
          : '0 1px 2px color-mix(in srgb, var(--sb-ink-1) 5.0%, transparent)',
        userSelect: 'none',
      }}
    >
      {/* Done is a tick in front of the name; cancelled strikes the name
          through. Neither touches the card's colour — that belongs to the
          calendar the event is on, not to what happened to it. */}
      <div style={{
        // The micro *size*, not the micro level: a card's title is not a capsed
        // caption, and spreading T.micro would put it in capitals.
        fontFamily: SANS,
        fontSize: 'var(--sb-t-micro)',
        fontWeight: 700,
        color: evInk,
        lineHeight: 1.25,
        overflow: 'hidden',
        // A card only wraps when it is wide enough for a wrapped line to be a
        // line. In a shared column it stays on one line and trails off.
        ...(canWrap
          ? { display: '-webkit-box', WebkitLineClamp: height >= 78 ? 4 : height >= 52 ? 3 : 2, WebkitBoxOrient: 'vertical' as const }
          : { whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' }),
      }}>
        {isDone && (
          <Check
            size={tiny ? 11 : 12}
            strokeWidth={STROKE.active}
            style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }}
          />
        )}
        {/* An event this app made from a task gets a drawn icon rather than the
            emoji it carries for Google's benefit. */}
        {fromTask && (
          <CheckSquare
            size={tiny ? 10 : 11}
            strokeWidth={STROKE.active}
            style={{ display: 'inline', verticalAlign: '-1.5px', marginRight: 3, opacity: 0.75 }}
          />
        )}
        <span style={{
          textDecoration: isCancelled ? 'line-through' : 'none',
          textDecorationColor: `color-mix(in srgb, ${inverted ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-1)'} 45%, transparent)`,
          textDecorationThickness: 1.5,
        }}>{displayTitle(fromTask ? stripTaskMark(event.summary) : event.summary)}</span>
      </div>
      {showHost && (() => {
        const host = meetingHost(event)
        return host ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, overflow: 'hidden' }}>
            <Video size={ICON.sm} color={evTimeInk} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--sb-t-micro)', color: evTimeInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {host}
            </span>
          </div>
        ) : null
      })()}
      {showTime && (
        <div style={{ fontSize: 'var(--sb-t-micro)', color: evTimeInk, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {fmtShort(event.start.dateTime!)}
          {event.end.dateTime ? ` – ${fmtShort(event.end.dateTime)}` : ''}
        </div>
      )}
      {showHost && height >= 74 && event.location && !meetingHost(event) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3, overflow: 'hidden' }}>
          <MapPin size={ICON.sm} color={evTimeInk} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--sb-t-micro)', color: evTimeInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.location}
          </span>
        </div>
      )}
      {/* Inline Done / Cancel icon buttons — visible on hover, or always if active */}
      {height >= 48 && !isDragOverlay && (
        <div
          onClick={e => e.stopPropagation()}
          className="event-actions"
          style={{ position: 'absolute', bottom: 10, right: 5, display: 'flex', gap: 4 }}
        >
          <button
            onClick={e => { e.stopPropagation(); onStatusToggle('done') }}
            title="Mark done"
            style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', border: 'none', padding: 0,
              background: isDone ? 'color-mix(in srgb, var(--sb-positive) 90.0%, transparent)' : 'color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
              color: isDone ? 'var(--sb-ink-on-fill)' : 'var(--sb-ink-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // Revealed on hover on a mouse; always present on a touch
              // screen, which has no hover and could not reach them at all.
              opacity: 0, transition: 'opacity 0.12s',
            }}
          >
            <CheckCircle2 size={ICON.sm} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onStatusToggle('cancelled') }}
            title="Cancel"
            style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', border: 'none', padding: 0,
              background: isCancelled ? 'color-mix(in srgb, var(--sb-negative) 90.0%, transparent)' : 'color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
              color: isCancelled ? 'var(--sb-ink-on-fill)' : 'var(--sb-ink-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: 0, transition: 'opacity 0.12s',
            }}
          >
            <XCircle size={ICON.sm} />
          </button>
        </div>
      )}
      {!isDragOverlay && <ResizeHandle eventId={event.id} edge="top" />}
      {!isDragOverlay && <ResizeHandle eventId={event.id} edge="bottom" />}
    </div>
  )
}

// ─── EventPopup — docked right-hand panel ─────────────────────────────────────
// ─── Event panel ─────────────────────────────────────────────────────────────
// Docked on the right, laid out as the artboard: the calendar chip and its
// controls on top, then the title, the time row, any clash, and the fields —
// calendar, where, repeats, prep — over attendees, prep and the Professor's
// suggestion.

// The detail panel used to be a 240-330px column beside the grid, drawn at
// `zoom: 0.75` with its type a fifth larger again inside that, to fit. It is
// the composer's 680px shell now — the same object as the panel that opens on
// an empty slot, because they were always the same object on screen — so
// nothing multiplies its type any more: every size in it is the token the
// task panel uses, so the two panels are one design in two modules.
















// ─── EventContextMenu ─────────────────────────────────────────────────────────
function EventContextMenu({
  event,
  pos,
  status,
  onClose,
  onViewDetails,
  onStatusToggle,
  onDelete,
}: {
  event: GCalEventExt
  pos: { x: number; y: number }
  status: EventStatus | undefined
  onClose: () => void
  onViewDetails: () => void
  onStatusToggle: (s: EventStatus) => void
  onDelete: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjPos, setAdjPos] = useState(pos)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  // Viewport clamping — same logic as EventPopup
  useEffect(() => {
    if (!menuRef.current) return
    const { width, height } = menuRef.current.getBoundingClientRect()
    let x = pos.x, y = pos.y
    if (x + width  > window.innerWidth  - 8) x = pos.x - width
    if (y + height > window.innerHeight - 8) y = window.innerHeight - height - 8
    if (y < 8) y = 8
    if (x < 8) x = 8
    setAdjPos({ x, y })
  }, [pos.x, pos.y])

  // Outside-click dismissal — same pattern as EventPopup
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  // Escape key dismissal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  const isDone      = status === 'done'
  const isCancelled = status === 'cancelled'

  const conferenceUrl = event.conferenceData?.entryPoints
    ?.find(ep => ep.entryPointType === 'video')?.uri

  function formatCopyDetails(): string {
    const startIso = event.start.dateTime
    const endIso   = event.end.dateTime
    const lines: string[] = [event.summary ?? '(No title)']
    if (startIso) lines.push(fmtPopupDate(startIso, endIso ?? startIso, false))
    else if (event.start.date) lines.push(event.start.date)
    if (event.location) lines.push(event.location)
    return lines.join('\n')
  }

  const sep: React.CSSProperties = { height: 1, background: 'var(--sb-border)', margin: '3px 8px' }

  function item(
    id: string,
    icon: React.ReactNode,
    label: string,
    action: (() => void) | undefined,
    opts: { destructive?: boolean; disabled?: boolean } = {}
  ) {
    const { destructive = false, disabled = false } = opts
    const hovered = hoveredItem === id && !disabled
    return (
      <div
        key={id}
        onMouseEnter={() => setHoveredItem(id)}
        onMouseLeave={() => setHoveredItem(null)}
        onClick={disabled ? undefined : () => { action?.(); onClose() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '0 12px', height: 32, fontSize: 'var(--sb-t-body)',
          color: disabled ? 'var(--sb-ink-3)' : destructive ? 'var(--sb-negative)' : 'var(--sb-ink-2)',
          cursor: disabled ? 'default' : 'pointer',
          borderRadius: 'var(--sb-r-chip)', userSelect: 'none',
          background: hovered
            ? (destructive ? 'color-mix(in srgb, var(--sb-negative) 10.0%, transparent)' : 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)')
            : 'transparent',
          transition: 'background 0.08s',
        }}
      >
        <span style={{ flexShrink: 0, opacity: disabled ? 0.4 : 1 }}>{icon}</span>
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div className="sb-blur-surface"
      ref={menuRef}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed',
        top: adjPos.y, left: adjPos.x,
        width: 210,
        background: 'var(--sb-card)',
        border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-nav)',
        boxShadow: 'var(--sb-shadow-menu)',
        zIndex: 1100,
        padding: '4px 0',
        overflow: 'hidden',
      }}
    >
      {/* Group 1: Navigation */}
      {item('view',   <Eye size={ICON.sm} />,          'View Details',             onViewDetails)}
      {item('gcal',   <ExternalLink size={ICON.sm} />,  'Open in Google Calendar',  event.htmlLink ? () => window.open(event.htmlLink, '_blank') : undefined, { disabled: !event.htmlLink })}
      {conferenceUrl && item('join', <Video size={ICON.sm} />, 'Join Meeting', () => window.open(conferenceUrl, '_blank'))}

      <div style={sep} />

      {/* Group 2: Clipboard */}
      {item('copy-link',    <Link size={ICON.sm} />, 'Copy Event Link',
        event.htmlLink ? () => navigator.clipboard.writeText(event.htmlLink!).catch(() => {}) : undefined,
        { disabled: !event.htmlLink })}
      {item('copy-details', <Copy size={ICON.sm} />, 'Copy Details',
        () => navigator.clipboard.writeText(formatCopyDetails()).catch(() => {}))}

      <div style={sep} />

      {/* Group 3: Status */}
      {item('done',      <CheckCircle2 size={ICON.sm} />, isDone      ? 'Unmark Done'      : 'Mark as Done',
        () => { onStatusToggle('done');      onClose() }, )}
      {item('cancelled', <XCircle size={ICON.sm} />,      isCancelled ? 'Restore Event'    : 'Mark as Cancelled',
        () => { onStatusToggle('cancelled'); onClose() }, )}

      <div style={sep} />

      {/* Group 4: Destructive */}
      {item('delete', <Trash2 size={ICON.sm} />, 'Delete Event', onDelete, { destructive: true })}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CalendarIntelligence() {
  const user = useAuthStore(s => s.user)

  // ── Calendar + event state ──────────────────────────────────────────────────
  // The focused day. Week and day views both hang off it; the grid loads by week.
  const [anchorDate,      setAnchorDate]     = useState<Date>(() => new Date())

  const [calView,         setCalView]        = useState<'day' | 'week' | 'month'>(() => {
    try { return (localStorage.getItem('cal-view') as 'day' | 'week' | 'month') ?? 'week' } catch { return 'week' }
  })
  const firstDow  = useWeekStart()
  const weekStart = useMemo(() => getWeekStart(anchorDate, firstDow), [anchorDate, firstDow])
  const [events,          setEvents]          = useState<GCalEvent[]>(() => loadEventsCache(getWeekStart(new Date())))
  const [allCalendars,    setAllCalendars]    = useState<CalWithAccount[]>(() => {
    // Use the last known primary email (saved to localStorage after each successful auth)
    // so we can filter orphaned deleted-account entries even on the very first render.
    const savedPrimaryEmail = localStorage.getItem('cal-intel-primary-email') ?? undefined
    const c = loadCalIntelCache(savedPrimaryEmail)
    return c.length ? rebuildFromCache(c) : []
  })
  const [hiddenCals,      setHiddenCals]      = useState<Set<string>>(loadHiddenIntel)
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(loadHiddenAccounts)
  // Start as not-loading if we have cached events so the grid renders immediately.
  const [loadingEvents,   setLoadingEvents]   = useState(() => loadEventsCache(getWeekStart(new Date())).length === 0)
  const [noAuth,          setNoAuth]          = useState(false)
  const [fetchError,      setFetchError]      = useState<string | null>(null)
  const [refreshing,      setRefreshing]      = useState(false)
  const [reconnectNeeded, setReconnectNeeded] = useState<string[]>([])
  const [applyingRules,   setApplyingRules]   = useState(false)
  const [rulesResult,     setRulesResult]     = useState<string | null>(null)
  const [originalsOnly,   setOriginalsOnly]   = useState(false)
  const [showCalendars,   setShowCalendars]   = useState(() => {
    try { return localStorage.getItem('cal-show-calendars') !== 'false' } catch { return true }
  })

  // ── Popup + prep state ──────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState<GCalEventExt | null>(null)
  const [prep,          setPrep]          = useState<MeetingPrep | null>(null)
  const [prepLoading,   setPrepLoading]   = useState(false)
  const [prepError,     setPrepError]     = useState<string | null>(null)
  const [eventStatuses, setEventStatuses] = useState<Record<string, EventStatus>>(loadEventStatuses)
  const [calColors,     setCalColorsMap]  = useState<Record<string, string>>(loadCalColors)
  const [pickerOpenId,  setPickerOpenId]  = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ event: GCalEventExt; x: number; y: number } | null>(null)

  function setCalColor(id: string, color: string) {
    setCalColorsMap(prev => { const next = { ...prev, [id]: color }; saveCalColors(next); return next })
  }

  // Effective color: custom override > google color > fallback
  function calEffectiveColor(cal: CalWithAccount): string {
    return calColors[cal.id] ?? cal.backgroundColor ?? 'var(--sb-info)'
  }

  // ── DnD state ───────────────────────────────────────────────────────────────
  const [dragMode,     setDragMode]     = useState<DragMode | null>(null)
  const [draggingEvt,  setDraggingEvt]  = useState<GCalEventExt | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // ── Drag-to-create state ────────────────────────────────────────────────────
  const [creatingEvt,   setCreatingEvt]   = useState<CreatingEvt | null>(null)
  const [newEventDraft, setNewEventDraft] = useState<NewEventDraft | null>(null)
  const creatingRef = useRef<CreatingEvt | null>(null)
  useEffect(() => { creatingRef.current = creatingEvt }, [creatingEvt])

  useEffect(() => {
    if (!creatingEvt) return
    const onMove = (e: PointerEvent) => {
      if (!gridRef.current) return
      const rect = gridRef.current.getBoundingClientRect()
      const relY = e.clientY - rect.top + gridRef.current.scrollTop
      const minutes = Math.max(0, Math.min(23 * 60 + 45,
        Math.round((relY / HOUR_PX * 60) / SNAP_MIN) * SNAP_MIN))
      setCreatingEvt(prev => prev ? { ...prev, currentMin: minutes } : null)
    }
    const onUp = (e: PointerEvent) => {
      const cur = creatingRef.current
      setCreatingEvt(null)
      if (!cur) return
      const startMin = Math.min(cur.originMin, cur.currentMin)
      const endMin   = Math.max(cur.originMin + SNAP_MIN, cur.currentMin)
      if (endMin - startMin >= SNAP_MIN) {
        setNewEventDraft({ dateStr: cur.dateStr, startMin, endMin, anchorX: e.clientX, anchorY: e.clientY })
      }
    }
    document.addEventListener('pointermove',   onMove)
    document.addEventListener('pointerup',     onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove',   onMove)
      document.removeEventListener('pointerup',     onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [!!creatingEvt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Putting an event on the grid by hand ──────────────────────────────────
  // This only ever listened for mouse events, and only ever created anything
  // after an 8px drag — so on a touch screen there was no way to add an event
  // at all, and even with a mouse a plain click did nothing. A finger cannot
  // draw here either: a vertical drag has to stay available for scrolling the
  // day, so touch gets the tap and the mouse keeps the drag as well.
  function handleGridPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.event-card, button, [role="button"], select, input, textarea')) return
    if (draggingEvt) return

    // The columns container, not the scroller: it excludes the time gutter and
    // its top already moves with the scroll. The old maths measured the
    // scroller instead, subtracted a gutter width that was wrong by 6px, and
    // divided by a hardcoded 7 — so in day view, where there is one column,
    // anything right of the first seventh of the grid resolved to no day at
    // all and silently did nothing.
    const cols = e.currentTarget.getBoundingClientRect()
    const relX = e.clientX - cols.left
    const relY = e.clientY - cols.top
    if (relX < 0 || relY < 0) return

    const dayIdx = Math.max(0, Math.min(weekDays.length - 1,
      Math.floor(relX / (cols.width / Math.max(1, weekDays.length)))))
    const day = weekDays[dayIdx]
    if (!day) return
    const dateStr = localDateStr(day)

    const rawMin  = Math.max(0, Math.min(23 * 60 + 59, (relY / HOUR_PX) * 60))
    const dragMin = Math.round(rawMin / SNAP_MIN) * SNAP_MIN
    const startX = e.clientX, startY = e.clientY
    // A finger scrolls; only a mouse draws.
    const coarse = e.pointerType !== 'mouse'
    let started = false

    const cleanup = () => {
      document.removeEventListener('pointermove',   onMove)
      document.removeEventListener('pointerup',     onUp)
      document.removeEventListener('pointercancel', onCancelled)
    }
    const travelled = (ev: PointerEvent) => Math.hypot(ev.clientX - startX, ev.clientY - startY)

    const onMove = (me: PointerEvent) => {
      if (started || coarse) return
      if (travelled(me) >= 8) {
        started = true; cleanup()
        setCreatingEvt({ dateStr, originMin: dragMin, currentMin: dragMin })
        setSelectedEvent(null); setNewEventDraft(null)
      }
    }
    const onUp = (ue: PointerEvent) => {
      cleanup()
      if (started) return
      if (travelled(ue) > (coarse ? 12 : 4)) return          // a scroll, or a wobble
      // A bare tap does not create an event. Drawing a span says when it is
      // and how long it runs; a tap says neither, and a composer opening under
      // every stray click on the grid is a panel you spend the day closing.
      // Touch, which cannot draw, uses New event in the header.
      setSelectedEvent(null)
    }
    // iOS fires this the moment it decides the gesture is a scroll.
    const onCancelled = () => cleanup()

    document.addEventListener('pointermove',   onMove)
    document.addEventListener('pointerup',     onUp)
    document.addEventListener('pointercancel', onCancelled)
  }

  // Something elsewhere — the Today plan — can ask for a particular event to be
  // open when this page arrives. Land on its day in the week view, then select
  // it as soon as that week's events are in.
  const focus = useUIStore(s => s.focus)
  const clearFocus = useUIStore(s => s.clearFocus)
  const pendingFocusId = useRef<string | null>(null)
  useEffect(() => {
    if (focus?.module !== 'calendar') return
    if (focus.date) setAnchorDate(new Date(focus.date + 'T12:00:00'))
    setCalView('week')
    try { localStorage.setItem('cal-view', 'week') } catch { /* noop */ }
    pendingFocusId.current = focus.id
    clearFocus()
  }, [focus, clearFocus])

  useEffect(() => {
    const id = pendingFocusId.current
    if (!id) return
    const found = events.find(e => e.id === id)
    if (!found) return
    setSelectedEvent(found as GCalEventExt)
    pendingFocusId.current = null
  }, [events])

  // Weather for the gutter. The forecast is fetched once; which day it speaks
  // for is worked out below, once the visible days are known.
  const [weather, setWeather] = useState<WeatherByHour>({})
  useEffect(() => {
    const refresh = () => { void loadWeather().then(setWeather) }
    refresh()
    // The forecast follows the timezone in Settings, so pick up a change to it.
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // ── Grid scroll ref (auto-scroll to current time on mount) ──────────────────
  const gridRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string>('')

  // ── Calendar loading ────────────────────────────────────────────────────────
  const reloadCalendars = useCallback(async () => {
    if (!user?.email) return  // wait for user — prevents concurrent double-call race
    // Persist primary email for the initial-render cache cleanup on next page load
    localStorage.setItem('cal-intel-primary-email', user.email)
    // Take the cache before clearing it: clearing is what keeps a calendar you
    // unsubscribed from in Google out of the list, but loadAllCalendars needs
    // the old contents to fall back on for an account it cannot reach.
    const cachedBefore = loadCalIntelCache()
    localStorage.removeItem(CAL_INTEL_CACHE_KEY)
    const { calendars: fresh, needsReconnect } = await loadAllCalendars(user.email, cachedBefore)
    setReconnectNeeded(needsReconnect)

    if (fresh.length) {
      // Pass primaryEmail so saveCalIntelCache can purge orphaned deleted accounts
      const primaryEmail = user.email
      saveCalIntelCache(fresh, primaryEmail)
      // Read the latest primary token AFTER listCalendars() has had a chance to refresh it
      const latestPrimaryToken = localStorage.getItem('google_provider_token') ?? ''

      setAllCalendars(prev => {
        const freshEmails = new Set(fresh.map(c => c.accountEmail))
        const validEmails = new Set(loadAccounts().map(a => a.email))
        validEmails.add(primaryEmail)
        // Keep accounts not in fresh result, filter out deleted (orphaned) accounts,
        // and inject the latest primary token to avoid stale-token 401s
        const kept = prev
          .filter(c => !freshEmails.has(c.accountEmail) && validEmails.has(c.accountEmail))
          .map(c => c.accountEmail === primaryEmail
            ? { ...c, accountToken: latestPrimaryToken }
            : c
          )
        const seen = new Set<string>()
        return [...fresh, ...kept].filter(c => {
          if (seen.has(c.id)) return false
          seen.add(c.id); return true
        })
      })
      setNoAuth(false)
      return fresh
    }

    // Nothing from API — fall back to full cache (pass primaryEmail for orphan cleanup)
    const cached = loadCalIntelCache(user?.email)
    if (cached.length) {
      const fromCache = rebuildFromCache(cached)
      setAllCalendars(fromCache); setNoAuth(false); return fromCache
    }
    setNoAuth(true); return []
  }, [user?.email])

  useEffect(() => { void reloadCalendars() }, [user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadEvents = useCallback(async (start: Date, cals: CalWithAccount[], hidden: Set<string>, hiddenAccts = hiddenAccounts, rangeEnd?: Date) => {
    setFetchError(null)
    // Show spinner only when there's nothing cached for this week; otherwise update silently.
    const alreadyCached = loadEventsCache(start).length > 0
    if (!alreadyCached) setLoadingEvents(true)
    try {
      if (!cals.length) { setNoAuth(true); setEvents([]); return }
      const end     = rangeEnd ?? getWeekEnd(start)
      const fetched = await fetchAllEvents(cals, hidden, hiddenAccts, start, end)
      setEvents(fetched); setNoAuth(false)
      // Only the week cache is keyed by week — a month fetch would poison it
      if (!rangeEnd) saveEventsCache(start, fetched)

      // Auto-apply rules silently in the background
      const autoRules = loadBlockingRules().filter(r => r.enabled && r.autoApply)
      if (autoRules.length) {
        const sourceEvents: SourceEvent[] = (fetched as GCalEventExt[])
          .filter(e => e.calendarId && e.id)
          .map(e => ({
            id:          e.id,
            calendarId:  e.calendarId!,
            summary:     e.summary,
            description: e.description,
            location:    e.location,
            start:       e.start,
            end:         e.end,
          }))
        void Promise.all([
          applyBlockingRules(autoRules, sourceEvents),
          cleanupStaleBlocks(autoRules, sourceEvents),
        ])
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load events.')
      setEvents([])
    } finally { setLoadingEvents(false) }
  }, [])

  // When the user navigates to a different week, immediately show whatever is cached for
  // that week so the grid isn't empty while fresh events load.
  const prevWeekKey = useRef(eventsWeekKey(weekStart))
  useEffect(() => {
    if (calView === 'month') return
    const key = eventsWeekKey(weekStart)
    if (key === prevWeekKey.current) return
    prevWeekKey.current = key
    const cached = loadEventsCache(weekStart)
    if (cached.length) { setEvents(cached); setLoadingEvents(false) }
    else setLoadingEvents(true)
  }, [weekStart, calView])

  // Month draws six weeks at once, so it asks for the whole span it will show
  const monthStartKey = `${anchorDate.getFullYear()}-${anchorDate.getMonth()}`
  useEffect(() => {
    if (!allCalendars.length) return
    if (calView === 'month') {
      const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
      const gridStart = getWeekStart(first, firstDow)
      const gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 41); gridEnd.setHours(23, 59, 59, 999)
      void loadEvents(gridStart, allCalendars, hiddenCals, hiddenAccounts, gridEnd)
    } else {
      void loadEvents(weekStart, allCalendars, hiddenCals, hiddenAccounts)
    }
  }, [weekStart, monthStartKey, calView, allCalendars, hiddenCals, hiddenAccounts, loadEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => void reloadCalendars().then(c => { if (c) void loadEvents(weekStart, c, hiddenCals) })
    window.addEventListener('professor:accountsUpdated', handler)
    return () => window.removeEventListener('professor:accountsUpdated', handler)
  }, [reloadCalendars, loadEvents, weekStart, hiddenCals])

  // React to account visibility changes triggered from Settings
  useEffect(() => {
    const handler = () => {
      const updated = loadHiddenAccounts()
      setHiddenAccounts(updated)
    }
    window.addEventListener('professor:accountVisibilityChanged', handler)
    return () => window.removeEventListener('professor:accountVisibilityChanged', handler)
  }, [])

  // ── Auto-refresh events every 2 minutes ─────────────────────────────────────
  // Keeps the calendar view current without a full page reload. Uses the same
  // loadEvents path as the manual refresh so visibility/filter state is respected.
  useEffect(() => {
    if (!allCalendars.length) return
    const id = setInterval(() => {
      void loadEvents(weekStart, allCalendars, hiddenCals, hiddenAccounts)
    }, 2 * 60 * 1000)
    return () => clearInterval(id)
  }, [allCalendars, weekStart, hiddenCals, hiddenAccounts, loadEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Token expiry listener ────────────────────────────────────────────────────
  // tokenManager dispatches 'cal:reconnect-required' when the Edge Function
  // returns reconnect_required for an extra account. Show the badge immediately.
  useEffect(() => {
    const handler = (e: Event) => {
      const email = (e as CustomEvent<{ email: string }>).detail?.email
      if (email) setReconnectNeeded(prev => [...new Set([...prev, email])])
    }
    window.addEventListener('cal:reconnect-required', handler)
    return () => window.removeEventListener('cal:reconnect-required', handler)
  }, [])

  // ── Status toggle ───────────────────────────────────────────────────────────
  function toggleStatus(eventId: string, status: EventStatus) {
    setEventStatuses(prev => {
      const next = { ...prev }
      if (next[eventId] === status) delete next[eventId]; else next[eventId] = status
      saveEventStatuses(next)
      // A block that came from a task is that task's hour. Ticking it here
      // finishes the task too, or the board goes on asking for work that is
      // done.
      syncTaskToEvent(eventId, next[eventId] ?? null)
      return next
    })
  }

  // ── Calendar visibility ─────────────────────────────────────────────────────
  function toggleCal(id: string) {
    setHiddenCals(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      saveHiddenIntel(next); return next
    })
  }

  // ── Popup + prep ────────────────────────────────────────────────────────────
  function handleEventClick(ev: GCalEventExt, e: React.MouseEvent) {
    e.stopPropagation()
    if (selectedEvent?.id === ev.id) { setSelectedEvent(null); return }
    setSelectedEvent(ev)
    setPrep(null); setPrepError(null)
  }

  function handleEventContextMenu(ev: GCalEventExt, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedEvent(null)
    setCtxMenu({ event: ev, x: e.clientX, y: e.clientY })
  }

  async function handleDeleteEvent(ev: GCalEventExt) {
    setCtxMenu(null)
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal || !ev.calendarId) return
    const token = cal.accountId
      ? await getGoogleToken(cal.accountEmail)
      : (await refreshPrimaryToken() || cal.accountToken)
    if (!token) return
    const ok = await deleteCalendarEventWithToken(token, ev.calendarId, ev.id)
    if (ok) {
      // Google has no undelete, so taking this back means writing the same
      // event again. It comes back with a new id — which is why the undo says
      // "put it back" rather than pretending nothing happened.
      const body: GCalEventCreate = {
        summary: ev.summary ?? '(No title)',
        description: ev.description,
        location: ev.location,
        start: ev.start,
        end: ev.end,
        attendees: ev.attendees?.filter(a => !a.self).map(a => ({ email: a.email })),
      }
      const calendarId = ev.calendarId
      pushUndo(`Deleted "${ev.summary ?? 'an event'}"`, async () => {
        const back = await createCalendarEventWithToken(token, calendarId, body)
        if (back.event) setEvents(prev => [...prev, { ...back.event as GCalEvent, calendarId } as GCalEventExt])
      })
      setEvents(prev => prev.filter(e => e.id !== ev.id))
      if (selectedEvent?.id === ev.id) setSelectedEvent(null)
    }
  }

  // ── Delete, from the keyboard ───────────────────────────────────────────────
  // The selected event is the one the key means, the same as in the Mac and iOS
  // calendars. Backspace counts too, and neither does anything while you are
  // typing — into a field, a note or a search box — or the key that should have
  // rubbed out a character would take the event with it.
  useEffect(() => {
    if (!selectedEvent) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (inTextField(document.activeElement)) return
      e.preventDefault()
      void handleDeleteEvent(selectedEvent)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Put an event back where it was — on screen and in Google. Registered
   *  before a drag writes, so the times closed over are the old ones. */
  function rememberTimes(ev: GCalEventExt, label: string) {
    const startISO = ev.start.dateTime
    const endISO   = ev.end.dateTime
    if (!startISO || !endISO) return
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    const calendarId = ev.calendarId
    if (!cal || !calendarId) return
    const token = cal.accountToken
    const id = ev.id
    pushUndo(label, async () => {
      applyOptimisticUpdate(id, new Date(startISO), new Date(endISO))
      const ok = await updateCalendarEventTimes(token, calendarId, id, new Date(startISO), new Date(endISO))
      if (!ok) revertOptimisticUpdate(id, startISO, endISO)
    })
  }

  /** Move an event to another calendar, and say so when it cannot.
   *
   *  Within one account Google has a /move endpoint: the event keeps its id and
   *  its guest list, and nothing is sent to anybody. Between two accounts there
   *  is no such thing — an event belongs to the account that owns it — so the
   *  only way across is to write it again on the far side and delete the
   *  original. That is a different event afterwards, which is why it asks
   *  first.
   *
   *  A connected account's token is never in the browser, so each half uses
   *  whichever route that account has: the edge function, or the primary
   *  account's own token. */
  async function handleMoveEvent(ev: GCalEventExt, targetCalId: string): Promise<string | null> {
    const srcCal  = allCalendars.find(c => c.id === ev.calendarId)
    const destCal = allCalendars.find(c => c.id === targetCalId)
    if (!srcCal || !destCal || !ev.calendarId) return 'That calendar is not available'
    if (targetCalId === ev.calendarId) return null

    const sameAccount = (srcCal.accountEmail ?? '') === (destCal.accountEmail ?? '')

    if (sameAccount) {
      let moved: GCalEvent | null = null
      let failure: string | null = null
      if (srcCal.accountId) {
        const result = await efMoveEvent(srcCal.accountId, ev.calendarId, ev.id, targetCalId)
        moved = result.event
        failure = result.error ?? null
      } else {
        const token = await refreshPrimaryToken() || srcCal.accountToken
        if (!token) return 'Google needs reconnecting before this can move'
        moved = await moveCalendarEventWithToken(token, ev.calendarId, ev.id, targetCalId)
        if (!moved) failure = 'Google would not move it'
      }
      if (!moved) return failure ?? 'Google would not move it'

      const update = { calendarId: targetCalId, calendarColor: destCal.backgroundColor }
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, ...update } : e))
      setSelectedEvent(prev => prev?.id === ev.id ? { ...prev, ...update } as GCalEventExt : prev)
      return null
    }

    // ── Across accounts: write it again, then take the old one away ──────────
    const isSeriesPart = !!ev.recurringEventId && !ev.recurrence?.length
    const warning = [
      `Move "${ev.summary || 'this event'}" from ${srcCal.accountEmail} to ${destCal.accountEmail}?`,
      '',
      'Google cannot move an event between accounts, so it will be written again',
      `on ${destCal.summaryOverride ?? destCal.summary} and the original deleted. It becomes a new event:`,
      `${destCal.accountEmail} organises it, and anything pointing at the old one`,
      'stops pointing anywhere.',
      ev.attendees?.length ? `Its ${ev.attendees.length} guest${ev.attendees.length === 1 ? '' : 's'} come across, but their replies do not.` : '',
      isSeriesPart ? 'This is one occurrence of a repeating event — the copy will be a one-off.' : '',
    ].filter(Boolean).join('\n')
    if (!window.confirm(warning)) return null

    const payload: GCalEventCreate = {
      summary:     ev.summary ?? '(no title)',
      description: ev.description,
      location:    ev.location,
      start:       ev.start,
      end:         ev.end,
      attendees:   ev.attendees?.map(a => ({ email: a.email })),
      reminders:   ev.reminders,
      // The rule travels with the master; a single occurrence has none, and
      // becomes what it already looks like — one event.
      recurrence:  ev.recurrence,
    }

    let created: GCalEvent | null = null
    let createError: string | null = null
    if (destCal.accountId) {
      const r = await efCreateEvent(destCal.accountId, targetCalId, payload)
      created = r.event; createError = r.error ?? null
    } else {
      const token = await refreshPrimaryToken() || destCal.accountToken
      if (!token) return `${destCal.accountEmail} needs reconnecting before anything can be written to it`
      const r = await createCalendarEventWithToken(token, targetCalId, payload)
      created = r.event; createError = r.error ?? null
    }
    if (!created) {
      return `Could not write it to ${destCal.summaryOverride ?? destCal.summary}${createError ? ` — ${createError}` : ''}. Nothing was changed.`
    }

    let deleted = false
    if (srcCal.accountId) {
      deleted = await efDeleteEvent(srcCal.accountId, ev.calendarId, ev.id)
    } else {
      const token = await refreshPrimaryToken() || srcCal.accountToken
      deleted = token ? await deleteCalendarEventWithToken(token, ev.calendarId, ev.id) : false
    }

    // The copy exists either way, so the screen has to show it either way —
    // the only question left is whether the original went with it.
    const moved: GCalEventExt = {
      ...(created as GCalEvent),
      calendarId: targetCalId,
      calendarColor: destCal.backgroundColor,
    } as GCalEventExt
    setEvents(prev => [...prev.filter(e => e.id !== ev.id && e.id !== moved.id), moved])
    setSelectedEvent(prev => (prev?.id === ev.id ? moved : prev))

    return deleted
      ? null
      : `Copied to ${destCal.summaryOverride ?? destCal.summary}, but the original could not be deleted — it is still on ${srcCal.summaryOverride ?? srcCal.summary}.`
  }

  async function handleUpdateEvent(ev: GCalEventExt, patch: Partial<GCalEventCreate>): Promise<GCalEvent | null> {
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal || !ev.calendarId) return null
    // How often something comes back is a fact about the series, not about the
    // occurrence you happened to click: Google rejects `recurrence` on an
    // occurrence, so the write goes to the series and the week is re-read
    // afterwards (every other copy on screen has just changed too).
    const toSeries = !!patch.recurrence && !!ev.recurringEventId
    const targetId = toSeries ? ev.recurringEventId! : ev.id
    let updated: GCalEvent | null = null
    if (cal.accountId) {
      const result = await efUpdateEvent(cal.accountId, ev.calendarId, targetId, patch)
      updated = result.event
      // An edit that did not stick has to say why, or the panel just snaps back.
      if (!updated && result.error) notify(`Could not save that change — ${result.error}`)
    } else {
      const token = await refreshPrimaryToken() || cal.accountToken
      if (!token) return null
      const result = await updateCalendarEvent(ev.calendarId, targetId, patch)
      updated = result.event
      if (!updated && result.error) notify(`Could not save that change — ${result.error}`)
    }
    if (updated && toSeries) {
      // The series answered, not this occurrence — keep the panel's own event
      // and pull the week again so the new pattern is what is drawn.
      const rule = updated.recurrence
      setSelectedEvent(prev => prev?.id === ev.id ? { ...prev, recurrence: rule } as GCalEventExt : prev)
      void loadEvents(weekStart, allCalendars, hiddenCals, hiddenAccounts)
      return updated
    }
    if (updated) {
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, ...updated } : e))
      setSelectedEvent(prev => prev?.id === ev.id ? { ...prev, ...updated } as GCalEventExt : prev)
      if (patch.recurrence) void loadEvents(weekStart, allCalendars, hiddenCals, hiddenAccounts)
    }
    return updated
  }

  /** The RRULE lines of the series an occurrence belongs to. */
  // An occurrence of a series carries no RRULE of its own — the rule is on the
  // series — so the panel would open on "Never" for exactly the events that do
  // repeat. Fetched once per selected event, and cleared when it changes.
  const [seriesRules, setSeriesRules] = useState<string[] | null>(null)
  useEffect(() => {
    setSeriesRules(null)
    const ev = selectedEvent as GCalEventExt | null
    if (!ev || ev.recurrence?.length || !ev.recurringEventId) return
    let live = true
    void handleLoadSeries(ev, ev.recurringEventId).then(r => { if (live) setSeriesRules(r) })
    return () => { live = false }
  }, [selectedEvent?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLoadSeries(ev: GCalEventExt, seriesId: string): Promise<string[] | null> {
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal || !ev.calendarId) return null
    try {
      if (cal.accountId) {
        const series = await efLookUpEvent(cal.accountId, ev.calendarId, seriesId)
        return series?.recurrence ?? null
      }
      const token = await refreshPrimaryToken() || cal.accountToken
      if (!token) return null
      const series = await lookUpEvent(token, ev.calendarId, seriesId)
      return series?.recurrence ?? null
    } catch { return null }
  }

  async function handleRemoveMeet(ev: GCalEventExt) {
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal || !ev.calendarId) return
    const token = cal.accountId
      ? await getGoogleToken(cal.accountEmail)
      : (await refreshPrimaryToken() || cal.accountToken)
    if (!token) return notify('Google is not connected.')
    const res = await removeMeetingFromEvent(token, ev.calendarId, ev.id)
    if (!res.ok) return notify(res.error ?? 'The call could not be removed.')
    const merged = { ...ev, conferenceData: undefined }
    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, conferenceData: undefined } : e))
    if (selectedEvent?.id === ev.id) setSelectedEvent(merged as GCalEventExt)
  }

  async function handleAddMeet(ev: GCalEventExt) {
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal || !ev.calendarId) return
    const token = cal.accountId
      ? await getGoogleToken(cal.accountEmail)
      : (await refreshPrimaryToken() || cal.accountToken)
    if (!token) return
    const updated = await addMeetingToEvent(token, ev.calendarId, ev.id)
    if (updated) {
      const merged = { ...ev, conferenceData: updated.conferenceData }
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, conferenceData: updated.conferenceData } : e))
      if (selectedEvent?.id === ev.id) setSelectedEvent(merged as GCalEventExt)
    }
  }

  const generatePrep = useCallback(async (ev: GCalEvent) => {
    setPrepLoading(true); setPrepError(null); setPrep(null)
    try {
      const result = await generateMeetingPrep({ user: buildMockUser(user), companies: MOCK_COMPANIES, event: gcalToDbEvent(ev) })
      setPrep(result)
    } catch (err) { setPrepError(err instanceof Error ? err.message : 'Could not generate prep.') }
    finally { setPrepLoading(false) }
  }, [user])

  // ── DnD handlers ────────────────────────────────────────────────────────────
  function handleDragStart({ active }: DragStartEvent) {
    setSelectedEvent(null)
    const id = active.id as string
    if (id.startsWith('resize-top:')) {
      const ev = events.find(e => e.id === id.replace('resize-top:', '')) as GCalEventExt | undefined
      setDraggingEvt(ev ?? null); setDragMode('resize-top')
    } else if (id.startsWith('resize-bottom:')) {
      const ev = events.find(e => e.id === id.replace('resize-bottom:', '')) as GCalEventExt | undefined
      setDraggingEvt(ev ?? null); setDragMode('resize-bottom')
    } else {
      const ev = events.find(e => e.id === id) as GCalEventExt | undefined
      setDraggingEvt(ev ?? null); setDragMode('move')
    }
  }

  function applyOptimisticUpdate(eventId: string, newStart: Date, newEnd: Date) {
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e
      return {
        ...e,
        start: { ...e.start, dateTime: newStart.toISOString() },
        end:   { ...e.end,   dateTime: newEnd.toISOString() },
      }
    }))
  }

  function revertOptimisticUpdate(eventId: string, origStart: string, origEnd: string) {
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e
      return { ...e, start: { ...e.start, dateTime: origStart }, end: { ...e.end, dateTime: origEnd } }
    }))
  }

  async function handleDragEnd({ active, over, delta }: DragEndEvent) {
    const mode = dragMode
    setDraggingEvt(null); setDragMode(null)
    const id = active.id as string

    if (mode === 'resize-bottom') {
      const eventId = id.replace('resize-bottom:', '')
      const ev      = events.find(e => e.id === eventId) as GCalEventExt | undefined
      if (!ev?.end.dateTime || !ev.start.dateTime) return
      const dm  = snapMinutes(delta.y)
      if (dm === 0) return
      const start  = new Date(ev.start.dateTime)
      const newEnd = new Date(ev.end.dateTime)
      newEnd.setMinutes(newEnd.getMinutes() + dm)
      if (newEnd.getTime() - start.getTime() < 15 * 60000) return
      const cal = allCalendars.find(c => c.id === ev.calendarId)
      if (!cal) return
      rememberTimes(ev, `Resized "${ev.summary ?? 'an event'}"`)
      applyOptimisticUpdate(eventId, start, newEnd)
      const ok = await updateCalendarEventTimes(cal.accountToken, ev.calendarId!, eventId, start, newEnd)
      if (!ok) revertOptimisticUpdate(eventId, ev.start.dateTime, ev.end.dateTime)
      return
    }

    if (mode === 'resize-top') {
      const eventId  = id.replace('resize-top:', '')
      const ev       = events.find(e => e.id === eventId) as GCalEventExt | undefined
      if (!ev?.start.dateTime || !ev.end.dateTime) return
      const dm       = snapMinutes(delta.y)
      if (dm === 0) return
      const newStart = new Date(ev.start.dateTime)
      newStart.setMinutes(newStart.getMinutes() + dm)
      const end      = new Date(ev.end.dateTime)
      if (end.getTime() - newStart.getTime() < 15 * 60000) return
      const cal = allCalendars.find(c => c.id === ev.calendarId)
      if (!cal) return
      rememberTimes(ev, `Resized "${ev.summary ?? 'an event'}"`)
      applyOptimisticUpdate(eventId, newStart, end)
      const ok = await updateCalendarEventTimes(cal.accountToken, ev.calendarId!, eventId, newStart, end)
      if (!ok) revertOptimisticUpdate(eventId, ev.start.dateTime, ev.end.dateTime)
      return
    }

    // move
    if (!over) return
    const overId = over.id as string
    if (!overId.startsWith('col-')) return
    const ev = events.find(e => e.id === id) as GCalEventExt | undefined
    if (!ev?.start.dateTime) return

    const [yr, mo, dy] = overId.replace('col-', '').split('-').map(Number)
    const origStart    = new Date(ev.start.dateTime)
    const origEnd      = ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(origStart.getTime() + 3600000)
    const duration     = origEnd.getTime() - origStart.getTime()
    const dm           = snapMinutes(delta.y)

    const newStart = new Date(origStart)
    newStart.setFullYear(yr, mo - 1, dy)
    newStart.setMinutes(newStart.getMinutes() + dm)
    const newEnd = new Date(newStart.getTime() + duration)

    if (newStart.getTime() === origStart.getTime()) return
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal) return

    rememberTimes(ev, `Moved "${ev.summary ?? 'an event'}"`)

    // Optimistic update — instant UI feedback
    applyOptimisticUpdate(id, newStart, newEnd)

    const ok = await updateCalendarEventTimes(cal.accountToken, ev.calendarId!, id, newStart, newEnd)
    if (!ok) revertOptimisticUpdate(id, ev.start.dateTime, ev.end.dateTime ?? origEnd.toISOString())
  }

  // ── Week navigation ──────────────────────────────────────────────────────────
  // Week draws all seven; day draws only the focused one, through the same grid.
  const weekDays = calView === 'day'
    ? [new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())]
    : Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d })

  // Month view lays out whole weeks, Sunday-first, so the grid stays rectangular
  const monthCells = useMemo(() => {
    const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
    const start = getWeekStart(first, firstDow)
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d })
  }, [anchorDate, firstDow])
  // Filter out block-events for rules with hideBlocked=true (or global originalsOnly).
  // Uses two paths: localStorage map (fast) + description marker (cross-device, no Apply needed).
  const displayedEvents = (() => {
    const rules = loadBlockingRules().filter(r => r.enabled && (r.hideBlocked || originalsOnly))
    if (!rules.length) return events

    const activeRuleIds = new Set(rules.map(r => r.id))
    const BPA_BLOCK_RE  = /\[bpa-block:([^:\]]+):([^\]]+)\]/

    // Secondary: localStorage map (fast path, no parsing)
    const applied = loadApplied()
    const hiddenByStorage = new Set<string>()
    for (const rule of rules) {
      const ruleApplied = applied[rule.id] ?? {}
      for (const targetId of Object.values(ruleApplied)) hiddenByStorage.add(targetId)
    }

    const backfill: AppliedBlocksMap = {}

    const result = events.filter(e => {
      // Fast path: already known from localStorage
      if (hiddenByStorage.has(e.id)) return false

      // Marker path: parse the bpa-block tag embedded in the event description.
      // Works cross-device and before "Apply Rules" is ever clicked.
      const match = BPA_BLOCK_RE.exec(e.description ?? '')
      if (match) {
        const [, ruleId, sourceEventId] = match
        if (activeRuleIds.has(ruleId)) {
          if (!backfill[ruleId]) backfill[ruleId] = {}
          backfill[ruleId][sourceEventId] = e.id
          return false
        }
      }
      return true
    })

    // Back-fill localStorage so future renders use the fast path
    if (Object.keys(backfill).length > 0) {
      const merged = loadApplied()
      for (const [ruleId, entries] of Object.entries(backfill)) {
        merged[ruleId] = { ...(merged[ruleId] ?? {}), ...entries }
      }
      saveApplied(merged)
    }

    return result
  })()
  const grouped  = groupByDay(displayedEvents)
  const today    = localDateStr(new Date())

  // ── Where the grid opens ────────────────────────────────────────────────────
  //
  // It used to open at 07:00 always, which quietly hid anything earlier: a task
  // blocked at 04:00 was on the calendar, drawn, and above the fold — so the
  // honest reading of the screen was "it never got scheduled". The grid opens
  // at the earliest thing on show instead, and only falls back to 07:00 when
  // nothing starts before it.
  const earliestHour = (() => {
    let earliest = 7
    for (const day of weekDays) {
      for (const ev of grouped.get(localDateStr(day)) ?? []) {
        if (!ev.start.dateTime) continue
        const d = new Date(ev.start.dateTime)
        earliest = Math.min(earliest, d.getHours() + d.getMinutes() / 60)
      }
    }
    return Math.max(0, earliest)
  })()
  useEffect(() => {
    if (!gridRef.current) return
    // Once per day-range: re-running on every event change would yank the grid
    // back while you are reading it.
    const key = `${weekDays[0] ? localDateStr(weekDays[0]) : ''}|${calView}|${earliestHour}`
    if (scrolledFor.current === key) return
    scrolledFor.current = key
    gridRef.current.scrollTo({ top: Math.max(0, (earliestHour - 0.25) * HOUR_PX), behavior: 'smooth' })
  }, [earliestHour, calView, weekDays])
  // Day view speaks for the day on show; a week speaks for today, when today is
  // one of its days. Any other week has no single day to report.
  const weatherDay = calView === 'day'
    ? localDateStr(anchorDate)
    : weekDays.some(d => localDateStr(d) === today) ? today : ''
  const [nowPx,  setNowPx] = useState(nowTopPx())
  useEffect(() => {
    const t = setInterval(() => setNowPx(nowTopPx()), 60000)
    return () => clearInterval(t)
  }, [])

  function closePopup() { setSelectedEvent(null) }

  async function handleCreateEvent(data: NewEventData) {
    setNewEventDraft(null)
    const tz     = Intl.DateTimeFormat().resolvedOptions().timeZone
    const cal    = allCalendars.find(c => c.id === data.calId)
    const tempId = `temp-${Date.now()}`

    const startIso = data.allDay ? data.startDate : `${data.startDate}T${data.startTime}:00`
    const endIso   = data.allDay ? data.endDate   : `${data.endDate}T${data.endTime}:00`

    // Optimistic add
    setEvents(prev => [...prev, {
      id: tempId, summary: data.title,
      start: data.allDay ? { date: data.startDate } : { dateTime: startIso },
      end:   data.allDay ? { date: data.endDate }   : { dateTime: endIso },
      calendarId: data.calId, calendarColor: cal ? calEffectiveColor(cal) : 'var(--sb-info)',
    } as GCalEventExt])

    const eventBody: GCalEventCreate = {
      summary:  data.title,
      start:    data.allDay ? { date: data.startDate }      : { dateTime: startIso, timeZone: tz },
      end:      data.allDay ? { date: data.endDate }        : { dateTime: endIso,   timeZone: tz },
      ...(data.location    && { location:    data.location }),
      ...(data.description && { description: data.description }),
      ...(data.invitees.length && {
        attendees: data.invitees.map(a => ({ email: a.email, ...(a.optional ? { optional: true } : {}) })),
      }),
      ...(data.recurrence?.length && { recurrence: data.recurrence }),
      ...(data.visibility && data.visibility !== 'default' && { visibility: data.visibility }),
      ...(data.addMeet && {
        conferenceData: {
          createRequest: {
            requestId: `bpa-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' as const },
          },
        },
      }),
    }

    const { event: created } = await createCalendarEventWithToken(
      cal?.accountToken ?? '', data.calId, eventBody,
    )
    if (created) {
      setEvents(prev => prev.map(e => e.id === tempId
        ? { ...created, calendarId: data.calId, calendarColor: cal ? calEffectiveColor(cal) : undefined } as GCalEventExt
        : e
      ))
      if (data.status && created.id) toggleStatus(created.id, data.status)
    } else {
      setEvents(prev => prev.filter(e => e.id !== tempId))
    }
  }

  // ── Apply blocking rules ─────────────────────────────────────────────────────
  async function handleApplyRules() {
    const rules = loadBlockingRules().filter(r => r.enabled)
    if (!rules.length) { setRulesResult('No enabled rules configured.'); setTimeout(() => setRulesResult(null), 3000); return }
    setApplyingRules(true); setRulesResult(null)
    try {
      // Convert current week's events to SourceEvent format
      const sourceEvents: SourceEvent[] = (events as GCalEventExt[])
        .filter(e => e.calendarId && e.id)
        .map(e => ({
          id:          e.id,
          calendarId:  e.calendarId!,
          summary:     e.summary,
          description: e.description,
          location:    e.location,
          start:       e.start,
          end:         e.end,
        }))
      const [applyRes, removed] = await Promise.all([
        applyBlockingRules(rules, sourceEvents),
        cleanupStaleBlocks(rules, sourceEvents),
      ])
      const msg = [
        applyRes.created  ? `${applyRes.created} block${applyRes.created > 1 ? 's' : ''} created` : '',
        removed           ? `${removed} stale removed` : '',
        applyRes.skipped  ? `${applyRes.skipped} skipped` : '',
        applyRes.failed   ? `${applyRes.failed} failed` : '',
      ].filter(Boolean).join(' · ') || 'All up to date'
      setRulesResult(msg)
    } catch (err) {
      setRulesResult(`Error: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setApplyingRules(false)
      setTimeout(() => setRulesResult(null), 5000)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={creatingEvt ? 'cal-grid-creating' : undefined} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--sb-page)', color: 'var(--sb-ink-1)', fontFamily: SANS, overflow: 'hidden' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 26px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Which stretch of time you are looking at */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 3 }}>
              {calView === 'month' ? anchorDate.toLocaleDateString('en-GB', { year: 'numeric' })
                : calView === 'day' ? anchorDate.toLocaleDateString('en-GB', { weekday: 'long' })
                : `Week ${getWeekNumber(weekStart)}`}
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 'var(--sb-t-h1)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--sb-ink-1)' }}>
              {calView === 'month' ? anchorDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                : calView === 'day' ? anchorDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
                : fmtWeekRange(weekStart)}
            </div>
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 5 }}>
              {(() => {
                const scope = calView === 'month' ? monthCells : weekDays
                const keys = new Set(scope.map(localDateStr))
                const inScope = displayedEvents.filter(e => keys.has((e.start?.dateTime ?? e.start?.date ?? '').slice(0, 10)))
                const meetings = inScope.filter(e => (e.attendees?.length ?? 0) > 1).length
                return `${inScope.length} event${inScope.length === 1 ? '' : 's'} · ${meetings} meeting${meetings === 1 ? '' : 's'}`
              })()}
            </div>
          </div>

          {/* Step through time, and come back to now */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, alignSelf: 'center' }}>
            <button
              onClick={() => setAnchorDate(d => {
                const n = new Date(d)
                if (calView === 'day') n.setDate(n.getDate() - 1)
                else if (calView === 'month') n.setMonth(n.getMonth() - 1)
                else n.setDate(n.getDate() - 7)
                return n
              })}
              style={{ ...CAL_ICON_BTN }}><ChevronLeft size={ICON.md} /></button>
            <button
              onClick={() => setAnchorDate(d => {
                const n = new Date(d)
                if (calView === 'day') n.setDate(n.getDate() + 1)
                else if (calView === 'month') n.setMonth(n.getMonth() + 1)
                else n.setDate(n.getDate() + 7)
                return n
              })}
              style={{ ...CAL_ICON_BTN }}><ChevronRight size={ICON.md} /></button>
            {!isThisWeek(weekStart) && (
              <Button variant="secondary" size="sm" onClick={() => setAnchorDate(new Date())}>Today</Button>
            )}
          </div>

          <span style={{ flex: 1 }} />

          {/* Keep the tools that have no home in the design, quietly */}
          <button
            onClick={async () => {
              if (refreshing) return
              setRefreshing(true)
              Object.keys(localStorage).filter(k => k.startsWith(EVENTS_CACHE_PREFIX)).forEach(k => localStorage.removeItem(k))
              setLoadingEvents(true)
              try {
                const c = await reloadCalendars()
                if (c) await loadEvents(weekStart, c, hiddenCals)
              } finally { setRefreshing(false) }
            }}
            disabled={refreshing}
            title="Refresh"
            style={{ ...CAL_ICON_BTN, cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1 }}
          ><RefreshCw size={ICON.sm} style={{ animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }} /></button>

          <button
            onClick={() => void handleApplyRules()}
            disabled={applyingRules}
            title={applyingRules ? 'Applying rules…' : 'Apply productivity blocking rules'}
            style={{ ...CAL_ICON_BTN, cursor: applyingRules ? 'default' : 'pointer', opacity: applyingRules ? 0.6 : 1 }}
          ><Shield size={ICON.sm} /></button>

          <button
            onClick={() => setOriginalsOnly(v => !v)}
            title={originalsOnly ? 'Showing originals only — click to show all events' : 'Show originals only (hide created blocks)'}
            style={{
              ...CAL_ICON_BTN,
              background: originalsOnly ? 'var(--sb-ink-1)' : 'var(--sb-card)',
              borderColor: originalsOnly ? 'var(--sb-ink-1)' : 'var(--sb-border)',
              color: originalsOnly ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
            }}
          >{originalsOnly ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}</button>

          {/* Calendars */}
          <button
            onClick={() => {
              const next = !showCalendars
              setShowCalendars(next)
              try { localStorage.setItem('cal-show-calendars', String(next)) } catch { /* noop */ }
            }}
            title={showCalendars ? 'Hide calendars list' : 'Show calendars list'}
            style={{
              ...CAL_PILL,
              background: showCalendars ? 'var(--sb-ink-1)' : 'var(--sb-card)',
              border: `var(--sb-border-width) solid ${showCalendars ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
              color: showCalendars ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-1)',
            }}
          >
            <Layers size={ICON.sm} strokeWidth={STROKE.rest} />
            Calendars
            <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ transform: showCalendars ? 'rotate(180deg)' : 'none', transition: 'transform .14s' }} />
          </button>

          {/* Day · Week · Month */}
          <Segmented
            size="lg"
            aria-label="Calendar range"
            value={calView}
            onChange={v => { setCalView(v); try { localStorage.setItem('cal-view', v) } catch { /* noop */ } }}
            options={[
              { value: 'day' as const,   label: 'Day' },
              { value: 'week' as const,  label: 'Week' },
              { value: 'month' as const, label: 'Month' },
            ]}
          />

          {/* The one deliberate way in, now that a bare click on the grid does
              nothing. Drawing a span on the grid is the other; a finger cannot
              draw, so on a touch screen this is the only one. */}
          <button
            onClick={() => {
              const d = localDateStr(calView === 'month' ? anchorDate : (weekDays.find(x => localDateStr(x) === today) ?? anchorDate))
              const nextHour = Math.min(23, new Date().getHours() + 1) * 60
              setSelectedEvent(null)
              setNewEventDraft({ dateStr: d, startMin: nextHour, endMin: nextHour + 60, anchorX: 0, anchorY: 0 })
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
              height: 'var(--sb-h-nav)', padding: '0 14px', borderRadius: 'var(--sb-r-pill)',
              background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 'var(--sb-t-body-s)', fontWeight: 700,
            }}>
            <Plus size={ICON.sm} strokeWidth={STROKE.active} /> New event
          </button>
        </div>

        {/* Rules result toast */}
        {rulesResult && (
          <span style={{ display: 'block', marginTop: 8, fontSize: 'var(--sb-t-meta)', color: rulesResult.startsWith('Error') ? 'var(--sb-negative)' : 'var(--sb-positive)' }}>
            {rulesResult}
          </span>
        )}

        {/* An account the app cannot reach takes its whole calendar with it, so
            it says so on the page rather than in a badge inside a dropdown. */}
        {reconnectNeeded.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
            padding: '10px 14px', borderRadius: 'var(--sb-r-nav)',
            background: 'rgba(var(--sb-accent-rgb),0.20)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.65)',
          }}>
            <AlertCircle size={ICON.md} color="var(--sb-accent-deep)" style={{ flexShrink: 0 }} />
            <span style={{ ...T.body, flex: 1, minWidth: 0, color: 'var(--sb-ink-2)' }}>
              {reconnectNeeded.length === 1
                ? `${reconnectNeeded[0]} needs reconnecting — its events are missing from this grid.`
                : `${reconnectNeeded.length} accounts need reconnecting — their events are missing from this grid.`}
            </span>
            {reconnectNeeded.map(email => (
              <Button variant="primary" key={email} onClick={() => void connectAdditionalGoogleAccount(email)} style={{ ...T.body, flexShrink: 0 }}>
                Reconnect{reconnectNeeded.length > 1 ? ` ${email.split('@')[0]}` : ''}
              </Button>
            ))}
          </div>
        )}

        {/* Calendar chips */}
        {allCalendars.length > 0 && showCalendars && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {allCalendars.filter(cal => {
              if (cal.accountId && hiddenAccounts.has(cal.accountEmail)) return false
              if (isCalendarHiddenByCompany(cal.id, cal.accountId ? cal.accountEmail : undefined)) return false
              return true
            }).map(cal => {
              const hidden  = hiddenCals.has(cal.id)
              const color   = calEffectiveColor(cal)
              const chipKey = `${cal.accountEmail}:${cal.id}`
              return (
                <div key={chipKey} style={{ position: 'relative' }}>
                  <div
                    title={cal.accountEmail}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 0,
                      borderRadius: 'var(--sb-r-card)', overflow: 'visible',
                      border: `var(--sb-border-width) solid ${hidden ? 'var(--sb-border)' : color}`,
                      background: hidden ? 'var(--sb-page)' : alpha(color, 9.4),
                      transition: 'all 0.12s',
                    }}
                  >
                    {/* Color dot — click to open picker */}
                    <button
                      onClick={e => { e.stopPropagation(); setPickerOpenId(pickerOpenId === cal.id ? null : cal.id) }}
                      title="Change color"
                      style={{
                        width: 24, height: 26, borderRadius: 'var(--sb-r-card) 0 0 var(--sb-r-card)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 'var(--sb-r-pill)', background: hidden ? 'var(--sb-border)' : color, border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)' }} />
                    </button>

                    {/* Name + eye toggle */}
                    <button
                      onClick={() => toggleCal(cal.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px 3px 2px', fontSize: 'var(--sb-t-micro)',
                        color: hidden ? 'var(--sb-ink-4)' : 'var(--sb-ink-2)',
                      }}
                    >
                      <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cal.summary}
                      </span>
                      {hidden ? <EyeOff size={ICON.sm} color="var(--sb-ink-4)" /> : <Eye size={ICON.sm} color={color} />}
                    </button>

                    {/* Subtle reconnect badge — only shown when this account needs reconnect */}
                    {reconnectNeeded.includes(cal.accountEmail) && (
                      <button
                        onClick={e => { e.stopPropagation(); void connectAdditionalGoogleAccount(cal.accountEmail) }}
                        title={`Token expired for ${cal.accountEmail} — click to reconnect`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 5px 0 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      >
                        <AlertCircle size={ICON.sm} color="var(--sb-warning)" />
                      </button>
                    )}
                  </div>

                  {/* Inline color picker */}
                  {pickerOpenId === cal.id && (
                    <ColorPickerPopover
                      current={color}
                      onPick={c => setCalColor(cal.id, c)}
                      onClose={() => setPickerOpenId(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Fetch error — keep but make subtle */}
        {fetchError && (
          <div style={{ marginTop: 6, padding: '5px 10px', background: 'color-mix(in srgb, var(--sb-negative) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 30.0%, transparent)', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-negative)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={ICON.sm} /> {fetchError}
          </div>
        )}
      </div>

      {/* ── The grid, and whatever panel is open, side by side ───────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 16, padding: '0 26px 22px', minWidth: 0 }}>

      {/* The calendar itself. An open panel takes width from here rather than
          covering it, and both start at the top of the calendar area. */}
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0, position: 'relative',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
        boxShadow: 'var(--sb-shadow-control)',
      }}>

      {/* ── Month grid ───────────────────────────────────────────────────────── */}
      {calView === 'month' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '0 14px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', padding: '10px 0 6px' }}>
            {rotateDays(DAY_LABELS, firstDow).map(d => (
              <span key={d} style={{ textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>
                {d}
              </span>
            ))}
          </div>
          <div style={{
            flex: 1, minHeight: 0, display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridAutoRows: 'minmax(96px, 1fr)',
            background: 'var(--sb-border)', gap: 1, border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', overflow: 'hidden',
          }}>
            {monthCells.map(day => {
              const ds = localDateStr(day)
              const isToday = ds === today
              const outside = day.getMonth() !== anchorDate.getMonth()
              const dayEvents = (grouped.get(ds) ?? []).slice().sort((a, b) =>
                (a.start.dateTime ?? a.start.date ?? '').localeCompare(b.start.dateTime ?? b.start.date ?? ''))
              const shown = dayEvents.slice(0, 3)
              return (
                <div
                  key={ds}
                  onClick={() => { setAnchorDate(new Date(day)); setCalView('day'); try { localStorage.setItem('cal-view', 'day') } catch { /* noop */ } }}
                  title="Open this day"
                  style={{
                    background: outside ? 'var(--sb-field)' : 'var(--sb-card)', padding: '6px 7px',
                    display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, cursor: 'pointer',
                  }}>
                  <span style={{
                    alignSelf: 'flex-start', minWidth: 21, height: 21, padding: '0 5px', borderRadius: 'var(--sb-r-pill)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: isToday ? 'var(--sb-accent)' : 'transparent',
                    // A day outside this month is lighter in weight, not in
                    // contrast: var(--sb-border) was 1.7:1, which is a date nobody can read.
                    // Today's number sits on the accent, so it takes whatever
                    // that accent carries — pale on Evergreen's green.
                    color: isToday ? 'var(--sb-accent-ink)' : outside ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
                    fontSize: 'var(--sb-t-meta)', fontWeight: isToday ? 700 : outside ? 400 : 600, fontVariantNumeric: 'tabular-nums',
                  }}>{day.getDate()}</span>
                  {shown.map(e => {
                    const cal = allCalendars.find(c => c.id === (e as GCalEventExt).calendarId)
                    const col = cal ? calEffectiveColor(cal) : 'var(--sb-info)'
                    const t = e.start.dateTime ? new Date(e.start.dateTime) : null
                    const st = eventStatuses[e.id]
                    return (
                      <span
                        key={e.id}
                        title={e.summary}
                        // The chip opens the event; only the cell around it opens the day
                        onClick={ev => { ev.stopPropagation(); setSelectedEvent(e as GCalEventExt) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
                          padding: '2px 6px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                          // Solid, like the week grid: the same tint of the
                          // calendar's colour, and its name in that colour
                          // taken down to text weight.
                          background: `color-mix(in srgb, ${col} 26%, var(--sb-card))`,
                          border: 'var(--sb-border-width) solid transparent',
                          fontSize: 'var(--sb-t-micro)', fontWeight: 700,
                          color: `color-mix(in srgb, ${col} 55%, var(--sb-ink-1))`,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                        {t && <span style={{ color: 'var(--sb-ink-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                          {String(t.getHours()).padStart(2, '0')}:{String(t.getMinutes()).padStart(2, '0')}
                        </span>}
                        {st === 'done' && <Check size={ICON.sm} strokeWidth={STROKE.active} style={{ flexShrink: 0 }} />}
                        <span style={{
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                          textDecoration: st === 'cancelled' ? 'line-through' : 'none',
                          textDecorationThickness: 1.5,
                        }}>{displayTitle(e.summary)}</span>
                      </span>
                    )
                  })}
                  {dayEvents.length > shown.length && (
                    <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>+{dayEvents.length - shown.length} more</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (

      /* ── Day / week grid ──────────────────────────────────────────────────── */
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Sticky day headers */}
          <div style={{ display: 'flex', borderBottom: 'var(--sb-border-width) solid var(--sb-border)', flexShrink: 0, background: 'var(--sb-header)' }}>
            {/* Time gutter spacer */}
            <div style={{ width: 58, flexShrink: 0 }} />
            {weekDays.map(day => {
              const ds      = localDateStr(day)
              const isToday = ds === today
              return (
                <div key={ds} style={{ flex: 1, textAlign: 'center', padding: '9px 4px 8px', minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--sb-t-micro)', color: isToday ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: SANS }}>
                    {DAY_LABELS[day.getDay()]}
                  </div>
                  <div style={{
                    fontSize: 'var(--sb-t-h2)', fontWeight: 700, lineHeight: 1.2, marginTop: 3,
                    color: isToday ? 'var(--sb-accent-ink)' : 'var(--sb-ink-1)',
                    background: isToday ? 'var(--sb-accent)' : 'transparent',
                    width: isToday ? 32 : undefined, height: isToday ? 32 : undefined,
                    borderRadius: isToday ? 'var(--sb-r-pill)' : undefined,
                    display: isToday ? 'flex' : undefined, alignItems: isToday ? 'center' : undefined, justifyContent: isToday ? 'center' : undefined,
                    margin: isToday ? '3px auto 0' : undefined,
                    fontFamily: DISPLAY,
                  }}>
                    {day.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* All-day events strip — only shown when the week has at least one all-day event */}
          {weekDays.some(day => (grouped.get(localDateStr(day)) ?? []).some(e => !e.start.dateTime)) && (
            <div style={{ display: 'flex', borderBottom: 'var(--sb-border-width) solid var(--sb-border)', flexShrink: 0, minHeight: 22 }}>
              <div style={{ width: 58, flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 6, paddingTop: 3, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', letterSpacing: '0.4px' }}>
                all day
              </div>
              {weekDays.map(day => {
                const ds = localDateStr(day)
                const allDayEvts = (grouped.get(ds) ?? []).filter(e => !e.start.dateTime)
                return (
                  <div key={ds} style={{ flex: 1, padding: '2px 2px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, borderRight: 'var(--sb-border-width) solid var(--sb-border)', maxHeight: 68, overflowY: 'auto' }}>
                    {allDayEvts.map(ev => {
                      const cal   = allCalendars.find(c => c.id === (ev as GCalEventExt).calendarId)
                      const color = cal ? calEffectiveColor(cal) : 'var(--sb-info)'
                      const evStatus = eventStatuses[ev.id]
                      return (
                        <div
                          key={ev.id}
                          onClick={e => handleEventClick(ev as GCalEventExt, e)}
                          onContextMenu={e => handleEventContextMenu(ev as GCalEventExt, e)}
                          style={{
                            fontSize: 'var(--sb-t-micro)', fontWeight: 700,
                            color: `color-mix(in srgb, ${color} 55%, var(--sb-ink-1))`,
                            background: `color-mix(in srgb, ${color} 26%, var(--sb-card))`,
                            borderLeft: `var(--sb-border-emphasis) solid ${color}`,
                            borderRadius: 'var(--sb-r-chip)', padding: '1px 4px',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                        >
                          {evStatus === 'done' && <Check size={ICON.sm} strokeWidth={STROKE.active} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 2 }} />}
                          <span style={{ textDecoration: evStatus === 'cancelled' ? 'line-through' : 'none', textDecorationThickness: 1.5 }}>
                            {displayTitle(ev.summary)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* Scrollable time grid */}
          <div ref={gridRef} onClick={closePopup}
            style={{ flex: 1, overflowY: 'auto', display: 'flex', position: 'relative', background: 'var(--sb-card)' }}
          >
            {/* Time labels column, with the weather for the day it is showing */}
            <div style={{ width: 58, flexShrink: 0, position: 'relative', height: GRID_H, background: 'var(--sb-header)', borderRight: 'var(--sb-border-width) solid var(--sb-field)' }}>
              {Array.from({ length: 24 }, (_, h) => {
                const w = weather[`${weatherDay}T${String(h).padStart(2, '0')}`]
                return (
                  <div key={h} style={{
                    position: 'absolute', top: h * HOUR_PX - 7, right: 8,
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', fontWeight: 500, letterSpacing: '0.03em' }}>
                      {fmtHourLabel(h)}
                    </span>
                    {w && (
                      <span
                        title={`${w.temp}°C`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 1,
                          fontSize: 'var(--sb-t-micro)', color: 'var(--sb-border)', fontVariantNumeric: 'tabular-nums',
                        }}>
                        <span style={{ fontSize: 'var(--sb-t-micro)', lineHeight: 1 }}>{weatherGlyph(w.code)}</span>
                        {w.temp}°
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Day columns */}
            <div style={{ flex: 1, display: 'flex', position: 'relative' }} onPointerDown={handleGridPointerDown}>
              {weekDays.map(day => {
                const ds        = localDateStr(day)
                const isToday   = ds === today
                const dayEvents = grouped.get(ds) ?? []
                const layouts   = computeOverlaps(dayEvents)

                return (
                  <DayColumn key={ds} dateStr={ds} isToday={isToday}>
                    {/* Current time indicator */}
                    {isToday && (
                      <>
                        <div style={{ position: 'absolute', top: nowPx - 4, left: -4, width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-negative)', zIndex: 5, pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', top: nowPx, left: 0, right: 0, borderTop: 'var(--sb-border-width) solid var(--sb-negative)', zIndex: 5, pointerEvents: 'none' }} />
                      </>
                    )}

                    {/* Creation ghost block */}
                    {creatingEvt?.dateStr === ds && (() => {
                      const sMin = Math.min(creatingEvt.originMin, creatingEvt.currentMin)
                      const eMin = Math.max(creatingEvt.originMin + SNAP_MIN, creatingEvt.currentMin)
                      const top  = sMin / 60 * HOUR_PX
                      const h    = Math.max(SNAP_MIN / 60 * HOUR_PX, (eMin - sMin) / 60 * HOUR_PX)
                      return (
                        <div style={{
                          position: 'absolute', top, left: '1%', right: '1%', height: h, zIndex: 10,
                          background: 'rgba(var(--sb-accent-rgb),0.35)', border: 'var(--sb-border-emphasis) solid var(--sb-accent)',
                          borderRadius: 'var(--sb-r-chip)', pointerEvents: 'none', boxSizing: 'border-box',
                        }}>
                          <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-1)', padding: '2px 5px', fontWeight: 600 }}>
                            {fmtShort(minToIso(ds, sMin))} – {fmtShort(minToIso(ds, eMin))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Events */}
                    {dayEvents.map(ev => {
                      if (!ev.start.dateTime) return null
                      const layout = layouts.get(ev.id) ?? { left: 0, width: 99 }
                      const cal    = allCalendars.find(c => c.id === (ev as GCalEventExt).calendarId)
                      return (
                        <EventBlock
                          key={ev.id}
                          event={ev}
                          layout={layout}
                          status={eventStatuses[ev.id]}
                          isSelected={selectedEvent?.id === ev.id}
                          isDragSrc={draggingEvt?.id === ev.id && dragMode === 'move'}
                          colorOverride={cal ? calEffectiveColor(cal) : undefined}
                          onStatusToggle={s => toggleStatus(ev.id, s)}
                          onClick={e => handleEventClick(ev, e)}
                          onContextMenu={e => handleEventContextMenu(ev, e)}
                        />
                      )
                    })}
                  </DayColumn>
                )
              })}
            </div>
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {draggingEvt && (dragMode === 'move') && (() => {
            const dummyLayout: EventLayout = { left: 0, width: 99 }
            const cal = allCalendars.find(c => c.id === draggingEvt.calendarId)
            return (
              <EventBlock
                event={draggingEvt}
                layout={dummyLayout}
                status={eventStatuses[draggingEvt.id]}
                isSelected={false}
                isDragSrc={false}
                isDragOverlay
                colorOverride={cal ? calEffectiveColor(cal) : undefined}
                onStatusToggle={s => toggleStatus(draggingEvt.id, s)}
                onClick={() => {}}
              />
            )
          })()}
        </DragOverlay>
      </DndContext>
      )}

      {/* Loading spinner overlay */}
      {loadingEvents && (
        <div style={{ position: 'absolute', bottom: 18, right: 22, display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', pointerEvents: 'none' }}>
          <div style={{ width: 14, height: 14, border: 'var(--sb-border-emphasis) solid var(--sb-border)', borderTopColor: 'var(--sb-ink-1)', borderRadius: 'var(--sb-r-pill)', animation: 'spin 0.7s linear infinite' }} />
          Loading…
        </div>
      )}


      {/* No auth state */}
      {noAuth && !loadingEvents && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--sb-accent-tint) 93.0%, transparent)', opacity: 0.9, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <Calendar size={36} color="var(--sb-border)" />
            <p style={{ margin: '12px 0 0', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-4)' }}>Connect Google Calendar to see your events</p>
          </div>
        </div>
      )}

      </div>

      {/* Event panel — a column of its own, beside the grid */}
      {selectedEvent && (() => {
        const ev = selectedEvent as GCalEventExt
        const cal = allCalendars.find(c => c.id === ev.calendarId)
        const allDay = !ev.start.dateTime
        const s0 = new Date(ev.start.dateTime ?? `${ev.start.date}T00:00:00`)
        const e0 = new Date(ev.end.dateTime ?? `${ev.end.date}T00:00:00`)
        const p2 = (n: number) => String(n).padStart(2, '0')
        const hhmm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
        const entry = (ev.conferenceData?.entryPoints ?? []).find(x => x.entryPointType === 'video')?.uri ?? ''

        // The rule lives on the series, not on one occurrence of it, so an
        // occurrence would have opened on "Never" for exactly the events that
        // do repeat. seriesRules is fetched when it is one.
        const rules = ev.recurrence?.length ? ev.recurrence : (seriesRules ?? undefined)

        const existing: ExistingEvent = {
          id: ev.id,
          title: ev.summary ?? '',
          calId: ev.calendarId ?? '',
          startDate: `${s0.getFullYear()}-${p2(s0.getMonth() + 1)}-${p2(s0.getDate())}`,
          startTime: allDay ? '' : hhmm(s0),
          endTime: allDay ? '' : hhmm(e0),
          allDay,
          timeZone: ev.start.timeZone,
          location: ev.location ?? '',
          meetLink: entry,
          notes: ev.description ?? '',
          invitees: (ev.attendees ?? []).map(a => ({ email: a.email, optional: a.optional, responseStatus: a.responseStatus })),
          repeat: parseRecurrence(rules),
          files: (ev.attachments ?? []).map(f => ({ name: f.title ?? 'Attachment', size: 0, kind: 'FILE' })),
          visibility: (ev.visibility as ExistingEvent['visibility']) ?? 'default',
          status: eventStatuses[ev.id] ?? null,
          htmlLink: ev.htmlLink,
        }

        return (
          <NewEventPanel
            key={ev.id}
            draft={{ dateStr: existing.startDate, startMin: 0, endMin: 0 }}
            existing={existing}
            calendars={allCalendars}
            organiser={cal?.accountEmail ?? user?.email}
            clashes={(displayedEvents as GCalEventExt[])
              .filter(o => {
                if (o.id === ev.id || !ev.start.dateTime || !ev.end.dateTime) return false
                if (!o.start.dateTime || !o.end.dateTime) return false
                return new Date(o.start.dateTime).getTime() < e0.getTime()
                    && new Date(o.end.dateTime).getTime() > s0.getTime()
              })
              .map(o => ({
                id: o.id, summary: o.summary,
                when: `${formatTime(hhmm(new Date(o.start.dateTime!)))} – ${formatTime(hhmm(new Date(o.end.dateTime!)))}`,
              }))}
            onPush={patch => void handleUpdateEvent(ev, patch as Partial<GCalEventCreate>)}
            onDelete={() => void handleDeleteEvent(ev)}
            onMoveCalendar={targetCalId => handleMoveEvent(ev, targetCalId)}
            onSave={() => { /* an event that exists writes as it is edited */ }}
            onCancel={closePopup}
            onAddMeet={() => void handleAddMeet(ev)}
            onRemoveMeet={() => void handleRemoveMeet(ev)}
            onStatus={next => {
              // toggleStatus flips; this sets. Only act when they disagree.
              const now = eventStatuses[ev.id] ?? null
              if (now === next) return
              if (now) toggleStatus(ev.id, now)
              if (next) toggleStatus(ev.id, next)
            }}
            alertMinutes={ev.reminders?.useDefault === false ? (ev.reminders.overrides?.[0]?.minutes ?? -1) : undefined}
            onAlert={v => {
              if (v === 'default') return void handleUpdateEvent(ev, { reminders: { useDefault: true } })
              if (v === 'none') return void handleUpdateEvent(ev, { reminders: { useDefault: false, overrides: [] } })
              void handleUpdateEvent(ev, { reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: v }] } })
            }}
            extra={<>
              {/* What the Professor has read about this meeting. */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>Prep</span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => void generatePrep(ev)}
                  disabled={prepLoading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, height: 'var(--sb-h-pill)',
                    padding: '0 11px', borderRadius: 'var(--sb-r-pill)', cursor: prepLoading ? 'default' : 'pointer',
                    background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                    color: 'var(--sb-ink-3)', fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
                  }}>
                  <Sparkles size={ICON.sm} /> {prepLoading ? 'Reading…' : prep ? 'Again' : 'Gather prep'}
                </button>
              </span>
              {prepError && (
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{prepError}</span>
              )}
              {prep?.contextSummary && (
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>
                  {prep.contextSummary}
                </span>
              )}
              {(prep?.talkingPoints ?? []).map((pt, i) => (
                <span key={i} style={{ display: 'flex', gap: 7, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }}>·</span>{pt}
                </span>
              ))}
              {ev.htmlLink && (
                <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 2,
                    fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', textDecoration: 'none',
                  }}>
                  Open in Google Calendar <ExternalLink size={ICON.sm} />
                </a>
              )}
            </>}
          />
        )
      })()}

      {/* The composer is the same column, in the state before the event exists. */}
      {newEventDraft && (
        <NewEventPanel
          draft={newEventDraft}
          calendars={allCalendars}
          organiser={user?.email}
          onSave={data => void handleCreateEvent(data)}
          onCancel={() => setNewEventDraft(null)}
        />
      )}

      </div>

      {/* Context menu */}
      {ctxMenu && (
        <EventContextMenu
          event={ctxMenu.event}
          pos={{ x: ctxMenu.x, y: ctxMenu.y }}
          status={eventStatuses[ctxMenu.event.id]}
          onClose={() => setCtxMenu(null)}
          onViewDetails={() => {
            setCtxMenu(null)
            setSelectedEvent(ctxMenu.event)
            setPrep(null); setPrepError(null)
          }}
          onStatusToggle={s => { toggleStatus(ctxMenu.event.id, s); setCtxMenu(null) }}
          onDelete={() => void handleDeleteEvent(ctxMenu.event)}
        />
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0%,100% { background-position: 200% 0; } 50% { background-position: -200% 0; } }
        .event-card:hover .event-actions button { opacity: 1 !important; }
        @media (hover: none) {
          .event-actions button { opacity: 1 !important; }
        }
        .cal-grid-creating, .cal-grid-creating * { cursor: crosshair !important; }
      `}</style>
    </div>
  )
}
