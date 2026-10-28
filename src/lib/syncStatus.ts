// ─── When syncing is quietly doing less than it should ───────────────────────
// Habit sync swallowed every error, and a write that falls back to the columns
// that existed before a migration succeeds — so a database missing those
// columns looked exactly like everything working. Pictures simply never
// appeared on the second device and nothing said why.
//
// This records that gap so the app can say it out loud.

export type SyncEntity = 'habits' | 'tasks' | 'companies' | 'projects'

export interface SyncGap {
  entity: SyncEntity
  /** 'columns' — the database really has not been migrated.
   *  'cache'   — the columns exist, but Supabase's API layer is still serving
   *              a schema it cached before they did. Different problem, and a
   *              different fix, so it must not be reported as the first.
   *  'tables'  — a whole table is absent (projects), so nothing is being saved.
   *  'error'   — it failed outright. */
  kind: 'columns' | 'cache' | 'error' | 'tables'
  detail?: string
  at: number
}

const gaps = new Map<SyncEntity, SyncGap>()
const listeners = new Set<() => void>()

function announce() { for (const l of listeners) l() }

export function reportSyncGap(entity: SyncEntity, kind: SyncGap['kind'], detail?: string): void {
  const existing = gaps.get(entity)
  if (existing && existing.kind === kind && existing.detail === detail) return
  gaps.set(entity, { entity, kind, detail, at: Date.now() })
  announce()
}

/** `onlyKinds` limits what a success may clear: a push that worked says the tables are there and
 *  the server is answering, not that a column it is still leaving out has appeared. */
export function clearSyncGap(entity: SyncEntity, onlyKinds?: SyncGap['kind'][]): void {
  const g = gaps.get(entity)
  if (!g || (onlyKinds && !onlyKinds.includes(g.kind))) return
  gaps.delete(entity)
  announce()
}

export function getSyncGaps(): SyncGap[] {
  return [...gaps.values()]
}

export function onSyncGapsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** The migrations whose absence causes the fallback, so the message can name
 *  the fix rather than describing the symptom. */
export const MIGRATION_FOR: Record<SyncEntity, string> = {
  habits: '20260002_habit_appearance.sql',
  tasks:  '20260003_task_full_sync.sql',
  companies: '20260011_company_hidden.sql',
  projects: '20260042_projects.sql',
}
