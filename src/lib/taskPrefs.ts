// ─── Task defaults: how the Tasks page opens, and where an unplaced task lands ──
//
// Three small choices, kept as their own shared pref keys (so they follow the person between devices):
//   task-default-view      which view Tasks opens on — or 'last' for the one used last (what it always did)
//   task-command-config    the page's own filter config; `hideCompleted` here is the same flag as its menu
//   task-default-calendar  the calendar a task goes on when neither the task nor its company names one

export type DefaultView = 'last' | 'board' | 'eisenhower' | 'list'
export const DEFAULT_VIEW_KEY = 'task-default-view'
export const TASKS_CONFIG_KEY = 'task-command-config'
export const DEFAULT_CALENDAR_KEY = 'task-default-calendar'

export const DEFAULT_VIEW_OPTIONS: { value: DefaultView; label: string }[] = [
  { value: 'last', label: 'Last used' },
  { value: 'board', label: 'Board' },
  { value: 'eisenhower', label: 'Matrix' },
  { value: 'list', label: 'List' },
]

export function loadDefaultView(): DefaultView {
  try {
    const v = localStorage.getItem(DEFAULT_VIEW_KEY)
    return v === 'board' || v === 'eisenhower' || v === 'list' ? v : 'last'
  } catch { return 'last' }
}
export function saveDefaultView(v: DefaultView): void {
  try { v === 'last' ? localStorage.removeItem(DEFAULT_VIEW_KEY) : localStorage.setItem(DEFAULT_VIEW_KEY, v) } catch { /* quota */ }
}

/** Hide-completed lives in the Tasks page's own config object; this reads and writes only that field. */
export function loadHideCompleted(): boolean {
  try { return !!JSON.parse(localStorage.getItem(TASKS_CONFIG_KEY) ?? '{}').hideCompleted } catch { return false }
}
export function saveHideCompleted(on: boolean): void {
  try {
    const cur = JSON.parse(localStorage.getItem(TASKS_CONFIG_KEY) ?? '{}')
    localStorage.setItem(TASKS_CONFIG_KEY, JSON.stringify({ ...cur, hideCompleted: on }))
  } catch { /* quota */ }
}

export interface DefaultCalendar { calendarId: string; accountEmail?: string }
export function loadDefaultCalendar(): DefaultCalendar | null {
  try {
    const v = JSON.parse(localStorage.getItem(DEFAULT_CALENDAR_KEY) ?? 'null') as DefaultCalendar | null
    return v && typeof v.calendarId === 'string' && v.calendarId ? v : null
  } catch { return null }
}
export function saveDefaultCalendar(c: DefaultCalendar | null): void {
  try { c ? localStorage.setItem(DEFAULT_CALENDAR_KEY, JSON.stringify(c)) : localStorage.removeItem(DEFAULT_CALENDAR_KEY) } catch { /* quota */ }
}
