import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { scheduleTaskToCalendar } from '@/lib/aiScheduler'
import { notify } from '@/lib/undo'

// ─── A date on a task is an event on the calendar ────────────────────────────
//
// This used to live inside the Tasks page, which meant it only ran while that
// page was open: a task given a date from the Today screen, the palette or the
// planner sat there dateless-looking until you happened to visit the board. It
// also asked for the Schedule quadrant, so a task in Do with a date on it — the
// ordinary case for something urgent — was never pushed at all.
//
// Two limits keep it from filling a calendar with history: the task has to be
// **placed** (something still in the brain dump has not been decided about),
// and the day has to be today or later. Anything older is asked for by hand,
// from the row in the task panel.
//
// A failure says so once. It used to be a swallowed promise, which is why a
// task could look scheduled for days with nothing on the calendar.

function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useTaskCalendarPush(): void {
  const tasks = useTaskStore(s => s.tasks)
  const updateTask = useTaskStore(s => s.updateTask)
  const running = useRef<Set<string>>(new Set())
  /** One complaint per reason, not one per task — and not again on every
   *  render while the account stays disconnected. */
  const complained = useRef<Set<string>>(new Set())

  useEffect(() => {
    const today = todayISO()
    const candidates = tasks.filter(t =>
      t.quadrant != null && t.dueDate && t.dueDate >= today &&
      !t.completed && t.status !== 'done' && t.status !== 'cancelled' &&
      !t.gcalEventId && !running.current.has(t.id))

    for (const task of candidates) {
      running.current.add(task.id)
      scheduleTaskToCalendar(task)
        .then(res => {
          if (res.success && res.gcalEventId) {
            updateTask(task.id, { gcalEventId: res.gcalEventId })
            return
          }
          const reason = res.error ?? 'Google refused it'
          if (complained.current.has(reason)) return
          complained.current.add(reason)
          notify(`Could not put "${task.title || 'a task'}" on your calendar — ${reason}`)
        })
        .catch(() => {})
        .finally(() => running.current.delete(task.id))
    }
  }, [tasks, updateTask])
}
