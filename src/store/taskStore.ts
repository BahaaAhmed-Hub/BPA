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

const DEMO_TASKS: Task[] = [
  {
    id: '1',
    title: 'Q2 Board Presentation',
    description: 'Prepare slides for quarterly board review',
    quadrant: 'do',
    company: 'teradix',
    dueDate: '2026-03-21',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Strategic Partnership Proposal',
    description: 'Draft proposal for DX Technologies integration',
    quadrant: 'schedule',
    company: 'dxtech',
    dueDate: '2026-03-28',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Client Contract Review',
    description: 'Review and sign consulting agreement',
    quadrant: 'do',
    company: 'consulting',
    dueDate: '2026-03-20',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '4',
    title: 'Team Expense Reports',
    description: 'Approve pending expense submissions',
    quadrant: 'delegate',
    company: 'teradix',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '5',
    title: 'Gym Membership Renewal',
    description: 'Annual membership auto-renews soon',
    quadrant: 'eliminate',
    company: 'personal',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '6',
    title: 'Monthly Newsletter',
    description: 'Write thought leadership article',
    quadrant: 'schedule',
    company: 'personal',
    dueDate: '2026-03-30',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '7',
    title: 'Infrastructure Audit',
    description: 'Review cloud spend & optimize costs',
    quadrant: 'schedule',
    company: 'dxtech',
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: '8',
    title: 'Reply to vendor emails',
    description: 'Low-priority vendor follow-ups',
    quadrant: 'delegate',
    company: 'consulting',
    completed: false,
    createdAt: new Date().toISOString(),
  },
]

export const useTaskStore = create<TaskState>()(
  persist(
    set => ({
      tasks: DEMO_TASKS,
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
