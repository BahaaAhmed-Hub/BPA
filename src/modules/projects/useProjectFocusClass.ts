import { useMemo } from 'react'
import { OUT_OF_FOCUS } from '@/lib/companyFocus'
import { useProjectFocus } from '@/lib/projectFocus'
import { useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'
import { threadRef } from './threadLinks'

const NONE: Task[] = []

/** What a row calls to ask whether the project lens has it in focus. '' while in
 *  focus or with no lens, the shared fade class otherwise.
 *  - a task answers from its own `projectId`;
 *  - an event from the project's event links, and — with `taskBlocks` — from the
 *    calendar blocks of the project's tasks, which the project's own calendar tab
 *    lists too;
 *  - a thread from the project's thread links, keyed mailbox|thread. */
export function useProjectFocusClass(opts: { taskBlocks?: boolean } = {}) {
  const [lens] = useProjectFocus()
  const links = useProjectStore(s => s.links)
  const tasks = useTaskStore(s => (opts.taskBlocks && lens ? s.tasks : NONE))
  const sets = useMemo(() => {
    const event = new Set<string>(), thread = new Set<string>()
    if (lens) {
      for (const l of links) {
        if (l.projectId !== lens) continue
        if (l.kind === 'event') event.add(l.refId)
        else if (l.kind === 'thread') thread.add(l.refId)
      }
      for (const t of tasks) if (t.projectId === lens && t.gcalEventId) event.add(t.gcalEventId)
    }
    return { event, thread }
  }, [lens, links, tasks])
  return useMemo(() => {
    const out = (inside: boolean) => (!lens || inside ? '' : OUT_OF_FOCUS)
    return {
      task: (projectId: string | undefined) => out(projectId === lens),
      event: (eventId: string) => out(sets.event.has(eventId)),
      thread: (accountEmail: string, threadId: string) => out(sets.thread.has(threadRef(accountEmail, threadId))),
    }
  }, [lens, sets])
}
