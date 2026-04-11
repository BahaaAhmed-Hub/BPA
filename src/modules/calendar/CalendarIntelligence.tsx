import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Calendar, Video, Users,
  Sparkles, MapPin, RefreshCw, X, Eye, EyeOff,
  CheckCircle2, XCircle, Link, Phone, Repeat, User,
  ExternalLink, AlertCircle, Shield,
} from 'lucide-react'
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
  refreshPrimaryToken,
  createCalendarEventWithToken,
} from '@/lib/googleCalendar'
import type { GCalEvent, GCalCalendar } from '@/lib/googleCalendar'
import { getGoogleToken, seedToken } from '@/lib/tokenManager'
import { generateMeetingPrep } from '@/lib/professor'
import type { MeetingPrep } from '@/lib/professor'
import { useAuthStore } from '@/store/authStore'
import { loadAccounts, loadHiddenAccounts } from '@/lib/multiAccount'
import { connectAdditionalGoogleAccount } from '@/lib/google'
import type { DbUser, DbCompany, DbCalendarEvent } from '@/types/database'
import {
  loadBlockingRules, applyBlockingRules, cleanupStaleBlocks,
  type SourceEvent,
} from '@/lib/blockingRules'

// ─── Grid constants ───────────────────────────────────────────────────────────
const HOUR_PX  = 56     // pixels per hour
const SNAP_MIN = 15     // snap to 15-minute increments
const GRID_H   = HOUR_PX * 24  // total grid height (24h)

// ─── Types ────────────────────────────────────────────────────────────────────
type GCalEventExt = GCalEvent & { calendarId?: string; calendarColor?: string }
type EventStatus  = 'done' | 'cancelled'
type DragMode     = 'move' | 'resize-top' | 'resize-bottom'
interface EventLayout { left: number; width: number }
interface CreatingEvt  { dateStr: string; originMin: number; currentMin: number }
interface NewEventDraft { dateStr: string; startMin: number; endMin: number; anchorX: number; anchorY: number }

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
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: '#1E40AF', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: '#1D9E75', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: '#888780', calendar_id: null, is_active: true },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Date/time helpers ────────────────────────────────────────────────────────
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

function loadEventStatuses(): Record<string, EventStatus> {
  try { const r = localStorage.getItem('cal-event-statuses'); return r ? JSON.parse(r) as Record<string,EventStatus> : {} } catch { return {} }
}
function saveEventStatuses(s: Record<string, EventStatus>) { localStorage.setItem('cal-event-statuses', JSON.stringify(s)) }

function loadCalColors(): Record<string, string> {
  try { const r = localStorage.getItem('cal-intel-colors'); return r ? JSON.parse(r) as Record<string,string> : {} } catch { return {} }
}
function saveCalColors(s: Record<string, string>) { localStorage.setItem('cal-intel-colors', JSON.stringify(s)) }

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
      const token = await getGoogleToken(account.email)

      if (!token) {
        // Edge Function returned reconnect_required — flag and return cached chips
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
  const active = allCals.filter(c => !hidden.has(c.id) && !hiddenAccts.has(c.accountEmail))
  if (!active.length) return []

  // Primary token: existing GoTrue-backed refresh (works reliably for primary).
  // Extra accounts: tokenManager calls the Edge Function which exchanges the
  // stored Google refresh token — no more 60-min expiry, no rotation conflicts.
  await refreshPrimaryToken()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  const results = await Promise.all(
    active.map(async c => {
      const token = c.accountId
        ? await getGoogleToken(c.accountEmail)  // Edge Function path
        : (primaryToken || c.accountToken)       // GoTrue path
      if (!token) return [] as GCalEvent[]
      return fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor)
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
      background: '#161929', border: '1px solid #252A3E', borderRadius: 10,
      padding: '10px 10px 8px', boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
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
      borderRight: '1px solid #1A1D2E',
      background: isToday ? 'rgba(30,64,175,0.04)' : isOver ? 'rgba(30,64,175,0.07)' : 'transparent',
      transition: 'background 0.1s', minWidth: 0,
    }}>
      {/* Hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} style={{ position: 'absolute', top: h * HOUR_PX, left: 0, right: 0, borderTop: '1px solid #1A1D2E', pointerEvents: 'none' }} />
      ))}
      {/* Half-hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={`h${h}`} style={{ position: 'absolute', top: h * HOUR_PX + HOUR_PX / 2, left: 0, right: 0, borderTop: '1px dashed #141722', pointerEvents: 'none' }} />
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
function EventBlock({ event, layout, status, isSelected, isDragSrc, isDragOverlay, colorOverride, onStatusToggle, onClick }: {
  event: GCalEventExt
  layout: EventLayout
  status: EventStatus | undefined
  isSelected: boolean
  isDragSrc: boolean
  isDragOverlay?: boolean
  colorOverride?: string
  onStatusToggle: (s: EventStatus) => void
  onClick: (e: React.MouseEvent) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: event.id,
    disabled: isDragOverlay,
  })

  const isAllDay = !event.start.dateTime
  if (isAllDay) return null

  const top    = eventTopPx(event.start.dateTime!)
  const height = eventHeightPx(event.start.dateTime!, event.end.dateTime ?? event.start.dateTime!)
  const color  = colorOverride ?? event.calendarColor ?? '#1E40AF'
  const isDone = status === 'done'
  const isCancelled = status === 'cancelled'

  const baseAlpha = isDone || isCancelled ? '88' : 'CC'

  return (
    <div
      ref={setNodeRef}
      {...(isDragOverlay ? {} : listeners)}
      {...(isDragOverlay ? {} : attributes)}
      onClick={onClick}
      className="event-card"
      style={{
        position: isDragOverlay ? 'relative' : 'absolute',
        top:    isDragOverlay ? undefined : top,
        left:   isDragOverlay ? undefined : `${layout.left}%`,
        width:  isDragOverlay ? 130 : `${layout.width}%`,
        height: isDragOverlay ? Math.max(38, height) : height,
        background: `${color}${baseAlpha}`,
        borderRadius: 5,
        borderLeft: `3px solid ${color}`,
        padding: '3px 5px 8px',
        overflow: 'hidden',
        cursor: isDragOverlay ? 'grabbing' : 'pointer',
        opacity: isDragSrc ? 0.3 : 1,
        transform: isDragOverlay ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? 'none' : 'box-shadow 0.12s, opacity 0.12s',
        boxSizing: 'border-box',
        zIndex: isSelected ? 4 : 2,
        boxShadow: isSelected
          ? `0 0 0 2px ${color}, 0 4px 14px rgba(0,0,0,0.4)`
          : '0 1px 3px rgba(0,0,0,0.25)',
        userSelect: 'none',
      }}
    >
      <div style={{
        fontSize: height < 30 ? 10 : 11,
        fontWeight: 600,
        color: '#fff',
        lineHeight: 1.25,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: height < 36 ? 'nowrap' : 'normal',
        textDecoration: isCancelled ? 'line-through' : 'none',
      }}>
        {isDone && <span style={{ marginRight: 3, fontSize: 9 }}>✓</span>}
        {isCancelled && <span style={{ marginRight: 3, fontSize: 9 }}>✗</span>}
        {event.summary ?? '(No title)'}
      </div>
      {height >= 38 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
          {fmtShort(event.start.dateTime!)}
          {event.end.dateTime ? ` – ${fmtShort(event.end.dateTime)}` : ''}
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
              background: isDone ? 'rgba(29,158,117,0.9)' : 'rgba(0,0,0,0.35)',
              color: isDone ? '#fff' : 'rgba(255,255,255,0.65)',
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
              background: isCancelled ? 'rgba(224,82,82,0.9)' : 'rgba(0,0,0,0.35)',
              color: isCancelled ? '#fff' : 'rgba(255,255,255,0.65)',
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

// ─── EventPopup (macOS Calendar style — complete fields) ─────────────────────
function EventPopup({ event, status, calName, calColor, prep, prepLoading, prepError, pos, onClose, onStatusToggle, onPrepRequest }: {
  event: GCalEventExt
  status: EventStatus | undefined
  calName: string
  calColor: string
  prep: MeetingPrep | null
  prepLoading: boolean
  prepError: string | null
  pos: { x: number; y: number }
  onClose: () => void
  onStatusToggle: (s: EventStatus) => void
  onPrepRequest: () => void
}) {
  const popupRef  = useRef<HTMLDivElement>(null)
  const [showPrep, setShowPrep] = useState(false)
  const [adjPos, setAdjPos]     = useState(pos)

  useEffect(() => {
    if (!popupRef.current) return
    const { width, height } = popupRef.current.getBoundingClientRect()
    let x = pos.x + 14, y = pos.y
    if (x + width  > window.innerWidth  - 12) x = pos.x - width - 14
    if (y + height > window.innerHeight - 12) y = window.innerHeight - height - 12
    if (y < 8) y = 8
    setAdjPos({ x, y })
  }, [pos.x, pos.y, showPrep])

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  const isAllDay     = !event.start.dateTime
  const startIso     = event.start.dateTime ?? (event.start.date + 'T00:00:00')
  const endIso       = event.end.dateTime   ?? (event.end.date   + 'T00:00:00')
  const entryPoints  = event.conferenceData?.entryPoints ?? []
  const videoLink    = entryPoints.find(ep => ep.entryPointType === 'video')?.uri
  const phoneEntry   = entryPoints.find(ep => ep.entryPointType === 'phone')
  const allAttendees = event.attendees ?? []
  const selfAttendee = allAttendees.find(a => a.self)
  const others       = allAttendees.filter(a => !a.self)
  const organizer    = event.organizer
  const isOrganizer  = organizer?.self !== false || !organizer
  const isRecurring  = !!event.recurringEventId || (event.recurrence?.length ?? 0) > 0
  const isTentative  = event.status === 'tentative'
  const notes        = event.description?.replace(/<[^>]*>/g, '').trim() ?? ''

  const rsvpColor = (s?: string) => s === 'accepted' ? '#1D9E75' : s === 'declined' ? '#E05252' : s === 'tentative' ? '#FF9500' : '#6B7280'
  const rsvpLabel = (s?: string) => s === 'accepted' ? 'Accepted' : s === 'declined' ? 'Declined' : s === 'tentative' ? 'Maybe' : 'Awaiting'

  const btn = (active: boolean, color: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 11px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
    background: active ? `${color}22` : 'transparent',
    border: `1px solid ${active ? color : '#2A2F45'}`,
    color: active ? color : '#8B93A8',
    transition: 'all 0.12s',
  })

  return (
    <div ref={popupRef} onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: adjPos.y, left: adjPos.x,
      width: 320, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
      background: '#161929', border: '1px solid #252A3E', borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)', zIndex: 1000,
    }}>
      {/* Color bar */}
      <div style={{ height: 4, background: calColor, flexShrink: 0 }} />

      {/* Title + status badges + close */}
      <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#E8EAF6', lineHeight: 1.3 }}>
            {event.summary ?? '(No title)'}
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
            {isTentative && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#FF950022', color: '#FF9500', border: '1px solid #FF950055' }}>Tentative</span>
            )}
            {isRecurring && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#7F77DD22', color: '#7F77DD', border: '1px solid #7F77DD55', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Repeat size={9} /> Recurring
              </span>
            )}
            {selfAttendee && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: `${rsvpColor(selfAttendee.responseStatus)}22`, color: rsvpColor(selfAttendee.responseStatus), border: `1px solid ${rsvpColor(selfAttendee.responseStatus)}55` }}>
                {rsvpLabel(selfAttendee.responseStatus)}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 0, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>
          <X size={15} />
        </button>
      </div>

      {/* Fields */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>

        {/* Date / time */}
        <Row icon={<Calendar size={13} color="#6B7280" />}>
          <span style={{ fontSize: 13, color: '#C0C4D6' }}>{fmtPopupDate(startIso, endIso, isAllDay)}</span>
        </Row>

        {/* Calendar */}
        <Row icon={<div style={{ width: 11, height: 11, borderRadius: '50%', background: calColor, flexShrink: 0, marginTop: 1 }} />}>
          <span style={{ fontSize: 13, color: '#C0C4D6' }}>{calName}</span>
        </Row>

        {/* Location */}
        {event.location && (
          <Row icon={<MapPin size={13} color="#6B7280" />}>
            <span style={{ fontSize: 13, color: '#C0C4D6' }}>{event.location}</span>
          </Row>
        )}

        {/* Video call */}
        {videoLink && (
          <Row icon={<Video size={13} color="#6B7280" />}>
            <a href={videoLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: '#7F77DD', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              Join video call <ExternalLink size={11} />
            </a>
          </Row>
        )}

        {/* Phone conference */}
        {phoneEntry && (
          <Row icon={<Phone size={13} color="#6B7280" />}>
            <div style={{ fontSize: 13, color: '#C0C4D6' }}>
              <a href={phoneEntry.uri} style={{ color: '#7F77DD', textDecoration: 'none' }}>
                {phoneEntry.label ?? phoneEntry.uri.replace('tel:', '')}
              </a>
              {phoneEntry.pin && <span style={{ color: '#6B7280', marginLeft: 6, fontSize: 12 }}>PIN: {phoneEntry.pin}</span>}
            </div>
          </Row>
        )}

        {/* Organizer (only if someone else organized it) */}
        {organizer && !organizer.self && !isOrganizer && (
          <Row icon={<User size={13} color="#6B7280" />}>
            <span style={{ fontSize: 13, color: '#C0C4D6' }}>
              {organizer.displayName ?? organizer.email}
              <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 5 }}>· organizer</span>
            </span>
          </Row>
        )}

        {/* Attendees */}
        {others.length > 0 && (
          <Row icon={<Users size={13} color="#6B7280" />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {others.slice(0, 6).map(a => (
                <div key={a.email} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ flex: 1, color: '#C0C4D6', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.displayName ?? a.email}
                  </span>
                  <span style={{ fontSize: 10, color: rsvpColor(a.responseStatus), flexShrink: 0, fontWeight: 500 }}>
                    {a.responseStatus === 'accepted' ? '✓' : a.responseStatus === 'declined' ? '✗' : a.responseStatus === 'tentative' ? '?' : '–'}
                  </span>
                </div>
              ))}
              {others.length > 6 && (
                <span style={{ fontSize: 11, color: '#6B7280' }}>+{others.length - 6} more</span>
              )}
            </div>
          </Row>
        )}

        {/* Google Calendar link */}
        {event.htmlLink && (
          <Row icon={<Link size={13} color="#6B7280" />}>
            <a href={event.htmlLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: '#7F77DD', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open in Google Calendar <ExternalLink size={11} />
            </a>
          </Row>
        )}

        {/* Notes / Description */}
        {notes && (
          <div style={{ borderTop: '1px solid #1E2235', paddingTop: 10, marginTop: 2 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#4B5268', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 5 }}>Notes</div>
            <div style={{ fontSize: 12, color: '#8B93A8', lineHeight: 1.6, maxHeight: 90, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {notes.slice(0, 400)}{notes.length > 400 ? '…' : ''}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ padding: '8px 14px 12px', display: 'flex', gap: 6, borderTop: '1px solid #1E2235', flexWrap: 'wrap' }}>
        <button style={btn(status === 'done', '#1D9E75')} onClick={() => onStatusToggle('done')}>
          <CheckCircle2 size={12} /> Done
        </button>
        <button style={btn(status === 'cancelled', '#E05252')} onClick={() => onStatusToggle('cancelled')}>
          <XCircle size={12} /> Cancel
        </button>
        <button
          style={{ ...btn(showPrep, '#7F77DD'), marginLeft: 'auto' }}
          onClick={() => { setShowPrep(p => !p); if (!prep && !prepLoading) onPrepRequest() }}
        >
          <Sparkles size={12} /> AI Prep
        </button>
      </div>

      {/* AI Prep section */}
      {showPrep && (
        <div style={{ borderTop: '1px solid #1E2235', padding: '12px 16px 16px' }}>
          {prepLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[75, 55, 85, 65].map((w, i) => (
                <div key={i} style={{ height: 9, width: `${w}%`, borderRadius: 3, background: 'linear-gradient(90deg, #1E2235 25%, #252A3E 50%, #1E2235 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
              ))}
            </div>
          ) : prepError ? (
            <p style={{ margin: 0, fontSize: 12, color: '#E05252' }}>{prepError}</p>
          ) : prep ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {prep.goal && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>Goal</div>
                  <div style={{ fontSize: 12, color: '#C0C4D6', lineHeight: 1.55 }}>{prep.goal}</div>
                </div>
              )}
              {prep.talkingPoints?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>Talking Points</div>
                  {prep.talkingPoints.map((pt, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12, color: '#C0C4D6', lineHeight: 1.45, marginBottom: 4 }}>
                      <span style={{ color: '#6B7280', flexShrink: 0 }}>{i+1}.</span>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}>Generating prep…</p>
          )}
        </div>
      )}
    </div>
  )
}

// Small helper used by EventPopup rows
function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
      <div style={{ flexShrink: 0, marginTop: 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

// ─── NewEventForm ─────────────────────────────────────────────────────────────
function NewEventForm({ draft, calendars, calColors, onSave, onCancel }: {
  draft: NewEventDraft
  calendars: CalWithAccount[]
  calColors: Record<string, string>
  onSave: (title: string, calId: string) => void
  onCancel: () => void
}) {
  const writable   = calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
  const defaultCal = writable.find(c => c.primary) ?? writable[0]
  const [title,  setTitle]  = useState('')
  const [calId,  setCalId]  = useState(defaultCal?.id ?? '')
  const [pos,    setPos]    = useState({ x: draft.anchorX + 16, y: draft.anchorY - 40 })
  const ref      = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (!ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    let x = draft.anchorX + 16, y = draft.anchorY - 40
    if (x + width  > window.innerWidth  - 12) x = draft.anchorX - width - 16
    if (y + height > window.innerHeight - 12) y = window.innerHeight - height - 12
    if (y < 8) y = 8
    setPos({ x, y })
  }, [draft.anchorX, draft.anchorY])

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onCancel() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onCancel])

  const startIso = minToIso(draft.dateStr, draft.startMin)
  const endIso   = minToIso(draft.dateStr, draft.endMin)
  const calColor = calColors[calId] ?? calendars.find(c => c.id === calId)?.backgroundColor ?? '#7F77DD'

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: pos.y, left: pos.x, width: 288, zIndex: 1100,
      background: '#161929', border: '1px solid #252A3E', borderRadius: 12,
      boxShadow: '0 16px 48px rgba(0,0,0,0.6)', padding: '14px 16px 12px',
    }}>
      <div style={{ height: 3, background: calColor, borderRadius: 2, marginBottom: 12 }} />
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>New Event</div>

      <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && title.trim()) onSave(title.trim(), calId); if (e.key === 'Escape') onCancel() }}
        placeholder="Event title"
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 10,
          background: '#1E2235', border: '1px solid #2A2F45', borderRadius: 7,
          color: '#E8EAF6', fontSize: 14, padding: '8px 10px', outline: 'none',
        }}
      />

      <div style={{ fontSize: 12, color: '#8B93A8', marginBottom: 10 }}>
        {fmtPopupDate(startIso, endIso, false)}
      </div>

      {writable.length > 1 && (
        <select value={calId} onChange={e => setCalId(e.target.value)} style={{
          width: '100%', marginBottom: 12, background: '#1E2235', border: '1px solid #2A2F45',
          borderRadius: 7, color: '#C0C4D6', fontSize: 12, padding: '6px 8px', outline: 'none', cursor: 'pointer',
        }}>
          {writable.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
        </select>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          background: 'transparent', border: '1px solid #2A2F45', borderRadius: 7,
          color: '#6B7280', fontSize: 12, padding: '5px 14px', cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={() => { if (title.trim()) onSave(title.trim(), calId) }} style={{
          background: title.trim() ? '#7F77DD' : '#252A3E', border: 'none', borderRadius: 7,
          color: title.trim() ? '#fff' : '#4B5268', fontSize: 12, padding: '5px 14px',
          cursor: title.trim() ? 'pointer' : 'default', transition: 'background 0.15s',
        }}>Save</button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CalendarIntelligence() {
  const user = useAuthStore(s => s.user)

  // ── Calendar + event state ──────────────────────────────────────────────────
  const [weekStart,       setWeekStart]       = useState<Date>(() => getWeekStart(new Date()))
  const [events,          setEvents]          = useState<GCalEvent[]>([])
  const [allCalendars,    setAllCalendars]    = useState<CalWithAccount[]>(() => {
    // Use the last known primary email (saved to localStorage after each successful auth)
    // so we can filter orphaned deleted-account entries even on the very first render.
    const savedPrimaryEmail = localStorage.getItem('cal-intel-primary-email') ?? undefined
    const c = loadCalIntelCache(savedPrimaryEmail)
    return c.length ? rebuildFromCache(c) : []
  })
  const [hiddenCals,      setHiddenCals]      = useState<Set<string>>(loadHiddenIntel)
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(loadHiddenAccounts)
  const [loadingEvents,   setLoadingEvents]   = useState(true)
  const [noAuth,          setNoAuth]          = useState(false)
  const [fetchError,      setFetchError]      = useState<string | null>(null)
  const [reconnectNeeded, setReconnectNeeded] = useState<string[]>([])
  const [applyingRules,   setApplyingRules]   = useState(false)
  const [rulesResult,     setRulesResult]     = useState<string | null>(null)

  // ── Popup + prep state ──────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState<GCalEventExt | null>(null)
  const [popupPos,      setPopupPos]      = useState<{ x: number; y: number } | null>(null)
  const [prep,          setPrep]          = useState<MeetingPrep | null>(null)
  const [prepLoading,   setPrepLoading]   = useState(false)
  const [prepError,     setPrepError]     = useState<string | null>(null)
  const [eventStatuses, setEventStatuses] = useState<Record<string, EventStatus>>(loadEventStatuses)
  const [calColors,     setCalColorsMap]  = useState<Record<string, string>>(loadCalColors)
  const [pickerOpenId,  setPickerOpenId]  = useState<string | null>(null)

  function setCalColor(id: string, color: string) {
    setCalColorsMap(prev => { const next = { ...prev, [id]: color }; saveCalColors(next); return next })
  }

  // Effective color: custom override > google color > fallback
  function calEffectiveColor(cal: CalWithAccount): string {
    return calColors[cal.id] ?? cal.backgroundColor ?? '#1E40AF'
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
    const rect       = gridRef.current.getBoundingClientRect()
    const relX       = e.clientX - rect.left - 52
    const relY       = e.clientY - rect.top  + gridRef.current.scrollTop
    if (relX < 0) return
    const dayIdx = Math.max(0, Math.min(6, Math.floor(relX / ((gridRef.current.clientWidth - 52) / 7))))
    const day    = weekDays[dayIdx]
    if (!day) return
    const minutes = Math.max(0, Math.min(23 * 60, Math.round((relY / HOUR_PX * 60) / SNAP_MIN) * SNAP_MIN))
    setCreatingEvt({ dateStr: localDateStr(day), originMin: minutes, currentMin: minutes })
    setSelectedEvent(null); setPopupPos(null); setNewEventDraft(null)
  }

  // ── Grid scroll ref (auto-scroll to current time on mount) ──────────────────
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (gridRef.current) {
      const top = Math.max(0, nowTopPx() - 120)
      gridRef.current.scrollTo({ top, behavior: 'smooth' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Calendar loading ────────────────────────────────────────────────────────
  const reloadCalendars = useCallback(async () => {
    if (!user?.email) return  // wait for user — prevents concurrent double-call race
    // Persist primary email for the initial-render cache cleanup on next page load
    localStorage.setItem('cal-intel-primary-email', user.email)
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

  const loadEvents = useCallback(async (start: Date, cals: CalWithAccount[], hidden: Set<string>, hiddenAccts = hiddenAccounts) => {
    setLoadingEvents(true); setFetchError(null)
    try {
      if (!cals.length) { setNoAuth(true); setEvents([]); return }
      const end     = getWeekEnd(start)
      const fetched = await fetchAllEvents(cals, hidden, hiddenAccts, start, end)
      setEvents(fetched); setNoAuth(false)

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

  useEffect(() => {
    if (allCalendars.length) void loadEvents(weekStart, allCalendars, hiddenCals, hiddenAccounts)
  }, [weekStart, allCalendars, hiddenCals, hiddenAccounts, loadEvents]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (selectedEvent?.id === ev.id) { setSelectedEvent(null); setPopupPos(null); return }
    setSelectedEvent(ev); setPopupPos({ x: e.clientX, y: e.clientY })
    setPrep(null); setPrepError(null)
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
    setSelectedEvent(null); setPopupPos(null)
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
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d })
  const grouped  = groupByDay(events)
  const today    = localDateStr(new Date())
  const [nowPx,  setNowPx] = useState(nowTopPx())
  useEffect(() => {
    const t = setInterval(() => setNowPx(nowTopPx()), 60000)
    return () => clearInterval(t)
  }, [])

  function closePopup() { setSelectedEvent(null); setPopupPos(null) }

  async function handleCreateEvent(title: string, calId: string) {
    const draft = newEventDraft
    setNewEventDraft(null)
    if (!draft) return
    const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone
    const startIso = minToIso(draft.dateStr, draft.startMin)
    const endIso   = minToIso(draft.dateStr, draft.endMin)
    const cal      = allCalendars.find(c => c.id === calId)
    const tempId   = `temp-${Date.now()}`
    // Optimistic add
    setEvents(prev => [...prev, {
      id: tempId, summary: title,
      start: { dateTime: startIso }, end: { dateTime: endIso },
      calendarId: calId, calendarColor: cal ? calEffectiveColor(cal) : '#7F77DD',
    } as GCalEventExt])
    const { event: created } = await createCalendarEventWithToken(
      cal?.accountToken ?? '',
      calId,
      { summary: title, start: { dateTime: startIso, timeZone: tz }, end: { dateTime: endIso, timeZone: tz } },
    )
    if (created) {
      setEvents(prev => prev.map(e => e.id === tempId
        ? { ...created, calendarId: calId, calendarColor: cal ? calEffectiveColor(cal) : undefined } as GCalEventExt
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
    <div className={creatingEvt ? 'cal-grid-creating' : undefined} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0D0F1E', color: '#E8EAF6', fontFamily: 'inherit', overflow: 'hidden' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #1A1D2E', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Week range title */}
          <span style={{ fontSize: 17, fontWeight: 700, color: '#E8EAF6', flex: 1, minWidth: 160 }}>
            {fmtWeekRange(weekStart)}
          </span>

          {/* Nav buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }}
              style={{ background: 'none', border: '1px solid #252A3E', borderRadius: 7, cursor: 'pointer', color: '#8B93A8', padding: '4px 8px', display: 'flex', alignItems: 'center' }}
            ><ChevronLeft size={15} /></button>

            {!isThisWeek(weekStart) && (
              <button
                onClick={() => setWeekStart(getWeekStart(new Date()))}
                style={{ background: 'none', border: '1px solid #252A3E', borderRadius: 7, cursor: 'pointer', color: '#8B93A8', padding: '4px 9px', fontSize: 12 }}
              >Today</button>
            )}

            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }}
              style={{ background: 'none', border: '1px solid #252A3E', borderRadius: 7, cursor: 'pointer', color: '#8B93A8', padding: '4px 8px', display: 'flex', alignItems: 'center' }}
            ><ChevronRight size={15} /></button>

            <button
              onClick={() => void reloadCalendars().then(c => { if (c) void loadEvents(weekStart, c, hiddenCals) })}
              style={{ background: 'none', border: '1px solid #252A3E', borderRadius: 7, cursor: 'pointer', color: '#8B93A8', padding: '4px 8px', display: 'flex', alignItems: 'center' }}
            ><RefreshCw size={13} /></button>

            <button
              onClick={() => void handleApplyRules()}
              disabled={applyingRules}
              title="Apply productivity blocking rules"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: '1px solid #252A3E', borderRadius: 7,
                cursor: applyingRules ? 'default' : 'pointer',
                color: applyingRules ? '#4B5268' : '#8B93A8',
                padding: '4px 8px', fontSize: 12,
                opacity: applyingRules ? 0.6 : 1,
              }}
            >
              <Shield size={13} />
              {applyingRules ? 'Applying…' : 'Apply Rules'}
            </button>
          </div>

          {/* Rules result toast */}
          {rulesResult && (
            <span style={{ fontSize: 11.5, color: rulesResult.startsWith('Error') ? '#E05252' : '#1D9E75', marginLeft: 4 }}>
              {rulesResult}
            </span>
          )}
        </div>

        {/* Calendar chips */}
        {allCalendars.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {allCalendars.filter(cal => !hiddenAccounts.has(cal.accountEmail)).map(cal => {
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
                      border: `1px solid ${hidden ? '#252A3E' : color}`,
                      background: hidden ? 'transparent' : `${color}18`,
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
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: hidden ? '#3A3F55' : color, border: '1px solid rgba(255,255,255,0.2)' }} />
                    </button>

                    {/* Name + eye toggle */}
                    <button
                      onClick={() => toggleCal(cal.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px 3px 2px', fontSize: 11,
                        color: hidden ? '#4B5268' : '#C0C4D6',
                      }}
                    >
                      <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cal.summary}
                      </span>
                      {hidden ? <EyeOff size={10} color="#4B5268" /> : <Eye size={10} color={color} />}
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
          <div style={{ marginTop: 6, padding: '5px 10px', background: '#1E1216', border: '1px solid #4A1A24', borderRadius: 6, fontSize: 11, color: '#E05252', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={11} /> {fetchError}
          </div>
        )}
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Sticky day headers */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1A1D2E', flexShrink: 0 }}>
            {/* Time gutter spacer */}
            <div style={{ width: 52, flexShrink: 0 }} />
            {weekDays.map(day => {
              const ds      = localDateStr(day)
              const isToday = ds === today
              return (
                <div key={ds} style={{ flex: 1, textAlign: 'center', padding: '8px 4px 7px', minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: isToday ? '#7F77DD' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    {DAY_LABELS[day.getDay()]}
                  </div>
                  <div style={{
                    fontSize: 19, fontWeight: 700, lineHeight: 1.2, marginTop: 2,
                    color: isToday ? '#fff' : '#C0C4D6',
                    background: isToday ? '#7F77DD' : 'transparent',
                    width: isToday ? 32 : undefined, height: isToday ? 32 : undefined,
                    borderRadius: isToday ? '50%' : undefined,
                    display: isToday ? 'flex' : undefined, alignItems: isToday ? 'center' : undefined, justifyContent: isToday ? 'center' : undefined,
                    margin: isToday ? '2px auto 0' : undefined,
                  }}>
                    {day.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Scrollable time grid */}
          <div ref={gridRef} onClick={closePopup}
            style={{ flex: 1, overflowY: 'auto', display: 'flex', position: 'relative' }}
          >
            {/* Time labels column */}
            <div style={{ width: 52, flexShrink: 0, position: 'relative', height: GRID_H }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{
                  position: 'absolute', top: h * HOUR_PX - 7,
                  right: 8, fontSize: 10, color: '#3A3F55', whiteSpace: 'nowrap',
                }}>
                  {fmtHourLabel(h)}
                </div>
              ))}
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
                        <div style={{ position: 'absolute', top: nowPx - 5, left: -5, width: 10, height: 10, borderRadius: '50%', background: '#E05252', zIndex: 5, pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', top: nowPx, left: 0, right: 0, borderTop: '1.5px solid #E05252', zIndex: 5, pointerEvents: 'none' }} />
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
                          background: 'rgba(127,119,221,0.25)', border: '2px solid #7F77DD',
                          borderRadius: 5, pointerEvents: 'none', boxSizing: 'border-box',
                        }}>
                          <div style={{ fontSize: 10, color: '#fff', padding: '2px 5px', fontWeight: 600 }}>
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

      {/* Loading spinner overlay */}
      {loadingEvents && (
        <div style={{ position: 'absolute', bottom: 18, right: 22, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#6B7280', pointerEvents: 'none' }}>
          <div style={{ width: 14, height: 14, border: '2px solid #252A3E', borderTopColor: '#7F77DD', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          Loading…
        </div>
      )}


      {/* No auth state */}
      {noAuth && !loadingEvents && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,15,30,0.85)', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <Calendar size={36} color="#3A3F55" />
            <p style={{ margin: '12px 0 0', fontSize: 14, color: '#6B7280' }}>Connect Google Calendar to see your events</p>
          </div>
        </div>
      )}

      {/* Event popup */}
      {selectedEvent && popupPos && (() => {
        const cal      = allCalendars.find(c => c.id === (selectedEvent as GCalEventExt).calendarId)
        const calName  = cal?.summary ?? 'Calendar'
        const calColor = cal ? calEffectiveColor(cal) : '#1E40AF'
        return (
          <EventPopup
            event={selectedEvent}
            status={eventStatuses[selectedEvent.id]}
            calName={calName}
            calColor={calColor}
            prep={prep}
            prepLoading={prepLoading}
            prepError={prepError}
            pos={popupPos}
            onClose={closePopup}
            onStatusToggle={s => toggleStatus(selectedEvent.id, s)}
            onPrepRequest={() => void generatePrep(selectedEvent)}
          />
        )
      })()}

      {/* New event form — shown after drag-to-create */}
      {newEventDraft && (
        <NewEventForm
          draft={newEventDraft}
          calendars={allCalendars}
          calColors={calColors}
          onSave={(title, calId) => void handleCreateEvent(title, calId)}
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
