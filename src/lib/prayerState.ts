import { pushSharedPrefs } from '@/lib/prefSync'
import {
  ALL_PRAYERS, dayMask, maskCount, type AsrSchool, type Place, type PrayerMethod,
} from '@/lib/prayer'
import {
  commitHabitLogs, loadLogs, loadQuantityLogs, useHabitsStore,
} from '@/store/habitsStore'

// ─── The prayer habit: what this account has chosen, and what it has done ───
//
// The habit itself is an ordinary quantity habit (goal 5, "prayers") so streaks, the day's share,
// Today and the Dashboard all keep working unchanged. What an ordinary habit cannot say is *which*
// prayers, or where the times come from — that rides in one shared pref key, which follows the
// person between devices like `professor-habit-steps` does, because the `habits` table has no
// column for it. `habit_logs.quantity` holds the count; `days` holds the mask behind that count.

const KEY = 'professor-prayer'
export const PRAYER_EVENT = 'professor:prayerUpdated'

export interface PrayerPlace extends Place { label?: string }

export interface PrayerState {
  /** Prayer times are read for this account (the Settings switch). */
  enabled: boolean
  /** The habit that carries the count. Absent until the habit is created or converted. */
  habitId?: string
  method: PrayerMethod
  school: AsrSchool
  /** Where the times are worked out for; null until the browser or the person says. */
  place: PrayerPlace | null
  /** `YYYY-MM-DD` → which prayers, as a 5-bit mask. */
  days: Record<string, number>
}

export const DEFAULT_PRAYER: PrayerState = { enabled: false, method: 'egyptian', school: 'standard', place: null, days: {} }

export function loadPrayerState(): PrayerState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_PRAYER, ...(JSON.parse(raw) as Partial<PrayerState>) } : { ...DEFAULT_PRAYER }
  } catch { return { ...DEFAULT_PRAYER } }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined
export function savePrayerState(next: PrayerState): void {
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* quota */ }
  window.dispatchEvent(new Event(PRAYER_EVENT))
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { void pushSharedPrefs() }, 1500)
}

export function patchPrayerState(patch: Partial<PrayerState>): PrayerState {
  const next = { ...loadPrayerState(), ...patch }
  savePrayerState(next)
  return next
}

/** The prayers done on a day, read from what is stored. */
export function readDay(state: PrayerState, date: string): number {
  if (!state.habitId) return 0
  const count = loadQuantityLogs()[state.habitId]?.[date]
  const ticked = (loadLogs()[state.habitId] ?? []).includes(date)
  return dayMask(state.days[date], count, ticked)
}

/** Record which prayers were done on a day — the mask, the count beside it, and the tick when all five. */
export function writeDay(date: string, mask: number): void {
  const state = loadPrayerState()
  if (!state.habitId) return
  const m = mask & ALL_PRAYERS, count = maskCount(m), id = state.habitId

  const days = { ...state.days }
  if (m === 0) delete days[date]; else days[date] = m
  savePrayerState({ ...state, days })

  const qty = loadQuantityLogs()
  const day = { ...(qty[id] ?? {}) }
  if (count === 0) delete day[date]; else day[date] = count
  const logs = loadLogs()
  const ticks = (logs[id] ?? []).filter(d => d !== date)
  if (count === 5) ticks.push(date)
  commitHabitLogs({ ...logs, [id]: ticks }, { ...qty, [id]: day })
  window.dispatchEvent(new Event('professor:habitLogsUpdated'))
}

/** The built-in habit's own shape: a quantity habit, five a day. The picture is the person's to change. */
export const PRAYER_HABIT = {
  name: 'Prayers', emoji: '🕌', color: 'var(--sb-accent)',   // ui-guard: emoji-ok
  frequency: 'daily' as const, isActive: true, type: 'quantity' as const, goal: 5, unit: 'prayers',
}

/** Turn prayer times on: reuse the habit this account already has, or make the built-in one. */
export function enablePrayers(): PrayerState {
  const state = loadPrayerState()
  const habits = useHabitsStore.getState().habits
  let id = state.habitId && habits.some(h => h.id === state.habitId) ? state.habitId : undefined
  if (!id) id = useHabitsStore.getState().addHabit({ ...PRAYER_HABIT })
  return patchPrayerState({ enabled: true, habitId: id })
}

export function disablePrayers(): PrayerState { return patchPrayerState({ enabled: false }) }
