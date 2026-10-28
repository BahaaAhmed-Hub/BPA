/**
 * projectDb.ts — Supabase CRUD for the Projects tables (20260042).
 *
 * Rows are pushed by id, never by "everything not in my list": a device that
 * has not finished loading must not be able to delete what it has not seen.
 * Deletes are explicit ids, taken from the store's tombstones.
 */
import { supabase } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/liveSync'
import { reportSyncGap } from '@/lib/syncStatus'
import type { LinkMeta, Project, ProjectKind, ProjectLink, ProjectLinkKind, ProjectMilestone, ProjectStatus } from './types'

interface ProjectRow {
  id: string; user_id: string; name: string; kind: string; color: string | null; status: string
  company_id: string | null; start_date: string | null; target_date: string | null
  notes: string | null; archived: boolean; created_at: string; updated_at: string
  budget_amount?: number | string | null; budget_currency?: string | null
}
interface MilestoneRow {
  id: string; project_id: string; user_id: string; title: string
  due_date: string | null; done: boolean; sort_order: number
}
interface LinkRow { id: string; project_id: string; user_id: string; kind: string; ref_id: string; meta?: unknown }

// `null` from the server means "nothing here"; the app's types use absence.
const opt = <T,>(v: T | null | undefined): T | undefined => (v ?? undefined)

export const toProject = (r: ProjectRow): Project => ({
  id: r.id, name: r.name, kind: r.kind as ProjectKind, color: opt(r.color),
  status: r.status as ProjectStatus, companyId: opt(r.company_id),
  startDate: opt(r.start_date), targetDate: opt(r.target_date), notes: opt(r.notes),
  archived: r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
  // A row that carries the columns says what the budget is, including "none" — an explicit key, so
  // clearing it on another device clears it here. A row without them (migration not run) says nothing,
  // and the budget this browser holds is left alone.
  ...('budget_amount' in r ? { budget: r.budget_amount != null && r.budget_currency ? { amount: Number(r.budget_amount), currency: r.budget_currency } : undefined } : {}),
})
export const toMilestone = (r: MilestoneRow): ProjectMilestone => ({
  id: r.id, projectId: r.project_id, title: r.title, dueDate: opt(r.due_date),
  done: r.done, sortOrder: r.sort_order,
})
export const toLink = (r: LinkRow): ProjectLink => ({
  id: r.id, projectId: r.project_id, kind: r.kind as ProjectLinkKind, refId: r.ref_id,
  ...(r.meta ? { meta: r.meta as LinkMeta } : {}),
})

// `?? null` on every optional: `undefined` is dropped on the way to JSON, so an
// upsert would never *clear* a field the person emptied.
export const fromProject = (p: Project, userId: string, withBudget = true) => ({
  id: p.id, user_id: userId, name: p.name, kind: p.kind, color: p.color ?? null,
  status: p.status, company_id: p.companyId ?? null, start_date: p.startDate ?? null,
  target_date: p.targetDate ?? null, notes: p.notes ?? null, archived: p.archived,
  created_at: p.createdAt, updated_at: p.updatedAt,
  ...(withBudget ? { budget_amount: p.budget?.amount ?? null, budget_currency: p.budget?.currency ?? null } : {}),
})
export const fromMilestone = (m: ProjectMilestone, userId: string) => ({
  id: m.id, project_id: m.projectId, user_id: userId, title: m.title,
  due_date: m.dueDate ?? null, done: m.done, sort_order: m.sortOrder,
})
/** `withMeta` false leaves the column out, for a database without 20260043. */
export const fromLink = (l: ProjectLink, userId: string, withMeta = true) => ({
  id: l.id, project_id: l.projectId, user_id: userId, kind: l.kind, ref_id: l.refId,
  ...(withMeta ? { meta: l.meta ?? null } : {}),
})

/** Set once a row has come back carrying `meta`: only then can a link that lost
 *  its snapshot write the null. Cleared when the column is found missing. */
let linkMeta = false
let linkMetaMissing = false
/** The same two flags for the budget columns (20260045). */
let budgetCols = false
let budgetMissing = false
/** Whether a project row should carry the budget columns at all — also what the store compares rows by. */
export const budgetColumnsUsable = () => !budgetMissing

/** 42P01: undefined_table. PGRST205: PostgREST's cache has no such table. */
export const isMissing = (e: { code?: string } | null | undefined) => e?.code === '42P01' || e?.code === 'PGRST205'

/** The server's refusal as an Error that still carries its code, so the caller can tell a missing table from a failed write. */
const failure = (e: { message: string; code?: string }) => Object.assign(new Error(e.message), { code: e.code })

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('not signed in')
  return id
}

export interface ProjectData {
  projects: Project[]
  milestones: ProjectMilestone[]
  links: ProjectLink[]
}

/** `'missing'` — the migration has not run; the caller keeps what it has.
 *  A failed read throws, because an empty answer would replace the lists. */
export async function loadProjectData(): Promise<ProjectData | 'missing'> {
  const uid = await userId()
  const [p, m, l] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', uid).order('created_at', { ascending: true }),
    supabase.from('project_milestones').select('*').eq('user_id', uid).order('sort_order', { ascending: true }),
    supabase.from('project_links').select('*').eq('user_id', uid),
  ])
  if (isMissing(p.error) || isMissing(m.error) || isMissing(l.error)) return 'missing'
  const failed = p.error ?? m.error ?? l.error
  if (failed) throw failure(failed)
  if (((l.data ?? []) as LinkRow[]).some(r => 'meta' in r)) { linkMeta = true; linkMetaMissing = false }
  if (((p.data ?? []) as ProjectRow[]).some(r => 'budget_amount' in r)) { budgetCols = true; budgetMissing = false }
  return {
    projects:   ((p.data ?? []) as ProjectRow[]).map(toProject),
    milestones: ((m.data ?? []) as MilestoneRow[]).map(toMilestone),
    links:      ((l.data ?? []) as LinkRow[]).map(toLink),
  }
}

export interface ProjectPush {
  projects: Project[]
  milestones: ProjectMilestone[]
  links: ProjectLink[]
  /** Ids to remove, whichever table they are in — they are uuids. */
  deleted: { projects: string[]; milestones: string[]; links: string[] }
}

/** Parents first, so a milestone is never written before its project. Throws on
 *  failure so the caller keeps its dirty marks and tries again. */
export async function pushProjectData(push: ProjectPush): Promise<void> {
  markLocalWrite('projects')
  const uid = await userId()

  if (push.projects.length) {
    // The budget columns go only when a project has a budget or the table has shown it carries them, so a
    // database without 20260045 keeps saving every other field; a refusal naming them retries without.
    const send = !budgetMissing && (budgetCols || push.projects.some(p => p.budget))
    const write = (withBudget: boolean) => supabase.from('projects')
      .upsert(push.projects.map(p => fromProject(p, uid, withBudget)), { onConflict: 'id' })
    let { error } = await write(send)
    if (error && send && /budget/.test(error.message)) {
      budgetMissing = true
      reportSyncGap('projects', 'columns', 'projects.budget — run 20260045_project_budget.sql')
      ;({ error } = await write(false))
    }
    if (error) throw failure(error)
  }
  if (push.milestones.length) {
    const { error } = await supabase.from('project_milestones')
      .upsert(push.milestones.map(m => fromMilestone(m, uid)), { onConflict: 'id' })
    if (error) throw failure(error)
  }
  if (push.links.length) {
    // The unique (project, kind, ref) key is the second way a duplicate can
    // arrive: two devices linking one thing mint two ids. Ignore the loser.
    // `meta` is sent once a link holds one or the column is known to exist, so a
    // database without 20260043 keeps saving every other link.
    const send = !linkMetaMissing && (linkMeta || push.links.some(l => l.meta))
    const write = (withMeta: boolean) => supabase.from('project_links')
      .upsert(push.links.map(l => fromLink(l, uid, withMeta)), { onConflict: 'project_id,kind,ref_id' })
    let { error } = await write(send)
    if (error && send && /meta/.test(error.message)) {
      linkMetaMissing = true
      // Links still save; only what they remember about the other module's item stays here.
      reportSyncGap('projects', 'columns', 'project_links.meta — run 20260043_project_link_meta.sql')
      ;({ error } = await write(false))
    }
    if (error) throw failure(error)
  }
  // Children before parents on the way out too — though cascade would cover it.
  for (const [table, ids] of [
    ['project_links', push.deleted.links],
    ['project_milestones', push.deleted.milestones],
    ['projects', push.deleted.projects],
  ] as const) {
    if (!ids.length) continue
    const { error } = await supabase.from(table).delete().eq('user_id', uid).in('id', ids)
    if (error) throw failure(error)
  }
  markLocalWrite('projects')
}

/** Deleting a project orphans its tasks rather than deleting them: clear the
 *  pointer on the server too, or the next load hands it back. */
export async function orphanProjectTasks(projectId: string): Promise<void> {
  const uid = await userId()
  const { error } = await supabase.from('tasks')
    .update({ project_id: null, milestone_id: null })
    .eq('user_id', uid).eq('project_id', projectId)
  // Before 20260042 there is no column to clear, and nothing points at it.
  if (error && error.code !== '42703' && !isMissing(error)) throw failure(error)
}
