// ─── Company Tags ───────────────────────────────────────────────────────────
export type CompanyTag = 'teradix' | 'dxtech' | 'consulting' | 'personal'

export const COMPANY_LABELS: Record<CompanyTag, string> = {
  teradix: 'Teradix',
  dxtech: 'DX Technologies',
  consulting: 'Consulting',
  personal: 'Personal',
}

export const COMPANY_COLORS: Record<CompanyTag, string> = {
  teradix: '#7C3AED',
  dxtech: '#7F77DD',
  consulting: '#1D9E75',
  personal: '#888780',
}

// ─── Company User (from Settings companies) ──────────────────────────────────
export interface CompanyUser {
  id: string
  name: string
  email?: string
}

// ─── Dynamic Company (from localStorage professor-companies) ─────────────────
export interface DynamicCompany {
  id: string
  name: string
  color: string
  users: CompanyUser[]
  hidden?: boolean
  emailDomain?: string
  accountId?: string
  calendarId?: string
}

export function loadDynamicCompanies(): DynamicCompany[] {
  try {
    const raw = localStorage.getItem('professor-companies')
    const companies: DynamicCompany[] = raw ? (JSON.parse(raw) as DynamicCompany[]) : []
    // Merge users from backup key (in case main key was restored from DB without users)
    const backupRaw = localStorage.getItem('professor-company-users')
    if (backupRaw) {
      const backup: Record<string, CompanyUser[]> = JSON.parse(backupRaw)
      return companies.map(co => ({
        ...co,
        users: co.users?.length ? co.users : (backup[co.id] ?? []),
      }))
    }
    return companies
  } catch { return [] }
}

export function getAllUsers(): (CompanyUser & { companyId: string; companyName: string; companyColor: string })[] {
  return loadDynamicCompanies().flatMap(co =>
    (co.users ?? []).map(u => ({ ...u, companyId: co.id, companyName: co.name, companyColor: co.color }))
  )
}

/** People belonging to companies you can see. Use everywhere except Settings,
 *  which has to show a hidden company's people to let you unhide it. */
export function getVisibleUsers(): (CompanyUser & { companyId: string; companyName: string; companyColor: string })[] {
  return loadDynamicCompanies()
    .filter(co => !co.hidden)
    .flatMap(co => (co.users ?? []).map(u => ({ ...u, companyId: co.id, companyName: co.name, companyColor: co.color })))
}

/** Returns only companies that are not hidden. Use everywhere except Settings. */
export function loadVisibleCompanies(): DynamicCompany[] {
  return loadDynamicCompanies().filter(c => !c.hidden)
}

/** Returns true if the task belongs to a hidden company and should be excluded
 *  from views. `company` has held both an id and a name over the life of the
 *  app, so it is matched against either. */
export function isTaskHidden(task: { companyId?: string; company?: string }): boolean {
  const companies = loadDynamicCompanies()
  if (task.companyId) {
    const co = companies.find(c => c.id === task.companyId)
    if (co) return co.hidden === true
  }
  if (task.company) {
    const tag = task.company.toLowerCase()
    const co = companies.find(c => c.id.toLowerCase() === tag || c.name.toLowerCase() === tag)
    if (co) return co.hidden === true
  }
  return false
}

// ─── Eisenhower Quadrants ───────────────────────────────────────────────────
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate'

// Each quadrant's colour is a *meaning* — do it now, plan it, hand it over,
// drop it — so it comes from the semantic tokens rather than a hue somebody
// liked, and it moves with the theme.
export const QUADRANT_META: Record<Quadrant, { label: string; sub: string; color: string }> = {
  do:       { label: 'Do',        sub: 'Urgent + Important',         color: 'var(--sb-negative)' },
  schedule: { label: 'Schedule',  sub: 'Not Urgent + Important',     color: 'var(--sb-info)' },
  delegate: { label: 'Delegate',  sub: 'Urgent + Not Important',     color: 'var(--sb-positive)' },
  eliminate:{ label: 'Eliminate', sub: 'Not Urgent + Not Important', color: 'var(--sb-ink-4)' },
}

// ─── Task Type ───────────────────────────────────────────────────────────────
export type TaskType = 'meeting' | 'call' | 'followup' | 'email' | 'research' | 'study' | 'deepwork' | 'do'

// These seven are a *set*: no one of them means anything on its own, they only
// have to stay apart from each other. So they come from the categorical ramp
// (--sb-cat-1..6), which every theme answers for, rather than from the
// semantic tokens — none of which would keep seven things distinguishable.
export const TASK_TYPE_META: Record<TaskType, { label: string; emoji: string; color: string }> = {
  meeting:  { label: 'Meeting / Schedule', emoji: '📅', color: 'var(--sb-cat-1)' },
  call:     { label: 'Call',               emoji: '📞', color: 'var(--sb-cat-2)' },
  followup: { label: 'Follow-up',          emoji: '↩️', color: 'var(--sb-cat-3)' },
  email:    { label: 'Email',              emoji: '✉️', color: 'var(--sb-cat-4)' },
  research: { label: 'Research',           emoji: '🔍', color: 'var(--sb-cat-5)' },
  study:    { label: 'Study',              emoji: '📚', color: 'var(--sb-cat-6)' },
  deepwork: { label: 'Deep work',          emoji: '🧠', color: 'var(--sb-cat-1)' },
  do:       { label: 'Do',                 emoji: '✅', color: 'var(--sb-ink-3)' },
}

/** Keyword-based task type classifier. Used as default when taskType is not manually set. */
export function inferTaskType(title: string): TaskType {
  const t = title.toLowerCase()
  // Meeting / Schedule — broad set of collaboration keywords
  if (/meeting|sync|standup|stand.?up|1:1|one.on.one|interview|check.?in|debrief|catch.?up|kickoff|kick.?off|appointment|review.*with|scheduled.*call|join.*call|schedule.*with|briefing|workshop|webinar|🤝|💬|📅/.test(t)) return 'meeting'
  // Call — phone / video
  if (/\bcall\b|\bcalled\b|\bcalling\b|phone|dial|zoom|teams|skype|hangout|facetime|📞/.test(t)) return 'call'
  // Follow-up
  if (/follow.?up|follow up|check back|get back to|circle back|ping/.test(t)) return 'followup'
  // Email / messaging
  if (/\bemail\b|\be-mail\b|\bmail\b|send.*to|reply|respond|draft|inbox|gmail|outlook|message|slack|✉/.test(t)) return 'email'
  // Research / analysis
  if (/research|investigate|analy[sz]e|analysis|explore|look into|benchmark|evaluate|compare|audit|assess/.test(t)) return 'research'
  // Study / learning
  if (/\bstudy\b|\blearn\b|\bread\b|reading|course|training|practice|tutorial|docs|documentation|watch.*video|📚/.test(t)) return 'study'
  // Deep work — focused making, not admin
  if (/deep work|focus block|write|writing|design|build|implement|refactor|prep(are)? for|draft the|model|plan the/.test(t)) return 'deepwork'
  return 'do'
}

// ─── Priority ────────────────────────────────────────────────────────────────
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export const PRIORITY_META: Record<Priority, { label: string; color: string; tint: string; border: string }> = {
  P0: { label: 'P0', color: 'var(--sb-negative)', tint: 'rgba(198,40,40,0.11)',  border: 'rgba(198,40,40,0.30)' },
  P1: { label: 'P1', color: 'var(--sb-accent-deep)', tint: 'rgba(var(--sb-accent-rgb),0.22)', border: 'rgba(var(--sb-accent-rgb),0.55)' },
  P2: { label: 'P2', color: 'var(--sb-ink-3)', tint: 'var(--sb-field)',               border: 'var(--sb-border)' },
  P3: { label: 'P3', color: 'var(--sb-ink-4)', tint: 'var(--sb-field)',               border: 'var(--sb-border)' },
}

// ─── Task ────────────────────────────────────────────────────────────────────
export type TaskStatus = 'open' | 'done' | 'cancelled'

export type BoardStatus = 'backlog' | 'planned' | 'in-progress' | 'blocked' | 'delayed' | 'done'

// Where a card stands is a meaning too: not started, planned, moving, stuck,
// late, finished.
export const BOARD_STATUS_META: Record<BoardStatus, { label: string; color: string }> = {
  backlog:        { label: 'Backlog',      color: 'var(--sb-ink-4)' },
  planned:        { label: 'Planned',      color: 'var(--sb-info)' },
  'in-progress':  { label: 'In Progress',  color: 'var(--sb-accent)' },
  blocked:        { label: 'Blocked',      color: 'var(--sb-negative)' },
  delayed:        { label: 'Delayed',      color: 'var(--sb-warning)' },
  done:           { label: 'Done',         color: 'var(--sb-positive)' },
}

export interface Task {
  id: string
  title: string
  description?: string
  quadrant: Quadrant | null  // null = inbox/undefined (right panel)
  company: CompanyTag
  companyId?: string         // dynamic company id from settings
  taskType?: TaskType        // manual override; inferred from title when not set
  dueDate?: string           // YYYY-MM-DD
  duration?: number          // minutes
  plannedTime?: string       // HH:MM for schedule quadrant
  calendarId?: string        // Google Calendar id to link this task
  gcalEventId?: string       // Google Calendar event ID created for this task
  owner?: string             // CompanyUser.id
  parentTaskId?: string      // id of the parent meeting/call task that generated this task
  boardStatus?: string       // kanban board status column (id from customStatuses)
  status: TaskStatus
  completed: boolean
  urgent?: boolean
  createdAt: string
  completedAt?: string  // YYYY-MM-DD — set when task is marked done, cleared on reopen
  priority?: Priority        // P0–P3, shown on the card rail and in the matrix
  checklist?: ChecklistStep[]
  attachments?: TaskAttachment[]
  capturedVia?: 'voice' | 'mail' | 'manual'   // brain dump provenance (9F)
  links?: string[]           // threads, docs and pages attached to the task
}

export interface ChecklistStep {
  id: string
  text: string
  done: boolean
}

export interface TaskAttachment {
  id: string
  name: string
  size: number          // bytes
  source?: string       // "from mail", "pasted", …
  addedAt: string
}

// ─── Task Activity Log ───────────────────────────────────────────────────────
export type TaskActivityType =
  | 'created' | 'moved' | 'status_changed' | 'field_updated'
  | 'attachment_added' | 'attachment_removed' | 'link_added' | 'link_removed'

export interface TaskActivity {
  id: string
  taskId: string
  type: TaskActivityType
  description: string
  timestamp: string
}

// ─── Metric Card ─────────────────────────────────────────────────────────────
export interface MetricCard {
  id: string
  label: string
  value: string | number
  delta?: string
  deltaPositive?: boolean
  icon: string
  company?: CompanyTag
}

// ─── Navigation Module ───────────────────────────────────────────────────────
export interface NavModule {
  id: string
  label: string
  icon: string
  path: string
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  name?: string
  avatarUrl?: string
}
