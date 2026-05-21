import { QuadrantColumn } from './QuadrantColumn'
import { useTaskStore } from '@/store/taskStore'
import type { Quadrant } from '@/types'
import { isTaskHidden } from '@/types'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']

interface EisenhowerBoardProps {
  onOpen: (id: string) => void
  hideCompleted?: boolean
  groupBy?: 'none' | 'type' | 'company'
  allGroupsExpanded?: boolean
  filteredTaskIds?: Set<string> | null
}

export function EisenhowerBoard({ onOpen, hideCompleted = false, groupBy = 'none', allGroupsExpanded = true, filteredTaskIds }: EisenhowerBoardProps) {
  const tasks = useTaskStore(s => s.tasks).filter(t => !isTaskHidden(t))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {QUADRANTS.map(q => (
        <QuadrantColumn
          key={q}
          quadrant={q}
          tasks={tasks.filter(t =>
            t.quadrant === q &&
            (!hideCompleted || (!t.completed && t.status !== 'done')) &&
            (!filteredTaskIds || filteredTaskIds.has(t.id))
          )}
          onOpen={onOpen}
          groupBy={groupBy}
          allGroupsExpanded={allGroupsExpanded}
        />
      ))}
    </div>
  )
}
