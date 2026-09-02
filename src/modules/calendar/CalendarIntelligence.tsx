import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, ChevronDown, Layers, Calendar, Video,
  Sparkles, MapPin, RefreshCw, X, Eye, EyeOff,
  CheckCircle2, XCircle, Link, Check, Plus, Paperclip, FileText,
  ExternalLink, AlertCircle, Shield, Copy, Trash2, Ban,
} from 'lucide-react'
import { TimeSelect } from '@/modules/tasks/SchedulePopover'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
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
  efUpdateEvent,
  moveCalendarEventWithToken,
} from '@/lib/googleCalendar'
import type { GCalEvent, GCalCalendar, GCalEventCreate } from '@/lib/googleCalendar'
import { getGoogleToken, seedToken, getGoogleTokenViaSupabaseRefresh } from '@/lib/tokenManager'
import { loadEventStatuses, saveEventStatuses } from '@/lib/eventStatus'
import { isCalendarHiddenByCompany } from '@/lib/companyVisibility'
import { loadWeather, weatherGlyph, lookupPlaces, type WeatherByHour } from '@/lib/weather'
import { generateMeetingPrep } from '@/lib/professor'
import type { MeetingPrep } from '@/lib/professor'
import { useAuthStore } from '@/store/authStore'
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
  invitees:     { email: string }[]
  addMeet:      boolean
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
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: '#1D9E75', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: '#888780', calendar_id: null, is_active: true },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Date/time helpers ────────────────────────────────────────────────────────
const CAL_ICON_BTN: React.CSSProperties = {
  width: 36, height: 36, boxSizing: 'border-box', borderRadius: 10, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553', cursor: 'pointer', padding: 0,
}
const CAL_PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 999, flexShrink: 0,
  background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712',
  fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
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

/** The link as you would recognise it: host plus a little of the path,
 *  not the full query-string tail Google likes to append. */
function prettyLink(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    const shown = `${u.hostname.replace(/^www\./, '')}${path}`
    return shown.length > 44 ? shown.slice(0, 43) + '…' : shown
  } catch { return url }
}

function whereTarget(location: string, videoLink?: string): WhereTarget {
  const text = location.trim()
  if (!text) {
    return videoLink ? { kind: 'link', url: videoLink, label: prettyLink(videoLink) } : { kind: 'empty' }
  }
  const inText = /https?:\/\/[^\s<>"')]+/.exec(text)?.[0]
  if (inText) return { kind: 'link', url: inText, label: prettyLink(inText) }
  // A bare host someone typed, e.g. "meet.google.com/abc-defg-hij"
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text) && !/\s/.test(text)) {
    return { kind: 'link', url: `https://${text}`, label: prettyLink(`https://${text}`) }
  }
  return {
    kind: 'place',
    url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`,
    label: text,
  }
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
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
async function loadAllCalendars(primaryEmail: string): Promise<LoadCalendarsResult> {
  // Ensure primary Google token is as fresh as possible before any API calls
  await refreshPrimaryToken()

  const calCache = loadCalIntelCache()
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

// ─── Sunlit Bento color helpers ───────────────────────────────────────────────
function hexRgbStr(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    const r = parseInt(h[0]+h[0], 16), g = parseInt(h[1]+h[1], 16), b = parseInt(h[2]+h[2], 16)
    return `${r}, ${g}, ${b}`
  }
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16)
  if (isNaN(r)||isNaN(g)||isNaN(b)) return '127, 119, 221'
  return `${r}, ${g}, ${b}`
}

// ─── Calendar color palette (macOS Calendar colors) ──────────────────────────
const CAL_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE',
  '#FF2D55', '#A2845E', '#8E8E93',
]

// ─── Inline color picker for calendar chips ───────────────────────────────────
function ColorPickerPopover({ current, onPick, onClose }: { current: string; onPick: (c: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])
  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
      background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10,
      padding: '10px 10px 8px', boxShadow: '0 8px 28px rgba(25,23,18,0.18)',
      display: 'flex', flexWrap: 'wrap', gap: 7, width: 152,
    }}>
      {CAL_COLORS.map(c => (
        <button key={c} onClick={() => { onPick(c); onClose() }}
          style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: c === current ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0, flexShrink: 0 }}
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
      borderRight: '1px solid #E8E1CE',
      background: isToday ? 'rgba(245,209,78,0.045)' : isOver ? 'rgba(245,209,78,0.09)' : 'transparent',
      transition: 'background 0.1s', minWidth: 0,
    }}>
      {/* Hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} style={{ position: 'absolute', top: h * HOUR_PX, left: 0, right: 0, borderTop: '1px solid #EDE7D9', pointerEvents: 'none' }} />
      ))}
      {/* Half-hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={`h${h}`} style={{ position: 'absolute', top: h * HOUR_PX + HOUR_PX / 2, left: 0, right: 0, borderTop: '1px dashed #EDE7D9', opacity: 0.6, pointerEvents: 'none' }} />
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
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: event.id,
    disabled: isDragOverlay,
  })

  const isAllDay = !event.start.dateTime
  if (isAllDay) return null

  const top    = eventTopPx(event.start.dateTime!)
  const height = eventHeightPx(event.start.dateTime!, event.end.dateTime ?? event.start.dateTime!)
  const color  = colorOverride ?? event.calendarColor ?? '#7F77DD'
  const isDone = status === 'done'
  const isCancelled = status === 'cancelled'
  const isTentative = event.status === 'tentative'

  // Sunlit Bento event styles
  // Only a cancelled event goes grey. Done and simply-past events keep their
  // calendar's colour — an event you attended is not an event that went away.
  const rgb = color.startsWith('#') ? hexRgbStr(color) : '127,119,221'
  // A soft wash of the calendar's colour over parchment, the way the artboards
  // draw it — not a saturated slab with a bar down its side.
  // The card keeps its calendar's colour whether the event is done, cancelled
  // or neither — the tick and the strike-through say what happened to it.
  const evBg = `rgba(${rgb}, 0.10)`
  const evBorder = isTentative
    ? `1.5px dashed ${color}`
    : isSelected
    ? `2px solid ${color}`
    : `1px solid rgba(${rgb}, 0.34)`
  const evInk = '#191712'
  const evTimeInk = '#6C6553'

  return (
    <div
      ref={setNodeRef}
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
        borderRadius: 10,
        border: evBorder,
        padding: '5px 8px 8px',
        overflow: 'hidden',
        cursor: isDragOverlay ? 'grabbing' : 'pointer',
        opacity: isDragSrc ? 0.35 : 1,
        transform: isDragOverlay ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? 'none' : 'box-shadow 0.12s, opacity 0.12s',
        boxSizing: 'border-box',
        zIndex: isSelected ? 4 : 2,
        boxShadow: isSelected
          ? `0 0 0 2px ${color}, 0 6px 18px -8px rgba(25,23,18,0.35)`
          : '0 1px 2px rgba(25,23,18,0.05)',
        userSelect: 'none',
      }}
    >
      {/* Done is a tick in front of the name; cancelled strikes the name
          through. Neither touches the card's colour — that belongs to the
          calendar the event is on, not to what happened to it. */}
      <div style={{
        fontSize: height < 30 ? 10 : 11,
        fontWeight: 600,
        color: evInk,
        lineHeight: 1.25,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: height < 36 ? 'nowrap' : 'normal',
      }}>
        {isDone && (
          <Check
            size={height < 30 ? 11 : 12}
            strokeWidth={3.4}
            style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }}
          />
        )}
        <span style={{
          textDecoration: isCancelled ? 'line-through' : 'none',
          textDecorationColor: 'rgba(25,23,18,0.45)',
          textDecorationThickness: 1.5,
        }}>{event.summary ?? '(No title)'}</span>
      </div>
      {height >= 50 && (() => {
        const host = meetingHost(event)
        return host ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, overflow: 'hidden' }}>
            <Video size={10} color={evTimeInk} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: evTimeInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {host}
            </span>
          </div>
        ) : null
      })()}
      {height >= 38 && (
        <div style={{ fontSize: 10, color: evTimeInk, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {fmtShort(event.start.dateTime!)}
          {event.end.dateTime ? ` – ${fmtShort(event.end.dateTime)}` : ''}
        </div>
      )}
      {height >= 66 && event.location && !meetingHost(event) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3, overflow: 'hidden' }}>
          <MapPin size={9} color={evTimeInk} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: evTimeInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', border: 'none', padding: 0,
              background: isDone ? 'rgba(29,158,117,0.9)' : 'rgba(25,23,18,0.12)',
              color: isDone ? '#fff' : '#6C6553',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: 0, transition: 'opacity 0.12s',
            }}
          >
            <CheckCircle2 size={11} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onStatusToggle('cancelled') }}
            title="Cancel"
            style={{
              width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', border: 'none', padding: 0,
              background: isCancelled ? 'rgba(224,82,82,0.9)' : 'rgba(25,23,18,0.12)',
              color: isCancelled ? '#fff' : '#6C6553',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: 0, transition: 'opacity 0.12s',
            }}
          >
            <XCircle size={11} />
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

const EV_PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 10, background: '#FFFFFF', border: '1px solid #E8E1CE',
  color: '#191712', fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
const EV_ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553', cursor: 'pointer',
}
const EV_LABEL: React.CSSProperties = {
  width: 98, flexShrink: 0, fontSize: 13.5, color: '#6C6553', fontWeight: 500,
}
const EV_SECTION: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: '#191712', flexShrink: 0,
}
/** Every value in the panel sits in one of these, whether you can type in it,
 *  pick from it, or only read it. */
const EV_FIELD: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, height: 48, boxSizing: 'border-box',
  width: '100%', minWidth: 0, padding: '0 15px', borderRadius: 11,
  background: '#FFFFFF', border: '1px solid #E8E1CE',
  color: '#191712', fontSize: 14, fontFamily: 'inherit', textAlign: 'left',
}
const EV_GHOST_ICON: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', color: '#9B9180', cursor: 'pointer',
}

/** How long before the event you want telling, in the steps Google offers. */
const ALERT_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440]

function describeAlert(minutes: number | undefined, useDefault: boolean): string {
  if (useDefault) return 'Calendar default'
  if (minutes === undefined) return 'No alert'
  if (minutes === 0) return 'At the time'
  if (minutes < 60) return `${minutes} mins before`
  if (minutes < 1440) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`
  return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`
}

function describeResponse(status?: string): string {
  if (status === 'accepted') return 'Coming'
  if (status === 'declined') return 'Not coming'
  if (status === 'tentative') return 'Maybe'
  return 'No answer yet'
}
function responseGlyph(status?: string): string {
  if (status === 'accepted') return '\u2713'
  if (status === 'declined') return '\u2715'
  return '?'
}
function responseTone(status?: string): string {
  if (status === 'accepted') return '#5F7038'
  if (status === 'declined') return '#B4523A'
  return '#9B9180'
}

/** Which video service this calendar makes links with. An event that already
 *  has a link says so itself; otherwise it comes from the account behind the
 *  calendar, since a Microsoft-hosted mailbox is a Teams shop and a Google one
 *  is a Meet shop. */
type VideoProvider = 'meet' | 'teams' | 'other'

const MS_MAIL_DOMAINS = /(^|\.)(outlook|hotmail|live|msn)\.[a-z.]{2,6}$/i

function providerFromUrl(url: string): VideoProvider {
  const host = (() => { try { return new URL(url).hostname } catch { return url } })().toLowerCase()
  if (host.includes('meet.google')) return 'meet'
  if (host.includes('teams.')) return 'teams'
  return 'other'
}

function providerForAccount(email?: string): VideoProvider {
  const domain = email?.split('@')[1]?.toLowerCase() ?? ''
  return MS_MAIL_DOMAINS.test(domain) ? 'teams' : 'meet'
}

const PROVIDER_NAME: Record<VideoProvider, string> = {
  meet: 'Google Meet', teams: 'Microsoft Teams', other: 'Video call',
}

/** The provider's own mark. Only ever drawn for a link that exists — an event
 *  with no call carries no branding at all. */
function ProviderMark({ provider, size = 24 }: { provider: VideoProvider; size?: number }) {
  if (provider === 'teams') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false" style={{ flexShrink: 0 }}>
        <circle fill="#5059C9" cx="38.5" cy="11" r="4.5" />
        <path fill="#5059C9" d="M43.5 18H33v13.5a7 7 0 0 0 7 7h.2a5.3 5.3 0 0 0 5.3-5.3V20a2 2 0 0 0-2-2z" />
        <circle fill="#7B83EB" cx="27" cy="9.5" r="6.5" />
        <path fill="#7B83EB" d="M33.2 18H16.8A2.8 2.8 0 0 0 14 20.8v12.4A10.8 10.8 0 0 0 24.8 44h.4A10.8 10.8 0 0 0 36 33.2V20.8a2.8 2.8 0 0 0-2.8-2.8z" />
        <path fill="#000" opacity=".12" d="M25 15.5V38a2.5 2.5 0 0 1-2.5 2.5H14.4a11 11 0 0 1-.4-3V20.8A2.8 2.8 0 0 1 16.8 18H25z" />
        <rect fill="#4B53BC" x="2" y="13" width="24" height="24" rx="2.5" />
        <path fill="#fff" d="M20 19H8v3.1h4.3V33h3.4V22.1H20z" />
      </svg>
    )
  }
  if (provider === 'meet') {
    return (
      <svg width={size} height={size * (72 / 87.5)} viewBox="0 0 87.5 72" aria-hidden focusable="false" style={{ flexShrink: 0 }}>
        <path fill="#00832d" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z" />
        <path fill="#0066da" d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z" />
        <path fill="#e94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
        <path fill="#2684fc" d="M20.5 20.5H0v31h20.5z" />
        <path fill="#00ac47" d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z" />
        <path fill="#ffba00" d="M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z" />
      </svg>
    )
  }
  return <Video size={size - 4} color="#6C6553" style={{ flexShrink: 0 }} />
}

/** What to show for the link. A Meet code reads out loud — "omb-mppj-wyv" —
 *  so it is worth showing; a Teams or Zoom join URL is an opaque blob, so the
 *  host says more than the tail of the path does. */
function meetingCode(url: string, provider: VideoProvider): string {
  try {
    const u = new URL(url)
    if (provider === 'meet') {
      const last = u.pathname.split('/').filter(Boolean).pop()
      if (last) return last
    }
    return u.hostname.replace(/^www\./, '')
  } catch { return url }
}

/** Google gives a mime type and nothing else — no size, no date. */
function describeMime(mime: string | undefined): string {
  if (!mime) return 'file'
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'presentation'
  if (mime.includes('document') || mime.includes('word')) return 'document'
  if (mime.includes('pdf')) return 'PDF'
  if (mime.startsWith('image/')) return 'image'
  if (mime.includes('folder')) return 'folder'
  return mime.split('/').pop() ?? 'file'
}

/** "AB" from a name or an address, for the attendee circles. */
function evInitials(name: string | undefined, email: string): string {
  const src = (name ?? email.split('@')[0]).replace(/[._-]+/g, ' ')
  return src.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

/** The organisation an address belongs to, as far as the address can say. */
function evOrg(email: string): string {
  const domain = email.split('@')[1] ?? ''
  const name = domain.split('.')[0] ?? ''
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : ''
}


/** "Every Wednesday" out of an RRULE, when it says something that simple. */
function describeRecurrence(rules: string[] | undefined, start: Date): string | null {
  const rule = rules?.find(r => r.startsWith('RRULE'))
  if (!rule) return null
  const freq = /FREQ=(\w+)/.exec(rule)?.[1]
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1)
  const weekday = start.toLocaleDateString('en-GB', { weekday: 'long' })
  if (freq === 'DAILY') return interval === 1 ? 'Every day' : `Every ${interval} days`
  if (freq === 'WEEKLY') return interval === 1 ? `Every ${weekday}` : `Every ${interval} weeks`
  if (freq === 'MONTHLY') return interval === 1 ? 'Every month' : `Every ${interval} months`
  if (freq === 'YEARLY') return 'Every year'
  return 'Repeats'
}

function EventPopup({ event, status, calName, calColor, prep, prepLoading, prepError, onClose, onStatusToggle, onPrepRequest, onAddMeet, onSave, onDelete, calendars, onMoveCalendar, clashes, onOpenEvent }: {
  event: GCalEventExt
  status: EventStatus | undefined
  calName: string
  calColor: string
  prep: MeetingPrep | null
  prepLoading: boolean
  prepError: string | null
  onClose: () => void
  onStatusToggle: (s: EventStatus) => void
  onPrepRequest: () => void
  onAddMeet?: () => Promise<void>
  onSave?: (patch: Partial<GCalEventCreate>) => Promise<GCalEvent | null>
  onDelete?: () => void
  calendars?: CalWithAccount[]
  onMoveCalendar?: (targetCalId: string) => Promise<boolean>
  /** Events on the same day that overlap this one. */
  clashes?: GCalEventExt[]
  onOpenEvent?: (e: GCalEventExt) => void
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [clashDismissed, setClashDismissed] = useState(false)
  const [addingAttendee, setAddingAttendee] = useState(false)
  const [attendeeDraft, setAttendeeDraft] = useState('')
  const [prepChecked, setPrepChecked] = useState<Set<number>>(new Set())

  const isAllDay = !event.start.dateTime
  const startDate = new Date(event.start.dateTime ?? (event.start.date + 'T00:00:00'))
  const endDate = new Date(event.end.dateTime ?? (event.end.date + 'T00:00:00'))
  const pad = (n: number) => String(n).padStart(2, '0')

  const [title, setTitle] = useState(event.summary ?? '')
  const [dateStr, setDateStr] = useState(
    `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`,
  )
  const [fromTime, setFromTime] = useState(`${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`)
  const [toTime, setToTime] = useState(`${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`)
  const [location, setLocation] = useState(event.location ?? '')
  const [notes, setNotes] = useState(event.description ?? '')
  const [meetOpen, setMeetOpen] = useState(false)
  const [places, setPlaces] = useState<string[]>([])
  const [placeQuery, setPlaceQuery] = useState('')
  const placeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  // What you type is looked up as a real place, a moment after you stop typing.
  // The lookup knows towns and cities, so a street address or a room name comes
  // back with nothing — it is still kept exactly as typed.
  useEffect(() => {
    const q = placeQuery.trim()
    if (q.length < 3 || /https?:\/\//.test(q)) { setPlaces([]); return }
    let live = true
    const t = window.setTimeout(async () => {
      const found = await lookupPlaces(q)
      if (live) setPlaces(found.filter(pl => pl.toLowerCase() !== q.toLowerCase()).slice(0, 5))
    }, 350)
    return () => { live = false; window.clearTimeout(t) }
  }, [placeQuery])

  useEffect(() => {
    if (places.length === 0) return
    const h = (e: MouseEvent) => { if (placeRef.current && !placeRef.current.contains(e.target as Node)) setPlaces([]) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [places.length])

  const entryPoints = event.conferenceData?.entryPoints ?? []
  const videoLink = entryPoints.find(ep => ep.entryPointType === 'video')?.uri
  const phoneEntry = entryPoints.find(ep => ep.entryPointType === 'phone')
  const accountEmail = (calendars ?? []).find(c => c.id === event.calendarId)?.accountEmail
  const provider = videoLink ? providerFromUrl(videoLink) : providerForAccount(accountEmail)
  /** Meet links this app can mint itself, through the Google Calendar it is
   *  already talking to. A Teams link is made by the Teams add-in inside the
   *  calendar, so that button opens the event there instead. */
  const canAddVideo = provider === 'teams' ? !!event.htmlLink : !!onAddMeet
  // The meeting link has its own card above, so Location speaks only about a place.
  const where = whereTarget(location)
  const attendees = event.attendees ?? []
  const recurrence = describeRecurrence(event.recurrence, startDate)
  const writable = (calendars ?? []).filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
  const liveClashes = (clashes ?? []).filter(c => c.id !== event.id)

  /** Every edit writes straight through — no Save button to forget. */
  async function push(patch: Partial<GCalEventCreate>) {
    if (!onSave) return
    setSaving(true); setSaveError(null)
    try {
      const updated = await onSave(patch)
      if (!updated) setSaveError('Could not save — check your permissions.')
    } finally { setSaving(false) }
  }

  function pushTimes(nextDate: string, nextFrom: string, nextTo: string) {
    if (isAllDay) { void push({ start: { date: nextDate }, end: { date: nextDate } }); return }
    const tz = event.start.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const [y, m, d] = nextDate.split('-').map(Number)
    const [fh, fm] = nextFrom.split(':').map(Number)
    const [th, tm] = nextTo.split(':').map(Number)
    void push({
      start: { dateTime: new Date(y, m - 1, d, fh, fm).toISOString(), timeZone: tz },
      end:   { dateTime: new Date(y, m - 1, d, th, tm).toISOString(), timeZone: tz },
    })
  }

  /** The first quarter-hour after every clash ends — where this could move to. */
  const freeAfterClash = (() => {
    if (!liveClashes.length || isAllDay) return null
    const latestEnd = liveClashes
      .map(c => new Date(c.end.dateTime ?? c.end.date + 'T00:00:00').getTime())
      .reduce((a, b) => Math.max(a, b), 0)
    const d = new Date(latestEnd)
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  })()

  function moveClear() {
    if (!freeAfterClash) return
    const span = (new Date(`2000-01-01T${toTime}`).getTime() - new Date(`2000-01-01T${fromTime}`).getTime()) / 60000
    const [h, m] = freeAfterClash.split(':').map(Number)
    const endMins = h * 60 + m + span
    const nextTo = `${pad(Math.floor(endMins / 60) % 24)}:${pad(endMins % 60)}`
    setFromTime(freeAfterClash); setToTime(nextTo)
    pushTimes(dateStr, freeAfterClash, nextTo)
    setClashDismissed(true)
  }

  function addAttendee() {
    const email = attendeeDraft.trim().toLowerCase()
    setAttendeeDraft(''); setAddingAttendee(false)
    if (!email.includes('@')) return
    void push({ attendees: [...attendees.map(a => ({ email: a.email })), { email }] })
  }

  const files = event.attachments ?? []
  const prepPoints = prep?.talkingPoints ?? []

  const alertMinutes = event.reminders?.useDefault === false
    ? event.reminders.overrides?.[0]?.minutes
    : undefined

  function setAlert(v: string) {
    if (v === 'default') { void push({ reminders: { useDefault: true } }); return }
    if (v === 'none')    { void push({ reminders: { useDefault: false, overrides: [] } }); return }
    void push({ reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: Number(v) }] } })
  }

  function addVideoCall() {
    if (provider === 'teams') {
      if (event.htmlLink) window.open(event.htmlLink, '_blank', 'noopener')
      return
    }
    void onAddMeet?.()
  }

  function commitLocation() {
    setPlaces([]); setPlaceQuery('')
    if (location.trim() !== (event.location ?? '')) void push({ location: location.trim() })
  }

  function removeAttendee(email: string) {
    void push({ attendees: attendees.filter(a => a.email !== email).map(a => ({ email: a.email })) })
  }

  return (
    <div ref={popupRef} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{
      width: 440, flexShrink: 0, alignSelf: 'stretch', minHeight: 0,
      overflowY: 'auto', scrollbarWidth: 'thin',
      background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 18,
      boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
      padding: '18px 22px 22px',
    }}>

      {/* ── Which calendar, and what to do with the event ────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {/* The chip names the calendar and changes it — click to pick another */}
        <span style={{ position: 'relative', display: 'inline-flex', minWidth: 0, flex: 1 }}>
          <span
            title={onMoveCalendar ? 'Click to move this to another calendar' : calName}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px',
              borderRadius: 999, background: '#F5F1E6', color: '#4A4438', fontSize: 13,
              minWidth: 0, maxWidth: '100%', cursor: onMoveCalendar ? 'pointer' : 'default',
            }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: calColor, flexShrink: 0 }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {calName}
            </span>
            {onMoveCalendar && <ChevronDown size={13} strokeWidth={2} style={{ color: '#9B9180', flexShrink: 0 }} />}
          </span>
          {onMoveCalendar && (
            <select
              value={event.calendarId ?? ''}
              onChange={e => { void onMoveCalendar(e.target.value) }}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              {writable.length === 0 && <option value={event.calendarId ?? ''}>{calName}</option>}
              {writable.map(c => <option key={c.id} value={c.id}>{c.summaryOverride ?? c.summary}</option>)}
            </select>
          )}
        </span>

        {/* Done and cancelled are the two things you say about an event that
            has already happened, so they sit together as the same kind of
            control — pressed once to set, again to take back. */}
        <button
          onClick={() => onStatusToggle('done')}
          title={status === 'done' ? 'Not done after all' : 'Mark done'}
          style={{
            ...EV_ROUND, width: 34, height: 34,
            background: status === 'done' ? '#5F7038' : '#FFFFFF',
            borderColor: status === 'done' ? '#5F7038' : '#E8E1CE',
            color: status === 'done' ? '#FFFFFF' : '#6C6553',
          }}><Check size={15} strokeWidth={2.2} /></button>

        <button
          onClick={() => onStatusToggle('cancelled')}
          title={status === 'cancelled' ? 'Back on' : 'Mark cancelled'}
          style={{
            ...EV_ROUND, width: 34, height: 34,
            background: status === 'cancelled' ? '#6C6553' : '#FFFFFF',
            borderColor: status === 'cancelled' ? '#6C6553' : '#E8E1CE',
            color: status === 'cancelled' ? '#FFFFFF' : '#6C6553',
          }}><Ban size={15} strokeWidth={2} /></button>

        <button
          onClick={() => onDelete?.()}
          disabled={!onDelete}
          title="Delete event"
          style={{
            ...EV_ROUND, width: 34, height: 34,
            color: '#B4523A', borderColor: 'rgba(180,82,58,0.35)', opacity: onDelete ? 1 : 0.45,
          }}><Trash2 size={15} /></button>

        <button onClick={onClose} title="Close" style={{ ...EV_ROUND, width: 34, height: 34 }}><X size={15} /></button>
      </div>

      {/* ── Title ────────────────────────────────────────────────────────── */}
      {/* The title is the heading of the panel, not a form field, so it has no
          box around it until you put the cursor in it. */}
      <textarea
        value={title}
        rows={1}
        onChange={e => setTitle(e.target.value)}
        onBlur={() => { if (title.trim() && title !== event.summary) void push({ summary: title.trim() }) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }}
        placeholder="Event title"
        style={{
          width: '100%', boxSizing: 'border-box', margin: '18px 0 0', resize: 'none', overflow: 'hidden',
          background: 'transparent', border: 'none', padding: 0,
          fontFamily: 'Outfit, sans-serif', fontSize: 27, fontWeight: 700,
          lineHeight: 1.18, letterSpacing: '-0.025em', color: '#191712', outline: 'none', textAlign: 'left',
          textDecoration: status === 'cancelled' ? 'line-through' : 'none',
        }} />

      {/* ── The meeting itself ───────────────────────────────────────────── */}
      {/* Branding belongs to a link that exists. An event with no call shows
          nothing here — the way to add one is a plain icon on the row below. */}
      {videoLink && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 11, marginTop: 16,
          height: 58, padding: '0 15px', boxSizing: 'border-box',
          borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E1CE',
        }}>
          <ProviderMark provider={provider} size={24} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#191712', flexShrink: 0 }}>
            {PROVIDER_NAME[provider]}
          </span>
          <a href={videoLink} target="_blank" rel="noreferrer"
            title={videoLink}
            style={{
              flex: 1, minWidth: 0, fontSize: 14.5, color: '#1A73E8', textDecoration: 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{meetingCode(videoLink, provider)}</a>
          <button
            onClick={() => { void navigator.clipboard?.writeText(videoLink) }}
            title="Copy the joining link"
            style={{ ...EV_GHOST_ICON }}><Link size={15} /></button>
          <button
            onClick={() => setMeetOpen(o => !o)}
            title={meetOpen ? 'Hide the details' : 'Show the full link and dial-in'}
            style={{ ...EV_GHOST_ICON, transform: meetOpen ? 'rotate(180deg)' : undefined }}>
            <ChevronDown size={16} />
          </button>
        </div>
      )}

      {videoLink && meetOpen && (
        <div style={{
          marginTop: 6, padding: '11px 15px', borderRadius: 11,
          background: '#FAF7EC', border: '1px solid #E8E1CE',
        }}>
          <a href={videoLink} target="_blank" rel="noreferrer" style={{
            display: 'block', fontSize: 12.5, color: '#1A73E8', wordBreak: 'break-all', textDecoration: 'none',
          }}>{videoLink}</a>
          {phoneEntry && (
            <p style={{ margin: '7px 0 0', fontSize: 12.5, color: '#6C6553' }}>
              Dial in: {phoneEntry.label ?? phoneEntry.uri.replace('tel:', '')}
              {phoneEntry.pin ? ` · PIN ${phoneEntry.pin}` : ''}
            </p>
          )}
        </div>
      )}

      {/* ── Where ────────────────────────────────────────────────────────── */}
      {/* One field you simply type in. What you type is looked up as you go, so
          a place can be pinned to a real one; Enter keeps it either way. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <span style={EV_LABEL}>Location</span>
        <span ref={placeRef} style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7, position: 'relative' }}>
          <span style={{ ...EV_FIELD, flex: 1 }}>
            <MapPin size={15} color={location ? '#6C6553' : '#9B9180'} style={{ flexShrink: 0 }} />
            <input
              value={location}
              onChange={e => { setLocation(e.target.value); setPlaceQuery(e.target.value) }}
              onFocus={() => { if (location.trim().length >= 3) setPlaceQuery(location) }}
              onBlur={() => { window.setTimeout(commitLocation, 120) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitLocation(); (e.target as HTMLInputElement).blur() }
                if (e.key === 'Escape') { setLocation(event.location ?? ''); setPlaces([]); (e.target as HTMLInputElement).blur() }
              }}
              placeholder="Add a place — room, office or address"
              style={{
                flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0,
                fontSize: 13.5, fontFamily: 'inherit', color: '#191712', outline: 'none',
                textOverflow: 'ellipsis',
              }} />
            {where.kind !== 'empty' && (
              <a href={where.url} target="_blank" rel="noreferrer"
                title={where.kind === 'place' ? 'Open in Google Maps' : where.url}
                onMouseDown={e => e.preventDefault()}
                style={{ ...EV_GHOST_ICON, width: 22, height: 22, textDecoration: 'none' }}>
                <ExternalLink size={13} />
              </a>
            )}
          </span>

          {/* Adding a call is a plain icon — the provider's own mark only turns
              up once there is a link to brand. */}
          {!videoLink && canAddVideo && (
            <button onClick={addVideoCall} title={`Add a ${PROVIDER_NAME[provider]} link`}
              style={{ ...EV_ROUND, width: 48, height: 48, borderRadius: 11, flexShrink: 0 }}>
              <Video size={16} />
            </button>
          )}

          {places.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 5px)', left: 0, right: 0, zIndex: 90,
              background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 11, padding: 5,
              boxShadow: '0 18px 40px -18px rgba(25,23,18,.45)',
            }}>
              {places.map(pl => (
                <button key={pl} onMouseDown={e => e.preventDefault()}
                  onClick={() => { setLocation(pl); setPlaces([]); void push({ location: pl }) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32,
                    padding: '0 9px', borderRadius: 8, border: 'none', background: 'transparent',
                    color: '#191712', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <MapPin size={13} color="#9B9180" style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      </div>

      <div style={{ height: 1, background: '#F0EBDC', margin: '18px 0' }} />

      {/* ── When ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <label style={{ ...EV_FIELD, width: 'auto', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
          {new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          <ChevronDown size={14} strokeWidth={2} style={{ color: '#9B9180' }} />
          <input
            type="date" value={dateStr}
            onChange={e => { setDateStr(e.target.value); pushTimes(e.target.value, fromTime, toTime) }}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
        </label>
        {!isAllDay ? (
          <>
            <span style={{ width: 96 }}>
              <TimeSelect size="large" value={fromTime} onChange={v => { setFromTime(v); pushTimes(dateStr, v, toTime) }} />
            </span>
            <span style={{ fontSize: 13.5, color: '#6C6553' }}>to</span>
            <span style={{ width: 96 }}>
              <TimeSelect size="large" value={toTime} onChange={v => { setToTime(v); pushTimes(dateStr, fromTime, v) }} />
            </span>
          </>
        ) : (
          <span style={{ ...EV_FIELD, width: 'auto', background: '#FAF7EC', border: '1px solid transparent' }}>All day</span>
        )}
      </div>

      {/* ── What it runs into ────────────────────────────────────────────── */}
      {liveClashes.length > 0 && !clashDismissed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
          <button
            onClick={() => onOpenEvent?.(liveClashes[0])}
            title={`Open “${liveClashes[0].summary ?? 'the clashing event'}”`}
            style={{
              display: 'inline-flex', alignItems: 'center', height: 42, padding: '0 14px', borderRadius: 11,
              background: 'rgba(245,209,78,0.24)', border: '1px solid rgba(245,209,78,0.7)',
              color: '#3D3926', fontSize: 13, minWidth: 0, fontFamily: 'inherit', flex: 1,
              cursor: onOpenEvent ? 'pointer' : 'default',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            Clashes with {liveClashes[0].summary ?? 'another event'}
            {liveClashes.length > 1 ? ` +${liveClashes.length - 1}` : ''}
          </button>
          <button
            onClick={moveClear}
            disabled={!freeAfterClash || saving}
            title={freeAfterClash ? `Move this to ${freeAfterClash}, clear of the clash` : 'Nothing to move to'}
            style={{ ...EV_ROUND, width: 42, height: 42, borderRadius: 11, opacity: freeAfterClash ? 1 : 0.45 }}>
            <Check size={14} strokeWidth={2.4} />
          </button>
          <button onClick={() => setClashDismissed(true)} title="Leave it — I know"
            style={{ ...EV_ROUND, width: 42, height: 42, borderRadius: 11 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Repeats · Alert · Prep ───────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={EV_LABEL}>Repeats</span>
          <span style={{ ...EV_FIELD, flex: 1, color: recurrence ? '#191712' : '#9B9180' }}>
            {recurrence ?? 'Does not repeat'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={EV_LABEL}>Alert</span>
          <label style={{ ...EV_FIELD, flex: 1, position: 'relative', cursor: 'pointer' }}>
            <span style={{ flex: 1, minWidth: 0, color: alertMinutes === undefined ? '#9B9180' : '#191712' }}>
              {describeAlert(alertMinutes, event.reminders?.useDefault !== false)}
            </span>
            <ChevronDown size={14} strokeWidth={2} style={{ color: '#9B9180', flexShrink: 0 }} />
            <select
              value={event.reminders?.useDefault !== false ? 'default'
                : alertMinutes === undefined ? 'none' : String(alertMinutes)}
              onChange={e => setAlert(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              <option value="default">Calendar default</option>
              <option value="none">No alert</option>
              {ALERT_CHOICES.map(m => <option key={m} value={m}>{describeAlert(m, false)}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={EV_LABEL}>Prep held</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {prep ? (
              <span style={{ ...EV_FIELD, width: '100%' }}>
                <Sparkles size={14} color="#6C6553" />
                {prepPoints.length} point{prepPoints.length === 1 ? '' : 's'} gathered
              </span>
            ) : (
              <button onClick={onPrepRequest} disabled={prepLoading}
                style={{ ...EV_FIELD, width: '100%', cursor: 'pointer', opacity: prepLoading ? 0.6 : 1 }}>
                <Sparkles size={14} color="#6C6553" /> {prepLoading ? 'Gathering prep…' : 'Gather prep'}
              </button>
            )}
          </span>
        </div>
      </div>

      {prepError && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#B4523A' }}>{prepError}</p>
      )}

      <div style={{ height: 1, background: '#F0EBDC', margin: '18px 0' }} />

      {/* ── Attendees ────────────────────────────────────────────────────── */}
      <div style={{ ...EV_SECTION, marginBottom: 6 }}>Attendees</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {attendees.map(a => (
          <div key={a.email} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', minWidth: 0 }}>
            <span style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#F1ECDE', color: '#6C6553', fontSize: 11, fontWeight: 700,
            }}>{evInitials(a.displayName, a.email)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.displayName ?? a.email}
            </span>
            <span
              title={`${describeResponse(a.responseStatus)} · ${evOrg(a.email)}`}
              style={{
                ...EV_ROUND, width: 32, height: 32, flexShrink: 0, fontSize: 13, fontWeight: 600,
                color: responseTone(a.responseStatus),
                borderColor: a.responseStatus === 'accepted' ? 'rgba(95,112,56,0.4)'
                  : a.responseStatus === 'declined' ? 'rgba(180,82,58,0.35)' : '#E8E1CE',
              }}>{responseGlyph(a.responseStatus)}</span>
            <button
              onClick={() => removeAttendee(a.email)}
              disabled={!onSave}
              title={`Take ${a.displayName ?? a.email} off the invite`}
              style={{ ...EV_ROUND, width: 32, height: 32, flexShrink: 0, color: '#B4523A', borderColor: 'rgba(180,82,58,0.35)', opacity: onSave ? 1 : 0.45 }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {addingAttendee ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
            <span style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px dashed #D8CFB8', color: '#C9C0A8',
            }}><Plus size={15} /></span>
            <input
              autoFocus
              value={attendeeDraft}
              onChange={e => setAttendeeDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addAttendee(); if (e.key === 'Escape') { setAttendeeDraft(''); setAddingAttendee(false) } }}
              onBlur={addAttendee}
              placeholder="name@company.com"
              style={{ ...EV_FIELD, flex: 1, cursor: 'text', outline: 'none' }} />
          </div>
        ) : (
          <button onClick={() => setAddingAttendee(true)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0',
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}>
            <span style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px dashed #D8CFB8', color: '#C9C0A8',
            }}><Plus size={15} /></span>
            <span style={{ fontSize: 14, color: '#9B9180' }}>Add an invitee</span>
          </button>
        )}
      </div>

      {/* ── Attachments ──────────────────────────────────────────────────── */}
      <div style={{ height: 1, background: '#F0EBDC', margin: '18px 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={EV_SECTION}>Attachments</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#9B9180', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {attendees.length > 0
            ? `Shared with the ${attendees.length} invitee${attendees.length === 1 ? '' : 's'}`
            : 'Only you can see these'}
        </span>
        <button
          onClick={() => { if (event.htmlLink) window.open(event.htmlLink, '_blank', 'noopener') }}
          disabled={!event.htmlLink}
          title="Google Calendar holds the file picker"
          style={{ ...EV_FIELD, width: 'auto', height: 40, gap: 8, cursor: 'pointer', flexShrink: 0, opacity: event.htmlLink ? 1 : 0.45 }}>
          <Paperclip size={14} /> Attach
        </button>
      </div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {files.map(f => (
            <a key={f.fileUrl} href={f.fileUrl} target="_blank" rel="noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', minWidth: 0, textDecoration: 'none',
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#FAF7EC', border: '1px solid #E8E1CE', color: '#6C6553',
              }}><FileText size={15} strokeWidth={1.9} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.title ?? f.fileUrl}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: '#9B9180', marginTop: 2 }}>
                  {describeMime(f.mimeType)}
                </span>
              </span>
              <ExternalLink size={13} color="#9B9180" style={{ flexShrink: 0 }} />
            </a>
          ))}
        </div>
      )}

      {/* ── Notes ────────────────────────────────────────────────────────── */}
      <div style={{ height: 1, background: '#F0EBDC', margin: '18px 0' }} />
      <div style={{ ...EV_SECTION, marginBottom: 8 }}>Notes</div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (event.description ?? '')) void push({ description: notes }) }}
        placeholder="Add a note — agenda, decisions, anything to remember."
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 88,
          background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12,
          padding: '13px 15px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5,
          color: '#191712', outline: 'none',
        }} />

      {/* ── Prep gathered ────────────────────────────────────────────────── */}
      {prepPoints.length > 0 && (
        <>
          <div style={{ height: 1, background: '#F0EBDC', margin: '18px 0' }} />
          <div style={{ ...EV_SECTION, marginBottom: 8 }}>Prep gathered</div>
          {prep?.goal && (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#3D3926', lineHeight: 1.5 }}>{prep.goal}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {prepPoints.map((pt, i) => {
              const on = prepChecked.has(i)
              return (
                <button key={i} onClick={() => setPrepChecked(prev => {
                  const next = new Set(prev); if (on) next.delete(i); else next.add(i); return next
                })} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 11, padding: '5px 0',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}>
                  <span style={{
                    width: 19, height: 19, borderRadius: 6, boxSizing: 'border-box', flexShrink: 0, marginTop: 1,
                    border: on ? '1.5px solid #191712' : '1.5px solid #CFC6B0',
                    background: on ? '#191712' : '#FFFFFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{on && <Check size={11} color="#fff" strokeWidth={3} />}</span>
                  <span style={{ fontSize: 13, color: on ? '#9B9180' : '#191712', lineHeight: 1.45, textDecoration: on ? 'line-through' : 'none' }}>
                    {pt}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── What the Professor would do about it ─────────────────────────── */}
      {liveClashes.length > 0 && (
        <div style={{
          marginTop: 18, padding: '14px 15px', borderRadius: 12,
          background: '#FAF7EC', border: '1px solid #E8E1CE',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: '#3D3926', lineHeight: 1.5 }}>
            {freeAfterClash
              ? `Professor: move this to ${freeAfterClash} and it stops costing you anything.`
              : 'Professor: this overlaps something already booked.'}
          </p>
          {freeAfterClash && (
            <button onClick={moveClear} disabled={saving} style={{
              ...EV_FIELD, width: 'auto', height: 40, marginTop: 12, cursor: 'pointer',
              background: '#191712', border: 'none', color: '#FDF8E7', fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}>Move to {freeAfterClash}</button>
          )}
        </div>
      )}

      {saveError && (
        <p style={{ margin: '12px 0 0', fontSize: 11.5, color: '#B4523A' }}>{saveError}</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <span style={{ flex: 1, fontSize: 11.5, color: '#9B9180' }}>
          {saving ? 'Saving…' : 'Every change saves itself.'}
        </span>
        {event.htmlLink && (
          <a href={event.htmlLink} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#6C6553', textDecoration: 'none', flexShrink: 0 }}>
            Open in Google Calendar <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}

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

  const sep: React.CSSProperties = { height: 1, background: '#E8E1CE', margin: '3px 8px' }

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
          padding: '0 12px', height: 32, fontSize: 13,
          color: disabled ? '#4B5268' : destructive ? '#E05252' : '#3D3926',
          cursor: disabled ? 'default' : 'pointer',
          borderRadius: 6, userSelect: 'none',
          background: hovered
            ? (destructive ? 'rgba(224,82,82,0.1)' : 'rgba(127,119,221,0.12)')
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
    <div
      ref={menuRef}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed',
        top: adjPos.y, left: adjPos.x,
        width: 210,
        background: '#FFFFFF',
        border: '1px solid #E8E1CE',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        zIndex: 1100,
        padding: '4px 0',
        overflow: 'hidden',
      }}
    >
      {/* Group 1: Navigation */}
      {item('view',   <Eye size={13} />,          'View Details',             onViewDetails)}
      {item('gcal',   <ExternalLink size={13} />,  'Open in Google Calendar',  event.htmlLink ? () => window.open(event.htmlLink, '_blank') : undefined, { disabled: !event.htmlLink })}
      {conferenceUrl && item('join', <Video size={13} />, 'Join Meeting', () => window.open(conferenceUrl, '_blank'))}

      <div style={sep} />

      {/* Group 2: Clipboard */}
      {item('copy-link',    <Link size={13} />, 'Copy Event Link',
        event.htmlLink ? () => navigator.clipboard.writeText(event.htmlLink!).catch(() => {}) : undefined,
        { disabled: !event.htmlLink })}
      {item('copy-details', <Copy size={13} />, 'Copy Details',
        () => navigator.clipboard.writeText(formatCopyDetails()).catch(() => {}))}

      <div style={sep} />

      {/* Group 3: Status */}
      {item('done',      <CheckCircle2 size={13} />, isDone      ? 'Unmark Done'      : 'Mark as Done',
        () => { onStatusToggle('done');      onClose() }, )}
      {item('cancelled', <XCircle size={13} />,      isCancelled ? 'Restore Event'    : 'Mark as Cancelled',
        () => { onStatusToggle('cancelled'); onClose() }, )}

      <div style={sep} />

      {/* Group 4: Destructive */}
      {item('delete', <Trash2 size={13} />, 'Delete Event', onDelete, { destructive: true })}
    </div>
  )
}

// ─── New event ───────────────────────────────────────────────────────────────
// The same panel as an existing event, in the state before it exists: title,
// when, calendar, where, attendees — then Create.

function NewEventForm({ draft, calendars, calColors, onSave, onCancel }: {
  draft:     NewEventDraft
  calendars: CalWithAccount[]
  calColors: Record<string, string>
  onSave:    (data: NewEventData) => void
  onCancel:  () => void
}) {
  const writable   = calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
  const defaultCal = writable.find(c => c.primary) ?? writable[0]

  const padMin = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  const [title,        setTitle]        = useState('')
  const [calId,        setCalId]        = useState(defaultCal?.id ?? '')
  const [location,     setLocation]     = useState('')
  const [description,  setDescription]  = useState('')
  const [allDay,       setAllDay]       = useState(false)
  const [startDate,    setStartDate]    = useState(draft.dateStr)
  const [startTime,    setStartTime]    = useState(padMin(draft.startMin))
  const [endTime,      setEndTime]      = useState(padMin(draft.endMin))
  const [inviteeInput, setInviteeInput] = useState('')
  const [invitees,     setInvitees]     = useState<string[]>([])
  const [addMeet,      setAddMeet]      = useState(false)
  const ref      = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onCancel() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onCancel])

  const calColor = calColors[calId] ?? calendars.find(c => c.id === calId)?.backgroundColor ?? '#7F77DD'
  const calLabel = (() => {
    const c = calendars.find(x => x.id === calId)
    return c ? (c.summaryOverride ?? c.summary) : 'Calendar'
  })()

  function addInvitee(raw: string) {
    const email = raw.trim().toLowerCase().replace(/,$/, '')
    if (email && email.includes('@') && !invitees.includes(email)) setInvitees(prev => [...prev, email])
    setInviteeInput('')
  }

  function handleSave() {
    if (!title.trim()) return
    onSave({
      title:       title.trim(),
      calId,
      startDate,   startTime: allDay ? '' : startTime,
      endDate:     startDate, endTime: allDay ? '' : endTime,
      allDay,
      location:    location.trim() || undefined,
      description: description.trim() || undefined,
      invitees:    invitees.map(email => ({ email })),
      addMeet,
    })
  }

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{
      width: 440, flexShrink: 0, alignSelf: 'stretch', minHeight: 0,
      overflowY: 'auto', scrollbarWidth: 'thin',
      background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 18,
      boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
      padding: '18px 20px 22px',
    }}>

      {/* Which calendar, and the way out */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 11px',
          borderRadius: 999, background: '#F1ECDE', color: '#4A4438', fontSize: 12,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: calColor, flexShrink: 0 }} />
          New event
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onCancel} title="Cancel" style={EV_ROUND}><X size={14} /></button>
      </div>

      {/* Title */}
      <input
        ref={titleRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
        placeholder="Event title"
        style={{
          width: '100%', boxSizing: 'border-box', marginTop: 14,
          background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 11,
          padding: '13px 15px', fontFamily: 'Outfit, sans-serif', fontSize: 21, fontWeight: 600,
          letterSpacing: '-0.02em', color: '#191712', outline: 'none', textAlign: 'left',
        }} />

      {/* When */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ ...EV_PILL, position: 'relative' }}>
          {new Date(startDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          <ChevronDown size={13} strokeWidth={2} style={{ color: '#9B9180' }} />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
        </label>
        {!allDay && (
          <>
            <span style={{ width: 92 }}><TimeSelect value={startTime} onChange={setStartTime} /></span>
            <span style={{ fontSize: 12.5, color: '#6C6553' }}>to</span>
            <span style={{ width: 92 }}><TimeSelect value={endTime} onChange={setEndTime} /></span>
          </>
        )}
        <button onClick={() => setAllDay(v => !v)} style={{
          ...EV_PILL,
          background: allDay ? '#191712' : '#FFFFFF',
          border: allDay ? 'none' : '1px solid #E8E1CE',
          color: allDay ? '#FDF8E7' : '#6C6553',
        }}>All day</button>
      </div>

      <div style={{ height: 1, background: '#F0EBDC', margin: '20px 0' }} />

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={EV_LABEL}>Calendar</span>
          <span style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
            <span style={{ ...EV_PILL, flex: 1, justifyContent: 'space-between' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{calLabel}</span>
              <ChevronDown size={13} strokeWidth={2} style={{ color: '#9B9180', flexShrink: 0 }} />
            </span>
            <select value={calId} onChange={e => setCalId(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              {writable.map(c => <option key={c.id} value={c.id}>{c.summaryOverride ?? c.summary}</option>)}
            </select>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={EV_LABEL}>Where</span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Add a place"
              style={{ ...EV_PILL, flex: 1, cursor: 'text', outline: 'none' }} />
            <button onClick={() => setAddMeet(v => !v)} title="Add a Google Meet link" style={{
              ...EV_PILL, flexShrink: 0,
              background: addMeet ? '#191712' : '#FFFFFF',
              border: addMeet ? 'none' : '1px solid #E8E1CE',
              color: addMeet ? '#FDF8E7' : '#6C6553',
            }}><Video size={13} /> Meet</button>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ ...EV_LABEL, paddingTop: 11 }}>Notes</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            placeholder="Anything worth remembering…"
            style={{
              flex: 1, minWidth: 0, boxSizing: 'border-box', resize: 'vertical',
              background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 9,
              padding: '9px 12px', fontSize: 13, color: '#191712', fontFamily: 'inherit',
              outline: 'none', textAlign: 'left',
            }} />
        </div>
      </div>

      <div style={{ height: 1, background: '#F0EBDC', margin: '20px 0' }} />

      {/* Attendees */}
      <div style={{ ...EV_SECTION, marginBottom: 10 }}>Attendees</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {invitees.map(email => (
          <div key={email} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '5px 0', minWidth: 0 }}>
            <span style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#F1ECDE', color: '#6C6553', fontSize: 10.5, fontWeight: 700,
            }}>{evInitials(undefined, email)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </span>
            <button onClick={() => setInvitees(prev => prev.filter(x => x !== email))} title="Remove"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9C0A8', padding: 2, display: 'flex' }}>
              <X size={13} />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '5px 0' }}>
          <span style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px dashed #D8CFB8', color: '#C9C0A8',
          }}><Plus size={14} /></span>
          <input
            value={inviteeInput}
            onChange={e => setInviteeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addInvitee(inviteeInput) } }}
            onBlur={() => addInvitee(inviteeInput)}
            placeholder="name@company.com"
            style={{ ...EV_PILL, flex: 1, cursor: 'text', outline: 'none' }} />
        </div>
      </div>

      {/* Create */}
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={handleSave} disabled={!title.trim()} style={{
          ...EV_PILL, flex: 1, justifyContent: 'center', fontWeight: 600,
          background: title.trim() ? '#191712' : '#EDE7D9',
          border: 'none', color: title.trim() ? '#FDF8E7' : '#9B9180',
          cursor: title.trim() ? 'pointer' : 'default',
        }}>Create event</button>
        <button onClick={onCancel} style={{ ...EV_PILL, color: '#6C6553' }}>Cancel</button>
      </div>
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
  const weekStart = useMemo(() => getWeekStart(anchorDate), [anchorDate])
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
    return calColors[cal.id] ?? cal.backgroundColor ?? '#7F77DD'
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
    const onMove = (e: MouseEvent) => {
      if (!gridRef.current) return
      const rect = gridRef.current.getBoundingClientRect()
      const relY = e.clientY - rect.top + gridRef.current.scrollTop
      const minutes = Math.max(0, Math.min(23 * 60 + 45,
        Math.round((relY / HOUR_PX * 60) / SNAP_MIN) * SNAP_MIN))
      setCreatingEvt(prev => prev ? { ...prev, currentMin: minutes } : null)
    }
    const onUp = (e: MouseEvent) => {
      const cur = creatingRef.current
      setCreatingEvt(null)
      if (!cur) return
      const startMin = Math.min(cur.originMin, cur.currentMin)
      const endMin   = Math.max(cur.originMin + SNAP_MIN, cur.currentMin)
      if (endMin - startMin >= SNAP_MIN) {
        setNewEventDraft({ dateStr: cur.dateStr, startMin, endMin, anchorX: e.clientX, anchorY: e.clientY })
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [!!creatingEvt]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.event-card, button, [role="button"], select')) return
    if (draggingEvt) return
    if (!gridRef.current) return
    const rect   = gridRef.current.getBoundingClientRect()
    const relX   = e.clientX - rect.left - 52
    const relY   = e.clientY - rect.top  + gridRef.current.scrollTop
    if (relX < 0) return
    const dayIdx = Math.max(0, Math.min(6, Math.floor(relX / ((gridRef.current.clientWidth - 52) / 7))))
    const day    = weekDays[dayIdx]
    if (!day) return
    const minutes = Math.max(0, Math.min(23 * 60, Math.round((relY / HOUR_PX * 60) / SNAP_MIN) * SNAP_MIN))
    const dateStr = localDateStr(day)
    const startX = e.clientX, startY = e.clientY
    let started = false

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    const onMove = (me: MouseEvent) => {
      if (started) return
      if (Math.sqrt((me.clientX - startX) ** 2 + (me.clientY - startY) ** 2) >= 8) {
        started = true; cleanup()
        setCreatingEvt({ dateStr, originMin: minutes, currentMin: minutes })
        setSelectedEvent(null); setNewEventDraft(null)
      }
    }
    const onUp = cleanup

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
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
  useEffect(() => {
    if (!gridRef.current) return
    // The day starts at 07:00 — open the grid there, not at midnight
    gridRef.current.scrollTo({ top: 7 * HOUR_PX, behavior: 'smooth' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Calendar loading ────────────────────────────────────────────────────────
  const reloadCalendars = useCallback(async () => {
    if (!user?.email) return  // wait for user — prevents concurrent double-call race
    // Persist primary email for the initial-render cache cleanup on next page load
    localStorage.setItem('cal-intel-primary-email', user.email)
    // Clear stale calendar list cache so newly subscribed/added calendars always appear
    localStorage.removeItem(CAL_INTEL_CACHE_KEY)
    const { calendars: fresh, needsReconnect } = await loadAllCalendars(user.email)
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
      const gridStart = getWeekStart(first)
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
      saveEventStatuses(next); return next
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
      setEvents(prev => prev.filter(e => e.id !== ev.id))
      if (selectedEvent?.id === ev.id) setSelectedEvent(null)
    }
  }

  async function handleMoveEvent(ev: GCalEventExt, targetCalId: string): Promise<boolean> {
    const srcCal  = allCalendars.find(c => c.id === ev.calendarId)
    const destCal = allCalendars.find(c => c.id === targetCalId)
    if (!srcCal || !destCal || !ev.calendarId) return false
    const token = srcCal.accountId
      ? await getGoogleToken(srcCal.accountEmail)
      : (await refreshPrimaryToken() || srcCal.accountToken)
    if (!token) return false
    const moved = await moveCalendarEventWithToken(token, ev.calendarId, ev.id, targetCalId)
    if (moved) {
      const update = { calendarId: targetCalId, calendarColor: destCal.backgroundColor }
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, ...update } : e))
      setSelectedEvent(prev => prev?.id === ev.id ? { ...prev, ...update } as GCalEventExt : prev)
    }
    return !!moved
  }

  async function handleUpdateEvent(ev: GCalEventExt, patch: Partial<GCalEventCreate>): Promise<GCalEvent | null> {
    const cal = allCalendars.find(c => c.id === ev.calendarId)
    if (!cal || !ev.calendarId) return null
    let updated: GCalEvent | null = null
    if (cal.accountId) {
      const result = await efUpdateEvent(cal.accountId, ev.calendarId, ev.id, patch)
      updated = result.event
    } else {
      const token = await refreshPrimaryToken() || cal.accountToken
      if (!token) return null
      const result = await updateCalendarEvent(ev.calendarId, ev.id, patch)
      updated = result.event
    }
    if (updated) {
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, ...updated } : e))
      setSelectedEvent(prev => prev?.id === ev.id ? { ...prev, ...updated } as GCalEventExt : prev)
    }
    return updated
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
    const start = getWeekStart(first)
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d })
  }, [anchorDate])
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
      calendarId: data.calId, calendarColor: cal ? calEffectiveColor(cal) : '#7F77DD',
    } as GCalEventExt])

    const eventBody: GCalEventCreate = {
      summary:  data.title,
      start:    data.allDay ? { date: data.startDate }      : { dateTime: startIso, timeZone: tz },
      end:      data.allDay ? { date: data.endDate }        : { dateTime: endIso,   timeZone: tz },
      ...(data.location    && { location:    data.location }),
      ...(data.description && { description: data.description }),
      ...(data.invitees.length && { attendees: data.invitees }),
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
    <div className={creatingEvt ? 'cal-grid-creating' : undefined} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F7F4EA', color: '#191712', fontFamily: 'var(--sb-font-ui)', overflow: 'hidden' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 26px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Which stretch of time you are looking at */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', textTransform: 'uppercase', marginBottom: 3 }}>
              {calView === 'month' ? anchorDate.toLocaleDateString('en-GB', { year: 'numeric' })
                : calView === 'day' ? anchorDate.toLocaleDateString('en-GB', { weekday: 'long' })
                : `Week ${getWeekNumber(weekStart)}`}
            </div>
            <div style={{ fontFamily: 'var(--sb-font-num, "Outfit", sans-serif)', fontSize: 27, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
              {calView === 'month' ? anchorDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                : calView === 'day' ? anchorDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
                : fmtWeekRange(weekStart)}
            </div>
            <div style={{ fontSize: 11.5, color: '#6C6553', marginTop: 5 }}>
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
              style={{ ...CAL_ICON_BTN }}><ChevronLeft size={15} /></button>
            <button
              onClick={() => setAnchorDate(d => {
                const n = new Date(d)
                if (calView === 'day') n.setDate(n.getDate() + 1)
                else if (calView === 'month') n.setMonth(n.getMonth() + 1)
                else n.setDate(n.getDate() + 7)
                return n
              })}
              style={{ ...CAL_ICON_BTN }}><ChevronRight size={15} /></button>
            {!isThisWeek(weekStart) && (
              <button
                onClick={() => setAnchorDate(new Date())}
                style={{ ...CAL_PILL, background: '#F5D14E', border: 'none', fontWeight: 600, boxShadow: '0 1px 3px rgba(25,23,18,0.14)' }}
              >Today</button>
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
          ><RefreshCw size={14} style={{ animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }} /></button>

          <button
            onClick={() => void handleApplyRules()}
            disabled={applyingRules}
            title={applyingRules ? 'Applying rules…' : 'Apply productivity blocking rules'}
            style={{ ...CAL_ICON_BTN, cursor: applyingRules ? 'default' : 'pointer', opacity: applyingRules ? 0.6 : 1 }}
          ><Shield size={14} /></button>

          <button
            onClick={() => setOriginalsOnly(v => !v)}
            title={originalsOnly ? 'Showing originals only — click to show all events' : 'Show originals only (hide created blocks)'}
            style={{
              ...CAL_ICON_BTN,
              background: originalsOnly ? '#191712' : '#FFFFFF',
              borderColor: originalsOnly ? '#191712' : '#E8E1CE',
              color: originalsOnly ? '#FAF7EC' : '#6C6553',
            }}
          >{originalsOnly ? <EyeOff size={14} /> : <Eye size={14} />}</button>

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
              background: showCalendars ? '#191712' : '#FFFFFF',
              border: `1px solid ${showCalendars ? '#191712' : '#E8E1CE'}`,
              color: showCalendars ? '#FAF7EC' : '#191712',
            }}
          >
            <Layers size={14} strokeWidth={1.9} />
            Calendars
            <ChevronDown size={13} strokeWidth={2} style={{ transform: showCalendars ? 'rotate(180deg)' : 'none', transition: 'transform .14s' }} />
          </button>

          {/* Day · Week · Month */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 36, boxSizing: 'border-box', padding: 3, borderRadius: 999, background: '#EDE7D9', flexShrink: 0 }}>
            {(['day', 'week', 'month'] as const).map(v => {
              const on = calView === v
              return (
                <button
                  key={v}
                  onClick={() => { setCalView(v); try { localStorage.setItem('cal-view', v) } catch { /* noop */ } }}
                  style={{
                    height: 30, padding: '0 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: on ? '#FFFFFF' : 'transparent',
                    boxShadow: on ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
                    color: on ? '#191712' : '#8A8271',
                    fontSize: 13, fontWeight: on ? 700 : 500, fontFamily: 'inherit',
                    transition: 'all .14s',
                  }}>
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              )
            })}
          </div>
        </div>

        {/* Rules result toast */}
        {rulesResult && (
          <span style={{ display: 'block', marginTop: 8, fontSize: 11.5, color: rulesResult.startsWith('Error') ? '#E05252' : '#1D9E75' }}>
            {rulesResult}
          </span>
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
                      borderRadius: 20, overflow: 'visible',
                      border: `1px solid ${hidden ? '#E8E1CE' : color}`,
                      background: hidden ? '#F7F4EA' : `${color}18`,
                      transition: 'all 0.12s',
                    }}
                  >
                    {/* Color dot — click to open picker */}
                    <button
                      onClick={e => { e.stopPropagation(); setPickerOpenId(pickerOpenId === cal.id ? null : cal.id) }}
                      title="Change color"
                      style={{
                        width: 24, height: 26, borderRadius: '20px 0 0 20px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: hidden ? '#C8C0AE' : color, border: '1px solid rgba(25,23,18,0.12)' }} />
                    </button>

                    {/* Name + eye toggle */}
                    <button
                      onClick={() => toggleCal(cal.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px 3px 2px', fontSize: 11,
                        color: hidden ? '#9B9180' : '#3D3926',
                      }}
                    >
                      <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cal.summary}
                      </span>
                      {hidden ? <EyeOff size={10} color="#9B9180" /> : <Eye size={10} color={color} />}
                    </button>

                    {/* Subtle reconnect badge — only shown when this account needs reconnect */}
                    {reconnectNeeded.includes(cal.accountEmail) && (
                      <button
                        onClick={e => { e.stopPropagation(); void connectAdditionalGoogleAccount(cal.accountEmail) }}
                        title={`Token expired for ${cal.accountEmail} — click to reconnect`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 5px 0 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      >
                        <AlertCircle size={11} color="#FF9500" />
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
          <div style={{ marginTop: 6, padding: '5px 10px', background: 'rgba(224,82,82,0.08)', border: '1px solid rgba(224,82,82,0.3)', borderRadius: 6, fontSize: 11, color: '#E05252', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={11} /> {fetchError}
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
        background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 16,
        boxShadow: '0 1px 3px rgba(25,23,18,0.05)',
      }}>

      {/* ── Month grid ───────────────────────────────────────────────────────── */}
      {calView === 'month' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '0 14px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', padding: '10px 0 6px' }}>
            {DAY_LABELS.map(d => (
              <span key={d} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#6C6553', textTransform: 'uppercase' }}>
                {d}
              </span>
            ))}
          </div>
          <div style={{
            flex: 1, minHeight: 0, display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridAutoRows: 'minmax(96px, 1fr)',
            background: '#E8E1CE', gap: 1, border: '1px solid #E8E1CE', borderRadius: 12, overflow: 'hidden',
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
                    background: outside ? '#FAF7EC' : '#FFFFFF', padding: '6px 7px',
                    display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, cursor: 'pointer',
                  }}>
                  <span style={{
                    alignSelf: 'flex-start', minWidth: 21, height: 21, padding: '0 5px', borderRadius: 999,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: isToday ? '#F5D14E' : 'transparent',
                    color: outside ? '#C9C0A8' : '#191712',
                    fontSize: 11.5, fontWeight: isToday ? 700 : 600, fontVariantNumeric: 'tabular-nums',
                  }}>{day.getDate()}</span>
                  {shown.map(e => {
                    const cal = allCalendars.find(c => c.id === (e as GCalEventExt).calendarId)
                    const col = cal ? calEffectiveColor(cal) : '#7F77DD'
                    const rgb = col.startsWith('#') ? hexRgbStr(col) : '127,119,221'
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
                          padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
                          background: `rgba(${rgb}, 0.16)`, border: `1px solid rgba(${rgb}, 0.4)`,
                          fontSize: 10.5, color: '#191712',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                        {t && <span style={{ color: '#6C6553', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                          {String(t.getHours()).padStart(2, '0')}:{String(t.getMinutes()).padStart(2, '0')}
                        </span>}
                        {st === 'done' && <Check size={11} strokeWidth={3.4} style={{ flexShrink: 0 }} />}
                        <span style={{
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                          textDecoration: st === 'cancelled' ? 'line-through' : 'none',
                          textDecorationThickness: 1.5,
                        }}>{e.summary ?? '(no title)'}</span>
                      </span>
                    )
                  })}
                  {dayEvents.length > shown.length && (
                    <span style={{ fontSize: 10, color: '#9B9180' }}>+{dayEvents.length - shown.length} more</span>
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
          <div style={{ display: 'flex', borderBottom: '1px solid #E8E1CE', flexShrink: 0, background: '#FCFAF4' }}>
            {/* Time gutter spacer */}
            <div style={{ width: 58, flexShrink: 0 }} />
            {weekDays.map(day => {
              const ds      = localDateStr(day)
              const isToday = ds === today
              return (
                <div key={ds} style={{ flex: 1, textAlign: 'center', padding: '9px 4px 8px', minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, color: isToday ? '#191712' : '#6C6553', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: 'var(--sb-font-ui)' }}>
                    {DAY_LABELS[day.getDay()]}
                  </div>
                  <div style={{
                    fontSize: 18, fontWeight: 700, lineHeight: 1.2, marginTop: 3,
                    color: isToday ? '#191712' : '#191712',
                    background: isToday ? '#F5D14E' : 'transparent',
                    width: isToday ? 32 : undefined, height: isToday ? 32 : undefined,
                    borderRadius: isToday ? '50%' : undefined,
                    display: isToday ? 'flex' : undefined, alignItems: isToday ? 'center' : undefined, justifyContent: isToday ? 'center' : undefined,
                    margin: isToday ? '3px auto 0' : undefined,
                    fontFamily: 'var(--sb-font-num, "Outfit", sans-serif)',
                  }}>
                    {day.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* All-day events strip — only shown when the week has at least one all-day event */}
          {weekDays.some(day => (grouped.get(localDateStr(day)) ?? []).some(e => !e.start.dateTime)) && (
            <div style={{ display: 'flex', borderBottom: '1px solid #E8E1CE', flexShrink: 0, minHeight: 22 }}>
              <div style={{ width: 58, flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 6, paddingTop: 3, fontSize: 9, color: '#9B9180', letterSpacing: '0.4px' }}>
                all day
              </div>
              {weekDays.map(day => {
                const ds = localDateStr(day)
                const allDayEvts = (grouped.get(ds) ?? []).filter(e => !e.start.dateTime)
                return (
                  <div key={ds} style={{ flex: 1, padding: '2px 2px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, borderRight: '1px solid #E8E1CE', maxHeight: 68, overflowY: 'auto' }}>
                    {allDayEvts.map(ev => {
                      const cal   = allCalendars.find(c => c.id === (ev as GCalEventExt).calendarId)
                      const color = cal ? calEffectiveColor(cal) : '#7F77DD'
                      const evStatus = eventStatuses[ev.id]
                      return (
                        <div
                          key={ev.id}
                          onClick={e => handleEventClick(ev as GCalEventExt, e)}
                          onContextMenu={e => handleEventContextMenu(ev as GCalEventExt, e)}
                          style={{
                            fontSize: 10, fontWeight: 600, color: '#fff',
                            background: `${color}CC`,
                            borderLeft: `2px solid ${color}`,
                            borderRadius: 3, padding: '1px 4px',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                        >
                          {evStatus === 'done' && <Check size={10} strokeWidth={3.4} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 2 }} />}
                          <span style={{ textDecoration: evStatus === 'cancelled' ? 'line-through' : 'none', textDecorationThickness: 1.5 }}>
                            {ev.summary ?? '(No title)'}
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
            style={{ flex: 1, overflowY: 'auto', display: 'flex', position: 'relative', background: '#FFFFFF' }}
          >
            {/* Time labels column, with the weather for the day it is showing */}
            <div style={{ width: 58, flexShrink: 0, position: 'relative', height: GRID_H, background: '#FCFAF4', borderRight: '1px solid #EDE7D9' }}>
              {Array.from({ length: 24 }, (_, h) => {
                const w = weather[`${weatherDay}T${String(h).padStart(2, '0')}`]
                return (
                  <div key={h} style={{
                    position: 'absolute', top: h * HOUR_PX - 7, right: 8,
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{ fontSize: 9.5, color: '#9B9180', fontWeight: 500, letterSpacing: '0.03em' }}>
                      {fmtHourLabel(h)}
                    </span>
                    {w && (
                      <span
                        title={`${w.temp}°C`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 1,
                          fontSize: 8.5, color: '#B5AA98', fontVariantNumeric: 'tabular-nums',
                        }}>
                        <span style={{ fontSize: 8.5, lineHeight: 1 }}>{weatherGlyph(w.code)}</span>
                        {w.temp}°
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Day columns */}
            <div style={{ flex: 1, display: 'flex', position: 'relative' }} onMouseDown={handleGridMouseDown}>
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
                        <div style={{ position: 'absolute', top: nowPx - 5, left: -5, width: 10, height: 10, borderRadius: '50%', background: '#191712', zIndex: 5, pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', top: nowPx, left: 0, right: 0, borderTop: '1.5px solid #191712', zIndex: 5, pointerEvents: 'none' }} />
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
                          background: 'rgba(245,209,78,0.35)', border: '2px solid #F5D14E',
                          borderRadius: 6, pointerEvents: 'none', boxSizing: 'border-box',
                        }}>
                          <div style={{ fontSize: 10, color: '#191712', padding: '2px 5px', fontWeight: 600 }}>
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
        <div style={{ position: 'absolute', bottom: 18, right: 22, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#9B9180', pointerEvents: 'none' }}>
          <div style={{ width: 14, height: 14, border: '2px solid #E8E1CE', borderTopColor: '#191712', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          Loading…
        </div>
      )}


      {/* No auth state */}
      {noAuth && !loadingEvents && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(247,244,234,0.93)', opacity: 0.9, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <Calendar size={36} color="#C8C0AE" />
            <p style={{ margin: '12px 0 0', fontSize: 14, color: '#9B9180' }}>Connect Google Calendar to see your events</p>
          </div>
        </div>
      )}

      </div>

      {/* Event panel — a column of its own, beside the grid */}
      {selectedEvent && (() => {
        const cal      = allCalendars.find(c => c.id === (selectedEvent as GCalEventExt).calendarId)
        const calName  = cal?.summary ?? 'Calendar'
        const calColor = cal ? calEffectiveColor(cal) : '#7F77DD'
        return (
          <EventPopup
            event={selectedEvent}
            status={eventStatuses[selectedEvent.id]}
            calName={calName}
            calColor={calColor}
            prep={prep}
            prepLoading={prepLoading}
            prepError={prepError}
            onClose={closePopup}
            onStatusToggle={s => toggleStatus(selectedEvent.id, s)}
            onPrepRequest={() => void generatePrep(selectedEvent)}
            onAddMeet={() => handleAddMeet(selectedEvent)}
            onSave={patch => handleUpdateEvent(selectedEvent, patch)}
            onDelete={() => void handleDeleteEvent(selectedEvent)}
            calendars={allCalendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')}
            onMoveCalendar={targetCalId => handleMoveEvent(selectedEvent, targetCalId)}
            clashes={(() => {
              // Anything on the same day whose span overlaps this one
              if (!selectedEvent.start.dateTime || !selectedEvent.end.dateTime) return []
              const s0 = new Date(selectedEvent.start.dateTime).getTime()
              const e0 = new Date(selectedEvent.end.dateTime).getTime()
              return (displayedEvents as GCalEventExt[]).filter(e => {
                if (e.id === selectedEvent.id || !e.start.dateTime || !e.end.dateTime) return false
                const s1 = new Date(e.start.dateTime).getTime()
                const e1 = new Date(e.end.dateTime).getTime()
                return s1 < e0 && e1 > s0
              })
            })()}
            onOpenEvent={e => setSelectedEvent(e)}
          />
        )
      })()}

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

      {/* New event form — shown after drag-to-create */}
      {newEventDraft && (
        <NewEventForm
          draft={newEventDraft}
          calendars={allCalendars}
          calColors={calColors}
          onSave={data => void handleCreateEvent(data)}
          onCancel={() => setNewEventDraft(null)}
        />
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0%,100% { background-position: 200% 0; } 50% { background-position: -200% 0; } }
        .event-card:hover .event-actions button { opacity: 1 !important; }
        .cal-grid-creating, .cal-grid-creating * { cursor: crosshair !important; }
      `}</style>
    </div>
  )
}
