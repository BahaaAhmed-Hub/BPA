import type { Task } from '@/types'
import type { Project, ProjectMilestone } from '@/modules/projects/types'

// ─── What a project looks like from its tasks ────────────────────────────────
// Derived every time, never stored: a stored percentage is a second copy of
// the task list that goes wrong the moment a task is ticked on another device.

export interface ProjectStats {
  /** Tasks pointing at the project, not counting those cancelled — an
   *  abandoned task is neither work done nor work left. */
  total: number
  done: number
  open: number
  /** Open and dated before today. */
  overdue: number
  /** 0–100, whole numbers; 0 for a project with nothing in it. */
  pct: number
  /** The soonest milestone not yet done, or undefined. */
  nextMilestone?: ProjectMilestone
}

const isDone = (t: Pick<Task, 'completed' | 'status'>) => t.completed || t.status === 'done'

export function projectStats(
  project: Pick<Project, 'id'>, tasks: Task[], milestones: ProjectMilestone[], today: string,
): ProjectStats {
  const mine = tasks.filter(t => t.projectId === project.id && t.status !== 'cancelled')
  const done = mine.filter(isDone).length
  const open = mine.length - done
  const overdue = mine.filter(t => !isDone(t) && !!t.dueDate && t.dueDate < today).length
  const next = milestones
    .filter(m => m.projectId === project.id && !m.done)
    // Dated ones first, soonest first; an undated one waits behind them.
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sortOrder - b.sortOrder)[0]
  return {
    total: mine.length, done, open, overdue,
    pct: mine.length ? Math.round((done / mine.length) * 100) : 0,
    nextMilestone: next,
  }
}
