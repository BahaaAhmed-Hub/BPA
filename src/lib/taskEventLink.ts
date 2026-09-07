import { useTaskStore } from '@/store/taskStore'
import { loadEventStatuses, saveEventStatuses } from '@/lib/eventStatus'
import type { EventStatus } from '@/lib/eventMetadata'

// ─── A task and the block it made are one thing ──────────────────────────────
//
// Scheduling a task writes an event, and after that they drifted: ticking the
// task left the block sitting there looking like work still to do, and marking
// the block done left the task open. Two records of the same hour disagreeing
// is worse than one of them not existing.
//
// So the two are kept in step, in both directions. The link is the task's
// `gcalEventId` — nothing else is needed, and nothing is written into Google:
// "done" is this app's own note about an event (`cal-event-statuses`), which is
// exactly what it has always been.

/** The task, if any, that made this event. */
export function taskForEvent(eventId: string) {
  return useTaskStore.getState().tasks.find(t => t.gcalEventId === eventId) ?? null
}

/** Called when a task's own state changes. */
export function syncEventToTask(gcalEventId: string | undefined, taskState: 'done' | 'cancelled' | 'open'): void {
  if (!gcalEventId) return
  const map = { ...loadEventStatuses() }
  const wanted: EventStatus | null =
    taskState === 'done' ? 'done' : taskState === 'cancelled' ? 'cancelled' : null
  if (wanted === null) {
    if (map[gcalEventId] === undefined) return
    delete map[gcalEventId]
  } else {
    if (map[gcalEventId] === wanted) return
    map[gcalEventId] = wanted
  }
  saveEventStatuses(map)
}

/** Called when an event is marked done or cancelled on the calendar. */
export function syncTaskToEvent(eventId: string, status: EventStatus | null): void {
  const task = taskForEvent(eventId)
  if (!task) return
  const store = useTaskStore.getState()
  if (status === 'done') {
    if (task.completed) return
    store.updateTask(task.id, { status: 'done', completed: true, completedAt: todayKey() })
  } else if (status === 'cancelled') {
    if (task.status === 'cancelled') return
    store.updateTask(task.id, { status: 'cancelled', completed: false, completedAt: undefined })
  } else {
    if (!task.completed && task.status !== 'cancelled') return
    store.updateTask(task.id, { status: 'open', completed: false, completedAt: undefined })
  }
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
