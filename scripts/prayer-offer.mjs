// node scripts/prayer-offer.mjs [convert|new|dismiss|none]     (needs a dev server on 5199)
// "I can't see the prayer times configuration or the UX." Nothing appears on Habits until prayer
// times are switched on, and the switch was at the foot of a long Settings page. The Habits page now
// offers it itself:
//   convert  a habit called "Prayer" exists: the banner names it, Convert makes it the prayer habit
//            (same id and picture), the card appears, the banner goes
//   new      "Start a new one" makes the built-in habit and leaves the old one alone
//   dismiss  "Not now" hides it, and it stays hidden after a reload
//   none     no prayer-like habit: it offers the built-in one ("Turn on"), with no Convert button
// and Settings -> Habits has the Prayer times block at the top, in view without scrolling.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'convert'
const U = user.id, OLD = '66666666-0000-4000-8000-000000000001'
const PIC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const habits = MODE === 'none' ? [{ id: OLD, user_id: U, name: 'Stretch', frequency: 'daily', is_active: true, current_streak: 0, longest_streak: 0, emoji: '🎯', color: '#3B82F6', type: 'boolean', goal: null, unit: null, image: null, created_at: '2024-12-01T00:00:00Z' }]
  : [{ id: OLD, user_id: U, name: 'Prayer', frequency: 'daily', is_active: true, current_streak: 0, longest_streak: 0, emoji: '🤲', color: '#3B82F6', type: 'quantity', goal: 5, unit: 'times', image: PIC, created_at: '2024-12-01T00:00:00Z' }]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(), u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*' } })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/habits')) return j(q.method() === 'GET' ? habits : [])
  return j([])
})
await ctx.addInitScript(([s, once]) => { try {
  localStorage.setItem('bpa-wizard-done', '1')
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'habits', themeId: 'sunlit-bento' }, version: 0 })) }
} catch {} }, [session, true])
const p = await ctx.newPage(); const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const offer = p.locator('[data-prayer-offer]')
const prayerNow = () => p.evaluate(() => JSON.parse(localStorage.getItem('professor-prayer') || '{}'))
const habitsNow = () => p.evaluate(() => JSON.parse(localStorage.getItem('professor-habits') || '[]'))
await offer.waitFor({ timeout: 6000 })
const txt = await offer.innerText()
ok('Habits offers the five prayers without anyone opening Settings', true)
if (MODE === 'none') {
  ok('with no prayer-like habit it offers the built-in one', /Track the five daily prayers/.test(txt) && await offer.getByRole('button', { name: 'Turn on' }).count() === 1 && await offer.getByRole('button', { name: 'Convert' }).count() === 0, txt.replace(/\s+/g, ' ').slice(0, 100))
  await offer.getByRole('button', { name: 'Turn on' }).click(); await p.waitForTimeout(800)
  const pr = await prayerNow(), hs = await habitsNow()
  ok('Turn on makes the built-in habit', pr.enabled === true && hs.find(h => h.id === pr.habitId)?.name === 'Prayers' && hs.length === 2, JSON.stringify({ en: pr.enabled, n: hs.length }))
  ok('the card is there and the banner is gone', await p.locator('[data-prayer-card]').count() === 1 && await offer.count() === 0)
} else {
  ok('it names the habit already kept', /Make “Prayer” the five daily prayers/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 100))
  if (MODE === 'convert') {
    await offer.getByRole('button', { name: 'Convert' }).click(); await p.waitForTimeout(800)
    const pr = await prayerNow(), h = (await habitsNow()).find(x => x.id === OLD)
    ok('Convert makes the SAME habit the prayer habit, picture kept', pr.enabled === true && pr.habitId === OLD && h?.image === PIC && h?.goal === 5 && h?.unit === 'prayers', JSON.stringify({ id: pr.habitId === OLD, img: h?.image === PIC, u: h?.unit }))
    ok('the five-prayer card appears and the banner goes', await p.locator('[data-prayer-card]').count() === 1 && await offer.count() === 0)
  } else if (MODE === 'new') {
    await offer.getByRole('button', { name: 'Start a new one' }).click(); await p.waitForTimeout(800)
    const pr = await prayerNow(), hs = await habitsNow()
    ok('a new built-in habit is made; the old one is untouched', hs.length === 2 && pr.habitId !== OLD && hs.find(x => x.id === OLD)?.unit === 'times')
  } else {
    await offer.getByRole('button', { name: 'Not now' }).click()
    ok('Not now hides it', await offer.count() === 0 && (await prayerNow()).enabled !== true)
    await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
    ok('and it stays hidden after a reload', await p.locator('[data-prayer-offer]').count() === 0)
  }
}
// Settings -> Habits: the block is at the top, inside the window without scrolling.
await p.evaluate(() => { localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: 'sunlit-bento' }, version: 0 })) })
await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
await p.locator('main button').filter({ hasText: /^Habits\d*$/ }).last().click({ timeout: 8000 })
const blk = p.locator('[data-prayer-settings]'); await blk.waitFor({ timeout: 6000 })
const r = await blk.evaluate(el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight } })
ok('Settings -> Habits shows Prayer times at the top, in view', r.top > 0 && r.top < r.h * 0.5, JSON.stringify(r))
await b.close(); process.exit(fails ? 1 : 0)
