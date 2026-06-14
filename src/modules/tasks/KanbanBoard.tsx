import { useState, useMemo, useRef, useEffect } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Check, Plus, X as XIcon } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import type { Task, TaskType } from '@/types'
import {
  TASK_TYPE_META, inferTaskType,
  loadVisibleCompanies, getAllUsers, isTaskHidden,
} from '@/types'
import { loadCustomStatuses, getStatusMeta } from '@/lib/customStatuses'

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

function bucketToDate(bucket: string): string | undefined {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  if (bucket === 'overdue' || bucket === 'today') {
    return today.toISOString().slice(0, 10)
  }
  if (bucket === 'this-week') {
    const d = new Date(today); d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  if (bucket === 'next-week') {
    const d = new Date(today)
    const day = d.getDay()
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7
    d.setDate(d.getDate() + daysUntilMonday)
    return d.toISOString().slice(0, 10)
  }
  if (bucket === 'later') {
    const d = new Date(today); d.setDate(d.getDate() + 14)
    return d.toISOString().slice(0, 10)
  }
  return undefined // unscheduled → clear dueDate
}

function sortByUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.urgent && !b.urgent) return -1
    if (!a.urgent && b.urgent) return 1
    return 0
  })
}

// ── Card ─────────────────────────────────────────────────────────────────────

function KanbanCard({ task, onOpen, overlay = false }: { task: Task; onOpen: () => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const updateTask     = useTaskStore(s => s.updateTask)
  const toggleComplete = useTaskStore(s => s.toggleComplete)
  const companies   = loadVisibleCompanies()
  const allUsers    = getAllUsers()

  const company      = task.companyId ? companies.find(c => c.id === task.companyId) : null
  const companyName  = company?.name ?? (task.company !== 'personal' ? task.company : null)
  const companyColor = company?.color ?? '#7F77DD'
  const companyAbbr  = companyName
    ? companyName.split(/[\s(]+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 3)
    : ''

  const isPersonal    = !task.companyId && task.company === 'personal'
  const priority      = task.quadrant ? QUADRANT_PRIORITY[task.quadrant] : null
  const taskType      = task.taskType ?? inferTaskType(task.title)
  const typeMeta      = TASK_TYPE_META[taskType]
  const owner         = task.owner ? allUsers.find(u => u.id === task.owner) : null
  const ownerInitials = owner
    ? owner.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : null

  const statusMeta = task.boardStatus ? getStatusMeta(task.boardStatus) : null

  const style: React.CSSProperties = {
    transform: overlay ? undefined : CSS.Translate.toString(transform),
    opacity:   isDragging ? 0.35 : 1,
    cursor:    isDragging ? 'grabbing' : 'grab',
    background:   'var(--color-surface, #161929)',
    border:       `1px solid ${task.urgent ? 'rgba(224,82,82,0.5)' : 'var(--color-border, #252A3E)'}`,
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
      {/* Urgent left border */}
      {task.urgent && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#E05252', borderRadius: '10px 0 0 10px' }} />
      )}

      {/* Top row: checkbox + title + lightning bolt */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 9 }}>
        {/* Completion checkbox */}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); toggleComplete(task.id) }}
          title={task.completed ? 'Mark incomplete' : 'Mark complete'}
          style={{
            width: 15, height: 15, borderRadius: 4, flexShrink: 0, marginTop: 2,
            border: `1.5px solid ${task.completed ? '#1D9E75' : 'var(--color-border, #404560)'}`,
            background: task.completed ? '#1D9E75' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>
        <div style={{
          flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text, #E8EAF6)',
          lineHeight: 1.45,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          textDecoration: task.completed ? 'line-through' : 'none',
          opacity: task.completed ? 0.55 : 1,
        }}>
          {task.title}
        </div>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); updateTask(task.id, { urgent: !task.urgent }) }}
          title={task.urgent ? 'Mark not urgent' : 'Mark urgent'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '0 2px', fontSize: 13, lineHeight: 1, flexShrink: 0,
            color: task.urgent ? '#F59E0B' : 'var(--color-text-muted, #6B7280)',
            opacity: task.urgent ? 1 : 0.35,
          }}
        >⚡</button>
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
        {statusMeta && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
            background: `${statusMeta.color}18`, color: statusMeta.color,
          }}>
            {statusMeta.label}
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

interface KanbanColumnProps {
  column: Column
  onOpen: (id: string) => void
  onColDragStart: (id: string) => void
  onColDragOver: (e: React.DragEvent) => void
  onColDrop: (id: string) => void
}

function KanbanColumnComp({ column, onOpen, onColDragStart, onColDragOver, onColDrop }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const addTask = useTaskStore(s => s.addTask)
  const companies = loadVisibleCompanies()
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  function commitAdd() {
    if (!newTitle.trim()) { setAdding(false); setNewTitle(''); return }
    addTask({
      title: newTitle.trim(),
      quadrant: null,
      company: (companies[0]?.id ?? 'teradix') as Task['company'],
      ...(companies[0] ? { companyId: companies[0].id } : {}),
      status: 'open',
      completed: false,
      boardStatus: column.id,
    })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      onDragOver={onColDragOver}
      onDrop={() => onColDrop(column.id)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingLeft: 2, flexShrink: 0 }}>
        <span
          draggable
          onDragStart={() => onColDragStart(column.id)}
          onDragOver={onColDragOver}
          onDrop={() => onColDrop(column.id)}
          title="Drag to reorder"
          style={{ cursor: 'grab', color: 'var(--color-text-muted, #6B7280)', fontSize: 14, lineHeight: 1, userSelect: 'none', marginRight: 2 }}
        >
          ⠿
        </span>
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
        {column.tasks.length === 0 && !adding ? (
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

        {/* Quick-add inline form */}
        {adding && (
          <div style={{ padding: '6px 8px' }}>
            <input
              ref={inputRef}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAdding(false); setNewTitle('') } }}
              placeholder="Task title…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-accent, #7F77DD)',
                borderRadius: 6, padding: '6px 8px', fontSize: 12,
                color: 'var(--color-text, #E8EAF6)', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
              <button onClick={commitAdd} style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, background: 'var(--color-accent, #7F77DD)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                Add
              </button>
              <button onClick={() => { setAdding(false); setNewTitle('') }} style={{ padding: '4px 8px', fontSize: 11, background: 'transparent', color: 'var(--color-text-muted, #6B7280)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <XIcon size={11} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add task button */}
      <button
        onClick={() => setAdding(true)}
        style={{
          marginTop: 6, width: '100%', padding: '5px 0', fontSize: 11, fontWeight: 500,
          background: 'transparent', border: '1px dashed var(--color-border, #252A3E)', borderRadius: 6,
          color: 'var(--color-text-muted, #6B7280)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          transition: 'all 0.12s',
        }}
      >
        <Plus size={11} /> New task
      </button>
    </div>
  )
}

// ── Date Picker Overlay (shown when dropping a task into "Planned") ───────────

function DatePickerOverlay({
  taskTitle,
  onConfirm,
  onCancel,
}: {
  taskTitle: string
  onConfirm: (date: string) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--color-surface, #161929)', borderRadius: 14,
        padding: 24, width: 320, border: '1px solid var(--color-border, #252A3E)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', marginBottom: 6 }}>
          Plan this task
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted, #6B7280)', marginBottom: 16, lineHeight: 1.5 }}>
          {taskTitle}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', marginBottom: 6, fontWeight: 600 }}>
            Planned Date
          </div>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--color-bg, #0D0F1A)',
              border: '1px solid var(--color-border, #252A3E)',
              borderRadius: 6, padding: '7px 10px',
              fontSize: 13, color: 'var(--color-text, #E8EAF6)',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '7px 16px', borderRadius: 7, background: 'transparent',
            border: '1px solid var(--color-border, #252A3E)',
            color: 'var(--color-text-muted, #6B7280)', fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => date && onConfirm(date)} disabled={!date} style={{
            padding: '7px 18px', borderRadius: 7,
            background: 'rgba(59,130,246,0.15)',
            border: '1px solid rgba(59,130,246,0.4)',
            color: '#3B82F6', fontSize: 12, fontWeight: 600,
            cursor: date ? 'pointer' : 'default', opacity: date ? 1 : 0.5,
          }}>Set Date &amp; Plan</button>
        </div>
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
  const [pendingPlanTask, setPendingPlanTask] = useState<{ taskId: string; title: string } | null>(null)
  const dragColRef = useRef<string | null>(null)
  const [colOrder, setColOrder] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('task-board-col-order') || '{}') } catch { return {} }
  })

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

  const customStatuses = useMemo(() => loadCustomStatuses(), [])

  // Check if any status has id 'planned' for date-picker logic
  const hasPlannedStatus = customStatuses.some(s => s.id === 'planned')

  const columns = useMemo<Column[]>(() => {
    if (boardType === 'status') {
      return customStatuses.map(s => ({
        id:    s.id,
        label: s.label,
        color: s.color,
        tasks: sortByUrgency(tasks.filter(t => (t.boardStatus ?? 'backlog') === s.id)),
      }))
    }

    if (boardType === 'company') {
      const cols: Column[] = companies.map(co => ({
        id:    co.id,
        label: co.name,
        color: co.color,
        tasks: sortByUrgency(tasks.filter(t =>
          t.companyId === co.id ||
          (!t.companyId && t.company?.toLowerCase() === co.name.toLowerCase())
        )),
      }))
      const assigned = new Set(cols.flatMap(c => c.tasks.map(t => t.id)))
      cols.push({
        id:    'personal',
        label: 'Personal',
        color: '#888780',
        tasks: sortByUrgency(tasks.filter(t => !assigned.has(t.id))),
      })
      return cols
    }

    if (boardType === 'owner') {
      // Show ALL users from all companies, not just those with tasks
      const cols: Column[] = allUsers.map(u => ({
        id:    u.id,
        label: u.name,
        color: '#7F77DD',
        tasks: sortByUrgency(tasks.filter(t => t.owner === u.id)),
      }))
      cols.push({
        id:    'unassigned',
        label: 'Unassigned',
        color: '#6B7280',
        tasks: sortByUrgency(tasks.filter(t => !t.owner)),
      })
      return cols
    }

    if (boardType === 'type') {
      return (Object.keys(TASK_TYPE_META) as TaskType[]).map(type => ({
        id:    type,
        label: `${TASK_TYPE_META[type].emoji} ${TASK_TYPE_META[type].label}`,
        color: TASK_TYPE_META[type].color,
        tasks: sortByUrgency(tasks.filter(t => (t.taskType ?? inferTaskType(t.title)) === type)),
      }))
    }

    if (boardType === 'scheduled') {
      const buckets = [
        { id: 'overdue',     label: 'Overdue',    color: '#EF4444' },
        { id: 'today',       label: 'Today',      color: '#3B82F6' },
        { id: 'this-week',   label: 'This Week',  color: '#8B5CF6' },
        { id: 'next-week',   label: 'Next Week',  color: '#6366F1' },
        { id: 'later',       label: 'Later',      color: '#6B7280' },
        { id: 'unscheduled', label: 'Unscheduled',color: '#9CA3AF' },
      ]
      return buckets.map(b => ({
        id:    b.id,
        label: b.label,
        color: b.color,
        tasks: sortByUrgency(tasks.filter(t => getScheduledBucket(t.dueDate) === b.id)),
      }))
    }

    return []
  }, [tasks, boardType, companies, allUsers, customStatuses])

  const orderedColumns = useMemo(() => {
    const order = colOrder[boardType]
    if (!order?.length) return columns
    const map = new Map(order.map((id, i) => [id, i]))
    return [...columns].sort((a, b) =>
      (map.has(a.id) ? map.get(a.id)! : 999) - (map.has(b.id) ? map.get(b.id)! : 999)
    )
  }, [columns, colOrder, boardType])

  function handleColDragStart(id: string) { dragColRef.current = id }
  function handleColDragOver(e: React.DragEvent) { e.preventDefault() }
  function handleColDrop(targetId: string) {
    const fromId = dragColRef.current
    if (!fromId || fromId === targetId) return
    const order = orderedColumns.map(c => c.id)
    const from = order.indexOf(fromId); const to = order.indexOf(targetId)
    if (from === -1 || to === -1) return
    const next = [...order]; next.splice(from, 1); next.splice(to, 0, fromId)
    const updated = { ...colOrder, [boardType]: next }
    setColOrder(updated)
    localStorage.setItem('task-board-col-order', JSON.stringify(updated))
    dragColRef.current = null
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart({ active }: DragStartEvent) {
    setActiveTaskId(active.id as string)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTaskId(null)
    if (!over) return
    const taskId   = active.id as string
    const columnId = over.id as string
    const task     = tasks.find(t => t.id === taskId)

    if (boardType === 'status') {
      if (hasPlannedStatus && columnId === 'planned') {
        setPendingPlanTask({ taskId, title: task?.title ?? '' })
      } else {
        updateTask(taskId, { boardStatus: columnId })
      }
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
    } else if (boardType === 'scheduled') {
      updateTask(taskId, { dueDate: bucketToDate(columnId) })
    }
  }

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Date picker overlay for "Planned" column */}
      {pendingPlanTask && (
        <DatePickerOverlay
          taskTitle={pendingPlanTask.title}
          onConfirm={date => {
            updateTask(pendingPlanTask.taskId, { boardStatus: 'planned', dueDate: date })
            setPendingPlanTask(null)
          }}
          onCancel={() => setPendingPlanTask(null)}
        />
      )}

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
      </div>

      {/* Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{
          display: 'flex', gap: 12, padding: '16px 28px',
          overflowX: 'auto', overflowY: 'hidden',
          flex: 1, alignItems: 'flex-start',
        }}>
          {orderedColumns.map(col => (
            <KanbanColumnComp key={col.id} column={col} onOpen={onOpen}
              onColDragStart={handleColDragStart}
              onColDragOver={handleColDragOver}
              onColDrop={handleColDrop}
            />
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
