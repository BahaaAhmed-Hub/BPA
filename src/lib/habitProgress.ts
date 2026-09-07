// ─── How much of a habit's day is done ───────────────────────────────────────
// Every figure on the habits screen used to be a count of *ticks*: a habit was
// done or it was not, and 6 of 8 glasses of water was worth exactly as much as
// none. That is the wrong shape for a measurable habit — the whole reason it
// carries a goal and a unit is that it is done by degrees — and it made the
// day's percentage jump from 0 to 100 with nothing in between.
//
// So one function answers it for everything: what fraction of this habit's day
// is done. A tick is 1. A measurable habit is its quantity over its goal,
// capped at 1, because 12 glasses is not 150% of a day.
//
// A *streak* is deliberately not built on this. A streak is a claim that the
// thing was done, on consecutive days, and a part-day does not extend it.

import type { Habit, HabitLogs, HabitQuantityLogs } from '@/store/habitsStore'

/** 0..1 for one habit on one day. */
export function dayProgress(
  habit: Habit,
  dateKey: string,
  logs: HabitLogs,
  qtyLogs: HabitQuantityLogs,
): number {
  if ((logs[habit.id] ?? []).includes(dateKey)) return 1
  if (habit.type !== 'quantity' || !habit.goal || habit.goal <= 0) return 0
  const qty = qtyLogs[habit.id]?.[dateKey] ?? 0
  if (qty <= 0) return 0
  return Math.min(1, qty / habit.goal)
}

/** Done as in finished — the tick, the streak, the "3 of 5 done today". */
export function isDayDone(
  habit: Habit,
  dateKey: string,
  logs: HabitLogs,
  qtyLogs: HabitQuantityLogs,
): boolean {
  return dayProgress(habit, dateKey, logs, qtyLogs) >= 1
}

export interface DayTotals {
  /** How many habits are finished. */
  done: number
  total: number
  /** The sum of every habit's part-day, so an unfinished one still counts. */
  progress: number
  /** `progress / total`, 0..1. */
  fraction: number
  /** The same as a whole-number percentage. */
  pct: number
}

/** One day across a set of habits. */
export function dayTotals(
  habits: Habit[],
  dateKey: string,
  logs: HabitLogs,
  qtyLogs: HabitQuantityLogs,
): DayTotals {
  const total = habits.length
  let done = 0
  let progress = 0
  for (const h of habits) {
    const p = dayProgress(h, dateKey, logs, qtyLogs)
    progress += p
    if (p >= 1) done++
  }
  const fraction = total > 0 ? progress / total : 0
  return { done, total, progress, fraction, pct: Math.round(fraction * 100) }
}

/** A span of days — the week strip, the month, a report's range. */
export function spanTotals(
  habits: Habit[],
  dateKeys: string[],
  logs: HabitLogs,
  qtyLogs: HabitQuantityLogs,
): DayTotals {
  const total = habits.length * dateKeys.length
  let done = 0
  let progress = 0
  for (const h of habits) {
    for (const d of dateKeys) {
      const p = dayProgress(h, d, logs, qtyLogs)
      progress += p
      if (p >= 1) done++
    }
  }
  const fraction = total > 0 ? progress / total : 0
  return { done, total, progress, fraction, pct: Math.round(fraction * 100) }
}
