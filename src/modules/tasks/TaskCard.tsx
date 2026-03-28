import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Check, GripVertical, Clock, Calendar, User, Plus } from 'lucide-react'
import type { Task } from '@/types'
import { COMPANY_COLORS, getAllUsers, loadDynamicCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'

interface TaskCardProps {
  task: Task
  onOpen: (id: string) => void
}

export function TaskCard({ task, onOpen }: TaskCardProps) {
  const { toggleComplete, deleteTask, updateTask } = useTaskStore()
  const [hovered, setHovered] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [editingDate, setEditingDate] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [editingDuration, setEditingDuration] = useState(false)
  const [editingOwner, setEditingOwner] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
  }

  const companies    = loadDynamicCompanies()
  const dynCompany   = companies.find(c => c.id === task.companyId)
  const companyColor = dynCompany?.color ?? COMPANY_COLORS[task.company] ?? '#6B7280'
  const ownerUser = task.owner ? getAllUsers().find(u => u.id === task.owner) : undefined
  const users = getAllUsers()

  const isSchedule = task.quadrant === 'schedule'
  const isDelegate = task.quadrant === 'delegate'

  function saveTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed })
    else setTitleDraft(task.title)
    setEditingTitle(false)
  }

  // Clicking the card background opens the modal.
  // Interactive child elements stop propagation via data-nm attribute check.
  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nm]')) return
    onOpen(task.id)
  }

  const fieldInput: React.CSSProperties = {
    background: '#0D0F1A', border: '1px solid #353A50', borderRadius: 4,
    color: '#E8EAF6', fontSize: 10, padding: '1px 5px', outline: 'none',
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleCardClick}
      style={{
        ...style,
        background: hovered ? '#1a1f35' : '#161929',
        border: `1px solid ${isDragging ? '#1E40AF' : '#252A3E'}`,
        borderRadius: 8,
        padding: '9px 11px',
        cursor: isDragging ? 'grabbing' : 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        position: 'relative',
        opacity: task.completed ? 0.5 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left accent */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: companyColor, borderRadius: '8px 0 0 8px', opacity: 0.7,
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, paddingLeft: 4 }}>
        {/* Drag handle */}
        <div data-nm {...listeners} {...attributes} style={{
          cursor: 'grab', color: hovered ? '#6B7280' : 'transparent',
          transition: 'color 0.15s', marginTop: 1, flexShrink: 0,
        }}>
          <GripVertical size={12} strokeWidth={2} />
        </div>

        {/* Checkbox */}
        <button data-nm onClick={() => toggleComplete(task.id)} style={{
          width: 15, height: 15, borderRadius: 4,
          border: `1.5px solid ${task.completed ? '#1D9E75' : '#252A3E'}`,
          background: task.completed ? '#1D9E75' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, marginTop: 1, transition: 'all 0.15s ease',
        }}>
          {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title – click to edit */}
          {editingTitle ? (
            <input
              data-nm
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') saveTitle()
                if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false) }
              }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: '1px solid #7F77DD', outline: 'none',
                color: '#E8EAF6', fontSize: 12.5, fontWeight: 500,
                width: '100%', padding: 0, fontFamily: 'inherit', lineHeight: 1.35,
              }}
            />
          ) : (
            <p
              data-nm
              onClick={() => { if (!task.completed) setEditingTitle(true) }}
              title={task.completed ? undefined : 'Click to rename'}
              style={{
                margin: 0, fontSize: 12.5, fontWeight: 500, color: '#E8EAF6',
                lineHeight: 1.35, textDecoration: task.completed ? 'line-through' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                cursor: task.completed ? 'default' : 'text',
              }}
            >{task.title}</p>
          )}

          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>

            {/* Company */}
            <select
              data-nm
              value={task.companyId ?? task.company}
              onChange={e => {
                const co = companies.find(c => c.id === e.target.value)
                updateTask(task.id, { companyId: e.target.value, company: (co?.id as Task['company']) ?? task.company })
              }}
              title="Change company"
              style={{
                fontSize: 10, fontWeight: 600,
                color: companyColor, background: `${companyColor}18`,
                padding: '1px 5px', borderRadius: 3,
                border: 'none', outline: 'none', cursor: 'pointer',
                appearance: 'none', WebkitAppearance: 'none', fontFamily: 'inherit',
              }}
            >
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Due date */}
            {(task.dueDate || isSchedule) && (
              editingDate ? (
                <input
                  data-nm type="date" autoFocus value={task.dueDate ?? ''}
                  onChange={e => updateTask(task.id, { dueDate: e.target.value || undefined })}
                  onBlur={() => setEditingDate(false)}
                  onKeyDown={e => e.key === 'Escape' && setEditingDate(false)}
                  style={fieldInput}
                />
              ) : (
                <span
                  data-nm onClick={() => setEditingDate(true)} title="Set due date"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: task.dueDate ? '#6B7280' : '#404560', cursor: 'pointer' }}
                >
                  <Calendar size={9} />
                  {task.dueDate
                    ? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : <Plus size={8} />
                  }
                </span>
              )
            )}

            {/* Planned time */}
            {(task.plannedTime || isSchedule) && (
              editingTime ? (
                <input
                  data-nm type="time" autoFocus value={task.plannedTime ?? ''}
                  onChange={e => updateTask(task.id, { plannedTime: e.target.value || undefined })}
                  onBlur={() => setEditingTime(false)}
                  onKeyDown={e => e.key === 'Escape' && setEditingTime(false)}
                  style={{ ...fieldInput, color: '#7F77DD' }}
                />
              ) : (
                <span
                  data-nm onClick={() => setEditingTime(true)} title="Set planned time"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: task.plannedTime ? '#7F77DD' : '#404560', cursor: 'pointer' }}
                >
                  <Clock size={9} />
                  {task.plannedTime ?? <Plus size={8} />}
                </span>
              )
            )}

            {/* Duration */}
            {(task.duration || isSchedule) && (
              editingDuration ? (
                <input
                  data-nm type="number" autoFocus min={5} step={5} value={task.duration ?? ''}
                  onChange={e => updateTask(task.id, { duration: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                  onBlur={() => setEditingDuration(false)}
                  onKeyDown={e => e.key === 'Escape' && setEditingDuration(false)}
                  style={{ ...fieldInput, width: 52 }} placeholder="min"
                />
              ) : (
                <span
                  data-nm onClick={() => setEditingDuration(true)} title="Set duration"
                  style={{ fontSize: 10, color: task.duration ? '#6B7280' : '#404560', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}
                >
                  {task.duration ? `${task.duration}m` : <><Plus size={8} />m</>}
                </span>
              )
            )}

            {/* Owner */}
            {(task.owner || isDelegate) && (
              editingOwner ? (
                <select
                  data-nm autoFocus value={task.owner ?? ''}
                  onChange={e => { updateTask(task.id, { owner: e.target.value || undefined }); setEditingOwner(false) }}
                  onBlur={() => setEditingOwner(false)}
                  style={fieldInput}
                >
                  <option value="">— none —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : (
                <span
                  data-nm onClick={() => setEditingOwner(true)} title="Assign owner"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: ownerUser ? '#1D9E75' : '#404560', cursor: 'pointer' }}
                >
                  <User size={9} />
                  {ownerUser ? ownerUser.name : <Plus size={8} />}
                </span>
              )
            )}
          </div>
        </div>

        {/* Delete */}
        {hovered && (
          <button data-nm onClick={() => deleteTask(task.id)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6B7280', padding: 2, borderRadius: 4,
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}>
            <Trash2 size={11} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
