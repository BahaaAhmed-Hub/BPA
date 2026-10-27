import { HABIT_TEMPLATES } from '@/lib/habitTemplates'
import type { StepCtx } from './types'

/** The presets worth offering up front. The Habits screen holds the whole list of twelve. */
export const STARTER_HABITS = HABIT_TEMPLATES.slice(0, 6)

/** A few habits to begin with, written to Habits when the step is left. Tasks need nothing from you: they sort themselves into four quadrants. */
export function HabitsStep({ w, set }: StepCtx) {
  return (
    <>
      <div>
        <span className="wz-lab" id="wz-habits">Starter habits</span>
        <div className="wz-chips" role="group" aria-labelledby="wz-habits">
          {STARTER_HABITS.map(t => (
            <button key={t.id} type="button" className="wz-chip" aria-pressed={w.habits.includes(t.id)}
              onClick={() => set(p => ({ habits: p.habits.includes(t.id) ? p.habits.filter(x => x !== t.id) : [...p.habits, t.id] }))}>{t.name}</button>
          ))}
        </div>
      </div>
      <p className="wz-note">Tasks sort themselves into four quadrants: do now, plan, delegate, drop. There is more to pick from in Habits whenever you like.</p>
    </>
  )
}
