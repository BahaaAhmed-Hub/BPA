import { useMemo } from 'react'
import { CalendarDays, ArrowUpRight, X } from 'lucide-react'
import type { Task } from '@/types'
import { ICON, STROKE } from '@/lib/type'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import type { EventMeta, Project } from './types'

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}

/** One thing on the calendar that belongs to the project. */
interface Item {
  key: string
  title: string
  /** YYYY-MM-DD, local */
  day: string
  /** Sort key: ms since epoch, local. */
  at: number
  when: string
  via: 'task' | 'link'
  refId: string
  /** The link to remove, for an explicit one. A task's block is removed by taking the task out. */
  linkId?: string
  taskTitle?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayLabel = (day: string) =>
  new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** The project's events: the ones linked from the calendar, and the time blocks
 *  its tasks made. A block that is also linked shows once, as the task's. */
export function projectCalendarItems(project: Project, links: ReturnType<typeof useProjectStore.getState>['links'], tasks: Task[]): Item[] {
  const items: Item[] = []
  const blocked = new Set<string>()
  for (const t of tasks) {
    if (!t.gcalEventId || !t.dueDate || t.status === 'cancelled') continue
    blocked.add(t.gcalEventId)
    const start = new Date(`${t.dueDate}T${t.plannedTime ?? '09:00'}:00`)
    const end = t.duration ? new Date(start.getTime() + t.duration * 60000) : undefined
    items.push({
      key: `task:${t.id}`, title: t.title, day: t.dueDate, at: start.getTime(), via: 'task', refId: t.gcalEventId, taskTitle: t.title,
      when: t.plannedTime ? `${hm(start)}${end ? `–${hm(end)}` : ''}` : 'All day',
    })
  }
  for (const l of links) {
    if (l.projectId !== project.id || l.kind !== 'event' || blocked.has(l.refId)) continue
    const m = l.meta as EventMeta | undefined
    if (!m) { items.push({ key: `link:${l.id}`, title: 'A calendar event', day: '', at: Number.MAX_SAFE_INTEGER, when: '', via: 'link', refId: l.refId, linkId: l.id }); continue }
    const start = new Date(m.allDay ? `${m.start}T12:00:00` : m.start)
    const end = m.end && !m.allDay ? new Date(m.end) : undefined
    items.push({
      key: `link:${l.id}`, title: m.title, day: localDay(start), at: m.allDay ? new Date(`${m.start}T00:00:00`).getTime() : start.getTime(),
      when: m.allDay ? 'All day' : `${hm(start)}${end ? `–${hm(end)}` : ''}`, via: 'link', refId: l.refId, linkId: l.id,
    })
  }
  return items
}

export function ProjectCalendar({ project, tasks, today }: { project: Project; tasks: Task[]; today: string }) {
  const links = useProjectStore(s => s.links)
  const removeLink = useProjectStore(s => s.removeLink)
  const focusOn = useUIStore(s => s.focusOn)
  const items = useMemo(() => projectCalendarItems(project, links, tasks), [project, links, tasks])
  const startOfToday = new Date(`${today}T00:00:00`).getTime()
  const upcoming = items.filter(i => i.at >= startOfToday).sort((a, b) => a.at - b.at)
  const earlier = items.filter(i => i.at < startOfToday).sort((a, b) => b.at - a.at)

  const Line = (i: Item) => (
    <div key={i.key} data-project-event={i.refId} data-via={i.via}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
      <span style={{ flex: '0 0 88px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>{i.day ? dayLabel(i.day) : ''}</span>
      <span style={{ flex: '0 0 96px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>{i.when}</span>
      <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
      <span data-event-source style={{ flex: '0 0 auto', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', borderRadius: 999, padding: '3px 8px' }}>
        {i.via === 'task' ? 'Task block' : 'Linked'}
      </span>
      <button type="button" aria-label={`Open ${i.title} in the calendar`} title="Open it in the calendar"
        onClick={() => focusOn({ module: 'calendar', id: i.refId, date: i.day || undefined })}
        style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex' }}>
        <ArrowUpRight size={ICON.sm} strokeWidth={STROKE.rest} />
      </button>
      {i.linkId
        ? <button type="button" aria-label={`Unlink ${i.title} from this project`} title="Unlink it — the event stays on your calendar"
            onClick={() => removeLink(i.linkId!)}
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
            <X size={ICON.sm} />
          </button>
        : <span style={{ width: 24, flexShrink: 0 }} />}
    </div>
  )
  const Group = (label: string, list: Item[]) => list.length === 0 ? null : (
    <div data-project-events-group={label} style={{ ...CARD, overflow: 'hidden' }}>
      <div style={{ ...CAP, padding: '12px 12px 6px' }}>{label} · {list.length}</div>
      {list.map(Line)}
    </div>
  )

  return (
    <div data-project-calendar style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.length === 0 ? (
        <div data-project-calendar-empty style={{ ...CARD, padding: '22px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <CalendarDays size={ICON.lg} style={{ color: 'var(--sb-ink-3)', flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', lineHeight: 1.5, color: 'var(--sb-ink-3)' }}>
            Nothing on the calendar yet. Open an event and choose this project in its panel, or give one of the project's tasks a date and time — its block appears here.
          </p>
        </div>
      ) : (
        <>
          {Group('Upcoming', upcoming)}
          {Group('Earlier', earlier)}
        </>
      )}
    </div>
  )
}
