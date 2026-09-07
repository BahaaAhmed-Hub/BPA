import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { arrayMove } from '@dnd-kit/sortable'
import type { Task, Quadrant, TaskStatus, TaskActivity, TaskType } from '@/types'
import { COMPANY_LABELS, QUADRANT_META, getAllUsers, loadDynamicCompanies } from '@/types'
import { saveTasksToDB, loadTasksFromDB } from '@/lib/dbSync'
import { markLocalWrite } from '@/lib/liveSync'
import type { TaskRow } from '@/lib/dbSync'

/** Today in the viewer's own timezone. toISOString() reports UTC, which lands
 *  on the wrong day either side of midnight for anyone not on it. */
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function act(taskId: string, type: TaskActivity['type'], description: string): TaskActivity {
  return { id: crypto.randomUUID(), taskId, type, description, timestamp: new Date().toISOString() }
}

/** Which field an entry is about, ignoring the value it was set to. Typing a
 *  title writes on every keystroke, and the log should read as one rename. */
function fieldSignature(description: string): string {
  return description.split(';').map(part => part.trim().split(/["→]/)[0].trim()).join('|')
}

/** Appends an entry — or folds it into the previous one when it is the same
 *  field on the same task, still being edited. */
const MERGE_WINDOW_MS = 90_000
function pushActivity(activities: TaskActivity[], entry: TaskActivity): TaskActivity[] {
  const last = activities[activities.length - 1]
  if (
    last &&
    last.taskId === entry.taskId &&
    last.type === entry.type &&
    fieldSignature(last.description) === fieldSignature(entry.description) &&
    new Date(entry.timestamp).getTime() - new Date(last.timestamp).getTime() < MERGE_WINDOW_MS
  ) {
    return [...activities.slice(0, -1), { ...last, description: entry.description, timestamp: entry.timestamp }]
  }
  return [...activities, entry]
}

/** A link as it reads in the log — the host and a little of the path, not the
 *  hundred-character share URL OneDrive and Drive hand out. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const shown = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`
    return shown.length > 40 ? shown.slice(0, 39) + '…' : shown
  } catch { return url.length > 40 ? url.slice(0, 39) + '…' : url }
}

function toRow(t: Task): TaskRow {
  return {
    id: t.id, title: t.title, quadrant: t.quadrant ?? null,
    company: t.company, companyId: t.companyId,
    status: t.status, completed: t.completed, completedAt: t.completedAt,
    dueDate: t.dueDate, duration: t.duration, plannedTime: t.plannedTime,
    owner: t.owner, urgent: t.urgent, taskType: t.taskType, createdAt: t.createdAt,
    // Everything that used to stop at this browser.
    description: t.description, priority: t.priority,
    boardStatus: t.boardStatus, calendarId: t.calendarId,
    gcalEventId: t.gcalEventId, parentTaskId: t.parentTaskId,
    capturedVia: t.capturedVia,
    checklist: t.checklist, attachments: t.attachments, links: t.links,
  }
}

function fromRow(r: TaskRow): Task {
  return {
    id: r.id, title: r.title,
    quadrant: r.quadrant as Quadrant | null ?? null,
    company: (r.company as Task['company']) || 'teradix',
    status: (r.status as TaskStatus) || 'open',
    completed: r.completed,
    completedAt: r.completedAt,
    dueDate: r.dueDate, duration: r.duration, plannedTime: r.plannedTime,
    owner: r.owner, createdAt: r.createdAt,
    // Only include these if DB actually has them — avoids overwriting local state on merge
    ...(r.companyId != null ? { companyId: r.companyId }            : {}),
    ...(r.urgent    != null ? { urgent:    r.urgent    }            : {}),
    ...(r.taskType  != null ? { taskType:  r.taskType as TaskType } : {}),
    ...(r.description  != null ? { description:  r.description }  : {}),
    ...(r.priority     != null ? { priority:     r.priority as Task['priority'] } : {}),
    ...(r.boardStatus  != null ? { boardStatus:  r.boardStatus }  : {}),
    ...(r.calendarId   != null ? { calendarId:   r.calendarId }   : {}),
    ...(r.gcalEventId  != null ? { gcalEventId:  r.gcalEventId }  : {}),
    ...(r.parentTaskId != null ? { parentTaskId: r.parentTaskId } : {}),
    ...(r.capturedVia  != null ? { capturedVia:  r.capturedVia as Task['capturedVia'] } : {}),
    ...(r.checklist?.length   ? { checklist:   r.checklist as Task['checklist'] }     : {}),
    ...(r.attachments?.length ? { attachments: r.attachments as Task['attachments'] } : {}),
    ...(r.links?.length       ? { links:       r.links }                              : {}),
  }
}

// ─── Which tasks this device has changed since it last pushed ────────────────
// Only meaningful now that the server can change while the app is open. Two
// questions need it. A task the server does not have is either one made here a
// moment ago or one deleted on the other device — and keeping both would make
// every delete undo itself. A task the server *does* have is only allowed to
// overwrite what is on screen if nobody here is mid-edit.

const DIRTY_KEY = 'professor-tasks-dirty'

function loadDirtyTasks(): Set<string> {
  try {
    const raw = localStorage.getItem(DIRTY_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveDirtyTasks(ids: Set<string>): void {
  try { localStorage.setItem(DIRTY_KEY, JSON.stringify([...ids])) } catch { /* quota */ }
}

// A device that predates this list gives no way to tell what it has pushed and
// what it has not. Assume nothing, or the first reload treats every task that
// never reached the server as one deleted elsewhere and drops it.
if (localStorage.getItem(DIRTY_KEY) == null) {
  try {
    const stored = JSON.parse(localStorage.getItem('professor-tasks') ?? '{}') as
      { state?: { tasks?: { id: string }[] } }
    const ids = (stored.state?.tasks ?? []).map(t => t.id)
    if (ids.length) saveDirtyTasks(new Set(ids))
  } catch { /* nothing stored, nothing to protect */ }
}

function markTasksDirty(tasks: Task[]): void {
  markLocalWrite('tasks')
  const set = loadDirtyTasks()
  for (const t of tasks) set.add(t.id)
  saveDirtyTasks(set)
}

// Debounced DB push — batches rapid mutations into one write
let dbTimer: ReturnType<typeof setTimeout> | null = null
function scheduleDbSync(tasks: Task[]) {
  // Every caller reaches here after changing something, and the whole list is
  // what gets written, so this is the one place that has to record it.
  markTasksDirty(tasks)
  if (dbTimer) clearTimeout(dbTimer)
  dbTimer = setTimeout(() => {
    markLocalWrite('tasks')
    const pushing = loadDirtyTasks()
    saveTasksToDB(tasks.map(toRow))
      .then(() => {
        const still = loadDirtyTasks()
        for (const id of pushing) still.delete(id)
        saveDirtyTasks(still)
      })
      .catch(console.warn)
  }, 1500)
}

interface TaskState {
  tasks: Task[]
  activities: TaskActivity[]
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void
  addTasksBatch: (tasks: Omit<Task, 'id' | 'createdAt'>[]) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  moveTask: (id: string, quadrant: Quadrant | null) => void
  moveTaskBefore: (activeId: string, overId: string) => void
  reorderInbox: (activeId: string, overId: string) => void
  reorderQuadrant: (activeId: string, overId: string) => void
  clearAll: () => void
  toggleUrgent: (id: string) => void
  deleteTask: (id: string) => void
  toggleComplete: (id: string) => void
  setStatus: (id: string, status: TaskStatus) => void
  loadFromDB: () => Promise<void>
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, _get) => ({
      tasks: [],
      activities: [],

      loadFromDB: async () => {
        try {
          const rows = await loadTasksFromDB()
          if (rows.length > 0) {
            const dirty = loadDirtyTasks()
            let joined: Task[] = []
            set(s => {
              // Merge: the server wins on fields, local order is preserved —
              // except for tasks this device has changed and not yet pushed,
              // which would otherwise be overwritten mid-edit now that this
              // runs while the app is open rather than only at sign-in.
              const local = s.tasks
              const dbMap = new Map(rows.map(r => [r.id, fromRow(r)]))
              const merged = local
                .filter(t => dbMap.has(t.id) || dirty.has(t.id))
                .map(t => {
                  const fromDb = dbMap.get(t.id)
                  if (!fromDb) return t                       // made here, not pushed yet
                  return dirty.has(t.id) ? { ...fromDb, ...t } : { ...t, ...fromDb }
                })
              // Append tasks that exist in DB but not locally
              const localIds = new Set(local.map(t => t.id))
              const dbOnly = rows.filter(r => !localIds.has(r.id)).map(r => fromRow(r))
              joined = [...merged, ...dbOnly]
              return { tasks: joined }
            })

            // Push the merge back: it is where this device's own fields — notes,
            // subtasks, links, the calendar event id — meet the server's copy,
            // and nothing else sends them, since the sync only runs on edits.
            //
            // Only when it differs, though. An unconditional push writes rows
            // identical to the ones just read, which is a change event, which
            // makes the other device reload and push back: two open devices
            // would trade writes for as long as they were both open.
            const onServer = new Map(rows.map(r => [r.id, JSON.stringify(toRow(fromRow(r)))]))
            const changed =
              joined.length !== rows.length ||
              joined.some(t => onServer.get(t.id) !== JSON.stringify(toRow(t)))
            if (changed) scheduleDbSync(joined)
          }
        } catch { /* offline — keep local */ }
      },

      addTask: task =>
        set(s => {
          const newTask: Task = {
            ...task,
            // A task with a day on it is a task that has been decided about —
            // it belongs on the board, not in the pile of things not yet
            // thought through. See `scheduled` below.
            quadrant: task.quadrant ?? (task.dueDate ? 'schedule' : null),
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          }
          const next = [...s.tasks, newTask]
          scheduleDbSync(next)
          return {
            tasks: next,
            activities: [...s.activities, act(newTask.id, 'created', 'Task created')],
          }
        }),

      addTasksBatch: tasks =>
        set(s => {
          const newTasks: Task[] = tasks.map(t => ({
            ...t, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
          }))
          const next = [...s.tasks, ...newTasks]
          scheduleDbSync(next)
          return {
            tasks: next,
            activities: [
              ...s.activities,
              ...newTasks.map(t => act(t.id, 'created', 'Task created from meeting notes')),
            ],
          }
        }),

      updateTask: (id, updates) =>
        set(s => {
          const old = s.tasks.find(t => t.id === id)
          if (!old) return s
          const desc: string[] = []
          if (updates.title !== undefined && updates.title !== old.title)
            desc.push(`Renamed to "${updates.title}"`)
          if (updates.company !== undefined && updates.company !== old.company)
            // Companies are user-created now; COMPANY_LABELS only covers the
            // four legacy tags, so fall back to the live company list.
            desc.push(`Company → ${
              loadDynamicCompanies().find(c => c.id === updates.company)?.name
              ?? COMPANY_LABELS[updates.company]
              ?? updates.company
            }`)
          if ('dueDate' in updates && updates.dueDate !== old.dueDate)
            desc.push(updates.dueDate ? `Due date → ${updates.dueDate}` : 'Due date cleared')
          if ('plannedTime' in updates && updates.plannedTime !== old.plannedTime)
            desc.push(updates.plannedTime ? `Planned time → ${updates.plannedTime}` : 'Planned time cleared')
          if ('duration' in updates && updates.duration !== old.duration)
            desc.push(updates.duration ? `Duration → ${updates.duration}m` : 'Duration cleared')
          if ('owner' in updates && updates.owner !== old.owner) {
            const user = updates.owner ? getAllUsers().find(u => u.id === updates.owner) : undefined
            desc.push(user ? `Assigned to ${user.name}` : 'Owner removed')
          }
          if ('quadrant' in updates && updates.quadrant !== old.quadrant) {
            const from = old.quadrant ? QUADRANT_META[old.quadrant].label : 'Inbox'
            const to = updates.quadrant ? QUADRANT_META[updates.quadrant].label : 'Inbox'
            desc.push(`Moved from ${from} to ${to}`)
          }

          // Files and links are events, not edits: each one is its own line, and
          // none of them fold into the entry before it.
          const events: TaskActivity[] = []
          if ('attachments' in updates) {
            const before = old.attachments ?? []
            const after  = updates.attachments ?? []
            for (const f of after) {
              if (!before.some(b => b.id === f.id)) events.push(act(id, 'attachment_added', `Attached ${f.name}`))
            }
            for (const f of before) {
              if (!after.some(a => a.id === f.id)) events.push(act(id, 'attachment_removed', `Removed ${f.name}`))
            }
          }
          if ('links' in updates) {
            const before = old.links ?? []
            const after  = updates.links ?? []
            for (const url of after) {
              if (!before.includes(url)) events.push(act(id, 'link_added', `Link added — ${shortUrl(url)}`))
            }
            for (const url of before) {
              if (!after.includes(url)) events.push(act(id, 'link_removed', `Link removed — ${shortUrl(url)}`))
            }
          }

          // Giving a task a date is deciding when to do it, so it stops being
          // a brain dump entry and joins Schedule — the quadrant for the
          // important things that are not urgent yet. Only from the dump: a
          // task already put in Do stays in Do, and clearing the date does not
          // send anything back.
          const scheduled = old.quadrant == null && !!updates.dueDate && !('quadrant' in updates)
          if (scheduled) desc.push('Moved from Inbox to Schedule')

          const patch = scheduled ? { ...updates, quadrant: 'schedule' as const } : updates
          const next = s.tasks.map(t => t.id === id ? { ...t, ...patch } : t)
          scheduleDbSync(next)
          const merged = desc.length
            ? pushActivity(s.activities, act(id, 'field_updated', desc.join('; ')))
            : s.activities
          return {
            tasks: next,
            activities: events.length ? [...merged, ...events] : merged,
          }
        }),

      moveTask: (id, quadrant) =>
        set(s => {
          const old = s.tasks.find(t => t.id === id)
          const from = old?.quadrant ? QUADRANT_META[old.quadrant].label : 'Inbox'
          const to = quadrant ? QUADRANT_META[quadrant].label : 'Inbox'
          const next = s.tasks.map(t => t.id === id ? { ...t, quadrant } : t)
          scheduleDbSync(next)
          return {
            tasks: next,
            activities: [...s.activities, act(id, 'moved', `Moved from ${from} to ${to}`)],
          }
        }),

      moveTaskBefore: (activeId, overId) =>
        set(s => {
          const dragged = s.tasks.find(t => t.id === activeId)
          const target  = s.tasks.find(t => t.id === overId)
          if (!dragged || !target) return s
          const from = dragged.quadrant ? QUADRANT_META[dragged.quadrant].label : 'Inbox'
          const to   = target.quadrant  ? QUADRANT_META[target.quadrant].label  : 'Inbox'
          // Remove dragged from array, insert before target
          const without = s.tasks.filter(t => t.id !== activeId)
          const targetIdx = without.findIndex(t => t.id === overId)
          const next = [
            ...without.slice(0, targetIdx),
            { ...dragged, quadrant: target.quadrant },
            ...without.slice(targetIdx),
          ]
          scheduleDbSync(next)
          return {
            tasks: next,
            activities: [...s.activities, act(activeId, 'moved', `Moved from ${from} to ${to}`)],
          }
        }),

      reorderInbox: (activeId, overId) =>
        set(s => {
          const inboxIds = s.tasks.filter(t => t.quadrant === null).map(t => t.id)
          const fromIdx = inboxIds.indexOf(activeId)
          const toIdx   = inboxIds.indexOf(overId)
          if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return s
          const reorderedInbox = arrayMove(inboxIds, fromIdx, toIdx)
          const inboxSet = new Set(inboxIds)
          const others   = s.tasks.filter(t => !inboxSet.has(t.id))
          const next     = [...others, ...reorderedInbox.map(id => s.tasks.find(t => t.id === id)!)]
          scheduleDbSync(next)
          return { tasks: next }
        }),

      reorderQuadrant: (activeId, overId) =>
        set(s => {
          const dragged = s.tasks.find(t => t.id === activeId)
          const target  = s.tasks.find(t => t.id === overId)
          if (!dragged || !target || dragged.quadrant !== target.quadrant || dragged.quadrant === null) return s
          const q = dragged.quadrant
          const qIds = s.tasks.filter(t => t.quadrant === q).map(t => t.id)
          const fromIdx = qIds.indexOf(activeId)
          const toIdx   = qIds.indexOf(overId)
          if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return s
          const reordered = arrayMove(qIds, fromIdx, toIdx)
          const qSet = new Set(qIds)
          const others = s.tasks.filter(t => !qSet.has(t.id))
          const next = [...others, ...reordered.map(id => s.tasks.find(t => t.id === id)!)]
          scheduleDbSync(next)
          return { tasks: next }
        }),

      toggleUrgent: (id) =>
        set(s => {
          const task = s.tasks.find(t => t.id === id)
          if (!task) return s
          const newUrgent = !task.urgent
          const updated = { ...task, urgent: newUrgent }
          if (!newUrgent) {
            const next = s.tasks.map(t => t.id === id ? updated : t)
            scheduleDbSync(next)
            return { tasks: next }
          }
          // Move to top of section, right after the last already-urgent task in the same section
          const without = s.tasks.filter(t => t.id !== id)
          const sectionIds = without
            .filter(t => t.quadrant === task.quadrant)
            .map(t => t.id)
          const lastUrgentSectionId = [...sectionIds].reverse().find(sid => without.find(t => t.id === sid)?.urgent)
          const insertBeforeId = lastUrgentSectionId
            ? sectionIds[sectionIds.indexOf(lastUrgentSectionId) + 1] ?? null
            : sectionIds[0] ?? null
          let next: Task[]
          if (insertBeforeId === null) {
            next = [...without, updated]
          } else {
            const at = without.findIndex(t => t.id === insertBeforeId)
            next = [...without.slice(0, at), updated, ...without.slice(at)]
          }
          scheduleDbSync(next)
          return { tasks: next }
        }),

      deleteTask: id =>
        set(s => {
          const next = s.tasks.filter(t => t.id !== id)
          scheduleDbSync(next)
          return {
            tasks: next,
            activities: s.activities.filter(a => a.taskId !== id),
          }
        }),

      toggleComplete: id =>
        set(s => {
          const task = s.tasks.find(t => t.id === id)
          const nowDone = !task?.completed
          const today = todayKey()
          const next: Task[] = s.tasks.map(t =>
            t.id === id ? {
              ...t,
              completed:   !t.completed,
              status:      (t.completed ? 'open' : 'done') as TaskStatus,
              completedAt: t.completed ? undefined : today,
            } : t
          )
          // Save immediately — debouncing risks losing the change if user refreshes
          saveTasksToDB(next.map(toRow)).catch(console.warn)
          return {
            tasks: next,
            activities: [...s.activities, act(id, 'status_changed', nowDone ? 'Marked as done' : 'Reopened')],
          }
        }),

      setStatus: (id, status) =>
        set(s => {
          const today = todayKey()
          const next = s.tasks.map(t =>
            t.id === id ? {
              ...t,
              status,
              completed:   status === 'done',
              completedAt: status === 'done' ? (t.completedAt ?? today) : undefined,
            } : t
          )
          // Save immediately for status changes so completion date persists through refresh
          saveTasksToDB(next.map(toRow)).catch(console.warn)
          return {
            tasks: next,
            activities: [...s.activities, act(id, 'status_changed', `Status → ${status}`)],
          }
        }),

      clearAll: () => { saveDirtyTasks(new Set()); set({ tasks: [], activities: [] }) },
    }),
    { name: 'professor-tasks' },
  ),
)
