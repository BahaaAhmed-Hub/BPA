import { ArrowUpRight } from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { projectOfTask, useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import { eventMeta, type EventLike } from './eventLinks'

/** "Project" in an event's own panel — the calendar's side of the same link the
 *  project page lists. A block that a task made already belongs to that task's
 *  project, and says so rather than offering a second, competing answer. */
export function EventProjectRow({ ev }: { ev: EventLike }) {
  const projects = useProjectStore(s => s.projects)
  const links = useProjectStore(s => s.links)
  const addLink = useProjectStore(s => s.addLink)
  const removeLinksByRef = useProjectStore(s => s.removeLinksByRef)
  const tasks = useTaskStore(s => s.tasks)
  const focusOn = useUIStore(s => s.focusOn)

  const blockOf = tasks.find(t => t.gcalEventId === ev.id)
  const viaTask = blockOf ? projectOfTask(blockOf, projects) : undefined
  const linked = links.find(l => l.kind === 'event' && l.refId === ev.id)
  const current = projects.find(p => p.id === linked?.projectId)
  // Offered: projects still being worked on, and the one it is already in.
  const choices = projects.filter(p => (!p.archived && p.status !== 'done') || p.id === current?.id)
  if (projects.length === 0) return null

  const LABEL: React.CSSProperties = { margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)' }

  if (viaTask) {
    return (
      <span data-event-project style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={LABEL}>Project</span>
        <span style={{ flex: 1 }} />
        <button type="button" data-event-project-via-task onClick={() => focusOn({ module: 'projects', id: viaTask.id })}
          title={`This is the block for “${blockOf!.title}”, which is in ${viaTask.name}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 'var(--sb-h-pill)', padding: '0 11px', minWidth: 0, maxWidth: 220,
            borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', background: 'var(--sb-field)',
            border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-2)', fontFamily: 'inherit',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
          }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: viaTask.color ?? 'var(--sb-ink-4)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viaTask.name} · via its task</span>
          <ArrowUpRight size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0 }} />
        </button>
      </span>
    )
  }

  return (
    <span data-event-project style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={LABEL}>Project</span>
      <span style={{ flex: 1 }} />
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 'var(--sb-h-pill)', padding: '0 11px', minWidth: 0, maxWidth: 220,
        borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: current?.color ?? 'transparent', border: current ? 'none' : 'var(--sb-border-width) solid var(--sb-border)' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: current ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
          {current ? current.name : 'No project'}
        </span>
        <select aria-label="Project for this event" value={current?.id ?? ''}
          onChange={e => {
            // One project at a time: choosing another replaces, it does not add.
            removeLinksByRef('event', ev.id)
            if (e.target.value) addLink(e.target.value, 'event', ev.id, eventMeta(ev))
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}>
          <option value="">No project</option>
          {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </span>
    </span>
  )
}
