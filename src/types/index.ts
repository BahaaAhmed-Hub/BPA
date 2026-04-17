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

// ─── Eisenhower Quadrants ───────────────────────────────────────────────────
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate'

export const QUADRANT_META: Record<Quadrant, { label: string; sub: string; color: string }> = {
  do:       { label: 'Do',        sub: 'Urgent + Important',         color: '#7C3AED' },
  schedule: { label: 'Schedule',  sub: 'Not Urgent + Important',     color: '#7F77DD' },
  delegate: { label: 'Delegate',  sub: 'Urgent + Not Important',     color: '#1D9E75' },
  eliminate:{ label: 'Eliminate', sub: 'Not Urgent + Not Important', color: '#888780' },
}

// ─── Task Type ───────────────────────────────────────────────────────────────
export type TaskType = 'meeting' | 'call' | 'followup' | 'email' | 'research' | 'study' | 'do'

export const TASK_TYPE_META: Record<TaskType, { label: string; emoji: string; color: string }> = {
  meeting:  { label: 'Meeting / Schedule', emoji: '📅', color: '#7F77DD' },
  call:     { label: 'Call',               emoji: '📞', color: '#1D9E75' },
  followup: { label: 'Follow-up',          emoji: '↩️', color: '#E0944A' },
  email:    { label: 'Email',              emoji: '✉️', color: '#60A5FA' },
  research: { label: 'Research',           emoji: '🔍', color: '#A78BFA' },
  study:    { label: 'Study',              emoji: '📚', color: '#34D399' },
  do:       { label: 'Do',                 emoji: '✅', color: '#6B7280' },
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
  return 'do'
}

// ─── Task ────────────────────────────────────────────────────────────────────
export type TaskStatus = 'open' | 'done' | 'cancelled'

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
  status: TaskStatus
  completed: boolean
  urgent?: boolean
  createdAt: string
}

// ─── Task Activity Log ───────────────────────────────────────────────────────
export type TaskActivityType = 'created' | 'moved' | 'status_changed' | 'field_updated'

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
