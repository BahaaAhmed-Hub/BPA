// ─── Wall clocks and zones ───────────────────────────────────────────────────
//
// A time with a TZID is a reading on a clock in that zone, and the same reading
// is a different instant in March and in August. Everything here asks Intl —
// the browser's own tz database — rather than trusting a VTIMEZONE block or the
// reader's zone. Two shapes are used throughout:
// - an **instant**: a Date, or its epoch ms;
// - a **wall clock**: a Date whose *UTC* fields carry the reading — year, month,
//   day, hour, minute — so it can be stepped through a calendar with no DST in
//   the way and turned back into an instant once the zone is known.

/** How far `tz` is from UTC at `at`, in ms — summer time included. */
export function zoneOffset(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at))
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  // Some ICU builds write midnight as hour 24 under hour12:false.
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - at
}

/** The instant a wall-clock reading in `tz` corresponds to. `mo` is 1-based. */
export function fromZone(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  // Guess that the wall clock is UTC, measure how far that lands from the zone,
  // and correct. The second pass settles the hour a clock change falls in.
  let t = wall - zoneOffset(wall, tz)
  t = wall - zoneOffset(t, tz)
  return t
}

/** What the clock in `tz` reads at `at`, as a wall clock. No zone → the reader's. */
export function wallOf(at: number, tz?: string): Date {
  if (!tz) {
    const d = new Date(at)
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))
  }
  return new Date(at + zoneOffset(at, tz))
}

/** The instant a wall clock names in `tz`. No zone → the reader's. */
export function instantOf(wall: Date, tz?: string): number {
  if (!tz) {
    return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(),
      wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds()).getTime()
  }
  return fromZone(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(),
    wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), tz)
}

/** A local Date carrying a wall clock's fields — for code that reads
 *  `getDay()`/`getDate()` and means the event's own calendar, not the reader's. */
export function wallAsLocal(wall: Date): Date {
  return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(),
    wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds())
}

/** Whether this browser's tz database has heard of `tz`. */
export function knownZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}
