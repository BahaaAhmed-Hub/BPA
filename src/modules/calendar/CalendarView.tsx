import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Video, MapPin, Sparkles, X, RefreshCw } from 'lucide-react'
import { fetchWeekEvents, detectMeetingType } from '@/lib/googleCalendar'
import type { GCalEvent } from '@/lib/googleCalendar'
import { generateMeetingPrep } from '@/lib/professor'
import type { MeetingPrep, CalEvent } from '@/lib/professor'
import type { DbCalendarEvent } from '@/types/database'
import { useAuthStore } from '@/store/authStore'


// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_START  = 6   // 6 AM
const HOUR_END    = 22  // 10 PM
const PX_PER_HOUR = 64  // pixels per hour
const PX_PER_MIN  = PX_PER_HOUR / 60

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'day' | 'week'

interface PositionedEvent {
  event: GCalEvent
  top: number     // px from grid top
  height: number  // px
  col: number     // 0-indexed column within day (for overlap)
  cols: number    // total columns in day (for overlap)
  dayIdx: number  // 0 = Sunday index within week
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function getWeekStart(d: Date): Date {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0,0,0,0); return r
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6)
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}
function fmtHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
function eventMinutes(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}
function eventTopPx(startIso: string): number {
  const mins = eventMinutes(startIso)
  return (mins - HOUR_START * 60) * PX_PER_MIN
}
function eventHeightPx(startIso: string, endIso: string): number {
  const dur = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  return Math.max(dur * PX_PER_MIN, 22)
}
function isAllDay(e: GCalEvent): boolean {
  return !e.start.dateTime
}
function getEventDay(e: GCalEvent): Date {
  const iso = e.start.dateTime ?? e.start.date ?? ''
  return startOfDay(new Date(iso))
}

function getMeetingColor(type: string): string {
  switch (type) {
    case 'video':    return '#7F77DD'
    case 'physical': return '#1D9E75'
    case 'one_on_one': return '#E0944A'
    default:         return '#1E40AF'
  }
}

// ─── Overlap layout algorithm ─────────────────────────────────────────────────

function layoutDayEvents(events: GCalEvent[], dayDate: Date, dayIdx: number): PositionedEvent[] {
  const timed = events.filter(e => !isAllDay(e) && isSameDay(getEventDay(e), dayDate))
  if (!timed.length) return []

  // Sort by start time
  const sorted = [...timed].sort((a, b) =>
    new Date(a.start.dateTime!).getTime() - new Date(b.start.dateTime!).getTime()
  )

  // Group overlapping events into columns
  const columns: GCalEvent[][] = []
  for (const ev of sorted) {
    const evStart = new Date(ev.start.dateTime!).getTime()
    const evEnd   = new Date(ev.end.dateTime!).getTime()
    let placed = false
    for (const col of columns) {
      const lastEnd = new Date(col[col.length - 1].end.dateTime!).getTime()
      if (evStart >= lastEnd) { col.push(ev); placed = true; break }
    }
    if (!placed) columns.push([ev])
  }

  // Assign column index and total cols to each event
  const result: PositionedEvent[] = []
  sorted.forEach(ev => {
    const colIdx = columns.findIndex(c => c.includes(ev))
    const evStart = new Date(ev.start.dateTime!).getTime()
    const evEnd   = new Date(ev.end.dateTime!).getTime()
    // count how many columns overlap with this event
    const colsInUse = columns.filter(c => c.some(e => {
      const s = new Date(e.start.dateTime!).getTime()
      const en = new Date(e.end.dateTime!).getTime()
      return s < evEnd && en > evStart
    })).length
    result.push({
      event: ev,
      top:    eventTopPx(ev.start.dateTime!),
      height: eventHeightPx(ev.start.dateTime!, ev.end.dateTime!),
      col:    colIdx,
      cols:   colsInUse,
      dayIdx,
    })
  })
  return result
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({
  pe, dayWidth, onClick,
}: { pe: PositionedEvent; dayWidth: number; onClick: (e: GCalEvent) => void }) {
  const type  = detectMeetingType(pe.event)
  const color = getMeetingColor(type)
  const w     = (dayWidth / pe.cols) - 2
  const left  = (dayWidth / pe.cols) * pe.col + 1
  const title = pe.event.summary ?? '(No title)'
  const start = pe.event.start.dateTime ? fmtTime(pe.event.start.dateTime) : ''

  return (
    <div
      onClick={() => onClick(pe.event)}
      title={title}
      style={{
        position: 'absolute',
        top: pe.top, left, width: w, height: pe.height,
        borderRadius: 6,
        background: `${color}22`,
        borderLeft: `3px solid ${color}`,
        padding: '3px 6px',
        cursor: 'pointer',
        overflow: 'hidden',
        boxSizing: 'border-box',
        transition: 'background 0.1s',
        zIndex: 1,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = `${color}38` }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = `${color}22` }}
    >
      {pe.height >= 32 && (
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </p>
      )}
      {pe.height >= 48 && (
        <p style={{ margin: '1px 0 0', fontSize: 10.5, color: `${color}CC`, whiteSpace: 'nowrap' }}>{start}</p>
      )}
    </div>
  )
}

// ─── Event Detail Popover ─────────────────────────────────────────────────────

function EventDetail({
  event, onClose,
}: { event: GCalEvent; onClose: () => void }) {
  const [prep, setPrep]       = useState<MeetingPrep | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const authUser = useAuthStore(s => s.user)
  const type  = detectMeetingType(event)
  const color = getMeetingColor(type)

  async function doPrep() {
    setLoading(true); setError('')
    try {
      const dbEvent: DbCalendarEvent = {
        id:              event.id,
        user_id:         authUser?.id ?? 'demo',
        company_id:      null,
        google_event_id: event.id,
        title:           event.summary ?? '(No title)',
        start_time:      event.start.dateTime ?? event.start.date ?? '',
        end_time:        event.end.dateTime   ?? event.end.date   ?? '',
        location:        event.location ?? null,
        meeting_type:    type,
        prep_notes:      event.description ?? null,
        is_synced:       true,
      }
      const calEvent: CalEvent = {
        event:     dbEvent,
        user:      { id: authUser?.id ?? 'demo', email: authUser?.email ?? '', full_name: authUser?.name ?? '', avatar_url: null, active_framework: 'time_blocking', schedule_rules: {}, created_at: new Date().toISOString() },
        companies: [],
      }
      const result = await generateMeetingPrep(calEvent)
      setPrep(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI prep failed')
    }
    setLoading(false)
  }

  const start = event.start.dateTime ? fmtTime(event.start.dateTime) : event.start.date ?? ''
  const end   = event.end.dateTime   ? fmtTime(event.end.dateTime)   : ''

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface, #161929)',
        border: '1px solid var(--color-border, #252A3E)',
        borderRadius: 16, padding: '24px 28px', maxWidth: 520, width: '90%',
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ flex: 1, paddingRight: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color, textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>{type.replace('_', ' ')}</span>
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.3 }}>
              {event.summary ?? '(No title)'}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted, #6B7280)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-text-dim, #94A3B8)' }}>
              🕐 {start}{end ? ` – ${end}` : ''}
            </span>
          </div>
          {event.location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapPin size={12} color="var(--color-text-muted, #6B7280)" />
              <span style={{ fontSize: 12.5, color: 'var(--color-text-dim, #94A3B8)' }}>{event.location}</span>
            </div>
          )}
          {event.conferenceData?.entryPoints?.map(ep => (
            <div key={ep.uri} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Video size={12} color={color} />
              <a href={ep.uri} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12.5, color, textDecoration: 'none' }}>
                Join video call
              </a>
            </div>
          ))}
          {event.description && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {event.description.slice(0, 300)}{event.description.length > 300 ? '…' : ''}
            </p>
          )}
        </div>

        {/* AI Prep */}
        {!prep && (
          <button onClick={() => void doPrep()} disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '10px 16px', borderRadius: 10, cursor: loading ? 'wait' : 'pointer',
              background: loading ? 'var(--color-surface2, #0D0F1A)' : 'var(--color-accent-fill, rgba(30,64,175,0.12))',
              border: `1px solid ${loading ? 'var(--color-border, #252A3E)' : 'var(--color-accent, #1E40AF)40'}`,
              color: loading ? 'var(--color-text-muted, #6B7280)' : 'var(--color-accent, #1E40AF)',
              fontSize: 13, fontWeight: 600,
            }}>
            <Sparkles size={14} />
            {loading ? 'Generating prep brief…' : 'Prep with AI'}
          </button>
        )}
        {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#E05252' }}>{error}</p>}

        {prep && (
          <div style={{ marginTop: 0 }}>
            <div style={{ borderTop: '1px solid var(--color-border, #252A3E)', paddingTop: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent, #1E40AF)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>AI Meeting Brief</span>
            </div>
            {prep.agenda && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Agenda</p>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {prep.agenda.map((a, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', marginBottom: 3 }}>{a}</li>)}
                </ul>
              </div>
            )}
            {prep.talkingPoints && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Talking Points</p>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {prep.talkingPoints.map((t, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', marginBottom: 3 }}>{t}</li>)}
                </ul>
              </div>
            )}
            {prep.goals && prep.goals.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Goals</p>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {prep.goals.map((g, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', marginBottom: 3 }}>{g}</li>)}
                </ul>
              </div>
            )}
            {prep.summary && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.6, borderTop: '1px solid var(--color-border, #252A3E)', paddingTop: 12 }}>
                {prep.summary}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Time Grid ────────────────────────────────────────────────────────────────

function TimeGrid({
  days, events, viewMode, onEventClick,
}: {
  days: Date[]
  events: GCalEvent[]
  viewMode: ViewMode
  onEventClick: (e: GCalEvent) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const today = startOfDay(new Date())

  // Scroll to 8am on mount
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = (8 - HOUR_START) * PX_PER_HOUR - 20
    }
  }, [])

  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)
  const totalHeight = hours.length * PX_PER_HOUR

  // Current time position
  const now = new Date()
  const nowTop = (now.getHours() * 60 + now.getMinutes() - HOUR_START * 60) * PX_PER_MIN
  const showNowLine = nowTop >= 0 && nowTop <= totalHeight

  // All-day events
  const allDayEvents = events.filter(isAllDay)

  // Layout timed events per day
  const TIME_COL = 52 // px for time labels column
  const NUM_DAYS = days.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* ── Day header row ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border, #252A3E)', flexShrink: 0 }}>
        <div style={{ width: TIME_COL, flexShrink: 0 }} />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today)
          const dayAllDay = allDayEvents.filter(e => {
            const s = startOfDay(new Date(e.start.date ?? e.start.dateTime ?? ''))
            const en = startOfDay(new Date(e.end.date ?? e.end.dateTime ?? ''))
            return s <= d && d < en
          })
          return (
            <div key={i} style={{
              flex: 1, textAlign: 'center', padding: '8px 4px 4px',
              borderLeft: i > 0 ? '1px solid var(--color-border, #252A3E)' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: isToday ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: isToday ? 'var(--color-accent, #1E40AF)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: isToday ? '#fff' : 'var(--color-text, #E8EAF6)' }}>
                    {d.getDate()}
                  </span>
                </div>
              </div>
              {/* All-day pills */}
              {dayAllDay.map(e => (
                <div key={e.id} onClick={() => onEventClick(e)}
                  style={{
                    marginBottom: 2, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    background: 'var(--color-accent-fill, rgba(30,64,175,0.15))',
                    border: '1px solid var(--color-accent, #1E40AF)30',
                    fontSize: 10.5, color: 'var(--color-accent, #1E40AF)', fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                  {e.summary ?? '(All day)'}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* ── Scrollable time grid ─────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', position: 'relative', minHeight: totalHeight }}>
          {/* Hour labels */}
          <div style={{ width: TIME_COL, flexShrink: 0, position: 'relative' }}>
            {hours.map(h => (
              <div key={h} style={{ height: PX_PER_HOUR, display: 'flex', alignItems: 'flex-start', paddingTop: 2, paddingRight: 8, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted, #6B7280)', whiteSpace: 'nowrap' }}>
                  {fmtHour(h)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, colIdx) => {
            const positioned = layoutDayEvents(events, d, colIdx)
            const isToday = isSameDay(d, today)
            return (
              <div key={colIdx} style={{
                flex: 1, position: 'relative',
                borderLeft: '1px solid var(--color-border, #252A3E)',
                background: isToday ? 'rgba(30,64,175,0.02)' : 'transparent',
              }}>
                {/* Hour lines */}
                {hours.map((h, hi) => (
                  <div key={h} style={{
                    position: 'absolute', left: 0, right: 0,
                    top: hi * PX_PER_HOUR,
                    height: PX_PER_HOUR,
                    borderTop: `1px solid var(--color-border, #252A3E)`,
                  }} />
                ))}
                {/* Half-hour lines */}
                {hours.map((h, hi) => (
                  <div key={`${h}h`} style={{
                    position: 'absolute', left: 0, right: 0,
                    top: hi * PX_PER_HOUR + PX_PER_HOUR / 2,
                    borderTop: '1px dashed var(--color-border, #252A3E)',
                    opacity: 0.4,
                  }} />
                ))}
                {/* Events */}
                {positioned.map(pe => (
                  <EventCard
                    key={pe.event.id}
                    pe={pe}
                    dayWidth={1000 / NUM_DAYS} /* rough — handled via flex */
                    onClick={onEventClick}
                  />
                ))}
                {/* Now line (only on today column) */}
                {isToday && showNowLine && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, top: nowTop,
                    height: 2, background: '#E05252', zIndex: 10,
                    display: 'flex', alignItems: 'center',
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E05252', marginLeft: -4 }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Main CalendarView ────────────────────────────────────────────────────────

export function CalendarView() {
  const [viewMode, setViewMode]       = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState(() => startOfDay(new Date()))
  const [events, setEvents]           = useState<GCalEvent[]>([])
  const [loading, setLoading]         = useState(false)
  const [noAuth, setNoAuth]           = useState(false)
  const [selected, setSelected]       = useState<GCalEvent | null>(null)

  // Compute days to display
  const days: Date[] = viewMode === 'day'
    ? [currentDate]
    : Array.from({ length: 7 }, (_, i) => addDays(getWeekStart(currentDate), i))

  const rangeStart = days[0]
  const rangeEnd   = addDays(days[days.length - 1], 1) // exclusive

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const { events: evs, noAuth: na } = await fetchWeekEvents(rangeStart, rangeEnd)
      setEvents(evs)
      setNoAuth(na)
    } catch { setNoAuth(true) }
    setLoading(false)
  }, [rangeStart.getTime(), rangeEnd.getTime()])

  useEffect(() => { void loadEvents() }, [loadEvents])

  function navigate(dir: -1 | 1) {
    const delta = viewMode === 'day' ? 1 : 7
    setCurrentDate(prev => addDays(prev, dir * delta))
  }

  function goToday() { setCurrentDate(startOfDay(new Date())) }

  const title = viewMode === 'day' ? fmtDay(currentDate) : fmtWeekRange(rangeStart)
  const isCurrentPeriod = viewMode === 'day'
    ? isSameDay(currentDate, new Date())
    : isSameDay(rangeStart, getWeekStart(new Date()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', flexShrink: 0,
        borderBottom: '1px solid var(--color-border, #252A3E)',
        background: 'var(--color-surface, #161929)',
      }}>
        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => navigate(-1)} style={navBtn}>
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => navigate(1)} style={navBtn}>
            <ChevronRight size={16} />
          </button>
        </div>

        <button onClick={goToday} disabled={isCurrentPeriod}
          style={{ ...navBtn, padding: '5px 12px', opacity: isCurrentPeriod ? 0.4 : 1, fontSize: 12, fontWeight: 600 }}>
          Today
        </button>

        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', flex: 1 }}>
          {title}
        </h2>

        {/* Refresh */}
        <button onClick={() => void loadEvents()} style={{ ...navBtn, padding: '5px 10px' }} title="Refresh">
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>

        {/* Day / Week toggle */}
        <div style={{
          display: 'flex', borderRadius: 8, overflow: 'hidden',
          border: '1px solid var(--color-border, #252A3E)',
        }}>
          {(['day', 'week'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: viewMode === m ? 'var(--color-accent, #1E40AF)' : 'transparent',
                color: viewMode === m ? '#fff' : 'var(--color-text-muted, #6B7280)',
                textTransform: 'capitalize',
              }}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── No auth notice ───────────────────────────────────────────────────── */}
      {noAuth && (
        <div style={{
          padding: '10px 20px',
          background: 'rgba(224,82,82,0.07)',
          borderBottom: '1px solid rgba(224,82,82,0.2)',
          fontSize: 12.5, color: '#E05252',
        }}>
          Google Calendar not connected — sign in with Google to see your events.
        </div>
      )}

      {/* ── Time grid ───────────────────────────────────────────────────────── */}
      <TimeGrid
        days={days}
        events={events}
        viewMode={viewMode}
        onEventClick={e => setSelected(e)}
      />

      {/* ── Event detail modal ──────────────────────────────────────────────── */}
      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ─── Shared button style ──────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '5px 8px', borderRadius: 8, border: '1px solid var(--color-border, #252A3E)',
  background: 'transparent', cursor: 'pointer',
  color: 'var(--color-text-dim, #94A3B8)', fontSize: 12,
}
