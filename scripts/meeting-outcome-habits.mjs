// The Habits box in the outcome window. Measured against the real bundle, with
// the habit tables served in the shape the project really sends, and read off
// localStorage (what the tap wrote), the request trace (what reached the server,
// after the 1.5s debounce) and the link ledger:
//   habits  a tick and a quantity are written through the one commit path, the
//           goal ticks a measured day, each change is linked and each takes
//           itself back, and a habit made here is deleted again by its Undo
//   off     a plan without Habits never draws the box
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'habits'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = ymd(new Date())
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()

const CAL = 'cal-teradix'
const EVENT = {
  id: 'ev-sync-1', status: 'confirmed', summary: 'Weekly Sync',
  htmlLink: 'https://calendar.google.com/event?eid=weekly-sync',
  start: { dateTime: `${TODAY}T10:00:00${TZ}` },
  end:   { dateTime: `${TODAY}T11:00:00${TZ}` },
  attendees: [{ email: user.email, self: true, responseStatus: 'accepted' }],
}
const COMPANIES = [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: CAL, users: [] }]

const U = user.id
const T0 = '2026-01-01T00:00:00.000Z'
// Stretching is made first, so on the habits' own order it comes before
// Networking. Networking is the one logged from a meeting before, so it must
// come first anyway — otherwise the ordering claim is vacuous.
const HABITS = [
  { id: 'h-stretch', user_id: U, name: 'Stretching', emoji: '🧘', color: '#1D9E75', frequency: 'daily', is_active: true, created_at: T0, type: 'boolean' },
  { id: 'h-net', user_id: U, name: 'Networking', emoji: '🤝', color: '#7F77DD', frequency: 'daily', is_active: true, created_at: '2026-01-02T00:00:00.000Z', type: 'boolean' },
  { id: 'h-steps', user_id: U, name: 'Walk', emoji: '🚶', color: '#E0944A', frequency: 'daily', is_active: true, created_at: '2026-01-03T00:00:00.000Z', type: 'quantity', goal: 8000, unit: 'steps' },
  { id: 'h-old', user_id: U, name: 'Retired habit', emoji: '🗑', color: '#888780', frequency: 'daily', is_active: false, created_at: '2026-01-04T00:00:00.000Z', type: 'boolean' },
]
const LOGS = [{ habit_id: 'h-steps', user_id: U, date: TODAY, completed: false, quantity: 5200 }]
// Networking was logged from another meeting once: that is why it leads.
const PRIOR_LINKS = { 'ev-other|habit|h-net': { eventId: 'ev-other', eventTitle: 'Client lunch', kind: 'habit', recordId: 'h-net', role: 'touched', at: '2026-09-01T10:00:00.000Z' } }

const habitUpserts = []   // every habits write, as rows
const logWrites = []      // every habit_logs write, as rows
const logDeletes = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/rpc/my_modules')) {
    return j([{ module_id: 'calendar', label: 'Calendar', enabled: true }, { module_id: 'tasks', label: 'Tasks', enabled: true },
      { module_id: 'habits', label: 'Habits', enabled: MODE !== 'off' }])
  }
  if (u.pathname.endsWith('/habits')) {
    if (q.method() === 'GET') return j(HABITS)
    try { const body = JSON.parse(q.postData() ?? '[]'); habitUpserts.push(...(Array.isArray(body) ? body : [body])) } catch { /* not json */ }
    return j([])
  }
  if (u.pathname.endsWith('/habit_logs')) {
    if (q.method() === 'GET') return j(LOGS)
    if (q.method() === 'DELETE') { logDeletes.push(u.search); return j([]) }
    try { const body = JSON.parse(q.postData() ?? '[]'); logWrites.push(...(Array.isArray(body) ? body : [body])) } catch { /* not json */ }
    return j([])
  }
  if (u.pathname.endsWith('/tasks') && q.method() === 'GET') return j([])
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
    { id: CAL, summary: 'Teradix Ltd', accessRole: 'owner', backgroundColor: '#0C8140', selected: true },
  ] })
  if (u.pathname.includes('/events')) {
    if (q.method() !== 'GET') return j({ id: 'ev-x', htmlLink: 'https://calendar.google.com/event?eid=x' })
    return j({ items: u.pathname.includes(CAL) || u.pathname.includes(encodeURIComponent(CAL)) ? [EVENT] : [] })
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(([s, cos, prior]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('cal-outcome-links', JSON.stringify(prior))
} catch { /* quota */ } }, [session, COMPANIES, PRIOR_LINKS])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const ls = k => p.evaluate(key => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } }, k)
const logs = async () => (await ls('professor-habit-logs')) ?? {}
const qty = async () => (await ls('professor-habit-quantity-logs')) ?? {}
const live = async () => Object.values((await ls('cal-outcome-links')) ?? {}).filter(l => !l.gone && l.kind === 'habit' && l.eventId === 'ev-sync-1')
const gone = async () => Object.values((await ls('cal-outcome-links')) ?? {}).filter(l => l.gone && l.kind === 'habit' && l.eventId === 'ev-sync-1')

ok('the meeting is on the grid', /Weekly Sync/.test(await text()))
await p.locator('.event-card').filter({ hasText: 'Weekly Sync' }).first().hover()
await p.waitForTimeout(350)
const at = await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /Mark done/i.test(e.getAttribute('aria-label') ?? e.title ?? ''))
  if (!x) return null
  const r = x.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
ok('the block carries a done tick', !!at)
if (at) { await p.mouse.move(at.x, at.y); await p.waitForTimeout(120); await p.mouse.down(); await p.mouse.up() }
await p.waitForTimeout(900)

const dialog = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
ok('the window opened', await dialog.count() === 1)
const box = dialog.locator('[data-outcome-box="habits"]')
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }
const row = id => box.locator(`[data-outcome-habit="${id}"]`)

if (MODE === 'off') {
  ok('the Tasks box is still there — the window itself is not broken', await dialog.locator('[data-outcome-box="tasks"]').count() === 1)
  ok('a plan without Habits does not draw the Habits box', await box.count() === 0)
  await done()
}

ok('the Habits box is a box, closed to begin with', await box.count() === 1 && await box.getAttribute('data-open') === '0')
await box.getByRole('button', { name: /^Habits:/ }).click()
await p.waitForTimeout(400)
ok('the box opened', await box.getAttribute('data-open') === '1')
// An accordion would have closed Tasks to show this one — and the design draws
// two boxes open side by side. Tasks is open by default, so it is the witness.
ok('opening a box does not close another', await dialog.locator('[data-outcome-box="tasks"]').getAttribute('data-open') === '1')

// ── What is offered, and in what order ──────────────────────────────────────
ok('every active habit is offered', await row('h-stretch').count() === 1 && await row('h-net').count() === 1 && await row('h-steps').count() === 1)
ok('an archived one is not', await row('h-old').count() === 0)
const order = await box.locator('[data-outcome-habit]').evaluateAll(els => els.map(e => e.getAttribute('data-outcome-habit')))
ok('the one logged from a meeting before leads, ahead of the habits\' own order', order[0] === 'h-net', JSON.stringify(order))
ok('and says why', /from meetings/.test(await row('h-net').innerText()) && !/from meetings/.test(await row('h-stretch').innerText()))
const summary = await box.getByRole('button', { name: /^Habits:/ }).getAttribute('aria-label')
// 5,200 of 8,000 is 65% of one habit of three: 22% of the day, never "0 of 3".
ok('the summary leads with the share of the day', /22% of/.test(summary ?? ''), summary ?? '')
ok('nothing is linked to this meeting yet', (await live()).length === 0)

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
// ── A tick ──────────────────────────────────────────────────────────────────
await row('h-stretch').getByRole('checkbox').click()
await p.waitForTimeout(300)
ok('a tick lands in the log for the meeting\'s day', (await logs())['h-stretch']?.includes(TODAY), JSON.stringify((await logs())['h-stretch']))
ok('the row reads done', await row('h-stretch').getAttribute('data-done') === '1')
let l = (await live()).find(x => x.recordId === 'h-stretch')
ok('and the thread says touched', l?.role === 'touched' && l?.eventId === 'ev-sync-1', JSON.stringify(l))
ok('the count moved', /1 linked/.test(await text()))
ok('the share moved with it: 55%', /55% of/.test(await box.getByRole('button', { name: /^Habits:/ }).getAttribute('aria-label')))
await p.waitForTimeout(2300)
const tickRow = logWrites.find(r => r.habit_id === 'h-stretch' && r.date === TODAY)
ok('and, after the pause, reached the server as a finished day', tickRow?.completed === true, JSON.stringify(tickRow))

// Flipping it back is the same as Undo: the link goes with the tick.
await row('h-stretch').getByRole('checkbox').click()
await p.waitForTimeout(300)
ok('unticking removes the day', !((await logs())['h-stretch'] ?? []).includes(TODAY))
ok('and takes the link it made', !(await live()).some(x => x.recordId === 'h-stretch') && (await gone()).some(x => x.recordId === 'h-stretch'))
ok('and the Undo button goes away with it', await row('h-stretch').getByRole('button', { name: 'Undo' }).count() === 0)

// ── A quantity ──────────────────────────────────────────────────────────────
ok('the measured habit shows where it stands', /5,200 \/ 8,000 steps/.test(await row('h-steps').innerText()), (await row('h-steps').innerText()).replace(/\n+/g, ' | '))
await row('h-steps').getByRole('button', { name: /^Add 1000/ }).click()
await p.waitForTimeout(300)
ok('one tap adds what a tap is worth for steps: 1,000', (await qty())['h-steps']?.[TODAY] === 6200, JSON.stringify((await qty())['h-steps']))
ok('and it is not ticked: part of a day is not a finished one', !((await logs())['h-steps'] ?? []).includes(TODAY) && await row('h-steps').getAttribute('data-done') === '0')
ok('but it is linked', (await live()).some(x => x.recordId === 'h-steps'))
await row('h-steps').getByRole('button', { name: /^Add 1000/ }).click()
await row('h-steps').getByRole('button', { name: /^Add 1000/ }).click()
await p.waitForTimeout(300)
ok('reaching the goal writes the quantity and ticks the day', (await qty())['h-steps']?.[TODAY] === 8200 && (await logs())['h-steps']?.includes(TODAY), JSON.stringify({ q: (await qty())['h-steps'], l: (await logs())['h-steps'] }))
await p.waitForTimeout(2300)
const qRow = logWrites.filter(r => r.habit_id === 'h-steps' && r.date === TODAY).at(-1)
ok('the server gets the quantity and a finished day', qRow?.quantity === 8200 && qRow?.completed === true, JSON.stringify(qRow))
await row('h-steps').getByRole('button', { name: 'Undo' }).click()
await p.waitForTimeout(300)
ok('Undo restores what it was: 5,200, not ticked', (await qty())['h-steps']?.[TODAY] === 5200 && !((await logs())['h-steps'] ?? []).includes(TODAY), JSON.stringify({ q: (await qty())['h-steps'], l: (await logs())['h-steps'] }))
ok('and takes the link', !(await live()).some(x => x.recordId === 'h-steps'))

// ── A habit made here ───────────────────────────────────────────────────────
await box.getByRole('button', { name: /New habit from this meeting/ }).click()
await box.getByLabel('Habit name').fill('Walk and talk')
await box.getByRole('button', { name: 'Create habit' }).click()
await p.waitForTimeout(500)
const habitsNow = (await ls('professor-habits')) ?? []
const mine = habitsNow.find(h => h.name === 'Walk and talk')
ok('the habit exists', !!mine)
ok('as a plain daily done-or-not habit', mine?.type === 'boolean' && mine?.frequency === 'daily' && mine?.isActive === true, JSON.stringify(mine && { t: mine.type, f: mine.frequency }))
ok('counted for the meeting\'s day, as asked', (await logs())[mine?.id]?.includes(TODAY))
ok('and linked as made, not touched', (await live()).some(x => x.recordId === mine?.id && x.role === 'made'))
await p.waitForTimeout(2300)
ok('it reached the server', habitUpserts.some(r => r.name === 'Walk and talk'), JSON.stringify(habitUpserts.map(r => r.name)))
await row(mine.id).getByRole('button', { name: 'Undo' }).click()
await p.waitForTimeout(500)
ok('Undo deletes the habit', !((await ls('professor-habits')) ?? []).some(h => h.id === mine.id))
ok('and its days', !(mine.id in (await logs())))
ok('and its link', !(await live()).some(x => x.recordId === mine.id))
await done()
