// node scripts/prayer-times.mjs        (no browser, no server)
// The real src/lib/prayer.ts, bundled and run. Claims: the migration rule the person set
// (1 -> Maghrib ... 5 -> all), the day mask, the five times against published timetables
// (Cairo, Egyptian method — to within 5 minutes; a worked-out time is not a published one),
// the timezone doing its job (Cairo's clocks move in summer, and the times move with them),
// and which prayers are open at a given moment.
import { rolldown } from 'rolldown'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'prayer-'))
const b = await rolldown({ input: join(root, 'src/lib/prayer.ts'), platform: 'node' })
writeFileSync(join(dir, 'p.mjs'), (await b.generate({ format: 'esm' })).output[0].code)
const P = await import(pathToFileURL(join(dir, 'p.mjs')).href)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const names = m => P.PRAYERS.filter(p => P.maskHas(m, p)).join('+') || 'none'

// The rule, exactly as given.
ok('0 -> nothing', names(P.maskFromCount(0)) === 'none')
ok('1 -> Maghrib', names(P.maskFromCount(1)) === 'maghrib', names(P.maskFromCount(1)))
ok('2 -> Dhuhr + Asr', names(P.maskFromCount(2)) === 'dhuhr+asr', names(P.maskFromCount(2)))
ok('3 -> Fajr + Dhuhr + Asr', names(P.maskFromCount(3)) === 'fajr+dhuhr+asr', names(P.maskFromCount(3)))
ok('4 -> Fajr + Dhuhr + Asr + Maghrib', names(P.maskFromCount(4)) === 'fajr+dhuhr+asr+maghrib', names(P.maskFromCount(4)))
ok('5 -> all five', P.maskFromCount(5) === P.ALL_PRAYERS)
ok('more than 5 is still all five, and the count survives the round trip', P.maskFromCount(9) === 31 && [0, 1, 2, 3, 4, 5].every(n => P.maskCount(P.maskFromCount(n)) === n))
ok('toggling a prayer flips only its bit', P.maskToggle(0, 'asr') === 4 && P.maskToggle(4, 'asr') === 0 && P.maskToggle(4, 'fajr') === 5)

// What a day says: the stored mask when it agrees with the count, the rule when it does not.
const fa = P.maskFromCount(3) // fajr+dhuhr+asr
ok('a stored mask that matches the count is kept (Fajr+Isha+Maghrib stays that, not the rule\'s three)', P.dayMask(1 | 8 | 16, 3, false) === (1 | 8 | 16))
ok('a mask the count has overtaken is stale: the count is read by the rule', P.dayMask(1, 3, false) === fa)
ok('no mask, a count of 3 -> the rule', P.dayMask(undefined, 3, false) === fa)
ok('no mask, no count, ticked -> all five', P.dayMask(undefined, undefined, true) === 31)
ok('nothing at all -> nothing', P.dayMask(undefined, undefined, false) === 0 && P.dayMask(undefined, 0, false) === 0)

// Times. Cairo, 1 Jan 2025 (UTC+2), Egyptian General Authority. Published timetables for the day
// read about 05:11 / 11:58 / 14:45 / 17:07 / 18:30.
const cairo = { lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo' }
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const jan = P.prayerTimes('2025-01-01', cairo, 'egyptian', 'standard')
const want = { fajr: '05:11', dhuhr: '11:58', asr: '14:45', maghrib: '17:07', isha: '18:30' }
console.log('  Cairo 1 Jan:', P.PRAYERS.map(p => `${p} ${P.clock(jan[p])}`).join('  '))
// Dhuhr, Asr, Maghrib and Isha are fixed by the sun's position and agree with the tables to a couple
// of minutes. Fajr rests on an angle (19.5 degrees) that timetables apply slightly differently, and the
// reference above for it is from memory, not a source I could check here — so it is held to a window
// of 05:10-05:25, not to a minute. Compare against your own mosque's timetable before relying on it.
for (const p of ['dhuhr', 'asr', 'maghrib', 'isha']) ok(`Cairo 1 Jan ${p} is within 5 min of ${want[p]}`, jan[p] !== null && Math.abs(jan[p] - hm(want[p])) <= 5, P.clock(jan[p]))
ok('Cairo 1 Jan fajr is inside 05:10-05:25 (angle-based; not checked against a source)', jan.fajr >= hm('05:10') && jan.fajr <= hm('05:25'), P.clock(jan.fajr))
ok('the five are in order through the day', P.PRAYERS.every((p, i) => i === 0 || jan[p] > jan[P.PRAYERS[i - 1]]))

// The timezone: Egypt keeps summer time, so noon moves an hour later on the clock.
const jul = P.prayerTimes('2025-07-01', cairo, 'egyptian', 'standard')
console.log('  Cairo 1 Jul:', P.PRAYERS.map(p => `${p} ${P.clock(jul[p])}`).join('  '))
ok('Cairo is UTC+2 in January and UTC+3 in July', P.offsetHours('Africa/Cairo', 2025, 1, 1) === 2 && P.offsetHours('Africa/Cairo', 2025, 7, 1) === 3)
ok('Dhuhr is an hour later on the clock in July than the sun alone would put it', jul.dhuhr > hm('12:30') && jan.dhuhr < hm('12:10'), `${P.clock(jan.dhuhr)} vs ${P.clock(jul.dhuhr)}`)
const asNY = P.prayerTimes('2025-01-01', { ...cairo, tz: 'America/New_York' }, 'egyptian', 'standard')
ok('the same place on another timezone is the same sun, seven hours earlier on that clock', Math.abs((jan.dhuhr - asNY.dhuhr) - 7 * 60) <= 1, `${P.clock(jan.dhuhr)} vs ${P.clock(asNY.dhuhr)}`)

// Methods and school.
const han = P.prayerTimes('2025-01-01', cairo, 'egyptian', 'hanafi')
ok('the Hanafi Asr is later than the standard one', han.asr > jan.asr, `${P.clock(jan.asr)} -> ${P.clock(han.asr)}`)
const mk = P.prayerTimes('2025-01-01', { lat: 21.4225, lon: 39.8262, tz: 'Asia/Riyadh' }, 'ummalqura')
ok('Umm al-Qura: Isha is exactly 90 minutes after Maghrib', mk.isha - mk.maghrib === 90, `${P.clock(mk.maghrib)} -> ${P.clock(mk.isha)}`)
ok('a more northerly place at midsummer can lose a prayer\'s angle (null, not a wrong time)', P.prayerTimes('2025-06-21', { lat: 66, lon: 25, tz: 'Europe/Helsinki' }, 'mwl').fajr === null)

// Which prayers are open.
ok('before Fajr nothing is open, at Fajr it is', P.currentPrayer(jan, jan.fajr - 1) === null && P.currentPrayer(jan, jan.fajr) === 'fajr')
ok('after Isha, Isha is the one open', P.currentPrayer(jan, 23 * 60) === 'isha')
ok('today: only the prayers whose time has begun are open', P.hasBegun('dhuhr', '2025-01-01', '2025-01-01', jan.dhuhr, jan) && !P.hasBegun('asr', '2025-01-01', '2025-01-01', jan.dhuhr, jan))
ok('a past day is open throughout; a future one not at all', P.hasBegun('isha', '2024-12-31', '2025-01-01', 0, jan) && !P.hasBegun('fajr', '2025-01-02', '2025-01-01', 1439, jan))
process.exit(fails ? 1 : 0)
