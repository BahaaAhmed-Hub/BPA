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

// ─── Task ────────────────────────────────────────────────────────────────────
export type TaskStatus = 'open' | 'done' | 'cancelled'

export interface Task {
  id: string
  title: string
  description?: string
  quadrant: Quadrant | null  // null = inbox/undefined (right panel)
  company: CompanyTag
  companyId?: string         // dynamic company id from settings
  dueDate?: string           // YYYY-MM-DD
  duration?: number          // minutes
  plannedTime?: string       // HH:MM for schedule quadrant
  calendarId?: string        // Google Calendar id to link this task
  owner?: string             // CompanyUser.id
  parentTaskId?: string      // id of the parent meeting/call task that generated this task
  status: TaskStatus
  completed: boolean
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
