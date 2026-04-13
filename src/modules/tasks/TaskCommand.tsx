import { useState, useEffect, useRef } from 'react'
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
import { CheckSquare, Zap, SlidersHorizontal } from 'lucide-react'
import type { Quadrant } from '@/types'
import { scheduleTaskToCalendar } from '@/lib/aiScheduler'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']
const TASKS_CONFIG_KEY = 'task-command-config'

function loadTaskConfig(): { hideCompleted: boolean } {
  try { return JSON.parse(localStorage.getItem(TASKS_CONFIG_KEY) ?? '{}') } catch { return { hideCompleted: false } }
}

export function TaskCommand() {
  const { tasks, moveTask, reorderInbox, reorderQuadrant, updateTask } = useTaskStore()

  const [cfg, setCfg] = useState(loadTaskConfig)
  const [configOpen, setConfigOpen] = useState(false)
  const configRef = useRef<HTMLDivElement>(null)

  const hideCompleted = cfg.hideCompleted ?? false

  function setHideCompleted(val: boolean) {
    const next = { ...cfg, hideCompleted: val }
    setCfg(next)
    localStorage.setItem(TASKS_CONFIG_KEY, JSON.stringify(next))
  }

  // Close popup on outside click
  useEffect(() => {
    if (!configOpen) return
    const handler = (e: MouseEvent) => {
      if (configRef.current && !configRef.current.contains(e.target as Node)) setConfigOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [configOpen])

  const active = tasks.filter(t => t.quadrant !== null && !t.completed)
  const urgent = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const inbox  = tasks.filter(t => t.quadrant === null && t.status !== 'done' && t.status !== 'cancelled' && !t.completed)

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [modalTaskId,  setModalTaskId]  = useState<string | null>(null)

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) ?? null : null
  const modalTask  = modalTaskId  ? tasks.find(t => t.id === modalTaskId)  ?? null : null

  // Auto-schedule tasks that enter the 'schedule' quadrant with a dueDate
  const schedulingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const candidates = tasks.filter(
      t => t.quadrant === 'schedule' && t.dueDate && !t.gcalEventId && !schedulingRef.current.has(t.id)
    )
    for (const task of candidates) {
      schedulingRef.current.add(task.id)
      scheduleTaskToCalendar(task)
        .then(res => {
          if (res.success && res.gcalEventId) {
            updateTask(task.id, { gcalEventId: res.gcalEventId })
          }
        })
        .catch(() => { /* offline or no auth */ })
        .finally(() => schedulingRef.current.delete(task.id))
    }
  }, [tasks, updateTask])

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
        reorderInbox(taskId, overId)
      } else if (dragged?.quadrant !== null && dragged?.quadrant === target.quadrant) {
        reorderQuadrant(taskId, overId)
      } else {
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
        padding: '12px 28px', borderBottom: '1px solid var(--color-border, #252A3E)',
        display: 'flex', gap: 18, alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckSquare size={13} color="#1E40AF" strokeWidth={2} />
          <span style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)' }}>
            <span style={{ fontWeight: 600 }}>{active.length}</span> active
          </span>
        </div>
        <div style={{ width: 1, height: 14, background: 'var(--color-border, #252A3E)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={13} color="#E05252" strokeWidth={2} />
          <span style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)' }}>
            <span style={{ fontWeight: 600 }}>{urgent.length}</span> urgent
          </span>
        </div>
        {inbox.length > 0 && (
          <>
            <div style={{ width: 1, height: 14, background: 'var(--color-border, #252A3E)' }} />
            <span style={{ fontSize: 12.5, color: '#6B7280' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>{inbox.length}</span> unassigned
            </span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: '#6B7280', fontStyle: 'italic' }}>
            Drag tasks between quadrants & inbox · click any card to view details
          </span>

          {/* Config button */}
          <div ref={configRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setConfigOpen(o => !o)}
              title="Task settings"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
                background: configOpen ? 'rgba(127,119,221,0.12)' : 'transparent',
                border: `1px solid ${configOpen ? '#7F77DD40' : 'var(--color-border, #252A3E)'}`,
                color: configOpen ? '#7F77DD' : '#6B7280',
                transition: 'all 0.12s',
              }}
            >
              <SlidersHorizontal size={13} />
            </button>

            {/* Config popup */}
            {configOpen && (
              <div style={{
                position: 'absolute', top: 34, right: 0, zIndex: 100,
                background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)',
                borderRadius: 10, padding: '12px 14px', minWidth: 220,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  Task Display
                </p>

                {/* Hide completed toggle */}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#C0C4D6' }}>Hide completed tasks</span>
                  <div
                    onClick={() => setHideCompleted(!hideCompleted)}
                    style={{
                      width: 36, height: 20, borderRadius: 10, flexShrink: 0,
                      background: hideCompleted ? '#7F77DD' : 'var(--color-border, #252A3E)',
                      position: 'relative', cursor: 'pointer', transition: 'background 0.15s',
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 3, left: hideCompleted ? 19 : 3,
                      width: 14, height: 14, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.15s',
                    }} />
                  </div>
                </label>
              </div>
            )}
          </div>
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
            <EisenhowerBoard onOpen={setModalTaskId} hideCompleted={hideCompleted} />
          </div>
          <UndefinedTasksPanel onOpen={setModalTaskId} hideCompleted={hideCompleted} />
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
