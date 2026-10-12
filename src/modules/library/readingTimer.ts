// ─── A stopwatch for a sitting ───────────────────────────────────────────────
// Kept in localStorage as a *start time*, not a counter: a counter stops when the
// tab is closed or the phone locks, a start time does not. Elapsed is always
// `now - startedAt`, so a reload, a sleeping iPad or another tab all agree.
// One timer at a time — you are only reading one thing — and per device on
// purpose: a stopwatch running on the laptop is not news the phone needs.
import { useSyncExternalStore } from 'react'
import type { SessionKind } from './types'

export interface Timer { bookId: string; kind: SessionKind; startedAt: number }

const KEY = 'library-timer'
const EVENT = 'library:timer'

function read(): Timer | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Timer> | null
    if (v && typeof v.bookId === 'string' && (v.kind === 'read' || v.kind === 'listen') && typeof v.startedAt === 'number') return v as Timer
  } catch { /* unreadable: no timer */ }
  return null
}

let cache = read()
const subscribe = (cb: () => void) => {
  const on = () => { cache = read(); cb() }
  window.addEventListener(EVENT, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
}
const write = (t: Timer | null) => {
  try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY) } catch { /* private window: the timer lives as long as the tab */ }
  cache = t
  window.dispatchEvent(new Event(EVENT))
}

export const useTimer = (): Timer | null => useSyncExternalStore(subscribe, () => cache, () => null)

export function startTimer(bookId: string, kind: SessionKind): void { if (!cache) write({ bookId, kind, startedAt: Date.now() }) }
export function discardTimer(): void { write(null) }

/** Whole minutes, never under one, never over a day (a timer left running
 *  overnight is a forgotten one; the form lets the real figure be typed). */
export const elapsedMinutes = (t: Timer, now: number = Date.now()): number =>
  Math.min(1440, Math.max(1, Math.round((now - t.startedAt) / 60000)))

/** Stops it and says what it measured. */
export function stopTimer(): { bookId: string; kind: SessionKind; minutes: number; startedAt: number } | null {
  const t = cache
  if (!t) return null
  write(null)
  return { bookId: t.bookId, kind: t.kind, minutes: elapsedMinutes(t), startedAt: t.startedAt }
}
