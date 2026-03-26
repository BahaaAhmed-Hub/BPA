import { QuadrantColumn } from './QuadrantColumn'
import { useTaskStore } from '@/store/taskStore'
import type { Quadrant } from '@/types'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']

interface EisenhowerBoardProps {
  onOpen: (id: string) => void
}

export function EisenhowerBoard({ onOpen }: EisenhowerBoardProps) {
  const tasks = useTaskStore(s => s.tasks)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {QUADRANTS.map(q => (
        <QuadrantColumn
          key={q}
          quadrant={q}
          tasks={tasks.filter(t => t.quadrant === q)}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
