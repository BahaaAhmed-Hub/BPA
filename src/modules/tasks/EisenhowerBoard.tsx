// ─── 9E Eisenhower matrix ────────────────────────────────────────────────────
// Urgent × important, four quadrants, with the axis spelled out: URGENT /
// NOT URGENT across the top and IMPORTANT / NOT IMPORTANT down the side.

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { useTaskStore } from '@/store/taskStore'
import type { Quadrant, Task } from '@/types'
import { isTaskHidden, loadVisibleCompanies } from '@/types'
import { TaskRow } from './TaskRow'
import { buildTaskGroups, type TaskGroupBy } from './taskVisuals'

interface QuadrantSpec {
  id: Quadrant
  badge: string
  title: string
  sub: string
  action: string
  /** The one quadrant the artboard tints — it is the one that decides the week. */
  accent?: boolean
}

const QUADRANT_SPECS: QuadrantSpec[] = [
  { id: 'do',        badge: 'DO',       title: 'Urgent & important',     sub: 'Do it today — these decide the week', action: 'Schedule now', accent: true },
  { id: 'schedule',  badge: 'PLAN',     title: 'Not urgent & important', sub: 'Give it a block before it turns urgent', action: 'Block time' },
  { id: 'delegate',  badge: 'DELEGATE', title: 'Urgent & not important', sub: 'Someone else can close it', action: 'Reassign' },
  { id: 'eliminate', badge: 'DROP',     title: 'Not urgent & not important', sub: 'Archive unless something changes', action: 'Archive all' },
]

/** The badge is a fixed square, so longer words step down a size to fit. */
function badgeFontSize(word: string): number {
  if (word.length <= 2) return 9
  if (word.length <= 4) return 7.5
  return 5.5
}

function AxisLabel({ children }: { children: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
      color: '#B5AC98', textTransform: 'uppercase', userSelect: 'none',
    }}>{children}</div>
  )
}

function ColumnLabel({ children }: { children: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid #E8E1CE', borderRadius: 10, padding: '7px 0',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
      color: '#9B9180', textTransform: 'uppercase', userSelect: 'none',
    }}>{children}</div>
  )
}

function QuadrantPanel({ spec, tasks, onOpen, onAction, groupBy }: {
  spec: QuadrantSpec
  tasks: Task[]
  onOpen: (id: string) => void
  onAction: (spec: QuadrantSpec, tasks: Task[]) => void
  groupBy: TaskGroupBy
}) {
  const addTask = useTaskStore(s => s.addTask)
  // Brain-dump cards are dragged straight into a quadrant, so each panel is a
  // drop target keyed by its quadrant id.
  const { setNodeRef, isOver } = useDroppable({ id: spec.id })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function commit() {
    const title = draft.trim()
    setAdding(false)
    setDraft('')
    if (!title) return
    const co = loadVisibleCompanies()[0]
    addTask({
      title,
      quadrant: spec.id,
      company: (co?.id ?? 'personal') as Task['company'],
      ...(co ? { companyId: co.id } : {}),
      status: 'open',
      completed: false,
    } as Omit<Task, 'id' | 'createdAt'>)
  }

  const groups = groupBy !== 'none'
    ? buildTaskGroups(tasks, groupBy)
    : [{ key: 'all', label: '', color: '#9B9180', emoji: '', tasks }]

  return (
    <div ref={setNodeRef} style={{
      background: isOver ? '#FDF6DC' : spec.accent ? '#FFFCF0' : '#FDFCF8',
      border: `1px solid ${isOver ? '#F5D14E' : spec.accent ? '#F0DFA8' : '#E8E1CE'}`,
      borderRadius: 14, padding: 14, transition: 'background .12s, border-color .12s',
      display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
    }}>
      {/* Quadrant header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: '#191712', color: '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: badgeFontSize(spec.badge), fontWeight: 700, letterSpacing: '0.04em',
          overflow: 'hidden',
        }}>{spec.badge}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: '#191712', lineHeight: 1.3 }}>{spec.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.35 }}>{spec.sub}</p>
        </div>
        <span style={{ fontSize: 12.5, color: '#9B9180', flexShrink: 0, paddingTop: 3 }}>{tasks.length}</span>
        <button onClick={() => onAction(spec, tasks)} style={{
          flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999,
          background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712',
          fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>{spec.action}</button>
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {groups.map(g => (
          <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.label && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 2px 0' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: g.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6C6553' }}>{g.label}</span>
                <span style={{ fontSize: 11, color: '#9B9180' }}>{g.tasks.length}</span>
              </div>
            )}
            {g.tasks.map(t => <TaskRow key={t.id} task={t} onOpen={onOpen} dense />)}
          </div>
        ))}
      </div>

      {/* Add here */}
      {adding ? (
        <input
          autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setAdding(false); setDraft('') }
          }}
          placeholder="Task title…"
          style={{
            width: '100%', boxSizing: 'border-box', background: '#FFFFFF',
            border: '1px solid #F5D14E', borderRadius: 10, padding: '11px 13px',
            fontSize: 13, color: '#191712', outline: 'none', fontFamily: 'inherit',
          }}
        />
      ) : (
        <button onClick={() => setAdding(true)} style={{
          width: '100%', padding: '11px 0', borderRadius: 10,
          background: 'transparent', border: '1px dashed #DED5BF', color: '#9B9180',
          fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Plus size={13} /> Add here
        </button>
      )}
    </div>
  )
}

interface EisenhowerBoardProps {
  onOpen: (id: string) => void
  hideCompleted?: boolean
  groupBy?: TaskGroupBy
  allGroupsExpanded?: boolean
  filteredTaskIds?: Set<string> | null
  /** "Schedule now" / "Block time" hand off to the day planner. */
  onOpenPlanner?: () => void
}

export function EisenhowerBoard({
  onOpen, hideCompleted = false, groupBy = 'none', filteredTaskIds, onOpenPlanner,
}: EisenhowerBoardProps) {
  const allTasks = useTaskStore(s => s.tasks)
  const updateTask = useTaskStore(s => s.updateTask)
  const tasks = allTasks.filter(t => !isTaskHidden(t))

  function tasksFor(q: Quadrant) {
    return tasks.filter(t =>
      t.quadrant === q &&
      (!hideCompleted || (!t.completed && t.status !== 'done')) &&
      (!filteredTaskIds || filteredTaskIds.has(t.id))
    )
  }

  function handleAction(spec: QuadrantSpec, qTasks: Task[]) {
    if (spec.id === 'do' || spec.id === 'schedule') { onOpenPlanner?.(); return }
    if (spec.id === 'delegate') {
      // Nothing to reassign to without a choice — open the first task that has
      // no owner so it can be set there.
      const target = qTasks.find(t => !t.owner) ?? qTasks[0]
      if (target) onOpen(target.id)
      return
    }
    const open = qTasks.filter(t => !t.completed && t.status !== 'cancelled')
    if (open.length === 0) return
    if (!window.confirm(`Archive ${open.length} task${open.length === 1 ? '' : 's'}?`)) return
    for (const t of open) updateTask(t.id, { status: 'cancelled' })
  }

  const [urgentImportant, notUrgentImportant, urgentNotImportant, notUrgentNotImportant] = QUADRANT_SPECS

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '30px minmax(0, 1fr) minmax(0, 1fr)',
      gap: 12, alignItems: 'stretch',
    }}>
      {/* Column axis */}
      <div />
      <ColumnLabel>Urgent</ColumnLabel>
      <ColumnLabel>Not urgent</ColumnLabel>

      {/* Important row */}
      <AxisLabel>Important</AxisLabel>
      <QuadrantPanel spec={urgentImportant} tasks={tasksFor('do')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
      <QuadrantPanel spec={notUrgentImportant} tasks={tasksFor('schedule')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />

      {/* Not important row */}
      <AxisLabel>Not important</AxisLabel>
      <QuadrantPanel spec={urgentNotImportant} tasks={tasksFor('delegate')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
      <QuadrantPanel spec={notUrgentNotImportant} tasks={tasksFor('eliminate')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
    </div>
  )
}
