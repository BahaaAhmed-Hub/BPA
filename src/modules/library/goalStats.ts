// ─── Where a yearly goal stands, counted from the log ────────────────────────
// A goal stores a target and a year. Progress, the pace it asks for and whether
// you are on it are all derived here from finished books and the session log,
// so a corrected finish date or a deleted session moves the bar by itself, and
// two devices cannot disagree about it. Pure, so a test needs no browser.
import { daysBetween } from './trackerStats'
import { fmtMinutes, todayISO } from './readingStats'
import type { Book, GoalKind, ListBook, ReadingGoal, ReadingSession } from './types'

export type GoalState =
  | 'done'      // the target is met
  | 'ahead'     // comfortably more than the year so far asks for
  | 'on'        // about what the year so far asks for
  | 'behind'    // less than the year so far asks for
  | 'missed'    // the year is over and the target was not met
  | 'upcoming'  // the year has not started
  | 'starting'  // too early in the year to say anything fair

/** Before this many days into the year there is nothing fair to compare against. */
export const GRACE_DAYS = 14

export interface GoalStatus {
  state: GoalState
  progress: number
  target: number
  remaining: number
  /** 0–100, capped: a goal exceeded is a full bar, with the real figure beside it. */
  pct: number
  /** What the year so far asks for, linearly. */
  expected: number
  daysLeft: number
  /** What each remaining day has to bring to still land it. null once met or over. */
  perDay: number | null
  /** Where the current rate ends the year, or null before there is a rate to read. */
  projected: number | null
}

export const KIND_LABEL: Record<GoalKind, string> = { books: 'Books', pages: 'Pages', minutes: 'Time' }

/** "3 books", "1 book", "1,200 pages", "2 h 5 min". */
export function fmtAmount(kind: GoalKind, n: number): string {
  if (kind === 'minutes') return fmtMinutes(Math.round(n))
  const v = Math.round(n)
  const unit = kind === 'books' ? (v === 1 ? 'book' : 'books') : (v === 1 ? 'page' : 'pages')
  return `${v.toLocaleString('en-US')} ${unit}`
}

/** "3 of 24 books", "70 of 1,000 pages", "1 h 35 min of 100 h" — the unit once, at the end, where a count has one. */
export function fmtProgress(kind: GoalKind, progress: number, target: number): string {
  if (kind === 'minutes') return `${fmtAmount(kind, progress)} of ${fmtAmount(kind, target)}`
  return `${Math.round(progress).toLocaleString('en-US')} of ${fmtAmount(kind, target)}`
}

const yearOf = (iso: string) => Number(iso.slice(0, 4))

/** The books a goal counts: all of them, or — for a challenge — those on its list. */
export function booksInScope(goal: Pick<ReadingGoal, 'listId'>, books: Book[], links: ListBook[]): Set<string> {
  if (!goal.listId) return new Set(books.map(b => b.id))
  const on = new Set(links.filter(l => l.listId === goal.listId).map(l => l.bookId))
  return new Set(books.filter(b => on.has(b.id)).map(b => b.id))
}

/** What the goal has counted so far. Pages are *new ground* (re-reading adds none), as everywhere else. */
export function goalProgress(goal: ReadingGoal, books: Book[], links: ListBook[], sessions: ReadingSession[]): number {
  const scope = booksInScope(goal, books, links)
  const inYear = (iso?: string) => !!iso && yearOf(iso) === goal.year
  if (goal.kind === 'books') return books.filter(b => scope.has(b.id) && inYear(b.finishedOn)).length
  let sum = 0
  for (const s of sessions) {
    if (!scope.has(s.bookId) || !inYear(s.on)) continue
    if (goal.kind === 'minutes') sum += s.minutes
    else if (s.kind === 'read') sum += s.pages ?? 0
  }
  return sum
}

const daysInYear = (y: number) => daysBetween(`${y}-01-01`, `${y + 1}-01-01`)

export function goalStatus(goal: ReadingGoal, books: Book[], links: ListBook[], sessions: ReadingSession[], today: string = todayISO()): GoalStatus {
  const progress = goalProgress(goal, books, links, sessions)
  const target = goal.target
  const remaining = Math.max(0, target - progress)
  const pct = Math.min(100, Math.round((progress / target) * 100))
  const total = daysInYear(goal.year)
  const first = `${goal.year}-01-01`
  const last = `${goal.year}-12-31`

  const base = { progress, target, remaining, pct }
  if (progress >= target) return { ...base, state: 'done', expected: target, daysLeft: 0, perDay: null, projected: progress }
  if (today > last) return { ...base, state: 'missed', expected: target, daysLeft: 0, perDay: null, projected: progress }
  if (today < first) return { ...base, state: 'upcoming', expected: 0, daysLeft: total, perDay: remaining / total, projected: null }

  const elapsed = daysBetween(first, today) + 1            // today counts as a day of the year
  const daysLeft = daysBetween(today, last) + 1            // and as a day left to read in
  const expected = (target * elapsed) / total
  const perDay = remaining / daysLeft
  const projected = elapsed >= GRACE_DAYS ? (progress / elapsed) * total : null

  let state: GoalState
  if (elapsed < GRACE_DAYS) state = 'starting'
  else if (progress >= expected * 1.1) state = 'ahead'
  // A book is a lump: being 0.4 of a book short of a straight line is not being behind.
  else if (progress >= expected * 0.9 || (goal.kind === 'books' && expected - progress < 1)) state = 'on'
  else state = 'behind'
  return { ...base, state, expected, daysLeft, perDay, projected }
}

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  done: 'Done', ahead: 'Ahead', on: 'On track', behind: 'Behind', missed: 'Missed', upcoming: 'Not started', starting: 'Just started',
}

/** Never colour alone: the word is always beside it. */
export const GOAL_STATE_INK: Record<GoalState, string> = {
  done: 'var(--sb-positive)', ahead: 'var(--sb-positive)', on: 'var(--sb-positive)',
  behind: 'var(--sb-accent-deep)', missed: 'var(--sb-negative)', upcoming: 'var(--sb-ink-3)', starting: 'var(--sb-ink-3)',
}

/** One sentence naming the figures the state rests on. */
export function goalSentence(kind: GoalKind, st: GoalStatus): string {
  const left = fmtAmount(kind, st.remaining)
  switch (st.state) {
    case 'done': return st.progress > st.target ? `Met, with ${fmtAmount(kind, st.progress - st.target)} to spare.` : 'Met.'
    case 'missed': return `The year ended ${left} short.`
    case 'upcoming': return `${fmtAmount(kind, st.target)} to read over the year.`
    default: {
      const need = st.perDay
      if (need === null) return ''
      // A book a week is a pace you can feel; 0.03 of a book a day is not.
      const pace = kind === 'books'
        ? (need >= 1 / 7 ? `about ${Math.round(need * 7 * 10) / 10} a week` : `one every ${Math.max(1, Math.round(1 / need))} days`)
        : kind === 'pages' ? `${Math.ceil(need)} pages a day` : `${fmtMinutes(Math.ceil(need))} a day`
      const tail = st.projected !== null && st.state !== 'on' && st.state !== 'ahead'
        ? ` At this rate the year ends on ${fmtAmount(kind, st.projected)}.` : ''
      if (st.state === 'starting') return `${left} to go — ${pace} from here.`
      return `${left} to go, ${st.daysLeft} days left: ${pace}.${tail}`
    }
  }
}
