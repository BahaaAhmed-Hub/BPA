// ─── The five daily prayers ────────────────────────────────────────────────
//
// Pure: no DOM, no store, no network — the times are worked out here from a
// place and a date, so they work offline and follow the person's timezone.
//
// A day's record is a 5-bit mask (Fajr = 1 … Isha = 16). `habit_logs.quantity`
// carries the *count* of prayers (so streaks and the day's share keep working
// untouched); the mask says which, and is the only part with no column.

export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const
export type PrayerId = typeof PRAYERS[number]

export const PRAYER_LABEL: Record<PrayerId, string> = {
  fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha',
}

export const bitOf = (p: PrayerId): number => 1 << PRAYERS.indexOf(p)
export const ALL_PRAYERS = 31

export function maskHas(mask: number, p: PrayerId): boolean { return (mask & bitOf(p)) !== 0 }
export function maskToggle(mask: number, p: PrayerId): number { return mask ^ bitOf(p) }
export function maskCount(mask: number): number {
  let n = 0
  for (const p of PRAYERS) if (maskHas(mask, p)) n++
  return n
}

/** What a count means when all there is, is a count: the rule the person set for the habit they
 *  had before — one is Maghrib, two Dhuhr and Asr, three Fajr, Dhuhr and Asr, four adds Maghrib,
 *  five is the lot. Also how a day written by an older build (count only) is read. */
export function maskFromCount(count: number): number {
  const n = Math.max(0, Math.min(5, Math.floor(count)))
  const by: Record<number, PrayerId[]> = {
    0: [],
    1: ['maghrib'],
    2: ['dhuhr', 'asr'],
    3: ['fajr', 'dhuhr', 'asr'],
    4: ['fajr', 'dhuhr', 'asr', 'maghrib'],
    5: [...PRAYERS],
  }
  return by[n].reduce((m, p) => m | bitOf(p), 0)
}

// ─── Where, and by what method ─────────────────────────────────────────────

export type PrayerMethod = 'egyptian' | 'mwl' | 'isna' | 'karachi' | 'ummalqura'
export type AsrSchool = 'standard' | 'hanafi'

/** Sun angles below the horizon at Fajr and Isha; `ishaMinutes` is "this long after Maghrib". */
export const METHODS: Record<PrayerMethod, { label: string; fajr: number; isha: number; ishaMinutes?: number }> = {
  egyptian:  { label: 'Egyptian General Authority', fajr: 19.5, isha: 17.5 },
  mwl:       { label: 'Muslim World League', fajr: 18, isha: 17 },
  isna:      { label: 'North America (ISNA)', fajr: 15, isha: 15 },
  karachi:   { label: 'Karachi', fajr: 18, isha: 18 },
  ummalqura: { label: 'Umm al-Qura (Makkah)', fajr: 18.5, isha: 0, ishaMinutes: 90 },
}

export interface Place { lat: number; lon: number; tz?: string }

export type PrayerTimes = Record<PrayerId, number | null>   // minutes after local midnight

const rad = (d: number) => d * Math.PI / 180
const deg = (r: number) => r * 180 / Math.PI
const sin = (d: number) => Math.sin(rad(d))
const cos = (d: number) => Math.cos(rad(d))
const tan = (d: number) => Math.tan(rad(d))
const fix = (v: number, m: number) => v - m * Math.floor(v / m)

function julian(y: number, m: number, d: number): number {
  if (m <= 2) { y -= 1; m += 12 }
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5
}

function sunPosition(jd: number): { decl: number; eqt: number } {
  const D = jd - 2451545.0
  const g = fix(357.529 + 0.98560028 * D, 360)
  const q = fix(280.459 + 0.98564736 * D, 360)
  const L = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360)
  const e = 23.439 - 0.00000036 * D
  const RA = fix(deg(Math.atan2(cos(e) * sin(L), cos(L))) / 15, 24)
  return { decl: deg(Math.asin(sin(e) * sin(L))), eqt: q / 15 - RA }
}

/** The UTC offset, in hours, a timezone has on a given calendar day (noon, so a change at midnight cannot blur it). */
export function offsetHours(tz: string | undefined, y: number, m: number, d: number): number {
  if (!tz) return -new Date(y, m - 1, d, 12).getTimezoneOffset() / 60
  try {
    const at = new Date(Date.UTC(y, m - 1, d, 12))
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(at)
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
    return (local - at.getTime()) / 3600000
  } catch { return -new Date(y, m - 1, d, 12).getTimezoneOffset() / 60 }
}

/** The five times for one day, as minutes after local midnight; null where the sun never reaches the angle. */
export function prayerTimes(
  dateStr: string, place: Place, method: PrayerMethod = 'egyptian', school: AsrSchool = 'standard',
): PrayerTimes {
  const [y, m, d] = dateStr.split('-').map(Number)
  const tz = offsetHours(place.tz, y, m, d)
  const base = julian(y, m, d) - place.lon / (15 * 24)
  const cfg = METHODS[method]

  const midDay = (t: number) => fix(12 - sunPosition(base + t).eqt, 24)
  const angleTime = (angle: number, t: number, ccw: boolean): number => {
    const { decl } = sunPosition(base + t)
    const v = (-sin(angle) - sin(decl) * sin(place.lat)) / (cos(decl) * cos(place.lat))
    if (v < -1 || v > 1) return NaN
    return midDay(t) + (ccw ? -1 : 1) * deg(Math.acos(v)) / 15
  }
  const asrTime = (factor: number, t: number): number => {
    const { decl } = sunPosition(base + t)
    const angle = -deg(Math.atan(1 / (factor + tan(Math.abs(place.lat - decl)))))
    return angleTime(angle, t, false)
  }

  const day = (h: number) => h / 24
  const noon = midDay(day(12))
  const sunset = angleTime(0.833, day(18), false)
  const raw: Record<PrayerId, number> = {
    fajr: angleTime(cfg.fajr, day(5), true),
    dhuhr: noon + 1 / 60,                       // a minute past the meridian, the usual margin
    asr: asrTime(school === 'hanafi' ? 2 : 1, day(13)),
    maghrib: sunset,
    isha: cfg.ishaMinutes !== undefined ? sunset + cfg.ishaMinutes / 60 : angleTime(cfg.isha, day(18), false),
  }
  const out = {} as PrayerTimes
  for (const p of PRAYERS) {
    const h = raw[p] + tz - place.lon / 15
    out[p] = Number.isFinite(h) ? Math.round(fix(h, 24) * 60) : null
  }
  return out
}

export function clock(min: number | null): string {
  if (min === null) return '—'
  const h = Math.floor(min / 60) % 24, m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Has this prayer's time begun? A day in the past is open throughout; one in the future is not. */
export function hasBegun(p: PrayerId, dateStr: string, today: string, nowMinutes: number, times: PrayerTimes): boolean {
  if (dateStr < today) return true
  if (dateStr > today) return false
  const t = times[p]
  return t === null ? true : nowMinutes >= t
}

/** The prayer whose window is open right now — the last one begun — or null before Fajr. */
export function currentPrayer(times: PrayerTimes, nowMinutes: number): PrayerId | null {
  let cur: PrayerId | null = null
  for (const p of PRAYERS) { const t = times[p]; if (t !== null && nowMinutes >= t) cur = p }
  return cur
}

// ─── What a day's record says ──────────────────────────────────────────────

/** The prayers done on a day. The stored mask wins; with none (a day written by a build that only
 *  counted, or logged on another device before this one knew) the count is read by the rule —
 *  and a ticked day with no count is all five. The count in `habit_logs` is the day's truth about
 *  *how many*, so a mask that disagrees with it is a stale one and the count's reading is used. */
export function dayMask(stored: number | undefined, count: number | undefined, ticked: boolean): number {
  const n = count ?? (ticked ? 5 : 0)
  if (stored !== undefined && maskCount(stored) === Math.min(5, Math.max(0, Math.floor(n)))) return stored & ALL_PRAYERS
  return maskFromCount(n)
}
