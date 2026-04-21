import { useState } from 'react'
import { CheckSquare, Clock, Users, TrendingUp, ChevronLeft, ChevronRight, CheckCircle2, XCircle, CalendarDays } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'
import type { GCalEvent } from '@/lib/googleCalendar'

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

function loadDayEvents(dayStr: string): GCalEvent[] {
  try {
    const raw = localStorage.getItem('cal-intel-events-cache')
    if (!raw) return []
    const entry = JSON.parse(raw) as { weekKey: string; events: GCalEvent[]; savedAt: number }
    return (entry.events ?? []).filter(e => {
      const d = e.start.dateTime?.slice(0, 10) ?? e.start.date ?? ''
      return d === dayStr
    })
  } catch { return [] }
}

function loadWeekEventsGrouped(): Record<string, GCalEvent[]> {
  try {
    const raw = localStorage.getItem('cal-intel-events-cache')
    if (!raw) return {}
    const entry = JSON.parse(raw) as { weekKey: string; events: GCalEvent[]; savedAt: number }
    const result: Record<string, GCalEvent[]> = {}
    for (const e of entry.events ?? []) {
      const d = e.start.dateTime?.slice(0, 10) ?? e.start.date ?? ''
      if (d) { if (!result[d]) result[d] = []; result[d].push(e) }
    }
    return result
  } catch { return {} }
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
      background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)',
      borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: color, borderRadius: '12px 0 0 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {editable && onChange ? (
            <input type="number" min={0} max={168} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
              style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', background: 'none', border: 'none', outline: 'none', width: 80, padding: 0 }} />
          ) : (
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</div>
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
      <span style={{ fontSize: 10.5, color: '#4B5268', background: '#1A1D2E', borderRadius: 10, padding: '0 6px', fontWeight: 600 }}>{count}</span>
    </div>
  )
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event, cancelled }: { event: GCalEvent; cancelled?: boolean }) {
  const time = fmtEventTime(event)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#0D0F1A', border: '1px solid #1A1D2E', marginBottom: 5 }}>
      {cancelled
        ? <XCircle size={13} color="#6B7280" style={{ flexShrink: 0 }} />
        : <CheckCircle2 size={13} color="#1D9E75" style={{ flexShrink: 0 }} />
      }
      {time && (
        <span style={{ fontSize: 11, color: cancelled ? '#4B5268' : '#7F77DD', fontWeight: 600, minWidth: 54, flexShrink: 0 }}>{time}</span>
      )}
      <span style={{ fontSize: 13, color: cancelled ? '#4B5268' : '#C0C4D6', flex: 1, textDecoration: cancelled ? 'line-through' : 'none' }}>
        {event.summary ?? '(No title)'}
      </span>
    </div>
  )
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ title, company, cancelled }: { title: string; company?: string; cancelled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#0D0F1A', border: '1px solid #1A1D2E', marginBottom: 5 }}>
      {cancelled
        ? <XCircle size={13} color="#6B7280" style={{ flexShrink: 0 }} />
        : <CheckSquare size={13} color="#1D9E75" style={{ flexShrink: 0 }} />
      }
      <span style={{ fontSize: 13, color: cancelled ? '#4B5268' : '#C0C4D6', flex: 1, textDecoration: cancelled ? 'line-through' : 'none' }}>
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
      <div style={{ height: 4, width: 80, background: '#1A1D2E', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, color: '#8B93A8' }}>
        <span style={{ color, fontWeight: 600 }}>{done}</span>
        <span style={{ color: '#4B5268' }}>/{total}</span>
        <span style={{ marginLeft: 4 }}>{label}</span>
      </span>
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

  const doneEvts       = events.filter(e => statuses[e.id] === 'done').sort(sortByTime)
  const cancelledEvts  = events.filter(e => statuses[e.id] === 'cancelled').sort(sortByTime)
  const dayTasks       = tasks.filter(t => t.dueDate === dayStr)
  const doneTasks      = dayTasks.filter(t => t.completed || t.status === 'done')
  const cancelledTasks = dayTasks.filter(t => t.status === 'cancelled' && !t.completed)

  const hasActivity = doneEvts.length > 0 || cancelledEvts.length > 0 || doneTasks.length > 0 || cancelledTasks.length > 0

  return (
    <div style={{ borderBottom: '1px solid #1A1D2E' }}>
      {/* Day header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '13px 20px',
        background: isToday ? 'rgba(127,119,221,0.05)' : undefined,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: isToday ? '#7F77DD' : '#8B93A8', minWidth: 120 }}>
          {dayLabel}{isToday ? '  ·  Today' : ''}
        </span>
        <span style={{ fontSize: 11, color: doneEvts.length > 0 ? '#7F77DD' : '#3A3F55' }}>
          {doneEvts.length}/{events.length} events
        </span>
        <span style={{ color: '#252A3E', fontSize: 11 }}>·</span>
        <span style={{ fontSize: 11, color: doneTasks.length > 0 ? '#1D9E75' : '#3A3F55' }}>
          {doneTasks.length}/{dayTasks.length} tasks
        </span>
        {!hasActivity && (
          <span style={{ fontSize: 11, color: '#3A3F55', marginLeft: 'auto' }}>No activity</span>
        )}
      </div>

      {/* Items */}
      {hasActivity && (
        <div style={{ padding: '2px 20px 12px' }}>
          {doneEvts.map(e      => <EventRow key={e.id} event={e} />)}
          {cancelledEvts.map(e => <EventRow key={e.id} event={e} cancelled />)}
          {doneTasks.map(t     => <TaskRow key={t.id} title={t.title} company={t.company} />)}
          {cancelledTasks.map(t => <TaskRow key={t.id} title={t.title} company={t.company} cancelled />)}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReviewModule() {
  const tasks = useTaskStore(s => s.tasks)

  const completedTasks = tasks.filter(t => t.completed)
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
  const doneEvents      = dayEvents.filter(e => eventStatuses[e.id] === 'done').sort(sortByTime)
  const cancelledEvents = dayEvents.filter(e => eventStatuses[e.id] === 'cancelled').sort(sortByTime)
  const dayTasks        = tasks.filter(t => t.dueDate === selectedDay)
  const doneTasks       = dayTasks.filter(t => t.completed || t.status === 'done')
  const cancelledTasks  = dayTasks.filter(t => t.status === 'cancelled' && !t.completed)
  const isDailyEmpty    = doneEvents.length === 0 && cancelledEvents.length === 0 && doneTasks.length === 0 && cancelledTasks.length === 0

  // ── Weekly ─────────────────────────────────────────────────────────────────
  const weekStart     = getMondayOf(selectedDay)
  const weekDays      = getWeekDays(weekStart)
  const weekEventsMap = loadWeekEventsGrouped()

  const allWeekEvents  = Object.values(weekEventsMap).flat()
  const weekDoneEvts   = allWeekEvents.filter(e => eventStatuses[e.id] === 'done').length
  const weekTasksAll   = tasks.filter(t => t.dueDate && weekDays.includes(t.dueDate))
  const weekDoneTasks  = weekTasksAll.filter(t => t.completed || t.status === 'done').length

  const isCurrentWeek = weekStart === getMondayOf(todayStr())

  return (
    <div>
      <TopBar title="Weekly Review" subtitle="Reflect, realign, and reset your compass." />

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Week label ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 3px', fontSize: 20, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px' }}>
            Week of {new Date(getMonday() + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </h2>
        </div>

        {/* ─── Stats grid ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
          <StatCard label="Tasks Shipped" value={completedTasks.length} sub="This week" icon={CheckSquare} color="#1D9E75" />
          <StatCard label="Tasks Slipped" value={slipped} sub={slipped > 0 ? 'Past due date' : 'All on track'} icon={TrendingUp} color={slipped > 0 ? '#E05252' : '#1D9E75'} />
          <StatCard label="Focus Hours" value={focusHours} sub="Click to edit" icon={Clock} color="#7F77DD" editable onChange={v => { setFocusHours(v); saveHours(v, meetingHours) }} />
          <StatCard label="Meeting Hours" value={meetingHours} sub="Click to edit" icon={Users} color="#1E40AF" editable onChange={v => { setMeetingHours(v); saveHours(focusHours, v) }} />
        </div>

        {/* ─── Panel ──────────────────────────────────────────────────────── */}
        <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 14, overflow: 'hidden' }}>

          {/* Navigation header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--color-border, #252A3E)' }}>

            <button
              onClick={() => setSelectedDay(d => shiftDay(d, viewMode === 'weekly' ? -7 : -1))}
              style={{ background: 'none', border: '1px solid #252A3E', borderRadius: 7, cursor: 'pointer', color: '#8B93A8', padding: '5px 8px', display: 'flex', alignItems: 'center' }}
            ><ChevronLeft size={15} /></button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarDays size={15} color="#7F77DD" />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>
                {viewMode === 'daily'
                  ? fmtDayLabel(selectedDay)
                  : `Week of ${fmtWeekRange(weekStart)}`
                }
              </span>
              {(viewMode === 'daily' ? selectedDay !== todayStr() : !isCurrentWeek) && (
                <button
                  onClick={() => setSelectedDay(todayStr())}
                  style={{ fontSize: 11, color: '#7F77DD', background: 'rgba(127,119,221,0.1)', border: '1px solid rgba(127,119,221,0.25)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}
                >Today</button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Daily / Weekly toggle */}
              <div style={{ display: 'flex', background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 7, overflow: 'hidden' }}>
                {(['daily', 'weekly'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    style={{
                      padding: '4px 13px', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: viewMode === mode ? '#7F77DD' : 'none',
                      color: viewMode === mode ? '#fff' : '#6B7280',
                      textTransform: 'capitalize',
                    }}
                  >{mode}</button>
                ))}
              </div>
              <button
                onClick={() => setSelectedDay(d => shiftDay(d, viewMode === 'weekly' ? +7 : +1))}
                style={{ background: 'none', border: '1px solid #252A3E', borderRadius: 7, cursor: 'pointer', color: '#8B93A8', padding: '5px 8px', display: 'flex', alignItems: 'center' }}
              ><ChevronRight size={15} /></button>
            </div>
          </div>

          {/* Analytics bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '11px 20px', borderBottom: '1px solid #1A1D2E', background: '#0D0F1A' }}>
            {viewMode === 'daily' ? (
              <>
                <PillStat done={doneEvents.length} total={dayEvents.length} label="events done" color="#7F77DD" />
                <div style={{ width: 1, height: 20, background: '#252A3E' }} />
                <PillStat done={doneTasks.length} total={dayTasks.length} label="tasks done" color="#1D9E75" />
              </>
            ) : (
              <>
                <PillStat done={weekDoneEvts} total={allWeekEvents.length} label="events done this week" color="#7F77DD" />
                <div style={{ width: 1, height: 20, background: '#252A3E' }} />
                <PillStat done={weekDoneTasks} total={weekTasksAll.length} label="tasks done this week" color="#1D9E75" />
              </>
            )}
          </div>

          {/* ── Daily content ──────────────────────────────────────────────── */}
          {viewMode === 'daily' && (
            <div style={{ padding: 20 }}>
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
                      <SectionHead label="Events Done" count={doneEvents.length} color="#7F77DD" />
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
                      {doneTasks.map(t => <TaskRow key={t.id} title={t.title} company={t.company} />)}
                    </div>
                  )}
                  {cancelledTasks.length > 0 && (
                    <div>
                      <SectionHead label="Tasks Cancelled" count={cancelledTasks.length} color="#6B7280" />
                      {cancelledTasks.map(t => <TaskRow key={t.id} title={t.title} company={t.company} cancelled />)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Weekly content ─────────────────────────────────────────────── */}
          {viewMode === 'weekly' && (
            <div>
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
