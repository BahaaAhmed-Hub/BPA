import type { Goal } from './types'

// ─── Goal fields the server may not have yet ─────────────────────────────────
// rank, deadline and currency arrive with 20260010. Until it runs, saveGoal
// drops what the server has not got — so keep them here as well, or a rank set
// on Monday is gone on Tuesday. The server's value wins wherever it has one:
// this is a stand-in, not a second source of truth.

const KEY = 'finance-goal-planning'

type Extra = { rank?: number; deadline?: string; currency?: string }

function read(): Record<string, Extra> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Extra>) : {}
  } catch { return {} }
}

export function rememberGoalPlanning(g: Goal): void {
  const all = read()
  const extra: Extra = {}
  if (typeof g.rank === 'number') extra.rank = g.rank
  if (g.deadline) extra.deadline = g.deadline
  if (g.currency) extra.currency = g.currency
  if (Object.keys(extra).length === 0) delete all[g.id]
  else all[g.id] = extra
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* quota */ }
}

export function forgetGoalPlanning(id: string): void {
  const all = read()
  delete all[id]
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* quota */ }
}

export function withLocalPlanning(goals: Goal[]): Goal[] {
  const all = read()
  return goals.map(g => {
    const extra = all[g.id]
    if (!extra) return g
    return {
      ...g,
      rank:     g.rank     ?? extra.rank,
      deadline: g.deadline ?? extra.deadline,
      currency: g.currency ?? (extra.currency as Goal['currency']),
    }
  })
}
