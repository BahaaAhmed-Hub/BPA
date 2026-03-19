import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { QuadrantColumn } from './QuadrantColumn'
import { TaskCard } from './TaskCard'
import { useTaskStore } from '@/store/taskStore'
import type { Quadrant } from '@/types'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']

export function EisenhowerBoard() {
  const { tasks, moveTask } = useTaskStore()
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) ?? null : null

  function handleDragStart({ active }: DragStartEvent) {
    setActiveTaskId(active.id as string)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTaskId(null)
    if (!over) return

    const taskId = active.id as string
    const overId = over.id as string

    // over could be a quadrant id or a task id
    const targetQuadrant = QUADRANTS.includes(overId as Quadrant)
      ? (overId as Quadrant)
      : tasks.find(t => t.id === overId)?.quadrant

    if (targetQuadrant) {
      moveTask(taskId, targetQuadrant)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          padding: '0',
        }}
      >
        {QUADRANTS.map(q => (
          <QuadrantColumn
            key={q}
            quadrant={q}
            tasks={tasks.filter(t => t.quadrant === q)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask && (
          <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
            <TaskCard task={activeTask} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
