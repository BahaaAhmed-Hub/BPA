// Marking a meeting done asks what came out of it — and the answer becomes
// tasks, or the next meeting, or nothing. Measured against the real bundle:
//   tasks     typed lines become tasks, with the settings each row was given
//   dismiss   the tick stands whatever the prompt is told, and loss is named
//   followup  the composer opens on the next one, seeded from this meeting
//   keys      Escape closes it, and Backspace does not delete the meeting
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const MODE = process.argv[2] ?? 'tasks'
const U = user.id
const TODAY = new Date().toISOString().slice(0, 10)
const TOMORROW = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
const WEEK_ON = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}` })()

const CAL = 'cal-teradix'
const EVENT = {
  id: 'ev-sync-1', status: 'confirmed', summary: 'Weekly Sync',
  location: 'Room 3', htmlLink: 'https://calendar.google.com/event?eid=weekly-sync',
  start: { dateTime: `${TODAY}T10:00:00${TZ}` },
  end:   { dateTime: `${TODAY}T11:00:00${TZ}` },
  attendees: [
    { email: user.email, self: true, responseStatus: 'accepted' },
    { email: 'ali@teradix.com', responseStatus: 'accepted' },
    { email: 'guest@elsewhere.com', responseStatus: 'declined' },
  ],
}
const COMPANIES = [{
  id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: CAL,
  users: [{ id: 'u-ali', name: 'Ali Hassan', email: 'ali@teradix.com' }],
}]

const posted = []      // every POST to Google, with its body
const deleted = []     // every DELETE
const taskPushes = []  // every task upsert that reached the server

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/tasks') && q.method() === 'GET') return j([])
  if (u.pathname.endsWith('/tasks')) { try { taskPushes.push(JSON.parse(q.postData() ?? '[]')) } catch { /* not json */ } return j([]) }
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
    if (q.method() === 'DELETE') { deleted.push(u.pathname); return r.fulfill({ status: 204, body: '' }) }
    if (q.method() === 'POST') {
      let body = {}; try { body = JSON.parse(q.postData() ?? '{}') } catch { /* ignore */ }
      posted.push({ path: u.pathname, body })
      return j({ ...body, id: 'ev-followup-1', htmlLink: 'https://calendar.google.com/event?eid=followup' })
    }
    // Only the Teradix calendar carries the meeting.
    return j({ items: u.pathname.includes(encodeURIComponent(CAL)) || u.pathname.includes(CAL) ? [EVENT] : [] })
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
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6000)

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const text = () => p.evaluate(() => document.body.innerText)
const statuses = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cal-event-statuses') ?? '{}') } catch { return {} } })
const tasks = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('professor-tasks') ?? '{}')?.state?.tasks ?? [] } catch { return [] } })

ok('the meeting is on the grid', /Weekly Sync/.test(await text()))


// ── Mark it done, by whichever door this mode is about ──────────────────────
if (MODE === 'keys') {
  // Through the panel, so the event is *selected* — which is what arms the
  // calendar's own Delete/Backspace shortcut.
  await p.locator('[data-event-card], .event-card').filter({ hasText: 'Weekly Sync' }).first().click()
  await p.waitForTimeout(1200)
  ok('the event panel opened', await p.getByRole('button', { name: /Gather prep/i }).count() === 1)
  await p.getByRole('button', { name: /Mark it done/i }).first().click()
} else {
  // The tick is revealed by hovering the block, so the gesture is the whole
  // gesture: hover the card, then press where the tick actually is. A bare
  // `.click()` on a control at `opacity: 0` lands nowhere and reports nothing,
  // which is its own small lesson about asserting on a click that "worked".
  await p.locator('.event-card').filter({ hasText: 'Weekly Sync' }).first().hover()
  await p.waitForTimeout(350)
  const at = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Mark done/i.test(x.getAttribute('aria-label') ?? x.title ?? ''))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  ok('the block carries a done tick', !!at)
  if (at) { await p.mouse.move(at.x, at.y); await p.waitForTimeout(120); await p.mouse.down(); await p.mouse.up() }
}
await p.waitForTimeout(900)

const dialog = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
ok('the prompt opened', await dialog.count() === 1)
ok('and the event is already done', (await statuses())['ev-sync-1'] === 'done', JSON.stringify(await statuses()))
ok('it names the meeting and whose it was', /What came out of it\?/.test(await text()) && /Teradix/.test(await text()))

// The Budget drill-down lesson: a panel can be present in the DOM and not be
// the thing a finger would hit. Measure the primary action, not the text.
const hit = async name => {
  const el = p.getByRole('button', { name }).first()
  const box = await el.boundingBox()
  if (!box) return 'no box'
  return p.evaluate(({ x, y }) => {
    const at = document.elementFromPoint(x, y)
    return at?.closest('[role="dialog"]') ? 'in the dialog' : (at?.tagName ?? 'nothing') + ' outside it'
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
}

if (MODE === 'dismiss') {
  const area = dialog.getByRole('textbox')
  await area.fill('Send Ali the proposal\nBook the metrics deep dive')
  await p.waitForTimeout(400)
  ok('two lines are counted', /2 lines/.test(await text()), (await text()).match(/\d+ lines[^\n]*/)?.[0] ?? '')
  await dialog.getByRole('button', { name: /Discard them/i }).click()
  await p.waitForTimeout(700)
  ok('the prompt closed', await dialog.count() === 0)
  ok('nothing was written', (await tasks()).length === 0, JSON.stringify((await tasks()).map(t => t.title)))
  ok('the loss is named out loud', /Left 2 lines unsaved/i.test(await text()), (await text()).slice(-160).replace(/\n+/g, ' | '))
  ok('and the meeting is still done', (await statuses())['ev-sync-1'] === 'done')
  await b.close(); process.exit(process.exitCode ?? 0)
}

if (MODE === 'keys') {
  const panelUp = async () => await p.getByRole('button', { name: /Gather prep/i }).count() === 1
  ok('the primary action is hit-testable', await hit(/Review/i) === 'in the dialog', await hit(/Review/i))
  // A pill is not a text field, which is exactly why Backspace was dangerous.
  await dialog.getByRole('textbox').fill('Send Ali the proposal')
  await dialog.getByRole('button', { name: /Review/i }).click()
  await p.waitForTimeout(500)
  await dialog.getByRole('button', { name: /Settings for line 1/i }).click()
  await p.waitForTimeout(300)
  await dialog.getByRole('button', { name: /^Do$/ }).click()
  await p.waitForTimeout(300)
  // Working in the prompt must not dismiss the panel it opened over: a sibling
  // in a portal is not "outside" the panel, and the panel leaving takes the
  // selected event — and every shortcut that hangs off one — with it.
  ok('the event panel survived being worked over', await panelUp())
  ok('focus is on a control that is not a text field',
     await p.evaluate(() => document.activeElement?.tagName) === 'BUTTON')
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(1500)
  ok('Backspace did not delete the meeting', deleted.length === 0, JSON.stringify(deleted))
  ok('and the prompt is still open', await dialog.count() === 1)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(700)
  ok('Escape closes the prompt', await dialog.count() === 0)
  ok('and only the prompt — the panel under it stays', await panelUp())
  ok('nothing was deleted by any of it', deleted.length === 0, JSON.stringify(deleted))
  await b.close(); process.exit(process.exitCode ?? 0)
}

// ── The lines ───────────────────────────────────────────────────────────────
const area = dialog.getByRole('textbox')
await area.fill('- Send Ali the API proposal\n2. Book the Q3 metrics deep dive\n\n  [ ] Update the deck\n')
await p.waitForTimeout(400)
ok('three lines, bullets and numbers stripped', /3 lines/.test(await text()), (await text()).match(/\d+ lines[^\n]*/)?.[0] ?? '')
await dialog.getByRole('button', { name: /Review 3 tasks/i }).click()
await p.waitForTimeout(600)
const rows = await dialog.getByRole('textbox').count()
ok('one editable row per line', rows === 3, `${rows} rows`)
// Each row's title is an input, so it is read off the value and not the page's
// own text — which is how a row that lost its words would still "read" right.
const titles = await dialog.getByRole('textbox').evaluateAll(els => els.map(e => e.value))
ok('the titles came through clean, bullets and all stripped',
   JSON.stringify(titles) === JSON.stringify(['Send Ali the API proposal', 'Book the Q3 metrics deep dive', 'Update the deck']),
   JSON.stringify(titles))

// Row 1 gets the settings: tomorrow, P0, Ali. Nobody has touched its box, so
// the app's own answer for a P0 due tomorrow has to be Do. Only in `tasks`
// mode: a dated task earns a calendar block of its own from App's auto-push,
// and the follow-up run counts what was POSTed to Google.
if (MODE === 'tasks') {
  await dialog.getByRole('button', { name: /Settings for line 1/i }).click()
  await p.waitForTimeout(300)
  await dialog.locator('input[type="date"]').first().fill(TOMORROW)
  await dialog.locator('select').nth(0).selectOption('P0')
  await dialog.locator('select').nth(1).selectOption('u-ali')
  await p.waitForTimeout(400)
  ok('an unanswered box follows the date and priority', /\bDo\b/.test(await text()))
}

if (MODE === 'followup') {
  await dialog.getByRole('button', { name: /Next meeting/i }).click()
  await p.waitForTimeout(1200)
  const t = await text()
  // The title is an input's value, not page text — reading `innerText` here
  // reports an empty composer as a perfectly good one.
  const values = await p.locator('input[type="text"], input:not([type])').evaluateAll(els => els.map(e => e.value).filter(Boolean))
  ok('the composer opened on the next one', values.includes('Follow-up: Weekly Sync'), JSON.stringify(values.slice(0, 6)))
  ok('a week on', new RegExp(WEEK_ON).test(await p.evaluate(() =>
    [...document.querySelectorAll('input[type="date"]')].map(i => i.value).join(','))),
    await p.evaluate(() => [...document.querySelectorAll('input[type="date"]')].map(i => i.value).join(',')))
  const times = await p.evaluate(() => [...document.querySelectorAll('input[type="time"]')].map(i => i.value))
  ok('at the same hour, for the same hour', times[0] === '10:00' && times[1] === '11:00', JSON.stringify(times))
  ok('its guests came with it', /ali@teradix\.com/.test(t) && /guest@elsewhere\.com/.test(t),
     JSON.stringify([...new Set(t.match(/[\w.@-]+@[\w.-]+/g) ?? [])].slice(0, 6)))
  ok('and nobody has replied to a meeting that does not exist', !/\bYes\b.*\bNo\b/s.test((t.split('Attendees')[1] ?? '').slice(0, 200)))
  ok('the lines were saved on the way out', (await tasks()).length === 3, JSON.stringify((await tasks()).map(t2 => t2.title)))
  // Create it, and assert it lands on the meeting's own calendar.
  await p.getByRole('button', { name: /^Create/i }).first().click()
  await p.waitForTimeout(1500)
  const sent = posted.find(x => /Follow-up/.test(x.body?.summary ?? ''))
  ok('one follow-up event was created', !!sent && posted.length === 1, JSON.stringify(posted.map(x => x.body?.summary)))
  ok('on the Teradix calendar', (sent?.path ?? '').includes(CAL), sent?.path ?? '')
  ok('titled for the meeting it follows', sent?.body?.summary === 'Follow-up: Weekly Sync', JSON.stringify(sent?.body?.summary))
  ok('carrying its guests, without you', JSON.stringify((sent?.body?.attendees ?? []).map(a => a.email)) === JSON.stringify(['ali@teradix.com', 'guest@elsewhere.com']),
     JSON.stringify(sent?.body?.attendees))
  ok('and its place', sent?.body?.location === 'Room 3', String(sent?.body?.location))
  ok('a week on at the same hour', (sent?.body?.start?.dateTime ?? '').startsWith(`${WEEK_ON}T10:00`), String(sent?.body?.start?.dateTime))
  ok('no Meet room borrowed from the old one', !sent?.body?.conferenceData)
  await b.close(); process.exit(process.exitCode ?? 0)
}

// ── MODE === 'tasks' ────────────────────────────────────────────────────────
ok('the save button counts them', await dialog.getByRole('button', { name: /Save 3 tasks/i }).count() === 1)
await dialog.getByRole('button', { name: /Save 3 tasks/i }).click()
await p.waitForTimeout(1500)
ok('the prompt closed', await dialog.count() === 0)

const made = await tasks()
ok('three tasks exist', made.length === 3, JSON.stringify(made.map(t => t.title)))
const one = made.find(t => /API proposal/.test(t.title))
const two = made.find(t => /metrics deep dive/.test(t.title))
ok('the row that was given settings kept every one of them',
   one?.dueDate === TOMORROW && one?.priority === 'P0' && one?.owner === 'u-ali' && one?.quadrant === 'do',
   JSON.stringify({ due: one?.dueDate, pri: one?.priority, owner: one?.owner, q: one?.quadrant }))
ok('a line nobody settled is still placed, never in the dump', two?.quadrant === 'schedule' && two?.quadrant !== null, String(two?.quadrant))
ok('both are filed to the meeting\'s company', one?.companyId === 'teradix' && two?.companyId === 'teradix', `${one?.companyId}/${two?.companyId}`)
ok('each links back to the meeting', (one?.links ?? []).includes(EVENT.htmlLink), JSON.stringify(one?.links))
// A task may well earn a block of its own — the dated one just did, through
// App's auto-push. What must never happen is a task claiming the *meeting's*
// event, which is what writing `gcalEventId` here would have done: ticking
// either would then finish the other.
ok('none of them claims the meeting\'s own event', made.every(t => t.gcalEventId !== 'ev-sync-1'), JSON.stringify(made.map(t => t.gcalEventId)))
ok('the meeting is named on the task', /Weekly Sync/.test(one?.description ?? ''), String(one?.description))
ok('it is said out loud', /3 tasks from "Weekly Sync"/.test(await text()), (await text()).slice(-200).replace(/\n+/g, ' | '))
await p.waitForTimeout(2500)
ok('they reached the server', taskPushes.flat().filter(r => /API proposal|metrics deep dive|Update the deck/.test(r?.title ?? '')).length === 3,
   JSON.stringify(taskPushes.flat().map(r => r?.title)))
ok('the meeting is still done', (await statuses())['ev-sync-1'] === 'done')
await b.close()
