import { useState, useRef, useMemo } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { X, Plus, RefreshCw, Check } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'
import { isTaskHidden } from '@/types'

const HOUR_PX = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const PRIORITY_ORDER = { do: 0, schedule: 1, delegate: 2, eliminate: 3 }
const PRIORITY_LABEL: Record<string, string> = { do: 'P0', schedule: 'P1', delegate: 'P2', eliminate: 'P3' }
const PRIORITY_COLOR: Record<string, string> = { do: '#EF4444', schedule: '#F59E0B', delegate: '#3B82F6', eliminate: '#6B7280' }

interface ScheduledBlock {
  taskId: string
  startHour: number
  durationHours: number
}

// ── Draggable Task Card (right panel) ─────────────────────────────────────────

function DraggableTaskCard({ task, scheduled }: { task: Task; scheduled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const priority = task.quadrant ? PRIORITY_LABEL[task.quadrant] : null
  const color    = task.quadrant ? PRIORITY_COLOR[task.quadrant] : '#6B7280'
  const dot      = task.urgent ? '#F59E0B' : (task.quadrant === 'do' ? '#EF4444' : '#6B7280')

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : scheduled ? 0.5 : 1,
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        cursor: 'grab',
        boxShadow: isDragging ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
        userSelect: 'none',
      }}
      {...attributes} {...listeners}
    >
      <span style={{ color: '#9CA3AF', fontSize: 14, marginTop: 1, flexShrink: 0 }}>⠿</span>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 4, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
          {priority && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: `${color}15`, color }}>
              {priority}
            </span>
          )}
          {task.duration && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#F3F4F6', color: '#6B7280' }}>
              {task.duration}m
            </span>
          )}
          {scheduled && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#D1FAE5', color: '#10B981' }}>
              Scheduled
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Droppable Hour Slot ──────────────────────────────────────────────────────

function HourSlot({ hour, block, taskTitle, onRemove }: {
  hour: number
  block?: ScheduledBlock
  taskTitle?: string
  onRemove?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${hour}` })
  const hLabel = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`
  const blocked = hour < 6 || hour >= 22  // sleeping / blocked hours

  return (
    <div ref={setNodeRef} style={{
      display: 'flex',
      height: HOUR_PX,
      borderBottom: '1px solid #F3F4F6',
      background: isOver ? 'rgba(249,115,22,0.05)' : 'transparent',
      transition: 'background 0.12s',
      position: 'relative',
    }}>
      {/* Time label */}
      <div style={{ width: 56, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 6, paddingRight: 10, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>{hLabel}</span>
      </div>
      {/* Slot area */}
      <div style={{ flex: 1, position: 'relative', borderLeft: '1px solid #F3F4F6' }}>
        {blocked && !block && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 16, opacity: 0.25 }}>🚫</span>
          </div>
        )}
        {block && (
          <div style={{
            position: 'absolute',
            top: 2, left: 6, right: 6,
            bottom: 2,
            background: 'linear-gradient(135deg, #F97316, #FB923C)',
            borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 8px',
            boxShadow: '0 2px 6px rgba(249,115,22,0.25)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {taskTitle}
            </span>
            {onRemove && (
              <button onClick={onRemove} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 3, cursor: 'pointer', color: '#fff', padding: '1px 4px', fontSize: 10, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface SmartDayPlannerProps {
  onClose: () => void
}

export function SmartDayPlanner({ onClose }: SmartDayPlannerProps) {
  const { tasks: allTasks } = useTaskStore()
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [includeBreaks, setIncludeBreaks] = useState(true)
  const [sortBy, setSortBy] = useState<'priority' | 'created'>('priority')
  const timelineRef = useRef<HTMLDivElement>(null)

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const tasks = allTasks.filter(t => !isTaskHidden(t) && !t.completed && t.status !== 'done')

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (sortBy === 'priority') {
        const ap = a.quadrant ? PRIORITY_ORDER[a.quadrant as keyof typeof PRIORITY_ORDER] ?? 4 : 4
        const bp = b.quadrant ? PRIORITY_ORDER[b.quadrant as keyof typeof PRIORITY_ORDER] ?? 4 : 4
        return ap - bp
      }
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [tasks, sortBy])

  const scheduledTaskIds = new Set(blocks.map(b => b.taskId))
  const unscheduledCount = tasks.filter(t => !scheduledTaskIds.has(t.id)).length

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart({ active }: DragStartEvent) { setActiveId(active.id as string) }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over) return
    const overId = over.id as string
    if (!overId.startsWith('slot-')) return
    const hour = parseInt(overId.replace('slot-', ''), 10)
    const taskId = active.id as string
    const task = tasks.find(t => t.id === taskId)
    const dur = task?.duration ? Math.ceil(task.duration / 60) : 1
    setBlocks(prev => {
      const without = prev.filter(b => b.taskId !== taskId)
      return [...without, { taskId, startHour: hour, durationHours: dur }]
    })
  }

  function removeBlock(taskId: string) {
    setBlocks(prev => prev.filter(b => b.taskId !== taskId))
  }

  const totalMinutes = blocks.reduce((sum, b) => {
    const task = tasks.find(t => t.id === b.taskId)
    return sum + (task?.duration ?? b.durationHours * 60)
  }, 0)

  const activeTask = activeId ? tasks.find(t => t.id === activeId) ?? null : null

  return (
    <>
      <style>{`
        @keyframes sdp-in { from{opacity:0;transform:scale(0.97) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
      `}</style>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {/* Modal */}
        <div style={{
          background: '#F9FAFB', borderRadius: 20, width: '100%', maxWidth: 1000, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 32px 80px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)',
          animation: 'sdp-in 0.3s cubic-bezier(0.16,1,0.3,1)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '18px 24px', background: '#FFFFFF', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 22 }}>✦</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: '#111827', flex: 1 }}>Smart Day Planner</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4, display: 'flex', borderRadius: 6 }}>
              <X size={18} />
            </button>
          </div>
          {/* Sub-header */}
          <div style={{ padding: '10px 24px', background: '#FFFFFF', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 5 }}>
              📅 {dateLabel}
            </span>
            <span style={{ fontSize: 13, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 5 }}>
              🕐 {timeLabel}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#374151', borderRadius: 20, padding: '3px 10px' }}>
              {unscheduledCount} unscheduled
            </span>
            <div style={{ flex: 1 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div onClick={() => setIncludeBreaks(b => !b)} style={{ width: 40, height: 22, borderRadius: 11, background: includeBreaks ? '#F97316' : '#D1D5DB', position: 'relative', cursor: 'pointer', transition: 'background 0.15s' }}>
                <div style={{ position: 'absolute', top: 3, left: includeBreaks ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Include breaks</span>
            </label>
          </div>

          {/* Body */}
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Left: Timeline */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid #E5E7EB' }}>
                <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FFFFFF', borderBottom: '1px solid #F3F4F6', flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Today's Schedule</span>
                  <button style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 20,
                    background: '#FFFFFF', border: '1.5px solid #E5E7EB', color: '#374151',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>
                    <RefreshCw size={13} /> Generate Plan
                  </button>
                </div>
                <div ref={timelineRef} style={{ flex: 1, overflowY: 'auto', background: '#FAFAFA' }}>
                  {HOURS.map(hour => {
                    const block = blocks.find(b => b.startHour === hour)
                    const task  = block ? tasks.find(t => t.id === block.taskId) : undefined
                    return (
                      <HourSlot
                        key={hour} hour={hour}
                        block={block}
                        taskTitle={task?.title}
                        onRemove={block ? () => removeBlock(block.taskId) : undefined}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Right: Task list */}
              <div style={{ width: 320, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#FFFFFF' }}>
                <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid #F3F4F6', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Tasks</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, display: 'flex' }}><Plus size={15} /></button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => setSortBy(s => s === 'priority' ? 'created' : 'priority')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
                      🔥 Priority ∨
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF' }}>Drag to schedule • Drag back to unschedule</p>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                  {sortedTasks.map(task => (
                    <DraggableTaskCard key={task.id} task={task} scheduled={scheduledTaskIds.has(task.id)} />
                  ))}
                  {sortedTasks.length === 0 && (
                    <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
                      No open tasks
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeTask && (
                <div style={{ width: 260, transform: 'rotate(1deg)', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.15))' }}>
                  <DraggableTaskCard task={activeTask} scheduled={false} />
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Footer */}
          <div style={{ padding: '14px 24px', background: '#FFFFFF', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              {blocks.length} task{blocks.length !== 1 ? 's' : ''} scheduled • {totalMinutes} minutes total
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 20, background: '#FFFFFF', border: '1.5px solid #E5E7EB', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>
              Cancel
            </button>
            <button style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 20,
              background: blocks.length ? '#F97316' : '#E5E7EB',
              border: 'none', color: blocks.length ? '#fff' : '#9CA3AF',
              fontSize: 13, fontWeight: 700, cursor: blocks.length ? 'pointer' : 'default',
              transition: 'all 0.15s',
            }}>
              <Check size={14} /> Apply Plan
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
