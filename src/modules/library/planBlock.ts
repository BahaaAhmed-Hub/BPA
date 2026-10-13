// ─── A plan's time, as one repeating block on the calendar ───────────────────
// Pure: given the book, the plan and a time of day it builds the Google event
// and a signature of what it was built from. The writing lives in PlanCard.
//
// **One recurring event, not a hundred.** A daily plan is `FREQ=DAILY;COUNT=n`,
// a weekly one `FREQ=WEEKLY`: one id to remember, one thing to remove, and the
// calendar draws the series the way it draws any other. COUNT rather than UNTIL:
// UNTIL on a timed event must be a UTC date-time, which turns "the finish day"
// into a timezone question that COUNT does not have.
import type { GCalEventCreate } from '@/lib/googleCalendar'
import { daysBetween, addDays } from './trackerStats'
import { todayISO } from './readingStats'
import type { Book, ReadingPlan } from './types'

/** No finish date: a month of blocks, not a series with no end. */
export const OPEN_ENDED_DAYS = 28
export const MAX_DAILY = 366
export const MAX_WEEKLY = 52

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** What a block is built from. If it differs from the stored one, the calendar is out of date. */
export function blockSig(book: Pick<Book, 'title'>, plan: Pick<ReadingPlan, 'minutes' | 'per' | 'finishBy'>, at: string): string {
  return [at, plan.minutes ?? '', plan.per, plan.finishBy ?? '', book.title].join('|')
}

export type BlockBuild = { ok: true; event: GCalEventCreate; sig: string; first: string; count: number } | { ok: false; error: string }

/** `nowHM`/`today` are parameters so a test can fix the clock. */
export function buildBlock(
  book: Book, plan: ReadingPlan, at: string, tz: string,
  today: string = todayISO(), nowHM: string = new Date().toTimeString().slice(0, 5),
): BlockBuild {
  if (!plan.minutes) return { ok: false, error: 'Set how many minutes first — the block is as long as that.' }
  if (!validTime(at)) return { ok: false, error: 'Pick a time of day.' }
  // Today if the time is still ahead of us, otherwise tomorrow: a block that starts in the past is a lie.
  const first = at > nowHM ? today : addDays(today, 1)
  const end = plan.finishBy ?? addDays(first, OPEN_ENDED_DAYS - 1)
  if (end < first) return { ok: false, error: 'The finish date has passed — move it, then block the time.' }
  const days = daysBetween(first, end) + 1
  const count = plan.per === 'day' ? Math.min(days, MAX_DAILY) : Math.min(Math.floor((days - 1) / 7) + 1, MAX_WEEKLY)
  const start = new Date(`${first}T${at}:00`)
  const stop = new Date(start.getTime() + plan.minutes * 60_000)
  const event: GCalEventCreate = {
    summary: `📖 Read: ${book.title}`,
    description: [
      `Reading time for “${book.title}”${book.authors.length ? ` by ${book.authors.join(', ')}` : ''}.`,
      plan.finishBy ? `Plan: finish by ${plan.finishBy}.` : '',
      'Made from the Library plan — change it there, not here.',
    ].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: stop.toISOString(), timeZone: tz },
    recurrence: [`RRULE:FREQ=${plan.per === 'day' ? 'DAILY' : 'WEEKLY'};COUNT=${count}`],
    reminders: { useDefault: true },
  }
  return { ok: true, event, sig: blockSig(book, plan, at), first, count }
}
