// ─── What is actually free, out of the hours you opened ──────────────────────
//
// Two inputs, and they are not the same kind of thing. The **windows** are a
// wall clock: "09:00 to 17:00 on the 13th, every week" is a reading on a clock
// in Cairo, and the same reading is a different instant in March and in
// August. The **busy intervals** are instants, straight from Google. So the
// windows are converted to instants on the day they fall, at the offset in
// force that day, and everything after that is arithmetic on epoch ms.
//
// Getting that backwards — treating a window as a fixed UTC offset — is wrong
// twice a year, in opposite directions, for a fortnight at a time. It is also
// invisible: the slots look plausible, they are simply an hour out.
//
// Nothing here touches Deno, a network or a database, so `scripts/booking-
// slots.mjs` exercises this file itself rather than a copy of it.
//
// The zone helpers are `src/lib/zones.ts` restated. Deno cannot import the
// app's bundle — the same reason the mail rules exist twice — so the test
// compiles both and fails if the two ever disagree about an instant.

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

/** Whether this runtime's tz database has heard of `tz`. */
export function knownZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface WindowRow {
  /** YYYY-MM-DD — the first day this window applies. */
  on_date: string
  /** Minutes from midnight, in the owner's zone. */
  start_min: number
  end_min: number
  repeat?: { kind?: 'none' | 'weekly'; interval?: number; until?: string | null } | null
  /** Occurrences taken back, as YYYY-MM-DD. */
  skips?: string[] | null
}

export interface PlanRules {
  duration_minutes: number
  slot_step_minutes: number
  buffer_before: number
  buffer_after: number
  min_notice_minutes: number
  horizon_days: number
  max_per_day?: number | null
  /** Trims the shared windows for this plan, and can never widen them.
   *  `days` are 0 = Sunday … 6 = Saturday, read on the owner's clock. */
  narrow?: { days?: number[]; from?: number; to?: number } | null
}

export interface Interval { start: number; end: number }

const DAY_MS = 86400000

// ─── Dates ───────────────────────────────────────────────────────────────────

/** YYYY-MM-DD → the three numbers, with no zone anywhere near it. */
export function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m, d]
}

function dayNumber(date: string): number {
  const [y, m, d] = ymd(date)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

function dateOf(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10)
}

/** Which dates a window falls on inside `[from, to]`, both inclusive.
 *
 *  Calendar arithmetic on whole UTC days: stepping a week is +7 days with no
 *  zone in it at all, because "every Tuesday" is a statement about the
 *  calendar, not about elapsed time. The clock is applied afterwards.
 */
export function windowDates(w: WindowRow, from: string, to: string): string[] {
  const first = dayNumber(w.on_date)
  const lo = dayNumber(from)
  const hi = dayNumber(to)
  if (hi < first) return []

  const kind = w.repeat?.kind ?? 'none'
  const skips = new Set(w.skips ?? [])

  if (kind !== 'weekly') {
    const only = dateOf(first)
    return first >= lo && first <= hi && !skips.has(only) ? [only] : []
  }

  const everyDays = Math.max(1, w.repeat?.interval ?? 1) * 7
  const until = w.repeat?.until ? dayNumber(w.repeat.until) : null
  // Step to the first occurrence at or after `lo` rather than walking from
  // `on_date`, or a window opened two years ago costs a loop a hundred long.
  const skipped = lo > first ? Math.ceil((lo - first) / everyDays) : 0
  const out: string[] = []
  for (let d = first + skipped * everyDays; d <= hi; d += everyDays) {
    if (until !== null && d > until) break
    const date = dateOf(d)
    if (!skips.has(date)) out.push(date)
  }
  return out
}

/** The windows as instants, each converted at the offset in force on its own
 *  day. `narrow` is applied here — it trims a window and never extends one. */
export function windowSpans(
  windows: WindowRow[], from: string, to: string, tz: string, narrow?: PlanRules['narrow'],
): Interval[] {
  const out: Interval[] = []
  for (const w of windows) {
    for (const date of windowDates(w, from, to)) {
      let startMin = w.start_min
      let endMin = w.end_min
      if (narrow) {
        if (narrow.from != null) startMin = Math.max(startMin, narrow.from)
        if (narrow.to != null) endMin = Math.min(endMin, narrow.to)
        if (narrow.days && narrow.days.length) {
          const [y, m, d] = ymd(date)
          // The weekday on the owner's clock. A UTC day number carries it
          // without a zone, because the date string is already local.
          const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
          if (!narrow.days.includes(dow)) continue
        }
      }
      if (endMin <= startMin) continue
      const [y, m, d] = ymd(date)
      out.push({
        start: fromZone(y, m, d, 0, startMin, 0, tz),
        end: fromZone(y, m, d, 0, endMin, 0, tz),
      })
    }
  }
  return merge(out)
}

/** Overlapping or touching intervals joined, in order. */
export function merge(list: Interval[]): Interval[] {
  const sorted = [...list].filter(i => i.end > i.start).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end)
    else out.push({ ...i })
  }
  return out
}

// ─── The answer ──────────────────────────────────────────────────────────────

export interface SlotArgs {
  windows: WindowRow[]
  plan: PlanRules
  /** The owner's zone — the one the windows are written in. */
  tz: string
  /** YYYY-MM-DD, both inclusive; `to` is clamped by the plan's horizon. */
  from: string
  to: string
  /** Busy time from Google, as instants. */
  busy: Interval[]
  /** Bookings already taken, including ones still waiting for approval: they
   *  hold their hour, and a pending one has no calendar event to be busy in. */
  taken?: Interval[]
  now: number
}

/** Every start an outsider may pick, as ISO instants. */
export function slotsFor(a: SlotArgs): string[] {
  const { plan, tz } = a
  const step = Math.max(5, plan.slot_step_minutes) * 60000
  const length = Math.max(5, plan.duration_minutes) * 60000
  const before = Math.max(0, plan.buffer_before) * 60000
  const after = Math.max(0, plan.buffer_after) * 60000
  const earliest = a.now + Math.max(0, plan.min_notice_minutes) * 60000
  const horizonEnd = a.now + Math.max(1, plan.horizon_days) * DAY_MS

  const blocked = merge([...(a.busy ?? []), ...(a.taken ?? [])])
  const spans = windowSpans(a.windows, a.from, a.to, tz, plan.narrow)

  // How many are already on each day, on the owner's clock, so a cap of two a
  // day is two of *their* days and not two of the visitor's.
  const perDay = new Map<string, number>()
  for (const t of a.taken ?? []) {
    const key = dayKey(t.start, tz)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }

  const out: number[] = []
  for (const span of spans) {
    for (let s = span.start; s + length <= span.end; s += step) {
      if (s < earliest) continue
      if (s >= horizonEnd) break
      if (plan.max_per_day != null && (perDay.get(dayKey(s, tz)) ?? 0) >= plan.max_per_day) continue
      // The buffers belong to the slot, not to the busy time: an hour needs
      // `before` clear in front of it and `after` behind, so the comparison is
      // the slot grown either way against the busy interval as it stands.
      const from = s - before
      const to = s + length + after
      if (blocked.some(b => b.start < to && b.end > from)) continue
      out.push(s)
    }
  }

  return [...new Set(out)].sort((x, y) => x - y).map(ms => new Date(ms).toISOString())
}

/** The date an instant falls on, on a given clock. */
export function dayKey(at: number, tz: string): string {
  return new Date(at + zoneOffset(at, tz)).toISOString().slice(0, 10)
}

/** The range to ask for: never past the plan's horizon, never in the past. */
export function askableRange(plan: PlanRules, now: number, tz: string, from?: string, to?: string): { from: string; to: string } {
  const today = dayKey(now, tz)
  const last = dayKey(now + Math.max(1, plan.horizon_days) * DAY_MS, tz)
  const f = from && from > today ? from : today
  const t = to && to < last ? to : last
  return { from: f, to: t < f ? f : t }
}
