// ─── Company Tags ───────────────────────────────────────────────────────────
export type CompanyTag = 'teradix' | 'dxtech' | 'consulting' | 'personal'

export const COMPANY_LABELS: Record<CompanyTag, string> = {
  teradix: 'Teradix',
  dxtech: 'DX Technologies',
  consulting: 'Consulting',
  personal: 'Personal',
}

export const COMPANY_COLORS: Record<CompanyTag, string> = {
  teradix: '#C49A3C',
  dxtech: '#7F77DD',
  consulting: '#1D9E75',
  personal: '#888780',
}

// ─── Eisenhower Quadrants ───────────────────────────────────────────────────
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate'

export const QUADRANT_META: Record<Quadrant, { label: string; sub: string; color: string }> = {
  do:       { label: 'Do',       sub: 'Urgent + Important',     color: '#C49A3C' },
  schedule: { label: 'Schedule', sub: 'Not Urgent + Important', color: '#7F77DD' },
  delegate: { label: 'Delegate', sub: 'Urgent + Not Important', color: '#1D9E75' },
  eliminate:{ label: 'Eliminate',sub: 'Not Urgent + Not Important', color: '#888780' },
}

// ─── Task ────────────────────────────────────────────────────────────────────
export interface Task {
  id: string
  title: string
  description?: string
  quadrant: Quadrant
  company: CompanyTag
  dueDate?: string
  completed: boolean
  createdAt: string
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
