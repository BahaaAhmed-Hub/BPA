// ─── What a reading plan says, worked out from the log ───────────────────────
// A plan stores a date and a time budget. Everything else — pages a day, the
// pace you are really keeping, the date you are heading for, whether that is
// on time — is derived here from the sessions, so it cannot drift from what was
// actually read. Pure, so a test can ask it questions without a browser.
import { addDays, daysBetween, periodTotals, weekStart } from './trackerStats'
import { progressOf, todayISO } from './readingStats'
import type { Book, ReadingPlan, ReadingSession } from './types'

/** How far back "your pace" looks. Shorter if the book is younger than this. */
export const PACE_WINDOW = 14

export type PlanState =
  | 'done'     // the book is finished (or the last page is reached)
  | 'ahead'    // the pace in hand beats what is needed by a margin
  | 'on'       // the pace in hand lands on or before the date
  | 'behind'   // the pace in hand lands after the date, or has stalled
  | 'late'     // the date has passed and the book is not done
  | 'unknown'  // nothing to judge by: no date, no page count, or nothing read yet

export interface PlanStatus {
  state: PlanState
  pagesLeft: number | null
  /** Days from today to the finish date, today counted; 0 once it has passed. */
  daysLeft: number | null
  needPerDay: number | null
  needPerWeek: number | null
  /** Pages a day actually kept over the pace window. */
  pacePerDay: number
  /** The day the current pace finishes the book, or null if it never will. */
  projected: string | null
  minutes: { target: number; per: 'day' | 'week'; done: number; left: number } | null
}

/** Pages a day over the last `PACE_WINDOW` days — or over the days since the
 *  first sitting, if that is fewer, so a book begun yesterday is not averaged
 *  against two weeks it did not exist for. */
export function pacePerDay(sessions: ReadingSession[], today: string = todayISO()): number {
  const read = sessions.filter(s => s.kind === 'read' && s.on <= today)
  if (read.length === 0) return 0
  const first = read.reduce((a, s) => (s.on < a ? s.on : a), read[0].on)
  const span = Math.min(PACE_WINDOW, daysBetween(first, today) + 1)
  const from = addDays(today, -(span - 1))
  const pages = read.filter(s => s.on >= from).reduce((a, s) => a + (s.pages ?? 0), 0)
  return pages / span
}

export function planStatus(book: Book, sessions: ReadingSession[], plan: ReadingPlan, today: string = todayISO()): PlanStatus {
  const mine = sessions.filter(s => s.bookId === book.id)
  const prog = progressOf(book, mine)
  const pagesLeft = book.pages ? Math.max(0, book.pages - (prog.page ?? 0)) : null
  const pace = pacePerDay(mine, today)
  const everRead = mine.some(s => s.kind === 'read')

  let minutes: PlanStatus['minutes'] = null
  if (plan.minutes) {
    const from = plan.per === 'week' ? weekStart(today) : today
    const to = plan.per === 'week' ? addDays(from, 6) : today
    const p = periodTotals(mine, from, to)
    const done = p.read + p.listen
    minutes = { target: plan.minutes, per: plan.per, done, left: Math.max(0, plan.minutes - done) }
  }

  const isDone = book.status === 'finished' || pagesLeft === 0
  const projected = pagesLeft && pace > 0 ? addDays(today, Math.ceil(pagesLeft / pace)) : null
  const base = { pagesLeft, pacePerDay: pace, projected, minutes }

  if (isDone) return { ...base, state: 'done', daysLeft: null, needPerDay: null, needPerWeek: null, projected: null }
  if (!plan.finishBy) return { ...base, state: 'unknown', daysLeft: null, needPerDay: null, needPerWeek: null }

  const daysLeft = Math.max(0, daysBetween(today, plan.finishBy) + 1)
  if (daysLeft === 0) return { ...base, state: 'late', daysLeft, needPerDay: null, needPerWeek: null }
  if (pagesLeft === null) return { ...base, state: 'unknown', daysLeft, needPerDay: null, needPerWeek: null }

  const needPerDay = Math.ceil(pagesLeft / daysLeft)
  const needPerWeek = Math.ceil((pagesLeft / daysLeft) * 7)
  let state: PlanState
  if (!everRead) state = 'unknown'
  else if (projected === null) state = 'behind' // read before, nothing in the window: stalled
  else if (projected > plan.finishBy) state = 'behind'
  else state = pace >= needPerDay * 1.25 ? 'ahead' : 'on'
  return { ...base, state, daysLeft, needPerDay, needPerWeek }
}

/** The date a plan opens with: where the current pace lands, or a month out. */
export function suggestedFinish(book: Book, sessions: ReadingSession[], today: string = todayISO()): string {
  const mine = sessions.filter(s => s.bookId === book.id)
  const left = book.pages ? Math.max(0, book.pages - (progressOf(book, mine).page ?? 0)) : 0
  const pace = pacePerDay(mine, today)
  if (left > 0 && pace > 0) return addDays(today, Math.max(1, Math.ceil(left / pace)))
  return addDays(today, 30)
}

export const STATE_LABEL: Record<PlanState, string> = {
  done: 'Finished', ahead: 'Ahead', on: 'On track', behind: 'Behind', late: 'Past its date', unknown: 'Not enough yet',
}

/** "Tue 15 Sep" — a date in the reader's own words, for sentences. */
export const niceDay = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** One sentence for the state, naming the figures it rests on. */
export function planSentence(st: PlanStatus): string {
  const pace = st.pacePerDay > 0 ? `${Math.round(st.pacePerDay * 10) / 10} pages a day` : null
  switch (st.state) {
    case 'done': return 'This book is finished.'
    case 'late': return `The date has passed with ${st.pagesLeft ?? 'some'} pages to go.`
    case 'unknown':
      if (st.daysLeft !== null && st.needPerDay !== null) return `You need ${st.needPerDay} pages a day. Log a session to see if your pace gets there.`
      if (st.daysLeft !== null) return 'Add the page count to the book to see the pace it needs.'
      return st.minutes ? 'A time budget only — set a finish date to plan the pages.' : 'Set a finish date or a time budget.'
    case 'behind':
      return st.projected
        ? `You need ${st.needPerDay} pages a day; at ${pace} you reach the end on ${niceDay(st.projected)}.`
        : `You need ${st.needPerDay} pages a day and nothing has been read in the last two weeks.`
    default: return `You need ${st.needPerDay} pages a day; you are keeping ${pace}.`
  }
}

/** Which token carries a state — never colour alone: the word is always beside it. */
export const STATE_INK: Record<PlanState, string> = {
  done: 'var(--sb-positive)', ahead: 'var(--sb-positive)', on: 'var(--sb-positive)',
  behind: 'var(--sb-accent-deep)', late: 'var(--sb-negative)', unknown: 'var(--sb-ink-3)',
}
