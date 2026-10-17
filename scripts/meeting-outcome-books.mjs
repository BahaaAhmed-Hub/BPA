// The Books box in the outcome window. Measured against the real bundle, with
// the library tables served in the shape the project really sends and both
// catalogues faked (and switchable off), read off the request trace and the
// link ledger:
//   books    pages are logged as a reading session and Undo deletes it, a quote
//            is filed with its page, finishing dates itself and takes itself
//            back, a book found online goes on the shelf and comes off again,
//            one already on the shelf is started rather than added twice, and
//            a catalogue down is said and never "not found"
//   missing  without the sessions table the pages form says so and quotes work
//   off      a Library that is off is never drawn
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'books'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = ymd(new Date())
const TZ = (() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'
  const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()

const CAL = 'cal-teradix'
const EVENT = {
  id: 'ev-sync-1', status: 'confirmed', summary: 'Weekly Sync',
  htmlLink: 'https://calendar.google.com/event?eid=weekly-sync',
  start: { dateTime: `${TODAY}T10:00:00${TZ}` },
  end:   { dateTime: `${TODAY}T11:00:00${TZ}` },
  attendees: [{ email: user.email, self: true, responseStatus: 'accepted' }],
}
const COMPANIES = [{ id: 'teradix', name: 'Teradix', color: '#F5D14E', calendarId: CAL, users: [] }]

const U = user.id
const T0 = '2026-01-01T00:00:00.000Z'
const book = (id, over) => ({ id, user_id: U, title: id, subtitle: null, authors: [], isbn: null, publisher: null, published_year: null,
  pages: null, language: null, description: null, cover_url: null, source: 'manual', source_key: null, status: 'want', format: 'print',
  rating: 0, review: null, spine_color: null, file_path: null, shelf_order: 0, started_on: null, finished_on: null,
  added_at: T0, updated_at: T0, ...over })
const BOOKS = [
  book('b-deep', { title: 'Deep Work', authors: ['Cal Newport'], pages: 304, status: 'reading', started_on: '2026-09-20', shelf_order: 0, added_at: '2026-01-01T00:00:00.000Z' }),
  book('b-atomic', { title: 'Atomic Habits', authors: ['James Clear'], pages: 320, status: 'want', shelf_order: 1, added_at: '2026-01-02T00:00:00.000Z' }),
  book('b-done', { title: 'Finished earlier', authors: ['Someone'], pages: 200, status: 'finished', finished_on: '2026-03-01', shelf_order: 2, added_at: '2026-01-03T00:00:00.000Z' }),
]
const SESSIONS = [{ id: 's-1', user_id: U, book_id: 'b-deep', kind: 'read', on_date: '2026-10-10', minutes: 30, pages: 214, to_page: 214, created_at: '2026-10-10T10:00:00.000Z' }]

const writes = { library_books: [], library_sessions: [], library_quotes: [] }
const deletes = { library_books: [], library_sessions: [], library_quotes: [] }
const libraryReads = []
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
let catalogueDown = false

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/rpc/my_modules')) {
    return j([{ module_id: 'calendar', label: 'Calendar', enabled: true }, { module_id: 'tasks', label: 'Tasks', enabled: true },
      { module_id: 'library', label: 'Library', enabled: MODE !== 'off' }])
  }
  const table = u.pathname.split('/').pop() ?? ''
  if (table.startsWith('library_')) {
    if (q.method() === 'GET') {
      libraryReads.push(table)
      if (table === 'library_books') return j(BOOKS)
      if (table === 'library_sessions') {
        if (MODE === 'missing') return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: '42P01', message: 'relation does not exist' }) })
        return j(SESSIONS)
      }
      return j([])
    }
    if (q.method() === 'DELETE') { (deletes[table] ??= []).push(u.search); return j([]) }
    try { const body = JSON.parse(q.postData() ?? '[]'); (writes[table] ??= []).push(...(Array.isArray(body) ? body : [body])) } catch { /* not json */ }
    return j([])
  }
  if (u.pathname.endsWith('/tasks') && q.method() === 'GET') return j([])
  return j([])
})
await ctx.route('**://openlibrary.org/**', r => {
  const u = new URL(r.request().url())
  if (catalogueDown || /fail/i.test(u.searchParams.get('q') ?? '')) return r.fulfill({ status: 503, headers: CORS, body: '' })
  const q = (u.searchParams.get('q') ?? '').toLowerCase()
  const docs = q.includes('mom')
    ? [{ key: '/works/OL1W', title: 'The Mom Test', author_name: ['Rob Fitzpatrick'], first_publish_year: 2013, isbn: ['9781492180746'], number_of_pages_median: 138 }]
    : q.includes('atomic')
      ? [{ key: '/works/OL2W', title: 'Atomic Habits', author_name: ['James Clear'], first_publish_year: 2018, isbn: ['9780735211292'], number_of_pages_median: 320 }]
      : []
  return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ docs }) })
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = x => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.startsWith('/books/v1')) {
    if (catalogueDown || /fail/i.test(u.searchParams.get('q') ?? '')) return r.fulfill({ status: 503, headers: CORS, body: '' })
    return j({ items: [] })
  }
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
const links = async kind => Object.values((await ls('cal-outcome-links')) ?? {}).filter(l => l.eventId === 'ev-sync-1' && (!kind || l.kind === kind))
const live = async kind => (await links(kind)).filter(l => !l.gone)

ok('the meeting is on the grid', /Weekly Sync/.test(await text()))
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
await p.waitForTimeout(900)

const dialog = p.locator('[role="dialog"][aria-label*="Weekly Sync"]')
ok('the window opened', await dialog.count() === 1)
const box = dialog.locator('[data-outcome-box="books"]')
const done = async () => { await b.close(); process.exit(process.exitCode ?? 0) }
const row = id => box.locator(`[data-outcome-book="${id}"]`)

if (MODE === 'off') {
  ok('the Tasks box is still there — the window itself is not broken', await dialog.locator('[data-outcome-box="tasks"]').count() === 1)
  ok('a Library that is off does not draw the Books box', await box.count() === 0)
  ok('and nothing of it was read', libraryReads.length === 0, JSON.stringify(libraryReads))
  await done()
}

ok('the Books box is a box, closed to begin with', await box.count() === 1 && await box.getAttribute('data-open') === '0')
await box.getByRole('button', { name: /^Books:/ }).click()
await p.waitForTimeout(400)
ok('the box opened', await box.getAttribute('data-open') === '1')
// An accordion would have closed Tasks to show this one — and the design draws
// two boxes open side by side. Tasks is open by default, so it is the witness.
ok('opening a box does not close another', await dialog.locator('[data-outcome-box="tasks"]').getAttribute('data-open') === '1')

ok('the book being read is offered', await row('b-deep').count() === 1)
ok('one only wanted is not', await row('b-atomic').count() === 0)
ok('a finished one is not', await row('b-done').count() === 0)
if (MODE === 'books') ok('it says where you are', /page 214 of 304/.test(await row('b-deep').innerText()), (await row('b-deep').innerText()).replace(/\n+/g, ' | ').slice(0, 120))
// With no sessions table the page is not known, and a page nobody can read off
// the log is not claimed.
else ok('it claims no page it cannot know', !/page \d+/.test(await row('b-deep').innerText()))
ok('nothing is linked yet', (await live()).length === 0)

if (MODE === 'missing') {
  ok('without the sessions table the pages form says so', /not set up on this account yet \(migration 20260030\)/.test(await row('b-deep').innerText()))
  ok('and offers no way to log pages that would be refused', await row('b-deep').getByRole('button', { name: 'Log sitting' }).count() === 0)
  await row('b-deep').getByLabel(/Save a quote from/).fill('Clarity about what matters')
  await row('b-deep').getByRole('button', { name: 'Add quote' }).click()
  await p.waitForTimeout(500)
  ok('but a quote still saves', writes.library_quotes.some(q => q.body === 'Clarity about what matters'))
  await done()
}

const bar = async () => Number((await row('b-deep').locator('[data-outcome-progress]').evaluate(e => e.style.width)).replace('%', ''))
ok('the bar is where the log says: 70%', await bar() === 70, String(await bar()))

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
// ── Log pages ───────────────────────────────────────────────────────────────
ok('the minutes open on the length of the last sitting', await row('b-deep').getByLabel('Minutes').inputValue() === '30')
await row('b-deep').getByLabel('Add 20 pages').click()
ok('a quick add moves the page from where you are: 234', await row('b-deep').getByLabel('Page reached').inputValue() === '234')
await row('b-deep').getByRole('button', { name: 'Log sitting' }).click()
await p.waitForTimeout(500)
const sit = writes.library_sessions.find(s => s.to_page === 234)
ok('it is a reading session on the meeting\'s day', sit?.book_id === 'b-deep' && sit?.kind === 'read' && sit?.on_date === TODAY, JSON.stringify(sit))
ok('with its minutes and only the new pages', sit?.minutes === 30 && sit?.pages === 20, JSON.stringify({ m: sit?.minutes, p: sit?.pages }))
ok('the bar moved: 77%', await bar() === 77, String(await bar()))
ok('and says what was logged', /Logged 30 min to page 234/.test(await row('b-deep').innerText()))
let l = (await live('book')).find(x => x.recordId === 'b-deep')
ok('the book is linked, touched', l?.role === 'touched', JSON.stringify(l))
ok('the count moved', /1 linked/.test(await text()))

// A page past the end is refused, and sends nothing.
const before = writes.library_sessions.length
await row('b-deep').getByLabel('Page reached').fill('999')
await row('b-deep').getByRole('button', { name: 'Log sitting' }).click()
await p.waitForTimeout(300)
ok('past the last page is refused out loud', /past the end/.test(await row('b-deep').innerText()))
ok('and nothing was sent', writes.library_sessions.length === before)

await row('b-deep').locator('[data-outcome-session]').getByRole('button', { name: 'Undo' }).click()
await p.waitForTimeout(500)
ok('Undo deletes that session', deletes.library_sessions.some(s => s.includes(sit.id)), JSON.stringify(deletes.library_sessions))
ok('the bar is back to 70%', await bar() === 70, String(await bar()))
ok('and the link goes with the last thing it did', (await live('book')).length === 0)

// ── A quote ─────────────────────────────────────────────────────────────────
await row('b-deep').getByLabel(/Save a quote from/).fill('Clarity about what matters')
await row('b-deep').getByLabel('Quote page').fill('27')
await row('b-deep').getByRole('button', { name: 'Add quote' }).click()
await p.waitForTimeout(500)
const qt = writes.library_quotes.find(q => q.body === 'Clarity about what matters')
ok('a quote is filed against the book with its page', qt?.book_id === 'b-deep' && qt?.kind === 'text' && qt?.page === 27, JSON.stringify(qt))
ok('the quote is linked as made, and the book as touched', (await live('quote')).some(x => x.recordId === qt?.id && x.role === 'made') && (await live('book')).some(x => x.recordId === 'b-deep' && x.role === 'touched'))
await row('b-deep').locator('[data-outcome-quote]').getByRole('button', { name: 'Undo' }).click()
await p.waitForTimeout(500)
ok('Undo deletes the quote', deletes.library_quotes.some(s => s.includes(qt.id)))
ok('and both links', (await live()).length === 0)

// ── Finish ──────────────────────────────────────────────────────────────────
await row('b-deep').getByRole('button', { name: 'Mark finished' }).click()
await p.waitForTimeout(500)
const fin = writes.library_books.filter(x => x.id === 'b-deep').at(-1)
ok('finishing dates itself and keeps when it was started', fin?.status === 'finished' && fin?.finished_on === TODAY && fin?.started_on === '2026-09-20', JSON.stringify({ s: fin?.status, f: fin?.finished_on, st: fin?.started_on }))
ok('the row stays where it was, now finished', await row('b-deep').getAttribute('data-status') === 'finished')
ok('and is linked', (await live('book')).some(x => x.recordId === 'b-deep'))
await row('b-deep').getByRole('button', { name: /^Undo finish/ }).click()
await p.waitForTimeout(500)
const unfin = writes.library_books.filter(x => x.id === 'b-deep').at(-1)
ok('Undo puts back reading and clears the date', unfin?.status === 'reading' && unfin?.finished_on === null && unfin?.started_on === '2026-09-20', JSON.stringify({ s: unfin?.status, f: unfin?.finished_on }))
ok('and the link', (await live()).length === 0)

// ── Find a book ─────────────────────────────────────────────────────────────
const find = box.getByLabel('Find or add a book')
await find.fill('The Mom Test')
await box.locator('[data-outcome-result]').first().waitFor({ timeout: 4000 })
ok('a book found online is offered', /The Mom Test/.test(await box.locator('[data-outcome-result]').first().innerText()))
await box.locator('[data-outcome-result]').first().getByRole('button', { name: 'Want to read' }).click()
await p.waitForTimeout(500)
const mom = writes.library_books.find(x => x.title === 'The Mom Test')
ok('it is put on the shelf as want-to-read, with what the catalogue knew', mom?.status === 'want' && mom?.isbn === '9781492180746' && mom?.authors?.[0] === 'Rob Fitzpatrick', JSON.stringify({ s: mom?.status, i: mom?.isbn }))
ok('and linked as made', (await live('book')).some(x => x.recordId === mom?.id && x.role === 'made'))
ok('its row appears, not being read', await row(mom.id).count() === 1 && await row(mom.id).getAttribute('data-status') === 'want')
await row(mom.id).getByRole('button', { name: 'Undo' }).click()
await p.waitForTimeout(500)
ok('Undo takes the book off the shelf', deletes.library_books.some(s => s.includes(mom.id)))
ok('and its link', !(await live('book')).some(x => x.recordId === mom.id))

// One already there is started, never added twice.
const adds = writes.library_books.filter(x => x.title === 'Atomic Habits').length
await find.fill('Atomic Habits')
await box.locator('[data-outcome-result]').first().waitFor({ timeout: 4000 })
const res = await box.locator('[data-outcome-result]').first().innerText()
ok('a book already on the shelf says so', /On your shelf/.test(res), res.replace(/\n+/g, ' | '))
ok('and is not offered to add again', await box.locator('[data-outcome-result]').first().getByRole('button', { name: 'Want to read' }).count() === 0)
await box.locator('[data-outcome-result]').first().getByRole('button', { name: 'Start reading' }).click()
await p.waitForTimeout(500)
const started = writes.library_books.filter(x => x.id === 'b-atomic').at(-1)
ok('starting it updates that book', started?.status === 'reading' && started?.started_on === TODAY, JSON.stringify({ s: started?.status, d: started?.started_on }))
ok('without adding a second copy', writes.library_books.filter(x => x.title === 'Atomic Habits' && x.id !== 'b-atomic').length === adds)
ok('and it joins the reading list, linked', await row('b-atomic').count() === 1 && (await live('book')).some(x => x.recordId === 'b-atomic'))

// A catalogue down is said, and typing still works.
await find.fill('fail this lookup')
await p.waitForTimeout(1200)
ok('both catalogues down is said, not "not found"', /Could not reach the book catalogues/.test(await box.innerText()), (await box.innerText()).replace(/\n+/g, ' | ').slice(-160))
await box.getByRole('button', { name: /Add “fail this lookup” as typed/ }).click()
await p.waitForTimeout(500)
ok('and the book can still be added as typed', writes.library_books.some(x => x.title === 'fail this lookup' && x.status === 'want'))
await done()
