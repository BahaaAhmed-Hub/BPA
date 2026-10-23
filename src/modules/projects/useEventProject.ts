import { useMemo } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import type { Project } from './types'

/** Which project an event on the calendar belongs to, if any — the answer the event's own panel
 *  gives: a task's block belongs to its task's project (the panel offers no second answer), and any
 *  other event to the project it is linked to. A finished or archived project still owns its events.
 *  Returns a lookup rather than a value so a grid of cards asks one memo, not one subscription each. */
export function useEventProject(): (eventId: string) => Project | undefined {
  const projects = useProjectStore(s => s.projects)
  const links = useProjectStore(s => s.links)
  const tasks = useTaskStore(s => s.tasks)
  return useMemo(() => {
    const byId = new Map(projects.map(p => [p.id, p]))
    const owner = new Map<string, Project>()
    for (const l of links) {
      if (l.kind !== 'event') continue
      const p = byId.get(l.projectId)
      if (p) owner.set(l.refId, p)
    }
    for (const t of tasks) {
      if (!t.gcalEventId || !t.projectId) continue
      const p = byId.get(t.projectId)
      if (p) owner.set(t.gcalEventId, p)
    }
    return (eventId: string) => owner.get(eventId)
  }, [projects, links, tasks])
}
