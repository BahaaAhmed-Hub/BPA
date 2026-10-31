// node scripts/prayer-migrates.mjs [convert|new|fresh]     (needs a dev server on 5199)
// "I have a prayer habit in my habits now, it has only a counter." Settings -> Habits -> Read prayer times.
//   convert  there is a counter habit called "Prayer" with a picture and five days logged (1, 2, 3, 4, 5):
//            the person is asked; Convert keeps the SAME habit (id, name, picture), makes it five a day,
//            creates no second habit, and each logged day reads by the rule they set —
//            1 Maghrib; 2 Dhuhr+Asr; 3 Fajr+Dhuhr+Asr; 4 Fajr+Dhuhr+Asr+Maghrib; 5 all
//   new      the same account, "Start a new one": a built-in Prayers habit is made and the old counter is untouched
//   fresh    an account with no prayer habit: switching on makes the built-in one at once, with no question
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'convert'
const U = user.id, OLD = '55555555-0000-4000-8000-000000000001'
const PIC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const habits = MODE === 'fresh' ? [] : [{ id: OLD, user_id: U, name: 'Prayer', frequency: 'daily', is_active: true, current_streak: 0, longest_streak: 0, emoji: '🤲', color: '#3B82F6', type: 'quantity', goal: 5, unit: 'times', image: PIC, created_at: '2024-12-01T00:00:00Z' }]
const logs = MODE === 'fresh' ? [] : [1, 2, 3, 4, 5].map(n => ({ id: `l${n}`, user_id: U, habit_id: OLD, date: `2025-01-0${n}`, completed: n >= 5, quantity: n }))
let upserts = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(), u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*' } })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/habits')) { if (q.method() === 'GET') return j(habits); upserts.push(...[].concat(JSON.parse(q.postData() ?? '[]'))); return j([]) }
  if (u.pathname.endsWith('/habit_logs')) return j(q.method() === 'GET' ? logs : [])
  return j([])
})
await ctx.addInitScript(s => { try {
  localStorage.setItem('bpa-wizard-done', '1')
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)
const p = await ctx.newPage(); const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
await p.locator('main button').filter({ hasText: /^Habits\d*$/ }).last().click({ timeout: 8000 })
const block = p.locator('[data-prayer-settings]'); await block.waitFor({ timeout: 6000 })
const sw = block.getByRole('switch').first()
const habitsNow = () => p.evaluate(() => JSON.parse(localStorage.getItem('professor-habits') || '[]'))
const prayerNow = () => p.evaluate(() => JSON.parse(localStorage.getItem('professor-prayer') || '{}'))
const before = (await habitsNow()).length
ok('prayer times start off', (await sw.getAttribute('aria-checked')) === 'false')
await sw.click()

if (MODE === 'fresh') {
  await p.waitForTimeout(400)
  ok('no question when there is nothing to convert', await p.locator('[data-prayer-adopt]').count() === 0)
  const hs = await habitsNow(), pr = await prayerNow()
  const mine = hs.find(h => h.id === pr.habitId)
  ok('the built-in habit is made: Prayers, five a day', !!mine && mine.name === 'Prayers' && mine.type === 'quantity' && mine.goal === 5 && mine.unit === 'prayers', JSON.stringify(mine))
  ok('and prayer times are on', pr.enabled === true)
} else {
  await p.locator('[data-prayer-adopt]').waitFor({ timeout: 4000 })
  ok('with a habit already called Prayer, the person is asked', true)
  ok('and nothing is switched on until they answer', (await prayerNow()).enabled !== true && (await habitsNow()).length === before)
  if (MODE === 'convert') {
    await p.getByRole('button', { name: /Convert “Prayer”/ }).click(); await p.waitForTimeout(500)
    const hs = await habitsNow(), pr = await prayerNow(), h = hs.find(x => x.id === OLD)
    ok('the SAME habit is now the prayer habit (id kept)', pr.habitId === OLD && pr.enabled === true, JSON.stringify(pr).slice(0, 120))
    ok('its picture and name are kept', h?.image === PIC && h?.name === 'Prayer')
    ok('it is five a day, in prayers', h?.type === 'quantity' && h?.goal === 5 && h?.unit === 'prayers', JSON.stringify({ t: h?.type, g: h?.goal, u: h?.unit }))
    ok('no second habit was made', hs.length === before, `${before} -> ${hs.length}`)
    const masks = await p.evaluate(async () => {
      const m = await import('/src/lib/prayerState.ts'); const st = m.loadPrayerState()
      return [1, 2, 3, 4, 5].map(n => m.readDay(st, `2025-01-0${n}`))
    })
    const want = [8, 6, 7, 15, 31]     // Maghrib | Dhuhr+Asr | Fajr+Dhuhr+Asr | +Maghrib | all
    ok('days logged 1..5 read as Maghrib / Dhuhr+Asr / Fajr+Dhuhr+Asr / +Maghrib / all five', JSON.stringify(masks) === JSON.stringify(want), JSON.stringify(masks))
  } else {
    await p.getByRole('button', { name: 'Start a new one' }).click(); await p.waitForTimeout(500)
    const hs = await habitsNow(), pr = await prayerNow()
    ok('a second, built-in habit is made', hs.length === before + 1 && pr.habitId !== OLD && hs.find(x => x.id === pr.habitId)?.name === 'Prayers', `${before} -> ${hs.length}`)
    ok('the old counter is untouched', hs.find(x => x.id === OLD)?.unit === 'times' && hs.find(x => x.id === OLD)?.image === PIC)
  }
}
await b.close(); process.exit(fails ? 1 : 0)
