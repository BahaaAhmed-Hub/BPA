import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Video, MapPin, Sparkles, X, RefreshCw, LogIn, Eye, EyeOff } from 'lucide-react'
import { listCalendars, fetchAllCalendarsEvents, detectMeetingType } from '@/lib/googleCalendar'
import type { GCalEventWithCalendar, GCalCalendar } from '@/lib/googleCalendar'
import { generateMeetingPrep } from '@/lib/professor'
import type { MeetingPrep, CalEvent } from '@/lib/professor'
import type { DbCalendarEvent } from '@/types/database'
import { useAuthStore } from '@/store/authStore'
import { signInWithGoogle } from '@/lib/google'
import type { GCalEvent } from '@/lib/googleCalendar'


// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_START  = 6   // 6 AM
const HOUR_END    = 22  // 10 PM
const PX_PER_HOUR = 64  // pixels per hour
const PX_PER_MIN  = PX_PER_HOUR / 60

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'day' | 'week'

interface PositionedEvent {
  event: GCalEventWithCalendar
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

function layoutDayEvents(events: GCalEventWithCalendar[], dayDate: Date, dayIdx: number): PositionedEvent[] {
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
}: { pe: PositionedEvent; dayWidth: number; onClick: (e: GCalEventWithCalendar) => void }) {
  const type  = detectMeetingType(pe.event)
  const color = pe.event.calendarColor ?? getMeetingColor(type)
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

// ─── macOS-style Event Edit Modal ─────────────────────────────────────────────

interface EditState {
  id?: string
  calendarId: string
  title: string
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  location: string
  description: string
  videoLink?: string
  attendees: { email: string; displayName?: string; responseStatus?: string }[]
}

function eventToEdit(event: GCalEventWithCalendar): EditState {
  const allDay = !event.start.dateTime
  const sd = allDay
    ? new Date(event.start.date! + 'T00:00:00')
    : new Date(event.start.dateTime!)
  const ed = allDay
    ? new Date(event.end.date! + 'T00:00:00')
    : new Date(event.end.dateTime!)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.summary ?? '',
    allDay,
    startDate: `${sd.getFullYear()}-${pad(sd.getMonth()+1)}-${pad(sd.getDate())}`,
    startTime: allDay ? '' : `${pad(sd.getHours())}:${pad(sd.getMinutes())}`,
    endDate: `${ed.getFullYear()}-${pad(ed.getMonth()+1)}-${pad(ed.getDate())}`,
    endTime: allDay ? '' : `${pad(ed.getHours())}:${pad(ed.getMinutes())}`,
    location: event.location ?? '',
    description: event.description ?? '',
    videoLink: event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri,
    attendees: event.attendees ?? [],
  }
}

function blankEdit(calendarId: string): EditState {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const startH = now.getHours() + 1
  return {
    calendarId,
    title: '',
    allDay: false,
    startDate: date, startTime: `${pad(startH)}:00`,
    endDate: date,   endTime: `${pad(startH + 1)}:00`,
    location: '', description: '', attendees: [],
  }
}

import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'

function EventEditModal({
  initial, calendars, onSave, onDelete, onClose,
}: {
  initial: EditState
  calendars: GCalCalendar[]
  onSave: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [state, setState] = useState<EditState>(initial)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const isNew = !initial.id

  function set<K extends keyof EditState>(k: K, v: EditState[K]) {
    setState(prev => ({ ...prev, [k]: v }))
  }

  const finp: React.CSSProperties = {
    background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 7,
    padding: '7px 10px', fontSize: 13, color: '#E8EAF6', outline: 'none', width: '100%',
    boxSizing: 'border-box',
  }
  const flbl: React.CSSProperties = { fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4 }

  async function handleSave() {
    if (!state.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const payload = {
      summary: state.title.trim(),
      description: state.description || undefined,
      location: state.location || undefined,
      start: state.allDay
        ? { date: state.startDate }
        : { dateTime: `${state.startDate}T${state.startTime}:00`, timeZone: tz },
      end: state.allDay
        ? { date: state.endDate }
        : { dateTime: `${state.endDate}T${state.endTime}:00`, timeZone: tz },
    }
    try {
      if (state.id) {
        const r = await updateCalendarEvent(state.calendarId, state.id, payload)
        if (r.error) { setError(r.error); setSaving(false); return }
      } else {
        const r = await createCalendarEvent(state.calendarId, payload)
        if (r.error) { setError(r.error); setSaving(false); return }
      }
      onSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!state.id || !confirm('Delete this event?')) return
    setDeleting(true)
    try {
      await deleteCalendarEvent(state.calendarId, state.id)
      onDelete?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
    setDeleting(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: '#161929', border: '1px solid #252A3E',
        borderRadius: 18, padding: '24px 26px', width: 500, maxWidth: '94vw',
        maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            {isNew ? 'New Event' : 'Edit Event'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Title */}
        <input
          autoFocus value={state.title}
          onChange={e => set('title', e.target.value)}
          placeholder="Event title"
          style={{ ...finp, fontSize: 17, fontWeight: 600, marginBottom: 16, padding: '9px 12px' }}
        />

        {/* All-day toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button onClick={() => set('allDay', !state.allDay)} style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: state.allDay ? '#1D9E75' : '#252A3E',
            position: 'relative', flexShrink: 0, transition: 'background 0.2s',
          }}>
            <div style={{
              position: 'absolute', top: 3, left: state.allDay ? 19 : 3,
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s',
            }} />
          </button>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>All day</span>
        </div>

        {/* Date / time */}
        <div style={{ display: 'grid', gridTemplateColumns: state.allDay ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          <div>
            <span style={flbl}>Start date</span>
            <input type="date" value={state.startDate} onChange={e => set('startDate', e.target.value)} style={finp} />
          </div>
          {!state.allDay && (
            <div>
              <span style={flbl}>Start time</span>
              <input type="time" value={state.startTime} onChange={e => set('startTime', e.target.value)} style={finp} />
            </div>
          )}
          <div>
            <span style={flbl}>End date</span>
            <input type="date" value={state.endDate} onChange={e => set('endDate', e.target.value)} style={finp} />
          </div>
          {!state.allDay && (
            <div>
              <span style={flbl}>End time</span>
              <input type="time" value={state.endTime} onChange={e => set('endTime', e.target.value)} style={finp} />
            </div>
          )}
        </div>

        {/* Location */}
        <div style={{ marginBottom: 12 }}>
          <span style={flbl}>Location</span>
          <div style={{ position: 'relative' }}>
            <MapPin size={12} color="#6B7280" style={{ position: 'absolute', left: 10, top: 9, pointerEvents: 'none' }} />
            <input value={state.location} onChange={e => set('location', e.target.value)}
              placeholder="Add location"
              style={{ ...finp, paddingLeft: 28 }} />
          </div>
        </div>

        {/* Calendar selector */}
        {calendars.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <span style={flbl}>Calendar</span>
            <select value={state.calendarId} onChange={e => set('calendarId', e.target.value)} style={{ ...finp, appearance: 'none' }}>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
            </select>
          </div>
        )}

        {/* Video link (read-only) */}
        {state.videoLink && (
          <div style={{ marginBottom: 12 }}>
            <span style={flbl}>Video call</span>
            <a href={state.videoLink} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#7F77DD', textDecoration: 'none' }}>
              <Video size={12} /> Join video call
            </a>
          </div>
        )}

        {/* Attendees (read-only) */}
        {state.attendees.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <span style={flbl}>Attendees ({state.attendees.length})</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {state.attendees.slice(0, 8).map((a, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 12,
                  background: a.responseStatus === 'accepted' ? '#1D9E7520' : '#6B728020',
                  color: a.responseStatus === 'accepted' ? '#1D9E75' : '#94A3B8',
                  border: `1px solid ${a.responseStatus === 'accepted' ? '#1D9E7540' : '#252A3E'}`,
                }}>
                  {a.displayName ?? a.email}
                </span>
              ))}
              {state.attendees.length > 8 && (
                <span style={{ fontSize: 11, color: '#6B7280' }}>+{state.attendees.length - 8} more</span>
              )}
            </div>
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: 18 }}>
          <span style={flbl}>Notes</span>
          <textarea value={state.description} onChange={e => set('description', e.target.value)}
            placeholder="Add notes…" rows={3}
            style={{ ...finp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
        </div>

        {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#E05252' }}>{error}</p>}

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isNew && (
            <button onClick={() => void handleDelete()} disabled={deleting} style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(224,82,82,0.4)',
              background: 'rgba(224,82,82,0.1)', color: '#E05252',
              fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
            }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #252A3E',
            background: 'transparent', color: '#6B7280', fontSize: 12.5, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => void handleSave()} disabled={saving} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: '#1E40AF', color: '#fff',
            fontSize: 12.5, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
          }}>
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Event Detail Popover ─────────────────────────────────────────────────────

function EventDetail({
  event, onClose,
}: { event: GCalEventWithCalendar; onClose: () => void }) {
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
            {prep.contextSummary && (
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.6 }}>
                {prep.contextSummary}
              </p>
            )}
            {prep.talkingPoints && prep.talkingPoints.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Talking Points</p>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {prep.talkingPoints.map((t, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', marginBottom: 3 }}>{t}</li>)}
                </ul>
              </div>
            )}
            {prep.goal && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.6, borderTop: '1px solid var(--color-border, #252A3E)', paddingTop: 12 }}>
                <strong>Goal:</strong> {prep.goal}
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
  days, events, onEventClick,
}: {
  days: Date[]
  events: GCalEventWithCalendar[]
  onEventClick: (e: GCalEventWithCalendar) => void
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
  const [viewMode, setViewMode]               = useState<ViewMode>('week')
  const [currentDate, setCurrentDate]         = useState(() => startOfDay(new Date()))
  const [events, setEvents]                   = useState<GCalEventWithCalendar[]>([])
  const [calendars, setCalendars]             = useState<GCalCalendar[]>([])
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set())
  const [loading, setLoading]                 = useState(false)
  const [noAuth, setNoAuth]                   = useState(false)
  const [selected, setSelected]               = useState<GCalEventWithCalendar | null>(null)
  const [editing, setEditing]                 = useState<EditState | null>(null)

  // Compute days to display
  const days: Date[] = viewMode === 'day'
    ? [currentDate]
    : Array.from({ length: 7 }, (_, i) => addDays(getWeekStart(currentDate), i))

  const rangeStart = days[0]
  const rangeEnd   = addDays(days[days.length - 1], 1)

  // Load calendar list once
  useEffect(() => {
    void (async () => {
      const { calendars: cals, noAuth: na } = await listCalendars()
      if (na) { setNoAuth(true); return }
      setCalendars(cals)
    })()
  }, [])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const activeCals = calendars.length
        ? calendars.filter(c => !hiddenCalendars.has(c.id))
        : [{ id: 'primary', summary: 'Primary' } as GCalCalendar]
      const { events: evs, noAuth: na } = await fetchAllCalendarsEvents(activeCals, rangeStart, rangeEnd)
      setEvents(evs)
      setNoAuth(na)
    } catch { setNoAuth(true) }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime(), rangeEnd.getTime(), calendars, hiddenCalendars])

  useEffect(() => { void loadEvents() }, [loadEvents])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(() => { void loadEvents() }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [loadEvents])

  function toggleCalendar(id: string) {
    setHiddenCalendars(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

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

        {/* New Event */}
        <button
          onClick={() => {
            const defaultCal = calendars.find(c => c.primary) ?? calendars[0]
            setEditing(blankEdit(defaultCal?.id ?? 'primary'))
          }}
          style={{ ...navBtn, padding: '5px 14px', color: '#7F77DD', borderColor: '#7F77DD40', background: '#7F77DD10', fontWeight: 600, fontSize: 12 }}
        >
          + New
        </button>

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
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 12.5, color: '#E05252', flex: 1 }}>
            Google Calendar token expired or not connected.
          </span>
          <button
            onClick={async () => { try { await signInWithGoogle() } catch { /* ignore */ } }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: 'rgba(224,82,82,0.15)', border: '1px solid rgba(224,82,82,0.4)',
              color: '#E05252', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <LogIn size={12} /> Reconnect Google
          </button>
        </div>
      )}

      {/* ── Calendar indicator chips ─────────────────────────────────────── */}
      {calendars.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 20px',
          borderBottom: '1px solid var(--color-border, #252A3E)', flexWrap: 'wrap',
          background: 'var(--color-surface, #161929)', flexShrink: 0,
        }}>
          {calendars.map(cal => {
            const hidden = hiddenCalendars.has(cal.id)
            return (
              <button key={cal.id} onClick={() => toggleCalendar(cal.id)} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px',
                borderRadius: 20, border: '1px solid var(--color-border, #252A3E)',
                background: hidden ? 'transparent' : `${cal.backgroundColor ?? '#1E40AF'}15`,
                cursor: 'pointer', fontSize: 11.5, fontWeight: 500,
                color: hidden ? 'var(--color-text-muted, #6B7280)' : 'var(--color-text, #E8EAF6)',
                opacity: hidden ? 0.5 : 1, transition: 'all 0.15s ease',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: hidden ? '#6B7280' : (cal.backgroundColor ?? '#1E40AF'),
                  flexShrink: 0,
                }} />
                {cal.summary}
                {hidden
                  ? <EyeOff size={10} style={{ marginLeft: 2, opacity: 0.6 }} />
                  : <Eye size={10} style={{ marginLeft: 2, opacity: 0.4 }} />
                }
              </button>
            )
          })}
        </div>
      )}

      {/* ── Time grid ───────────────────────────────────────────────────────── */}
      <TimeGrid
        days={days}
        events={events}
        onEventClick={e => setEditing(eventToEdit(e))}
      />

      {/* ── Event detail (AI prep) — opens from edit modal ──────────────────── */}
      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}

      {/* ── Event edit modal ─────────────────────────────────────────────────── */}
      {editing && (
        <EventEditModal
          initial={editing}
          calendars={calendars}
          onSave={() => { setEditing(null); void loadEvents() }}
          onDelete={() => { setEditing(null); void loadEvents() }}
          onClose={() => setEditing(null)}
        />
      )}

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
