import { useState, useMemo, useRef, useEffect } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Check, Plus, Trash2, X as XIcon } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import type { Task, TaskType } from '@/types'
import {
  TASK_TYPE_META, inferTaskType,
  loadVisibleCompanies, getAllUsers, isTaskHidden,
} from '@/types'
import { loadCustomStatuses, sortCustomStatuses } from '@/lib/customStatuses'

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
  const toggleComplete = useTaskStore(s => s.toggleComplete)
  const deleteTask     = useTaskStore(s => s.deleteTask)
  const companies   = loadVisibleCompanies()
  const allUsers    = getAllUsers()

  const company      = task.companyId ? companies.find(c => c.id === task.companyId) : null
  const companyName  = company?.name ?? (task.company && task.company !== 'personal' ? task.company : null)
  const priority      = task.quadrant ? QUADRANT_PRIORITY[task.quadrant] : null
  const taskType      = task.taskType ?? inferTaskType(task.title)
  const typeMeta      = TASK_TYPE_META[taskType]
  const owner         = task.owner ? allUsers.find(u => u.id === task.owner) : null
  const ownerInitials = owner
    ? owner.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : null

  // Sunlit Bento: company-tinted card background
  const companyHex = company?.color ?? '#8C826A'
  const hexRgb = (hex: string) => {
    const h = hex.replace('#', '')
    if (h.length < 6) return '140,130,106'
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16)
    return isNaN(r) ? '140,130,106' : `${r},${g},${b}`
  }
  const ccRgb = hexRgb(companyHex)

  const style: React.CSSProperties = {
    transform: overlay ? undefined : CSS.Translate.toString(transform),
    opacity:   isDragging ? 0.35 : 1,
    cursor:    isDragging ? 'grabbing' : 'grab',
    position:  'relative',
    background:   `rgba(${ccRgb}, 0.085)`,
    border:       isDragging ? `2px solid ${companyHex}` : `1px solid rgba(${ccRgb}, 0.42)`,
    borderRadius: 13,
    padding:      '11px 12px',
    marginBottom: 9,
    display:      'flex', flexDirection: 'column', gap: 8,
    boxShadow:    isDragging ? '0 8px 20px -12px rgba(25,23,18,.4)' : 'none',
    transition:   isDragging ? 'none' : 'box-shadow 0.15s',
    userSelect:   'none',
    overflow:     'hidden', minWidth: 0,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onClick={e => { e.stopPropagation(); if (!isDragging) onOpen() }}
    >
      {/* Top row: checkbox + title + delete */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, minWidth: 0 }}>
        {/* Completion checkbox */}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); toggleComplete(task.id) }}
          title={task.completed ? 'Mark incomplete' : 'Mark complete'}
          style={{
            width: 17, height: 17, borderRadius: 5, flexShrink: 0, marginTop: 1,
            boxSizing: 'border-box',
            border: task.completed ? '1.5px solid #4E7645' : '1.5px solid rgba(25,23,18,.28)',
            background: task.completed ? '#4E7645' : 'rgba(255,255,255,.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>

        <div style={{
          flex: 1, fontSize: 12.5, fontWeight: 600, color: '#191712',
          lineHeight: 1.32, minWidth: 0,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          textDecoration: task.completed ? 'line-through' : 'none',
          opacity: task.completed ? 0.55 : 1,
        }}>
          {task.title}
        </div>

        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); deleteTask(task.id) }}
          title="Delete task"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0, color: '#8A8272', opacity: 0.5, display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Chips row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        {/* Task type chip */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 19, boxSizing: 'border-box', padding: '0 7px', borderRadius: 5, background: `rgba(255,255,255,.78)`, border: `1px solid rgba(${ccRgb},.44)`, color: companyHex, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          {typeMeta.emoji} {typeMeta.label}
        </span>

        {/* Urgent/Priority chip */}
        {task.urgent && (
          <span style={{ height: 18, boxSizing: 'border-box', padding: '0 6px', borderRadius: 5, background: '#FBEAE4', border: '1px solid #E5BBAC', color: '#B94A2E', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', flexShrink: 0 }}>P0</span>
        )}
        {!task.urgent && priority && priority === 'P1' && (
          <span style={{ height: 18, boxSizing: 'border-box', padding: '0 6px', borderRadius: 5, background: '#FEF7DE', border: '1px solid #F5D14E', color: '#191712', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', flexShrink: 0 }}>P1</span>
        )}

        {/* Company dot */}
        {companyName && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, color: companyHex, flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: companyHex }} />
            {companyName}
          </span>
        )}

        {/* Owner chip */}
        {ownerInitials && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 19, boxSizing: 'border-box', padding: '0 7px', borderRadius: 5, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(25,23,18,.1)', color: '#6C6553', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
            {ownerInitials}
          </span>
        )}

        {/* Due date */}
        {task.dueDate && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 19, boxSizing: 'border-box', padding: '0 7px', borderRadius: 5, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(25,23,18,.1)', color: '#6C6553', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
            📅 {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
      quadrant: column.id === 'do' ? 'do' : null,
      company: (companies[0]?.id ?? 'teradix') as Task['company'],
      ...(companies[0] ? { companyId: companies[0].id } : {}),
      status: 'open',
      completed: false,
      ...(column.id !== 'inbox' && column.id !== 'do' ? { boardStatus: column.id } : {}),
    })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      onDragOver={onColDragOver}
      onDrop={() => onColDrop(column.id)}
    >
      {/* Column header — design spec: 8px status dot + label + count + add icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px', flexShrink: 0 }}>
        <span
          draggable
          onDragStart={() => onColDragStart(column.id)}
          onDragOver={onColDragOver}
          onDrop={() => onColDrop(column.id)}
          title="Drag to reorder"
          style={{ cursor: 'grab', color: '#CFC7B2', fontSize: 12, lineHeight: 1, userSelect: 'none', marginRight: 2, display: 'flex' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>
        </span>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#191712', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {column.label}
        </span>
        <span style={{ fontSize: 11, color: '#6C6553', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {column.tasks.length}
        </span>
        <div style={{ display: 'flex', gap: 6, color: '#6C6553' }}>
          <button onClick={() => setAdding(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit' }}>
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '4px 2px',
          minHeight: 80,
          background: isOver ? 'rgba(245,209,78,0.06)' : 'transparent',
          borderRadius: 10,
          transition: 'background 0.15s',
        }}
      >
        {column.tasks.length === 0 && !adding ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: '#8A8272', fontStyle: 'italic' }}>
            No tasks
          </div>
        ) : (
          <div style={{ padding: '2px 0' }}>
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
                background: '#F7F4EA', border: '1px solid #F5D14E',
                borderRadius: 6, padding: '6px 8px', fontSize: 12,
                color: '#191712', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
              <button onClick={commitAdd} style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, background: '#F5D14E', color: '#191712', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                Add
              </button>
              <button onClick={() => { setAdding(false); setNewTitle('') }} style={{ padding: '4px 8px', fontSize: 11, background: 'transparent', color: '#6C6553', border: '1px solid #E8E1CE', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
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
          background: 'transparent', border: '1px dashed #E8E1CE', borderRadius: 6,
          color: '#6C6553', cursor: 'pointer',
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
        background: '#FFFFFF', borderRadius: 14,
        padding: 24, width: 320, border: '1px solid #E8E1CE',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#191712', marginBottom: 6 }}>
          Plan this task
        </div>
        <div style={{ fontSize: 12, color: '#6C6553', marginBottom: 16, lineHeight: 1.5 }}>
          {taskTitle}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#6C6553', marginBottom: 6, fontWeight: 600 }}>
            Planned Date
          </div>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#F7F4EA',
              border: '1px solid #E8E1CE',
              borderRadius: 6, padding: '7px 10px',
              fontSize: 13, color: '#191712',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '7px 16px', borderRadius: 7, background: 'transparent',
            border: '1px solid #E8E1CE',
            color: '#6C6553', fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => date && onConfirm(date)} disabled={!date} style={{
            padding: '7px 18px', borderRadius: 7,
            background: 'rgba(245,209,78,0.15)',
            border: '1px solid rgba(245,209,78,0.5)',
            color: '#191712', fontSize: 12, fontWeight: 600,
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
      // A task with a dueDate but no explicit boardStatus is implicitly "planned"
      const isImplicitlyPlanned = (t: Task) =>
        hasPlannedStatus && !!t.dueDate && !t.boardStatus && t.quadrant !== 'do'

      const inboxCol: Column = {
        id:    'inbox',
        label: 'Inbox / Unplanned',
        color: '#6B7280',
        tasks: sortByUrgency(tasks.filter(t => !t.boardStatus && t.quadrant !== 'do' && !isImplicitlyPlanned(t))),
      }
      const doCol: Column = {
        id:    'do',
        label: '⚡ Do',
        color: '#EF4444',
        tasks: sortByUrgency(tasks.filter(t => !t.boardStatus && t.quadrant === 'do')),
      }
      const statusCols = sortCustomStatuses(customStatuses).map(s => ({
        id:    s.id,
        label: s.label,
        color: s.color,
        tasks: sortByUrgency(tasks.filter(t =>
          t.boardStatus === s.id || (s.id === 'planned' && isImplicitlyPlanned(t))
        )),
      }))
      return [inboxCol, doCol, ...statusCols]
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
        { id: 'today',       label: 'Today',      color: '#F5D14E' },
        { id: 'this-week',   label: 'This Week',  color: '#7F77DD' },
        { id: 'next-week',   label: 'Next Week',  color: '#9B9180' },
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
      if (columnId === 'inbox') {
        updateTask(taskId, { boardStatus: undefined, quadrant: null })
      } else if (columnId === 'do') {
        updateTask(taskId, { boardStatus: undefined, quadrant: 'do' })
      } else if (hasPlannedStatus && columnId === 'planned') {
        setPendingPlanTask({ taskId, title: task?.title ?? '' })
      } else {
        updateTask(taskId, { boardStatus: columnId })
      }
    } else if (boardType === 'company') {
      if (columnId === 'personal') {
        updateTask(taskId, { company: 'personal', companyId: undefined })
      } else {
        const co = companies.find(c => c.id === columnId)
        if (co) updateTask(taskId, { companyId: co.id, company: co.id as Task['company'] })
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
        borderBottom: '1px solid #E8E1CE', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6C6553', marginRight: 4, flexShrink: 0 }}>
          Group by:
        </span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {BOARD_TYPE_OPTIONS.map(opt => (
            <button key={opt.id} onClick={() => saveBoardType(opt.id)} style={{
              padding: '5px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: boardType === opt.id ? '#F5D14E' : 'transparent',
              color:      boardType === opt.id ? '#fff' : '#6C6553',
              border:     `1px solid ${boardType === opt.id ? '#F5D14E' : '#E8E1CE'}`,
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
