import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Check, GripVertical, Clock, Calendar, User } from 'lucide-react'
import type { Task } from '@/types'
import { COMPANY_COLORS, COMPANY_LABELS, getAllUsers } from '@/types'
import { useTaskStore } from '@/store/taskStore'

interface TaskCardProps {
  task: Task
}

export function TaskCard({ task }: TaskCardProps) {
  const { toggleComplete, deleteTask } = useTaskStore()
  const [hovered, setHovered] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
  }

  const companyColor = COMPANY_COLORS[task.company] ?? '#6B7280'

  // Resolve owner name
  const ownerUser = task.owner ? getAllUsers().find(u => u.id === task.owner) : undefined

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: hovered ? '#1a1f35' : '#161929',
        border: `1px solid ${isDragging ? '#1E40AF' : '#252A3E'}`,
        borderRadius: 8,
        padding: '9px 11px',
        cursor: isDragging ? 'grabbing' : 'default',
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
        <div {...listeners} {...attributes} style={{
          cursor: 'grab', color: hovered ? '#6B7280' : 'transparent',
          transition: 'color 0.15s', marginTop: 1, flexShrink: 0,
        }}>
          <GripVertical size={12} strokeWidth={2} />
        </div>

        {/* Checkbox */}
        <button onClick={() => toggleComplete(task.id)} style={{
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
          <p style={{
            margin: 0, fontSize: 12.5, fontWeight: 500, color: '#E8EAF6',
            lineHeight: 1.35, textDecoration: task.completed ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{task.title}</p>

          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 600, color: companyColor,
              background: `${companyColor}18`, padding: '1px 5px', borderRadius: 3,
            }}>{COMPANY_LABELS[task.company]}</span>

            {task.dueDate && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6B7280' }}>
                <Calendar size={9} /> {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}

            {task.plannedTime && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#7F77DD' }}>
                <Clock size={9} /> {task.plannedTime}
              </span>
            )}

            {task.duration && (
              <span style={{ fontSize: 10, color: '#6B7280' }}>{task.duration}m</span>
            )}

            {ownerUser && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#1D9E75' }}>
                <User size={9} /> {ownerUser.name}
              </span>
            )}
          </div>
        </div>

        {/* Delete */}
        {hovered && (
          <button onClick={() => deleteTask(task.id)} style={{
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
