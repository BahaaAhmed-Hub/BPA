// ─── 9E Eisenhower matrix ────────────────────────────────────────────────────
// Urgent × important, four quadrants, with the axis spelled out: URGENT /
// NOT URGENT across the top and IMPORTANT / NOT IMPORTANT down the side.

import { useState } from 'react'
import { Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { useTaskStore } from '@/store/taskStore'
import { suppressUndo } from '@/lib/undo'
import type { Quadrant, Task } from '@/types'
import { isTaskHidden, loadVisibleCompanies } from '@/types'
import { TaskRow } from './TaskRow'
import { buildTaskGroups, sortUrgentFirst, type TaskGroupBy } from './taskVisuals'
import { CountBadge } from './controls'
import { ICON, STROKE } from '@/lib/type'

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggleGroup(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

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
    : [{ key: 'all', label: '', color: 'var(--sb-ink-4)', emoji: '', tasks: sortUrgentFirst(tasks) }]

  return (
    <div ref={setNodeRef} style={{
      background: isOver ? '#FDF6DC' : spec.accent ? '#FFFCF0' : '#FDFCF8',
      border: `1px solid ${isOver ? 'var(--sb-accent)' : spec.accent ? '#F0DFA8' : 'var(--sb-border)'}`,
      borderRadius: 'var(--sb-r-nav)', padding: 14, transition: 'background .12s, border-color .12s',
      display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
    }}>
      {/* Quadrant header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
          background: 'var(--sb-ink-1)', color: 'var(--sb-card)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: badgeFontSize(spec.badge), fontWeight: 700, letterSpacing: '0.04em',
          overflow: 'hidden',
        }}>{spec.badge}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>{spec.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.35 }}>{spec.sub}</p>
        </div>
        <span style={{ paddingTop: 2 }}><CountBadge value={tasks.length} /></span>
        {/* Adding to a quadrant is a small, frequent thing, so it is a small
            control at the top rather than a full-width dashed slab under a
            list it has to be scrolled past to reach. */}
        <button
          onClick={() => setAdding(true)}
          title={`Add a task to ${spec.title}`}
          style={{
            flexShrink: 0, width: 26, height: 26, padding: 0, borderRadius: 'var(--sb-r-pill)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: adding ? 'var(--sb-ink-1)' : 'var(--sb-card)',
            border: `1px solid ${adding ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
            color: adding ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)', cursor: 'pointer',
          }}><Plus size={ICON.sm} strokeWidth={STROKE.active} /></button>
        <button onClick={() => onAction(spec, tasks)} style={{
          flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 'var(--sb-r-pill)',
          background: 'var(--sb-card)', border: '1px solid var(--sb-border)', color: 'var(--sb-ink-1)',
          fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>{spec.action}</button>
      </div>

      {/* Typing a new one happens where it will land: at the top of the list,
          not under it. */}
      {adding && (
        <input
          autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setAdding(false); setDraft('') }
          }}
          placeholder="What is it?"
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--sb-card)',
            border: '1px solid var(--sb-accent)', borderRadius: 'var(--sb-r-nav)', padding: '11px 13px',
            fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', outline: 'none', fontFamily: 'inherit',
          }}
        />
      )}

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {groups.map(g => {
          const isOpen = !collapsed.has(g.key)
          return (
            <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.label && (
                <button
                  onClick={() => toggleGroup(g.key)}
                  title={isOpen ? 'Collapse group' : 'Expand group'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '3px 4px',
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    width: '100%', textAlign: 'left',
                  }}>
                  {isOpen
                    ? <ChevronDown size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-ink-4)" />
                    : <ChevronRight size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-ink-4)" />}
                  <span style={{ width: 7, height: 7, borderRadius: 'var(--sb-r-pill)', background: g.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>{g.label}</span>
                  <CountBadge value={g.tasks.length} />
                </button>
              )}
              {isOpen && g.tasks.map(t => <TaskRow key={t.id} task={t} onOpen={onOpen} dense />)}
            </div>
          )
        })}
      </div>

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
    // One entry for the lot — forty ⌘Zs to undo an archive is not an undo.
    useTaskStore.getState()._remember(`Archived ${open.length} ${open.length === 1 ? 'task' : 'tasks'}`)
    suppressUndo(() => { for (const t of open) updateTask(t.id, { status: 'cancelled' }) })
  }

  const [urgentImportant, notUrgentImportant, urgentNotImportant, notUrgentNotImportant] = QUADRANT_SPECS

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      gap: 12, alignItems: 'stretch',
    }}>
      <QuadrantPanel spec={urgentImportant} tasks={tasksFor('do')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
      <QuadrantPanel spec={notUrgentImportant} tasks={tasksFor('schedule')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
      <QuadrantPanel spec={urgentNotImportant} tasks={tasksFor('delegate')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
      <QuadrantPanel spec={notUrgentNotImportant} tasks={tasksFor('eliminate')} onOpen={onOpen} onAction={handleAction} groupBy={groupBy} />
    </div>
  )
}
