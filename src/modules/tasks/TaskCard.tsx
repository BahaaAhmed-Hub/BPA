import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Check, GripVertical } from 'lucide-react'
import type { Task } from '@/types'
import { COMPANY_COLORS, COMPANY_LABELS } from '@/types'
import { useTaskStore } from '@/store/taskStore'

interface TaskCardProps {
  task: Task
}

export function TaskCard({ task }: TaskCardProps) {
  const { toggleComplete, deleteTask } = useTaskStore()
  const [hovered, setHovered] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto',
  }

  const companyColor = COMPANY_COLORS[task.company]

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: hovered ? '#2e261c' : '#161929',
        border: `1px solid ${isDragging ? '#7C3AED' : '#252A3E'}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: isDragging ? 'grabbing' : 'default',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        position: 'relative',
        opacity: task.completed ? 0.5 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: companyColor,
          borderRadius: '8px 0 0 8px',
          opacity: 0.7,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingLeft: 4 }}>
        {/* Drag handle */}
        <div
          {...listeners}
          {...attributes}
          style={{
            cursor: 'grab',
            color: hovered ? '#6B7280' : 'transparent',
            transition: 'color 0.15s',
            marginTop: 1,
            flexShrink: 0,
          }}
        >
          <GripVertical size={13} strokeWidth={2} />
        </div>

        {/* Checkbox */}
        <button
          onClick={() => toggleComplete(task.id)}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: `1.5px solid ${task.completed ? '#1D9E75' : '#252A3E'}`,
            background: task.completed ? '#1D9E75' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            marginTop: 1,
            transition: 'all 0.15s ease',
          }}
        >
          {task.completed && <Check size={10} color="#fff" strokeWidth={3} />}
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 500,
              color: '#E8EAF6',
              lineHeight: 1.35,
              textDecoration: task.completed ? 'line-through' : 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {task.title}
          </p>
          {task.description && (
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 11.5,
                color: '#6B7280',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {task.description}
            </p>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: companyColor,
                background: `${companyColor}18`,
                padding: '1px 6px',
                borderRadius: 3,
                letterSpacing: '0.2px',
              }}
            >
              {COMPANY_LABELS[task.company]}
            </span>
            {task.dueDate && (
              <span style={{ fontSize: 10.5, color: '#6B7280' }}>
                {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* Delete */}
        {hovered && (
          <button
            onClick={() => deleteTask(task.id)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#6B7280',
              padding: 2,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Trash2 size={12} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
