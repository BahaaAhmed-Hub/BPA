// Open hours on the grid: drawn always, inert out of the mode, and a booking
// nested inside the box it was booked into.
//
// Three claims, each with the thing that would make it a lie:
//
// - **Drawn outside marking mode.** They used to be gated on `openHours`, so
//   leaving the mode made every open hour invisible and the one screen that
//   could answer "what am I offering this week?" showed nothing. The control
//   is the mode being off — if the box only appears while marking, this fails.
// - **Inert outside marking mode.** A box lying across the column at
//   `left:0 right:0` would swallow the drag that draws an event over those
//   hours, which is the gesture the grid exists for. Measured with
//   `elementFromPoint` at the box's own centre — the DOM-text assertion that
//   cannot see stacking is the mistake the Budget drill-down taught.
// - **A booking sits inside the border.** An event within a window's minutes
//   is inset; one that runs past its end is not, because that is not an hour
//   the window offered. Measured as real rects, not as a style string.
//
//   node scripts/open-hours-are-visible.mjs [shows|inert|nested|panel|delete]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'shows'
const U = user.id

const monday = (() => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const plus = (date, days) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// Wednesday, 09:00–17:00, every week. Wide enough to hold a meeting whole.
const WED = plus(monday, 2)
const WINDOW = {
  id: 'w-open', on_date: WED, start_min: 540, end_min: 1020,
  repeat: { kind: 'weekly', interval: 1, until: null }, skips: [], label: null,
}
// Tuesday, one-off, so the panel list has two rows of different kinds.
const TUE = plus(monday, 1)
const WINDOW2 = {
  id: 'w-once', on_date: TUE, start_min: 600, end_min: 750,
  repeat: { kind: 'none' }, skips: [], label: null,
}

// Two events on the Wednesday: one wholly inside the window, one overrunning
// its end. The second is what stops "everything gets inset" passing.
const iso = (date, min) =>
  new Date(new Date(`${date}T00:00:00`).getTime() + min * 60000).toISOString()
const EVENTS = [
  { id: 'ev-in',  summary: 'Intro call · Dana', start: { dateTime: iso(WED, 600) }, end: { dateTime: iso(WED, 630) }, calendarId: 'primary' },
  { id: 'ev-out', summary: 'Board meeting',     start: { dateTime: iso(WED, 960) }, end: { dateTime: iso(WED, 1140) }, calendarId: 'primary' },
]

const gcal = []
// The server's windows, so a DELETE that lands is a row that stops coming back.
const dels = []
let SERVER_WINDOWS = [WINDOW, WINDOW2]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/booking_profile')) {
    if (m === 'GET') return j({ user_id: U, handle: 'bahaa', display_name: 'Bahaa', blurb: null, timezone: 'Africa/Cairo', active: true })
    return j({})
  }
  if (u.pathname.endsWith('/booking_windows')) {
    if (m === 'GET') return j(SERVER_WINDOWS)
    if (m === 'DELETE') {
      const id = new URLSearchParams(u.search).get('id')?.replace(/^eq\./, '')
      dels.push(id); SERVER_WINDOWS = SERVER_WINDOWS.filter(w => w.id !== id)
    }
    return j({})
  }
  if (u.pathname.endsWith('/meeting_plans') || u.pathname.endsWith('/bookings')) return j([])
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
    return j({ items: EVENTS })
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('bpa-wizard-done', '1')   // the setup guide (PR #62) covers a brand-new account's page
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
} catch { /* quota */ } }, session)

const p = await ctx.newPage()

// Installed before the first navigation, or the counter misses the boot.

const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6500)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const boxes = () => p.locator('[data-open-hours]').count()

ok('the calendar is open', /Ideal Week/.test(await text()))

// ─── Drawn with nobody marking anything ─────────────────────────────────────
// The booking panel has not been opened and the mode has never been on. This
// is the state the old code drew nothing in.
if (MODE === 'shows') {
  ok('open hours are drawn with the mode off', await boxes() >= 1, `${await boxes()} boxes`)
  ok('the marking strip is NOT up — nothing was switched on', !/Marking open hours/i.test(await text()))
  const lbl = await p.locator('[data-open-hours="w-open"]').innerText().catch(() => '')
  ok('the box says its hours', /09:00.*17:00/s.test(lbl), JSON.stringify(lbl))
  // It is a box like an event's, not a hairline band: a real radius.
  const radius = await p.locator('[data-open-hours="w-open"]').evaluate(
    el => parseFloat(getComputedStyle(el).borderTopLeftRadius))
  ok('it is a card-shaped box, not a band', radius >= 6, `${radius}px radius`)
  // It has to say what it is for. An event is a solid card; an open hour is
  // space still on offer, so it is dashed and says so in words.
  ok('the box says it is open to be booked', /Open to book/i.test(lbl), JSON.stringify(lbl))
  const dash = await p.locator('[data-open-hours="w-open"]').evaluate(el => getComputedStyle(el).borderTopStyle)
  ok('it is dashed, so it does not read as a scheduled event', dash === 'dashed', dash)
  if (process.env.SHOT) await p.locator('[data-open-hours="w-open"]').first().scrollIntoViewIfNeeded().then(() => p.screenshot({ path: process.env.SHOT }))
  await b.close(); process.exit(code)
}

// ─── Inert, so the grid is still drawable over those hours ──────────────────
if (MODE === 'inert') {
  const box = p.locator('[data-open-hours="w-open"]')
  const r = await box.boundingBox()
  ok('the box is on the grid', !!r)
  if (!r) { await b.close(); process.exit(1) }
  // The page reports positions in the app's own units (lib/zoomSpace.ts); the mouse and boundingBox work in screen pixels.
  const S = await p.evaluate(() => window.__zoomSpace ?? 1)
  const atCentre = await p.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return { tag: el?.tagName ?? null, open: !!el?.closest('[data-open-hours]') }
  }, { x: (r.x + r.width / 2) / S, y: (r.y + r.height / 2) / S })
  ok('out of the mode the box is not what the pointer hits',
     atCentre.open === false, JSON.stringify(atCentre))

  // And the gesture it would have swallowed still works: drag inside the
  // window's own hours and the composer opens.
  const col = await p.locator(`[data-cal-cols] [data-date="${WED}"]`).boundingBox()
  const hourPx = await p.evaluate(() => {
    const el = document.querySelector('[data-cal-cols]')
    return el ? el.scrollHeight / 24 : 48
  })
  const sc = await p.evaluate(() => {
    const g = document.querySelector('[data-cal-cols]')?.parentElement
    return g ? { top: g.getBoundingClientRect().top, scroll: g.scrollTop } : { top: 0, scroll: 0 }
  })
  const yOf = min => S * (sc.top + (min / 60) * hourPx - sc.scroll)
  const x = col.x + col.width / 2
  await p.mouse.move(x, yOf(690))
  await p.mouse.down()
  await p.mouse.move(x, yOf(690) + 14, { steps: 3 })
  await p.mouse.move(x, yOf(780), { steps: 6 })
  await p.mouse.up()
  await p.waitForTimeout(1200)
  ok('an event can still be drawn across an open hour',
     await p.getByRole('button', { name: /^Create/i }).count() >= 1,
     JSON.stringify((await p.locator('button').allInnerTexts()).filter(t => /create/i.test(t))))
  ok('and drawing one wrote no window and nothing to Google', gcal.length === 0, JSON.stringify(gcal))
  await b.close(); process.exit(code)
}

// ─── A booking is inside the box's border ───────────────────────────────────
if (MODE === 'nested') {
  const win = await p.locator('[data-open-hours="w-open"]').boundingBox()
  ok('the window box is drawn', !!win)
  if (!win) { await b.close(); process.exit(1) }

  const rectOf = async title => {
    const card = p.locator('.event-card').filter({ hasText: title }).first()
    return (await card.count()) ? await card.boundingBox() : null
  }
  const inside = await rectOf('Intro call')
  const over   = await rectOf('Board meeting')
  ok('the booking inside the window is drawn', !!inside, JSON.stringify(inside))
  ok('the meeting that overruns it is drawn', !!over, JSON.stringify(over))

  // Nested means both edges sit within the box's edges.
  const within = inside && inside.x > win.x && (inside.x + inside.width) < (win.x + win.width)
  ok('it sits inside the box on both edges', within,
     `box ${Math.round(win.x)}..${Math.round(win.x + win.width)}  card ${Math.round(inside.x)}..${Math.round(inside.x + inside.width)}`)

  // And the one that runs past the window's end is NOT inset — otherwise
  // "everything is inset" would pass this file.
  const overInset = over && over.x > win.x + 2
  ok('an event that overruns the window is not nested in it', !overInset,
     `box starts ${Math.round(win.x)}, card starts ${Math.round(over.x)}`)
  await b.close(); process.exit(code)
}

// ─── Closing an hour from the list ──────────────────────────────────────────
// A trash on each row, armed by one press and confirmed by a second: a repeating
// window is every week at once, and one stray click should not take it.
if (MODE === 'delete') {
  await p.getByRole('button', { name: /^Booking$/ }).click()
  await p.waitForTimeout(1300)
  const trash = id => p.locator(`[data-booking-hours] button[aria-label^="Close open hours"]`)
  const n0 = await trash().count()
  ok('every row has a delete control', n0 === 2, `${n0}`)
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT.replace('.png', '-panel.png') })
  await trash().first().click()
  await p.waitForTimeout(250)
  ok('one press only arms it — and says what it would do', /Close(?: every week)?\?/.test(await text()), JSON.stringify((await text()).match(/Close[^\n]*\?/)?.[0]))
  ok('…and nothing has been sent yet', dels.length === 0, JSON.stringify(dels))
  // Moving on disarms it.
  await p.locator('[data-booking-hours] p').first().click()
  await p.waitForTimeout(250)
  ok('clicking elsewhere disarms it', !/Close(?: every week)?\?/.test(await text()))
  ok('…still nothing sent', dels.length === 0)
  // Now confirm.
  await trash().first().click(); await p.waitForTimeout(200)
  await p.getByRole('button', { name: /^Confirm: close open hours/ }).click()
  await p.waitForTimeout(900)
  ok('the confirmed press deletes that window on the server', dels.length === 1, JSON.stringify(dels))
  const left = await p.locator('[data-booking-hours] button[aria-label^="Close open hours"]').count()
  ok('its row is gone from the list', left === 1, `${left} left`)
  ok('…and the other one is untouched', !dels.includes(SERVER_WINDOWS[0]?.id))
  const gone = await p.locator(`[data-open-hours="${dels[0]}"]`).count()
  ok('its box is gone from the week', gone === 0, `${gone} boxes`)
  await b.close(); process.exit(code)
}

// ─── The panel lists them ───────────────────────────────────────────────────
{
  await p.getByRole('button', { name: /^Booking$/ }).click()
  await p.waitForTimeout(1300)
  ok('the booking panel opens', /Let people book me/i.test(await text()))
  const t = await text()
  ok('the repeating window is listed with its hours', /09:00–17:00/.test(t), JSON.stringify(t.match(/09:00[^\n]*/)?.[0]))
  ok('the one-off window is listed too', /10:00–12:30/.test(t), JSON.stringify(t.match(/10:00[^\n]*/)?.[0]))
  ok('the repeat is named rather than counted', /every \w{3}/i.test(t), JSON.stringify(t.match(/every \w{3}[^\n]*/i)?.[0]))
  ok('it no longer says only how many there are', !/^2 windows open/m.test(t))
  // The grid's own boxes carry the same aria-label, so this is scoped to the
  // panel: counting both answered 4 for two windows.
  const rows = await p.locator('[data-booking-hours] button[aria-label^="Open hours"]').count()
  ok('each window is its own control in the panel', rows === 2, `${rows} rows`)
  await b.close(); process.exit(code)
}
