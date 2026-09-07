// ─── Which day a week starts on ──────────────────────────────────────────────
// Sunday-first was hard-coded in three places in the calendar (the week grid,
// the month grid and "is this this week?"), so a Saturday or Monday week was
// not something the app could be asked for. It is one answer, it belongs to
// you rather than to a browser, and every grid has to read the same one — so
// it lives here, rides in prefSync's shared keys, and announces itself when it
// changes so an open calendar redraws without a reload.

import { useEffect, useState } from 'react'

const KEY = 'professor-week-start'
export const WEEK_START_EVENT = 'professor:weekStartChanged'

/** 0 = Sunday … 6 = Saturday — the same numbering as `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

/** Sunday, which is what every grid did before this was a choice. */
export const DEFAULT_WEEK_START: Weekday = 0

export function loadWeekStart(): Weekday {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_WEEK_START
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 && n <= 6 ? n as Weekday : DEFAULT_WEEK_START
  } catch { return DEFAULT_WEEK_START }
}

export function saveWeekStart(day: Weekday): void {
  try { localStorage.setItem(KEY, String(day)) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(WEEK_START_EVENT, { detail: day }))
}

/** Midnight on the first day of the week `date` falls in. */
export function startOfWeek(date: Date, first: Weekday = loadWeekStart()): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() - first + 7) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}

/** Seven labels, rotated so the first one is the day the week starts on. */
export function rotateDays<T>(labels: readonly T[], first: Weekday): T[] {
  return Array.from({ length: 7 }, (_, i) => labels[(first + i) % 7])
}

/** The choice, kept current: another tab's `storage` event and this tab's own
 *  change event both land here, so Settings and the calendar never disagree. */
export function useWeekStart(): Weekday {
  const [day, setDay] = useState<Weekday>(() => loadWeekStart())
  useEffect(() => {
    const read = () => setDay(loadWeekStart())
    window.addEventListener(WEEK_START_EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(WEEK_START_EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return day
}
