export interface CustomStatus {
  id: string
  label: string
  color: string
}

// 9B board columns. Only a fresh install picks these up — anyone who has
// already customised their columns keeps what they saved.
export const DEFAULT_STATUSES: CustomStatus[] = [
  { id: 'decide',    label: 'Decide',           color: '#B4523A' },
  { id: 'today',     label: 'Today',            color: '#F5D14E' },
  { id: 'this-week', label: 'This week',        color: '#8C826A' },
  { id: 'later',     label: 'Later',            color: '#B5AC98' },
  { id: 'done',      label: 'Done · this week', color: '#5F7038' },
]

const STATUS_PREFERRED_ORDER = [
  'decide', 'today', 'this-week', 'later', 'done',
  // legacy ids, kept so existing boards still sort sensibly
  'planned', 'backlog', 'in-progress', 'blocked', 'delayed',
]

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
