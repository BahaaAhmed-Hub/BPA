// The Events box in the outcome window. Measured against the real bundle with
// Google Calendar served and able to refuse; every write is read off the
// request the calendar actually sent, and the link ledger:
//   events    a follow-up is written to the meeting's calendar with nobody
//             invited unless switched on, edited in place and deleted by its
//             Undo; the next in the series moves and moves back; a refusal
//             says why and leaves no row and no link
//   fallback  a read-only calendar is written to its owner's main one, and
//             says which
//   readonly  with nowhere to write the form is not offered
//   full      the full composer is still one press away
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'events'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => ymd(new Date(d.getTime() + n * 864e5))
const NOW = new Date()
const TODAY = ymd(NOW)
const TOMORROW = addDays(NOW, 1)
const WEEK_ON = addDays(NOW, 7)
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()

const CAL = 'cal-teradix'
const at = (day, hh, mm = 0) => `${day}T${pad(hh)}:${pad(mm)}:00${TZ}`
const EVENT = {
  id: 'ev-sync-1', status: 'confirmed', summary: 'Weekly Sync', recurringEventId: 'series-1',
  htmlLink: 'https://calendar.google.com/event?eid=weekly-sync', location: 'Room 3',
  start: { dateTime: at(TODAY, 10) }, end: { dateTime: at(TODAY, 11) },
  attendees: [
    { email: user.email, self: true, responseStatus: 'accepted' },
    { email: 'ali@teradix.com', displayName: 'Ali Hassan', responseStatus: 'accepted' },
  ],
}
const NEXT = { id: 'ev-next', status: 'confirmed', summary: 'Weekly Sync', recurringEventId: 'series-1',
  start: { dateTime: at(TOMORROW, 10) }, end: { dateTime: at(TOMORROW, 11) } }
const OTHER = { id: 'ev-other', status: 'confirmed', summary: 'Dentist', recurringEventId: 'series-2',
  start: { dateTime: at(TOMORROW, 15) }, end: { dateTime: at(TOMORROW, 16) } }
const COMPANIES = [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: CAL, users: [] }]

// What each calendar lets you do — the modes change this.
const ROLE = MODE === 'readonly' ? { primary: 'reader', teradix: 'reader' } : MODE === 'fallback' ? { primary: 'owner', teradix: 'reader' } : { primary: 'owner', teradix: 'owner' }
const created = []     // events this suite wrote, by id
let seq = 0
const posts = [], patches = [], deletes = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/tasks') && q.method() === 'GET') return j([])
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary', summary: user.email, primary: true, accessRole: ROLE.primary, backgroundColor: '#3B82F6', selected: true },
    { id: CAL, summary: 'Teradix Ltd', accessRole: ROLE.teradix, backgroundColor: '#0C8140', selected: true },
  ] })
  const m = /\/calendars\/([^/]+)\/events(?:\/([^/?]+))?/.exec(u.pathname)
  if (m) {
    const [, calId, evId] = m
    if (q.method() === 'GET') {
      const here = decodeURIComponent(calId) === CAL
      return j({ items: here ? [EVENT, NEXT, OTHER, ...created.filter(e => !e.gone)] : [] })
    }
    let body = {}; try { body = JSON.parse(q.postData() ?? '{}') } catch { /* ignore */ }
    if (q.method() === 'POST') {
      posts.push({ calId: decodeURIComponent(calId), body })
      if (/refuse/i.test(body.summary ?? '')) return j({ error: { code: 403, message: 'Forbidden' } }, 403)
      // Answered, but with no event in it: it must not reach the grid.
      if (/hollow/i.test(body.summary ?? '')) return j({})
      const ev = { ...body, id: `ev-new-${++seq}`, status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=new${seq}` }
      created.push(ev)
      return j(ev)
    }
    if (q.method() === 'PATCH') {
      patches.push({ id: evId, body })
      const all = [EVENT, NEXT, OTHER, ...created]
      const ev = all.find(e => e.id === evId)
      if (ev) Object.assign(ev, body)
      return j(ev ?? { id: evId, ...body })
    }
    if (q.method() === 'DELETE') {
      deletes.push({ calId: decodeURIComponent(calId), id: evId })
      const ev = created.find(e => e.id === evId); if (ev) ev.gone = true
      return r.fulfill({ status: 204, body: '' })
    }
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(([s, cos]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
} catch { /* quota */ } }, [session, COMPANIES])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const ls = k => p.evaluate(key => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } }, k)
const live = async kind => Object.values((await ls('cal-outcome-links')) ?? {}).filter(l => !l.gone && l.eventId === 'ev-sync-1' && l.kind === (kind ?? 'event'))

ok('the meeting is on the grid', /Weekly Sync/.test(await text()))
await p.locator('.event-card').filter({ hasText: 'Weekly Sync' }).first().hover()
await p.waitForTimeout(350)
const tick = await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /Mark done/i.test(e.getAttribute('aria-label') ?? e.title ?? ''))
  if (!x) return null
  const r = x.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
ok('the block carries a done tick', !!tick)
if (tick) { await p.mouse.move(tick.x, tick.y); await p.waitForTimeout(120); await p.mouse.down(); await p.mouse.up() }
await p.waitForTimeout(900)

const dialog = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
ok('the window opened', await dialog.count() === 1)
const box = dialog.locator('[data-outcome-box="events"]')
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }
const row = id => box.locator(`[data-outcome-event="${id}"]`)
ok('the Events box is a box, closed to begin with', await box.count() === 1 && await box.getAttribute('data-open') === '0')
await box.getByRole('button', { name: /^Events:/ }).click()
await p.waitForTimeout(400)
ok('the box opened, and Tasks stayed open beside it', await box.getAttribute('data-open') === '1' && await dialog.locator('[data-outcome-box="tasks"]').getAttribute('data-open') === '1')

const schedule = () => box.getByRole('button', { name: /^Schedule$/ })

if (MODE === 'readonly') {
  ok('with no calendar to write to, the form is not offered', await schedule().count() === 0)
  ok('and the box says why', /no calendar here that you can write to/.test(await box.innerText()))
  await done()
}

if (MODE === 'fallback') {
  const t = await box.innerText()
  ok('the meeting\'s own calendar is read-only, so the form names the main one instead', /On\s+a@x\.com/.test(t) && !/On\s+Teradix/.test(t), t.replace(/\n+/g, ' | ').slice(-150))
  await schedule().click()
  await p.waitForTimeout(700)
  ok('and the event goes to the main calendar, not the read-only one', posts.length === 1 && posts[0].calId === 'primary', JSON.stringify(posts.map(x => x.calId)))
  await done()
}

// ── What is offered ─────────────────────────────────────────────────────────
ok('the next in this series, already loaded, is offered', await row('ev-next').count() === 1)
ok('an unrelated event is not', await row('ev-other').count() === 0)
ok('nor is the meeting itself', await row('ev-sync-1').count() === 0)
ok('nothing is linked yet', (await live()).length === 0)

// ── The form is pre-answered ────────────────────────────────────────────────
ok('the title opens as a follow-up', await box.getByLabel('Title of the next meeting').inputValue() === 'Follow-up: Weekly Sync')
const when = () => box.locator('[data-outcome-when]').innerText()
// The day and month, not the whole formatted date: Node and Chromium disagree
// on whether en-GB puts a comma after the weekday.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const wk = fmt => `${Number(fmt.slice(8))} ${MONTHS[Number(fmt.slice(5, 7)) - 1]}`
ok('a week on, at the same hour, for the same length', (await when()).includes(wk(WEEK_ON)) && /10:00 – 11:00/.test(await when()), await when())
ok('nobody is invited to begin with', await box.getByRole('button', { name: /Invite Ali Hassan/ }).getAttribute('aria-pressed') === 'false' && /No one is invited/.test(await box.innerText()))

if (process.env.SHOT) { await box.getByRole('button', { name: /Invite Ali Hassan/ }).click(); await p.screenshot({ path: process.env.SHOT }); await box.getByRole('button', { name: /Invite Ali Hassan/ }).click() }
// ── Schedule ────────────────────────────────────────────────────────────────
await schedule().click()
await p.waitForTimeout(700)
const first = posts.at(-1)
ok('it is written to the meeting\'s own calendar', first?.calId === CAL, first?.calId)
ok('with the title, the day a week on and the same hours', first?.body?.summary === 'Follow-up: Weekly Sync'
  && first?.body?.start?.dateTime === `${WEEK_ON}T10:00:00` && first?.body?.end?.dateTime === `${WEEK_ON}T11:00:00`, JSON.stringify(first?.body?.start))
ok('with nobody on it', first?.body?.attendees === undefined, JSON.stringify(first?.body?.attendees))
ok('and the place the meeting had', first?.body?.location === 'Room 3')
ok('its row appears, marked as made here', await row('ev-new-1').count() === 1 && /scheduled here/.test(await row('ev-new-1').innerText()))
let l = (await live()).find(x => x.recordId === 'ev-new-1')
ok('the thread says made', l?.role === 'made' && l?.eventId === 'ev-sync-1', JSON.stringify(l))
ok('the count moved', /1 linked/.test(await text()))

// ── Invite, then schedule another ───────────────────────────────────────────
await box.getByRole('button', { name: 'Tomorrow 10:00' }).click()
await box.getByRole('button', { name: /Invite Ali Hassan/ }).click()
ok('inviting says Google will send the email', /Google will email 1 person/.test(await box.innerText()))
await box.getByLabel('Title of the next meeting').fill('Kickoff call')
await schedule().click()
await p.waitForTimeout(700)
const second = posts.at(-1)
ok('the second goes to tomorrow at ten', second?.body?.start?.dateTime === `${TOMORROW}T10:00:00`, JSON.stringify(second?.body?.start))
ok('with exactly the one person invited — never you', JSON.stringify(second?.body?.attendees) === JSON.stringify([{ email: 'ali@teradix.com' }]), JSON.stringify(second?.body?.attendees))
ok('and the invitations are reset for the next one', await box.getByRole('button', { name: /Invite Ali Hassan/ }).getAttribute('aria-pressed') === 'false')
ok('2 linked', /2 linked/.test(await text()))

// ── Edit in place ───────────────────────────────────────────────────────────
await row('ev-new-2').getByRole('button', { name: /^Edit /i }).click()
await p.waitForTimeout(250)
ok('the fields open inside the row', await row('ev-new-2').getAttribute('data-editing') === '1' && await dialog.count() === 1)
await row('ev-new-2').getByLabel('Starts').fill('14:00')
await p.waitForTimeout(700)
const moved = patches.filter(x => x.id === 'ev-new-2').at(-1)
ok('a new start is written', moved?.body?.start?.dateTime === `${TOMORROW}T14:00:00`, JSON.stringify(moved?.body?.start))
ok('and the length is kept: it now ends at 15:00', moved?.body?.end?.dateTime === `${TOMORROW}T15:00:00`, JSON.stringify(moved?.body?.end))

// ── Take it back: a real delete ─────────────────────────────────────────────
ok('Undo says what it does to a guest', /told it is cancelled/.test(await row('ev-new-2').getByRole('button', { name: 'Undo' }).getAttribute('title')))
await row('ev-new-2').getByRole('button', { name: 'Undo' }).click()
await p.waitForTimeout(800)
ok('Undo deletes it from Google', deletes.some(d => d.id === 'ev-new-2' && d.calId === CAL), JSON.stringify(deletes))
ok('its row goes', await row('ev-new-2').count() === 0)
ok('and its link, leaving the first', !(await live()).some(x => x.recordId === 'ev-new-2') && (await live()).some(x => x.recordId === 'ev-new-1'))

// ── Move the next one in the series, and move it back ───────────────────────
const moveTo = addDays(NOW, 3)
await row('ev-next').getByRole('button', { name: /^Move /i }).click()
await p.waitForTimeout(250)
await row('ev-next').getByLabel('Event date').fill(moveTo)
await p.waitForTimeout(700)
const mv = patches.filter(x => x.id === 'ev-next').at(-1)
ok('moving it writes the new day, same hours', mv?.body?.start?.dateTime === `${moveTo}T10:00:00` && mv?.body?.end?.dateTime === `${moveTo}T11:00:00`, JSON.stringify(mv?.body?.start))
ok('and it is linked, touched', (await live()).some(x => x.recordId === 'ev-next' && x.role === 'touched'))
await row('ev-next').getByRole('button', { name: 'Undo move' }).click()
await p.waitForTimeout(700)
const back = patches.filter(x => x.id === 'ev-next').at(-1)
ok('Undo move puts the old day back', back?.body?.start?.dateTime === `${TOMORROW}T10:00:00`, JSON.stringify(back?.body?.start))
ok('and takes the link', !(await live()).some(x => x.recordId === 'ev-next'))

// ── A refusal ───────────────────────────────────────────────────────────────
const nPosts = posts.length, nLinks = (await live()).length
await box.getByLabel('Title of the next meeting').fill('refuse this one')
await schedule().click()
await p.waitForTimeout(800)
ok('Google refusing is said, with its reason', /would not create it/.test(await box.innerText()) && /403/.test(await box.innerText()), (await box.innerText()).replace(/\n+/g, ' | ').slice(-150))
ok('the request was made', posts.length === nPosts + 1)
ok('and the reason is a sentence, not a response body', !/\{"error"/.test(await box.innerText()), (await box.innerText()).replace(/\n+/g, ' | ').slice(-150))
ok('but no row appears for it', await box.locator('[data-outcome-event]').filter({ hasText: 'refuse this one' }).count() === 0)
ok('and nothing is linked', (await live()).length === nLinks)

// ── An answer with no event in it ───────────────────────────────────────────
const nBefore = (await live()).length
await box.getByLabel('Title of the next meeting').fill('hollow answer')
await schedule().click()
await p.waitForTimeout(800)
ok('an empty answer is not believed, and says so', /not with an event/.test(await box.innerText()))
ok('the page is still standing', await dialog.count() === 1 && await box.count() === 1)
ok('and nothing was linked for it', (await live()).length === nBefore)

// ── The full form is still there ────────────────────────────────────────────
if (MODE === 'full') {
  await box.getByRole('button', { name: /Open the full form/ }).click()
  await p.waitForTimeout(1200)
  ok('the window gives way to the composer', await dialog.count() === 0)
  const values = await p.locator('input[type="text"], input:not([type])').evaluateAll(els => els.map(e => e.value).filter(Boolean))
  ok('opened on the next one', values.includes('Follow-up: Weekly Sync'), JSON.stringify(values.slice(0, 5)))
}
ok('there is a way to the full form', await box.getByRole('button', { name: /Open the full form/ }).count() === 1 || MODE === 'full')
await done()
