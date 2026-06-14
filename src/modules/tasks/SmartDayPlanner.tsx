import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { X, RefreshCw, Check, CalendarPlus } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { useAuthStore } from '@/store/authStore'
import type { Task } from '@/types'
import { isTaskHidden, loadDynamicCompanies } from '@/types'
import {
  createCalendarEventWithToken,
  type GCalEvent,
} from '@/lib/googleCalendar'
import { fetchVisibleEvents } from '@/lib/calendarEvents'
import { loadAccounts, getPrimaryToken, type ConnectedAccount } from '@/lib/multiAccount'

const HOUR_PX = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const PRIORITY_ORDER = { do: 0, schedule: 1, delegate: 2, eliminate: 3 }
const PRIORITY_LABEL: Record<string, string> = { do: 'P0', schedule: 'P1', delegate: 'P2', eliminate: 'P3' }
const PRIORITY_COLOR: Record<string, string> = { do: '#EF4444', schedule: '#F59E0B', delegate: '#3B82F6', eliminate: '#6B7280' }

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduledBlock {
  taskId: string
  startHour: number
  durationHours: number
  gcalEventId?: string
}

interface CompanyWithCal {
  id: string
  calendarId?: string
  accountId?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadCompaniesWithCal(): CompanyWithCal[] {
  try {
    const raw = localStorage.getItem('professor-companies')
    return raw ? (JSON.parse(raw) as CompanyWithCal[]) : []
  } catch { return [] }
}

function saveCompanyAccountMapping(companyId: string, accountId: string) {
  try {
    const raw = localStorage.getItem('professor-companies')
    if (!raw) return
    const companies = JSON.parse(raw) as Record<string, unknown>[]
    const updated = companies.map(co =>
      (co as { id: string }).id === companyId ? { ...co, accountId } : co
    )
    localStorage.setItem('professor-companies', JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('professor:companiesUpdated'))
  } catch { /**/ }
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10)
}

function hourLabel(h: number): string {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
}

// ── Draggable Task Card ───────────────────────────────────────────────────────

function DraggableTaskCard({ task, scheduled, creating, gcalDone }: {
  task: Task
  scheduled: boolean
  creating?: boolean
  gcalDone?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const priority = task.quadrant ? PRIORITY_LABEL[task.quadrant] : null
  const color    = task.quadrant ? PRIORITY_COLOR[task.quadrant] : '#6B7280'
  const dot      = task.urgent ? '#F59E0B' : (task.quadrant === 'do' ? '#EF4444' : '#6B7280')

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : scheduled ? 0.65 : 1,
        background: '#FFFFFF',
        border: `1px solid ${gcalDone ? '#D1FAE5' : '#E5E7EB'}`,
        borderRadius: 10, padding: '10px 12px', marginBottom: 8,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        cursor: 'grab', boxShadow: isDragging ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
        userSelect: 'none',
      }}
      {...attributes} {...listeners}
    >
      <span style={{ color: '#9CA3AF', fontSize: 14, marginTop: 1, flexShrink: 0 }}>⠿</span>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 4, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
          {priority && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: `${color}15`, color }}>
              {priority}
            </span>
          )}
          {task.duration && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#F3F4F6', color: '#6B7280' }}>
              {task.duration}m
            </span>
          )}
          {scheduled && !creating && !gcalDone && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#FEF3C7', color: '#D97706' }}>
              Scheduled
            </span>
          )}
          {creating && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#DBEAFE', color: '#2563EB' }}>
              Adding…
            </span>
          )}
          {gcalDone && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#D1FAE5', color: '#10B981' }}>
              ✓ In Calendar
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Droppable Hour Slot ───────────────────────────────────────────────────────

// ── Event detail popup ────────────────────────────────────────────────────────

function EventPopup({ event, color, onClose }: { event: GCalEvent; color: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  const isAllDay   = !event.start.dateTime
  const startISO   = event.start.dateTime ?? (event.start.date + 'T00:00:00')
  const endISO     = event.end?.dateTime   ?? (event.end?.date   + 'T00:00:00')
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const videoLink = event.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri
  const attendees = (event.attendees ?? []).filter(a => !a.self)
  const notes = event.description?.replace(/<[^>]*>/g, '').trim() ?? ''

  return (
    <div ref={ref} style={{
      position: 'fixed', zIndex: 9999, top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'var(--color-surface, #161929)',
      border: '1px solid var(--color-border, #252A3E)',
      borderRadius: 14, width: 340, maxHeight: '80vh', overflowY: 'auto',
      boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
    }}>
      {/* Color bar + title */}
      <div style={{ borderBottom: '1px solid var(--color-border, #252A3E)', padding: '14px 16px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ width: 4, minHeight: 24, borderRadius: 2, background: color, flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.3 }}>{event.summary ?? '(No title)'}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted, #6B7280)', marginTop: 3 }}>
            {isAllDay ? fmtDate(startISO) : `${fmt(startISO)} – ${fmt(endISO)}`}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 2 }}>
          <X size={15} />
        </button>
      </div>
      <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {videoLink && (
          <a href={videoLink} target="_blank" rel="noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#3B82F6', textDecoration: 'none',
          }}>🎥 Join meeting</a>
        )}
        {event.location && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim, #C7CAE0)' }}>📍 {event.location}</div>
        )}
        {attendees.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim, #C7CAE0)' }}>
            👥 {attendees.slice(0, 4).map(a => a.displayName ?? a.email).join(', ')}
            {attendees.length > 4 && <span style={{ color: 'var(--color-text-muted, #6B7280)' }}> +{attendees.length - 4} more</span>}
          </div>
        )}
        {notes && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.5, borderTop: '1px solid var(--color-border, #252A3E)', paddingTop: 8, whiteSpace: 'pre-wrap' }}>
            {notes.slice(0, 300)}{notes.length > 300 ? '…' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function HourSlot({ hour, block, taskTitle, onRemove, busyEventsAtStart, isBusyContinued, isPast, onOpenTask, onEventClick }: {
  hour: number
  block?: ScheduledBlock
  taskTitle?: string
  onRemove?: () => void
  busyEventsAtStart?: { event: GCalEvent; durationHours: number; color: string }[]
  isBusyContinued?: boolean
  isPast?: boolean
  onOpenTask?: (taskId: string) => void
  onEventClick?: (event: GCalEvent, color: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${hour}`, disabled: isPast })
  const blocked = hour < 6 || hour >= 22
  const hasBusyStart = busyEventsAtStart && busyEventsAtStart.length > 0

  return (
    <div ref={setNodeRef} style={{
      display: 'flex', height: HOUR_PX,
      borderBottom: '1px solid #F3F4F6',
      background: isPast
        ? 'rgba(0,0,0,0.03)'
        : isOver
          ? 'rgba(249,115,22,0.05)'
          : (hasBusyStart || isBusyContinued)
            ? 'rgba(59,130,246,0.04)'
            : 'transparent',
      transition: 'background 0.12s', position: 'relative',
      opacity: isPast ? 0.5 : 1,
    }}>
      <div style={{ width: 56, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 6, paddingRight: 10, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 11, color: isPast ? '#C9CBD0' : '#9CA3AF', fontWeight: 500 }}>{hourLabel(hour)}</span>
      </div>
      <div style={{ flex: 1, position: 'relative', borderLeft: '1px solid #F3F4F6' }}>
        {isPast && !block && (
          <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0,0,0,0.03) 6px, rgba(0,0,0,0.03) 12px)' }} />
        )}
        {blocked && !block && !hasBusyStart && !isPast && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 16, opacity: 0.25 }}>🚫</span>
          </div>
        )}
        {/* Continued busy hours: just a thin left border tint, no label */}
        {isBusyContinued && !block && (
          <div style={{
            position: 'absolute', inset: 0,
            borderLeft: '3px solid rgba(59,130,246,0.3)',
            background: 'rgba(59,130,246,0.04)',
          }} />
        )}
        {/* Calendar busy block — only render at the start hour, spans full duration */}
        {hasBusyStart && !block && busyEventsAtStart!.map(({ event: evt, durationHours, color }) => (
          <div key={evt.id ?? evt.summary}
            onClick={() => onEventClick?.(evt, color)}
            style={{
              position: 'absolute', top: 2, left: 4, right: 4,
              height: durationHours * HOUR_PX - 4,
              background: `${color}18`,
              border: `1px solid ${color}44`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 5, zIndex: 1,
              display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '4px 7px',
              cursor: 'pointer', overflow: 'hidden',
            }}>
            <span style={{ fontSize: 11, color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {evt.summary ?? 'Busy'}
            </span>
            {evt.location && (
              <span style={{ fontSize: 10, color, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {evt.location}</span>
            )}
          </div>
        ))}
        {/* Scheduled task block */}
        {block && (
          <div
            onClick={() => onOpenTask?.(block.taskId)}
            style={{
              position: 'absolute',
              top: 2, left: 6, right: 6,
              height: block.durationHours * HOUR_PX - 4,
              background: block.gcalEventId
                ? 'linear-gradient(135deg, #10B981, #34D399)'
                : 'linear-gradient(135deg, #F97316, #FB923C)',
              borderRadius: 6, zIndex: 2,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              padding: '5px 8px',
              boxShadow: `0 2px 6px rgba(${block.gcalEventId ? '16,185,129' : '249,115,22'},0.25)`,
              cursor: onOpenTask ? 'pointer' : 'default',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {taskTitle}
              </div>
              {block.gcalEventId && (
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>✓ Calendar</div>
              )}
            </div>
            {onRemove && (
              <button
                onClick={e => { e.stopPropagation(); onRemove() }}
                style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 3, cursor: 'pointer', color: '#fff', padding: '1px 4px', fontSize: 10, flexShrink: 0 }}
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Account Picker Overlay ────────────────────────────────────────────────────

function AccountPickerOverlay({
  task,
  onConfirm,
  onSkip,
}: {
  task: Task
  onConfirm: (account: ConnectedAccount | null, saveMapping: boolean) => void
  onSkip: () => void
}) {
  const authUser = useAuthStore(s => s.user)
  const [selected, setSelected] = useState<string | null>(null)
  const [saveMapping, setSaveMapping] = useState(true)

  const primaryToken = getPrimaryToken()
  const extraAccounts = loadAccounts().filter(a => !a.isPrimary)

  const companies = loadDynamicCompanies()
  const co = task.companyId ? companies.find(c => c.id === task.companyId) : null

  const primaryOption = primaryToken ? {
    id: 'primary',
    email: authUser?.email ?? 'Primary account',
    name: authUser?.name ?? 'Primary account',
    providerToken: primaryToken,
    isPrimary: true,
    avatarUrl: authUser?.avatarUrl,
    scopes: [], connectedAt: '', supabaseRefreshToken: undefined,
  } as ConnectedAccount : null

  const allOptions: ConnectedAccount[] = [
    ...(primaryOption ? [primaryOption] : []),
    ...extraAccounts,
  ]

  const selectedAcct = allOptions.find(a => a.id === selected) ?? null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#F9FAFB', borderRadius: 16, padding: 24, width: 360, maxWidth: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
          Add to Calendar
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16, lineHeight: 1.5 }}>
          "{task.title}" — choose which account's calendar to create this event in.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {allOptions.map(acct => (
            <button key={acct.id} onClick={() => setSelected(acct.id)} style={{
              padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: selected === acct.id ? 'rgba(249,115,22,0.06)' : '#FFFFFF',
              border: `1.5px solid ${selected === acct.id ? '#F97316' : '#E5E7EB'}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: '#374151', overflow: 'hidden',
              }}>
                {acct.avatarUrl
                  ? <img src={acct.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (acct.name[0] ?? '?').toUpperCase()
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.name}</div>
                <div style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.email}</div>
              </div>
              {acct.isPrimary && (
                <span style={{ fontSize: 10, fontWeight: 600, background: '#D1FAE5', color: '#10B981', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>Primary</span>
              )}
            </button>
          ))}
          {allOptions.length === 0 && (
            <div style={{ fontSize: 12, color: '#6B7280', textAlign: 'center', padding: 12 }}>No Google accounts connected.</div>
          )}
        </div>

        {co && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <input type="checkbox" checked={saveMapping} onChange={e => setSaveMapping(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer' }} />
            Save as default calendar for <strong style={{ marginLeft: 2 }}>{co.name}</strong>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onSkip} style={{
            flex: 1, padding: '9px', borderRadius: 8, background: 'transparent',
            border: '1.5px solid #E5E7EB', color: '#374151', fontSize: 13, cursor: 'pointer',
          }}>
            Skip
          </button>
          <button onClick={() => selectedAcct && onConfirm(selectedAcct, saveMapping)}
            disabled={!selectedAcct} style={{
              flex: 2, padding: '9px', borderRadius: 8,
              background: selectedAcct ? '#F97316' : '#E5E7EB', border: 'none',
              color: selectedAcct ? '#fff' : '#9CA3AF', fontSize: 13, fontWeight: 700,
              cursor: selectedAcct ? 'pointer' : 'default',
            }}>
            Add to Calendar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface SmartDayPlannerProps {
  onClose: () => void
  onOpenTask?: (taskId: string) => void
}

export function SmartDayPlanner({ onClose, onOpenTask }: SmartDayPlannerProps) {
  const { tasks: allTasks, updateTask } = useTaskStore()
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [includeBreaks, setIncludeBreaks] = useState(true)
  const [sortBy, setSortBy] = useState<'priority' | 'created'>('priority')
  const [generating, setGenerating] = useState(false)
  const [todayEvents, setTodayEvents] = useState<GCalEvent[]>([])
  const [creatingSet, setCreatingSet] = useState<Set<string>>(new Set())
  const [accountPicker, setAccountPicker] = useState<{ task: Task; block: ScheduledBlock } | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const today = new Date()
  const todayStr = todayDateStr()

  // Load today's events from all visible calendars on mount
  useEffect(() => {
    const dayStart = new Date(todayStr + 'T00:00:00')
    const dayEnd   = new Date(todayStr + 'T23:59:59')
    void fetchVisibleEvents(dayStart, dayEnd).then(setTodayEvents)
  }, [todayStr])
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const tasks = allTasks.filter(t => !isTaskHidden(t) && !t.completed && t.status !== 'done')

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (sortBy === 'priority') {
        const ap = a.quadrant ? (PRIORITY_ORDER[a.quadrant as keyof typeof PRIORITY_ORDER] ?? 4) : 4
        const bp = b.quadrant ? (PRIORITY_ORDER[b.quadrant as keyof typeof PRIORITY_ORDER] ?? 4) : 4
        if (ap !== bp) return ap - bp
        if (a.urgent && !b.urgent) return -1
        if (!a.urgent && b.urgent) return 1
      }
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [tasks, sortBy])

  const scheduledTaskIds = new Set(blocks.map(b => b.taskId))
  const unscheduledCount = tasks.filter(t => !scheduledTaskIds.has(t.id)).length

  const [selectedCalEvent, setSelectedCalEvent] = useState<{ event: GCalEvent; color: string } | null>(null)

  // Build busy event map: startAt = events keyed by start hour (with duration + color), continued = set of continuation hours
  const busyEventMap = useMemo(() => {
    const startAt: Record<number, { event: GCalEvent; durationHours: number; color: string }[]> = {}
    const continued = new Set<number>()
    for (const evt of todayEvents) {
      if (!evt.start?.dateTime) continue
      const startDate = new Date(evt.start.dateTime)
      const startH = startDate.getHours()
      const endDate = evt.end?.dateTime ? new Date(evt.end.dateTime) : new Date(startDate.getTime() + 3600000)
      const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 3600000))
      const color = (evt as GCalEvent & { calendarColor?: string }).calendarColor ?? '#3B82F6'
      if (!startAt[startH]) startAt[startH] = []
      startAt[startH].push({ event: evt, durationHours, color })
      for (let h = startH + 1; h < startH + durationHours; h++) continued.add(h)
    }
    return { startAt, continued }
  }, [todayEvents])

  // ── Generate Plan ─────────────────────────────────────────────────────────

  const generatePlan = useCallback(async () => {
    setGenerating(true)
    try {
      // 1. Fetch today's calendar events from ALL visible calendars
      const dayStart = new Date(todayStr + 'T00:00:00')
      const dayEnd   = new Date(todayStr + 'T23:59:59')
      const events = await fetchVisibleEvents(dayStart, dayEnd)
      setTodayEvents(events)

      // 2. Build busy intervals (fractional hours)
      const busyIntervals = events
        .filter(e => e.start?.dateTime && e.end?.dateTime)
        .map(e => ({
          start: parseInt(e.start!.dateTime!.slice(11, 13), 10) +
                 parseInt(e.start!.dateTime!.slice(14, 16), 10) / 60,
          end:   parseInt(e.end!.dateTime!.slice(11, 13), 10) +
                 parseInt(e.end!.dateTime!.slice(14, 16), 10) / 60,
        }))

      // 3. Add lunch break if enabled
      if (includeBreaks) busyIntervals.push({ start: 12, end: 13 })

      // 4. Fit tasks greedily into work hours 8–18, skipping past hours
      const workEnd = 18
      const workStart = Math.max(8, new Date().getHours() + 1)
      const newBlocks: ScheduledBlock[] = []
      let cursor = workStart

      for (const task of sortedTasks) {
        if (cursor >= workEnd) break
        const durH = task.duration ? Math.ceil(task.duration / 60) : 1
        let placed = false

        while (cursor + durH <= workEnd && !placed) {
          const slotEnd = cursor + durH
          const blocked = busyIntervals.some(b => cursor < b.end && slotEnd > b.start)
          if (!blocked) {
            newBlocks.push({ taskId: task.id, startHour: cursor, durationHours: durH })
            cursor = slotEnd
            placed = true
          } else {
            cursor++
          }
        }
      }

      setBlocks(newBlocks)

      // Scroll to first scheduled slot or 8 AM
      const firstHour = newBlocks[0]?.startHour ?? 8
      setTimeout(() => {
        timelineRef.current?.scrollTo({ top: firstHour * HOUR_PX, behavior: 'smooth' })
      }, 100)
    } finally {
      setGenerating(false)
    }
  }, [sortedTasks, includeBreaks, todayStr])

  // ── GCal event creation ───────────────────────────────────────────────────

  async function createGCalEvent(token: string, calendarId: string, task: Task, block: ScheduledBlock): Promise<string | null> {
    const endHour = block.startHour + block.durationHours
    const startISO = `${todayStr}T${String(block.startHour).padStart(2, '0')}:00:00`
    const endISO   = `${todayStr}T${String(Math.min(endHour, 23)).padStart(2, '0')}:00:00`
    try {
      const result = await createCalendarEventWithToken(token, calendarId, {
        summary:     task.title,
        description: task.description ?? '',
        start: { dateTime: startISO, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end:   { dateTime: endISO,   timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      })
      return result.event?.id ?? null
    } catch { return null }
  }

  async function tryScheduleToCalendar(task: Task, block: ScheduledBlock) {
    const companiesWithCal = loadCompaniesWithCal()
    const co = task.companyId ? companiesWithCal.find(c => c.id === task.companyId) : null

    // Find account
    let token: string | null = null
    let calendarId = 'primary'

    if (co?.accountId) {
      const accts = loadAccounts()
      const acct = accts.find(a => a.id === co.accountId)
      if (acct) token = acct.providerToken
      if (co.calendarId) calendarId = co.calendarId
    }

    if (!token) token = getPrimaryToken() || null

    if (!token) {
      // No token at all — show account picker
      setAccountPicker({ task, block })
      return
    }

    // If no account is mapped to this company, show picker to let them choose & optionally save
    if (task.companyId && !co?.accountId) {
      setAccountPicker({ task, block })
      return
    }

    // Create the event silently
    setCreatingSet(prev => new Set([...prev, task.id]))
    const gcalEventId = await createGCalEvent(token, calendarId, task, block)
    setCreatingSet(prev => { const s = new Set(prev); s.delete(task.id); return s })
    if (gcalEventId) {
      setBlocks(prev => prev.map(b => b.taskId === task.id ? { ...b, gcalEventId } : b))
    }
  }

  // ── DnD handlers ──────────────────────────────────────────────────────────

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart({ active }: DragStartEvent) { setActiveId(active.id as string) }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over) return
    const overId = over.id as string
    if (!overId.startsWith('slot-')) return
    const hour   = parseInt(overId.replace('slot-', ''), 10)
    const taskId = active.id as string
    const task   = tasks.find(t => t.id === taskId)
    if (!task) return
    const durH = task.duration ? Math.ceil(task.duration / 60) : 1
    const block: ScheduledBlock = { taskId, startHour: hour, durationHours: durH }

    setBlocks(prev => [...prev.filter(b => b.taskId !== taskId), block])
    await tryScheduleToCalendar(task, block)
  }

  function removeBlock(taskId: string) {
    setBlocks(prev => prev.filter(b => b.taskId !== taskId))
  }

  // ── Apply Plan ────────────────────────────────────────────────────────────

  function applyPlan() {
    blocks.forEach(b => {
      const patch: Partial<Parameters<typeof updateTask>[1]> = {
        dueDate:     todayStr,
        plannedTime: `${String(b.startHour).padStart(2, '0')}:00`,
      }
      if (b.gcalEventId) patch.gcalEventId = b.gcalEventId
      updateTask(b.taskId, patch)
    })
    onClose()
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const totalMinutes = blocks.reduce((sum, b) => {
    const task = tasks.find(t => t.id === b.taskId)
    return sum + (task?.duration ?? b.durationHours * 60)
  }, 0)

  const activeTask = activeId ? tasks.find(t => t.id === activeId) ?? null : null

  return (
    <>
      <style>{`
        @keyframes sdp-in { from{opacity:0;transform:scale(0.97) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
      `}</style>

      {/* Account picker overlay */}
      {accountPicker && (
        <AccountPickerOverlay
          task={accountPicker.task}
          onConfirm={async (acct, saveMapping) => {
            const { task, block } = accountPicker
            setAccountPicker(null)
            if (!acct) return
            if (saveMapping && task.companyId) {
              saveCompanyAccountMapping(task.companyId, acct.id)
            }
            setCreatingSet(prev => new Set([...prev, task.id]))
            const gcalEventId = await createGCalEvent(acct.providerToken, 'primary', task, block)
            setCreatingSet(prev => { const s = new Set(prev); s.delete(task.id); return s })
            if (gcalEventId) {
              setBlocks(prev => prev.map(b => b.taskId === task.id ? { ...b, gcalEventId } : b))
            }
          }}
          onSkip={() => setAccountPicker(null)}
        />
      )}

      {/* Event detail popup */}
      {selectedCalEvent && (
        <EventPopup
          event={selectedCalEvent.event}
          color={selectedCalEvent.color}
          onClose={() => setSelectedCalEvent(null)}
        />
      )}

      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {/* Modal */}
        <div style={{
          background: '#F9FAFB', borderRadius: 20, width: '100%', maxWidth: 1000, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 32px 80px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)',
          animation: 'sdp-in 0.3s cubic-bezier(0.16,1,0.3,1)', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '18px 24px', background: '#FFFFFF', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 22 }}>✦</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: '#111827', flex: 1 }}>Smart Day Planner</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4, display: 'flex', borderRadius: 6 }}>
              <X size={18} />
            </button>
          </div>

          {/* Sub-header */}
          <div style={{ padding: '10px 24px', background: '#FFFFFF', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>📅 {dateLabel}</span>
            <span style={{ fontSize: 13, color: '#6B7280' }}>🕐 {timeLabel}</span>
            <span style={{ fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#374151', borderRadius: 20, padding: '3px 10px' }}>
              {unscheduledCount} unscheduled
            </span>
            {todayEvents.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, background: '#DBEAFE', color: '#2563EB', borderRadius: 20, padding: '3px 10px' }}>
                {todayEvents.length} calendar event{todayEvents.length !== 1 ? 's' : ''} today
              </span>
            )}
            <div style={{ flex: 1 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div onClick={() => setIncludeBreaks(b => !b)} style={{ width: 40, height: 22, borderRadius: 11, background: includeBreaks ? '#F97316' : '#D1D5DB', position: 'relative', cursor: 'pointer', transition: 'background 0.15s' }}>
                <div style={{ position: 'absolute', top: 3, left: includeBreaks ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Include breaks</span>
            </label>
          </div>

          {/* Body */}
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Left: Timeline */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid #E5E7EB' }}>
                <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FFFFFF', borderBottom: '1px solid #F3F4F6', flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Today's Schedule</span>
                  <button onClick={() => void generatePlan()} disabled={generating} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 20,
                    background: generating ? '#F3F4F6' : '#FFFFFF', border: '1.5px solid #E5E7EB',
                    color: '#374151', fontSize: 13, fontWeight: 600, cursor: generating ? 'wait' : 'pointer',
                  }}>
                    <RefreshCw size={13} style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }} />
                    {blocks.length > 0 ? 'Regenerate Plan' : 'Generate Plan'}
                  </button>
                </div>
                <div ref={timelineRef} style={{ flex: 1, overflowY: 'auto', background: '#FAFAFA' }}>
                  {HOURS.map(hour => {
                    const block   = blocks.find(b => b.startHour === hour)
                    const task    = block ? tasks.find(t => t.id === block.taskId) : undefined
                    const isPast  = hour < new Date().getHours()
                    return (
                      <HourSlot
                        key={hour} hour={hour}
                        block={block}
                        taskTitle={task?.title}
                        onRemove={block ? () => removeBlock(block.taskId) : undefined}
                        busyEventsAtStart={busyEventMap.startAt[hour]}
                        isBusyContinued={busyEventMap.continued.has(hour)}
                        isPast={isPast}
                        onOpenTask={onOpenTask}
                        onEventClick={(ev, col) => setSelectedCalEvent({ event: ev, color: col })}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Right: Task list */}
              <div style={{ width: 320, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#FFFFFF' }}>
                <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid #F3F4F6', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Tasks</span>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => setSortBy(s => s === 'priority' ? 'created' : 'priority')} style={{
                      display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                      cursor: 'pointer', fontSize: 12, color: '#6B7280', fontWeight: 500,
                    }}>
                      {sortBy === 'priority' ? '🔥 Priority' : '🕐 Newest'} ∨
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF' }}>Drag to schedule · Creates GCal event automatically</p>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                  {sortedTasks.map(task => (
                    <DraggableTaskCard
                      key={task.id} task={task}
                      scheduled={scheduledTaskIds.has(task.id)}
                      creating={creatingSet.has(task.id)}
                      gcalDone={!!blocks.find(b => b.taskId === task.id)?.gcalEventId}
                    />
                  ))}
                  {sortedTasks.length === 0 && (
                    <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
                      No open tasks
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeTask && (
                <div style={{ width: 260, transform: 'rotate(1deg)', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.15))' }}>
                  <DraggableTaskCard task={activeTask} scheduled={false} />
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Footer */}
          <div style={{ padding: '14px 24px', background: '#FFFFFF', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <CalendarPlus size={14} color="#6B7280" />
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              {blocks.length} task{blocks.length !== 1 ? 's' : ''} · {totalMinutes}m planned
              {blocks.filter(b => b.gcalEventId).length > 0 && (
                <span style={{ color: '#10B981', marginLeft: 8 }}>
                  · {blocks.filter(b => b.gcalEventId).length} added to calendar
                </span>
              )}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 20, background: '#FFFFFF', border: '1.5px solid #E5E7EB', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={applyPlan} disabled={!blocks.length} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 20,
              background: blocks.length ? '#F97316' : '#E5E7EB', border: 'none',
              color: blocks.length ? '#fff' : '#9CA3AF', fontSize: 13, fontWeight: 700,
              cursor: blocks.length ? 'pointer' : 'default', transition: 'all 0.15s',
            }}>
              <Check size={14} /> Apply Plan
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </>
  )
}
