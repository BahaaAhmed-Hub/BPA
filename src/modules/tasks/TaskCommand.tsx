
import { TopBar } from '@/components/layout/TopBar'
import { EisenhowerBoard } from './EisenhowerBoard'
import { useTaskStore } from '@/store/taskStore'
import { CheckSquare, Zap } from 'lucide-react'

export function TaskCommand() {
  const tasks = useTaskStore(s => s.tasks)
  const active = tasks.filter(t => !t.completed)
  const urgent = tasks.filter(t => t.quadrant === 'do' && !t.completed)

  return (
    <div>
      <TopBar
        title="Task Command"
        subtitle="Eisenhower Matrix — ruthless prioritization for maximum leverage."
      />

      {/* Stats bar */}
      <div
        style={{
          padding: '16px 28px',
          borderBottom: '1px solid #252A3E',
          display: 'flex',
          gap: 20,
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <CheckSquare size={14} color="#7C3AED" strokeWidth={2} />
          <span style={{ fontSize: 13, color: '#6B7280' }}>
            <span style={{ color: '#E8EAF6', fontWeight: 600 }}>{active.length}</span> active tasks
          </span>
        </div>
        <div style={{ width: 1, height: 16, background: '#252A3E' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Zap size={14} color="#E05252" strokeWidth={2} />
          <span style={{ fontSize: 13, color: '#6B7280' }}>
            <span style={{ color: '#E8EAF6', fontWeight: 600 }}>{urgent.length}</span> urgent
          </span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6B7280', fontStyle: 'italic' }}>
          Drag tasks between quadrants to reprioritize
        </div>
      </div>

      {/* Board */}
      <div style={{ padding: '20px 28px' }}>
        <EisenhowerBoard />
      </div>
    </div>
  )
}
