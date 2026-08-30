import { useState } from 'react'
import { CheckSquare, Clock, Users, TrendingUp, ChevronLeft, ChevronRight, CheckCircle2, XCircle, CalendarDays } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'
import { isTaskHidden, loadDynamicCompanies } from '@/types'
import type { GCalEvent } from '@/lib/googleCalendar'

type ExtEvent = GCalEvent & { calendarColor?: string; calendarId?: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPANY_COLORS: Record<string, string> = {}

// ─── Storage helpers ─────────────────────────────────────────────────────────

function loadHours(): { focus: number; meeting: number } {
  try {
    const raw = localStorage.getItem('professor-review-hours')
    return raw ? (JSON.parse(raw) as { focus: number; meeting: number }) : { focus: 0, meeting: 0 }
  } catch { return { focus: 0, meeting: 0 } }
}

function saveHours(focus: number, meeting: number) {
  try { localStorage.setItem('professor-review-hours', JSON.stringify({ focus, meeting })) } catch { /* quota */ }
}

type EventStatus = 'done' | 'cancelled'

function loadEventStatuses(): Record<string, EventStatus> {
  try { const r = localStorage.getItem('cal-event-statuses'); return r ? JSON.parse(r) as Record<string, EventStatus> : {} } catch { return {} }
}

// Scan every cal-intel-events-cache:* slot and collect all events.
// This avoids any key-format dependency (timezone, Sunday vs Monday start, etc.)
function loadAllCachedEvents(): GCalEvent[] {
  const all: GCalEvent[] = []
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('cal-intel-events-cache:')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const entry = JSON.parse(raw) as { events?: GCalEvent[] }
      all.push(...(entry.events ?? []))
    }
  } catch { /* ignore */ }
  return all
}

function loadDayEvents(dayStr: string): GCalEvent[] {
  return loadAllCachedEvents().filter(
    e => (e.start.dateTime?.slice(0, 10) ?? e.start.date ?? '') === dayStr
  )
}

function loadWeekEventsGrouped(mondayStr: string): Record<string, GCalEvent[]> {
  const weekDays = new Set(Array.from({ length: 7 }, (_, i) => shiftDay(mondayStr, i)))
  const result: Record<string, GCalEvent[]> = {}
  for (const e of loadAllCachedEvents()) {
    const d = e.start.dateTime?.slice(0, 10) ?? e.start.date ?? ''
    if (!weekDays.has(d)) continue
    if (!result[d]) result[d] = []
    result[d].push(e)
  }
  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr(): string { return new Date().toISOString().slice(0, 10) }

function shiftDay(dayStr: string, delta: number): string {
  const d = new Date(dayStr + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

function getMondayOf(dayStr: string): string {
  const d = new Date(dayStr + 'T12:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().slice(0, 10)
}

function getWeekDays(mondayStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(mondayStr, i))
}

// Determine which day a completed task "belongs to" for review display.
// If completedAt is set, use it. Otherwise fall back to dueDate — but cap
// at today so a task with a future dueDate doesn't vanish into tomorrow.
function completionAnchor(t: { completedAt?: string; dueDate?: string }): string | undefined {
  if (t.completedAt) return t.completedAt
  if (!t.dueDate) return undefined
  return t.dueDate > todayStr() ? todayStr() : t.dueDate
}

function fmtDayLabel(dayStr: string): string {
  const today = todayStr()
  const yesterday = shiftDay(today, -1)
  const tomorrow  = shiftDay(today, +1)
  const d = new Date(dayStr + 'T12:00:00')
  const base = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  if (dayStr === today)     return `Today · ${base}`
  if (dayStr === yesterday) return `Yesterday · ${base}`
  if (dayStr === tomorrow)  return `Tomorrow · ${base}`
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtWeekRange(mondayStr: string): string {
  const mon = new Date(mondayStr + 'T12:00:00')
  const sun = new Date(mondayStr + 'T12:00:00')
  sun.setDate(sun.getDate() + 6)
  const monLabel = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const sunLabel = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${monLabel} – ${sunLabel}`
}

function fmtEventTime(e: GCalEvent): string {
  if (e.start.date && !e.start.dateTime) return 'All day'
  if (!e.start.dateTime) return ''
  return new Date(e.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function sortByTime(a: GCalEvent, b: GCalEvent): number {
  const ta = a.start.dateTime ?? a.start.date ?? ''
  const tb = b.start.dateTime ?? b.start.date ?? ''
  return ta.localeCompare(tb)
}

function getMonday(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color, editable, onChange,
}: {
  label: string; value: number | string; sub: string
  icon: React.ElementType; color: string; editable?: boolean; onChange?: (v: number) => void
}) {
  return (
    <div style={{
      background: 'var(--sb-card)', border: '1px solid var(--sb-border)',
      borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: color, borderRadius: '12px 0 0 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {editable && onChange ? (
            <input type="number" min={0} max={168} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
              style={{ fontSize: 28, fontWeight: 700, color: 'var(--sb-ink-1)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', background: 'none', border: 'none', outline: 'none', width: 80, padding: 0 }} />
          ) : (
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--sb-ink-1)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</div>
          )}
          <div style={{ fontSize: 12.5, color: '#FFFFFF', marginTop: 4 }}>{label}</div>
          <div style={{ fontSize: 11, color, marginTop: 6, fontWeight: 500 }}>{sub}</div>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} color={color} />
        </div>
      </div>
    </div>
  )
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHead({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      <span style={{ fontSize: 10.5, color: '#4B5268', background: 'var(--sb-card)', borderRadius: 10, padding: '0 6px', fontWeight: 600 }}>{count}</span>
    </div>
  )
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event, cancelled }: { event: GCalEvent; cancelled?: boolean }) {
  const time = fmtEventTime(event)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--sb-card)', marginBottom: 5 }}>
      {cancelled
        ? <XCircle size={13} color="#6B7280" style={{ flexShrink: 0 }} />
        : <CheckCircle2 size={13} color="#1D9E75" style={{ flexShrink: 0 }} />
      }
      {time && (
        <span style={{ fontSize: 11, color: cancelled ? '#4B5268' : 'var(--color-accent)', fontWeight: 600, minWidth: 54, flexShrink: 0 }}>{time}</span>
      )}
      <span style={{ fontSize: 13, color: cancelled ? '#4B5268' : 'var(--sb-ink-2)', flex: 1, textDecoration: cancelled ? 'line-through' : 'none' }}>
        {event.summary ?? '(No title)'}
      </span>
    </div>
  )
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function resolveCompanyLabel(task: Task): string | undefined {
  const companies = loadDynamicCompanies()
  if (task.companyId) {
    const dyn = companies.find(c => c.id === task.companyId)
    if (dyn) return dyn.name
  }
  // task.company may be a UUID (stored directly by some code paths) — resolve it
  if (task.company) {
    const byId = companies.find(c => c.id === task.company)
    if (byId) return byId.name
    if (task.company !== 'personal') return task.company
  }
  return undefined
}

function TaskRow({ title, company, cancelled }: { title: string; company?: string; cancelled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--sb-card)', marginBottom: 5 }}>
      {cancelled
        ? <XCircle size={13} color="#6B7280" style={{ flexShrink: 0 }} />
        : <CheckSquare size={13} color="#1D9E75" style={{ flexShrink: 0 }} />
      }
      <span style={{ fontSize: 13, color: cancelled ? '#4B5268' : 'var(--sb-ink-2)', flex: 1, textDecoration: cancelled ? 'line-through' : 'none' }}>
        {title}
      </span>
      {company && (
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0, color: COMPANY_COLORS[company] ?? '#6B7280', background: `${COMPANY_COLORS[company] ?? '#6B7280'}18`, fontWeight: 500 }}>
          {company}
        </span>
      )}
    </div>
  )
}

// ─── Pill stat ────────────────────────────────────────────────────────────────

function PillStat({ done, total, label, color }: { done: number; total: number; label: string; color: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ height: 4, width: 80, background: 'var(--sb-card)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--color-text-dim, #8B93A8)' }}>
        <span style={{ color, fontWeight: 600 }}>{done}</span>
        <span style={{ color: '#4B5268' }}>/{total}</span>
        <span style={{ marginLeft: 4 }}>{label}</span>
      </span>
    </div>
  )
}

// ─── Pie chart ────────────────────────────────────────────────────────────────

type PieSlice = { label: string; minutes: number; color: string }

function loadCalNames(): Map<string, { name: string; color: string }> {
  try {
    const raw = localStorage.getItem('cal-intel-cals-cache')
    if (!raw) return new Map()
    const cals = JSON.parse(raw) as { id: string; summary?: string; backgroundColor?: string }[]
    return new Map(cals.map(c => [c.id, { name: c.summary ?? 'Calendar', color: c.backgroundColor ?? '#7F77DD' }]))
  } catch { return new Map() }
}

function eventMins(e: GCalEvent): number {
  const s = e.start.dateTime, f = e.end?.dateTime
  if (!s || !f) return 0
  return Math.max(0, (new Date(f).getTime() - new Date(s).getTime()) / 60000)
}

function buildPieSlices(
  events: GCalEvent[],
  tasks: Task[],
  statuses: Record<string, EventStatus>,
  dayCount: number,
): PieSlice[] {
  const calMap  = loadCalNames()
  const SLEEP   = dayCount * 8 * 60
  const TOTAL   = dayCount * 24 * 60

  const done = events.filter(e => statuses[e.id] === 'done')
  const byCalId = new Map<string, { label: string; color: string; mins: number }>()
  let evtTotal = 0

  for (const e of done) {
    const ext = e as ExtEvent
    const id  = ext.calendarId ?? '__primary__'
    const info = ext.calendarId ? calMap.get(ext.calendarId) : null
    const color = info?.color ?? ext.calendarColor ?? '#7F77DD'
    const label = info?.name  ?? 'Calendar'
    const m = eventMins(e)
    evtTotal += m
    const existing = byCalId.get(id)
    if (existing) existing.mins += m
    else byCalId.set(id, { label, color, mins: m })
  }

  const taskTotal = tasks
    .filter(t => t.completed || t.status === 'done')
    .reduce((s, t) => s + (t.duration ?? 0), 0)

  const free = Math.max(0, TOTAL - SLEEP - evtTotal - taskTotal)

  return [
    { label: 'Sleep', minutes: SLEEP, color: '#13152B' },
    ...[...byCalId.values()].filter(v => v.mins > 0).map(v => ({ label: v.label, minutes: v.mins, color: v.color })),
    ...(taskTotal > 0 ? [{ label: 'Tasks', minutes: taskTotal, color: '#1D9E75' }] : []),
    { label: 'Unaccounted', minutes: free, color: '#252A3E' },
  ]
}

function PieChart({ slices, title }: { slices: PieSlice[]; title: string }) {
  const total = slices.reduce((s, sl) => s + sl.minutes, 0)
  if (total === 0) return null
  const active = slices.filter(sl => sl.minutes > 0)
  const R = 56, cx = 68, cy = 68
  let angle = -Math.PI / 2
  const paths = active.map(sl => {
    const frac = sl.minutes / total
    const a0 = angle, a1 = angle + frac * 2 * Math.PI
    angle = a1
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0)
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1)
    return { d: `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`, color: sl.color, label: sl.label, mins: sl.minutes }
  })
  const fmt = (m: number) => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`

  return (
    <div style={{ background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--sb-card)', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-muted, #8B93A8)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <svg width={136} height={136} style={{ flexShrink: 0 }}>
          {paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.color} stroke="var(--color-bg, #0D0F1A)" strokeWidth={1.5} />
          ))}
        </svg>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 130 }}>
          {active.map((sl, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: sl.color, border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: 'var(--sb-ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sl.label}</span>
              <span style={{ fontSize: 11, color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt(sl.minutes)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Weekly day card ──────────────────────────────────────────────────────────

function WeeklyDayCard({ dayStr, allEvents, statuses, tasks }: {
  dayStr: string
  allEvents: Record<string, GCalEvent[]>
  statuses: Record<string, EventStatus>
  tasks: Task[]
}) {
  const isToday = dayStr === todayStr()
  const dayLabel = new Date(dayStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const events = allEvents[dayStr] ?? []

  const doneEvts       = events.filter(e => isEventDone(e, statuses)).sort(sortByTime)
  const cancelledEvts  = events.filter(e => statuses[e.id] === 'cancelled').sort(sortByTime)
  const dayTasks = tasks.filter(t => {
    if (t.completed || t.status === 'done') return completionAnchor(t) === dayStr
    return t.dueDate === dayStr
  })
  const doneTasks      = dayTasks.filter(t => t.completed || t.status === 'done')
  const cancelledTasks = dayTasks.filter(t => t.status === 'cancelled' && !t.completed)

  const hasActivity = doneEvts.length > 0 || cancelledEvts.length > 0 || doneTasks.length > 0 || cancelledTasks.length > 0

  return (
    <div style={{ borderBottom: '1px solid var(--sb-card)' }}>
      {/* Day header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', gap: 12,
        background: isToday ? 'rgba(127,119,221,0.05)' : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {isToday && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-accent)', background: 'rgba(127,119,221,0.15)', border: '1px solid rgba(127,119,221,0.3)', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>TODAY</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 700, color: isToday ? 'var(--color-accent)' : 'var(--sb-ink-2)', whiteSpace: 'nowrap' }}>
            {dayLabel}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, color: doneEvts.length > 0 ? 'var(--color-accent)' : '#3A3F55', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 600, color: doneEvts.length > 0 ? 'var(--color-accent)' : '#3A3F55' }}>{doneEvts.length}</span>
            <span style={{ color: '#3A3F55' }}>/ {events.length}</span>
            <span style={{ color: '#3A3F55' }}>events</span>
          </span>
          <div style={{ width: 1, height: 12, background: 'var(--sb-border)' }} />
          <span style={{ fontSize: 11.5, color: doneTasks.length > 0 ? '#1D9E75' : '#3A3F55', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 600, color: doneTasks.length > 0 ? '#1D9E75' : '#3A3F55' }}>{doneTasks.length}</span>
            <span style={{ color: '#3A3F55' }}>/ {dayTasks.length}</span>
            <span style={{ color: '#3A3F55' }}>tasks</span>
          </span>
          {!hasActivity && (
            <span style={{ fontSize: 11, color: '#3A3F55' }}>No activity</span>
          )}
        </div>
      </div>

      {/* Items */}
      {hasActivity && (
        <div style={{ padding: '4px 20px 14px' }}>
          {doneEvts.map(e       => <EventRow key={e.id} event={e} />)}
          {cancelledEvts.map(e  => <EventRow key={e.id} event={e} cancelled />)}
          {doneTasks.map(t      => <TaskRow key={t.id} title={t.title} company={resolveCompanyLabel(t)} />)}
          {cancelledTasks.map(t => <TaskRow key={t.id} title={t.title} company={resolveCompanyLabel(t)} cancelled />)}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// An event counts as "done" if manually marked done OR it already happened and wasn't cancelled
function isEventDone(e: GCalEvent, statuses: Record<string, EventStatus>): boolean {
  if (statuses[e.id] === 'cancelled') return false
  if (statuses[e.id] === 'done') return true
  const end = e.end?.dateTime ?? e.end?.date
  return !!end && new Date(end) < new Date()
}

export function ReviewModule() {
  const tasks = useTaskStore(s => s.tasks).filter(t => !isTaskHidden(t))

  // "Tasks Shipped" = completed THIS week only
  const thisWeekDays   = new Set(getWeekDays(getMondayOf(todayStr())))
  const completedTasks = tasks.filter(t => t.completed && thisWeekDays.has(completionAnchor(t) ?? ''))
  const activeTasks    = tasks.filter(t => !t.completed)
  const slipped        = activeTasks.filter(t => t.dueDate && t.dueDate < todayStr()).length

  const [focusHours,   setFocusHours]   = useState(() => loadHours().focus)
  const [meetingHours, setMeetingHours] = useState(() => loadHours().meeting)
  const [selectedDay,  setSelectedDay]  = useState(todayStr)
  const [viewMode,     setViewMode]     = useState<'daily' | 'weekly'>('daily')

  // ── Shared ─────────────────────────────────────────────────────────────────
  const eventStatuses = loadEventStatuses()

  // ── Daily ──────────────────────────────────────────────────────────────────
  const dayEvents       = loadDayEvents(selectedDay)
  const doneEvents      = dayEvents.filter(e => isEventDone(e, eventStatuses)).sort(sortByTime)
  const cancelledEvents = dayEvents.filter(e => eventStatuses[e.id] === 'cancelled').sort(sortByTime)
  // Tasks "for" a day: done/cancelled tasks use completedAt (falling back to dueDate for
  // older tasks without completedAt); open tasks use dueDate so they still appear on their day.
  const dayTasks = tasks.filter(t => {
    if (t.completed || t.status === 'done') return completionAnchor(t) === selectedDay
    return t.dueDate === selectedDay
  })
  const doneTasks       = dayTasks.filter(t => t.completed || t.status === 'done')
  const cancelledTasks  = dayTasks.filter(t => t.status === 'cancelled' && !t.completed)
  const isDailyEmpty    = doneEvents.length === 0 && cancelledEvents.length === 0 && doneTasks.length === 0 && cancelledTasks.length === 0

  // ── Weekly ─────────────────────────────────────────────────────────────────
  const weekStart     = getMondayOf(selectedDay)
  const weekDays      = getWeekDays(weekStart)
  const weekEventsMap = loadWeekEventsGrouped(weekStart)

  const allWeekEvents  = Object.values(weekEventsMap).flat()
  const weekDoneEvts   = allWeekEvents.filter(e => isEventDone(e, eventStatuses)).length
  const weekTasksAll   = tasks.filter(t => {
    const anchor = (t.completed || t.status === 'done') ? completionAnchor(t) : t.dueDate
    return anchor && weekDays.includes(anchor)
  })
  const weekDoneTasks  = weekTasksAll.filter(t => t.completed || t.status === 'done').length

  const isCurrentWeek = weekStart === getMondayOf(todayStr())

  return (
    <div>

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Week label ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 3px', fontSize: 20, fontWeight: 700, color: 'var(--sb-ink-1)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px' }}>
            Week of {new Date(getMonday() + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </h2>
        </div>

        {/* ─── Stats grid ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
          <StatCard label="Tasks Shipped" value={completedTasks.length} sub="This week" icon={CheckSquare} color="#1D9E75" />
          <StatCard label="Tasks Slipped" value={slipped} sub={slipped > 0 ? 'Past due date' : 'All on track'} icon={TrendingUp} color={slipped > 0 ? '#E05252' : '#1D9E75'} />
          <StatCard label="Focus Hours" value={focusHours} sub="Click to edit" icon={Clock} color="var(--color-accent)" editable onChange={v => { setFocusHours(v); saveHours(v, meetingHours) }} />
          <StatCard label="Meeting Hours" value={meetingHours} sub="Click to edit" icon={Users} color="var(--color-accent)" editable onChange={v => { setMeetingHours(v); saveHours(focusHours, v) }} />
        </div>

        {/* ─── Panel ──────────────────────────────────────────────────────── */}
        <div style={{ background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 14, overflow: 'hidden' }}>

          {/* Navigation header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--sb-border)' }}>

            <button
              onClick={() => setSelectedDay(d => shiftDay(d, viewMode === 'weekly' ? -7 : -1))}
              style={{ background: 'none', border: '1px solid var(--sb-border)', borderRadius: 7, cursor: 'pointer', color: 'var(--color-text-dim, #8B93A8)', padding: '5px 8px', display: 'flex', alignItems: 'center' }}
            ><ChevronLeft size={15} /></button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarDays size={15} color="var(--color-accent)" />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                {viewMode === 'daily'
                  ? fmtDayLabel(selectedDay)
                  : `Week of ${fmtWeekRange(weekStart)}`
                }
              </span>
              {(viewMode === 'daily' ? selectedDay !== todayStr() : !isCurrentWeek) && (
                <button
                  onClick={() => setSelectedDay(todayStr())}
                  style={{ fontSize: 11, color: 'var(--color-accent)', background: 'rgba(127,119,221,0.1)', border: '1px solid rgba(127,119,221,0.25)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}
                >Today</button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Daily / Weekly toggle */}
              <div style={{ display: 'flex', background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--sb-border)', borderRadius: 7, overflow: 'hidden' }}>
                {(['daily', 'weekly'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    style={{
                      padding: '5px 14px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: viewMode === mode ? 'var(--color-accent)' : 'none',
                      color: viewMode === mode ? '#fff' : 'var(--sb-ink-3)',
                      textTransform: 'capitalize',
                    }}
                  >{mode}</button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setSelectedDay(d => shiftDay(d, viewMode === 'weekly' ? +7 : +1))}
              style={{ background: 'none', border: '1px solid var(--sb-border)', borderRadius: 7, cursor: 'pointer', color: 'var(--color-text-dim, #8B93A8)', padding: '5px 8px', display: 'flex', alignItems: 'center' }}
            ><ChevronRight size={15} /></button>
          </div>

          {/* Analytics bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '11px 20px', borderBottom: '1px solid var(--sb-card)', background: 'var(--color-bg, #0D0F1A)' }}>
            {viewMode === 'daily' ? (
              <>
                <PillStat done={doneEvents.length} total={dayEvents.length} label="events done" color="var(--color-accent)" />
                <div style={{ width: 1, height: 20, background: 'var(--sb-border)' }} />
                <PillStat done={doneTasks.length} total={dayTasks.length} label="tasks done" color="#1D9E75" />
              </>
            ) : (
              <>
                <PillStat done={weekDoneEvts} total={allWeekEvents.length} label="events done this week" color="var(--color-accent)" />
                <div style={{ width: 1, height: 20, background: 'var(--sb-border)' }} />
                <PillStat done={weekDoneTasks} total={weekTasksAll.length} label="tasks done this week" color="#1D9E75" />
              </>
            )}
          </div>

          {/* ── Daily content ──────────────────────────────────────────────── */}
          {viewMode === 'daily' && (
            <div style={{ padding: 20 }}>
              <PieChart
                title={`How ${selectedDay === todayStr() ? 'today' : 'this day'} was spent`}
                slices={buildPieSlices(dayEvents, dayTasks, eventStatuses, 1)}
              />
              {isDailyEmpty ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#4B5268' }}>
                  <CalendarDays size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
                  <p style={{ margin: 0, fontSize: 13 }}>No events or tasks recorded for this day.</p>
                  {dayEvents.length === 0 && (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: '#3A3F55' }}>Events load from the current week's cache — open Cal Intel to load another week.</p>
                  )}
                </div>
              ) : (
                <>
                  {doneEvents.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <SectionHead label="Events Done" count={doneEvents.length} color="var(--color-accent)" />
                      {doneEvents.map(e => <EventRow key={e.id} event={e} />)}
                    </div>
                  )}
                  {cancelledEvents.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <SectionHead label="Events Cancelled" count={cancelledEvents.length} color="#6B7280" />
                      {cancelledEvents.map(e => <EventRow key={e.id} event={e} cancelled />)}
                    </div>
                  )}
                  {doneTasks.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <SectionHead label="Tasks Done" count={doneTasks.length} color="#1D9E75" />
                      {doneTasks.map(t => <TaskRow key={t.id} title={t.title} company={resolveCompanyLabel(t)} />)}
                    </div>
                  )}
                  {cancelledTasks.length > 0 && (
                    <div>
                      <SectionHead label="Tasks Cancelled" count={cancelledTasks.length} color="#6B7280" />
                      {cancelledTasks.map(t => <TaskRow key={t.id} title={t.title} company={resolveCompanyLabel(t)} cancelled />)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Weekly content ─────────────────────────────────────────────── */}
          {viewMode === 'weekly' && (
            <div>
              <div style={{ padding: '20px 20px 4px' }}>
                <PieChart
                  title={`How this week was spent (${weekDays.filter(d => d <= todayStr()).length} days so far)`}
                  slices={buildPieSlices(
                    Object.values(weekEventsMap).flat(),
                    weekTasksAll,
                    eventStatuses,
                    Math.max(1, weekDays.filter(d => d <= todayStr()).length),
                  )}
                />
              </div>
              {weekDays.map(day => (
                <WeeklyDayCard
                  key={day}
                  dayStr={day}
                  allEvents={weekEventsMap}
                  statuses={eventStatuses}
                  tasks={tasks}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
