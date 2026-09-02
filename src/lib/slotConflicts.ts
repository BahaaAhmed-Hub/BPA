// ─── Is that slot free? ──────────────────────────────────────────────────────
// Picking a time for a task is a guess unless you can see what is already
// there. This reads the day once and then answers instantly as the time moves,
// so the answer keeps up with the picker rather than trailing it.

import { useEffect, useState } from 'react'
import { fetchVisibleEvents } from '@/lib/calendarEvents'
import type { GCalEvent } from '@/lib/googleCalendar'

export interface Conflict {
  id: string
  title: string
  /** "09:30", in the viewer's own clock. */
  from: string
  to: string
}

/** A day's events, kept briefly so nudging the time does not re-ask Google. */
const cache = new Map<string, { at: number; events: GCalEvent[] }>()
const TTL_MS = 60_000

async function eventsForDay(dateStr: string): Promise<GCalEvent[]> {
  const hit = cache.get(dateStr)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events
  const start = new Date(`${dateStr}T00:00:00`)
  const end   = new Date(`${dateStr}T23:59:59`)
  const events = await fetchVisibleEvents(start, end)
  cache.set(dateStr, { at: Date.now(), events })
  return events
}

/** Call after writing to a calendar, so the next check does not answer from a
 *  day that has since changed. */
export function forgetDay(dateStr?: string): void {
  if (dateStr) cache.delete(dateStr); else cache.clear()
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Everything already booked over [from, to) on that day. An all-day event is
 *  not a clash — it does not occupy an hour. */
export function overlapping(events: GCalEvent[], from: string, to: string, ignoreId?: string): Conflict[] {
  const s = toMinutes(from)
  const e = Math.max(toMinutes(to), s + 1)
  const out: Conflict[] = []
  for (const ev of events) {
    if (ev.id === ignoreId) continue
    if (!ev.start.dateTime || !ev.end.dateTime) continue
    if (ev.status === 'cancelled') continue
    const evFrom = hhmm(ev.start.dateTime)
    const evTo   = hhmm(ev.end.dateTime)
    if (s < toMinutes(evTo) && e > toMinutes(evFrom)) {
      out.push({ id: ev.id, title: ev.summary ?? '(No title)', from: evFrom, to: evTo })
    }
  }
  return out.sort((a, b) => toMinutes(a.from) - toMinutes(b.from))
}

/** The day is fetched when the date changes; the overlap is recomputed on every
 *  keystroke of the time, from what is already in hand. */
export function useSlotConflicts(dateStr: string | undefined, from: string, to: string, ignoreId?: string) {
  const [events, setEvents] = useState<GCalEvent[] | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!dateStr) { setEvents(null); return }
    let live = true
    setChecking(true)
    eventsForDay(dateStr)
      .then(evs => { if (live) setEvents(evs) })
      .catch(() => { if (live) setEvents(null) })
      .finally(() => { if (live) setChecking(false) })
    return () => { live = false }
  }, [dateStr])

  return {
    /** null while the day is unknown — say nothing rather than "no clash". */
    conflicts: events ? overlapping(events, from, to, ignoreId) : null,
    checking,
  }
}
