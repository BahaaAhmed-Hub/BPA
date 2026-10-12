// ─── Reading numbers, derived from the log ───────────────────────────────────
// Nothing here is stored on the book. Progress is the furthest page any session
// reached, so deleting a mistaken session puts it back, two devices cannot
// disagree about it, and "how far am I" has exactly one source.
import type { ReadingSession } from './types'

/** Today as the reader's calendar sees it (YYYY-MM-DD, local) — a session
 *  logged at 00:30 belongs to the day you were up reading it, not to UTC. */
export function todayISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60), r = m % 60
  if (h === 0) return `${r} min`
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

export interface BookProgress {
  /** The furthest page any reading session reached, or null if none said. */
  page: number | null
  /** 0–100 against the book's page count, or null when either is unknown. */
  pct: number | null
  readMinutes: number
  listenMinutes: number
  sessions: number
}

export function progressOf(book: { pages?: number }, sessions: ReadingSession[]): BookProgress {
  let page: number | null = null
  let readMinutes = 0, listenMinutes = 0
  for (const s of sessions) {
    if (s.kind === 'read') { readMinutes += s.minutes; if (s.toPage !== undefined && (page === null || s.toPage > page)) page = s.toPage }
    else listenMinutes += s.minutes
  }
  const pct = page !== null && book.pages ? Math.min(100, Math.round((page / book.pages) * 100)) : null
  return { page, pct, readMinutes, listenMinutes, sessions: sessions.length }
}

/** Pages covered by a sitting that ended on `toPage`, or undefined if it did not
 *  go past where the last one ended (re-reading, or jumping back, is time spent
 *  but not progress). */
export function pagesCovered(previousFurthest: number | null, toPage: number | undefined): number | undefined {
  if (toPage === undefined) return undefined
  const from = previousFurthest ?? 0
  return toPage > from ? toPage - from : undefined
}
