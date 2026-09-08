// ─── Repeats ─────────────────────────────────────────────────────────────────
// The panel could say "Every Wednesday" and nothing else: reading an RRULE was
// all this app could do with one. Writing one is the other half, and the shape
// people already know is the iOS Calendar's — six ready answers and a Custom
// sheet holding frequency, interval, which days, which dates, and when it ends.
//
// Everything here is about RFC 5545 lines as Google stores them
// (`event.recurrence`), and nothing here talks to Google.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

/** Sunday-first, matching `Date.getDay()`, and matching RFC 5545's own codes. */
export const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
export type RDay = typeof RRULE_DAYS[number]

export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** iOS's own wording for BYSETPOS. -1 is "Last". */
export const SET_POS = [
  { value: 1,  label: 'first' },
  { value: 2,  label: 'second' },
  { value: 3,  label: 'third' },
  { value: 4,  label: 'fourth' },
  { value: 5,  label: 'fifth' },
  { value: -1, label: 'last' },
] as const

export interface Recur {
  freq: Freq
  /** 1 = every, 2 = every other, … */
  interval: number
  /** WEEKLY: which days. MONTHLY/YEARLY with `setPos`: which weekday. */
  byDay?: RDay[]
  /** MONTHLY/YEARLY "on the first Tuesday" — 1..5, or -1 for last. */
  setPos?: number
  /** MONTHLY "each 1st, 15th". */
  monthDays?: number[]
  /** YEARLY: which months, 1..12. */
  byMonth?: number[]
  /** Local `YYYY-MM-DD` of the last day it may fall on. */
  until?: string
  /** …or a number of occurrences instead of a last day. RRULE allows one or
   *  the other, never both, so setting one clears the other. */
  count?: number
}

export type Preset = 'never' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom'

export const PRESETS: { value: Exclude<Preset, 'custom'>; label: string }[] = [
  { value: 'never',    label: 'Never' },
  { value: 'daily',    label: 'Every Day' },
  { value: 'weekly',   label: 'Every Week' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly',  label: 'Every Month' },
  { value: 'yearly',   label: 'Every Year' },
]

// ─── Reading ─────────────────────────────────────────────────────────────────

function untilToLocalDate(raw: string): string | undefined {
  // Either 20270303 or 20270303T235959Z. Both name a day; the day is what the
  // sheet edits, so the time of day is dropped on the way in.
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw)
  if (!m) return undefined
  if (raw.endsWith('Z') && raw.includes('T')) {
    const d = new Date(Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(raw.slice(9, 11)), Number(raw.slice(11, 13)), Number(raw.slice(13, 15)),
    ))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** The RRULE out of what Google returned, or null when it does not repeat. */
export function parseRecurrence(lines: string[] | undefined): Recur | null {
  const rule = lines?.find(l => l.toUpperCase().startsWith('RRULE'))
  if (!rule) return null
  const body = rule.slice(rule.indexOf(':') + 1)
  const parts = new Map<string, string>()
  for (const piece of body.split(';')) {
    const i = piece.indexOf('=')
    if (i > 0) parts.set(piece.slice(0, i).toUpperCase(), piece.slice(i + 1))
  }
  const freq = (parts.get('FREQ') ?? '').toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null

  const byDayRaw = parts.get('BYDAY')
  const byDay: RDay[] = []
  let setPos: number | undefined
  if (byDayRaw) {
    for (const token of byDayRaw.split(',')) {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(token.trim().toUpperCase())
      if (!m) continue
      // "2TU" carries its own position — the same fact BYSETPOS states.
      if (m[1]) setPos = Number(m[1])
      if ((RRULE_DAYS as readonly string[]).includes(m[2])) byDay.push(m[2] as RDay)
    }
  }
  const pos = parts.get('BYSETPOS')
  if (pos) setPos = Number(pos)

  const nums = (key: string) => parts.get(key)?.split(',').map(Number).filter(n => Number.isFinite(n))

  return {
    freq,
    interval: Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1),
    ...(byDay.length ? { byDay } : {}),
    ...(setPos !== undefined ? { setPos } : {}),
    ...(nums('BYMONTHDAY')?.length ? { monthDays: nums('BYMONTHDAY') } : {}),
    ...(nums('BYMONTH')?.length ? { byMonth: nums('BYMONTH') } : {}),
    ...(parts.get('UNTIL') ? { until: untilToLocalDate(parts.get('UNTIL')!) } : {}),
    ...(parts.get('COUNT') ? { count: Number(parts.get('COUNT')) || undefined } : {}),
  }
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** UNTIL is inclusive and has to be UTC, so it is the last instant of that day. */
function untilStamp(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number)
  const end = new Date(y, m - 1, d, 23, 59, 59)
  return end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** The `recurrence` array Google wants — `[]` for an event that does not repeat. */
export function toRecurrence(r: Recur | null): string[] {
  if (!r) return []
  const bits = [`FREQ=${r.freq}`]
  if (r.interval > 1) bits.push(`INTERVAL=${r.interval}`)
  if (r.freq === 'WEEKLY' && r.byDay?.length) bits.push(`BYDAY=${r.byDay.join(',')}`)
  if ((r.freq === 'MONTHLY' || r.freq === 'YEARLY')) {
    if (r.setPos !== undefined && r.byDay?.length) {
      bits.push(`BYDAY=${r.byDay.join(',')}`)
      bits.push(`BYSETPOS=${r.setPos}`)
    } else if (r.monthDays?.length) {
      bits.push(`BYMONTHDAY=${[...r.monthDays].sort((a, b) => a - b).join(',')}`)
    }
  }
  if (r.freq === 'YEARLY' && r.byMonth?.length) bits.push(`BYMONTH=${[...r.byMonth].sort((a, b) => a - b).join(',')}`)
  // UNTIL and COUNT are mutually exclusive in RRULE; a rule carrying both is
  // rejected outright, so the end date wins where something has set both.
  if (r.until) bits.push(`UNTIL=${untilStamp(r.until)}`)
  else if (r.count && r.count > 0) bits.push(`COUNT=${Math.round(r.count)}`)
  return [`RRULE:${bits.join(';')}`]
}

// ─── The six ready answers ───────────────────────────────────────────────────

export function presetRecur(preset: Exclude<Preset, 'never'>, start: Date): Recur | null {
  const day = RRULE_DAYS[start.getDay()]
  switch (preset) {
    case 'daily':    return { freq: 'DAILY',   interval: 1 }
    case 'weekly':   return { freq: 'WEEKLY',  interval: 1, byDay: [day] }
    case 'biweekly': return { freq: 'WEEKLY',  interval: 2, byDay: [day] }
    case 'monthly':  return { freq: 'MONTHLY', interval: 1, monthDays: [start.getDate()] }
    case 'yearly':   return { freq: 'YEARLY',  interval: 1 }
    default:         return { freq: 'WEEKLY',  interval: 1, byDay: [day] }
  }
}

/** Which of the six a rule *is*, so the list can tick it. Anything else, and
 *  anything with an end date, is Custom — the same as iOS. */
export function presetOf(r: Recur | null, start: Date): Preset {
  if (!r) return 'never'
  if (r.until) return 'custom'
  const day = RRULE_DAYS[start.getDay()]
  const onlyStartDay = !r.byDay?.length || (r.byDay.length === 1 && r.byDay[0] === day)
  if (r.freq === 'DAILY' && r.interval === 1 && !r.byDay?.length) return 'daily'
  if (r.freq === 'WEEKLY' && onlyStartDay && (r.interval === 1 || r.interval === 2)) {
    return r.interval === 1 ? 'weekly' : 'biweekly'
  }
  if (r.freq === 'MONTHLY' && r.interval === 1 && r.setPos === undefined
      && (!r.monthDays?.length || (r.monthDays.length === 1 && r.monthDays[0] === start.getDate()))) return 'monthly'
  if (r.freq === 'YEARLY' && r.interval === 1 && r.setPos === undefined && !r.byMonth?.length) return 'yearly'
  return 'custom'
}

// ─── Saying it in words ──────────────────────────────────────────────────────

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th'
  return `${n}${s}`
}

function untilWords(until: string | undefined): string {
  if (!until) return ''
  const d = new Date(`${until}T12:00:00`)
  return ` until ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** iOS's own phrasing: "Every 2 weeks on Mon and Wed", "Monthly on the first
 *  Tuesday". Returns null for an event that does not repeat. */
export function describeRecur(r: Recur | null, start: Date): string | null {
  if (!r) return null
  const every = (unit: string) => r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`
  const days = (r.byDay ?? []).map(d => DAY_SHORT[RRULE_DAYS.indexOf(d)])
  const posWord = SET_POS.find(p => p.value === r.setPos)?.label ?? ''

  if (r.freq === 'DAILY') return every('day') + untilWords(r.until)

  if (r.freq === 'WEEKLY') {
    const onlyStart = days.length === 0
      || (days.length === 1 && days[0] === DAY_SHORT[start.getDay()])
    if (onlyStart) {
      return (r.interval === 1 ? `Every ${DAY_LONG[start.getDay()]}` : every('week')) + untilWords(r.until)
    }
    return `${every('week')} on ${listWords(days)}${untilWords(r.until)}`
  }

  if (r.freq === 'MONTHLY') {
    if (r.setPos !== undefined && days.length) {
      return `${every('month')} on the ${posWord} ${DAY_LONG[RRULE_DAYS.indexOf(r.byDay![0])]}${untilWords(r.until)}`
    }
    const dates = r.monthDays ?? []
    const onlyStart = dates.length === 0 || (dates.length === 1 && dates[0] === start.getDate())
    if (onlyStart) return every('month') + untilWords(r.until)
    return `${every('month')} on the ${listWords([...dates].sort((a, b) => a - b).map(ordinal))}${untilWords(r.until)}`
  }

  const months = (r.byMonth ?? []).map(m => MONTH_SHORT[m - 1])
  let out = every('year')
  if (months.length) out += ` in ${listWords(months)}`
  if (r.setPos !== undefined && days.length) {
    out += ` on the ${posWord} ${DAY_LONG[RRULE_DAYS.indexOf(r.byDay![0])]}`
  }
  return out + untilWords(r.until)
}

/** The line iOS puts under the custom sheet. */
export function summarise(r: Recur | null, start: Date): string {
  const said = describeRecur(r, start)
  if (!said) return 'Event will occur once.'
  return `Event will occur ${said.charAt(0).toLowerCase()}${said.slice(1)}.`
}
