// Marking a meeting done opens one window, a box per kind of output. Measured
// against the real bundle, reading the store, the request trace and the
// link ledger — never the pixels alone:
//   tasks     the Tasks box opens on what is related, ticks, edits and adds in
//             place, each linked to the meeting, each taken back on its own row
//   dismiss   the tick stands whatever the window is told, and closing is quiet
//   links     pasted notes draw a card per link and never edit the notes
//   followup  Next meeting still opens the composer, seeded from this one
//   keys      Escape closes only the window, and Backspace deletes nothing
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'tasks'
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
// The server's own rows. One open task for this company, one for another, and
// one already finished for this company: the box must offer only the first.
const NOW = new Date().toISOString()
const SERVER_TASKS = [
  // `company_tag` holds a legacy tag ('teradix') or a dynamic company's id, so
  // for this company the app reads `company: 'teradix'` and **no** companyId —
  // which is the shape the first cut of the box could not match.
  { id: 't-open-tdx', user_id: user.id, title: 'Prepare the Q3 metrics deck', quadrant: 'important_not_urgent',
    company_tag: 'teradix', status: 'todo', completed: false, due_date: TOMORROW, created_at: NOW },
  { id: 't-other-co', user_id: user.id, title: 'Pay the electricity bill', quadrant: 'urgent_important',
    company_tag: 'personal', status: 'todo', completed: false, created_at: NOW },
  { id: 't-done-tdx', user_id: user.id, title: 'Sign the NDA', quadrant: 'urgent_important',
    company_tag: 'teradix', status: 'done', completed: true, completed_at: TODAY, created_at: NOW },
]

const posted = []      // every POST to Google, with its body
const deleted = []     // every DELETE

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/tasks') && q.method() === 'GET') return j(SERVER_TASKS)
  if (u.pathname.endsWith('/tasks')) return j([])
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
    return j({ items: u.pathname.includes(encodeURIComponent(CAL)) || u.pathname.includes(CAL) ? [EVENT] : [] })
  }
  return j({})
})
await ctx.route('**://i.ytimg.com/**', r => r.fulfill({ status: 200, contentType: 'image/png',
  body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxQxhAUAACZbgMVIsjK1QAAAABJRU5ErkJggg==', 'base64') }))
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
const statuses = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cal-event-statuses') ?? '{}') } catch { return {} } })
const tasks = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('professor-tasks') ?? '{}')?.state?.tasks ?? [] } catch { return [] } })
const ledger = () => p.evaluate(() => { try { return Object.values(JSON.parse(localStorage.getItem('cal-outcome-links') ?? '{}')) } catch { return [] } })
const live = async () => (await ledger()).filter(l => !l.gone)

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
  // gesture: hover the card, then press where the tick actually is.
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
}
await p.waitForTimeout(900)

const dialog = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
ok('the window opened', await dialog.count() === 1)
ok('and the event is already done', (await statuses())['ev-sync-1'] === 'done', JSON.stringify(await statuses()))
ok('it names the meeting and whose it was', /What came out of it\?/.test(await text()) && /Teradix/.test(await text()))
const box = dialog.locator('[data-outcome-box="tasks"]')
ok('the Tasks box is a box, and open', await box.count() === 1 && await box.getAttribute('data-open') === '1')

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }

// ── MODE === 'tasks' ────────────────────────────────────────────────────────
if (MODE === 'tasks') {
  // What is offered: this company's open work, and nothing else. Both absences
  // sit beside the positive claim, or an empty box would pass them.
  const row = id => box.locator(`[data-outcome-task="${id}"]`)
  ok('the company\'s open task is offered', await row('t-open-tdx').count() === 1)
  if (process.env.DEBUG) { console.log(JSON.stringify((await tasks()).map(t => ({ id: t.id, co: t.companyId, c: t.company, s: t.status, d: t.completed })))); console.log((await box.innerText()).slice(0, 400)) }
  ok('another company\'s task is not', await row('t-other-co').count() === 0)
  ok('a finished task is not', await row('t-done-tdx').count() === 0)
  ok('nothing is linked yet', (await live()).length === 0 && /0 linked/.test(await text()))

  // Tick it, in place.
  await row('t-open-tdx').getByRole('checkbox').click()
  await p.waitForTimeout(500)
  const after = (await tasks()).find(t => t.id === 't-open-tdx')
  ok('ticking completes the task in the store', after?.completed === true && after?.status === 'done', JSON.stringify(after && { c: after.completed, s: after.status }))
  ok('the row reads done and linked', await row('t-open-tdx').getAttribute('data-done') === '1' && /Done · linked/.test(await text()))
  let l = await live()
  ok('and the thread to this meeting was written', l.length === 1 && l[0].kind === 'task' && l[0].recordId === 't-open-tdx'
     && l[0].eventId === 'ev-sync-1' && l[0].role === 'touched', JSON.stringify(l))
  ok('the count says so', /1 linked/.test(await text()))

  // Take it back, on its own row.
  await row('t-open-tdx').getByRole('button', { name: /^Undo$/ }).click()
  await p.waitForTimeout(400)
  const back = (await tasks()).find(t => t.id === 't-open-tdx')
  ok('Undo reopens it', back?.completed === false && back?.status === 'open')
  ok('and takes the link it made with it', (await live()).length === 0 && (await ledger()).some(x => x.gone))
  ok('the count returns to zero', /0 linked/.test(await text()))

  // Edit in place: a priority and an owner on the same open task.
  await row('t-open-tdx').getByRole('button', { name: /^Edit /i }).click()
  await p.waitForTimeout(250)
  ok('the edit fields opened inside the row, not in another panel',
     await row('t-open-tdx').getAttribute('data-editing') === '1' && await dialog.count() === 1)
  await row('t-open-tdx').getByRole('button', { name: 'P0', exact: true }).click()
  await row('t-open-tdx').getByRole('button', { name: 'Ali Hassan', exact: true }).click()
  await p.waitForTimeout(500)
  const edited = (await tasks()).find(t => t.id === 't-open-tdx')
  ok('priority and owner reached the store', edited?.priority === 'P0' && edited?.owner === 'u-ali', JSON.stringify({ p: edited?.priority, o: edited?.owner }))
  ok('an edit makes it part of the meeting', (await live()).some(x => x.recordId === 't-open-tdx' && x.role === 'touched'))

  // Add a new one.
  await box.getByRole('textbox', { name: 'Add a task from this meeting' }).fill('Send Ali the API proposal')
  await box.locator('input[type="date"][aria-label="Due date for the new task"]').fill(TOMORROW)
  await box.getByRole('button', { name: 'Add', exact: true }).click()
  await p.waitForTimeout(500)
  const made = (await tasks()).find(t => t.title === 'Send Ali the API proposal')
  ok('the new task is in the store', !!made)
  ok('it belongs to the meeting\'s company', made?.companyId === 'teradix', JSON.stringify({ c: made?.companyId }))
  ok('it carries the date and says where it came from', made?.dueDate === TOMORROW && /From "Weekly Sync"/.test(made?.description ?? ''))
  // A dated task earns a calendar block of its own from App's auto-push, and
  // `gcalEventId` is *that* block. What must never happen is the meeting's id
  // landing there, which would hand the task the meeting's hour: ticking one
  // would then finish the other.
  ok('it links back to the meeting by URL', (made?.links ?? []).includes(EVENT.htmlLink), JSON.stringify(made?.links))
  ok('and is never given the meeting\'s own hour', made?.gcalEventId !== EVENT.id, JSON.stringify({ g: made?.gcalEventId }))
  ok('the only event it has is the one its own date made', !made?.gcalEventId || posted.some(x => x.body?.summary === 'Send Ali the API proposal' || /Send Ali/.test(x.body?.summary ?? '')), JSON.stringify(posted.map(x => x.body?.summary)))
  l = (await live()).find(x => x.recordId === made?.id)
  ok('and the thread says made, not touched', l?.role === 'made', JSON.stringify(l))

  // And it can be taken away again from its own row.
  await row(made.id).getByRole('button', { name: /^Undo$/ }).click()
  await p.waitForTimeout(500)
  ok('Undo on a task made here deletes it', !(await tasks()).some(t => t.id === made.id))
  ok('and its link', !(await live()).some(x => x.recordId === made.id))
  ok('while the old task it edited is untouched by that', (await live()).some(x => x.recordId === 't-open-tdx'))
  await done()
}

// ── MODE === 'links' ────────────────────────────────────────────────────────
// A conclusion is often a link — a recording, a doc, a notebook — and a row of
// characters is something you have to read to recognise.
if (MODE === 'links') {
  const YT = 'https://www.youtube.com/watch?v=ZvDkJsKE80k'
  const NB = 'https://notebook.google.com/notebook/c26de4d8-340b-42c4-9247-9c82c0fddbdf'
  await dialog.getByRole('button', { name: /Read my notes/i }).first().click()
  const notes = dialog.getByRole('textbox', { name: /notes to read/i })
  await notes.waitFor({ timeout: 3000 })
  ok('with no notes on the event, Read my notes offers a place to paste them', await notes.count() === 1)
  await notes.fill(`${YT}\n${NB}`)
  await p.waitForTimeout(2400)
  const cards = await p.evaluate(() => [...document.querySelectorAll('[data-link-card]')].map(a => ({
    href: a.getAttribute('href'), img: a.querySelector('img')?.getAttribute('src') ?? null })))
  ok('both links drew a card', cards.length === 2, JSON.stringify(cards))
  ok('the video card carries the thumbnail its own id names',
    cards.find(c => c.href === YT)?.img === 'https://i.ytimg.com/vi/ZvDkJsKE80k/hqdefault.jpg')
  ok('the notes are untouched', await notes.inputValue() === `${YT}\n${NB}`)
  ok('and no task was made by looking', !(await tasks()).some(t => /youtube|notebook/i.test(t.title)))
  await done()
}

// ── MODE === 'dismiss' ──────────────────────────────────────────────────────
if (MODE === 'dismiss') {
  await dialog.getByRole('button', { name: 'Close' }).click()
  await p.waitForTimeout(600)
  ok('the window closed', await dialog.count() === 0)
  ok('nothing was written', (await live()).length === 0 && !(await tasks()).some(t => t.title === 'Send Ali the API proposal'))
  ok('and the meeting is still done', (await statuses())['ev-sync-1'] === 'done')
  await done()
}

// ── MODE === 'followup' ─────────────────────────────────────────────────────
if (MODE === 'followup') {
  // The next meeting is scheduled in the Events box now; the composer is its
  // "full form" escape hatch, for what the quick form does not do.
  await dialog.locator('[data-outcome-box="events"]').getByRole('button', { name: /^Events:/ }).click()
  await dialog.getByRole('button', { name: /Open the full form/ }).click()
  await p.waitForTimeout(1200)
  const t = await text()
  const values = await p.locator('input[type="text"], input:not([type])').evaluateAll(els => els.map(e => e.value).filter(Boolean))
  ok('the composer opened on the next one', values.includes('Follow-up: Weekly Sync'), JSON.stringify(values.slice(0, 6)))
  const dates = await p.evaluate(() => [...document.querySelectorAll('input[type="date"]')].map(i => i.value).join(','))
  ok('a week on', new RegExp(WEEK_ON).test(dates), dates)
  const times = await p.evaluate(() => [...document.querySelectorAll('input[type="time"]')].map(i => i.value))
  ok('at the same hour, for the same hour', times[0] === '10:00' && times[1] === '11:00', JSON.stringify(times))
  ok('its guests came with it', /ali@teradix\.com/.test(t) && /guest@elsewhere\.com/.test(t))
  ok('the window itself is gone', await dialog.count() === 0)
  await done()
}

// ── MODE === 'keys' ─────────────────────────────────────────────────────────
if (MODE === 'keys') {
  const panelUp = async () => await p.getByRole('button', { name: /Gather prep/i }).count() === 1
  // A tick is not a text field, which is exactly why Backspace was dangerous.
  await box.locator('[data-outcome-task="t-open-tdx"]').getByRole('checkbox').click()
  await p.waitForTimeout(400)
  ok('focus is on a control that is not a text field', await p.evaluate(() => document.activeElement?.tagName) === 'BUTTON')
  ok('the event panel survived being worked over', await panelUp())
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(1500)
  ok('Backspace did not delete the meeting', deleted.length === 0, JSON.stringify(deleted))
  ok('and the window is still open', await dialog.count() === 1)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(700)
  ok('Escape closes the window', await dialog.count() === 0)
  ok('and only the window — the panel under it stays', await panelUp())
  ok('what was ticked stays ticked', (await tasks()).find(t => t.id === 't-open-tdx')?.completed === true)
  await done()
}
await done()
