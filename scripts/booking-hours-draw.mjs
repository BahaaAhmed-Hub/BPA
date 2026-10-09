// Marking open hours on the week, measured.
//
// The same drag means two things — draw an event, or open an hour — and which
// one is in force is the whole risk. So the assertion is in both directions:
// in the mode a drag writes a window and **no calendar event**; out of it the
// same drag opens the composer and writes **no window**.
//
//   node scripts/booking-hours-draw.mjs [draw|repeat|skip|off]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const MODE = process.argv[2] ?? 'draw'
const U = user.id
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}` })()

// Monday of the week on screen, so the harness knows which date a column is.
const monday = (() => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const plus = (date, days) => {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

// A window already on the books for Tuesday, 14:00–16:00, weekly.
const EXISTING = {
  id: 'w-existing', on_date: plus(monday, 1), start_min: 840, end_min: 960,
  repeat: { kind: 'weekly', interval: 1, until: null }, skips: [], label: null,
}

const windows = MODE === 'draw' || MODE === 'off' ? [] : [EXISTING]
const writes = []        // every write that reached booking_windows
const gcal = []          // every write that reached Google

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
  let body = {}
  try { body = JSON.parse(q.postData() ?? '{}') } catch { /* not json */ }

  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})

  if (u.pathname.endsWith('/booking_profile')) {
    if (m === 'GET') return j({ user_id: U, handle: 'bahaa', display_name: 'Bahaa', blurb: null, timezone: 'Africa/Cairo', active: true })
    return j({})
  }
  if (u.pathname.endsWith('/booking_windows')) {
    if (m === 'GET') return j(windows)
    if (m === 'POST') {
      const row = { id: `w-${writes.length + 1}`, skips: [], label: null, ...(Array.isArray(body) ? body[0] : body) }
      writes.push({ m, row })
      windows.push(row)
      return j(row)
    }
    if (m === 'PATCH') {
      writes.push({ m, patch: body, where: u.search })
      const id = /id=eq\.([^&]+)/.exec(u.search)?.[1]
      const i = windows.findIndex(w => w.id === id)
      if (i >= 0) windows[i] = { ...windows[i], ...body }
      return j([])
    }
    if (m === 'DELETE') {
      writes.push({ m, where: u.search })
      const id = /id=eq\.([^&]+)/.exec(u.search)?.[1]
      const i = windows.findIndex(w => w.id === id)
      if (i >= 0) windows.splice(i, 1)
      return j([])
    }
  }
  if (u.pathname.endsWith('/meeting_plans') || u.pathname.endsWith('/bookings')) return j([])
  if (u.pathname.endsWith('/tasks') || u.pathname.endsWith('/habits')) return j([])
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
  ] })
  if (u.pathname.includes('/events')) {
    if (q.method() !== 'GET') { gcal.push({ m: q.method(), path: u.pathname }); return j({ id: 'ev-new' }) }
    return j({ items: [] })
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
} catch { /* quota */ } }, session)

const p = await ctx.newPage()
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6000)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const bands = () => p.locator('[data-open-hours]').count()

ok('the calendar is open', /Ideal Week/.test(await text()))

// ─── Into the mode ──────────────────────────────────────────────────────────
await p.getByRole('button', { name: /^Booking$/ }).click()
await p.waitForTimeout(1200)
ok('the booking panel opens', /Let people book me/i.test(await text()))

if (MODE !== 'off') {
  await p.getByRole('button', { name: /Mark hours on the week/i }).click()
  await p.waitForTimeout(900)
  ok('the mode says it is on', /Marking open hours/i.test(await text()))
} else {
  ok('the mode is deliberately left off', !/Marking open hours/i.test(await text()))
}

// ─── The drag ───────────────────────────────────────────────────────────────
// Wednesday, from 10:00 to 12:00. Measured off the drawing surface's own rect
// — the box whose top is minute zero — rather than guessed at.
async function dragOn(dateStr, fromMin, toMin) {
  // The column is found by its own date: this week may start on Sunday or on
  // Monday and may be three days wide, so counting from an assumed first day
  // measures the harness's guess rather than the grid.
  const col = await p.locator(`[data-cal-cols] [data-date="${dateStr}"]`).boundingBox()
  if (!col) throw new Error(`no column for ${dateStr}`)
  const hourPx = await p.evaluate(() => {
    const el = document.querySelector('[data-cal-cols]')
    return el ? el.scrollHeight / 24 : 48
  })
  const x = col.x + col.width / 2
  const scroller = await p.evaluate(() => {
    const g = document.querySelector('[data-cal-cols]')?.parentElement
    return g ? { top: g.getBoundingClientRect().top, scroll: g.scrollTop } : { top: 0, scroll: 0 }
  })
  const yOf = m => scroller.top + (m / 60) * hourPx - scroller.scroll
  await p.mouse.move(x, yOf(fromMin))
  await p.mouse.down()
  await p.mouse.move(x, yOf(fromMin) + 14, { steps: 3 })
  await p.mouse.move(x, yOf(toMin), { steps: 6 })
  await p.mouse.up()
  await p.waitForTimeout(1200)
  return { x, y: yOf(fromMin) }
}

const before = writes.length
const DRAWN_ON = plus(monday, 2)
await dragOn(DRAWN_ON, 600, 720)     // Wednesday 10:00 → 12:00

if (MODE === 'off') {
  ok('out of the mode the drag opens the composer, as it always did',
     await p.getByRole('button', { name: /^Create/i }).count() >= 1,
     JSON.stringify((await p.locator('button').allInnerTexts()).filter(t => /create/i.test(t))))
  ok('and writes no open hours at all', writes.length === before, JSON.stringify(writes))
  ok('and nothing reached Google either — Create was never pressed', gcal.length === 0, JSON.stringify(gcal))
  await b.close(); process.exit(code)
}

const made = writes.find(w => w.m === 'POST')
ok('the drag wrote one window', writes.filter(w => w.m === 'POST').length === 1, JSON.stringify(writes.map(w => w.m)))
ok('on the day it was drawn', made?.row?.on_date === DRAWN_ON, `${made?.row?.on_date} vs ${DRAWN_ON}`)
ok('for the hours it was drawn over', made?.row?.start_min === 600 && made?.row?.end_min === 720,
   JSON.stringify([made?.row?.start_min, made?.row?.end_min]))
ok('and nothing at all reached Google', gcal.length === 0, JSON.stringify(gcal))
ok('nothing repeats unless it is said to', (made?.row?.repeat?.kind ?? 'none') === 'none', JSON.stringify(made?.row?.repeat))
ok('the editor opens on the hours just drawn', await p.locator('[role="dialog"][aria-label*="Open hours"]').count() === 1)
ok('and the band is on the grid', await bands() >= 1, String(await bands()))

if (MODE === 'draw') {
  // The composer must not have been opened by the same gesture.
  // "+ New event" is the header's own pill and says nothing about a composer;
  // the composer is the panel with a Create button in it.
  ok('no event composer was opened', await p.getByRole('button', { name: /^Create/i }).count() === 0)
  await p.getByRole('button', { name: /Close these hours/i }).click()
  await p.waitForTimeout(900)
  ok('closing them deletes the row', writes.some(w => w.m === 'DELETE'), JSON.stringify(writes.map(w => w.m)))
  ok('and takes the band off the grid', await bands() === 0, String(await bands()))
  await b.close(); process.exit(code)
}

if (MODE === 'repeat') {
  await p.getByRole('button', { name: /Every week/i }).click()
  await p.waitForTimeout(900)
  const patch = writes.filter(w => w.m === 'PATCH').pop()
  ok('every week is written as a repeat', patch?.patch?.repeat?.kind === 'weekly', JSON.stringify(patch?.patch))
  const here = await bands()
  await p.locator('[role="dialog"][aria-label*="Open hours"] button[aria-label="Close"]').click()
  await p.waitForTimeout(400)
  // The week after, by its own control rather than by counting discs.
  await p.getByRole('button', { name: /The week after/i }).click()
  await p.waitForTimeout(1500)
  const next = await bands()
  ok('the window comes round next week', next >= 1, `${here} this week, ${next} next`)
  ok('and it is the same window, not a second one', next === here, `${here} vs ${next}`)
  await b.close(); process.exit(code)
}

// MODE === 'skip'
{
  // The existing Tuesday window repeats; take one week back.
  await p.locator('[role="dialog"][aria-label*="Open hours"] button[aria-label="Close"]').click().catch(() => {})
  await p.waitForTimeout(400)
  const band = p.locator('[data-open-hours="w-existing"]').first()
  ok('the repeating window is drawn', await band.count() === 1)
  await band.click()
  await p.waitForTimeout(700)
  await p.getByRole('button', { name: /Not this week/i }).click()
  await p.waitForTimeout(900)
  const patch = writes.filter(w => w.m === 'PATCH').pop()
  ok('the week is written as a skip', Array.isArray(patch?.patch?.skips) && patch.patch.skips.includes(EXISTING.on_date),
     JSON.stringify(patch?.patch))
  ok('and that band leaves this week', await p.locator('[data-open-hours="w-existing"]').count() === 0,
     String(await p.locator('[data-open-hours="w-existing"]').count()))
  ok('the window itself is still there, not deleted', !writes.some(w => w.m === 'DELETE'), JSON.stringify(writes.map(w => w.m)))
}

await b.close()
process.exit(code)
