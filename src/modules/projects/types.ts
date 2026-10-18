/** A project: one outcome gathering items from several modules.
 *  See `.claude/rules/projects.md`. Progress and health are derived, never stored. */
export type ProjectKind = 'work' | 'personal'
export type ProjectStatus = 'idea' | 'active' | 'paused' | 'done'

export interface Project {
  id: string
  name: string
  kind: ProjectKind
  color?: string
  status: ProjectStatus
  /** A work project belongs to exactly one company. Same meaning as a task's `companyId`. */
  companyId?: string
  startDate?: string    // YYYY-MM-DD
  targetDate?: string   // YYYY-MM-DD
  notes?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface ProjectMilestone {
  id: string
  projectId: string
  title: string
  dueDate?: string      // YYYY-MM-DD
  done: boolean
  sortOrder: number
}

/** Everything that is not a task. Tasks carry `projectId` on the task itself. */
export type ProjectLinkKind = 'event' | 'thread' | 'entry' | 'habit' | 'book' | 'list'

export interface ProjectLink {
  id: string
  projectId: string
  kind: ProjectLinkKind
  /** The other module's own id — a string, because an event id is not a uuid. */
  refId: string
}
