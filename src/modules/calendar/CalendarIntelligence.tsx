import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { CAL_COLORS } from '@/lib/palettes'
import { Button } from '@/components/ui'
import {
  ChevronLeft, ChevronRight, Layers, Calendar, Video,
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
import { uploadToDrive } from '@/lib/googleDrive'
import type { GCalEvent, GCalCalendar, GCalEventCreate } from '@/lib/googleCalendar'
import { CalendarRail, Label as CalLabel, type RailEvent } from './CalendarRail'
import { getGoogleToken, seedToken, getGoogleTokenViaSupabaseRefresh } from '@/lib/tokenManager'
import { loadEventStatuses, saveEventStatuses } from '@/lib/eventStatus'
import { isCalendarHiddenByCompany } from '@/lib/companyVisibility'
import { isTaskEvent, stripTaskMark } from '@/lib/taskEvent'
import { loadWeather, weatherGlyph, type WeatherByHour } from '@/lib/weather'
import { T, SANS, DISPLAY, MONO, ICON, STROKE } from '@/lib/type'
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

// ─── Grid constants ───────────────────────────────────────────────────────────
const HOUR_PX  = 54     // pixels per hour (Sunlit Bento: 54px/hr)
const SNAP_MIN = 15     // snap to 15-minute increments
/** How long a finger must hold still before the grid starts drawing a span
 *  rather than scrolling the day. Long enough not to fire on a flick, short
 *  enough that nobody thinks the screen ignored them. */
const HOLD_MS   = 320
/** How far it may drift inside that hold and still count as holding still. */
const HOLD_SLOP = 10

/** Stops the page scrolling while a finger is drawing a span. It is a module
 *  function rather than a closure so that whoever ends the gesture can remove
 *  the very listener that was added — `removeEventListener` matches on
 *  identity, and a fresh arrow per gesture silently never matches. */
function eatScroll(te: TouchEvent) { if (te.cancelable) te.preventDefault() }
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
  /** Drive files uploaded while composing. */
  attachments?: { fileUrl: string; fileId?: string; title?: string; mimeType?: string }[]
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
/** A 34px round white icon button. The header cluster is one line of these,
 *  so they are round rather than rounded-rect: at 34px a nav radius reads as a
 *  small box and the row looks like a toolbar again. */
const CAL_DISC: React.CSSProperties = {
  width: 'var(--sb-h-pill)', height: 'var(--sb-h-pill)', boxSizing: 'border-box',
  borderRadius: 999, flexShrink: 0, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  color: 'var(--sb-ink-2)', cursor: 'pointer',
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
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
// ─── How many days a week can honestly show ──────────────────────────────────
//
//  The week view drew seven columns whatever the room, so the columns simply
//  got narrower: 126px at 1024, 93px at 768, and **39px on a phone** — the
//  width of one letter of an event title. The grid was there, it scrolled, it
//  was drawn correctly, and it told you nothing.
//
//  Seven days is a layout, not a fact about a week. Where seven will not fit,
//  fewer are shown and the arrows step by however many are on screen, so you
//  move through the week at the rate you can read it.
const WEEK_SPANS: [number, number][] = [[1024, 7], [860, 5], [620, 3]]
const NARROW_SPAN = 2

function weekSpanFor(width: number): number {
  for (const [min, days] of WEEK_SPANS) if (width >= min) return days
  return NARROW_SPAN
}

function useWeekSpan(): number {
  const [span, setSpan] = useState(() =>
    typeof window === 'undefined' ? 7 : weekSpanFor(window.innerWidth))
  useEffect(() => {
    const read = () => setSpan(weekSpanFor(window.innerWidth))
    window.addEventListener('resize', read)
    // A rotation changes the width without always firing `resize` first.
    window.addEventListener('orientationchange', read)
    read()
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])
  return span
}

/** The span actually on screen, first day to last. `fmtWeekRange` assumed a
 *  seven-day week and would have kept naming Sunday–Saturday while three days
 *  were drawn. */
function fmtDayRange(days: Date[]): string {
  if (days.length === 0) return ''
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const a = days[0], b = days[days.length - 1]
  if (days.length === 1) return a.toLocaleDateString('en-US', opts)
  return `${a.toLocaleDateString('en-US', opts)} – ${b.toLocaleDateString('en-US', opts)}`
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
const EVENTS_CACHE_TTL    = 30 * 60 * 1000  // 30 min — 2-min auto-refresh keeps data current
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
      background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
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

  // ── P14: the theme paints the card, the data paints a rail ────────────────
  // Every event used to be filled with its own calendar's colour — 22 Google
  // hues plus a hex per company — so the screen's palette was whatever the
  // sources happened to be and the theme's accent survived only in the logo.
  // A grid of tinted blocks also says nothing: the colour is an identity, not
  // a state, and identity does not need a whole surface to carry it.
  //
  // The card is now the theme's white, and the source colour is a single 3px
  // rail down its left inner edge. Everything else a card can say — running,
  // chosen, cancelled — is said in theme tokens, so the same three states read
  // the same way whichever calendar an event happens to live on.
  const nowMs = Date.now()
  const isNow = new Date(event.start.dateTime!).getTime() <= nowMs
    && new Date(event.end.dateTime ?? event.start.dateTime!).getTime() > nowMs
  // Selected is a fill, and it beats "now": you chose it, so it is the one the
  // eye should land on even on a card that is already running.
  const inverted = isSelected
  const evBg = inverted ? 'var(--sb-ink-1)'
    : isNow ? 'var(--sb-accent-tint2)'
    : 'var(--sb-card)'
  const evInk = inverted ? 'var(--sb-ink-on-dark)'
    : isCancelled ? 'var(--sb-ink-4)'
    : 'var(--sb-ink-1)'
  const evTimeInk = inverted
    ? 'color-mix(in srgb, var(--sb-ink-on-dark) 76%, transparent)'
    : 'var(--sb-ink-4)'
  const evBorder = isTentative
    ? 'var(--sb-border-width) dashed var(--sb-border)'
    : inverted ? 'var(--sb-border-width) solid transparent'
    : 'var(--sb-border-width) solid var(--sb-border)'

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

  // How many lines the title may take is whatever is left after the rows that
  // have to fit — the time above all. It used to be a ladder of card heights
  // (78 → 4 lines, 52 → 3, else 2) which knew nothing about the rows under it,
  // so a three-line title on a one-hour card pushed "1:30 PM – 2:30 PM" half
  // out of the bottom of its own box. A title is the thing that can afford to
  // be cut; the time is the thing you came to read.
  const footRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const [footH, setFootH] = useState(0)
  const [lineH, setLineH] = useState(0)
  useEffect(() => {
    const el = footRef.current
    if (!el || typeof ResizeObserver === 'undefined') { setFootH(0); return }
    const ro = new ResizeObserver(([entry]) => setFootH(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  })
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    // The used value, in px — the token behind it is a clamp() that resolves
    // differently per theme and per viewport, so it is read rather than known.
    const lh = parseFloat(getComputedStyle(el).lineHeight)
    if (Number.isFinite(lh) && lh > 0) setLineH(prev => (prev === lh ? prev : lh))
  })

  const w = isDragOverlay ? 130 : cardW || 999
  const tiny     = height < 28
  // Wrapping needs enough width for a line to be a line. Under that, three
  // letters and an ellipsis say less than two short wrapped lines do, so the
  // floor is where a word stops fitting rather than where a card looks tidy.
  const canWrap  = w >= 52 && height >= 34
  const showTime = w >= 104 && height >= 38
  const showHost = w >= 104 && height >= 56

  const padV = tiny ? 6 : 13                       // the card's own 5px + 8px
  const room = height - padV - footH
  const titleLines = lineH > 0 && footH >= 0
    ? Math.max(1, Math.floor((room + 0.5) / lineH))
    // Before the first measurement lands, the old ladder is still the best
    // guess available — and it is what one frame will look like, not the page.
    : (height >= 78 ? 4 : height >= 52 ? 3 : 2)

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
        borderRadius: 14,
        border: evBorder,
        // The extra 6px on the left is the rail's lane: the text starts after
        // it rather than on top of it.
        padding: tiny ? '3px 6px 3px 12px' : '9px 11px 9px 14px',
        overflow: 'hidden',
        cursor: isDragOverlay ? 'grabbing' : 'pointer',
        // iOS scrolls the grid instead of dragging the event without this.
        touchAction: 'none',
        opacity: isDragSrc ? 0.35 : 1,
        transition: isDragging ? 'none' : 'box-shadow 0.12s, opacity 0.12s',
        boxSizing: 'border-box',
        zIndex: isSelected ? 4 : 2,
        // No shadow. A white card with its own border on a white grid has an
        // edge already, and a shadow under every event is what made the grid
        // read as a pile of receipts.
        boxShadow: 'none',
        userSelect: 'none',
      }}
    >
      {/* The identity rail. Full card height, the calendar's own colour at
          full opacity, and the one place on this card where a source colour is
          allowed to be drawn. A cancelled event keeps it at 40% — the event is
          still that calendar's, it is simply off. */}
      <span aria-hidden style={{
        position: 'absolute', left: 5, top: 5, bottom: 5, width: 3, borderRadius: 999,
        background: color, opacity: isCancelled ? 0.4 : 1,
      }} />

      {/* Done is a tick in front of the name; cancelled strikes the name
          through. Neither touches the card's colour — that belongs to the
          calendar the event is on, not to what happened to it. */}
      <div ref={titleRef} style={{
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
          ? { display: '-webkit-box', WebkitLineClamp: titleLines, WebkitBoxOrient: 'vertical' as const }
          : { whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' }),
      }}>
        {/* Running right now: a 6px dot in the live colour, before the name.
            It is the one thing on the grid that is true only at this minute. */}
        {isNow && !inverted && (
          <span aria-hidden style={{
            display: 'inline-block', verticalAlign: '1px', width: 6, height: 6,
            borderRadius: '50%', background: 'var(--sb-cal-live)', marginRight: 5,
          }} />
        )}
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
      {/* Everything the title must leave room for, in one box so its height can
          be measured rather than assumed. `flow-root` keeps the children's top
          margins inside it — collapsed through, the measurement would be short
          by exactly the gap it is meant to include. */}
      <div ref={footRef} style={{ display: 'flow-root' }}>
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
      </div>
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
        background: 'var(--sb-overlay)',
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

  /** The day the rail is answering for, when you pointed it at one from a
   *  month cell. Null means "whatever the range in front of you implies". */
  const [pickedDay,       setPickedDay]      = useState<string | null>(null)
  const [calView,         setCalView]        = useState<'day' | 'week' | 'month'>(() => {
    try { return (localStorage.getItem('cal-view') as 'day' | 'week' | 'month') ?? 'week' } catch { return 'week' }
  })
  const firstDow  = useWeekStart()
  const weekStart = useMemo(() => getWeekStart(anchorDate, firstDow), [anchorDate, firstDow])
  // Seven columns need seven columns' worth of room; below that the week is
  // drawn a few days at a time rather than squeezed into slivers.
  const weekSpan = useWeekSpan()
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
      // Whether the span was committed or abandoned, the page scrolls again.
      document.removeEventListener('touchmove', eatScroll)
    }
  }, [!!creatingEvt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Putting an event on the grid by hand ──────────────────────────────────
  // Press where it starts, drag to where it ends, let go. The span you draw is
  // the event: it says when it is and how long it runs, which a bare click says
  // neither of.
  //
  // With a mouse that is simply a drag, committed after 8px so a click that
  // wobbles is still a click.
  //
  // A finger is the harder case, because a vertical drag on this grid already
  // means "scroll the day", and the two gestures are identical for as long as
  // they are both just a finger moving down the screen. So touch has to say
  // which it meant before it moves: **hold still for 320ms and the grid starts
  // drawing**, and the span appearing under the finger is the confirmation
  // that it did. Move before that and it is a scroll, as it always was.
  //
  // Once drawing has started the page must stop scrolling under it, and
  // `touch-action` cannot be changed mid-gesture — the browser decided what
  // this touch was for when it began. A non-passive `touchmove` listener that
  // preventDefaults is the one thing that still works from here.
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
    const coarse = e.pointerType !== 'mouse'
    const pointerId = e.pointerId
    const surface = e.currentTarget
    let started = false
    let holdTimer: ReturnType<typeof setTimeout> | null = null

    const begin = () => {
      started = true
      cleanup()
      if (coarse) {
        document.addEventListener('touchmove', eatScroll, { passive: false })
        try { surface.setPointerCapture(pointerId) } catch { /* gesture already gone */ }
      }
      setCreatingEvt({ dateStr, originMin: dragMin, currentMin: dragMin })
      setSelectedEvent(null); setNewEventDraft(null)
    }

    const cleanup = () => {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null }
      document.removeEventListener('pointermove',   onMove)
      document.removeEventListener('pointerup',     onUp)
      document.removeEventListener('pointercancel', onCancelled)
    }
    const travelled = (ev: PointerEvent) => Math.hypot(ev.clientX - startX, ev.clientY - startY)

    // The hold is what tells a finger's drawing apart from its scrolling, and
    // it has to be answered before the finger moves — after that the browser
    // has already committed the touch to the scroller.
    if (coarse) holdTimer = setTimeout(begin, HOLD_MS)

    const onMove = (me: PointerEvent) => {
      if (started) return
      if (coarse) {
        // Moved before the hold landed: they are scrolling. Stand down and
        // leave the gesture entirely alone.
        if (travelled(me) > HOLD_SLOP) cleanup()
        return
      }
      if (travelled(me) >= 8) begin()
    }
    const onUp = (ue: PointerEvent) => {
      cleanup()
      if (started) return
      if (travelled(ue) > (coarse ? 12 : 4)) return          // a scroll, or a wobble
      // A bare tap does not create an event. Drawing a span says when it is
      // and how long it runs; a tap says neither, and a composer opening under
      // every stray click on the grid is a panel you spend the day closing.
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
    // Keep the cache alive (don't clear it before the fetch). loadAllCalendars
    // gets the current contents so it can fall back on them for unreachable accounts,
    // and saveCalIntelCache() overwrites it on success — so stale entries are only
    // visible for the brief window while the API responds.
    const cachedBefore = loadCalIntelCache()
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

  // On mount (or user change): use cached calendars to start fetching events
  // immediately, then reload the calendar list in the background. This eliminates
  // the serial waterfall where events had to wait for the full list refresh.
  useEffect(() => {
    if (!user?.email) return
    const cached = loadCalIntelCache()
    if (cached.length) {
      // Events start now using the cached list — no spinner needed.
      const fromCache = rebuildFromCache(cached)
      void loadEvents(weekStart, fromCache, hiddenCals)
    }
    // Refresh calendar list in parallel. If it returns a different set of
    // calendars (e.g. a newly added calendar), reload events with the fresh list.
    void reloadCalendars().then(fresh => {
      if (!fresh?.length) return
      const freshIds  = fresh.map(c => c.id).sort().join()
      const cachedIds = cached.map(c => c.id).sort().join()
      if (freshIds !== cachedIds) {
        // Calendar list changed — reload events with updated list
        void loadEvents(weekStart, fresh, hiddenCals)
      }
    })
  }, [user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /** A file for an event goes to the Drive of the account whose calendar it is
   *  — a connected account's own token when there is one, else yours. */
  const uploadForCalendar = (file: File, calId: string) => {
    const cal = allCalendars.find(c => c.id === calId)
    return uploadToDrive(file, cal?.accountToken || undefined)
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
  // A full week starts on the week's own first day. A shortened one starts on
  // the day you are *on* — anchoring it to Sunday would show you Sun–Tue while
  // you were looking at Friday, and the arrows would never reach the weekend.
  const weekDays = calView === 'day'
    ? [new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())]
    : Array.from({ length: weekSpan }, (_, i) => {
        const d = new Date(weekSpan >= 7 ? weekStart : anchorDate)
        d.setDate(d.getDate() + i)
        return new Date(d.getFullYear(), d.getMonth(), d.getDate())
      })

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

  // ── What the header's one sentence says ─────────────────────────────────────
  // Two readings the old "N events · N meetings" line could not give: how many
  // of them collide, and how long until the next one starts. A meeting count is
  // a fact about the list; a clash is a decision waiting to be made.
  //
  // The day the rail describes is the anchor day in day view, and today in the
  // wider views — the day you are most likely to be asking about. Both are
  // computed here so the header and the rail can never disagree.
  // A day picked in month view wins, while it is still on screen — step to
  // another month and it is no longer a day this grid is showing, so the rail
  // goes back to answering for the range in front of you.
  const inRange = (ds: string) =>
    monthCells.some(d => localDateStr(d) === ds) || weekDays.some(d => localDateStr(d) === ds)

  const railDateStr = (pickedDay && inRange(pickedDay)) ? pickedDay
    : calView === 'day' ? localDateStr(anchorDate)
    : inRange(today) ? today
    : localDateStr(calView === 'month' ? anchorDate : weekStart)

  const railEvents = useMemo<RailEvent[]>(() => {
    const list = grouped.get(railDateStr) ?? []
    return list.map(e => {
      const cal = allCalendars.find(c => c.id === (e as GCalEventExt).calendarId)
      return { event: e, tone: cal ? calEffectiveColor(cal) : undefined, own: eventStatuses[e.id] }
    })
    // grouped is rebuilt on every render, so it cannot be a dependency without
    // re-running this every frame; the date and the inputs it derives from are
    // the real signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railDateStr, displayedEvents, allCalendars, eventStatuses])

  const clashCount = useMemo(() => {
    const ms = (v?: string) => (v ? new Date(v).getTime() : 0)
    const timed = railEvents
      .filter(r => r.event.start?.dateTime && r.event.end?.dateTime)
      .sort((a, b) => ms(a.event.start.dateTime) - ms(b.event.start.dateTime))
    let n = 0
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (ms(timed[j].event.start.dateTime) < ms(timed[i].event.end.dateTime)) { n++; break }
      }
    }
    return n
  }, [railEvents])

  /** Minutes until the next event that has not started, or null when the rest
   *  of the day is empty — a "next in" that has nothing to point at is worse
   *  than saying nothing. */
  const nextInMin = useMemo(() => {
    const now = Date.now()
    const ups = railEvents
      .map(r => (r.event.start?.dateTime ? new Date(r.event.start.dateTime).getTime() : 0))
      .filter(t => t > now)
      .sort((a, b) => a - b)
    return ups.length ? Math.max(1, Math.round((ups[0] - now) / 60000)) : null
  }, [railEvents])

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
      ...(data.attachments?.length && { attachments: data.attachments }),
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
    <div className={`cal-ground${creatingEvt ? ' cal-grid-creating' : ''}`} style={{ color: 'var(--sb-ink-1)', fontFamily: SANS }}>
     <div className="cal-panel">

      {/* ── Header ──────────────────────────────────────────────────────────────
          One row, one display-size element. It used to be two stacked medium
          titles — the route's name above the month's name — plus a separate
          full-width control strip below them, which is three levels of chrome
          saying one thing and no hierarchy at all. The month is the only thing
          at display size and the strip's contents have moved into the cluster
          on the right. The route's name was an overline above it, which named
          the page you had just navigated to and were already looking at. */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '0 4px' }}>
          {/* Which stretch of time you are looking at */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="cal-display" style={{
              fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1,
              color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums',
            }}>
              {calView === 'month' ? anchorDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                : calView === 'day' ? anchorDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
                : fmtDayRange(weekDays)}
            </span>
            {/* One live sentence, not a row of labels. Anything it cannot
                honestly say, it leaves out rather than printing a zero. */}
            <span style={{ fontSize: 13, color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
              {(() => {
                const scope = calView === 'month' ? monthCells : weekDays
                const keys = new Set(scope.map(localDateStr))
                const inScope = displayedEvents.filter(e => keys.has((e.start?.dateTime ?? e.start?.date ?? '').slice(0, 10)))
                const bits = [`${inScope.length} event${inScope.length === 1 ? '' : 's'}`]
                if (clashCount > 0) bits.push(`${clashCount} clash${clashCount === 1 ? '' : 'es'}`)
                if (nextInMin !== null) {
                  bits.push(nextInMin < 60
                    ? `next in ${nextInMin} min`
                    : `next in ${Math.round(nextInMin / 60)}h`)
                }
                return bits.join(' · ')
              })()}
            </span>
          </div>

          {/* ── Control cluster ────────────────────────────────────────────────
              Everything that was a full-width strip below the titles, on one
              34px line at the header's right. Order is the order you reach for
              them: what you are looking at, then where, then making one. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', flexShrink: 0 }}>

            {/* The tools with no home in the concept, kept as quiet discs. */}
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
              className="cal-ctl"
              style={{ ...CAL_DISC, cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1 }}
            ><RefreshCw size={ICON.sm} strokeWidth={STROKE.rest} style={{ animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }} /></button>

            <button
              onClick={() => void handleApplyRules()}
              disabled={applyingRules}
              title={applyingRules ? 'Applying rules…' : 'Apply productivity blocking rules'}
              className="cal-ctl"
              style={{ ...CAL_DISC, cursor: applyingRules ? 'default' : 'pointer', opacity: applyingRules ? 0.6 : 1 }}
            ><Shield size={ICON.sm} strokeWidth={STROKE.rest} /></button>

            <button
              onClick={() => setOriginalsOnly(v => !v)}
              title={originalsOnly ? 'Showing originals only — click to show all events' : 'Show originals only (hide created blocks)'}
              className={`cal-ctl${originalsOnly ? ' cal-ctl-ink' : ''}`}
              style={{
                ...CAL_DISC,
                background: originalsOnly ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                borderColor: originalsOnly ? 'var(--sb-ink-1)' : 'var(--sb-border)',
                color: originalsOnly ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-2)',
              }}
            >{originalsOnly ? <EyeOff size={ICON.sm} strokeWidth={STROKE.rest} /> : <Eye size={ICON.sm} strokeWidth={STROKE.rest} />}</button>

            <button
              onClick={() => {
                const next = !showCalendars
                setShowCalendars(next)
                try { localStorage.setItem('cal-show-calendars', String(next)) } catch { /* noop */ }
              }}
              title={showCalendars ? 'Hide calendars list' : 'Show calendars list'}
              className={`cal-ctl${showCalendars ? ' cal-ctl-ink' : ''}`}
              style={{
                ...CAL_DISC,
                background: showCalendars ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                borderColor: showCalendars ? 'var(--sb-ink-1)' : 'var(--sb-border)',
                color: showCalendars ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-2)',
              }}
            ><Layers size={ICON.sm} strokeWidth={STROKE.rest} /></button>

            {/* Month · Week · Day as ONE pill group, not three buttons and not
                a stacked nav: the three are one answer to one question, so they
                share one container and the chosen one is an ink pill inside it. */}
            <div role="tablist" aria-label="Calendar range" style={{
              display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
              height: 'var(--sb-h-pill)', boxSizing: 'border-box', padding: 3, borderRadius: 999,
              background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
            }}>
              {([['month', 'Month'], ['week', 'Week'], ['day', 'Day']] as const).map(([v, label]) => {
                const on = calView === v
                return (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={on}
                    onClick={() => { setCalView(v); try { localStorage.setItem('cal-view', v) } catch { /* noop */ } }}
                    className={`cal-ctl${on ? ' cal-ctl-ink' : ''}`}
                    style={{
                      height: '100%', padding: '0 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
                      background: on ? 'var(--sb-ink-1)' : 'transparent',
                      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-2)',
                      fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                    }}>{label}</button>
                )
              })}
            </div>

            <span aria-hidden style={{ width: 1, height: 22, background: 'var(--sb-border)', flexShrink: 0 }} />

            {/* Step through time, and come back to now */}
            <button
              title="Previous"
              aria-label="Previous"
              className="cal-ctl"
              onClick={() => setAnchorDate(d => {
                const n = new Date(d)
                if (calView === 'day') n.setDate(n.getDate() - 1)
                else if (calView === 'month') n.setMonth(n.getMonth() - 1)
                // Step by what is drawn, or three-day weeks would jump a full
                // seven and skip the days in between entirely.
                else n.setDate(n.getDate() - weekSpan)
                return n
              })}
              style={CAL_DISC}><ChevronLeft size={ICON.md} strokeWidth={STROKE.rest} /></button>
            <button
              onClick={() => setAnchorDate(new Date())}
              className="cal-ctl"
              title="Back to today"
              style={{
                height: 'var(--sb-h-pill)', boxSizing: 'border-box', padding: '0 14px', borderRadius: 999, flexShrink: 0,
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-1)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}>Today</button>
            <button
              title="Next"
              aria-label="Next"
              className="cal-ctl"
              onClick={() => setAnchorDate(d => {
                const n = new Date(d)
                if (calView === 'day') n.setDate(n.getDate() + 1)
                else if (calView === 'month') n.setMonth(n.getMonth() + 1)
                else n.setDate(n.getDate() + weekSpan)
                return n
              })}
              style={CAL_DISC}><ChevronRight size={ICON.md} strokeWidth={STROKE.rest} /></button>

            {/* The one deliberate way in, now that a bare click on the grid does
                nothing. Drawing a span on the grid is the other; a finger cannot
                draw, so on a touch screen this is the only one. */}
            <button
              className="cal-ctl cal-ctl-ink"
              onClick={() => {
                const d = localDateStr(calView === 'month' ? anchorDate : (weekDays.find(x => localDateStr(x) === today) ?? anchorDate))
                const nextHour = Math.min(23, new Date().getHours() + 1) * 60
                setSelectedEvent(null)
                setNewEventDraft({ dateStr: d, startMin: nextHour, endMin: nextHour + 60, anchorX: 0, anchorY: 0 })
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
                height: 'var(--sb-h-pill)', boxSizing: 'border-box', padding: '0 16px', borderRadius: 999,
                background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
              }}>
              <Plus size={15} strokeWidth={STROKE.active} /> New event
            </button>
          </div>
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
                    // P14: the key is a key, not twenty-two coloured chips. A
                    // tint and a border per calendar put every source colour on
                    // screen at once, at chip size, which is exactly the noise
                    // demoting the cards to a rail was meant to remove. The dot
                    // is the second and last place a source colour appears.
                    style={{
                      display: 'flex', alignItems: 'center', gap: 0, height: 22,
                      borderRadius: 999, overflow: 'visible',
                      border: 'var(--sb-border-width) solid var(--sb-border)',
                      background: 'var(--sb-card)',
                      opacity: hidden ? 0.55 : 1,
                      transition: 'opacity 0.12s, background 0.12s',
                    }}
                  >
                    {/* Color dot — click to open picker */}
                    <button
                      onClick={e => { e.stopPropagation(); setPickerOpenId(pickerOpenId === cal.id ? null : cal.id) }}
                      title="Change color"
                      style={{
                        width: 22, height: 20, borderRadius: '999px 0 0 999px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: hidden ? 'var(--sb-border)' : color }} />
                    </button>

                    {/* Name + eye toggle */}
                    <button
                      onClick={() => toggleCal(cal.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '0 9px 0 2px', fontSize: 12.5, fontFamily: 'inherit',
                        color: hidden ? 'var(--sb-ink-4)' : 'var(--sb-ink-2)',
                      }}
                    >
                      <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cal.summary}
                      </span>
                      {/* The eye takes the theme's ink, not the calendar's hue:
                          a glyph tinted per source is a third place data colour
                          would be drawn. */}
                      {hidden
                        ? <EyeOff size={ICON.sm} strokeWidth={STROKE.rest} color="var(--sb-ink-4)" />
                        : <Eye size={ICON.sm} strokeWidth={STROKE.rest} color="var(--sb-ink-2)" />}
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

      {/* ── The view, and the day rail beside it ──────────────────────────────
          Two columns: what is on, and where it stands. An open event panel
          takes the rail's column rather than covering the grid — the same
          spatial contract the task panel has beside its board, and the reason
          the rail is 324px rather than something the panel has to match. */}
      <div className="cal-body" data-panel={(selectedEvent || newEventDraft) ? '1' : undefined}>

      {/* The calendar itself. In month view it is the panel's own ground
          showing between tiles, so it carries no surface of its own; in the
          time views it is one white card, because an hour grid drawn on cream
          has nothing to separate its rows from the panel. */}
      {/* `minHeight` lives in `.cal-col`, not here: inline wins over any
          stylesheet rule, and the stacked layout below 1180px has to raise it
          off zero or the whole grid collapses to its own header. */}
      <div className="cal-col" style={{
        minWidth: 0, position: 'relative', alignSelf: 'stretch',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: calView === 'month' ? 'transparent' : 'var(--sb-card)',
        borderRadius: calView === 'month' ? 0 : 22,
      }}>

      {/* ── Month grid ─────────────────────────────────────────────────────────
          Seven columns of separate rounded tiles on the panel's cream, not a
          bordered table. The old grid drew its lines by painting the container
          --sb-border and leaving 1px gaps, which is a hairline table however it
          is built: at 1px the ground reads as a rule rather than as space, and
          every cell shared its neighbour's edge. The gutter is 8px now and the
          cells own their corners. */}
      {calView === 'month' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div className="cal-weekhead">
            {rotateDays(DAY_LABELS, firstDow).map(d => (
              // Left-aligned, because the date under it is: a centred column
              // header over a left-aligned column is two alignments in one grid.
              <CalLabel key={d}>{d}</CalLabel>
            ))}
          </div>
          <div className="cal-month-grid">
            {monthCells.map(day => {
              const ds = localDateStr(day)
              const isToday = ds === today
              const picked  = ds === railDateStr && !isToday
              const outside = day.getMonth() !== anchorDate.getMonth()
              const dayEvents = (grouped.get(ds) ?? []).slice().sort((a, b) =>
                (a.start.dateTime ?? a.start.date ?? '').localeCompare(b.start.dateTime ?? b.start.date ?? ''))
              const shown = dayEvents.slice(0, 3)
              return (
                <div
                  key={ds}
                  className="cal-cell"
                  data-empty={dayEvents.length === 0 ? '1' : undefined}
                  onClick={() => { setAnchorDate(new Date(day)); setCalView('day'); try { localStorage.setItem('cal-view', 'day') } catch { /* noop */ } }}
                  title="Open this day"
                  style={{
                    background: picked ? 'var(--sb-accent-tint2)' : outside ? 'var(--sb-field)' : 'var(--sb-card)',
                    borderRadius: 18, padding: 11, minWidth: 0, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 7, overflow: 'hidden',
                  }}>
                  {/* Today is an ink disc, not an accent pill: the accent is the
                      theme's, and a date is not a state to be warned about. */}
                  <span style={{
                    alignSelf: 'flex-start', width: isToday ? 26 : 'auto', height: isToday ? 26 : 'auto',
                    borderRadius: isToday ? '50%' : 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: isToday ? 'var(--sb-ink-1)' : 'transparent',
                    color: isToday ? 'var(--sb-ink-on-dark)' : outside ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
                    fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{day.getDate()}</span>

                  {shown.map(e => {
                    const cal = allCalendars.find(c => c.id === (e as GCalEventExt).calendarId)
                    const col = cal ? calEffectiveColor(cal) : undefined
                    const t = e.start.dateTime ? new Date(e.start.dateTime) : null
                    const st = eventStatuses[e.id]
                    return (
                      <span
                        key={e.id}
                        title={e.summary}
                        // The chip opens the event; only the cell around it opens the day
                        onClick={ev => { ev.stopPropagation(); setSelectedEvent(e as GCalEventExt) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, position: 'relative',
                          padding: '5px 7px 5px 9px', borderRadius: 10, cursor: 'pointer',
                          // P14: the theme paints the chip. Its calendar's own
                          // colour is the 3px rail and nothing else — a tinted
                          // fill per calendar is what drowned the accent.
                          background: 'var(--sb-field)',
                          fontSize: 11.5, fontWeight: 600,
                          color: st === 'cancelled' ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                        <span aria-hidden style={{
                          position: 'absolute', left: 3, top: 4, bottom: 4, width: 3, borderRadius: 999,
                          background: col ?? 'var(--sb-border)', opacity: st === 'cancelled' ? 0.4 : 1,
                        }} />
                        {/* A time on every chip in a busy cell is four numbers
                            competing with four titles; it earns its place only
                            where the cell is quiet enough to read. */}
                        {t && shown.length <= 2 && (
                          <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--sb-ink-4)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {String(t.getHours()).padStart(2, '0')}:{String(t.getMinutes()).padStart(2, '0')}
                          </span>
                        )}
                        {st === 'done' && <Check size={11} strokeWidth={STROKE.active} style={{ flexShrink: 0, color: 'var(--sb-positive-deep)' }} />}
                        <span style={{
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                          textDecoration: st === 'cancelled' ? 'line-through' : 'none',
                          textDecorationThickness: 1.5,
                        }}>{displayTitle(e.summary)}</span>
                      </span>
                    )
                  })}

                  {dayEvents.length > shown.length && (
                    <button
                      type="button"
                      // Points the day rail at this day rather than opening a
                      // popover: the rail already answers "what is on this day"
                      // in full, and a second floating answer beside it is one
                      // more thing to close.
                      onClick={ev => { ev.stopPropagation(); setPickedDay(ds) }}
                      style={{
                        alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent',
                        cursor: 'pointer', fontFamily: MONO, fontSize: 10.5, fontWeight: 500,
                        letterSpacing: '.06em', color: 'var(--sb-accent-deep)',
                      }}>+{dayEvents.length - shown.length} more</button>
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
                  {/* The weekday is the panel's one label voice — mono, capsed,
                      gold when it is the day you are on. It used to be a
                      sentence-case 13px run in the generic secondary grey,
                      which is the chrome the rest of the panel stopped using. */}
                  <CalLabel current={isToday}>{DAY_LABELS[day.getDay()]}</CalLabel>
                  <div style={{
                    fontSize: 'var(--sb-t-h2)', fontWeight: 600, lineHeight: 1.2, marginTop: 3,
                    // Ink, not accent: the same disc the month grid draws today
                    // in, so the two views mark the same day the same way.
                    color: isToday ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-1)',
                    background: isToday ? 'var(--sb-ink-1)' : 'transparent',
                    fontVariantNumeric: 'tabular-nums',
                    width: isToday ? 32 : undefined, height: isToday ? 32 : undefined,
                    borderRadius: isToday ? '50%' : undefined,
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
            {/* The drawing surface. Marked so a test can find the box whose
                top is minute zero — every span the grid reads is measured from
                this rect, and a test that guesses at it is measuring its own
                guess. */}
            <div data-cal-cols style={{ flex: 1, display: 'flex', position: 'relative' }} onPointerDown={handleGridPointerDown}>
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
                        // The span is the event, so it is drawn as one: the
                        // card's own radius, the accent tint rather than a raw
                        // wash, and the two figures the gesture is setting.
                        // The length is the third — it is what you are actually
                        // deciding while you drag, and reading it off two clock
                        // times is arithmetic nobody should do mid-gesture.
                        <div data-cal-ghost style={{
                          position: 'absolute', top, left: '1%', right: '1%', height: h, zIndex: 10,
                          background: 'var(--sb-accent-tint2)', border: 'var(--sb-border-emphasis) solid var(--sb-accent)',
                          borderRadius: 14, pointerEvents: 'none', boxSizing: 'border-box',
                          padding: '3px 8px', overflow: 'hidden',
                        }}>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fmtShort(minToIso(ds, sMin))} – {fmtShort(minToIso(ds, eMin))}
                          </div>
                          {h >= 34 && (
                            <div style={{ fontSize: 10.5, color: 'var(--sb-accent-deep)', fontVariantNumeric: 'tabular-nums' }}>
                              {(() => {
                                const m = eMin - sMin
                                return m < 60 ? `${m} min`
                                  : m % 60 === 0 ? `${m / 60}h`
                                  : `${Math.floor(m / 60)}h ${m % 60}m`
                              })()}
                            </div>
                          )}
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
          files: (ev.attachments ?? []).map(f => ({
            name: f.title ?? 'Attachment', size: 0,
            kind: ((f.title ?? '').split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase(),
            fileUrl: f.fileUrl, fileId: f.fileId, mimeType: f.mimeType,
          })),
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
            uploadFile={uploadForCalendar}
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
          uploadFile={uploadForCalendar}
          onCancel={() => setNewEventDraft(null)}
        />
      )}

      {/* ── The day rail ───────────────────────────────────────────────────────
          The right column when nothing else is claiming it. An open event or a
          composer is *about* one event and belongs in the same place the rail
          would be, so the two never stack: whichever you opened is the column. */}
      {!selectedEvent && !newEventDraft && (
        <CalendarRail
          rows={railEvents}
          dayLabel={new Date(`${railDateStr}T12:00:00`)
            .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          onOpen={e => { setSelectedEvent(e as GCalEventExt); setPrep(null); setPrepError(null) }}
        />
      )}

      </div>
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
