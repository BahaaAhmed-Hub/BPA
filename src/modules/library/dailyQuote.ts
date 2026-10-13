// ─── Which of your quotes is today's ─────────────────────────────────────────
// Deterministic, so every device shows the same one all day without storing
// anything: the quotes are put in a fixed order and the day number picks the
// place in it. Walking the order (rather than hashing the date) means every
// quote comes round once before any repeats — a random pick would show the same
// line twice in a week and never show another.
import { daysBetween } from './trackerStats'
import type { Quote } from './types'

/** A quote that can be shown as words: a photographed page with nothing typed has none. */
export const hasWords = (q: Pick<Quote, 'body'>): boolean => !!q.body && q.body.trim().length > 0

/** The same order everywhere, whatever order the server returned them in. */
export function inOrder<T extends Pick<Quote, 'id' | 'createdAt'>>(quotes: T[]): T[] {
  return [...quotes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/**
 * `shift` is "Another": a session-only step past today's, which wraps both ways
 * so no number of presses runs off the end.
 */
export function quoteOfTheDay<T extends Pick<Quote, 'id' | 'createdAt' | 'body'>>(quotes: T[], today: string, shift = 0): T | null {
  const pool = inOrder(quotes.filter(hasWords))
  if (!pool.length) return null
  const day = daysBetween('1970-01-01', today)
  const i = (((day + shift) % pool.length) + pool.length) % pool.length
  return pool[i]
}
