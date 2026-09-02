// ─── Events made from tasks ──────────────────────────────────────────────────
// Scheduling a task puts a real event on a real Google calendar, where it sits
// among meetings other people made. Without a mark it is indistinguishable from
// one, in this app and in Google Calendar itself — so it carries one, in the
// title where you see it and in the notes where you look for the reason.

import type { Task } from '@/types'

/** A clipboard, not a tick: the event came from a task, which says nothing
 *  about whether it has been done. Kept out of the status glyphs the calendar
 *  strips for exactly that reason. */
export const TASK_EVENT_MARK = '📋'

const MARK_PREFIX = new RegExp(`^\\s*${TASK_EVENT_MARK}\\s*`, 'u')

/** The line that tells you, inside Google Calendar, where this came from. */
const NOTE_HEADER = 'Scheduled from a task in The Professor'

export function isTaskEvent(summary?: string, description?: string): boolean {
  if (summary && MARK_PREFIX.test(summary)) return true
  return !!description?.includes(NOTE_HEADER)
}

/** The title without the mark, for drawing our own icon in its place. */
export function stripTaskMark(summary?: string): string {
  return (summary ?? '').replace(MARK_PREFIX, '').trim()
}

/** The title as it goes to Google. Marking twice would stack the glyph, so a
 *  title already marked is left alone. */
export function taskEventTitle(title: string): string {
  const clean = title.trim()
  return MARK_PREFIX.test(clean) ? clean : `${TASK_EVENT_MARK} ${clean}`
}

/** The notes as they go to Google: what the task said, then where it came from
 *  and what it was for, so the event explains itself away from this app. */
export function taskEventDescription(task: Pick<Task, 'title' | 'description' | 'priority' | 'dueDate'>): string {
  const own = task.description?.trim()
  const facts = [
    `Task: ${task.title.trim()}`,
    task.priority ? `Priority: ${task.priority}` : null,
    task.dueDate ? `Due: ${task.dueDate}` : null,
  ].filter(Boolean).join('\n')

  return [own, `— ${NOTE_HEADER} —`, facts].filter(Boolean).join('\n\n')
}
