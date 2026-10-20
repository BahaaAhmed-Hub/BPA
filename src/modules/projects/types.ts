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

/** What a link to an event remembers about it. The project page cannot ask
 *  Google, so the calendar refreshes this whenever it loads the event. */
export interface EventMeta {
  title: string
  /** An ISO date-time, or YYYY-MM-DD for an all-day event. */
  start: string
  end?: string
  allDay: boolean
  calendarId?: string
}

/** What a link to a mail thread remembers: the project page cannot read Gmail,
 *  so the mail view refreshes this whenever it has the thread loaded. */
export interface ThreadMeta {
  subject: string
  fromName: string
  fromEmail: string
  /** When its newest message arrived, ms since epoch. */
  at: number
  accountEmail: string
}

/** What a link to a finance entry remembers. Finance loads one year at a time,
 *  so an entry from another year is not in the store; the project page reads
 *  this instead, and Finance refreshes it whenever the entry is loaded. */
export interface EntryMeta {
  payee: string
  amount: number
  currency: string
  /** YYYY-MM-DD — the day it belongs to. */
  date: string
  /** YYYY-MM-DD — the day the money moved. Absent means still owed. */
  paidAt?: string
  type: string
}

export type LinkMeta = EventMeta | ThreadMeta | EntryMeta

export interface ProjectLink {
  id: string
  projectId: string
  kind: ProjectLinkKind
  /** The other module's own id — a string, because an event id is not a uuid. */
  refId: string
  /** An event link carries an `EventMeta`, a thread link a `ThreadMeta`. */
  meta?: LinkMeta
}
