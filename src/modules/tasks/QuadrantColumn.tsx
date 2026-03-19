import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { TaskCard } from './TaskCard'
import type { Task, Quadrant } from '@/types'
import { QUADRANT_META } from '@/types'
import { useTaskStore } from '@/store/taskStore'

interface QuadrantColumnProps {
  quadrant: Quadrant
  tasks: Task[]
}

export function QuadrantColumn({ quadrant, tasks }: QuadrantColumnProps) {
  const meta = QUADRANT_META[quadrant]
  const { isOver, setNodeRef } = useDroppable({ id: quadrant })
  const addTask = useTaskStore(s => s.addTask)

  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  function handleAdd() {
    if (!newTitle.trim()) { setAdding(false); return }
    addTask({
      title: newTitle.trim(),
      quadrant,
      company: 'teradix',
      completed: false,
    })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: '#2A2218',
        border: `1px solid ${isOver ? meta.color + '60' : '#3A3020'}`,
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'border-color 0.15s ease',
        minHeight: 300,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid #3A3020',
          background: isOver ? `${meta.color}08` : 'transparent',
          transition: 'background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: meta.color,
              flexShrink: 0,
            }}
          />
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              color: '#F0E8D8',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              letterSpacing: '-0.2px',
            }}
          >
            {meta.label}
          </h3>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 600,
              color: meta.color,
              background: `${meta.color}18`,
              padding: '2px 7px',
              borderRadius: 4,
            }}
          >
            {tasks.length}
          </span>
        </div>
        <p style={{ margin: '3px 0 0 16px', fontSize: 11, color: '#8A7A60' }}>
          {meta.sub}
        </p>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          padding: '10px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minHeight: 120,
        }}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>

        {/* Empty state */}
        {tasks.length === 0 && !adding && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8A7A60',
              fontSize: 12,
              fontStyle: 'italic',
              opacity: isOver ? 0 : 0.6,
              border: `1px dashed ${isOver ? meta.color : '#3A3020'}`,
              borderRadius: 8,
              minHeight: 80,
              transition: 'all 0.15s ease',
            }}
          >
            {isOver ? '' : 'Drop tasks here'}
          </div>
        )}
      </div>

      {/* Add task */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid #3A3020' }}>
        {adding ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
              }}
              onBlur={handleAdd}
              placeholder="Task title..."
              style={{
                flex: 1,
                background: '#1C1814',
                border: '1px solid #3A3020',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12.5,
                color: '#F0E8D8',
                outline: 'none',
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              color: '#8A7A60',
              fontSize: 12,
              padding: '4px 4px',
              borderRadius: 6,
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#C49A3C' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8A7A60' }}
          >
            <Plus size={12} strokeWidth={2.5} />
            Add task
          </button>
        )}
      </div>
    </div>
  )
}
