// ─── Noticing that the rank moved ────────────────────────────────────────────
//
// `evaluateRank` answers what the rank *is*, out of the tasks and habits on the
// device. A notification is about a **change**, which needs a memory of what it
// was — so this keeps one, and the bell reads it.
//
// Two rules:
// - **The first evaluation is a baseline, not news.** Opening the app for the
//   first time and being told "you are now a Ronin" is a fact about an empty
//   ledger, not about anything you did.
// - **It only runs while Behavioral OS is on.** With it off there is no rank on
//   screen anywhere, and a notification about one would be about a number the
//   person has not asked to see.

import { evaluateRank, RANK_META } from '@/lib/behavioralEngine'
import { useBehavioralStore, type Rank } from '@/store/behavioralStore'
import { useTaskStore } from '@/store/taskStore'
import { loadHabits, loadLogs } from '@/store/habitsStore'

const KEY = 'professor-rank-history'
/** A move older than this is not news either. */
const FRESH_DAYS = 7

export interface RankNote { rank: Rank; score: number; at: string }

function load(): RankNote[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RankNote[] } catch { return [] }
}

function save(notes: RankNote[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(notes.slice(-10))) } catch { /* quota */ }
}

/**
 * Work the rank out and remember it if it has moved. Cheap — it is arithmetic
 * over the task list and the habit logs, both already in memory — so the
 * notification tick can call it.
 */
export function checkRank(now = new Date()): void {
  if (!useBehavioralStore.getState().enabled) return
  const result = evaluateRank(useTaskStore.getState().tasks, loadHabits(), loadLogs())
  const notes = load()
  const last = notes[notes.length - 1]
  if (last?.rank === result.rank) return
  save([...notes, { rank: result.rank, score: result.score, at: now.toISOString() }])
}

export interface RankChange { from: Rank; to: Rank; up: boolean; score: number; at: string }

/** The last move, if there was one and it is recent. Null on a first sighting:
 *  there is nothing to compare it with. */
export function lastRankChange(now = new Date()): RankChange | null {
  const notes = load()
  if (notes.length < 2) return null
  const to = notes[notes.length - 1]
  const from = notes[notes.length - 2]
  if (now.getTime() - new Date(to.at).getTime() > FRESH_DAYS * 86400_000) return null
  return {
    from: from.rank, to: to.rank,
    up: RANK_META[to.rank].threshold > RANK_META[from.rank].threshold,
    score: to.score, at: to.at,
  }
}
