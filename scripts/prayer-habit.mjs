// node scripts/prayer-habit.mjs [on|off]      (needs a dev server on 5199)
// The built-in prayer habit, in a browser. Cairo, 1 Jan 2025, browser clock fixed at 13:00 Cairo:
// Fajr and Dhuhr have begun, Asr / Maghrib / Isha have not. Claims, read off the page, the store
// and the requests the server received:
//   on   the card draws five prayers with their times; the three that have not begun are locked and
//        a tap on one changes nothing; a tap on Dhuhr then Fajr stores *those two* (not the count
//        rule's Dhuhr+Asr) and the server is sent quantity 2; the habit is not also a row of the
//        views; at 15:00 Asr opens; five ticks make the day done; an untick takes it back
//   off  prayer times switched off: no card, and the habit is an ordinary row in the views again
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'on'
const U = user.id, HID = '44444444-0000-4000-8000-000000000001'
const DAY = '2025-01-01'
const habits = [
  { id: HID, user_id: U, name: 'Prayers', frequency: 'daily', is_active: true, current_streak: 0, longest_streak: 0, emoji: '🕌', color: '#3B82F6', type: 'quantity', goal: 5, unit: 'prayers', image: null, created_at: '2024-12-01T00:00:00Z' },
  { id: '44444444-0000-4000-8000-000000000002', user_id: U, name: 'Stretch', frequency: 'daily', is_active: true, current_streak: 0, longest_streak: 0, emoji: '🎯', color: '#3B82F6', type: 'boolean', goal: null, unit: null, image: null, created_at: '2024-12-01T00:00:00Z' },
]
let logs = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, timezoneId: 'Africa/Cairo' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(), u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*' } })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/habits')) return j(q.method() === 'GET' ? habits : [])
  if (u.pathname.endsWith('/habit_logs')) {
    if (q.method() === 'GET') return j(logs)
    if (q.method() === 'DELETE') { logs = []; return j([]) }
    for (const row of [].concat(JSON.parse(q.postData() ?? '[]'))) { logs = logs.filter(x => !(x.habit_id === row.habit_id && x.date === row.date)); logs.push({ id: `l${logs.length}`, user_id: U, ...row }) }
    return j([])
  }
  return j([])
})
const prayer = { enabled: MODE === 'on', habitId: HID, method: 'egyptian', school: 'standard', place: { lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo', label: 'Cairo' }, days: {} }
await ctx.addInitScript(([s, pr]) => { try {
  localStorage.setItem('bpa-wizard-done', '1')
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'habits', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-prayer', JSON.stringify(pr))
} catch {} }, [session, prayer])
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.clock.setFixedTime(new Date('2025-01-01T11:00:00Z'))        // 13:00 in Cairo
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const card = p.locator('[data-prayer-card]')
const stored = () => p.evaluate(([h, d]) => {
  const pr = JSON.parse(localStorage.getItem('professor-prayer') || '{}')
  const q = JSON.parse(localStorage.getItem('professor-habit-quantity-logs') || '{}')
  const l = JSON.parse(localStorage.getItem('professor-habit-logs') || '{}')
  return { mask: pr.days?.[d] ?? 0, qty: q[h]?.[d] ?? 0, ticked: (l[h] ?? []).includes(d) }
}, [HID, DAY])
const state = n => card.locator(`[data-prayer="${n}"]`).getAttribute('data-state')
const rowsNamed = () => p.evaluate(() => [...document.querySelectorAll('main *')].filter(e => e.children.length === 0 && e.textContent?.trim() === 'Prayers' && !e.closest('[data-prayer-card]')).length)

if (MODE === 'off') {
  ok('no prayer card when prayer times are off', await card.count() === 0)
  ok('the habit is an ordinary row again', await rowsNamed() > 0, `${await rowsNamed()} places draw its name`)
} else {
  await card.waitFor({ timeout: 6000 })
  ok('the card draws the five prayers', await card.locator('[data-prayer]').count() === 5)
  const txt = await card.innerText()
  ok('with their times (Cairo, 1 Jan, Egyptian method)', /Fajr\s+05:\d\d/.test(txt) && /Dhuhr\s+12:0\d|Dhuhr\s+11:5\d/.test(txt) && /Asr\s+14:\d\d/.test(txt) && /Maghrib\s+17:\d\d/.test(txt) && /Isha\s+18:\d\d/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160))
  ok('at 13:00 Fajr and Dhuhr have begun; Asr, Maghrib, Isha are locked', [await state('fajr'), await state('dhuhr'), await state('asr'), await state('maghrib'), await state('isha')].join() === 'open,current,locked,locked,locked' || [await state('fajr'), await state('dhuhr'), await state('asr'), await state('maghrib'), await state('isha')].join() === 'open,open,locked,locked,locked', [await state('fajr'), await state('dhuhr'), await state('asr')].join())
  ok('the habit is not also a row of the views', await rowsNamed() === 0, `${await rowsNamed()} places`)

  await card.locator('[data-prayer="asr"]').click({ force: true })
  ok('a tap on a prayer whose time has not come changes nothing', (await stored()).qty === 0 && (await state('asr')) === 'locked')

  await card.locator('[data-prayer="dhuhr"]').click()
  let s = await stored()
  ok('Dhuhr ticked: mask is Dhuhr only, count 1', s.mask === 2 && s.qty === 1, JSON.stringify(s))
  await card.locator('[data-prayer="fajr"]').click()
  s = await stored()
  ok('then Fajr: the mask is Fajr + Dhuhr (the rule would have said Dhuhr + Asr)', s.mask === 3 && s.qty === 2, JSON.stringify(s))
  ok('the card says 2 of 5', /2\s*of 5/.test(await card.locator('[data-prayer-count]').innerText()))
  await p.waitForTimeout(2300)
  const row = logs.find(x => x.habit_id === HID && x.date === DAY)
  ok('the server was sent quantity 2 for the day, not completed', !!row && row.quantity === 2 && !row.completed, JSON.stringify(row))

  await p.clock.setFixedTime(new Date('2025-01-01T13:00:00Z'))        // 15:00 in Cairo
  await p.evaluate(() => window.dispatchEvent(new Event('professor:prayerUpdated')))
  ok('at 15:00 Asr opens', (await state('asr')) !== 'locked', await state('asr'))
  await p.clock.setFixedTime(new Date('2025-01-01T20:00:00Z'))        // 22:00
  await p.evaluate(() => window.dispatchEvent(new Event('professor:prayerUpdated')))
  for (const n of ['asr', 'maghrib', 'isha']) await card.locator(`[data-prayer="${n}"]`).click()
  s = await stored()
  ok('all five ticked: mask 31, count 5, the day is ticked', s.mask === 31 && s.qty === 5 && s.ticked, JSON.stringify(s))
  await card.locator('[data-prayer="isha"]').click()
  s = await stored()
  ok('unticking Isha takes it back to four and un-ticks the day', s.mask === 15 && s.qty === 4 && !s.ticked, JSON.stringify(s))
}
await b.close(); process.exit(fails ? 1 : 0)
