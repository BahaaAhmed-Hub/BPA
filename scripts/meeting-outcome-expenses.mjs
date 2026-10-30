// The Expenses box in the outcome window. Measured against the real bundle,
// with the finance tables served in the shape the project really sends, and
// read off the request trace, the store and the link ledger:
//   expenses  an expense is filed as an unpaid draft; unpaid bills near the
//             day are offered and confirming one is one press; each row takes
//             itself back; the envelope strip moves only when money does
//   lock      a locked Finance shows nothing of the ledger until unlocked
//   off       a plan without Finance never draws the box, and never loads it
//   fx        a figure that cannot be converted is not claimed
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'expenses'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = ymd(new Date())
const DAYS_AGO = n => ymd(new Date(Date.now() - n * 864e5))
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()
void createHash

const CAL = 'cal-teradix'
const EVENT = {
  id: 'ev-sync-1', status: 'confirmed', summary: 'Weekly Sync',
  htmlLink: 'https://calendar.google.com/event?eid=weekly-sync',
  start: { dateTime: `${TODAY}T10:00:00${TZ}` },
  end:   { dateTime: `${TODAY}T11:00:00${TZ}` },
  attendees: [{ email: user.email, self: true, responseStatus: 'accepted' }],
}
const COMPANIES = [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: CAL, users: [] }]

const NOW = new Date().toISOString()
const U = user.id
const ACCOUNTS = [
  { id: 'acc-cash', user_id: U, name: 'Cash — Teradix', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: NOW },
  { id: 'acc-card', user_id: U, name: 'Visa 4242', bank: 'CIB', account_type: 'credit_card', currency: 'EGP', balance: 0, emoji: '💳', color: '#1F4E7A', sort_order: 1, is_active: true, created_at: NOW },
]
const CATS = [
  { id: 'cat-meals', user_id: U, name: 'Meals', icon: '🍽', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: NOW },
  { id: 'cat-transport', user_id: U, name: 'Transport', icon: '🚕', color: '#1F4E7A', tx_type: 'expense', sort_order: 1, is_system: false, created_at: NOW },
  { id: 'cat-parking', user_id: U, name: 'Parking', icon: '🅿', color: '#6B4E00', tx_type: 'expense', sort_order: 2, is_system: false, created_at: NOW },
]
const tx = (id, over) => ({ id, user_id: U, account_id: 'acc-cash', to_account_id: null, category_id: 'cat-meals', amount: 100, currency: 'EGP',
  tx_type: 'expense', payee: id, date: TODAY, paid_at: TODAY, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: NOW, ...over })
const TXS = [
  tx('tx-paid-meals', { payee: 'Client dinner', amount: 1420 }),
  tx('tx-paid-transport', { payee: 'Old taxi', category_id: 'cat-transport', amount: 120, date: DAYS_AGO(3), paid_at: DAYS_AGO(3) }),
  tx('tx-paid-transport-2', { payee: 'Older taxi', category_id: 'cat-transport', amount: 90, date: DAYS_AGO(5), paid_at: DAYS_AGO(5) }),
  tx('tx-unpaid-near', { payee: 'Lunch — Zomato Business', amount: 640, paid_at: null, is_cleared: false }),
  tx('tx-unpaid-far', { payee: 'Old invoice', amount: 300, date: DAYS_AGO(30), paid_at: null, is_cleared: false }),
  tx('tx-paid-near', { payee: 'Parking garage', category_id: 'cat-parking', amount: 40 }),
  ...(MODE === 'fx' ? [tx('tx-aed', { payee: 'Dubai lunch', amount: 80, currency: 'AED' })] : []),
]
const RULES = { 'cat-meals': { amount: 2000, frequency: 'monthly', rollover: false, warn80: false, currency: 'EGP' } }

// A password for the lock modes, hashed the way lock.ts does it.
const PASSWORD = 'correct horse'
const salt = randomBytes(16)
const LOCK = { enabled: true, relock: 15, password: {
  salt: salt.toString('base64'), rounds: 210000,
  hash: pbkdf2Sync(PASSWORD, salt, 210000, 32, 'sha256').toString('base64') } }

const upserts = []    // every finance_transactions write, as rows
const deletes = []    // every finance_transactions DELETE
const financeReads = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/rpc/my_modules')) {
    return j(MODE === 'off'
      ? [{ module_id: 'calendar', label: 'Calendar', enabled: true }, { module_id: 'tasks', label: 'Tasks', enabled: true }, { module_id: 'finance', label: 'Finance', enabled: false }]
      : [{ module_id: 'calendar', label: 'Calendar', enabled: true }, { module_id: 'tasks', label: 'Tasks', enabled: true }, { module_id: 'finance', label: 'Finance', enabled: true }])
  }
  if (u.pathname.includes('/finance_')) financeReads.push(`${q.method()} ${u.pathname.split('/').pop()}`)
  if (u.pathname.endsWith('/finance_accounts') && q.method() === 'GET') return j(ACCOUNTS)
  if (u.pathname.endsWith('/finance_categories') && q.method() === 'GET') return j(CATS)
  if (u.pathname.endsWith('/finance_transactions')) {
    if (q.method() === 'GET') return j(TXS)
    if (q.method() === 'DELETE') { deletes.push(u.search); return j([]) }
    try { const body = JSON.parse(q.postData() ?? '[]'); upserts.push(...(Array.isArray(body) ? body : [body])) } catch { /* not json */ }
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
await ctx.addInitScript(([s, cos, rules, lock, locked]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('finance-budget-rules', JSON.stringify(rules))
  if (locked) localStorage.setItem('finance-lock', JSON.stringify(lock))
} catch { /* quota */ } }, [session, COMPANIES, RULES, LOCK, MODE === 'lock'])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const ledger = () => p.evaluate(() => { try { return Object.values(JSON.parse(localStorage.getItem('cal-outcome-links') ?? '{}')) } catch { return [] } })
const live = async (kind = 'expense') => (await ledger()).filter(l => !l.gone && l.kind === kind)
const store = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('finance-store') ?? 'null') } catch { return null } })
void store

ok('the meeting is on the grid', /Weekly Sync/.test(await text()))

await p.locator('.event-card').filter({ hasText: 'Weekly Sync' }).first().hover()
await p.waitForTimeout(350)
const at = await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /Mark done/i.test(e.getAttribute('aria-label') ?? e.title ?? ''))
  if (!x) return null
  const r = x.getBoundingClientRect()
  const S = window.__zoomSpace ?? 1; return { x: (r.x + r.width / 2) * S, y: (r.y + r.height / 2) * S }
})
ok('the block carries a done tick', !!at)
if (at) { await p.mouse.move(at.x, at.y); await p.waitForTimeout(120); await p.mouse.down(); await p.mouse.up() }
await p.waitForTimeout(900)

const dialog = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
ok('the window opened', await dialog.count() === 1)
const box = dialog.locator('[data-outcome-box="expenses"]')
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }
const openBox = async () => { await box.getByRole('button', { name: /^Expenses:/ }).click(); await p.waitForTimeout(300) }
const row = id => box.locator(`[data-outcome-expense="${id}"]`)

// ── off ─────────────────────────────────────────────────────────────────────
if (MODE === 'off') {
  ok('the Tasks box is still there — the window itself is not broken', await dialog.locator('[data-outcome-box="tasks"]').count() === 1)
  ok('a plan without Finance does not draw the Expenses box', await box.count() === 0)
  ok('and nothing of the ledger was ever read', financeReads.length === 0, JSON.stringify(financeReads))
  await done()
}

ok('the Expenses box is a box, closed to begin with', await box.count() === 1 && await box.getAttribute('data-open') === '0')

// ── lock ────────────────────────────────────────────────────────────────────
if (MODE === 'lock') {
  const summary = await box.getByRole('button', { name: /^Expenses:/ }).getAttribute('aria-label')
  ok('the box says it is locked', /Locked/.test(summary ?? ''), summary ?? '')
  await openBox()
  const t = await box.innerText()
  ok('a locked box shows nothing of the ledger',
     !/Zomato|640|1,420|Client dinner|580|Cash — Teradix/.test(t), t.replace(/\n+/g, ' | ').slice(0, 200))
  ok('and no form to file against an account you cannot see', await box.getByRole('button', { name: 'Add as draft' }).count() === 0)
  ok('it asks for the password in place', await box.getByLabel('Finance password').count() === 1)
  await box.getByLabel('Finance password').fill('wrong')
  await box.getByRole('button', { name: 'Unlock', exact: true }).click()
  await p.waitForTimeout(900)
  ok('a wrong one is refused out loud', /not the password/.test(await box.innerText()))
  ok('and nothing is shown for it', !/Zomato|Cash — Teradix/.test(await box.innerText()))
  await box.getByLabel('Finance password').fill(PASSWORD)
  await box.getByRole('button', { name: 'Unlock', exact: true }).click()
  await p.waitForTimeout(1200)
  ok('the right one opens it, in the same window', await dialog.count() === 1 && await row('tx-unpaid-near').count() === 1)
  await done()
}

await openBox()
ok('the box opened', await box.getAttribute('data-open') === '1')

// ── fx ──────────────────────────────────────────────────────────────────────
if (MODE === 'fx') {
  // An envelope entry in a currency nobody has a rate for: the sum cannot be
  // known, so no "left" is claimed.
  await box.getByRole('button', { name: 'Meals', exact: true }).click()
  ok('Meals is the budgeted one, but with an AED entry in it there is no figure', await box.locator('[data-outcome-envelope]').count() === 0)
  await done()
}

// ── expenses ────────────────────────────────────────────────────────────────
ok('unpaid bills near the day are offered', await row('tx-unpaid-near').count() === 1)
ok('an old unpaid bill is not', await row('tx-unpaid-far').count() === 0)
ok('a paid one is not', await row('tx-paid-near').count() === 0)
ok('nothing is linked yet', (await live()).length === 0)

// The envelope: 1,420 of 2,000 spent, and only paid money counts.
await box.getByRole('button', { name: 'Meals', exact: true }).click()
const strip = () => box.locator('[data-outcome-envelope]').innerText()
ok('Meals has a monthly budget and says what is left of it', /580 left of EGP 2,000/.test(await strip()), await strip())
ok('the unpaid lunch is not in it', !/over/.test(await strip()))

// File one.
await box.getByRole('button', { name: 'Transport', exact: true }).click()
ok('Transport has no budget, so no figure is claimed', await box.locator('[data-outcome-envelope]').count() === 0)
await box.getByPlaceholder('Amount').fill('85')
await box.getByLabel('What it was').first().fill('Taxi to the client')
await box.getByRole('button', { name: 'Add as draft' }).click()
await p.waitForTimeout(600)
const made = upserts.find(r => r.payee === 'Taxi to the client')
ok('it reached the ledger', !!made)
ok('as an expense, against the account, in its currency, positive',
   made?.tx_type === 'expense' && made?.account_id === 'acc-cash' && made?.currency === 'EGP' && made?.amount === 85, JSON.stringify({ t: made?.tx_type, a: made?.account_id, c: made?.currency, n: made?.amount }))
ok('with the category it was filed under and the meeting\'s day', made?.category_id === 'cat-transport' && made?.date === TODAY)
ok('and says where it came from', made?.note === 'From "Weekly Sync"')
ok('UNPAID: no payment date and not cleared', made?.paid_at === null && made?.is_cleared === false, JSON.stringify({ p: made?.paid_at, c: made?.is_cleared }))
const madeId = made?.id
ok('its row is a draft', await row(madeId).getAttribute('data-draft') === '1')
let l = (await live()).find(x => x.recordId === madeId)
ok('the thread says made', l?.role === 'made' && l?.eventId === 'ev-sync-1', JSON.stringify(l))
ok('the count moved', /1 linked/.test(await text()))

// Confirm a bill that was already there: Meals goes over.
await row('tx-unpaid-near').getByRole('button', { name: /^Confirm/ }).click()
await p.waitForTimeout(600)
const conf = upserts.filter(r => r.id === 'tx-unpaid-near').at(-1)
ok('confirming writes a payment date and clears it', conf?.paid_at === TODAY && conf?.is_cleared === true, JSON.stringify({ p: conf?.paid_at, c: conf?.is_cleared }))
ok('the row stops being a draft', await row('tx-unpaid-near').getAttribute('data-draft') === '0')
l = (await live()).find(x => x.recordId === 'tx-unpaid-near')
ok('and an old entry confirmed here is touched, not made', l?.role === 'touched', JSON.stringify(l))
await box.getByRole('button', { name: 'Meals', exact: true }).click()
ok('now the envelope has the money in it: 2,060 against 2,000', /60 over of EGP 2,000/.test(await strip()), await strip())

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
// Take that back.
await row('tx-unpaid-near').getByRole('button', { name: /^Undo$/ }).click()
await p.waitForTimeout(600)
const back = upserts.filter(r => r.id === 'tx-unpaid-near').at(-1)
ok('Undo on a confirmation makes it a draft again', back?.paid_at === null && back?.is_cleared === false)
ok('and takes the link it made', !(await live()).some(x => x.recordId === 'tx-unpaid-near'))
ok('and the envelope is 580 left again', /580 left of EGP 2,000/.test(await strip()), await strip())

// Edit the draft in place.
await row(madeId).getByRole('button', { name: /^Edit /i }).click()
await p.waitForTimeout(250)
ok('the fields opened inside the row', await row(madeId).getAttribute('data-editing') === '1' && await dialog.count() === 1)
const amt = row(madeId).locator('input').nth(1)
await amt.fill('95'); await amt.blur()
await p.waitForTimeout(500)
ok('a new amount is written', upserts.filter(r => r.id === madeId).at(-1)?.amount === 95, JSON.stringify(upserts.filter(r => r.id === madeId).map(r => r.amount)))
await row(madeId).getByLabel('Category').selectOption('cat-parking')
await p.waitForTimeout(500)
ok('a new category is written', upserts.filter(r => r.id === madeId).at(-1)?.category_id === 'cat-parking')

// And away.
await row(madeId).getByRole('button', { name: /^Undo$/ }).click()
await p.waitForTimeout(600)
ok('Undo on an entry made here deletes it from the ledger', deletes.some(s => s.includes(madeId)), JSON.stringify(deletes))
ok('and its row', await row(madeId).count() === 0)
ok('and its link', !(await live()).some(x => x.recordId === madeId))
await done()
