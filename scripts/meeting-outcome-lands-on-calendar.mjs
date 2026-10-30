// node scripts/meeting-outcome-lands-on-calendar.mjs [task|ambiguous|readonly|claimed|primary|events]
// Needs a dev server on 5199.
//
// What a meeting files stays on the meeting's calendar and account. A task made
// in the outcome window used to be `personal` with no calendar unless a company
// had claimed the calendar by id, so a follow-up to a meeting on a connected
// account was scheduled to the default diary. Measured against the real bundle:
// the task is read off `professor-tasks`, and `resolveTaskCalendar` — the one
// call every scheduler makes — is run in the page on that stored task.
//   task       a meeting on a connected account's team calendar nobody has
//              claimed, with one company bound to that account: the task is
//              that company's, on that calendar, written with that account
//   ambiguous  two companies bound to the account: the company is NOT guessed,
//              but the calendar and the account still follow the meeting
//   readonly   a calendar that cannot be written to is not stamped on the task
//   claimed    a company that claims the calendar by id still wins (unchanged)
//   primary    a meeting on your own calendar: your own, no other account
//   events     a read-only meeting calendar falls back to the main calendar of
//              the SAME account, read off the edge-function body — not to the
//              first main calendar found, which is the signed-in account's
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'task'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = ymd(new Date())
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()
const at = (hh) => `${TODAY}T${pad(hh)}:00:00${TZ}`

const ACC = '44444444-0000-4000-8000-00000000000a'
const ACC_EMAIL = 'ceo@teradix.com'
const TEAM = 'ter-team@group.calendar.google.com'
const MEET_CAL = MODE === 'primary' ? 'primary' : TEAM
const TEAM_ROLE = MODE === 'readonly' || MODE === 'events' ? 'reader' : 'writer'

const COMPANIES = {
  task:      [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', accountId: ACC, users: [] }],
  ambiguous: [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', accountId: ACC, users: [] },
              { id: 'teradix-labs', name: 'Teradix Labs', color: '#0C8140', accountId: ACC, users: [] }],
  readonly:  [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', accountId: ACC, users: [] }],
  claimed:   [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: TEAM, users: [] }],
  primary:   [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', accountId: ACC, users: [] }],
  events:    [],
}[MODE]

const MEETING = {
  id: 'ev-sync-1', status: 'confirmed', summary: 'Teradix Sync',
  htmlLink: 'https://calendar.google.com/event?eid=sync', location: 'Room 3',
  start: { dateTime: at(10) }, end: { dateTime: at(11) },
}
const creates = []   // every event the edge function was asked to create
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.includes('/functions/v1/google-calendar-write')) {
    let body = {}; try { body = JSON.parse(q.postData() ?? '{}') } catch { /* ignore */ }
    creates.push({ action: body.action, email: body.account_email, calendarId: body.calendar_id })
    return j({ event: { id: `ev-new-${creates.length}`, status: 'confirmed', summary: body.event?.summary, start: body.event?.start, end: body.event?.end } })
  }
  if (u.pathname.includes('/functions/v1/')) return j({})
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  const bearer = (q.headers()['authorization'] || '').replace('Bearer ', '')
  const mine = bearer === 'tok-ter'
  if (u.pathname.includes('/users/me/calendarList')) {
    return j({ items: mine ? [
      { id: ACC_EMAIL, summary: ACC_EMAIL, primary: true, accessRole: 'owner', backgroundColor: '#0C8140', selected: true },
      { id: TEAM, summary: 'Teradix Team', accessRole: TEAM_ROLE, backgroundColor: '#B05939', selected: true },
    ] : [
      { id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
    ] })
  }
  const m = /\/calendars\/([^/]+)\/events/.exec(u.pathname)
  if (m && q.method() === 'GET') return j({ items: decodeURIComponent(m[1]) === MEET_CAL ? [MEETING] : [] })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(([s, cos, acc, email]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('professor-connected-accounts', JSON.stringify([
    { id: acc, email, name: 'Teradix', providerToken: 'tok-ter', providerTokenSavedAt: Date.now(), scopes: [], connectedAt: new Date().toISOString(), isPrimary: false },
  ]))
} catch { /* quota */ } }, [session, COMPANIES, ACC, ACC_EMAIL])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }
const text = () => p.evaluate(() => document.body.innerText)

// The cache is what ties a bare calendar id to an account. Asserting it first
// means a later "the task has no account" cannot be a calendar list that never loaded.
const cache = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cal-intel-cals-cache') ?? '[]') } catch { return [] } })
ok('the calendar cache knows the meeting\'s calendar and whose it is',
  cache.some(c => c.id === MEET_CAL && (MODE === 'primary' || c.accountEmail === ACC_EMAIL)), JSON.stringify(cache.map(c => [c.id, c.accountEmail, c.accessRole])))
ok('the meeting is on the grid', /Teradix Sync/.test(await text()))

await p.locator('.event-card').filter({ hasText: 'Teradix Sync' }).first().hover()
await p.waitForTimeout(350)
const tick = await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /Mark done/i.test(e.getAttribute('aria-label') ?? e.title ?? ''))
  if (!x) return null
  const r = x.getBoundingClientRect()
  const S = window.__zoomSpace ?? 1; return { x: (r.x + r.width / 2) * S, y: (r.y + r.height / 2) * S }
})
ok('the block carries a done tick', !!tick)
if (tick) { await p.mouse.move(tick.x, tick.y); await p.waitForTimeout(120); await p.mouse.down(); await p.mouse.up() }
await p.waitForTimeout(900)
const dialog = p.locator('[role="dialog"][aria-label*="Teradix Sync"]')
ok('the window opened', await dialog.count() === 1)

if (MODE === 'events') {
  const box = dialog.locator('[data-outcome-box="events"]')
  await box.getByRole('button', { name: /^Events:/ }).click()
  await p.waitForTimeout(400)
  const t = await box.innerText()
  ok('the form names the same account\'s main calendar, not the signed-in one', new RegExp(`On\\s+${ACC_EMAIL.replace('.', '\\.')}`).test(t) && !/On\s+a@x\.com/.test(t), t.replace(/\n+/g, ' | ').slice(-160))
  await box.getByRole('button', { name: /^Schedule$/ }).click()
  await p.waitForTimeout(900)
  const c = creates.find(x => x.action === 'create_event')
  ok('exactly one event was written', creates.filter(x => x.action === 'create_event').length === 1, JSON.stringify(creates))
  ok('through that account, to its own main calendar', c?.email === ACC_EMAIL && c?.calendarId === ACC_EMAIL, JSON.stringify(c))
  await done()
}

// ── Add a task from the meeting ─────────────────────────────────────────────
const TITLE = 'Send the signed annex'
const field = dialog.getByLabel('Add a task from this meeting')
ok('the Tasks box is open with its form', await field.count() === 1)
await field.fill(TITLE)
await dialog.getByRole('button', { name: 'Add', exact: true }).first().click()
await p.waitForTimeout(600)

const task = await p.evaluate(t => {
  try { return (JSON.parse(localStorage.getItem('professor-tasks') ?? '{}').state?.tasks ?? []).find(x => x.title === t) ?? null } catch { return null }
}, TITLE)
ok('the task was made', !!task, JSON.stringify(task)?.slice(0, 160))
const target = await p.evaluate(async t => {
  const m = await import('/src/lib/taskCalendar.ts')
  return m.resolveTaskCalendar(t)
}, task)

if (MODE === 'task') {
  ok('it is stamped with the meeting\'s calendar', task?.calendarId === TEAM, task?.calendarId)
  ok('and filed under the one company bound to that account', task?.companyId === 'teradix' && task?.company === 'teradix', `${task?.company}/${task?.companyId}`)
  ok('a scheduler would write to that calendar', target.calendarId === TEAM, JSON.stringify(target))
  ok('with that account\'s token, not the signed-in one', target.accountEmail === ACC_EMAIL && target.accountId === ACC && !target.accountUnresolved, JSON.stringify(target))
}
if (MODE === 'ambiguous') {
  ok('two companies on one account: the company is not guessed', task?.company === 'personal' && !task?.companyId, `${task?.company}/${task?.companyId}`)
  ok('but the calendar still follows the meeting', task?.calendarId === TEAM, task?.calendarId)
  ok('and so does the account', target.calendarId === TEAM && target.accountEmail === ACC_EMAIL && target.accountId === ACC, JSON.stringify(target))
}
if (MODE === 'readonly') {
  ok('a read-only calendar is not stamped on the task', task && task.calendarId === undefined, String(task?.calendarId))
  ok('the company still comes from the account', task?.companyId === 'teradix', `${task?.company}/${task?.companyId}`)
}
if (MODE === 'claimed') {
  ok('the company that claims the calendar still gets the task', task?.companyId === 'teradix', `${task?.company}/${task?.companyId}`)
  ok('on the meeting\'s calendar', task?.calendarId === TEAM && target.calendarId === TEAM, JSON.stringify(target))
  ok('and the account comes from the calendar, as the company names none', target.accountEmail === ACC_EMAIL && target.accountId === ACC, JSON.stringify(target))
}
if (MODE === 'primary') {
  ok('a meeting on your own calendar files to your own', task?.calendarId === 'primary' && task?.company === 'personal', `${task?.calendarId} ${task?.company}`)
  ok('with no other account in it', !target.accountId && !target.accountEmail, JSON.stringify(target))
}
await done()
