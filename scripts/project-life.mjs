// node scripts/project-life.mjs [money|locked|money-off|habits|books|library-off|work|budget|budget-locked|budget-loaded|budget-nocolumn]
// Needs a dev server on 5199.
//
// Chunk 7 of Projects: the personal-life tabs — Money (finance entries), Habits
// and Books — each behind the gate of the module it reads. The stub serves the
// finance, habit and library tables in the shape the project really sends, and
// records every read and write, because most of what matters here is what is NOT
// done: no figure while locked, nothing read from a module that is off, nothing
// written to Finance, Habits or the Library by linking.
//
//   money      figures (settled only, owed apart, a currency with no rate left out),
//              link / unlink, a stale snapshot refreshed, another year's entry kept,
//              an entry gone from the open year called out
//   locked     a locked Finance draws nothing of the ledger; the password opens it
//   money-off  a plan without Finance has no Money tab and reads no finance table
//   habits     a habit's week as drawn squares, a part-day as a part-fill, a deleted
//              habit named as such; inactive habits are not offered
//   books      progress is the Library's own (furthest page), a deleted book is named
//   library-off the Library switched off: no Books tab, no library table read
//   budget     a project's budget against what it has spent: set, edited, over, unrated, removed,
//              refused when it is not an amount; owed shown apart; understated when a currency has no rate
//   budget-locked  behind the finance lock: no budget figure exists in the page while locked
//   budget-loaded  read from the server row; a budget cleared on another device clears here
//   budget-nocolumn  a database without 20260045: the project still saves, the budget stays here, the banner names the file
//   work       a work project offers none of the three — unless it already holds one
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'money'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = ymd(new Date())
const DAYS_AGO = n => ymd(new Date(Date.now() - n * 864e5))
const NOW = new Date().toISOString()
const P_P = 'aaaaaaaa-0000-4000-8000-00000000000a'     // personal
const P_W = 'aaaaaaaa-0000-4000-8000-00000000000b'     // work
const project = (id, name, o = {}) => ({
  id, user_id: U, name, kind: 'personal', color: '#1D8A6A', status: 'active', company_id: null, start_date: null,
  target_date: null, notes: null, archived: false, created_at: NOW, updated_at: NOW, ...o,
})
const lid = n => `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const link = (n, pid, kind, ref, meta = null) => ({ id: lid(n), project_id: pid, user_id: U, kind, ref_id: ref, meta, created_at: NOW })

// ── Finance rows, as the project sends them ───────────────────────────────────
const ACCOUNTS = [{ id: 'acc-cash', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: NOW }]
const CATS = [{ id: 'cat-home', user_id: U, name: 'Home', icon: '🏠', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: NOW }]
const tx = (id, over) => ({ id, user_id: U, account_id: 'acc-cash', to_account_id: null, category_id: 'cat-home', amount: 100, currency: 'EGP',
  tx_type: 'expense', payee: id, date: TODAY, paid_at: TODAY, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: NOW, ...over })
const TXS = [
  tx('tx-tile', { payee: 'Tile shop', amount: 1200 }),
  tx('tx-cabinet', { payee: 'Cabinet deposit', amount: 500, paid_at: null, is_cleared: false }),
  tx('tx-plumber', { payee: 'Plumber', amount: 800 }),
  tx('tx-refund', { payee: 'Refund', amount: 100, tx_type: 'income' }),
  tx('tx-aed', { payee: 'Dubai fittings', amount: 100, currency: 'AED' }),
  tx('tx-groceries', { payee: 'Groceries', amount: 60 }),
]
const meta = t => ({ payee: t.payee, amount: t.amount, currency: t.currency, date: t.date, ...(t.paid_at ? { paidAt: t.paid_at } : {}), type: t.tx_type })
const T = id => TXS.find(t => t.id === id)

// ── Habits and books ──────────────────────────────────────────────────────────
const H0 = '2026-01-01T00:00:00.000Z'
const HABITS = [
  { id: 'h-write', user_id: U, name: 'Write 30 min', emoji: '✍️', color: '#7F77DD', frequency: 'daily', is_active: true, created_at: H0, type: 'boolean' },
  { id: 'h-water', user_id: U, name: 'Water', emoji: '💧', color: '#60A5FA', frequency: 'daily', is_active: true, created_at: H0, type: 'quantity', goal: 8, unit: 'glasses' },
  { id: 'h-old', user_id: U, name: 'Retired habit', emoji: '🗑', color: '#888780', frequency: 'daily', is_active: false, created_at: H0, type: 'boolean' },
  { id: 'h-extra', user_id: U, name: 'Stretching', emoji: '🧘', color: '#1D9E75', frequency: 'daily', is_active: true, created_at: H0, type: 'boolean' },
]
// Write: ticked on 5 of the last 7 days (today back to 4 days ago). Water: 5 of 8 glasses today.
const LOGS = [
  ...[0, 1, 2, 3, 4].map(n => ({ habit_id: 'h-write', user_id: U, date: DAYS_AGO(n), completed: true })),
  { habit_id: 'h-water', user_id: U, date: TODAY, completed: false, quantity: 5 },
]
const book = (id, over) => ({ id, user_id: U, title: id, subtitle: null, authors: [], isbn: null, publisher: null, published_year: null,
  pages: null, language: null, description: null, cover_url: null, source: 'manual', source_key: null, status: 'want', format: 'print',
  rating: 0, review: null, spine_color: '#7F77DD', file_path: null, shelf_order: 0, started_on: null, finished_on: null, added_at: H0, updated_at: H0, ...over })
const BOOKS = [
  book('b-deep', { title: 'Deep Work', authors: ['Cal Newport'], pages: 304, status: 'reading', shelf_order: 0 }),
  book('b-fresh', { title: 'Fresh Start', authors: ['Ana Writer'], pages: 200, status: 'want', shelf_order: 1 }),
  book('b-done', { title: 'Finished Earlier', authors: ['Someone'], pages: 200, status: 'finished', finished_on: '2026-03-01', shelf_order: 2 }),
  book('b-extra', { title: 'Another Book', authors: ['Other'], pages: 100, status: 'want', shelf_order: 3 }),
]
const SESSIONS = [{ id: 's-1', user_id: U, book_id: 'b-deep', kind: 'read', on_date: DAYS_AGO(2), minutes: 30, pages: 214, to_page: 214, created_at: NOW }]

const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
db.projects = [project(P_P, 'Kitchen renovation', MODE === 'budget-loaded' ? { budget_amount: 5000, budget_currency: 'EGP' } : MODE.startsWith('budget') && MODE !== 'budget-nocolumn' ? { budget_amount: null, budget_currency: null } : {}), project(P_W, 'Launch the site', { kind: 'work', color: '#2F63A8' })]
const budgetRefused = []
const lastYear = `${new Date().getFullYear() - 2}-03-01`
if (MODE === 'money' || MODE === 'locked' || MODE === 'money-off' || MODE.startsWith('budget')) db.project_links = [
  link(1, P_P, 'entry', 'tx-tile', meta(T('tx-tile'))),
  link(2, P_P, 'entry', 'tx-cabinet', meta(T('tx-cabinet'))),
  link(3, P_P, 'entry', 'tx-plumber', { ...meta(T('tx-plumber')), payee: 'Old plumber name', amount: 700 }),      // stale snapshot
  link(4, P_P, 'entry', 'tx-aed', meta(T('tx-aed'))),
  link(5, P_P, 'entry', 'tx-old-year', { payee: 'Last-century boiler', amount: 300, currency: 'EGP', date: lastYear, paidAt: lastYear, type: 'expense' }),   // another year: not loaded
  link(7, P_P, 'entry', 'tx-refund', meta(T('tx-refund'))),       // income, settled: Received
  link(6, P_P, 'entry', 'tx-gone', { payee: 'Deleted receipt', amount: 50, currency: 'EGP', date: TODAY, paidAt: TODAY, type: 'expense' }),               // this year, not in Finance
]
if (MODE === 'habits') db.project_links = [link(1, P_P, 'habit', 'h-write'), link(2, P_P, 'habit', 'h-water'), link(3, P_P, 'habit', 'h-deleted')]
if (MODE === 'books' || MODE === 'library-off') db.project_links = [link(1, P_P, 'book', 'b-deep'), link(2, P_P, 'book', 'b-done'), link(3, P_P, 'book', 'b-gone')]
if (MODE === 'work') db.project_links = [link(1, P_W, 'habit', 'h-write')]

const PASSWORD = 'correct horse'
const salt = randomBytes(16)
const LOCK = { enabled: true, relock: 15, password: { salt: salt.toString('base64'), rounds: 210000, hash: pbkdf2Sync(PASSWORD, salt, 210000, 32, 'sha256').toString('base64') } }

const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const reads = { finance: [], habits: [], library: [] }
const writes = { finance: [], habits: [], library: [] }
let linkWrites = 0
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 }, timezoneId: 'UTC', locale: 'en-GB' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/rpc/my_modules')) {
    const on = id => !(id === 'finance' && MODE === 'money-off')
    return j(['projects', 'tasks', 'calendar', 'finance', 'habits', 'library'].map(id => ({ module_id: id, label: id, enabled: on(id) })))
  }
  const tbl = u.pathname.split('/').pop()
  const area = tbl.startsWith('finance_') ? 'finance' : tbl.startsWith('habit') ? 'habits' : tbl.startsWith('library_') ? 'library' : null
  if (area) (q.method() === 'GET' ? reads : writes)[area].push(`${q.method()} ${tbl}`)
  if (tbl === 'finance_accounts' && q.method() === 'GET') return j(ACCOUNTS)
  if (tbl === 'finance_categories' && q.method() === 'GET') return j(CATS)
  if (tbl === 'finance_transactions' && q.method() === 'GET') return j(TXS)
  if (tbl === 'habits' && q.method() === 'GET') return j(HABITS)
  if (tbl === 'habit_logs' && q.method() === 'GET') return j(LOGS)
  if (tbl === 'library_books' && q.method() === 'GET') return j(BOOKS)
  if (tbl === 'library_sessions' && q.method() === 'GET') return j(SESSIONS)
  const table = Object.keys(db).find(t => u.pathname.endsWith('/' + t))
  if (!table) return j([])
  const m = q.method()
  if (m === 'GET') return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table])
  if (table === 'project_links') linkWrites++
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    if (MODE === 'budget-nocolumn' && table === 'projects' && rows.some(r => 'budget_amount' in r)) { budgetRefused.push(rows.map(r => r.budget_amount)); return j({ code: 'PGRST204', message: "Could not find the 'budget_amount' column of 'projects' in the schema cache" }, 400) }
    for (const rw of rows) {
      const i = db[table].findIndex(x => x.id === rw.id || (table === 'project_links' && x.project_id === rw.project_id && x.kind === rw.kind && x.ref_id === rw.ref_id))
      if (i >= 0) db[table][i] = { ...db[table][i], ...rw }; else db[table].push(rw)
    }
    return j([])
  }
  if (m === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); for (const rw of db[table]) Object.assign(rw, body); return j([]) }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.addInitScript(([s, lock, locked, libOff]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'projects', themeId: 'sunlit-bento' }, version: 0 }))
  if (locked) localStorage.setItem('finance-lock', JSON.stringify(lock))
  if (libOff) localStorage.setItem('library-settings', JSON.stringify({ enabled: false }))
} catch {} }, [session, LOCK, MODE === 'locked' || MODE === 'budget-locked', MODE === 'library-off'])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
p.on('dialog', d => d.accept())
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore
  return await (new Function('proj', `return (${src})(proj)`))(proj)
}, [fn.toString(), URLS])
const linksOf = kind => S(proj => proj.getState().links).then(ls => ls.filter(l => l.kind === kind))
ok('found the app\'s own project store', !!URLS.proj)

const openProject = async (pid, tab) => {
  await p.locator(`[data-project-card="${pid}"]`).waitFor({ state: 'visible', timeout: 10000 })
  await p.locator(`[data-project-card="${pid}"]`).click()
  await p.locator(`[data-project-page="${pid}"]`).waitFor({ state: 'visible' })
  if (tab) await p.getByRole('tab', { name: tab }).click()
}
const tabNames = () => p.getByRole('tab').allInnerTexts()
const stat = k => p.locator(`[data-project-money-stat="${k}"]`).innerText().then(t => t.replace(/\s+/g, ' ').trim())

if (MODE === 'money') {
  await openProject(P_P, /^Money/)
  await p.locator('[data-project-money]').waitFor({ state: 'visible', timeout: 8000 })
  await p.waitForTimeout(2500)
  ok('a personal project has a Money tab, counting its 7 entries', (await tabNames()).some(t => /^Money · 7/.test(t)), JSON.stringify(await tabNames()))
  // Spent: tile 1200 + plumber 800 (the live amount, once refreshed) + old-year 300 + gone 50 = 2350. AED has no rate: left out. Cabinet is unpaid.
  ok('Spent counts settled entries only: 2,350 (the unpaid deposit and the unrated AED entry are not in it)', /2,350/.test(await stat('spent')), await stat('spent'))
  ok('Received is the settled income only: 100 (and none of it is in Spent)', /\b100\b|100\.00/.test(await stat('received')), await stat('received'))
  ok('Still owed carries the unpaid deposit: 500, one unpaid', /500/.test(await stat('owed')) && /1 unpaid/.test(await stat('owed')), await stat('owed'))
  ok('a currency with no rate is named and left out, never guessed', await p.locator('[data-project-money-unconverted]').count() === 1 && /No exchange rate for AED/.test(await p.locator('[data-project-money-unconverted]').innerText()))
  const st = await p.locator('[data-entry-status]').allInnerTexts()
  ok('each row says Paid or Unpaid', st.filter(s => /^Unpaid$/i.test(s)).length === 1 && st.filter(s => /^Paid$/i.test(s)).length >= 4, JSON.stringify(st))
  ok('an entry from another year (not loaded) is listed from its snapshot, and is not called missing', await p.locator('[data-project-entry="tx-old-year"]').count() === 1 && await p.locator('[data-project-entry="tx-old-year"] [data-entry-missing]').count() === 0)
  ok('an entry from the OPEN year that Finance no longer has is called out', await p.locator('[data-project-entry="tx-gone"] [data-entry-missing]').count() === 1)
  const plumber = (await linksOf('entry')).find(l => l.refId === 'tx-plumber')
  ok('a stale snapshot is refreshed from the loaded entry', plumber?.meta?.payee === 'Plumber' && plumber?.meta?.amount === 800, JSON.stringify(plumber?.meta))
  ok('and the refresh reached the server', db.project_links.find(l => l.ref_id === 'tx-plumber')?.meta?.amount === 800)
  const old = (await linksOf('entry')).find(l => l.refId === 'tx-old-year')
  ok('an entry that is not loaded keeps the snapshot it had', old?.meta?.payee === 'Last-century boiler' && db.project_links.find(l => l.ref_id === 'tx-old-year')?.meta?.payee === 'Last-century boiler')

  const opts = await p.getByLabel('Link an entry').locator('option').allTextContents()
  ok('the picker offers entries not yet linked — not the linked ones', opts.some(o => /Groceries/.test(o)) && !opts.some(o => /Tile shop|Plumber|Cabinet|Refund/.test(o)), JSON.stringify(opts))
  await p.getByLabel('Find an entry').fill('groc')
  ok('typing narrows it', (await p.getByLabel('Link an entry').locator('option').allTextContents()).filter(o => /·/.test(o)).length === 1)
  await p.getByLabel('Link an entry').selectOption({ label: opts.find(o => /Groceries/.test(o)) })
  await p.waitForTimeout(2800)
  const g = (await linksOf('entry')).find(l => l.refId === 'tx-groceries')
  ok('linking one files it with a snapshot', g?.projectId === P_P && g?.meta?.payee === 'Groceries' && g?.meta?.amount === 60, JSON.stringify(g))
  ok('and it reached the server', db.project_links.some(l => l.ref_id === 'tx-groceries' && l.meta?.payee === 'Groceries'))
  ok('Spent moves by that amount: 2,410', /2,410/.test(await stat('spent')), await stat('spent'))
  await p.getByRole('button', { name: 'Take Groceries out of this project' }).click(); await p.waitForTimeout(2800)
  ok('taking it out puts Spent back, and removes it from the server', /2,350/.test(await stat('spent')) && !db.project_links.some(l => l.ref_id === 'tx-groceries'))
  ok('Finance itself was never written to by any of it', writes.finance.length === 0, JSON.stringify(writes.finance))
  const before = linkWrites
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(7000)
  ok('a reload that changes nothing writes nothing back (no ping-pong)', linkWrites === before, `${before} -> ${linkWrites}`)
}

if (MODE.startsWith('budget') && MODE !== 'budget-locked') {
  const card = () => p.locator('[data-project-budget]')
  const projNow = () => S(proj => proj.getState().projects.find(x => x.id === 'aaaaaaaa-0000-4000-8000-00000000000a'))
  const srvBudget = () => ({ a: db.projects.find(x => x.id === P_P)?.budget_amount, c: db.projects.find(x => x.id === P_P)?.budget_currency })
  const fill = () => card().locator('[data-budget-fill]')
  const widthFrac = () => fill().evaluate(e => e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width)
  const colorOfVar = v => p.evaluate(name => { const d = document.createElement('i'); d.style.color = `var(${name})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c }, v)
  const set = async (amt, cur) => {
    await card().getByRole('button', { name: /Set a budget|Edit/ }).click()
    await p.getByLabel('Budget amount').fill(amt)
    if (cur !== undefined) await p.getByLabel('Budget currency').fill(cur)
    await card().getByRole('button', { name: 'Save', exact: true }).click()
  }
  await openProject(P_P, /^Money/)
  await card().waitFor({ state: 'visible', timeout: 8000 })
  await p.waitForTimeout(2500)

  if (MODE === 'budget') {
    ok('with no budget the card says so and draws no figure or bar', await card().locator('[data-budget-empty]').count() === 1 && await card().locator('[data-budget-figure]').count() === 0 && await fill().count() === 0)
    await set('10,000')
    const pr = await projNow()
    ok('Save stores it, in the base currency by default', pr?.budget?.amount === 10000 && pr?.budget?.currency === 'EGP', JSON.stringify(pr?.budget))
    ok('the card shows the budget and what is left of it: 7,650 (spent 2,350, settled only)', /10,000/.test(await card().locator('[data-budget-figure]').innerText()) && /7,650(\.00)? left/.test(await card().locator('[data-budget-left]').innerText()), await card().innerText())
    const f = await widthFrac()
    ok('the bar is drawn at the measured fraction of its track: 23.5%', Math.abs(f - 0.235) < 0.004, String(f))
    ok('and agrees with its aria value (24)', (await card().getByRole('progressbar').getAttribute('aria-valuenow')) === '24')
    ok('the unpaid deposit is apart: 7,150 would be left once it is paid', /7,150(\.00)? would be left once the unpaid bill is paid/.test(await card().innerText()), await card().innerText())
    ok('an entry with no rate makes the figure "at least", not exact', /at least/.test(await card().innerText()))
    await p.waitForTimeout(2800)
    ok('it reached the server with its currency', srvBudget().a === 10000 && srvBudget().c === 'EGP', JSON.stringify(srvBudget()))
    // Edit to below what is spent: over.
    await set('2000')
    ok('below what is spent it says Over by 350', /Over by .*350/.test(await card().locator('[data-budget-left]').innerText()), await card().locator('[data-budget-left]').innerText())
    const red = await colorOfVar('--sb-negative-deep'), ink = await colorOfVar('--sb-ink-2')
    const lc = await card().locator('[data-budget-left]').evaluate(e => getComputedStyle(e).color)
    ok('in the deep negative ink (text), not the fill colour', lc === red && lc !== ink, `${lc} vs ${red}`)
    ok('the bar is full and filled in the negative colour', Math.abs((await widthFrac()) - 1) < 0.004 && (await fill().evaluate(e => getComputedStyle(e).backgroundColor)) === await colorOfVar('--sb-negative'))
    // Validation.
    await card().getByRole('button', { name: 'Edit' }).click()
    const w = db.projects.find(x => x.id === P_P).budget_amount
    await p.getByLabel('Budget amount').fill(''); await card().getByRole('button', { name: 'Save', exact: true }).click()
    ok('an empty amount is refused with a reason', await card().getByRole('alert').count() === 1)
    await p.getByLabel('Budget amount').fill('-5'); await card().getByRole('button', { name: 'Save', exact: true }).click()
    ok('a negative one too', await card().getByRole('alert').count() === 1 && (await projNow()).budget.amount === 2000)
    await p.getByLabel('Budget amount').fill('900'); await p.getByLabel('Budget currency').fill('EG'); await card().getByRole('button', { name: 'Save', exact: true }).click()
    ok('and a currency that is not three letters', await card().getByRole('alert').count() === 1 && (await projNow()).budget.amount === 2000)
    await p.keyboard.press('Escape')
    ok('Escape leaves the budget as it was', (await projNow()).budget.amount === 2000 && await card().locator('[data-budget-figure]').count() === 1)
    void w
    // A currency nobody has a rate for is never guessed.
    await set('500', 'USD')
    ok('a budget in a currency with no rate says so and compares nothing', await card().locator('[data-budget-unrated]').count() === 1 && await card().locator('[data-budget-left]').count() === 0 && await fill().count() === 0 && /no exchange rate for USD/.test(await card().innerText()), await card().innerText())
    ok('but it is still stored as set', (await projNow()).budget.currency === 'USD' && (await projNow()).budget.amount === 500)
    // Remove.
    await card().getByRole('button', { name: 'Edit' }).click(); await card().getByRole('button', { name: 'Remove' }).click(); await p.waitForTimeout(2800)
    ok('Remove clears it here and on the server', (await projNow()).budget === undefined && srvBudget().a === null && srvBudget().c === null, JSON.stringify(srvBudget()))
    ok('and the card is back to "No budget"', await card().locator('[data-budget-empty]').count() === 1)
  }
  if (MODE === 'budget-loaded') {
    ok('a budget on the server row is shown', /5,000/.test(await card().locator('[data-budget-figure]').innerText()) && /2,650(\.00)? left/.test(await card().locator('[data-budget-left]').innerText()), await card().innerText())
    db.projects.find(x => x.id === P_P).budget_amount = null; db.projects.find(x => x.id === P_P).budget_currency = null
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(4500)
    ok('cleared on another device, it clears here (an explicit "none", not silence)', await card().locator('[data-budget-empty]').count() === 1 && (await projNow()).budget === undefined, JSON.stringify((await projNow()).budget))
    db.projects.find(x => x.id === P_P).budget_amount = 7000; db.projects.find(x => x.id === P_P).budget_currency = 'EGP'
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(4500)
    ok('and set on another device, it arrives', /7,000/.test(await card().locator('[data-budget-figure]').innerText()))
  }
  if (MODE === 'budget-nocolumn') {
    await set('3000')
    await p.waitForTimeout(3500)
    ok('the first write is refused naming the column, then retried without it', budgetRefused.length >= 1)
    ok('the project row still saved (name and all)', db.projects.some(x => x.id === P_P && x.name === 'Kitchen renovation') && !('budget_amount' in db.projects.find(x => x.id === P_P)))
    ok('the budget stays on this device and is still drawn', (await projNow()).budget?.amount === 3000 && /3,000/.test(await card().locator('[data-budget-figure]').innerText()))
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(4500)
    ok('a reload from a server that lacks the columns does not wipe it', (await projNow()).budget?.amount === 3000)
    ok('and the banner names 20260045', /20260045_project_budget\.sql/.test(await p.locator('[data-projects-gap]').innerText().catch(() => '')))
    const n = budgetRefused.length
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(4500)
    ok('it does not keep retrying the refused write (no ping-pong)', budgetRefused.length === n, `${n} -> ${budgetRefused.length}`)
  }
}
if (MODE === 'budget-locked') {
  db.projects.find(x => x.id === P_P).budget_amount = 5000; db.projects.find(x => x.id === P_P).budget_currency = 'EGP'
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(3500)
  await openProject(P_P)
  await p.getByRole('tab', { name: /^Money/ }).click()
  await p.locator('[data-project-money-locked]').waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  ok('the locked box is drawn (so the absence below is about something)', await p.locator('[data-project-money-locked]').count() === 1)
  const txt = await p.locator('[data-project-page]').innerText()
  ok('locked: no budget, no figure of it, no card', await p.locator('[data-project-budget]').count() === 0 && !/5,000|Budget|left/.test(txt), txt.replace(/\n/g, ' | ').slice(0, 160))
}
if (MODE === 'locked') {
  await openProject(P_P)
  ok('the Money tab is still offered when locked', (await tabNames()).some(t => /^Money/.test(t)), JSON.stringify(await tabNames()))
  await p.getByRole('tab', { name: /^Money/ }).click()
  await p.locator('[data-project-money-locked]').waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  ok('the locked box is drawn (so the absences below are about something)', await p.locator('[data-project-money-locked]').count() === 1)
  const txt = await p.locator('[data-project-page]').innerText()
  ok('locked: no figure, payee or entry is drawn', !/Tile shop|Plumber|Cabinet|1,200|2,350|500|Last-century|Deleted receipt/.test(txt), txt.replace(/\n/g, ' | ').slice(0, 200))
  ok('and there is a way to unlock in place', await p.getByLabel('Finance password').count() === 1)
  ok('and no stat tile exists in the page at all', await p.locator('[data-project-money-stat]').count() === 0 && await p.locator('[data-project-entry]').count() === 0)
  await p.getByLabel('Finance password').fill('wrong password'); await p.getByRole('button', { name: 'Unlock', exact: true }).click(); await p.waitForTimeout(2500)
  ok('a wrong password opens nothing and says so', await p.locator('[data-project-money]').count() === 0 && await p.getByRole('alert').count() === 1)
  await p.getByLabel('Finance password').fill(PASSWORD); await p.getByRole('button', { name: 'Unlock', exact: true }).click()
  await p.locator('[data-project-money]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  ok('the right password shows the money', await p.locator('[data-project-money]').count() === 1 && /Tile shop/.test(await p.locator('[data-project-page]').innerText()))
}

if (MODE === 'money-off') {
  await openProject(P_P)
  ok('a plan without Finance has no Money tab', !(await tabNames()).some(t => /^Money/.test(t)), JSON.stringify(await tabNames()))
  await p.waitForTimeout(1500)
  ok('and no finance table was ever read (the page is the positive claim: it is open)', reads.finance.length === 0 && await p.locator('[data-project-page]').count() === 1, JSON.stringify(reads.finance))
  ok('the other personal tabs are unaffected', (await tabNames()).some(t => /^Habits/.test(t)) && (await tabNames()).some(t => /^Books/.test(t)))
}

if (MODE === 'habits') {
  await openProject(P_P, /^Habits/)
  await p.locator('[data-project-habits]').waitFor({ state: 'visible' })
  await p.waitForTimeout(1500)
  ok('the tab counts 3 links (one is to a deleted habit)', (await tabNames()).some(t => /^Habits · 3/.test(t)), JSON.stringify(await tabNames()))
  const write = p.locator('[data-project-habit="h-write"]')
  ok('a boolean habit shows "5 of 7 days"', /5 of 7 days/.test(await write.locator('[data-habit-count]').innerText()), await write.locator('[data-habit-count]').innerText())
  const ps = await write.locator('[data-day]').evaluateAll(els => els.map(e => Number(e.getAttribute('data-p'))))
  ok('drawn as seven squares, oldest first: two empty, then five full', ps.length === 7 && JSON.stringify(ps) === JSON.stringify([0, 0, 1, 1, 1, 1, 1]), JSON.stringify(ps))
  const fills = await write.locator('[data-day]').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor))
  ok('and the fill is really painted on the full days only (measured, not the attribute)', fills.slice(0, 2).every(f => f === 'rgba(0, 0, 0, 0)') && fills.slice(2).every(f => f !== 'rgba(0, 0, 0, 0)'), JSON.stringify(fills))
  const water = p.locator('[data-project-habit="h-water"]')
  const wp = await water.locator('[data-day]').last().getAttribute('data-p')
  ok('a measured habit is a PART-day today: 5 of 8 glasses = 0.63', wp === '0.63', wp)
  const wbg = await water.locator('[data-day]').last().evaluate(el => getComputedStyle(el).backgroundImage)
  ok('drawn as a part-fill, not as done', /linear-gradient/.test(wbg), wbg)
  ok('and it does not count as a done day', /0 of 7 days/.test(await water.locator('[data-habit-count]').innerText()), await water.locator('[data-habit-count]').innerText())
  ok('a habit deleted in Habits is named as such', /This habit was deleted/.test(await p.locator('[data-project-habit="h-deleted"]').innerText()))
  const opts = await p.getByLabel('Link a habit').locator('option').allTextContents()
  ok('the picker offers active habits not yet linked — not the retired one, not the linked ones', JSON.stringify(opts.filter(o => /·|[A-Za-z]/.test(o) && !/^Link/.test(o))) === JSON.stringify(['🧘 Stretching']), JSON.stringify(opts))
  await p.getByLabel('Link a habit').selectOption({ label: '🧘 Stretching' }); await p.waitForTimeout(2800)
  ok('linking one files it (no snapshot needed — Habits is local)', (await linksOf('habit')).some(l => l.refId === 'h-extra' && l.projectId === P_P) && db.project_links.some(l => l.ref_id === 'h-extra'))
  await p.getByRole('button', { name: 'Unlink This habit was deleted' }).or(p.getByRole('button', { name: 'Unlink the habit from this project' })).click(); await p.waitForTimeout(2800)
  ok('a dangling link can be unlinked', !db.project_links.some(l => l.ref_id === 'h-deleted'))
  ok('Habits itself was never written to', writes.habits.length === 0, JSON.stringify(writes.habits))
}

if (MODE === 'books') {
  await openProject(P_P, /^Books/)
  await p.locator('[data-project-books]').waitFor({ state: 'visible' })
  await p.waitForTimeout(1500)
  const deep = p.locator('[data-project-book="b-deep"]')
  ok('progress is the furthest page any sitting reached: p. 214 of 304 · 70%', /p\. 214 of 304 · 70%/.test(await deep.locator('[data-book-progress]').innerText()), await deep.locator('[data-book-progress]').innerText())
  const w = await deep.locator('[role=progressbar]').evaluate(el => Math.round(el.firstElementChild.getBoundingClientRect().width / el.getBoundingClientRect().width * 100))
  ok('and the bar is drawn at 70% of its track (measured)', w === 70, `${w}`)
  ok('a finished book with no sittings says Finished', /Finished/.test(await p.locator('[data-project-book="b-done"] [data-book-progress]').innerText()))
  ok('a book removed from the shelf is named as such', /removed from your shelf/.test(await p.locator('[data-project-book="b-gone"]').innerText()))
  const opts = await p.getByLabel('Link a book').locator('option').allTextContents()
  ok('the picker offers shelf books not yet linked', opts.some(o => /Fresh Start/.test(o)) && opts.some(o => /Another Book/.test(o)) && !opts.some(o => /Deep Work|Finished Earlier/.test(o)), JSON.stringify(opts))
  await p.getByLabel('Link a book').selectOption({ label: opts.find(o => /Fresh Start/.test(o)) }); await p.waitForTimeout(2800)
  ok('linking one files it', (await linksOf('book')).some(l => l.refId === 'b-fresh') && db.project_links.some(l => l.ref_id === 'b-fresh'))
  ok('a book with no sittings says so rather than showing 0%', /No pages logged yet/.test(await p.locator('[data-project-book="b-fresh"] [data-book-progress]').innerText()))
  ok('the Library itself was never written to', writes.library.length === 0, JSON.stringify(writes.library))
}

if (MODE === 'library-off') {
  await openProject(P_P)
  ok('with the Library switched off there is no Books tab', !(await tabNames()).some(t => /^Books/.test(t)), JSON.stringify(await tabNames()))
  await p.waitForTimeout(1500)
  ok('and no library table was read (the page is the positive claim: it is open)', reads.library.length === 0 && await p.locator('[data-project-page]').count() === 1, JSON.stringify(reads.library))
  ok('the other personal tabs are unaffected', (await tabNames()).some(t => /^Money/.test(t)) && (await tabNames()).some(t => /^Habits/.test(t)))
}

if (MODE === 'work') {
  await openProject(P_W)
  const names = await tabNames()
  ok('a work project offers no Money or Books tab', !names.some(t => /^Money|^Books/.test(t)), JSON.stringify(names))
  ok('but shows Habits because it already holds a linked habit', names.some(t => /^Habits · 1/.test(t)), JSON.stringify(names))
  await p.getByRole('tab', { name: /^Habits/ }).click()
  ok('and that link is not hidden', await p.locator('[data-project-habit="h-write"]').count() === 1)
  await p.getByRole('button', { name: 'Back to all projects' }).click()
  await openProject(P_P)
  const personal = await tabNames()
  ok('while the personal one offers all three', ['Money', 'Habits', 'Books'].every(n => personal.some(t => new RegExp('^' + n).test(t))), JSON.stringify(personal))
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
