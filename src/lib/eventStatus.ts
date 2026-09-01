// ─── Event status ────────────────────────────────────────────────────────────
// Whether a calendar event was done or cancelled is the app's own note about
// somebody else's event, so it lives here rather than in Google. Both the
// calendar and the Today plan read and write the same map.

import type { EventStatus } from '@/lib/eventMetadata'

const KEY = 'cal-event-statuses'

export function loadEventStatuses(): Record<string, EventStatus> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, EventStatus>) : {}
  } catch { return {} }
}

export function saveEventStatuses(map: Record<string, EventStatus>): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* quota */ }
  window.dispatchEvent(new Event('professor:eventStatusesUpdated'))
}

/** Sets a status, or clears it when it is already the one showing. */
export function toggleEventStatus(eventId: string, status: EventStatus): Record<string, EventStatus> {
  const next = { ...loadEventStatuses() }
  if (next[eventId] === status) delete next[eventId]
  else next[eventId] = status
  saveEventStatuses(next)
  return next
}
