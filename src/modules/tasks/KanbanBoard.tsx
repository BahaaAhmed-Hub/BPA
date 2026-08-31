import { useState, useMemo, useRef, useEffect } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { Plus, X as XIcon, MoreHorizontal, ChevronDown } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import type { Task, TaskType } from '@/types'
import {
  TASK_TYPE_META, inferTaskType,
  loadVisibleCompanies, getAllUsers, isTaskHidden,
} from '@/types'
import { loadCustomStatuses, sortCustomStatuses } from '@/lib/customStatuses'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { TaskCard } from './TaskCard'
import { sortUrgentFirst } from './taskVisuals'
import { CountBadge } from './controls'

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

// ── Card ─────────────────────────────────────────────────────────────────────

// ── Column ───────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  column: Column
  onOpen: (id: string) => void
  onColDragStart: (id: string) => void
  onColDragOver: (e: React.DragEvent) => void
  onColDrop: (id: string) => void
  boardType: BoardType
  onBoardType: (t: BoardType) => void
}

/** A long column shows a few cards and a "N more" expander, as Done does in 9B. */
const COLLAPSE_AFTER = 6
const COLLAPSED_VISIBLE = 3

function KanbanColumnComp({ column, onOpen, onColDragStart, onColDragOver, onColDrop, boardType, onBoardType }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const addTask = useTaskStore(s => s.addTask)
  const companies = loadVisibleCompanies()
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const collapsible = column.tasks.length > COLLAPSE_AFTER && !expanded
  const visibleTasks = collapsible ? column.tasks.slice(0, COLLAPSED_VISIBLE) : column.tasks
  const hiddenCount = column.tasks.length - visibleTasks.length

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
    <div style={{ flex: '1 1 0', minWidth: 208, maxWidth: 300, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      onDragOver={onColDragOver}
      onDrop={() => onColDrop(column.id)}
    >
      {/* Column header — dot · label · count, then + and ··· (9B) */}
      <div
        draggable
        onDragStart={() => onColDragStart(column.id)}
        onDragOver={onColDragOver}
        onDrop={() => onColDrop(column.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 4px 10px', flexShrink: 0, cursor: 'grab' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#191712', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {column.label}
        </span>
        <CountBadge value={column.tasks.length} />
        <span style={{ flex: 1 }} />
        <button onClick={() => setAdding(true)} title="Add a task here"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#9B9180' }}>
          <Plus size={15} strokeWidth={2} />
        </button>
        <div style={{ position: 'relative', display: 'flex' }} ref={menuRef}>
          <button onClick={() => setMenuOpen(o => !o)} title="Column options"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#9B9180' }}>
            <MoreHorizontal size={15} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, width: 190,
              background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, padding: 6,
              boxShadow: '0 20px 44px -20px rgba(25,23,18,.42)',
            }}>
              <p style={{ margin: 0, padding: '7px 9px 5px', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#9B9180' }}>BOARD COLUMNS</p>
              {BOARD_TYPE_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => { onBoardType(opt.id); setMenuOpen(false) }} style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 9px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: boardType === opt.id ? '#FEF7DE' : 'transparent',
                  color: '#191712', fontSize: 12.5, fontWeight: boardType === opt.id ? 600 : 500,
                }}>{opt.label}</button>
              ))}
            </div>
          )}
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
          <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: '#B5AC98' }}>
            No tasks
          </div>
        ) : (
          <SortableContext items={visibleTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleTasks.map(task => (
                <TaskCard key={task.id} task={task} onOpen={onOpen} />
              ))}
            </div>
          </SortableContext>
        )}

        {hiddenCount > 0 && (
          <button onClick={() => setExpanded(true)} style={{
            width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, color: '#6C6553', padding: '4px 0',
          }}>
            {hiddenCount} more <ChevronDown size={13} strokeWidth={2} />
          </button>
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
          marginTop: 10, width: '100%', padding: '13px 0', fontSize: 12.5, fontWeight: 500,
          background: 'transparent', border: '1px dashed #DED5BF', borderRadius: 12,
          color: '#9B9180', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'all 0.12s',
        }}
      >
        <Plus size={13} /> Add task
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
      // 9B has no Inbox or Do column — the board is the status columns alone.
      // Uncategorised work falls into the first one, which is where you decide.
      const ordered = sortCustomStatuses(customStatuses)
      const known = new Set(ordered.map(s => s.id))
      const firstId = ordered[0]?.id
      return ordered.map(st => ({
        id:    st.id,
        label: st.label,
        color: st.color,
        tasks: sortUrgentFirst(tasks.filter(t =>
          t.boardStatus === st.id ||
          (st.id === firstId && (!t.boardStatus || !known.has(t.boardStatus)))
        )),
      }))
    }

    if (boardType === 'company') {
      const cols: Column[] = companies.map(co => ({
        id:    co.id,
        label: co.name,
        color: co.color,
        tasks: sortUrgentFirst(tasks.filter(t =>
          t.companyId === co.id ||
          (!t.companyId && t.company?.toLowerCase() === co.name.toLowerCase())
        )),
      }))
      const assigned = new Set(cols.flatMap(c => c.tasks.map(t => t.id)))
      cols.push({
        id:    'personal',
        label: 'Personal',
        color: '#888780',
        tasks: sortUrgentFirst(tasks.filter(t => !assigned.has(t.id))),
      })
      return cols
    }

    if (boardType === 'owner') {
      // Show ALL users from all companies, not just those with tasks
      const cols: Column[] = allUsers.map(u => ({
        id:    u.id,
        label: u.name,
        color: '#7F77DD',
        tasks: sortUrgentFirst(tasks.filter(t => t.owner === u.id)),
      }))
      cols.push({
        id:    'unassigned',
        label: 'Unassigned',
        color: '#6B7280',
        tasks: sortUrgentFirst(tasks.filter(t => !t.owner)),
      })
      return cols
    }

    if (boardType === 'type') {
      return (Object.keys(TASK_TYPE_META) as TaskType[]).map(type => ({
        id:    type,
        label: `${TASK_TYPE_META[type].emoji} ${TASK_TYPE_META[type].label}`,
        color: TASK_TYPE_META[type].color,
        tasks: sortUrgentFirst(tasks.filter(t => (t.taskType ?? inferTaskType(t.title)) === type)),
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
        tasks: sortUrgentFirst(tasks.filter(t => getScheduledBucket(t.dueDate) === b.id)),
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
    const taskId = active.id as string
    const overId = over.id as string
    // Cards are sortable now, so a drop can land on a sibling card rather than
    // on the column itself — resolve it back to the column that holds it.
    const columnId = columns.some(c => c.id === overId)
      ? overId
      : columns.find(c => c.tasks.some(t => t.id === overId))?.id
    if (!columnId || taskId === overId) return
    const task = tasks.find(t => t.id === taskId)

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

      {/* Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{
          display: 'flex', gap: 18, padding: '4px 28px 28px',
          overflowX: 'auto', overflowY: 'hidden',
          flex: 1, alignItems: 'flex-start',
        }}>
          {orderedColumns.map(col => (
            <KanbanColumnComp key={col.id} column={col} onOpen={onOpen}
              onColDragStart={handleColDragStart}
              onColDragOver={handleColDragOver}
              onColDrop={handleColDrop}
              boardType={boardType}
              onBoardType={saveBoardType}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask && (
            <div style={{ width: 268, transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 12px 28px rgba(25,23,18,0.28))' }}>
              <TaskCard task={activeTask} onOpen={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
