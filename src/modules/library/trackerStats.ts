// ─── Reading numbers across all books ────────────────────────────────────────
// Pure functions of the session log, so a figure on the Tracker has one place
// that decides it and a test can ask it a question without a browser.
//
// **Dates are YYYY-MM-DD strings in the reader's own calendar**, and all date
// arithmetic goes through noon-local Dates: adding 86 400 000 ms to midnight
// lands on the wrong day across a clock change (23- and 25-hour days), which
// would put a Sunday session in Monday's bar twice a year.
import { todayISO } from './readingStats'
import type { ReadingSession } from './types'

const at = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12) }

export function addDays(iso: string, n: number): string {
  const d = at(iso); d.setDate(d.getDate() + n); return todayISO(d)
}

/** The Monday on or before `iso` — weeks run Monday to Sunday. */
export function weekStart(iso: string): string {
  const dow = (at(iso).getDay() + 6) % 7      // Mon=0 … Sun=6
  return addDays(iso, -dow)
}

export const dayRange = (start: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(start, i))

export interface Minutes { read: number; listen: number }
export const total = (m: Minutes) => m.read + m.listen

export function byDay(sessions: ReadingSession[]): Map<string, Minutes> {
  const out = new Map<string, Minutes>()
  for (const s of sessions) {
    const m = out.get(s.on) ?? { read: 0, listen: 0 }
    m[s.kind] += s.minutes
    out.set(s.on, m)
  }
  return out
}

export interface Streaks { current: number; longest: number; today: boolean }

/**
 * Days in a row with at least one session, of either kind.
 *
 * **The current streak survives a day with nothing logged *yet*.** At 08:00 you
 * have not read today, and a number that read 0 every morning would be a streak
 * that breaks itself; it is alive until a whole day has gone by. `today` says
 * whether today is already in it.
 */
export function streaks(sessions: ReadingSession[], today: string = todayISO()): Streaks {
  const days = new Set(sessions.filter(s => s.on <= today).map(s => s.on))
  const sorted = [...days].sort()
  let longest = 0, run = 0, prev: string | null = null
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    longest = Math.max(longest, run); prev = d
  }
  let current = 0
  let cursor = days.has(today) ? today : addDays(today, -1)
  while (days.has(cursor)) { current++; cursor = addDays(cursor, -1) }
  return { current, longest, today: days.has(today) }
}

export interface Period extends Minutes { pages: number; sessions: number }

/** Totals for `from`…`to`, both inclusive. */
export function periodTotals(sessions: ReadingSession[], from: string, to: string): Period {
  const p: Period = { read: 0, listen: 0, pages: 0, sessions: 0 }
  for (const s of sessions) {
    if (s.on < from || s.on > to) continue
    p[s.kind] += s.minutes; p.sessions++
    if (s.kind === 'read') p.pages += s.pages ?? 0
  }
  return p
}

export interface Bucket extends Minutes { start: string; label: string }

/** `weeks` consecutive Monday-to-Sunday buckets ending with the current week. */
export function weekBuckets(sessions: ReadingSession[], today: string, weeks: number): Bucket[] {
  const first = addDays(weekStart(today), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(first, 7 * i)
    const p = periodTotals(sessions, start, addDays(start, 6))
    return { start, read: p.read, listen: p.listen, label: at(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }
  })
}

export const finishedIn = (books: { finishedOn?: string }[], year: number): number =>
  books.filter(b => b.finishedOn?.startsWith(`${year}-`)).length
