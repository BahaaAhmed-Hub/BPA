// ─── When a quote comes back ─────────────────────────────────────────────────
// A small SM-2-style scheduler, kept deliberately plain so its behaviour can be
// read off the table in the tests: a right answer pushes the next one further
// out, a wrong one brings it back tomorrow, and how fast the gap grows is the
// quote's own `ease`. Pure — dates in, dates out.
import { addDays } from './trackerStats'
import { hasWords } from './dailyQuote'
import type { Grade, Quote, QuoteReview } from './types'

export const START_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_EASE = 3.0
export const MAX_INTERVAL = 365
/** New quotes introduced per day: a backlog of 200 saved quotes is not 200 cards tomorrow. */
export const NEW_PER_DAY = 5
/** One sitting. More can be asked for; a first screen of fifty is how a habit ends. */
export const SESSION_CAP = 20

export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']

/** What the review is before the first answer. */
const FRESH = { intervalDays: 0, ease: START_EASE, reps: 0, lapses: 0 }
type State = Pick<QuoteReview, 'intervalDays' | 'ease' | 'reps' | 'lapses'>

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** The next state after an answer. `prev` is null for a quote never reviewed. */
export function next(prev: State | null, grade: Grade): State {
  const p = prev ?? FRESH
  switch (grade) {
    case 'again':
      // Forgotten: back tomorrow, and the gap will grow more slowly from here. A lapse is only a lapse
      // if it was known — a new quote you get wrong has not been forgotten, only not learned yet.
      return { intervalDays: 1, ease: clamp(p.ease - 0.2, MIN_EASE, MAX_EASE), reps: 0, lapses: p.lapses + (p.reps > 0 ? 1 : 0) }
    case 'hard':
      return { intervalDays: clamp(Math.max(1, Math.round(p.intervalDays * 1.2)), 1, MAX_INTERVAL), ease: clamp(p.ease - 0.15, MIN_EASE, MAX_EASE), reps: p.reps + 1, lapses: p.lapses }
    case 'good': {
      const days = p.reps === 0 ? 1 : p.reps === 1 ? 3 : Math.max(p.intervalDays + 1, Math.round(p.intervalDays * p.ease))
      return { intervalDays: clamp(days, 1, MAX_INTERVAL), ease: p.ease, reps: p.reps + 1, lapses: p.lapses }
    }
    case 'easy': {
      const days = p.reps === 0 ? 4 : p.reps === 1 ? 7 : Math.max(p.intervalDays + 2, Math.round(p.intervalDays * p.ease * 1.3))
      return { intervalDays: clamp(days, 1, MAX_INTERVAL), ease: clamp(p.ease + 0.15, MIN_EASE, MAX_EASE), reps: p.reps + 1, lapses: p.lapses }
    }
  }
}

/** The review record after answering today. */
export function schedule(quoteId: string, prev: QuoteReview | null, grade: Grade, today: string): QuoteReview {
  const s = next(prev, grade)
  return { quoteId, ...s, dueOn: addDays(today, s.intervalDays), firstOn: prev?.firstOn ?? today, lastOn: today }
}

/** "1 day", "9 days", "3 mo", "1 y" — what a button promises. */
export function intervalLabel(days: number): string {
  if (days <= 1) return '1 day'
  if (days < 30) return `${days} days`
  if (days < 365) return `${Math.round(days / 30)} mo`
  return '1 y'
}

/** What each button would schedule, for the labels on them. */
export function previews(prev: QuoteReview | null): Record<Grade, string> {
  return Object.fromEntries(GRADES.map(g => [g, intervalLabel(next(prev, g).intervalDays)])) as Record<Grade, string>
}

export interface Queue {
  /** Asked before their day is out, most overdue first. */
  due: Quote[]
  /** Never asked, oldest first, limited by how many new ones today has room for. */
  fresh: Quote[]
  /** The sitting: due first, then new, capped. */
  session: Quote[]
  /** The earliest future due date, for "next review" when nothing is waiting. */
  nextDue: string | null
  /** Everything waiting right now, before the sitting's cap — what the tab shows. */
  waiting: number
}

export function buildQueue(quotes: Quote[], reviews: QuoteReview[], today: string, opts: { newPerDay?: number; cap?: number } = {}): Queue {
  const newPerDay = opts.newPerDay ?? NEW_PER_DAY, cap = opts.cap ?? SESSION_CAP
  const byId = new Map(reviews.map(r => [r.quoteId, r]))
  const pool = quotes.filter(hasWords)
  const due = pool
    .filter(q => { const r = byId.get(q.id); return !!r && r.dueOn <= today })
    .sort((a, b) => byId.get(a.id)!.dueOn.localeCompare(byId.get(b.id)!.dueOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  // Introduced today counts everything first reviewed today — including the ones already answered — so
  // reviewing five new quotes and coming back an hour later does not hand you five more.
  const introduced = reviews.filter(r => r.firstOn === today && byId.has(r.quoteId) && pool.some(q => q.id === r.quoteId)).length
  const room = Math.max(0, newPerDay - introduced)
  const fresh = pool.filter(q => !byId.has(q.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, room)
  const future = pool.map(q => byId.get(q.id)?.dueOn).filter((d): d is string => !!d && d > today).sort()
  return { due, fresh, session: [...due, ...fresh].slice(0, cap), nextDue: future[0] ?? null, waiting: due.length + fresh.length }
}
