// ─── List view ───────────────────────────────────────────────────────────────
// The switcher in 9B–9F offers Board | Matrix | List but no artboard draws the
// list, so it reuses the 9E row verbatim and the popover's grouping.

import type { Task } from '@/types'
import { TaskRow } from './TaskRow'
import { buildTaskGroups, sortUrgentFirst, type TaskGroupBy } from './taskVisuals'

export function TaskListView({ tasks, onOpen, hideCompleted, groupBy, filteredTaskIds }: {
  tasks: Task[]
  onOpen: (id: string) => void
  hideCompleted?: boolean
  groupBy?: TaskGroupBy
  filteredTaskIds?: Set<string> | null
}) {
  const visible = tasks
    .filter(t => (hideCompleted ? !t.completed : true))
    .filter(t => (filteredTaskIds ? filteredTaskIds.has(t.id) : true))

  const groups = groupBy && groupBy !== 'none'
    ? buildTaskGroups(visible, groupBy)
    : [{ key: 'all', label: '', emoji: '', color: '#9B9180', tasks: sortUrgentFirst(visible) }]

  return (
    <div style={{ padding: '4px 28px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {visible.length === 0 && (
        <p style={{ margin: 0, padding: '40px 0', textAlign: 'center', color: '#9B9180', fontSize: 13 }}>
          Nothing here.
        </p>
      )}
      {groups.map(g => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {g.label && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: g.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#191712' }}>{g.label}</span>
              <span style={{ fontSize: 12, color: '#9B9180' }}>{g.tasks.length}</span>
            </div>
          )}
          {g.tasks.map(t => <TaskRow key={t.id} task={t} onOpen={onOpen} />)}
        </div>
      ))}
    </div>
  )
}
