import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { markLocalWrite } from '@/lib/liveSync'
import { useTaskStore } from '@/store/taskStore'
import {
  fromLink, fromMilestone, fromProject, loadProjectData, orphanProjectTasks, pushProjectData,
} from '@/modules/projects/projectDb'
import type {
  LinkMeta, Project, ProjectLink, ProjectLinkKind, ProjectMilestone,
} from '@/modules/projects/types'

// ─── Which rows this device has changed ──────────────────────────────────────
// The same three lists `taskStore` keeps, for the same reasons (see CLAUDE.md →
// Cross-device sync), shared by all three kinds of row because the ids are uuids:
//
//   · dirty   — "this row might not be on the server". Seeded with every local
//               id on a device that predates the key, so the first reload cannot
//               mistake an unpushed row for one deleted elsewhere.
//   · edited  — "someone changed this here and it has not been pushed". Written
//               only by an actual edit and NEVER seeded; the only thing allowed
//               to outrank the server's copy of a field.
//   · gone    — ids deleted here, refused when the server offers them back.
//               Expire after 30 days, which a uuid makes safe.

const DIRTY_KEY  = 'professor-projects-dirty'
const EDITED_KEY = 'professor-projects-edited'
const GONE_KEY   = 'professor-projects-deleted'
const GONE_TTL   = 30 * 24 * 60 * 60 * 1000

type Kind = 'projects' | 'milestones' | 'links'
type Gone = Record<string, { kind: Kind; at: number }>

function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}
function saveIdSet(key: string, ids: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...ids])) } catch { /* quota */ }
}
function loadGone(): Gone {
  try {
    const raw = localStorage.getItem(GONE_KEY)
    const obj = raw ? (JSON.parse(raw) as Gone) : {}
    const cut = Date.now() - GONE_TTL
    return Object.fromEntries(Object.entries(obj).filter(([, g]) => g.at > cut))
  } catch { return {} }
}
function saveGone(g: Gone): void {
  try { localStorage.setItem(GONE_KEY, JSON.stringify(g)) } catch { /* quota */ }
}

if (localStorage.getItem(DIRTY_KEY) == null) {
  try {
    const s = (JSON.parse(localStorage.getItem('professor-projects') ?? '{}') as
      { state?: { projects?: { id: string }[]; milestones?: { id: string }[]; links?: { id: string }[] } }).state
    const ids = [...(s?.projects ?? []), ...(s?.milestones ?? []), ...(s?.links ?? [])].map(r => r.id)
    if (ids.length) saveIdSet(DIRTY_KEY, new Set(ids))
  } catch { /* nothing stored, nothing to protect */ }
}
if (localStorage.getItem(EDITED_KEY) == null) saveIdSet(EDITED_KEY, new Set())

/** A change made here: claim it, so a reload neither pulls the old row back
 *  over it nor reads it as deleted elsewhere. A row that is being written is
 *  by definition not deleted, which is also how a re-added id lifts its tombstone. */
function touch(ids: string[]): void {
  markLocalWrite('projects')
  const dirty = loadIdSet(DIRTY_KEY), edited = loadIdSet(EDITED_KEY), gone = loadGone()
  let lifted = false
  for (const id of ids) {
    dirty.add(id); edited.add(id)
    if (id in gone) { delete gone[id]; lifted = true }
  }
  saveIdSet(DIRTY_KEY, dirty)
  saveIdSet(EDITED_KEY, edited)
  if (lifted) saveGone(gone)
}

function bury(kind: Kind, ids: string[]): void {
  if (!ids.length) return
  markLocalWrite('projects')
  const gone = loadGone(), dirty = loadIdSet(DIRTY_KEY), edited = loadIdSet(EDITED_KEY)
  for (const id of ids) { gone[id] = { kind, at: Date.now() }; dirty.delete(id); edited.delete(id) }
  saveGone(gone)
  saveIdSet(DIRTY_KEY, dirty)
  saveIdSet(EDITED_KEY, edited)
}

// ─── The push ────────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null

/** Writes what is dirty and removes what is gone. `touch`/`bury` have already
 *  run, so a reload inside the debounce cannot undo any of it. */
function pushNow(): void {
  if (timer) { clearTimeout(timer); timer = null }
  markLocalWrite('projects')
  const s = useProjectStore.getState()
  const dirty = loadIdSet(DIRTY_KEY), gone = loadGone()
  const deleted = { projects: [] as string[], milestones: [] as string[], links: [] as string[] }
  for (const [id, g] of Object.entries(gone)) deleted[g.kind].push(id)
  const projects   = s.projects.filter(p => dirty.has(p.id))
  const milestones = s.milestones.filter(m => dirty.has(m.id))
  const links      = s.links.filter(l => dirty.has(l.id))
  if (!projects.length && !milestones.length && !links.length
    && !deleted.projects.length && !deleted.milestones.length && !deleted.links.length) return
  const pushed = [...projects, ...milestones, ...links].map(r => r.id)
  pushProjectData({ projects, milestones, links, deleted })
    .then(() => {
      // Only what was pushed: an edit made while this was in flight stays claimed.
      const d = loadIdSet(DIRTY_KEY), e = loadIdSet(EDITED_KEY)
      for (const id of pushed) { d.delete(id); e.delete(id) }
      saveIdSet(DIRTY_KEY, d)
      saveIdSet(EDITED_KEY, e)
    })
    .catch(console.warn)
}

function schedulePush(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(pushNow, 1500)
}

// ─── The merge ───────────────────────────────────────────────────────────────
/** The server's list is the truth about what exists; a row made here and not
 *  pushed yet is kept; a field this device edited outranks the server's. */
function mergeRows<T extends { id: string }>(
  local: T[], server: T[], dirty: Set<string>, edited: Set<string>, gone: Gone,
): { merged: T[]; refused: boolean } {
  const byId = new Map(server.map(r => [r.id, r]))
  const merged = local
    .filter(r => byId.has(r.id) || dirty.has(r.id))
    .map(r => {
      const theirs = byId.get(r.id)
      if (!theirs) return r                                  // made here, not pushed yet
      return edited.has(r.id) ? { ...theirs, ...r } : { ...r, ...theirs }
    })
  const have = new Set(local.map(r => r.id))
  const offered = server.filter(r => !have.has(r.id))
  const fresh = offered.filter(r => !(r.id in gone))
  return { merged: [...merged, ...fresh], refused: fresh.length !== offered.length }
}

const sameRow = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

interface ProjectState {
  projects: Project[]
  milestones: ProjectMilestone[]
  links: ProjectLink[]
  /** 20260042 has not been applied: everything stays in this browser. */
  missing: boolean

  /** Returns the new project's id. */
  addProject: (p: Partial<Project> & { name: string }) => string
  updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void
  /** Its milestones and links go with it. Its tasks stay, unassigned. */
  deleteProject: (id: string) => void

  addMilestone: (projectId: string, m: { title: string; dueDate?: string }) => string
  updateMilestone: (id: string, updates: Partial<Omit<ProjectMilestone, 'id' | 'projectId'>>) => void
  deleteMilestone: (id: string) => void

  /** Linking the same thing twice is one link. */
  addLink: (projectId: string, kind: ProjectLinkKind, refId: string, meta?: LinkMeta) => string
  removeLink: (id: string) => void
  /** Every link to one thing, whichever project holds it — the thing was deleted.
   *  Returns what it removed, so a caller that can take the delete back can put them back. */
  removeLinksByRef: (kind: ProjectLinkKind, refId: string) => ProjectLink[]
  /** Refresh what a link remembers about what it points at. */
  setLinkMeta: (id: string, meta: LinkMeta) => void

  loadFromDB: () => Promise<void>
  clearAll: () => void
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      milestones: [],
      links: [],
      missing: false,

      addProject: p => {
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        const project: Project = {
          kind: 'work', status: 'active', archived: false,
          ...p, id, createdAt: now, updatedAt: now,
        }
        set(s => ({ projects: [...s.projects, project] }))
        touch([id])
        schedulePush()
        return id
      },

      updateProject: (id, updates) => {
        if (!get().projects.some(p => p.id === id)) return
        set(s => ({
          projects: s.projects.map(p =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p),
        }))
        touch([id])
        schedulePush()
      },

      deleteProject: id => {
        const s = get()
        if (!s.projects.some(p => p.id === id)) return
        const ms = s.milestones.filter(m => m.projectId === id).map(m => m.id)
        const ls = s.links.filter(l => l.projectId === id).map(l => l.id)
        set({
          projects:   s.projects.filter(p => p.id !== id),
          milestones: s.milestones.filter(m => m.projectId !== id),
          links:      s.links.filter(l => l.projectId !== id),
        })
        bury('projects', [id]); bury('milestones', ms); bury('links', ls)
        // Kept, not deleted: the task simply stops pointing here.
        useTaskStore.getState().clearProject(id)
        orphanProjectTasks(id).catch(console.warn)
        schedulePush()
      },

      addMilestone: (projectId, m) => {
        const id = crypto.randomUUID()
        const sortOrder = get().milestones.filter(x => x.projectId === projectId).length
        set(s => ({ milestones: [...s.milestones, { id, projectId, done: false, sortOrder, ...m }] }))
        touch([id])
        schedulePush()
        return id
      },

      updateMilestone: (id, updates) => {
        if (!get().milestones.some(m => m.id === id)) return
        set(s => ({ milestones: s.milestones.map(m => (m.id === id ? { ...m, ...updates } : m)) }))
        touch([id])
        schedulePush()
      },

      deleteMilestone: id => {
        if (!get().milestones.some(m => m.id === id)) return
        set(s => ({ milestones: s.milestones.filter(m => m.id !== id) }))
        bury('milestones', [id])
        // A task pointed at it keeps its project and loses only the phase.
        useTaskStore.getState().clearMilestone(id)
        schedulePush()
      },

      addLink: (projectId, kind, refId, meta) => {
        const existing = get().links.find(l => l.projectId === projectId && l.kind === kind && l.refId === refId)
        if (existing) return existing.id
        const id = crypto.randomUUID()
        set(s => ({ links: [...s.links, { id, projectId, kind, refId, ...(meta ? { meta } : {}) }] }))
        touch([id])
        schedulePush()
        return id
      },

      removeLink: id => {
        if (!get().links.some(l => l.id === id)) return
        set(s => ({ links: s.links.filter(l => l.id !== id) }))
        bury('links', [id])
        schedulePush()
      },

      removeLinksByRef: (kind, refId) => {
        const hit = get().links.filter(l => l.kind === kind && l.refId === refId)
        if (!hit.length) return []
        set(s => ({ links: s.links.filter(l => !(l.kind === kind && l.refId === refId)) }))
        bury('links', hit.map(l => l.id))
        schedulePush()
        return hit
      },

      setLinkMeta: (id, meta) => {
        if (!get().links.some(l => l.id === id)) return
        set(s => ({ links: s.links.map(l => (l.id === id ? { ...l, meta } : l)) }))
        touch([id])
        schedulePush()
      },

      loadFromDB: async () => {
        try {
          const data = await loadProjectData()
          if (data === 'missing') { set({ missing: true }); return }
          const dirty = loadIdSet(DIRTY_KEY), edited = loadIdSet(EDITED_KEY), gone = loadGone()
          const s = get()

          // A link made on two devices has two ids and one meaning; the server's wins.
          const triple = (l: ProjectLink) => `${l.projectId}|${l.kind}|${l.refId}`
          const theirs = new Map(data.links.map(l => [triple(l), l.id]))
          const localLinks = s.links.filter(l => { const t = theirs.get(triple(l)); return !t || t === l.id })

          const p = mergeRows(s.projects, data.projects, dirty, edited, gone)
          const m = mergeRows(s.milestones, data.milestones, dirty, edited, gone)
          const l = mergeRows(localLinks, data.links, dirty, edited, gone)
          set({ projects: p.merged, milestones: m.merged, links: l.merged, missing: false })

          // Push the merge back only when it differs from what the server just
          // sent — an unconditional push is a change event, which makes the
          // other device reload and push back, for as long as both are open.
          const onServer = new Map<string, string>([
            ...data.projects.map(r => [r.id, JSON.stringify(fromProject(r, ''))] as [string, string]),
            ...data.milestones.map(r => [r.id, JSON.stringify(fromMilestone(r, ''))] as [string, string]),
            ...data.links.map(r => [r.id, JSON.stringify(fromLink(r, ''))] as [string, string]),
          ])
          const differing = [
            ...p.merged.filter(r => !sameRow(onServer.get(r.id), JSON.stringify(fromProject(r, '')))),
            ...m.merged.filter(r => !sameRow(onServer.get(r.id), JSON.stringify(fromMilestone(r, '')))),
            ...l.merged.filter(r => !sameRow(onServer.get(r.id), JSON.stringify(fromLink(r, '')))),
          ].map(r => r.id)
          if (differing.length || p.refused || m.refused || l.refused) {
            // Hydration, not an edit: dirty but not edited, so this device does
            // not speak for rows it merely holds.
            const d = loadIdSet(DIRTY_KEY)
            for (const id of differing) d.add(id)
            saveIdSet(DIRTY_KEY, d)
            schedulePush()
          }
        } catch { /* offline — keep local */ }
      },

      clearAll: () => set({ projects: [], milestones: [], links: [], missing: false }),
    }),
    {
      name: 'professor-projects',
      partialize: s => ({ projects: s.projects, milestones: s.milestones, links: s.links }),
    },
  ),
)

/** A task's project, or undefined. A task pointing at a project that is gone
 *  (deleted on another device, not yet reloaded) is unassigned, not an error. */
export function projectOfTask(task: { projectId?: string }, projects: Project[]): Project | undefined {
  return task.projectId ? projects.find(p => p.id === task.projectId) : undefined
}
