// ─── Shared visual language for the Tasks module (9B–9F artboards) ───────────
// The cards, the matrix rows and the detail panel all draw from the same four
// attribute slots — type, schedule, priority, owner — so they live here.

import {
  CalendarDays, Phone, Flag, Mail, Search, BookOpen, Code2, CheckSquare,
  BarChart3, type LucideIcon,
} from 'lucide-react'
import type { Task, TaskType, Priority } from '@/types'
import {
  PRIORITY_META, TASK_TYPE_META, inferTaskType, getAllUsers, loadDynamicCompanies,
} from '@/types'

/** 9B uses line icons, not emoji, for task type. */
export const TASK_TYPE_ICON: Record<TaskType, LucideIcon> = {
  meeting:  CalendarDays,
  call:     Phone,
  followup: Flag,
  email:    Mail,
  research: Search,
  study:    BookOpen,
  deepwork: Code2,
  do:       CheckSquare,
}

export const PRIORITY_ICON = BarChart3

/** Filter-popover order, matching the artboard's chip grid. */
export const TASK_TYPE_ORDER: TaskType[] = [
  'meeting', 'call', 'followup', 'email', 'research', 'study', 'deepwork', 'do',
]

// ─── Slot tokens ─────────────────────────────────────────────────────────────

export const SLOT = 26

/** A set attribute: cream chip. */
export const slotFilled: React.CSSProperties = {
  width: SLOT, height: SLOT, borderRadius: 8, flexShrink: 0,
  background: '#FAF7EC', border: '1px solid #E8E1CE', color: '#6C6553',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', padding: 0,
}

/** An unset attribute: dashed ghost, so every card keeps the same four slots. */
export const slotEmpty: React.CSSProperties = {
  ...slotFilled,
  background: 'transparent',
  border: '1px dashed #E0D6BC',
  color: '#C9C0A8',
}

/** Scheduled reads olive — it is the one slot that means "this has a block". */
export const slotScheduled: React.CSSProperties = {
  ...slotFilled,
  background: 'rgba(95,112,56,0.10)',
  border: '1px solid #C8DAB0',
  color: '#5F7038',
}

export function slotPriority(p: Priority): React.CSSProperties {
  const meta = PRIORITY_META[p]
  return { ...slotFilled, background: meta.tint, border: `1px solid ${meta.border}`, color: meta.color }
}

// ─── Helpers shared across the module ────────────────────────────────────────

/** Up to two initials from a full name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Whole days since an ISO timestamp. */
export function daysOpen(createdAt: string): number {
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

/** "4d open" / "Today" — the first half of the card's meta line. */
export function openLabel(task: Task): string {
  const d = daysOpen(task.createdAt)
  return d === 0 ? 'Today' : `${d}d open`
}

/** A task the user has been carrying for more than a day without closing. */
export function isCarriedOver(task: Task): boolean {
  return !task.completed && !!task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10)
}

export interface TaskVisuals {
  companyName: string
  companyColor: string
  type: TaskType
  TypeIcon: LucideIcon
  typeLabel: string
  ownerName?: string
  ownerInitials?: string
  scheduled: boolean
  scheduleLabel?: string
}


// ─── Schedule label ──────────────────────────────────────────────────────────
// One formatter, so the card, the row and the detail panel never disagree
// about when a task is happening.

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "18 Sep · 09:00" on a card, "Today, 18 Sep · 09:00 · 30m" in the panel.
 *  A task with a time but no date is happening today, and says so. */
export function formatScheduleLabel(
  task: { dueDate?: string; plannedTime?: string; duration?: number },
  opts: { long?: boolean } = {},
): string | undefined {
  const { dueDate, plannedTime, duration } = task
  if (!dueDate && !plannedTime) return undefined

  let datePart: string | undefined
  if (dueDate) {
    const d = new Date(dueDate + 'T00:00:00')
    if (!Number.isNaN(d.getTime())) {
      const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      datePart = dueDate === isoToday()
        ? (opts.long ? `Today, ${day}` : 'Today')
        : (opts.long ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })}, ${day}` : day)
    }
  } else {
    datePart = 'Today'
  }

  const parts = [datePart, plannedTime]
  if (opts.long && plannedTime) parts.push(`${duration ?? 30}m`)
  return parts.filter(Boolean).join(' · ')
}

/** Everything a card needs to draw itself, resolved once. */
export function resolveTaskVisuals(task: Task): TaskVisuals {
  const company = loadDynamicCompanies().find(c => c.id === task.companyId)
  const owner   = task.owner ? getAllUsers().find(u => u.id === task.owner) : undefined
  const type    = task.taskType ?? inferTaskType(task.title)
  const scheduled = !!task.plannedTime || !!task.dueDate || !!task.gcalEventId

  return {
    companyName:  company?.name ?? task.company ?? '',
    companyColor: company?.color ?? '#6C6553',
    type,
    TypeIcon:     TASK_TYPE_ICON[type],
    typeLabel:    TASK_TYPE_META[type].label,
    ownerName:    owner?.name,
    ownerInitials: owner ? initials(owner.name) : undefined,
    scheduled,
    scheduleLabel: formatScheduleLabel(task),
  }
}

// ─── Grouping (filter popover: None / Status / Task type / Company / Owner) ───

export type TaskGroupBy = 'none' | 'status' | 'type' | 'company' | 'owner'

export interface TaskGroup { key: string; label: string; emoji: string; color: string; tasks: Task[] }

/** On fire floats to the top of whatever list it is in; done sinks. */
export function sortUrgentFirst(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1
    if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1
    return 0
  })
}

const STATUS_GROUPS: { key: string; label: string; color: string }[] = [
  { key: 'open',      label: 'Open',      color: '#6C6553' },
  { key: 'done',      label: 'Done',      color: '#5F7038' },
  { key: 'cancelled', label: 'Cancelled', color: '#9B9180' },
]

/** One grouping implementation shared by the board, the matrix and the rail. */
export function buildTaskGroups(tasks: Task[], groupBy: Exclude<TaskGroupBy, 'none'>): TaskGroup[] {
  if (groupBy === 'type') {
    const map = new Map<TaskType, Task[]>()
    for (const t of tasks) {
      const k = t.taskType ?? inferTaskType(t.title)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    }
    return TASK_TYPE_ORDER.filter(k => map.has(k)).map(k => ({
      key: k, label: TASK_TYPE_META[k].label, emoji: TASK_TYPE_META[k].emoji,
      color: TASK_TYPE_META[k].color, tasks: sortUrgentFirst(map.get(k)!),
    }))
  }

  if (groupBy === 'status') {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const k = t.completed ? 'done' : (t.status ?? 'open')
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    }
    return STATUS_GROUPS.filter(g => map.has(g.key))
      .map(g => ({ key: g.key, label: g.label, emoji: '●', color: g.color, tasks: sortUrgentFirst(map.get(g.key)!) }))
  }

  if (groupBy === 'owner') {
    const users = getAllUsers()
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const k = t.owner ?? '__unassigned'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    }
    return [...map.entries()].map(([k, ts]) => {
      const u = users.find(x => x.id === k)
      return {
        key: k,
        label: u?.name ?? 'Unassigned',
        emoji: '👤',
        color: u?.companyColor ?? '#9B9180',
        tasks: sortUrgentFirst(ts),
      }
    })
  }

  const companies = loadDynamicCompanies()
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    const k = t.companyId ?? t.company
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(t)
  }
  return [...map.entries()].map(([k, ts]) => {
    const co = companies.find(c => c.id === k)
    return { key: k, label: co?.name ?? k, emoji: '🏢', color: co?.color ?? '#9B9180', tasks: sortUrgentFirst(ts) }
  })
}
