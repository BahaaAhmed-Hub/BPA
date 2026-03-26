import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Task, Quadrant, TaskStatus, TaskActivity } from '@/types'
import { COMPANY_LABELS, QUADRANT_META, getAllUsers } from '@/types'

function act(taskId: string, type: TaskActivity['type'], description: string): TaskActivity {
  return { id: crypto.randomUUID(), taskId, type, description, timestamp: new Date().toISOString() }
}

interface TaskState {
  tasks: Task[]
  activities: TaskActivity[]
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  moveTask: (id: string, quadrant: Quadrant | null) => void
  deleteTask: (id: string) => void
  toggleComplete: (id: string) => void
  setStatus: (id: string, status: TaskStatus) => void
}

export const useTaskStore = create<TaskState>()(
  persist(
    set => ({
      tasks: [],
      activities: [],

      addTask: task =>
        set(s => {
          const newTask: Task = { ...task, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
          return {
            tasks: [...s.tasks, newTask],
            activities: [...s.activities, act(newTask.id, 'created', 'Task created')],
          }
        }),

      updateTask: (id, updates) =>
        set(s => {
          const old = s.tasks.find(t => t.id === id)
          if (!old) return s
          const desc: string[] = []
          if (updates.title !== undefined && updates.title !== old.title)
            desc.push(`Renamed to "${updates.title}"`)
          if (updates.company !== undefined && updates.company !== old.company)
            desc.push(`Company → ${COMPANY_LABELS[updates.company]}`)
          if ('dueDate' in updates && updates.dueDate !== old.dueDate)
            desc.push(updates.dueDate ? `Due date → ${updates.dueDate}` : 'Due date cleared')
          if ('plannedTime' in updates && updates.plannedTime !== old.plannedTime)
            desc.push(updates.plannedTime ? `Planned time → ${updates.plannedTime}` : 'Planned time cleared')
          if ('duration' in updates && updates.duration !== old.duration)
            desc.push(updates.duration ? `Duration → ${updates.duration}m` : 'Duration cleared')
          if ('owner' in updates && updates.owner !== old.owner) {
            const user = updates.owner ? getAllUsers().find(u => u.id === updates.owner) : undefined
            desc.push(user ? `Assigned to ${user.name}` : 'Owner removed')
          }
          if ('quadrant' in updates && updates.quadrant !== old.quadrant) {
            const from = old.quadrant ? QUADRANT_META[old.quadrant].label : 'Inbox'
            const to = updates.quadrant ? QUADRANT_META[updates.quadrant].label : 'Inbox'
            desc.push(`Moved from ${from} to ${to}`)
          }
          return {
            tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates } : t),
            activities: desc.length
              ? [...s.activities, act(id, 'field_updated', desc.join('; '))]
              : s.activities,
          }
        }),

      moveTask: (id, quadrant) =>
        set(s => {
          const old = s.tasks.find(t => t.id === id)
          const from = old?.quadrant ? QUADRANT_META[old.quadrant].label : 'Inbox'
          const to = quadrant ? QUADRANT_META[quadrant].label : 'Inbox'
          return {
            tasks: s.tasks.map(t => t.id === id ? { ...t, quadrant } : t),
            activities: [...s.activities, act(id, 'moved', `Moved from ${from} to ${to}`)],
          }
        }),

      deleteTask: id =>
        set(s => ({
          tasks: s.tasks.filter(t => t.id !== id),
          activities: s.activities.filter(a => a.taskId !== id),
        })),

      toggleComplete: id =>
        set(s => {
          const task = s.tasks.find(t => t.id === id)
          const nowDone = !task?.completed
          return {
            tasks: s.tasks.map(t =>
              t.id === id ? { ...t, completed: !t.completed, status: t.completed ? 'open' : 'done' } : t
            ),
            activities: [...s.activities, act(id, 'status_changed', nowDone ? 'Marked as done' : 'Reopened')],
          }
        }),

      setStatus: (id, status) =>
        set(s => ({
          tasks: s.tasks.map(t =>
            t.id === id ? { ...t, status, completed: status === 'done' } : t
          ),
          activities: [...s.activities, act(id, 'status_changed', `Status → ${status}`)],
        })),
    }),
    { name: 'professor-tasks' },
  ),
)
