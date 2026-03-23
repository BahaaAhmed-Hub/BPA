import { TopBar } from '@/components/layout/TopBar'
import { EisenhowerBoard } from './EisenhowerBoard'
import { UndefinedTasksPanel } from './UndefinedTasksPanel'
import { useTaskStore } from '@/store/taskStore'
import { CheckSquare, Zap } from 'lucide-react'

export function TaskCommand() {
  const tasks  = useTaskStore(s => s.tasks)
  const active = tasks.filter(t => t.quadrant !== null && !t.completed)
  const urgent = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const inbox  = tasks.filter(t => t.quadrant === null && t.status !== 'done' && t.status !== 'cancelled' && !t.completed)

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
          Drag tasks between quadrants to reprioritize
        </div>
      </div>

      {/* Board + right panel */}
      <div style={{ display: 'flex', gap: 14, padding: '18px 28px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EisenhowerBoard />
        </div>
        <UndefinedTasksPanel />
      </div>
    </div>
  )
}
