import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Task, Quadrant } from '@/types'

interface TaskState {
  tasks: Task[]
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  moveTask: (id: string, quadrant: Quadrant) => void
  deleteTask: (id: string) => void
  toggleComplete: (id: string) => void
}

export const useTaskStore = create<TaskState>()(
  persist(
    set => ({
      tasks: [],
      addTask: task =>
        set(s => ({
          tasks: [
            ...s.tasks,
            { ...task, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),
      updateTask: (id, updates) =>
        set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, ...updates } : t)) })),
      moveTask: (id, quadrant) =>
        set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, quadrant } : t)) })),
      deleteTask: id => set(s => ({ tasks: s.tasks.filter(t => t.id !== id) })),
      toggleComplete: id =>
        set(s => ({
          tasks: s.tasks.map(t => (t.id === id ? { ...t, completed: !t.completed } : t)),
        })),
    }),
    { name: 'professor-tasks' },
  ),
)
