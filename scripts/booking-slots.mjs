// What a stranger is offered, measured — the real module, not a copy of it.
//
// `supabase/functions/_shared/slots.ts` is pure TypeScript with no Deno in it,
// so this compiles that very file and runs it. The claim that most needs
// proving is the one nobody can see going wrong: a window is a **wall clock**
// in the owner's zone, so 09:00 Cairo stays 09:00 across a summer-time change
// while the instant underneath it moves by an hour. Treated as a fixed offset
// it is wrong twice a year, for a fortnight at a time, in opposite directions.
//
// Run it in several zones — the answer must not depend on where it is read:
//   for z in UTC Asia/Tokyo America/Los_Angeles Africa/Cairo; do TZ=$z node scripts/booking-slots.mjs; done
//
// `node scripts/booking-slots.mjs --control` runs the DST cases against a
// naive fixed-offset conversion instead, which must fail.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CONTROL = process.argv.includes('--control')
const TMP = `${process.cwd()}/.slots-tmp`
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })

let code = 0
const ok = (name, pass, extra = '') => {
  console.log(`${pass ? 'PASS' : '*** FAIL ***'}  [${process.env.TZ ?? 'system'}] ${name}${extra ? '  ' + extra : ''}`)
  if (!pass) code = 1
}

/** Compile a project .ts file as-is and import it. */
async function load(path, name) {
  writeFileSync(`${TMP}/${name}.ts`, readFileSync(path, 'utf8'))
  execFileSync('npx', ['tsc', '--target', 'es2022', '--module', 'esnext', '--skipLibCheck',
    '--moduleResolution', 'bundler', `${TMP}/${name}.ts`], { stdio: 'pipe' })
  return import(`${TMP}/${name}.js?v=${Date.now()}`)
}

const S = await load('supabase/functions/_shared/slots.ts', 'slots')
const Z = await load('src/lib/zones.ts', 'zones')

// ─── The two zone implementations must agree ────────────────────────────────
// They exist twice because Deno cannot import the app's bundle — the same
// reason the mail rules do. This is the thing that keeps the copies honest.
{
  const zones = ['Africa/Cairo', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Lord_Howe']
  const probes = [
    [2026, 1, 15, 9, 0], [2026, 3, 29, 1, 30], [2026, 4, 24, 9, 0],
    [2026, 6, 1, 14, 0], [2026, 10, 25, 2, 30], [2026, 10, 30, 9, 0], [2026, 12, 31, 23, 45],
  ]
  let same = 0, differ = []
  for (const tz of zones) for (const [y, m, d, h, mi] of probes) {
    const a = S.fromZone(y, m, d, h, mi, 0, tz)
    const b = Z.fromZone(y, m, d, h, mi, 0, tz)
    if (a === b) same++; else differ.push(`${tz} ${y}-${m}-${d} ${h}:${mi} ${a} vs ${b}`)
  }
  ok(`the function's zone maths agrees with the app's on all ${same} probes`,
     differ.length === 0, differ.slice(0, 2).join(' | '))
}

// ─── The client's copy of the expansion must agree too ─────────────────────
// `src/lib/booking.ts` has its own `windowFallsOn`, because the grid draws the
// week and Vite should not reach into a function's folder. Two answers to one
// question is the thing to be afraid of, so they are run side by side. The
// section is lifted out of the real file by its own heading — nothing is
// restated here, so the test cannot pass against a copy that has drifted.
{
  const whole = readFileSync('src/lib/booking.ts', 'utf8')
  const at = whole.indexOf('// ─── Which hours are open on a given day')
  if (at < 0) throw new Error("booking.ts no longer carries the window section — has it moved?")
  writeFileSync(`${TMP}/client.ts`, [
    'interface WindowRow { on_date: string; start_min: number; end_min: number;',
    "  repeat?: { kind: 'none' | 'weekly'; interval?: number; until?: string | null } | null; skips?: string[] | null }",
    whole.slice(at),
  ].join('\n'))
  execFileSync('npx', ['tsc', '--target', 'es2022', '--module', 'esnext', '--skipLibCheck',
    '--moduleResolution', 'bundler', `${TMP}/client.ts`], { stdio: 'pipe' })
  const C = await import(`${TMP}/client.js?v=${Date.now()}`)

  const cases = [
    { on_date: '2026-10-13', start_min: 540, end_min: 660, repeat: { kind: 'none' }, skips: [] },
    { on_date: '2026-10-13', start_min: 540, end_min: 660, repeat: { kind: 'weekly', interval: 1 }, skips: [] },
    { on_date: '2026-10-13', start_min: 540, end_min: 660, repeat: { kind: 'weekly', interval: 2 }, skips: [] },
    { on_date: '2026-10-13', start_min: 540, end_min: 660, repeat: { kind: 'weekly', interval: 1, until: '2026-10-27' }, skips: [] },
    { on_date: '2026-10-13', start_min: 540, end_min: 660, repeat: { kind: 'weekly', interval: 1 }, skips: ['2026-10-20', '2026-11-03'] },
    { on_date: '2026-02-24', start_min: 60, end_min: 120, repeat: { kind: 'weekly', interval: 1 }, skips: [] },   // over a month end
  ]
  const from = '2026-10-01', to = '2026-12-31'
  const dates = []
  for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86400000) {
    dates.push(new Date(d).toISOString().slice(0, 10))
  }
  let checked = 0
  const differ = []
  for (const w of cases) {
    const server = new Set(S.windowDates(w, from, to))
    for (const date of dates) {
      checked++
      const client = C.windowFallsOn(w, date)
      if (client !== server.has(date)) differ.push(`${date} ${JSON.stringify(w.repeat)} client=${client} server=${server.has(date)}`)
    }
  }
  ok(`the grid's expansion agrees with the function's on all ${checked} days`,
     differ.length === 0, differ.slice(0, 2).join(' | '))
}

// ─── A window, chopped ──────────────────────────────────────────────────────
const CAIRO = 'Africa/Cairo'
const plan = {
  duration_minutes: 30, slot_step_minutes: 30,
  buffer_before: 0, buffer_after: 0, min_notice_minutes: 0,
  horizon_days: 60, max_per_day: null, narrow: null,
}
// 09:00–11:00 on Tuesday 13 October 2026, weekly.
const win = { on_date: '2026-10-13', start_min: 540, end_min: 660, repeat: { kind: 'weekly', interval: 1 }, skips: [] }
const NOW = S.fromZone(2026, 10, 12, 8, 0, 0, CAIRO)   // the Monday before
const base = { windows: [win], plan, tz: CAIRO, busy: [], taken: [], now: NOW }
const localTimes = (iso) => iso.map(s => {
  const at = new Date(s).getTime()
  const w = new Date(at + S.zoneOffset(at, CAIRO))
  return `${w.toISOString().slice(0, 10)} ${String(w.getUTCHours()).padStart(2, '0')}:${String(w.getUTCMinutes()).padStart(2, '0')}`
})

{
  const got = S.slotsFor({ ...base, from: '2026-10-13', to: '2026-10-13' })
  ok('a two-hour window gives four half hours',
     JSON.stringify(localTimes(got)) === JSON.stringify(
       ['2026-10-13 09:00', '2026-10-13 09:30', '2026-10-13 10:00', '2026-10-13 10:30']),
     JSON.stringify(localTimes(got)))
}
{
  // A 45-minute call does not fit four times into two hours, and the engine
  // must not offer a start whose end falls outside the window.
  const got = S.slotsFor({ ...base, plan: { ...plan, duration_minutes: 45 }, from: '2026-10-13', to: '2026-10-13' })
  ok('nothing is offered that would run past the window',
     JSON.stringify(localTimes(got)) === JSON.stringify(['2026-10-13 09:00', '2026-10-13 09:30', '2026-10-13 10:00']),
     JSON.stringify(localTimes(got)))
}

// ─── Repeat, interval, until, skips ─────────────────────────────────────────
{
  const got = localTimes(S.slotsFor({ ...base, from: '2026-10-13', to: '2026-10-27' }))
  ok('a weekly window comes round', got.filter(t => t.endsWith('09:00')).length === 3, JSON.stringify(got.filter(t => t.endsWith('09:00'))))

  const every2 = S.slotsFor({ ...base, windows: [{ ...win, repeat: { kind: 'weekly', interval: 2 } }], from: '2026-10-13', to: '2026-10-27' })
  ok('every other week skips the week between',
     JSON.stringify(localTimes(every2).filter(t => t.endsWith('09:00'))) === JSON.stringify(['2026-10-13 09:00', '2026-10-27 09:00']),
     JSON.stringify(localTimes(every2).filter(t => t.endsWith('09:00'))))

  const until = S.slotsFor({ ...base, windows: [{ ...win, repeat: { kind: 'weekly', interval: 1, until: '2026-10-20' } }], from: '2026-10-13', to: '2026-11-10' })
  ok('an end date ends it',
     JSON.stringify(localTimes(until).filter(t => t.endsWith('09:00'))) === JSON.stringify(['2026-10-13 09:00', '2026-10-20 09:00']),
     JSON.stringify(localTimes(until).filter(t => t.endsWith('09:00'))))

  const skipped = S.slotsFor({ ...base, windows: [{ ...win, skips: ['2026-10-20'] }], from: '2026-10-13', to: '2026-10-27' })
  ok('one week taken back leaves the others alone',
     JSON.stringify(localTimes(skipped).filter(t => t.endsWith('09:00'))) === JSON.stringify(['2026-10-13 09:00', '2026-10-27 09:00']),
     JSON.stringify(localTimes(skipped).filter(t => t.endsWith('09:00'))))

  const once = S.slotsFor({ ...base, windows: [{ ...win, repeat: { kind: 'none' } }], from: '2026-10-13', to: '2026-10-27' })
  ok('a one-off window happens once', localTimes(once).filter(t => t.endsWith('09:00')).length === 1)
}

// ─── Busy, and the buffers ──────────────────────────────────────────────────
{
  // A real meeting 09:30–10:00 Cairo.
  const busy = [{ start: S.fromZone(2026, 10, 13, 9, 30, 0, CAIRO), end: S.fromZone(2026, 10, 13, 10, 0, 0, CAIRO) }]
  const got = localTimes(S.slotsFor({ ...base, busy, from: '2026-10-13', to: '2026-10-13' }))
  ok('an hour already taken is not offered',
     JSON.stringify(got) === JSON.stringify(['2026-10-13 09:00', '2026-10-13 10:00', '2026-10-13 10:30']), JSON.stringify(got))

  const buffered = localTimes(S.slotsFor({
    ...base, busy, plan: { ...plan, buffer_before: 15, buffer_after: 15 }, from: '2026-10-13', to: '2026-10-13',
  }))
  ok('a buffer clears the slots either side of it',
     JSON.stringify(buffered) === JSON.stringify(['2026-10-13 10:30']), JSON.stringify(buffered))

  // A pending booking holds its hour although nothing is on the calendar yet.
  const taken = [{ start: S.fromZone(2026, 10, 13, 10, 0, 0, CAIRO), end: S.fromZone(2026, 10, 13, 10, 30, 0, CAIRO) }]
  const withTaken = localTimes(S.slotsFor({ ...base, taken, from: '2026-10-13', to: '2026-10-13' }))
  ok('a booking that is only pending still holds its hour',
     !withTaken.includes('2026-10-13 10:00'), JSON.stringify(withTaken))
}

// ─── Notice, horizon, cap ───────────────────────────────────────────────────
{
  const notice = localTimes(S.slotsFor({
    ...base, now: S.fromZone(2026, 10, 13, 8, 0, 0, CAIRO),
    plan: { ...plan, min_notice_minutes: 120 }, from: '2026-10-13', to: '2026-10-13',
  }))
  ok('nothing inside the notice period', JSON.stringify(notice) === JSON.stringify(['2026-10-13 10:00', '2026-10-13 10:30']), JSON.stringify(notice))

  const horizon = localTimes(S.slotsFor({ ...base, plan: { ...plan, horizon_days: 3 }, from: '2026-10-13', to: '2026-11-10' }))
  ok('nothing past the horizon', horizon.every(t => t < '2026-10-16'), JSON.stringify(horizon.slice(-2)))

  const capped = S.slotsFor({
    ...base, plan: { ...plan, max_per_day: 1 },
    taken: [{ start: S.fromZone(2026, 10, 13, 15, 0, 0, CAIRO), end: S.fromZone(2026, 10, 13, 15, 30, 0, CAIRO) }],
    from: '2026-10-13', to: '2026-10-20',
  })
  ok('a day at its cap offers nothing, and the next week is untouched',
     localTimes(capped).every(t => !t.startsWith('2026-10-13')) && localTimes(capped).some(t => t.startsWith('2026-10-20')),
     JSON.stringify(localTimes(capped).slice(0, 2)))
}

// ─── Narrowing trims, never widens ──────────────────────────────────────────
{
  const trimmed = localTimes(S.slotsFor({ ...base, plan: { ...plan, narrow: { from: 600, to: 630 } }, from: '2026-10-13', to: '2026-10-13' }))
  ok('a plan may trim the hours', JSON.stringify(trimmed) === JSON.stringify(['2026-10-13 10:00']), JSON.stringify(trimmed))

  const widened = localTimes(S.slotsFor({ ...base, plan: { ...plan, narrow: { from: 0, to: 1440 } }, from: '2026-10-13', to: '2026-10-13' }))
  ok('and may never widen them', widened.length === 4, JSON.stringify(widened))

  // 13 Oct 2026 is a Tuesday (2).
  const wrongDay = S.slotsFor({ ...base, plan: { ...plan, narrow: { days: [1, 3] } }, from: '2026-10-13', to: '2026-10-13' })
  ok('a plan limited to other weekdays offers nothing here', wrongDay.length === 0, JSON.stringify(wrongDay))
  const rightDay = S.slotsFor({ ...base, plan: { ...plan, narrow: { days: [2] } }, from: '2026-10-13', to: '2026-10-13' })
  ok('and everything on its own', rightDay.length === 4, String(rightDay.length))
}

// ─── Summer time: the whole reason any of this is wall-clock ────────────────
{
  // Egypt puts its clocks back at the end of October, so a weekly 09:00 Cairo
  // window crosses a transition inside this range. The *reading* must stay
  // 09:00 every week; the instant underneath it is what moves.
  const naive = (args) => {
    // CONTROL: convert every occurrence at the offset in force on the window's
    // first day — the mistake this file exists to avoid.
    const off = S.zoneOffset(S.fromZone(2026, 10, 13, 0, 0, 0, CAIRO), CAIRO)
    const dates = S.windowDates(args.windows[0], args.from, args.to)
    return dates.flatMap(d => {
      const [y, m, dd] = S.ymd(d)
      const start = Date.UTC(y, m - 1, dd, 0, args.windows[0].start_min) - off
      return [new Date(start).toISOString()]
    })
  }
  const args = { ...base, from: '2026-10-13', to: '2026-11-24', now: NOW }
  const starts = (CONTROL ? naive(args) : S.slotsFor(args)).filter((_, i) => true)
  const nines = localTimes(starts).filter(t => t.endsWith('09:00'))
  const weeks = localTimes(starts).filter((t, i, all) => all.indexOf(t) === i).map(t => t.slice(0, 10))

  ok('every week still opens at 09:00 on the owner\'s clock',
     nines.length === new Set(weeks).size && nines.length >= 6, `${nines.length} of ${new Set(weeks).size} weeks`)

  // Anti-vacuity: the range really does straddle a clock change, so the UTC
  // hour of those 09:00 readings is not the same all the way through.
  const utcHours = new Set(starts.filter(s => {
    const at = new Date(s).getTime()
    return new Date(at + S.zoneOffset(at, CAIRO)).getUTCHours() === 9
  }).map(s => new Date(s).getUTCHours()))
  ok('and the range genuinely crosses a clock change', utcHours.size === 2, [...utcHours].join(','))
}

rmSync(TMP, { recursive: true, force: true })
process.exit(code)
