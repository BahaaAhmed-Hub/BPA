// node scripts/prayer-habit.mjs [on|off]      (needs a dev server on 5199)
// The built-in prayer habit, in a browser. Cairo, 1 Jan 2025, browser clock fixed at 13:00 Cairo:
// Fajr and Dhuhr have begun, Asr / Maghrib / Isha have not. Claims, read off the page, the store
// and the requests the server received:
//   on   the habit is a row / card like the others (Table, Wall, Fill) with five prayer buttons for its control; the three that have not begun are locked and
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
const pills = () => p.locator('[data-prayer-pills]').first()
const stored = () => p.evaluate(([h, d]) => {
  const pr = JSON.parse(localStorage.getItem('professor-prayer') || '{}')
  const q = JSON.parse(localStorage.getItem('professor-habit-quantity-logs') || '{}')
  const l = JSON.parse(localStorage.getItem('professor-habit-logs') || '{}')
  return { mask: pr.days?.[d] ?? 0, qty: q[h]?.[d] ?? 0, ticked: (l[h] ?? []).includes(d) }
}, [HID, DAY])
const state = n => pills().locator(`[data-prayer="${n}"]`).getAttribute('data-state')
const view = v => p.getByRole('tab', { name: v }).click()
const tableRow = () => p.locator('div').filter({ has: p.locator('[data-prayer-pills]') }).filter({ hasText: 'Prayers' }).last()

if (MODE === 'off') {
  ok('prayer times off: no prayer buttons anywhere', await p.locator('[data-prayer-pills]').count() === 0)
  ok('the habit is an ordinary row', await p.getByText('Prayers', { exact: true }).count() > 0)
} else {
  await pills().waitFor({ timeout: 6000 })
  ok('there is no separate card above the habits any more', await p.locator('[data-prayer-card]').count() === 0)

  // TABLE: the habit is a row like the others, its control five buttons.
  ok('Table: five prayer buttons in the habit\'s own row', await pills().locator('[data-prayer]').count() === 5)
  const rowInfo = await p.evaluate(() => {
    const pillsEl = document.querySelector('[data-prayer-pills]'); let row = pillsEl; while (row && !(row.style && row.style.height === '46px')) row = row.parentElement
    const other = [...document.querySelectorAll('div')].find(d => d.style && d.style.height === '46px' && /Stretch/.test(d.textContent || '') && !d.querySelector('[data-prayer-pills]'))
    return { mine: row ? row.getBoundingClientRect().height : null, theirs: other ? other.getBoundingClientRect().height : null, sameParent: !!row && !!other && row.parentElement === other.parentElement }
  })
  ok('it is the same row — same height, same list — as a habit like Stretch', rowInfo.mine !== null && rowInfo.mine === rowInfo.theirs && rowInfo.sameParent, JSON.stringify(rowInfo))
  const txt = await pills().innerText()
  ok('the buttons are the five prayers by name', /Fajr/.test(txt) && /Dhuhr/.test(txt) && /Asr/.test(txt) && /Maghrib/.test(txt) && /Isha/.test(txt), txt.replace(/\s+/g, ' '))
  const label = n => pills().locator(`[data-prayer="${n}"]`).getAttribute('aria-label')
  const labs = await Promise.all(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map(label))
  ok('each carries its time (Cairo, 1 Jan, Egyptian method)', /05:\d\d/.test(labs[0]) && /1[12]:\d\d/.test(labs[1]) && /14:\d\d/.test(labs[2]) && /17:\d\d/.test(labs[3]) && /18:\d\d/.test(labs[4]), labs.join(' | '))
  ok('at 13:00 Fajr and Dhuhr have begun; Asr, Maghrib, Isha are locked', [await state('asr'), await state('maghrib'), await state('isha')].every(x => x === 'locked') && (await state('fajr')) !== 'locked' && (await state('dhuhr')) !== 'locked')

  await pills().locator('[data-prayer="asr"]').click({ force: true })
  ok('a tap on a prayer whose time has not come changes nothing', (await stored()).qty === 0 && (await state('asr')) === 'locked')
  await pills().locator('[data-prayer="dhuhr"]').click()
  let s = await stored()
  ok('Dhuhr ticked: mask is Dhuhr only, count 1', s.mask === 2 && s.qty === 1, JSON.stringify(s))
  await pills().locator('[data-prayer="fajr"]').click()
  s = await stored()
  ok('then Fajr: the mask is Fajr + Dhuhr (the rule would have said Dhuhr + Asr)', s.mask === 3 && s.qty === 2, JSON.stringify(s))
  await p.waitForTimeout(2300)
  const row = logs.find(x => x.habit_id === HID && x.date === DAY)
  ok('the server was sent quantity 2 for the day, not completed', !!row && row.quantity === 2 && !row.completed, JSON.stringify(row))

  // WALL and FILL: a card like the others, the same five buttons.
  await view('Wall'); await p.waitForTimeout(500)
  ok('Wall: the habit is a card and the five buttons are in it', await p.locator('[data-prayer-pills] [data-prayer]').count() === 5)
  ok('Wall: the same state — Fajr and Dhuhr done', (await state('fajr')) === 'done' && (await state('dhuhr')) === 'done')
  await view('Fill'); await p.waitForTimeout(500)
  ok('Fill: five buttons on the open card', await p.locator('[data-prayer-pills] [data-prayer]').count() === 5)
  await view('Table'); await p.waitForTimeout(300)

  await p.clock.setFixedTime(new Date('2025-01-01T13:00:00Z'))        // 15:00 in Cairo
  await p.evaluate(() => window.dispatchEvent(new Event('professor:prayerUpdated')))
  ok('at 15:00 Asr opens', (await state('asr')) !== 'locked', await state('asr'))
  await p.clock.setFixedTime(new Date('2025-01-01T20:00:00Z'))        // 22:00
  await p.evaluate(() => window.dispatchEvent(new Event('professor:prayerUpdated')))
  for (const n of ['asr', 'maghrib', 'isha']) await pills().locator(`[data-prayer="${n}"]`).click()
  s = await stored()
  ok('all five ticked: mask 31, count 5, the day is ticked', s.mask === 31 && s.qty === 5 && s.ticked, JSON.stringify(s))
  await pills().locator('[data-prayer="isha"]').click()
  s = await stored()
  ok('unticking Isha takes it back to four and un-ticks the day', s.mask === 15 && s.qty === 4 && !s.ticked, JSON.stringify(s))
}
await b.close(); process.exit(fails ? 1 : 0)
