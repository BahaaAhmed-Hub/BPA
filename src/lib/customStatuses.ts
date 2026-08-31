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

/** The stored order IS the order — Settings and the board both write it, so
 *  nothing re-sorts it behind the user's back. */
export function sortCustomStatuses(statuses: CustomStatus[]): CustomStatus[] {
  return statuses
}

/** Move a status one place, for the reorder controls in Settings. */
export function moveStatus(statuses: CustomStatus[], from: number, to: number): CustomStatus[] {
  if (to < 0 || to >= statuses.length || from === to) return statuses
  const next = [...statuses]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
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
