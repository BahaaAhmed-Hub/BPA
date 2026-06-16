export interface CustomStatus {
  id: string
  label: string
  color: string
}

export const DEFAULT_STATUSES: CustomStatus[] = [
  { id: 'planned',     label: 'Planned',     color: '#3B82F6' },
  { id: 'in-progress', label: 'In Progress', color: '#F59E0B' },
  { id: 'blocked',     label: 'Blocked',     color: '#EF4444' },
  { id: 'delayed',     label: 'Delayed',     color: '#F97316' },
  { id: 'done',        label: 'Done',        color: '#10B981' },
]

// Preferred order for custom status columns (after predefined Inbox / Do columns)
const STATUS_PREFERRED_ORDER = ['planned', 'backlog', 'in-progress', 'blocked', 'delayed', 'done']

export function sortCustomStatuses(statuses: CustomStatus[]): CustomStatus[] {
  return [...statuses].sort((a, b) => {
    const ai = STATUS_PREFERRED_ORDER.indexOf(a.id)
    const bi = STATUS_PREFERRED_ORDER.indexOf(b.id)
    const av = ai === -1 ? 999 : ai
    const bv = bi === -1 ? 999 : bi
    return av - bv
  })
}

export function loadCustomStatuses(): CustomStatus[] {
  try {
    const raw = localStorage.getItem('professor-custom-statuses')
    if (raw) {
      const parsed = JSON.parse(raw) as CustomStatus[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /**/ }
  return DEFAULT_STATUSES
}

export function saveCustomStatuses(statuses: CustomStatus[]): void {
  localStorage.setItem('professor-custom-statuses', JSON.stringify(statuses))
  window.dispatchEvent(new CustomEvent('professor:statusesUpdated'))
}

export function getStatusMeta(id: string): { label: string; color: string } {
  const statuses = loadCustomStatuses()
  const found = statuses.find(s => s.id === id)
  return found ? { label: found.label, color: found.color } : { label: id, color: '#6B7280' }
}
