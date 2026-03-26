import { useState } from 'react'
import { Plus, Trash2, X, Inbox, Check, Calendar, User, GripVertical } from 'lucide-react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { useTaskStore } from '@/store/taskStore'
import { getAllUsers, loadDynamicCompanies, COMPANY_COLORS, COMPANY_LABELS, type TaskStatus, type CompanyTag, type Task } from '@/types'

type Filter = 'all' | 'open' | 'done' | 'cancelled'

const inp: React.CSSProperties = {
  background: '#0D0F1A',
  border: '1px solid #252A3E',
  borderRadius: 6, padding: '5px 8px', fontSize: 12,
  color: '#E8EAF6', outline: 'none', width: '100%',
}
const sel: React.CSSProperties = { ...inp }

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: '#7F77DD', done: '#1D9E75', cancelled: '#6B7280',
}

// ─── Draggable card for inbox tasks ──────────────────────────────────────────

interface InboxCardProps {
  task: Task
  accentColor: string
  companyLabel: string
  taskStatus: TaskStatus
  ownerUser?: { name: string }
  onOpen: (id: string) => void
  onToggle: () => void
  onDelete: () => void
}

function DraggableInboxCard({ task, accentColor, companyLabel, taskStatus, ownerUser, onOpen, onToggle, onDelete }: InboxCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const [hovered, setHovered] = useState(false)

  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpen(task.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '9px 11px',
        background: isDragging ? '#252A3E' : '#0D0F1A',
        border: `1px solid ${hovered ? '#353A50' : '#252A3E'}`,
        borderRadius: 8,
        opacity: isDragging ? 0.4 : taskStatus === 'cancelled' ? 0.5 : taskStatus === 'done' ? 0.6 : 1,
        position: 'relative',
        cursor: isDragging ? 'grabbing' : 'pointer',
        transition: 'border-color 0.15s ease, background 0.15s ease',
      }}
    >
      {/* Left accent */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: accentColor, borderRadius: '8px 0 0 8px', opacity: 0.7,
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, paddingLeft: 4 }}>
        {/* Drag handle */}
        <div
          {...listeners} {...attributes}
          onClick={e => e.stopPropagation()}
          style={{ cursor: 'grab', color: hovered ? '#6B7280' : 'transparent', transition: 'color 0.15s', marginTop: 1, flexShrink: 0 }}
        >
          <GripVertical size={12} strokeWidth={2} />
        </div>

        {/* Checkbox */}
        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          style={{
            width: 15, height: 15, borderRadius: 4,
            border: `1.5px solid ${task.completed ? '#1D9E75' : '#252A3E'}`,
            background: task.completed ? '#1D9E75' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, marginTop: 1, transition: 'all 0.15s ease',
          }}
        >
          {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 12.5, fontWeight: 500, color: '#E8EAF6', lineHeight: 1.35,
            textDecoration: taskStatus === 'done' ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{task.title}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 600, color: accentColor,
              background: `${accentColor}18`, padding: '1px 5px', borderRadius: 3,
            }}>{companyLabel}</span>

            {task.dueDate && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6B7280' }}>
                <Calendar size={9} />
                {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}

            {ownerUser && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#1D9E75' }}>
                <User size={9} /> {ownerUser.name}
              </span>
            )}

            <span style={{
              marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
              background: STATUS_COLORS[taskStatus], flexShrink: 0,
            }} />
          </div>
        </div>

        {/* Delete */}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6B7280', padding: 2, borderRadius: 4,
            display: 'flex', alignItems: 'center', flexShrink: 0,
            opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
          }}
        >
          <Trash2 size={11} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface Props {
  onOpen: (id: string) => void
}

export function UndefinedTasksPanel({ onOpen }: Props) {
  const { tasks, addTask, deleteTask, toggleComplete } = useTaskStore()
  const [filter, setFilter] = useState<Filter>('open')
  const [adding, setAdding] = useState(false)

  // Form state
  const [title, setTitle]         = useState('')
  const [companyId, setCompanyId] = useState('')
  const [dueDate, setDueDate]     = useState('')
  const [owner, setOwner]         = useState('')
  const [duration, setDuration]   = useState('')
  const [status, setFormStatus]   = useState<TaskStatus>('open')

  const companies = loadDynamicCompanies()
  const users     = getAllUsers()

  const inbox = tasks.filter(t => t.quadrant === null)
  const filtered = filter === 'all'
    ? inbox
    : filter === 'done'
      ? inbox.filter(t => t.completed || t.status === 'done')
      : filter === 'open'
        ? inbox.filter(t => !t.completed && (t.status === 'open' || !t.status))
        : inbox.filter(t => t.status === filter)

  const counts: Record<Filter, number> = {
    all:       inbox.length,
    open:      inbox.filter(t => !t.completed && (t.status === 'open' || !t.status)).length,
    done:      inbox.filter(t => t.completed || t.status === 'done').length,
    cancelled: inbox.filter(t => t.status === 'cancelled').length,
  }

  function reset() {
    setTitle(''); setCompanyId(''); setDueDate(''); setOwner('')
    setDuration(''); setFormStatus('open'); setAdding(false)
  }

  function handleAdd() {
    if (!title.trim()) { reset(); return }
    addTask({
      title: title.trim(),
      quadrant: null,
      company: 'teradix',
      status,
      completed: status === 'done',
      ...(companyId && { companyId }),
      ...(dueDate   && { dueDate }),
      ...(owner     && { owner }),
      ...(duration  && { duration: parseInt(duration, 10) }),
    })
    reset()
  }

  const FILTERS: Filter[] = ['all', 'open', 'done', 'cancelled']

  // Drop zone — board cards can be dragged here to send back to inbox
  const { isOver: inboxOver, setNodeRef: setInboxRef } = useDroppable({ id: 'inbox' })

  return (
    <div style={{
      width: 300, flexShrink: 0,
      background: '#161929',
      border: '1px solid #252A3E',
      borderRadius: 12, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', maxHeight: 'calc(100vh - 160px)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #252A3E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Inbox size={14} color="#6B7280" />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#E8EAF6' }}>Inbox</span>
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, fontWeight: 600,
            color: '#6B7280', background: '#6B728018', padding: '1px 6px', borderRadius: 4,
          }}>{inbox.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
              cursor: 'pointer', textTransform: 'capitalize',
              background: filter === f ? '#1E40AF18' : 'transparent',
              border: `1px solid ${filter === f ? '#1E40AF50' : '#252A3E'}`,
              color: filter === f ? '#7F77DD' : '#6B7280',
            }}>
              {f} {counts[f] > 0 && <span style={{ opacity: 0.7 }}>({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Task list — also a drop zone for board cards */}
      <div
        ref={setInboxRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px',
          display: 'flex', flexDirection: 'column', gap: 5,
          background: inboxOver ? '#7F77DD08' : 'transparent',
          transition: 'background 0.15s ease',
        }}
      >
        {filtered.length === 0 && !adding && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 80, color: inboxOver ? '#7F77DD' : '#6B7280',
            fontSize: 12, fontStyle: 'italic',
            border: `1px dashed ${inboxOver ? '#7F77DD60' : '#252A3E'}`,
            borderRadius: 8, transition: 'all 0.15s ease',
          }}>
            {inboxOver ? 'Drop here to move to inbox' : 'No tasks'}
          </div>
        )}

        {filtered.map(t => {
          const co = companies.find(c => c.id === t.companyId)
          const ownerUser = t.owner ? users.find(u => u.id === t.owner) : undefined
          const taskStatus: TaskStatus = t.completed ? 'done' : (t.status ?? 'open')
          const accentColor = co?.color ?? COMPANY_COLORS[t.company] ?? '#6B7280'
          const companyLabel = co?.name ?? COMPANY_LABELS[t.company as CompanyTag] ?? t.company

          return (
            <DraggableInboxCard
              key={t.id}
              task={t}
              accentColor={accentColor}
              companyLabel={companyLabel}
              taskStatus={taskStatus}
              ownerUser={ownerUser}
              onOpen={onOpen}
              onToggle={() => toggleComplete(t.id)}
              onDelete={() => deleteTask(t.id)}
            />
          )
        })}
      </div>

      {/* Add form */}
      <div style={{ borderTop: '1px solid #252A3E', padding: '8px' }}>
        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') reset() }}
              placeholder="Task title…" style={inp} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Company</span>
                <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={sel}>
                  <option value="">—</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Due date</span>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={sel} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Owner</span>
                <select value={owner} onChange={e => setOwner(e.target.value)} style={sel}>
                  <option value="">—</option>
                  {(companyId
                    ? (companies.find(c => c.id === companyId)?.users ?? []).map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))
                    : users.map(u => (
                        <option key={u.id} value={u.id}>{u.name} · {u.companyName}</option>
                      ))
                  )}
                </select>
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Duration (min)</span>
                <input type="number" min={5} step={5} value={duration}
                  onChange={e => setDuration(e.target.value)} placeholder="60" style={sel} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Status</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {(['open', 'done', 'cancelled'] as TaskStatus[]).map(s => (
                    <button key={s} onClick={() => setFormStatus(s)} style={{
                      flex: 1, padding: '4px', borderRadius: 5, fontSize: 11, fontWeight: 500,
                      cursor: 'pointer', textTransform: 'capitalize',
                      background: status === s ? STATUS_COLORS[s] + '22' : 'transparent',
                      border: `1px solid ${status === s ? STATUS_COLORS[s] + '80' : '#252A3E'}`,
                      color: status === s ? STATUS_COLORS[s] : '#6B7280',
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleAdd} disabled={!title.trim()} style={{
                flex: 1, padding: '6px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: '#1E40AF18', border: '1px solid #1E40AF50',
                color: '#7F77DD', cursor: title.trim() ? 'pointer' : 'not-allowed',
                opacity: title.trim() ? 1 : 0.4,
              }}>Add Task</button>
              <button onClick={reset} style={{
                padding: '6px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid #252A3E',
                color: '#6B7280', cursor: 'pointer', fontSize: 12,
              }}><X size={12} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            width: '100%', background: 'transparent', border: '1px dashed #252A3E',
            borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            color: '#6B7280', fontSize: 12, padding: '7px 10px',
          }}>
            <Plus size={12} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}
