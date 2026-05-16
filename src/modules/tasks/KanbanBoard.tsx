import { useState, useMemo } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useTaskStore } from '@/store/taskStore'
import type { Task, TaskType, BoardStatus } from '@/types'
import {
  BOARD_STATUS_META, TASK_TYPE_META, inferTaskType,
  loadVisibleCompanies, getAllUsers, isTaskHidden,
} from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

type BoardType = 'status' | 'company' | 'owner' | 'type' | 'scheduled'

interface Column {
  id: string
  label: string
  color: string
  tasks: Task[]
}

const BOARD_TYPE_OPTIONS: { id: BoardType; label: string }[] = [
  { id: 'status',    label: 'Status' },
  { id: 'company',   label: 'Companies' },
  { id: 'owner',     label: 'Owners' },
  { id: 'type',      label: 'Task Types' },
  { id: 'scheduled', label: 'Scheduled' },
]

const QUADRANT_PRIORITY: Record<string, string> = {
  do: 'P0', schedule: 'P1', delegate: 'P2', eliminate: 'P3',
}

function getScheduledBucket(dueDate: string | undefined): string {
  if (!dueDate) return 'unscheduled'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due   = new Date(dueDate); due.setHours(0, 0, 0, 0)
  const diff  = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diff < 0)   return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 7)  return 'this-week'
  if (diff <= 14) return 'next-week'
  return 'later'
}

// ── Card ─────────────────────────────────────────────────────────────────────

function KanbanCard({ task, onOpen, overlay = false }: { task: Task; onOpen: () => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const companies = loadVisibleCompanies()
  const allUsers  = getAllUsers()

  const company     = task.companyId ? companies.find(c => c.id === task.companyId) : null
  const companyName = company?.name ?? (task.company !== 'personal' ? task.company : null)
  const companyColor = company?.color ?? '#7F77DD'
  const companyAbbr = companyName
    ? companyName.split(/[\s(]+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 3)
    : ''

  const isPersonal  = !task.companyId && task.company === 'personal'
  const priority    = task.quadrant ? QUADRANT_PRIORITY[task.quadrant] : null
  const taskType    = task.taskType ?? inferTaskType(task.title)
  const typeMeta    = TASK_TYPE_META[taskType]
  const owner       = task.owner ? allUsers.find(u => u.id === task.owner) : null
  const ownerInitials = owner
    ? owner.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : null

  const style: React.CSSProperties = {
    transform: overlay ? undefined : CSS.Translate.toString(transform),
    opacity:   isDragging ? 0.35 : 1,
    cursor:    isDragging ? 'grabbing' : 'grab',
    background:   'var(--color-surface, #161929)',
    border:       `1px solid var(--color-border, #252A3E)`,
    borderRadius: 10,
    padding:      '12px 13px',
    marginBottom: 8,
    boxShadow:    isDragging ? 'none' : '0 1px 4px rgba(0,0,0,0.18)',
    transition:   isDragging ? 'none' : 'box-shadow 0.15s',
    userSelect:   'none',
    position:     'relative',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onClick={e => { e.stopPropagation(); if (!isDragging) onOpen() }}
    >
      {/* Urgent indicator */}
      {task.urgent && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#E05252', borderRadius: '10px 0 0 10px' }} />
      )}

      {/* Title */}
      <div style={{
        fontSize: 12.5, fontWeight: 600, color: 'var(--color-text, #E8EAF6)',
        marginBottom: 9, lineHeight: 1.45,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {task.title}
      </div>

      {/* Badges row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: companyName && !isPersonal ? 5 : 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
          background: isPersonal ? 'rgba(136,135,128,0.12)' : 'rgba(127,119,221,0.12)',
          color: isPersonal ? '#888780' : '#9B94E8',
        }}>
          {isPersonal ? 'Personal' : 'Work'}
        </span>
        {!isPersonal && companyAbbr && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: `${companyColor}20`, color: companyColor,
          }}>
            {companyAbbr}
          </span>
        )}
        <span title={typeMeta.label} style={{ fontSize: 12 }}>{typeMeta.emoji}</span>
      </div>

      {/* Company name */}
      {!isPersonal && companyName && (
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted, #6B7280)', marginBottom: 8,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {companyName}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {priority ? (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: 'rgba(127,119,221,0.12)', color: 'var(--color-accent, #7F77DD)',
          }}>
            {priority}
          </span>
        ) : (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
            background: 'rgba(251,191,36,0.12)', color: '#FBBF24',
          }}>
            Unsch.
          </span>
        )}
        {task.boardStatus && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
            background: `${BOARD_STATUS_META[task.boardStatus].color}18`,
            color: BOARD_STATUS_META[task.boardStatus].color,
          }}>
            {BOARD_STATUS_META[task.boardStatus].label}
          </span>
        )}
        {ownerInitials && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: 'rgba(52,211,153,0.1)', color: '#34D399',
          }}>
            {ownerInitials}
          </span>
        )}
        {task.dueDate && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted, #6B7280)', marginLeft: 'auto' }}>
            {task.dueDate}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Column ───────────────────────────────────────────────────────────────────

function KanbanColumnComp({ column, onOpen }: { column: Column; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingLeft: 2, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {column.label}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted, #6B7280)',
          background: 'var(--color-bg, #0D0F1A)', padding: '1px 8px', borderRadius: 10, flexShrink: 0,
        }}>
          {column.tasks.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '4px 2px',
          minHeight: 100,
          background: isOver ? 'rgba(127,119,221,0.06)' : 'rgba(0,0,0,0.04)',
          borderRadius: 10,
          border: `1.5px dashed ${isOver ? 'rgba(127,119,221,0.4)' : 'var(--color-border, #252A3E)'}`,
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {column.tasks.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted, #6B7280)', fontStyle: 'italic' }}>
            No tasks
          </div>
        ) : (
          <div style={{ padding: '4px 6px' }}>
            {column.tasks.map(task => (
              <KanbanCard key={task.id} task={task} onOpen={() => onOpen(task.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────────

interface KanbanBoardProps {
  onOpen: (id: string) => void
  hideCompleted?: boolean
  filteredTaskIds?: Set<string> | null
}

export function KanbanBoard({ onOpen, hideCompleted = false, filteredTaskIds }: KanbanBoardProps) {
  const { tasks: allTasks, updateTask } = useTaskStore()
  const [boardType, setBoardType] = useState<BoardType>(() =>
    (localStorage.getItem('task-board-type') as BoardType) ?? 'status'
  )
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  const companies = loadVisibleCompanies()
  const allUsers  = getAllUsers()

  const tasks = allTasks.filter(t =>
    !isTaskHidden(t) &&
    (!hideCompleted || (!t.completed && t.status !== 'done')) &&
    (!filteredTaskIds || filteredTaskIds.has(t.id))
  )

  function saveBoardType(type: BoardType) {
    setBoardType(type)
    localStorage.setItem('task-board-type', type)
  }

  const columns = useMemo<Column[]>(() => {
    if (boardType === 'status') {
      const statuses: BoardStatus[] = ['backlog', 'planned', 'in-progress', 'blocked', 'delayed', 'done']
      return statuses.map(s => ({
        id:    s,
        label: BOARD_STATUS_META[s].label,
        color: BOARD_STATUS_META[s].color,
        tasks: tasks.filter(t => (t.boardStatus ?? 'backlog') === s),
      }))
    }

    if (boardType === 'company') {
      const cols: Column[] = companies.map(co => ({
        id:    co.id,
        label: co.name,
        color: co.color,
        tasks: tasks.filter(t =>
          t.companyId === co.id ||
          (!t.companyId && t.company?.toLowerCase() === co.name.toLowerCase())
        ),
      }))
      const assigned = new Set(cols.flatMap(c => c.tasks.map(t => t.id)))
      cols.push({
        id:    'personal',
        label: 'Personal',
        color: '#888780',
        tasks: tasks.filter(t => !assigned.has(t.id)),
      })
      return cols
    }

    if (boardType === 'owner') {
      const ownerIds = [...new Set(tasks.map(t => t.owner).filter(Boolean) as string[])]
      const cols: Column[] = ownerIds.map(ownerId => {
        const user = allUsers.find(u => u.id === ownerId)
        return {
          id:    ownerId,
          label: user?.name ?? 'Unknown',
          color: '#7F77DD',
          tasks: tasks.filter(t => t.owner === ownerId),
        }
      })
      cols.push({
        id:    'unassigned',
        label: 'Unassigned',
        color: '#6B7280',
        tasks: tasks.filter(t => !t.owner),
      })
      return cols
    }

    if (boardType === 'type') {
      return (Object.keys(TASK_TYPE_META) as TaskType[]).map(type => ({
        id:    type,
        label: `${TASK_TYPE_META[type].emoji} ${TASK_TYPE_META[type].label}`,
        color: TASK_TYPE_META[type].color,
        tasks: tasks.filter(t => (t.taskType ?? inferTaskType(t.title)) === type),
      }))
    }

    if (boardType === 'scheduled') {
      const buckets = [
        { id: 'overdue',     label: 'Overdue',      color: '#EF4444' },
        { id: 'today',       label: 'Today',         color: '#3B82F6' },
        { id: 'this-week',   label: 'This Week',     color: '#8B5CF6' },
        { id: 'next-week',   label: 'Next Week',     color: '#6366F1' },
        { id: 'later',       label: 'Later',         color: '#6B7280' },
        { id: 'unscheduled', label: 'Unscheduled',   color: '#9CA3AF' },
      ]
      return buckets.map(b => ({
        id:    b.id,
        label: b.label,
        color: b.color,
        tasks: tasks.filter(t => getScheduledBucket(t.dueDate) === b.id),
      }))
    }

    return []
  }, [tasks, boardType, companies, allUsers])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart({ active }: DragStartEvent) {
    setActiveTaskId(active.id as string)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTaskId(null)
    if (!over) return
    const taskId   = active.id as string
    const columnId = over.id as string

    if (boardType === 'status') {
      updateTask(taskId, { boardStatus: columnId as BoardStatus })
    } else if (boardType === 'company') {
      if (columnId === 'personal') {
        updateTask(taskId, { company: 'personal', companyId: undefined })
      } else {
        const co = companies.find(c => c.id === columnId)
        if (co) updateTask(taskId, { companyId: co.id, company: 'personal' })
      }
    } else if (boardType === 'owner') {
      updateTask(taskId, { owner: columnId === 'unassigned' ? undefined : columnId })
    } else if (boardType === 'type') {
      updateTask(taskId, { taskType: columnId as TaskType })
    }
    // 'scheduled' board uses date buckets — dragging not meaningful without picking a date
  }

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Board type tabs */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 28px',
        borderBottom: '1px solid var(--color-border, #252A3E)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted, #6B7280)', marginRight: 4, flexShrink: 0 }}>
          Group by:
        </span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {BOARD_TYPE_OPTIONS.map(opt => (
            <button key={opt.id} onClick={() => saveBoardType(opt.id)} style={{
              padding: '5px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: boardType === opt.id ? 'var(--color-accent, #7F77DD)' : 'transparent',
              color:      boardType === opt.id ? '#fff' : 'var(--color-text-muted, #6B7280)',
              border:     `1px solid ${boardType === opt.id ? 'var(--color-accent, #7F77DD)' : 'var(--color-border, #252A3E)'}`,
              transition: 'all 0.12s',
            }}>
              {opt.label}
            </button>
          ))}
        </div>
        {boardType === 'scheduled' && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', fontStyle: 'italic', marginLeft: 8 }}>
            Drag not supported — edit task to change date
          </span>
        )}
      </div>

      {/* Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{
          display: 'flex', gap: 12, padding: '16px 28px',
          overflowX: 'auto', overflowY: 'hidden',
          flex: 1, alignItems: 'flex-start',
        }}>
          {columns.map(col => (
            <KanbanColumnComp key={col.id} column={col} onOpen={onOpen} />
          ))}
        </div>

        <DragOverlay>
          {activeTask && (
            <div style={{ width: 250, transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
              <KanbanCard task={activeTask} onOpen={() => {}} overlay />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
