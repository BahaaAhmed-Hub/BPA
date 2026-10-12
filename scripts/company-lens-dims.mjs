// The company rail, and what it does to the screen behind it.
//
// Pressing a company's tile puts a lens on every module: what is that
// company's stays as it was, everything else goes quiet. The claim is about
// **what is drawn**, so it is measured as `getComputedStyle().opacity` on the
// real cards — a class-name assertion would pass with the rule missing from
// the stylesheet, which is the whole of what a reader would see.
//
// Three things a wrong implementation would do, each asserted against:
//   - dim nothing (the control, on the code before this)
//   - dim everything, by failing to recognise the chosen company's own rows
//   - **hide** the rest, which would make a lens indistinguishable from an
//     empty week; the dimmed cards must still be on the page and still have
//     a box, because the shape of the week is most of why you looked
//
//   node scripts/company-lens-dims.mjs [rail|calendar|tasks|clear]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const MODE = process.argv[2] ?? 'rail'
const U = user.id

// Deliberately NOT both linked the same way. `calendarId` is optional on a
// company and most real ones are linked by account, so a fixture where every
// company names its calendar is a fixture that cannot fail the way the real
// app did: it dimmed everything, because nothing resolved.
const COMPANIES = [
  { id: 'co-teradix', name: 'Teradix Ltd',     color: '#3B82F6', users: [], calendarId: 'teradix-cal' },
  { id: 'co-dx',      name: 'DX Technologies', color: '#0C8140', users: [], accountId: 'acc-dx' },
]

const monday = (() => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const plus = (date, days) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const WED = plus(monday, 2)
const at = (date, min) => new Date(new Date(`${date}T00:00:00`).getTime() + min * 60000).toISOString()

// One event per company, plus one on a calendar no company owns — the third
// is what proves "not this company" and "no company at all" are both dimmed.
const EVENTS = [
  { id: 'ev-t', summary: 'NEOM — Phase 2',  start: { dateTime: at(WED, 600) }, end: { dateTime: at(WED, 660) }, calendarId: 'teradix-cal' },
  { id: 'ev-d', summary: 'DX board review', start: { dateTime: at(WED, 720) }, end: { dateTime: at(WED, 780) }, calendarId: 'dx-cal' },
  { id: 'ev-p', summary: 'Family dinner',   start: { dateTime: at(WED, 840) }, end: { dateTime: at(WED, 900) }, calendarId: 'primary' },
]

// `company_tag` is the column, and a value that is not one of the four static
// tags is read back as `companyId` — which is what the lens compares against.
const TASKS = [
  { id: 'tk-t', user_id: U, title: 'Teradix — send the deck', quadrant: 'do', status: 'open', completed: false, company_tag: 'co-teradix', priority: 'P1', created_at: new Date().toISOString() },
  // Filed under the company's NAME, the way a task written before companies
  // were rows is: `dbSync` leaves `companyId` empty for it entirely.
  { id: 'tk-d', user_id: U, title: 'DX — chase the invoice',  quadrant: 'do', status: 'open', completed: false, company_tag: 'DX Technologies', priority: 'P1', created_at: new Date().toISOString() },
]

// The second company is linked by ACCOUNT, so the fixture needs a real
// connected account for its calendar to carry one. The stub tells the two
// accounts apart by the bearer token, the way Google does.
const DX_ACCOUNT = {
  id: 'acc-dx', email: 'ops@dxtech.example', name: 'DX Ops',
  providerToken: 'dx-token', providerTokenSavedAt: Date.now(),
  scopes: ['calendar'], connectedAt: new Date().toISOString(), isPrimary: false,
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/tasks')) return j(r.request().method() === 'GET' ? TASKS : {})
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) {
    const dx = (r.request().headers()['authorization'] ?? '').includes('dx-token')
    // The DX calendar is deliberately NOT named after its company and does
    // not carry its id: the only thing that can match it is the account it
    // is on, which is the case an exact-calendar-id match answered
    // "nobody" for — and that is what dimmed a real week to nothing.
    return j({ items: dx
      ? [{ id: 'dx-cal', summary: 'Ops diary', primary: true, accessRole: 'owner', backgroundColor: '#0C8140', selected: true }]
      : [
        { id: 'primary',     summary: user.email,    primary: true,  accessRole: 'owner', backgroundColor: '#9B9180', selected: true },
        { id: 'teradix-cal', summary: 'Teradix Ltd', primary: false, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
      ] })
  }
  if (u.pathname.includes('/events')) {
    const which = decodeURIComponent(u.pathname).match(/calendars\/([^/]+)\/events/)?.[1]
    return j({ items: EVENTS.filter(e => !which || e.calendarId === which) })
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

await ctx.addInitScript(([s, cos, acc]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('professor-connected-accounts', JSON.stringify([acc]))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  // Deliberately NOT clearing `professor-company-focus` here: an init script
  // runs before *every* navigation, so doing it here wiped the lens on the
  // very reload the `clear` case exists to measure. A fresh context already
  // starts with empty storage.
} catch { /* quota */ } }, [session, COMPANIES, DX_ACCOUNT])

const p = await ctx.newPage()
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6500)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)

/** The card's own drawn opacity, and whether it still occupies a box. */
async function card(title) {
  return p.evaluate(t => {
    const el = [...document.querySelectorAll('.event-card, [data-task-node]')]
      .find(n => (n.innerText || '').includes(t))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { opacity: parseFloat(getComputedStyle(el).opacity), w: r.width, h: r.height }
  }, title)
}

ok('the rail is drawn', await p.locator('[data-side-rail]').count() === 1)

if (MODE === 'rail') {
  ok('the nav moved into it', await p.locator('[data-side-rail] button[aria-label="Calendar"]').count() === 1)
  ok('the calendar is the one marked current',
     await p.locator('[data-side-rail] button[aria-current="page"][aria-label="Calendar"]').count() === 1)
  ok('the company rail is its own pill', await p.locator('[data-company-rail]').count() === 1)
  const tiles = await p.locator('[data-company-tile]').count()
  ok('one tile per company', tiles === 2, `${tiles} tiles`)
  ok('each tile says what it does',
     await p.locator('[data-company-tile] >> nth=0').getAttribute('aria-label').then(s => /show only teradix/i.test(s ?? '')))
  ok('nothing is chosen on a fresh browser',
     await p.locator('[data-company-tile][aria-pressed="true"]').count() === 0)

  // The bell and the avatar are about *you*, not about which module is open,
  // so they sit at the corner the eye goes to for status — and they are NOT
  // in the rail any more.
  const avatar = p.locator('button[aria-haspopup="menu"]')
  const ar = await avatar.boundingBox()
  const vw = p.viewportSize().width
  ok('the avatar is top right', !!ar && ar.y < 70 && (ar.x + ar.width) > vw - 90,
     JSON.stringify(ar))
  ok('and no longer inside the rail',
     await p.locator('[data-side-rail] button[aria-haspopup="menu"]').count() === 0)
  const bell = await p.locator('button[aria-label*="otification"], button[title*="otification"]').first().boundingBox().catch(() => null)
  ok('the bell is up there with it', !bell || (bell.y < 70 && bell.x > vw - 220), JSON.stringify(bell))
  ok('and so there is no way-out control yet',
     await p.getByRole('button', { name: /show everything again/i }).count() === 0)
  await b.close(); process.exit(code)
}

if (MODE === 'calendar') {
  ok('the week is drawn', /NEOM/.test(await text()))
  const before = { t: await card('NEOM'), d: await card('DX board'), p: await card('Family dinner') }
  ok('all three events start undimmed',
     before.t?.opacity === 1 && before.d?.opacity === 1 && before.p?.opacity === 1,
     JSON.stringify(before))

  await p.locator('[data-company-tile="co-teradix"]').click()
  await p.waitForTimeout(700)

  const after = { t: await card('NEOM'), d: await card('DX board'), p: await card('Family dinner') }
  ok("the chosen company's event is untouched", after.t?.opacity === 1, JSON.stringify(after.t))
  ok("the other company's event is dimmed", (after.d?.opacity ?? 1) < 0.5, JSON.stringify(after.d))
  ok('an event belonging to no company is dimmed too', (after.p?.opacity ?? 1) < 0.5, JSON.stringify(after.p))
  // Dimmed, never hidden: a lens that removed the rest would be
  // indistinguishable from an empty week.
  ok('the dimmed events are still drawn and still have a box',
     (after.d?.w ?? 0) > 1 && (after.d?.h ?? 0) > 1 && (after.p?.w ?? 0) > 1,
     JSON.stringify([after.d, after.p]))
  ok('the tile says it is the one being shown',
     await p.locator('[data-company-tile="co-teradix"][aria-pressed="true"]').count() === 1)
  ok('and a way out appeared',
     await p.getByRole('button', { name: /show everything again/i }).count() === 1)

  // **The header says what the lens matched.** Without it, a company whose
  // events cannot be resolved looks exactly like a company with nothing on
  // this week — every card quiet, the same sentence either way. That
  // ambiguity is the whole of how the broken resolution was reported.
  const head = await text()
  ok('the header counts what is in focus', /1 Teradix Ltd/.test(head),
     JSON.stringify(head.split('\n').find(l => /event/.test(l))))

  // The second company is linked by ACCOUNT, not by a calendar id — the way
  // most real ones are, and the case an exact-id match answered "nobody" for.
  await p.locator('[data-company-tile="co-dx"]').click()
  await p.waitForTimeout(800)
  const d2 = await card('DX board')
  const t2 = await card('NEOM')
  ok('a company linked by account still matches its events', d2?.opacity === 1, JSON.stringify(d2))
  ok('and the other company is the dimmed one now', (t2?.opacity ?? 1) < 0.5, JSON.stringify(t2))
  await b.close(); process.exit(code)
}

if (MODE === 'tasks') {
  // The lens is a fact about the app, not about one screen.
  await p.locator('[data-company-tile="co-dx"]').click()
  await p.waitForTimeout(600)
  await p.locator('[data-side-rail] button[aria-label="Tasks"]').click()
  await p.waitForTimeout(2500)
  ok('the tasks board is open', /chase the invoice/i.test(await text()))
  const t = await card('send the deck')
  const d = await card('chase the invoice')
  ok("the chosen company's task is untouched", d?.opacity === 1, JSON.stringify(d))
  ok("the other company's task is dimmed", (t?.opacity ?? 1) < 0.5, JSON.stringify(t))
  ok('the lens survived the module change',
     await p.locator('[data-company-tile="co-dx"][aria-pressed="true"]').count() === 1)
  await b.close(); process.exit(code)
}

// MODE === 'clear'
{
  await p.locator('[data-company-tile="co-teradix"]').click()
  await p.waitForTimeout(600)
  ok('a lens is on', (await card('DX board'))?.opacity < 0.5)

  // Pressing the same tile again is the way back, and so is ALL.
  await p.locator('[data-company-tile="co-teradix"]').click()
  await p.waitForTimeout(600)
  ok('pressing the same tile clears it', (await card('DX board'))?.opacity === 1)
  ok('and the way-out control goes with it',
     await p.getByRole('button', { name: /show everything again/i }).count() === 0)

  await p.locator('[data-company-tile="co-dx"]').click()
  await p.waitForTimeout(600)
  ok('a second lens dims the first company', (await card('NEOM'))?.opacity < 0.5)
  await p.getByRole('button', { name: /show everything again/i }).click()
  await p.waitForTimeout(600)
  ok('ALL puts everything back', (await card('NEOM'))?.opacity === 1)

  // A lens surviving a reload is only safe because the rail says it is on.
  await p.locator('[data-company-tile="co-dx"]').click()
  await p.waitForTimeout(600)
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(6500)
  ok('the lens survives a reload', (await card('NEOM'))?.opacity < 0.5, JSON.stringify(await card('NEOM')))
  ok('and the rail still says which one', await p.locator('[data-company-tile="co-dx"][aria-pressed="true"]').count() === 1)
}

await b.close()
process.exit(code)
