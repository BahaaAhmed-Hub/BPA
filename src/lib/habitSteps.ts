import type { Habit } from '@/store/habitsStore'

// ─── How much one tap is worth ───────────────────────────────────────────────
//
// A measurable habit was counted one at a time, which is right for glasses of
// water and wrong for almost anything measured in real units: 200 ml at one
// millilitre a tap is two hundred taps. So a habit can say what a tap adds.
//
// It lives beside the habits rather than in them because the `habits` table has
// no column for it, and a habit that cannot be saved is worse than a habit that
// counts in ones. It rides in prefSync's shared keys, so the answer follows you
// between devices like the rest of your work.

const KEY = 'professor-habit-steps'

export function loadHabitSteps(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch { return {} }
}

export function saveHabitSteps(map: Record<string, number>): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* quota */ }
  window.dispatchEvent(new Event('professor:habitStepsUpdated'))
}

export function setHabitStep(habitId: string, step: number | null): void {
  const next = { ...loadHabitSteps() }
  if (step === null || step <= 1) delete next[habitId]
  else next[habitId] = step
  saveHabitSteps(next)
}

/**
 *  What one tap adds. A habit that has never said takes a sensible guess from
 *  its own numbers rather than 1: a target of 200 in millilitres is not two
 *  hundred taps, and nobody would set it up that way on purpose.
 */
export function stepFor(habit: Pick<Habit, 'id' | 'goal' | 'unit'>, steps = loadHabitSteps()): number {
  const set = steps[habit.id]
  if (set && set > 0) return set
  const goal = habit.goal ?? 0
  const unit = (habit.unit ?? '').trim().toLowerCase()
  if (goal <= 20) return 1                      // glasses, pages, sets
  if (/^(ml|millilit|mls)/.test(unit)) return goal >= 1000 ? 250 : 100
  if (/^(g|gram|grams)$/.test(unit))   return 50
  if (/(step|steps)/.test(unit))       return 1000
  if (/(m|min|minute|minutes)$/.test(unit)) return goal >= 120 ? 15 : 5
  // Anything else big: a tenth, rounded to something you would say out loud.
  const tenth = goal / 10
  const nice = [1, 5, 10, 25, 50, 100, 250, 500, 1000]
  return nice.reduce((best, n) => Math.abs(n - tenth) < Math.abs(best - tenth) ? n : best, 1)
}
