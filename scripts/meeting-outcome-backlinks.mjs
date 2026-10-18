// The thread from the other end. "What came out of it?" files records and each
// keeps a line back to the meeting; this measures what the screens do with it,
// against the real bundle with one linked record per module and an unlinked
// control beside each:
//   meeting   the event panel lists what was filed, in counts only (no money),
//             and Reopen brings the window back showing it
//   tasks     a task made in a meeting says so, and the click lands on the meeting
//   habits    a habit logged from one says so
//   library   a book and a quote say so
//   finance   an entry filed from one says so
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'meeting'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = ymd(new Date())
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()
const CAL = 'cal-teradix'
const EVENT = { id: 'ev-sync-1', status: 'confirmed', summary: 'Weekly Sync', htmlLink: 'https://calendar.google.com/event?eid=weekly-sync',
  start: { dateTime: `${TODAY}T10:00:00${TZ}` }, end: { dateTime: `${TODAY}T11:00:00${TZ}` },
  attendees: [{ email: user.email, self: true, responseStatus: 'accepted' }] }
const COMPANIES = [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: CAL, users: [] }]
const U = user.id, NOW = new Date().toISOString(), T0 = '2026-01-01T00:00:00.000Z'

const LINK = (kind, recordId) => [`ev-sync-1|${kind}|${recordId}`, { eventId: 'ev-sync-1', eventTitle: 'Weekly Sync', eventDate: TODAY, kind, recordId, role: 'made', at: NOW }]
const LEDGER = Object.fromEntries([LINK('task', 't-linked'), LINK('expense', 'tx-linked'), LINK('habit', 'h-linked'), LINK('book', 'b-linked'), LINK('quote', 'q-linked')])

const TASKS = [
  { id: 't-linked', user_id: U, title: 'Send Ali the API proposal', quadrant: 'urgent_important', company_tag: 'teradix', status: 'todo', completed: false, created_at: NOW },
  { id: 't-plain', user_id: U, title: 'Pay the electricity bill', quadrant: 'urgent_important', company_tag: 'personal', status: 'todo', completed: false, created_at: NOW },
]
const ACC = [{ id: 'oa1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }]
const CATS = [{ id: 'oc1', user_id: U, name: 'Meals', icon: '🍽', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0 }]
const tx = (id, payee, amount) => ({ id, user_id: U, account_id: 'oa1', to_account_id: null, category_id: 'oc1', amount, currency: 'EGP', tx_type: 'expense', payee, date: TODAY, paid_at: TODAY, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: NOW })
const TXS = [tx('tx-linked', 'Taxi to the client', 85), tx('tx-plain', 'Groceries', 410)]
const HAB = [
  { id: 'h-linked', user_id: U, name: 'Networking', emoji: '🤝', color: '#7F77DD', frequency: 'daily', is_active: true, created_at: T0, type: 'boolean' },
  { id: 'h-plain', user_id: U, name: 'Stretching', emoji: '🧘', color: '#1D9E75', frequency: 'daily', is_active: true, created_at: '2026-01-02T00:00:00.000Z', type: 'boolean' },
]
const book = (id, title) => ({ id, user_id: U, title, subtitle: null, authors: ['A. Writer'], isbn: null, publisher: null, published_year: null, pages: 300, language: null, description: null, cover_url: null,
  source: 'manual', source_key: null, status: 'reading', format: 'print', rating: 0, review: null, spine_color: null, file_path: null, shelf_order: 0, started_on: null, finished_on: null, added_at: T0, updated_at: T0 })
const BOOKS = [book('b-linked', 'Deep Work'), book('b-plain', 'Atomic Habits')]
const QUOTES = [
  { id: 'q-linked', user_id: U, book_id: 'b-linked', kind: 'text', body: 'Clarity about what matters', image_path: null, page: 27, line: null, color: null, created_at: T0, updated_at: T0 },
  { id: 'q-plain', user_id: U, book_id: 'b-linked', kind: 'text', body: 'A quote nobody filed in a meeting', image_path: null, page: 40, line: null, color: null, created_at: T0, updated_at: T0 },
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/rpc/my_modules')) return j(['calendar', 'tasks', 'finance', 'habits', 'library'].map(m => ({ module_id: m, label: m, enabled: true })))
  const t = u.pathname.split('/').pop()
  if (q.method() !== 'GET') return j([])
  const T = { tasks: TASKS, finance_accounts: ACC, finance_categories: CATS, finance_transactions: TXS, habits: HAB, habit_logs: [], library_books: BOOKS, library_quotes: QUOTES }
  return j(T[t] ?? [])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
    { id: CAL, summary: 'Teradix Ltd', accessRole: 'owner', backgroundColor: '#0C8140', selected: true }] })
  if (u.pathname.includes('/events')) return j(q.method() === 'GET' ? { items: u.pathname.includes(CAL) ? [EVENT] : [] } : { id: 'x' })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(([s, cos, ledger, statuses]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('cal-outcome-links', JSON.stringify(ledger))
  localStorage.setItem('cal-event-statuses', JSON.stringify(statuses))
} catch { /* quota */ } }, [session, COMPANIES, LEDGER, { 'ev-sync-1': 'done' }])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }
const rail = name => p.locator(`[data-side-rail] button[aria-label="${name}"]`).click()
const chips = kind => p.locator(`[data-meeting-backlink="${kind}"]`)
const activeModule = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('professor-ui') ?? '{}').state?.activeModule } catch { return null } })

// ── The meeting's own side ──────────────────────────────────────────────────
ok('the meeting is on the grid', /Weekly Sync/.test(await text()))
await p.locator('.event-card').filter({ hasText: 'Weekly Sync' }).first().click()
await p.waitForTimeout(1200)
const card = p.locator('[data-outcomes-card]')
ok('the event panel carries an Outcomes card', await card.count() === 1)
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
const c = await card.innerText()
ok('it lists the task by its title', /Send Ali the API proposal/.test(c))
ok('and the other kinds as counts', /1 expense filed/.test(c) && /Habits: Networking/.test(c) && /1 book · 1 quote/.test(c), c.replace(/\n+/g, ' | '))
ok('and never an amount — Finance sits behind a lock this panel does not', !/EGP|85|410/.test(c))
ok('nor an unlinked record', !/Pay the electricity|Groceries|Stretching|Atomic Habits/.test(c))

if (MODE === 'meeting') {
  await card.getByRole('button', { name: 'Reopen' }).click()
  await p.waitForTimeout(900)
  const dlg = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
  ok('Reopen brings the window back', await dlg.count() === 1)
  ok('with the count of what was filed', /5 linked/.test(await text()), (await text()).match(/\d+ linked/)?.[0] ?? '')
  const row = dlg.locator('[data-outcome-task="t-linked"]')
  ok('and the task it made, marked as this meeting\'s', await row.count() === 1 && /this meeting/.test(await row.innerText()))
  ok('it is the ledger that restores them, so the unlinked one is not there as this meeting\'s', await dlg.locator('[data-outcome-task="t-plain"]').count() === 0 || !/this meeting/.test(await dlg.locator('[data-outcome-task="t-plain"]').innerText()))
  await done()
}

// ── Each module's own side ──────────────────────────────────────────────────
if (MODE === 'tasks') {
  await rail('Tasks'); await p.waitForTimeout(1800)
  await p.getByText('Pay the electricity bill', { exact: true }).first().click()
  await p.waitForTimeout(900)
  ok('the task\'s panel is open (so the absence below means something)', await p.getByText('Notes', { exact: true }).count() > 0)
  ok('an unlinked task has no chip (the control)', await chips('task').count() === 0)
  await p.getByText('Send Ali the API proposal', { exact: true }).first().click()
  await p.waitForTimeout(900)
  ok('a task made in a meeting says so', await chips('task').count() === 1 && /From: Weekly Sync/.test(await chips('task').innerText()), await chips('task').count() ? await chips('task').innerText() : 'no chip')
  await chips('task').getByRole('button').first().click()
  await p.waitForTimeout(1200)
  ok('and the click lands on the meeting', (await activeModule()) === 'calendar' && /Weekly Sync/.test(await text()), String(await activeModule()))
  await done()
}

if (MODE === 'habits') {
  await rail('Habits'); await p.waitForTimeout(1800)
  await p.getByText('Stretching', { exact: true }).first().click()
  await p.waitForTimeout(900)
  ok('the habit\'s record is open', await p.getByLabel("Close this habit's record").count() === 1)
  ok('an unlogged habit has no chip (the control)', await chips('habit').count() === 0)
  await p.getByText('Networking', { exact: true }).first().click()
  await p.waitForTimeout(900)
  ok('a habit logged from a meeting says so', await chips('habit').count() === 1 && /Logged from: Weekly Sync/.test(await chips('habit').innerText()), await chips('habit').count() ? await chips('habit').innerText() : 'no chip')
  await done()
}

if (MODE === 'library') {
  await rail('Library'); await p.waitForTimeout(2000)
  await p.getByRole('button', { name: /Atomic Habits by/ }).first().click()
  await p.waitForTimeout(900)
  ok('the book\'s panel is open', await p.getByText('Reading', { exact: true }).count() > 0)
  ok('an untouched book has no chip (the control)', await chips('book').count() === 0)
  await p.getByRole('button', { name: /Deep Work by/ }).first().click()
  await p.waitForTimeout(1000)
  ok('a book worked on in a meeting says so', await chips('book').count() === 1 && /Worked on in: Weekly Sync/.test(await chips('book').innerText()), await chips('book').count() ? await chips('book').innerText() : 'no chip')
  ok('its quote filed there says so', await chips('quote').count() === 1 && /Saved during: Weekly Sync/.test(await chips('quote').innerText()), String(await chips('quote').count()))
  ok('and the other quote does not (the control)', await chips('quote').count() === 1)
  await done()
}

if (MODE === 'finance') {
  await rail('Finance'); await p.waitForTimeout(2200)
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
  const open = async payee => { await p.getByText(payee, { exact: true }).last().click({ timeout: 6000 }); await p.waitForTimeout(900) }
  await open('Groceries')
  ok('the entry\'s form is open', await p.getByPlaceholder('Anything worth remembering…').count() === 1)
  ok('an unlinked entry has no chip (the control)', await chips('expense').count() === 0)
  await p.keyboard.press('Escape'); await p.waitForTimeout(500)
  await open('Taxi to the client')
  ok('an entry filed from a meeting says so', await chips('expense').count() === 1 && /Filed from: Weekly Sync/.test(await chips('expense').innerText()), await chips('expense').count() ? await chips('expense').innerText() : 'no chip')
  await done()
}
await done()
