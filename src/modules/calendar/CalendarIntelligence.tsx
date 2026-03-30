import { useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Calendar, Video, Users,
  Sparkles, MapPin, RefreshCw, X, Eye, EyeOff, GripVertical,
  CheckCircle2, XCircle,
} from 'lucide-react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { detectMeetingType, listCalendars, listCalendarsWithToken, fetchCalendarEventsWithToken, updateCalendarEventDate } from '@/lib/googleCalendar'
import type { GCalEvent, GCalCalendar } from '@/lib/googleCalendar'
import { generateMeetingPrep } from '@/lib/professor'
import type { MeetingPrep } from '@/lib/professor'
import { useAuthStore } from '@/store/authStore'
import { loadAccounts, getProviderTokenForAccount } from '@/lib/multiAccount'
import { connectAdditionalGoogleAccount } from '@/lib/google'
import type { DbUser, DbCompany, DbCalendarEvent } from '@/types/database'

// ─── DnD helpers ─────────────────────────────────────────────────────────────

// Events from fetchCalendarEventsWithToken have calendarId/calendarColor added
type GCalEventExt = GCalEvent & { calendarId?: string; calendarColor?: string }

function DroppableDayTab({ dateKey, children, isOver }: { dateKey: string; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: over } = useDroppable({ id: `day-${dateKey}` })
  return (
    <div ref={setNodeRef} style={{ flex: '1 1 0', minWidth: 72, outline: (isOver ?? over) ? '2px solid #1E40AF60' : 'none', borderRadius: 10, transition: 'outline 0.1s' }}>
      {children}
    </div>
  )
}

function DraggableEventRow({ event, children }: { event: GCalEvent; children: (drag: { listeners: ReturnType<typeof useDraggable>['listeners']; attributes: ReturnType<typeof useDraggable>['attributes']; isDragging: boolean }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: event.id })
  return (
    <div ref={setNodeRef}>
      {children({ listeners, attributes, isDragging })}
    </div>
  )
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function loadHiddenIntel(): Set<string> {
  try {
    const raw = localStorage.getItem('cal-intel-hidden')
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}
function saveHiddenIntel(hidden: Set<string>) {
  localStorage.setItem('cal-intel-hidden', JSON.stringify([...hidden]))
}

type EventStatus = 'done' | 'cancelled'
function loadEventStatuses(): Record<string, EventStatus> {
  try {
    const raw = localStorage.getItem('cal-event-statuses')
    return raw ? (JSON.parse(raw) as Record<string, EventStatus>) : {}
  } catch { return {} }
}
function saveEventStatuses(statuses: Record<string, EventStatus>) {
  localStorage.setItem('cal-event-statuses', JSON.stringify(statuses))
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MOCK_COMPANIES: DbCompany[] = [
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: '#1E40AF', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: '#1D9E75', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: '#888780', calendar_id: null, is_active: true },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekEnd(start: Date): Date {
  const d = new Date(start)
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtWeekRange(start: Date): string {
  const end = getWeekEnd(start)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (start.getFullYear() !== new Date().getFullYear()) {
    opts.year = 'numeric'
  }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

function isThisWeek(start: Date): boolean {
  const thisWeek = getWeekStart(new Date())
  return start.getTime() === thisWeek.getTime()
}

function buildMockUser(user: { id: string; email: string; name?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo',
    email: user?.email ?? 'bahaa@example.com',
    full_name: user?.name ?? 'Bahaa Ahmed',
    avatar_url: null,
    active_framework: 'time_blocking',
    schedule_rules: {
      focus_hours: '09:00–12:00',
      buffer_minutes: 15,
      no_meeting_days: 'Wednesday',
      max_meetings_per_day: 4,
    },
    created_at: new Date().toISOString(),
  }
}

function gcalToDbEvent(e: GCalEvent): DbCalendarEvent {
  return {
    id:              e.id,
    user_id:         'demo',
    company_id:      null,
    google_event_id: e.id,
    title:           e.summary ?? '(No title)',
    start_time:      e.start.dateTime ?? e.start.date ?? '',
    end_time:        e.end.dateTime   ?? e.end.date   ?? '',
    location:        e.location ?? null,
    meeting_type:    detectMeetingType(e),
    prep_notes:      e.description ?? null,
    is_synced:       true,
  }
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDayKey(iso: string): string {
  return localDateStr(new Date(iso))
}

function groupByDay(events: GCalEvent[]): Map<string, GCalEvent[]> {
  const map = new Map<string, GCalEvent[]>()
  for (const e of events) {
    const key = getDayKey(e.start.dateTime ?? e.start.date ?? '')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return map
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skel({ w = '100%', h = 14, radius = 8 }: { w?: string | number; h?: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius, flexShrink: 0,
      background: 'linear-gradient(90deg, #252A3E 25%, #4A3E28 50%, #252A3E 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.6s infinite',
    }} />
  )
}

function EventSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{
          display: 'flex', gap: 12, alignItems: 'center',
          padding: '14px 16px', borderRadius: 10,
          background: '#161929', border: '1px solid #252A3E',
        }}>
          <Skel w={48} h={12} />
          <Skel w={3} h={36} radius={2} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skel w={`${65 - i * 8}%`} h={13} />
            <Skel w="30%" h={10} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PrepSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Skel w="85%" h={13} />
      <Skel w="70%" h={13} />
      <Skel w="90%" h={13} />
      <div style={{ height: 12 }} />
      <Skel w="40%" h={11} />
      <Skel w="75%" h={13} />
      <Skel w="60%" h={13} />
      <Skel w="68%" h={13} />
    </div>
  )
}

// ─── Meeting Type Icon ────────────────────────────────────────────────────────

function MeetingTypeIcon({ type }: { type: string | null }) {
  if (type === 'video')      return <Video    size={12} color="#7F77DD" />
  if (type === 'one_on_one') return <Users    size={12} color="#1D9E75" />
  if (type === 'external')   return <Calendar size={12} color="#1E40AF" />
  return                            <Users    size={12} color="#6B7280" />
}

// ─── Meeting Prep Panel ───────────────────────────────────────────────────────

function PrepPanel({
  event,
  prep,
  loading,
  error,
  onClose,
  onRetry,
}: {
  event: GCalEvent
  prep: MeetingPrep | null
  loading: boolean
  error: string | null
  onClose: () => void
  onRetry: () => void
}) {
  const dbEvent = gcalToDbEvent(event)
  const startLabel = fmtTime(dbEvent.start_time)
  const endLabel   = fmtTime(dbEvent.end_time)

  return (
    <div style={{
      background: '#161929',
      border: '1px solid #252A3E',
      borderLeft: '3px solid #1E40AF',
      borderRadius: 14,
      padding: '24px 24px 28px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div style={{ flex: 1, paddingRight: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: '#1E40AF18', border: '1px solid #1E40AF30',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={12} color="#1E40AF" />
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#1E40AF', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              AI Meeting Prep
            </span>
          </div>
          <h3 style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 700,
            color: '#E8EAF6',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            lineHeight: 1.3,
          }}>
            {event.summary ?? '(No title)'}
          </h3>
          <p style={{ margin: '5px 0 0', fontSize: 12, color: '#FFFFFF' }}>
            {startLabel} – {endLabel}
            {dbEvent.location && (
              <span style={{ marginLeft: 10 }}>
                <MapPin size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                {dbEvent.location}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#FFFFFF', padding: 4, lineHeight: 1, flexShrink: 0,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#252A3E', marginBottom: 20 }} />

      {/* Content */}
      {loading ? (
        <PrepSkeleton />
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#FFFFFF' }}>{error}</p>
          <button
            onClick={onRetry}
            style={{
              padding: '7px 16px', borderRadius: 7,
              background: '#1E40AF18', border: '1px solid #1E40AF30',
              color: '#1E40AF', fontSize: 12, cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      ) : prep ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Goal */}
          <div style={{
            padding: '12px 16px',
            background: 'rgba(30,64,175,0.07)',
            borderLeft: '2px solid #1E40AF',
            borderRadius: '0 8px 8px 0',
          }}>
            <p style={{ margin: '0 0 3px', fontSize: 10, fontWeight: 600, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Goal
            </p>
            <p style={{ margin: 0, fontSize: 13, color: '#E8EAF6', lineHeight: 1.55 }}>
              {prep.goal}
            </p>
          </div>

          {/* Context Summary */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Context
            </p>
            <p style={{ margin: 0, fontSize: 13, color: '#C8BC9E', lineHeight: 1.65 }}>
              {prep.contextSummary}
            </p>
          </div>

          {/* Talking Points */}
          {prep.talkingPoints.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Talking Points
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {prep.talkingPoints.map((point, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '10px 14px',
                    background: '#0D0F1A',
                    border: '1px solid #252A3E',
                    borderRadius: 9,
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                      background: '#252A3E', color: '#FFFFFF',
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 13, color: '#E8EAF6', lineHeight: 1.45 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Multi-account calendar helpers ─────────────────────────────────────────

interface CalWithAccount extends GCalCalendar {
  accountEmail: string
  accountToken: string
}

interface LoadCalendarsResult {
  calendars: CalWithAccount[]
  needsReconnect: string[]  // emails of accounts with expired/unrefreshable tokens
}

async function loadAllCalendars(primaryEmail: string): Promise<LoadCalendarsResult> {
  // Primary account — proper refresh via withAuth + Supabase session
  const tokenAge = Math.round((Date.now() - parseInt(localStorage.getItem('google_provider_token_saved_at') ?? '0', 10)) / 1000)
  const hasToken = !!localStorage.getItem('google_provider_token')
  console.log(`[CalIntel] loadAllCalendars: primaryEmail=${primaryEmail}, hasToken=${hasToken}, tokenAge=${tokenAge}s`)
  const { calendars: primaryCals } = await listCalendars()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''
  console.log(`[CalIntel] Primary (${primaryEmail}): ${primaryCals.length} calendars, token present after call: ${!!primaryToken}`)
  const primaryResult: CalWithAccount[] = primaryCals.map(c => ({
    ...c, accountEmail: primaryEmail, accountToken: primaryToken,
  }))

  // Additional accounts — refresh stale tokens via stored Supabase sessions
  const extraAccounts = loadAccounts().filter(a => !a.isPrimary)
  console.log(`[CalIntel] Extra accounts in storage: ${extraAccounts.map(a => a.email).join(', ') || 'none'}`)

  const needsReconnect: string[] = []
  const extraResults = await Promise.all(
    extraAccounts.map(async account => {
      const token = await getProviderTokenForAccount(account)
      if (!token) {
        console.warn(`[CalIntel] ${account.email}: token expired, cannot refresh — needs reconnect`)
        needsReconnect.push(account.email)
        return []
      }
      const cals = await listCalendarsWithToken(token)
      console.log(`[CalIntel] ${account.email}: ${cals.length} calendars loaded`)
      return cals.map(c => ({ ...c, accountEmail: account.email, accountToken: token }))
    })
  )

  // Deduplicate by (accountEmail + calendarId)
  const seen = new Set<string>()
  const calendars = [...primaryResult, ...extraResults.flat()].filter(c => {
    const key = `${c.accountEmail}:${c.id}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  return { calendars, needsReconnect }
}

async function fetchAllEvents(
  allCals: CalWithAccount[],
  hidden: Set<string>,
  start: Date,
  end: Date,
): Promise<GCalEvent[]> {
  const active = allCals.filter(c => !hidden.has(c.id))
  if (!active.length) return []
  const results = await Promise.all(
    active.map(c => fetchCalendarEventsWithToken(c.accountToken, c.id, start, end, c.backgroundColor))
  )
  return results.flat()
}

// ─── Multi-account calendar list cache ───────────────────────────────────────
// Persists calendar metadata (without tokens) so the page shows calendars
// immediately on revisit without waiting for a Google API round-trip.

const CAL_INTEL_CACHE_KEY = 'cal-intel-cals-cache'

interface CachedCal {
  id: string
  summary: string
  backgroundColor?: string
  foregroundColor?: string
  primary?: boolean
  accessRole?: string
  accountEmail: string
}

function loadCalIntelCache(): CachedCal[] {
  try {
    const raw = localStorage.getItem(CAL_INTEL_CACHE_KEY)
    return raw ? (JSON.parse(raw) as CachedCal[]) : []
  } catch { return [] }
}

function saveCalIntelCache(cals: CalWithAccount[]): void {
  try {
    const toSave: CachedCal[] = cals.map(c => ({
      id:              c.id,
      summary:         c.summary ?? '',
      backgroundColor: c.backgroundColor,
      foregroundColor: c.foregroundColor,
      primary:         c.primary,
      accessRole:      c.accessRole,
      accountEmail:    c.accountEmail,
    }))
    localStorage.setItem(CAL_INTEL_CACHE_KEY, JSON.stringify(toSave))
  } catch { /* quota */ }
}

/** Reconstruct CalWithAccount[] from cache by pairing each entry with a stored token. */
function rebuildFromCache(cached: CachedCal[]): CalWithAccount[] {
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''
  const accounts = loadAccounts()
  return cached.map(c => {
    const acct  = accounts.find(a => a.email === c.accountEmail)
    const token = acct ? acct.providerToken : primaryToken
    return { ...c, accountToken: token } as CalWithAccount
  })
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CalendarIntelligence() {
  const user = useAuthStore(s => s.user)

  const [weekStart,      setWeekStart]      = useState<Date>(() => getWeekStart(new Date()))
  const [events,         setEvents]         = useState<GCalEvent[]>([])
  // Hydrate from cache immediately so calendars/events show on revisit without a round-trip
  const [allCalendars,   setAllCalendars]   = useState<CalWithAccount[]>(() => {
    const cache = loadCalIntelCache()
    return cache.length ? rebuildFromCache(cache) : []
  })
  const [hiddenCals,     setHiddenCals]     = useState<Set<string>>(loadHiddenIntel)
  const [loadingEvents,  setLoadingEvents]  = useState(true)
  const [noAuth,         setNoAuth]         = useState(false)
  const [draggingEvent,  setDraggingEvent]  = useState<GCalEvent | null>(null)
  const [rescheduling,   setRescheduling]   = useState<string | null>(null) // eventId being rescheduled

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  const [fetchError,     setFetchError]     = useState<string | null>(null)
  const [reconnectNeeded, setReconnectNeeded] = useState<string[]>([])

  const [selectedEvent,   setSelectedEvent]   = useState<GCalEvent | null>(null)
  const [prep,            setPrep]            = useState<MeetingPrep | null>(null)
  const [prepLoading,     setPrepLoading]     = useState(false)
  const [prepError,       setPrepError]       = useState<string | null>(null)
  const [eventStatuses,   setEventStatuses]   = useState<Record<string, EventStatus>>(loadEventStatuses)

  // Load calendars from all accounts — called on mount and on manual refresh.
  // On failure, falls back to the persisted cache so the page never goes blank.
  const reloadCalendars = useCallback(async () => {
    const { calendars, needsReconnect } = await loadAllCalendars(user?.email ?? '')
    setReconnectNeeded(needsReconnect)
    if (calendars.length) {
      saveCalIntelCache(calendars)
      setAllCalendars(calendars)
      setNoAuth(false)
      return calendars
    }
    // Fresh fetch returned empty — try to fall back to persisted cache
    const cached = loadCalIntelCache()
    if (cached.length) {
      const fromCache = rebuildFromCache(cached)
      setAllCalendars(fromCache)
      setNoAuth(false)
      return fromCache
    }
    // Truly no calendars anywhere
    setNoAuth(true)
    return []
  }, [user?.email])

  useEffect(() => {
    void reloadCalendars()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email])

  function toggleCal(id: string) {
    setHiddenCals(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      saveHiddenIntel(next)
      return next
    })
  }

  // Fetch events whenever week or visible calendars change
  const loadEvents = useCallback(async (start: Date, cals: CalWithAccount[], hidden: Set<string>) => {
    setLoadingEvents(true)
    setFetchError(null)
    setSelectedEvent(null)
    setPrep(null)
    try {
      const end = getWeekEnd(start)
      if (!cals.length) {
        setNoAuth(true)
        setEvents([])
        return
      }
      const fetched = await fetchAllEvents(cals, hidden, start, end)
      setEvents(fetched)
      setNoAuth(false)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load events.')
      setEvents([])
    } finally {
      setLoadingEvents(false)
    }
  }, [])

  useEffect(() => {
    if (allCalendars.length) void loadEvents(weekStart, allCalendars, hiddenCals)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, allCalendars, hiddenCals, loadEvents])

  // When a new Google account is connected, reload all calendars + events
  useEffect(() => {
    const handler = () => {
      void reloadCalendars().then(cals => loadEvents(weekStart, cals, hiddenCals))
    }
    window.addEventListener('professor:accountsUpdated', handler)
    return () => window.removeEventListener('professor:accountsUpdated', handler)
  }, [reloadCalendars, loadEvents, weekStart, hiddenCals])

  // ─── Calendar DnD: drag event to a different day tab to reschedule ──────────

  function toggleEventStatus(eventId: string, status: EventStatus) {
    setEventStatuses(prev => {
      const next = { ...prev }
      if (next[eventId] === status) {
        delete next[eventId]  // toggle off
      } else {
        next[eventId] = status
      }
      saveEventStatuses(next)
      return next
    })
  }

  function handleCalDragStart({ active }: DragStartEvent) {
    const ev = events.find(e => e.id === active.id)
    setDraggingEvent(ev ?? null)
  }

  async function handleCalDragEnd({ active, over }: DragEndEvent) {
    setDraggingEvent(null)
    if (!over) return

    const overId = over.id as string
    if (!overId.startsWith('day-')) return  // not dropped on a day

    const newDateStr = overId.replace('day-', '')   // YYYY-MM-DD
    const event = events.find(e => e.id === active.id)
    if (!event) return

    // Check if already on this day (no-op)
    const eventDate = localDateStr(new Date(
      (event as GCalEventExt).start?.dateTime
        ? new Date((event as GCalEventExt).start.dateTime!)
        : new Date((event as GCalEventExt).start.date + 'T00:00:00'),
    ))
    if (eventDate === newDateStr) return

    // Find the calendar token for this event
    const ext = event as GCalEventExt
    const calId = ext.calendarId
    if (!calId) return
    const cal = allCalendars.find(c => c.id === calId)
    if (!cal) return

    setRescheduling(event.id)
    try {
      const ok = await updateCalendarEventDate(cal.accountToken, calId, event.id, newDateStr, event)
      if (ok) {
        // Reload events to reflect new date
        void loadEvents(weekStart, allCalendars, hiddenCals)
      }
    } finally {
      setRescheduling(null)
    }
  }

  // Generate meeting prep for a selected event
  const generatePrep = useCallback(async (event: GCalEvent) => {
    setPrepLoading(true)
    setPrepError(null)
    setPrep(null)
    try {
      const dbUser = buildMockUser(user)
      const result = await generateMeetingPrep({
        user: dbUser,
        companies: MOCK_COMPANIES,
        event: gcalToDbEvent(event),
      })
      setPrep(result)
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'Could not generate prep.')
    } finally {
      setPrepLoading(false)
    }
  }, [user])

  function handleSelectEvent(event: GCalEvent) {
    if (selectedEvent?.id === event.id) {
      setSelectedEvent(null)
      setPrep(null)
      return
    }
    setSelectedEvent(event)
    generatePrep(event)
  }

  function handlePrevWeek() {
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() - 7)
      return d
    })
  }

  function handleNextWeek() {
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + 7)
      return d
    })
  }

  function handleThisWeek() {
    setWeekStart(getWeekStart(new Date()))
  }

  // Build week day columns (Mon–Fri, or Sun–Sat)
  const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  const grouped   = groupByDay(events)
  const totalHrs  = events.reduce((acc, e) => {
    const start = new Date(e.start.dateTime ?? '')
    const end   = new Date(e.end.dateTime ?? '')
    return isNaN(start.getTime()) ? acc : acc + (end.getTime() - start.getTime()) / 3_600_000
  }, 0)

  const today = localDateStr(new Date())

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .cal-fade { animation: fadeIn 0.3s ease both; }
        .event-row:hover { background: #32291A !important; cursor: pointer; }
      `}</style>

      <div style={{ padding: '36px 32px 60px', maxWidth: 1080, margin: '0 auto' }}>

        {/* ─── Week Nav ──────────────────────────────────────────────────── */}
        <div className="cal-fade" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 28,
        }}>
          <div>
            <h1 style={{
              margin: '0 0 4px',
              fontSize: 32, fontWeight: 800,
              color: '#E8EAF6',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              letterSpacing: '-1px', lineHeight: 1.1,
            }}>
              {fmtWeekRange(weekStart)}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
              {isThisWeek(weekStart) ? 'This week' : 'Week view'}
              {!loadingEvents && ` · ${events.length} event${events.length !== 1 ? 's' : ''}`}
              {!loadingEvents && totalHrs > 0 && ` · ${totalHrs.toFixed(1)}h scheduled`}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isThisWeek(weekStart) && (
              <button
                onClick={handleThisWeek}
                style={{
                  padding: '7px 14px', borderRadius: 8,
                  background: '#1E40AF18', border: '1px solid #1E40AF30',
                  color: '#1E40AF', fontSize: 12, cursor: 'pointer',
                }}
              >
                This Week
              </button>
            )}
            <button
              onClick={() => void reloadCalendars().then(cals => loadEvents(weekStart, cals, hiddenCals))}
              disabled={loadingEvents}
              title="Refresh accounts &amp; events"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 8,
                background: 'transparent', border: '1px solid #252A3E',
                color: '#FFFFFF', fontSize: 12, cursor: 'pointer',
                opacity: loadingEvents ? 0.5 : 1,
              }}
            >
              <RefreshCw size={12} style={{ animation: loadingEvents ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              onClick={handlePrevWeek}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, borderRadius: 8,
                background: 'transparent', border: '1px solid #252A3E',
                color: '#FFFFFF', cursor: 'pointer',
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={handleNextWeek}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, borderRadius: 8,
                background: 'transparent', border: '1px solid #252A3E',
                color: '#FFFFFF', cursor: 'pointer',
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Gold divider */}
        <div style={{
          height: 1, marginBottom: 16,
          background: 'linear-gradient(90deg, #1E40AF40 0%, #252A3E 60%, transparent 100%)',
        }} />

        {/* ─── Reconnect banner for stale accounts ──────────────────────── */}
        {reconnectNeeded.length > 0 && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(224,165,36,0.08)', border: '1px solid rgba(224,165,36,0.3)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 14 }}>⚠</span>
            <span style={{ fontSize: 12, color: '#94A3B8', flex: 1 }}>
              Calendar access expired for:
            </span>
            {reconnectNeeded.map(email => (
              <button
                key={email}
                onClick={() => void connectAdditionalGoogleAccount(email)}
                style={{
                  padding: '4px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                  background: 'rgba(224,165,36,0.15)', border: '1px solid rgba(224,165,36,0.45)',
                  color: '#E0A524', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <RefreshCw size={11} />
                Reconnect {email.split('@')[0]}
              </button>
            ))}
          </div>
        )}

        {/* ─── Calendar filter chips ─────────────────────────────────────── */}
        {allCalendars.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.7px', marginRight: 4 }}>Calendars</span>
            {allCalendars.map(cal => {
              const hidden = hiddenCals.has(cal.id)
              return (
                <button key={`${cal.accountEmail}:${cal.id}`} onClick={() => toggleCal(cal.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px',
                  borderRadius: 20, border: '1px solid #252A3E', cursor: 'pointer', fontSize: 11.5,
                  background: hidden ? 'transparent' : `${cal.backgroundColor ?? '#1E40AF'}15`,
                  color: hidden ? '#4B5563' : '#E8EAF6',
                  opacity: hidden ? 0.5 : 1, transition: 'all 0.15s',
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: hidden ? '#4B5563' : (cal.backgroundColor ?? '#1E40AF'), flexShrink: 0 }} />
                  {cal.summary}
                  {cal.accountEmail && <span style={{ fontSize: 9.5, color: hidden ? '#4B5563' : '#6B7280', marginLeft: 1 }}>({cal.accountEmail.split('@')[0]})</span>}
                  {hidden ? <EyeOff size={9} style={{ marginLeft: 2, opacity: 0.6 }} /> : <Eye size={9} style={{ marginLeft: 2, opacity: 0.35 }} />}
                </button>
              )
            })}
          </div>
        )}

        {/* ─── DnD Context wraps day tabs + event list ──────────────────── */}
        <DndContext
          sensors={dndSensors}
          onDragStart={handleCalDragStart}
          onDragEnd={handleCalDragEnd}
        >

        {/* ─── Day Tabs (droppable) ──────────────────────────────────────── */}
        <div className="cal-fade" style={{
          display: 'flex', gap: 6, marginBottom: 24, overflowX: 'auto',
        }}>
          {weekDays.map(day => {
            const key     = localDateStr(day)
            const count   = grouped.get(key)?.length ?? 0
            const isToday = key === today
            return (
              <DroppableDayTab key={key} dateKey={key}>
                <div style={{
                  padding: '10px 8px',
                  borderRadius: 10, textAlign: 'center',
                  background: isToday ? '#1E40AF14' : '#161929',
                  border: `1px solid ${isToday ? '#1E40AF40' : '#252A3E'}`,
                  transition: 'border-color 0.1s',
                }}>
                  <p style={{
                    margin: '0 0 2px', fontSize: 10, fontWeight: 600,
                    color: isToday ? '#1E40AF' : '#6B7280',
                    textTransform: 'uppercase', letterSpacing: '0.8px',
                  }}>
                    {DAY_LABELS[day.getDay()]}
                  </p>
                  <p style={{
                    margin: '0 0 4px', fontSize: 18, fontWeight: 700,
                    color: isToday ? '#E8EAF6' : '#C8BC9E',
                    fontFamily: "'Cabinet Grotesk', sans-serif",
                  }}>
                    {day.getDate()}
                  </p>
                  {count > 0 && (
                    <span style={{
                      display: 'inline-block',
                      width: 18, height: 18, borderRadius: '50%',
                      background: isToday ? '#1E40AF22' : '#252A3E',
                      fontSize: 10, fontWeight: 700,
                      color: isToday ? '#1E40AF' : '#6B7280',
                      lineHeight: '18px',
                    }}>
                      {count}
                    </span>
                  )}
                </div>
              </DroppableDayTab>
            )
          })}
        </div>

        {/* ─── Main grid: events + prep panel ───────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: selectedEvent ? '1fr 380px' : '1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}>

          {/* Events list */}
          <div className="cal-fade">
            {loadingEvents ? (
              <EventSkeleton />
            ) : fetchError ? (
              <div style={{
                textAlign: 'center', padding: '48px 0',
                background: '#161929', border: '1px solid #252A3E', borderRadius: 14,
              }}>
                <p style={{ margin: '0 0 14px', fontSize: 13, color: '#FFFFFF' }}>{fetchError}</p>
                <button
                  onClick={() => void loadEvents(weekStart, allCalendars, hiddenCals)}
                  style={{
                    padding: '7px 18px', borderRadius: 8,
                    background: '#1E40AF18', border: '1px solid #1E40AF30',
                    color: '#1E40AF', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            ) : noAuth ? (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                background: '#161929', border: '1px solid #252A3E', borderRadius: 14,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: '#1E40AF14', border: '1px solid #1E40AF30',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <Calendar size={20} color="#1E40AF" />
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#E8EAF6', fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                  Connect Google Calendar
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF', lineHeight: 1.6, maxWidth: 320, marginInline: 'auto' }}>
                  Sign in with Google to sync your calendar and get AI-powered meeting prep.
                </p>
              </div>
            ) : events.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                background: '#161929', border: '1px solid #252A3E', borderRadius: 14,
              }}>
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  No events this week. Enjoy the open space.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {weekDays.map(day => {
                  const key       = localDateStr(day)
                  const dayEvents = grouped.get(key) ?? []
                  const isToday   = key === today
                  if (dayEvents.length === 0) return null

                  return (
                    <div key={key} style={{ marginBottom: 8 }}>
                      {/* Day header */}
                      <p style={{
                        margin: '0 0 8px', fontSize: 11, fontWeight: 600,
                        color: isToday ? '#1E40AF' : '#6B7280',
                        textTransform: 'uppercase', letterSpacing: '0.8px',
                      }}>
                        {isToday ? 'Today' : FULL_DAYS[day.getDay()]}
                        <span style={{ marginLeft: 6, fontWeight: 400 }}>
                          {day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </p>

                      {/* Events */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {dayEvents.map(event => {
                          const db             = gcalToDbEvent(event)
                          const isSelected     = selectedEvent?.id === event.id
                          const isPast         = new Date(db.end_time) < new Date()
                          const mType          = db.meeting_type
                          const hasVideo       = !!event.conferenceData?.entryPoints?.length
                          const isRescheduling = rescheduling === event.id
                          const evStatus       = eventStatuses[event.id] ?? null
                          const isDone         = evStatus === 'done'
                          const isCancelled    = evStatus === 'cancelled'

                          return (
                            <DraggableEventRow key={event.id} event={event}>
                              {({ listeners, attributes, isDragging }) => (
                                <div
                                  className="event-row"
                                  onClick={() => !isDragging && handleSelectEvent(event)}
                                  style={{
                                    display: 'flex', gap: 12, alignItems: 'center',
                                    padding: '13px 16px',
                                    borderRadius: 10,
                                    background: isDone ? '#1D9E7508' : isCancelled ? '#E0525208' : isSelected ? '#32291A' : '#161929',
                                    border: `1px solid ${isDone ? '#1D9E7530' : isCancelled ? '#E0525230' : isSelected ? '#1E40AF50' : '#252A3E'}`,
                                    opacity: (isPast || isDone || isCancelled ? 0.6 : 1) * (isDragging ? 0.35 : 1),
                                    transition: 'all 0.15s',
                                    borderLeft: isDone ? '3px solid #1D9E75' : isCancelled ? '3px solid #E05252' : isSelected ? '3px solid #1E40AF' : '1px solid #252A3E',
                                    cursor: isDragging ? 'grabbing' : 'pointer',
                                  }}
                                >
                                  {/* Drag handle */}
                                  <div
                                    {...listeners}
                                    {...attributes}
                                    title="Drag to reschedule"
                                    style={{
                                      cursor: 'grab', color: '#404560', flexShrink: 0,
                                      display: 'flex', alignItems: 'center',
                                    }}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <GripVertical size={13} strokeWidth={2} />
                                  </div>

                                  {/* Time */}
                                  <div style={{ width: 58, flexShrink: 0, textAlign: 'right' }}>
                                    <p style={{ margin: 0, fontSize: 11.5, color: '#E8EAF6', fontWeight: 500, fontFamily: 'monospace' }}>
                                      {fmtTime(db.start_time)}
                                    </p>
                                    <p style={{ margin: '1px 0 0', fontSize: 10, color: '#FFFFFF', fontFamily: 'monospace' }}>
                                      {fmtTime(db.end_time)}
                                    </p>
                                  </div>

                                  {/* Color bar */}
                                  <div style={{
                                    width: 3, borderRadius: 2, flexShrink: 0, alignSelf: 'stretch',
                                    background: isDone ? '#1D9E75' : isCancelled ? '#E05252' : isSelected ? '#1E40AF' : '#252A3E',
                                    minHeight: 32,
                                  }} />

                                  {/* Title + meta */}
                                  <div style={{ flex: 1 }}>
                                    <p style={{
                                      margin: '0 0 4px', fontSize: 13.5,
                                      color: isDone || isCancelled ? '#6B7280' : '#E8EAF6',
                                      fontWeight: 500, lineHeight: 1.35,
                                      textDecoration: isCancelled ? 'line-through' : 'none',
                                    }}>
                                      {event.summary ?? '(No title)'}
                                    </p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      {isDone && (
                                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#1D9E7518', color: '#1D9E75', border: '1px solid #1D9E7530', fontWeight: 600 }}>Done</span>
                                      )}
                                      {isCancelled && (
                                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#E0525218', color: '#E05252', border: '1px solid #E0525230', fontWeight: 600 }}>Cancelled</span>
                                      )}
                                      {!isDone && !isCancelled && <MeetingTypeIcon type={mType} />}
                                      {!isDone && !isCancelled && mType && (
                                        <span style={{ fontSize: 10.5, color: '#FFFFFF', textTransform: 'capitalize' }}>
                                          {mType.replace('_', ' ')}
                                        </span>
                                      )}
                                      {hasVideo && (
                                        <span style={{
                                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                          background: '#7F77DD18', color: '#7F77DD',
                                          border: '1px solid #7F77DD30',
                                        }}>
                                          Video
                                        </span>
                                      )}
                                      {db.location && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: '#FFFFFF' }}>
                                          <MapPin size={10} />
                                          {db.location.length > 28 ? db.location.slice(0, 28) + '…' : db.location}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Quick status buttons */}
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                    <button
                                      title={isDone ? 'Mark as not done' : 'Mark as done'}
                                      onClick={() => toggleEventStatus(event.id, 'done')}
                                      style={{
                                        background: isDone ? '#1D9E7522' : 'transparent',
                                        border: `1px solid ${isDone ? '#1D9E7550' : '#252A3E'}`,
                                        borderRadius: 6, padding: '4px 5px', cursor: 'pointer',
                                        color: isDone ? '#1D9E75' : '#404560', display: 'flex', alignItems: 'center',
                                        transition: 'all 0.1s',
                                      }}
                                    >
                                      <CheckCircle2 size={13} />
                                    </button>
                                    <button
                                      title={isCancelled ? 'Unmark cancelled' : 'Mark as cancelled'}
                                      onClick={() => toggleEventStatus(event.id, 'cancelled')}
                                      style={{
                                        background: isCancelled ? '#E0525222' : 'transparent',
                                        border: `1px solid ${isCancelled ? '#E0525250' : '#252A3E'}`,
                                        borderRadius: 6, padding: '4px 5px', cursor: 'pointer',
                                        color: isCancelled ? '#E05252' : '#404560', display: 'flex', alignItems: 'center',
                                        transition: 'all 0.1s',
                                      }}
                                    >
                                      <XCircle size={13} />
                                    </button>
                                  </div>

                                  {/* AI badge / rescheduling indicator */}
                                  {isRescheduling ? (
                                    <div style={{ flexShrink: 0, fontSize: 11, color: '#7F77DD', display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                      Moving…
                                    </div>
                                  ) : (
                                    <div style={{
                                      flexShrink: 0,
                                      display: 'flex', alignItems: 'center', gap: 5,
                                      padding: '5px 10px', borderRadius: 6,
                                      background: isSelected ? '#1E40AF18' : '#161929',
                                      border: `1px solid ${isSelected ? '#1E40AF40' : '#252A3E'}`,
                                      color: isSelected ? '#1E40AF' : '#6B7280',
                                      fontSize: 11,
                                    }}>
                                      <Sparkles size={11} />
                                      {isSelected ? 'Prep open' : 'Prep'}
                                    </div>
                                  )}
                                </div>
                              )}
                            </DraggableEventRow>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* AI Prep Panel */}
          {selectedEvent && (
            <div className="cal-fade" style={{ position: 'sticky', top: 24 }}>
              <PrepPanel
                event={selectedEvent}
                prep={prep}
                loading={prepLoading}
                error={prepError}
                onClose={() => { setSelectedEvent(null); setPrep(null) }}
                onRetry={() => generatePrep(selectedEvent)}
              />
            </div>
          )}
        </div>

        {/* Drag overlay — ghost label shown while dragging */}
        <DragOverlay dropAnimation={null}>
          {draggingEvent && (
            <div style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 500,
              background: '#1E1B38', border: '1px solid #7F77DD60', color: '#E8EAF6',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', gap: 8, maxWidth: 280,
            }}>
              <GripVertical size={13} color="#7F77DD" />
              {draggingEvent.summary ?? '(No title)'}
            </div>
          )}
        </DragOverlay>

        </DndContext>
      </div>
    </>
  )
}
