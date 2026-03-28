import { useState } from 'react'
import {
  DndContext, DragOverlay, closestCorners,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { TopBar } from '@/components/layout/TopBar'
import { EisenhowerBoard } from './EisenhowerBoard'
import { UndefinedTasksPanel } from './UndefinedTasksPanel'
import { TaskDetailModal } from './TaskDetailModal'
import { TaskCard } from './TaskCard'
import { useTaskStore } from '@/store/taskStore'
import { CheckSquare, Zap } from 'lucide-react'
import type { Quadrant } from '@/types'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']

export function TaskCommand() {
  const { tasks, moveTask, reorderInbox, reorderQuadrant } = useTaskStore()
  const active = tasks.filter(t => t.quadrant !== null && !t.completed)
  const urgent = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const inbox  = tasks.filter(t => t.quadrant === null && t.status !== 'done' && t.status !== 'cancelled' && !t.completed)

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [modalTaskId,  setModalTaskId]  = useState<string | null>(null)

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) ?? null : null
  const modalTask  = modalTaskId  ? tasks.find(t => t.id === modalTaskId)  ?? null : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart({ active }: DragStartEvent) {
    setActiveTaskId(active.id as string)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTaskId(null)
    if (!over) return

    const taskId = active.id as string
    const overId = over.id as string

    if (overId === 'inbox') {
      moveTask(taskId, null)
    } else if (QUADRANTS.includes(overId as Quadrant)) {
      moveTask(taskId, overId as Quadrant)
    } else {
      // over is another task
      const dragged = tasks.find(t => t.id === taskId)
      const target  = tasks.find(t => t.id === overId)
      if (!target) return
      if (dragged?.quadrant === null && target.quadrant === null) {
        // Both inbox — reorder within inbox
        reorderInbox(taskId, overId)
      } else if (dragged?.quadrant !== null && dragged?.quadrant === target.quadrant) {
        // Same quadrant — reorder within quadrant
        reorderQuadrant(taskId, overId)
      } else {
        // Different quadrant/inbox — move task
        moveTask(taskId, target.quadrant)
      }
    }
  }

  return (
    <div>
      <TopBar
        title="Task Command"
        subtitle="Eisenhower Matrix — ruthless prioritization for maximum leverage."
      />

      {/* Stats bar */}
      <div style={{
        padding: '12px 28px', borderBottom: '1px solid #252A3E',
        display: 'flex', gap: 18, alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckSquare size={13} color="#1E40AF" strokeWidth={2} />
          <span style={{ fontSize: 12.5, color: '#E8EAF6' }}>
            <span style={{ fontWeight: 600 }}>{active.length}</span> active
          </span>
        </div>
        <div style={{ width: 1, height: 14, background: '#252A3E' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={13} color="#E05252" strokeWidth={2} />
          <span style={{ fontSize: 12.5, color: '#E8EAF6' }}>
            <span style={{ fontWeight: 600 }}>{urgent.length}</span> urgent
          </span>
        </div>
        {inbox.length > 0 && (
          <>
            <div style={{ width: 1, height: 14, background: '#252A3E' }} />
            <span style={{ fontSize: 12.5, color: '#6B7280' }}>
              <span style={{ fontWeight: 600, color: '#E8EAF6' }}>{inbox.length}</span> unassigned
            </span>
          </>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: '#6B7280', fontStyle: 'italic' }}>
          Drag tasks between quadrants & inbox · click any card to view details
        </div>
      </div>

      {/* Board + inbox — all inside one DndContext */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div style={{ display: 'flex', gap: 14, padding: '18px 28px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EisenhowerBoard onOpen={setModalTaskId} />
          </div>
          <UndefinedTasksPanel onOpen={setModalTaskId} />
        </div>

        <DragOverlay>
          {activeTask && (
            <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
              <TaskCard task={activeTask} onOpen={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Detail modal */}
      {modalTask && (
        <TaskDetailModal task={modalTask} onClose={() => setModalTaskId(null)} />
      )}
    </div>
  )
}
