// node scripts/library-sessions.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 4a: logging reading and listening sessions, the stopwatch, and the
// progress they derive. The fake PostgREST enforces the table's CHECKs (minutes
// 1–1440, kind) the way Postgres would, so a bad row is refused by the "server"
// and not just by the form.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const B1 = '00000000-0000-4000-8000-0000000000b1', B2 = '00000000-0000-4000-8000-0000000000b2'
const book = (id, title, extra = {}) => ({ id, user_id: user.id, title, authors: ['A. Writer'], pages: 300, source: 'manual', status: 'want', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, ...extra })
const T = {
  library_books: [book(B1, 'Deep Work'), book(B2, 'Audio Book', { format: 'audio', pages: null })],
  library_sessions: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [],
}
let missing = false, refused = []
const KNOWN = 'id user_id book_id kind on_date minutes pages to_page created_at'.split(' ')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1300 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_sessions' && missing) return json(r, { code: 'PGRST205', message: 'no table' }, 404)
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_sessions') for (const row of rows) {
        for (const k of Object.keys(row)) if (!KNOWN.includes(k)) return json(r, { code: 'PGRST204', message: k }, 400)
        if (!['read', 'listen'].includes(row.kind) || !(row.minutes >= 1 && row.minutes <= 1440)) { refused.push(row); return json(r, { code: '23514', message: 'check constraint' }, 400) }
      }
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
    return json(r, [])
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'shelf')
  } catch {} }, session)
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)
const panel = () => p.getByRole('complementary')
const pick = async t => { await p.getByRole('button', { name: new RegExp(`${t} by`) }).click(); await wait(900) }
const today = () => p.evaluate(async () => (await import('/src/modules/library/readingStats.ts')).todayISO())

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/src/modules/library/readingStats.ts')
  const S = (kind, minutes, toPage) => ({ id: Math.random().toString(), bookId: 'x', kind, on: '2026-01-01', minutes, toPage, createdAt: '' })
  return {
    far: m.progressOf({ pages: 200 }, [S('read', 30, 40), S('read', 20, 90), S('read', 10, 60), S('listen', 45)]),
    nopages: m.progressOf({}, [S('read', 5, 12)]), none: m.progressOf({ pages: 100 }, []),
    over: m.progressOf({ pages: 100 }, [S('read', 5, 140)]),
    cov: [m.pagesCovered(null, 30), m.pagesCovered(50, 80), m.pagesCovered(80, 60), m.pagesCovered(80, 80), m.pagesCovered(10, undefined)],
    fm: [m.fmtMinutes(5), m.fmtMinutes(60), m.fmtMinutes(125)],
    late: m.todayISO(new Date(2026, 0, 31, 0, 30)), early: m.todayISO(new Date(2026, 0, 31, 23, 59)),
  }
})
ok('progress is the furthest page reached, not the last logged', u.far.page === 90 && u.far.pct === 45)
ok('reading and listening minutes are kept apart', u.far.readMinutes === 60 && u.far.listenMinutes === 45 && u.far.sessions === 4)
ok('no page count means no percent; no sessions means no page', u.nopages.pct === null && u.nopages.page === 12 && u.none.page === null)
ok('a page past the end is capped at 100%', u.over.pct === 100)
ok('pages covered: new ground only — re-reading and going back are time, not progress', u.cov.join() === '30,30,,,', u.cov.join())
ok('minutes read as hours', u.fm.join('|') === '5 min|1 h|2 h 5 min')
ok('a day is the reader\'s local day, even at half past midnight', u.late === '2026-01-31' && u.early === '2026-01-31')

// ── logging ─────────────────────────────────────────────────────────────────
await pick('Deep Work')
ok('a book with no sessions says so', /No sessions yet/.test(await panel().innerText()))
await panel().getByRole('button', { name: 'Log a session' }).click()
const f = n => panel().getByLabel(n, { exact: true })
await f('Minutes').fill('0'); await f('Now on page').fill('40'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(300)
ok('zero minutes is refused on the form, and nothing is sent', /Between 1 and 1440/.test(await panel().innerText()) && T.library_sessions.length === 0)
await f('Minutes').fill('25'); await f('Now on page').fill('400'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(300)
ok('a page beyond the book is refused, naming the page count', /has 300 pages/.test(await panel().innerText()) && T.library_sessions.length === 0)
const t = await today()
await f('Now on page').fill('40'); await f('Day').fill('2099-01-01'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(300)
ok('a future day is refused', /not happened yet/.test(await panel().innerText()) && T.library_sessions.length === 0)
await f('Day').fill(t); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(1500)
const s1 = T.library_sessions[0]
ok('a session is stored with its day, length, page and the pages it covered', !!s1 && s1.kind === 'read' && s1.minutes === 25 && s1.to_page === 40 && s1.pages === 40 && s1.on_date === t, JSON.stringify(s1))
ok('and starts a want-to-read book', T.library_books[0].status === 'reading' && T.library_books[0].started_on === t)
ok('progress is drawn: page, total, percent, and a bar', /Page 40 of 300 · 13%/.test(await panel().innerText()) && await panel().getByRole('progressbar').getAttribute('aria-valuenow') === '13')

await panel().getByRole('button', { name: 'Log a session' }).click(); await f('Minutes').fill('10'); await f('Now on page').fill('30'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(1200)
const s2 = T.library_sessions.find(x => x.id !== s1.id)
ok('going back a page logs time but no new pages, and progress does not fall', s2.to_page === 30 && (s2.pages ?? null) === null && /Page 40 of 300/.test(await panel().innerText()))
await panel().getByRole('button', { name: 'Log a session' }).click(); await f('Minutes').fill('45'); await f('Now on page').fill('100'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(1200)
const s3 = T.library_sessions.find(x => x.to_page === 100)
ok('moving on records only the new ground (60 pages from 40)', s3.pages === 60 && /Page 100 of 300 · 33%/.test(await panel().innerText()))
ok('the totals add up', /1 h 20 min reading/.test(await panel().innerText()) && /3 sessions/.test(await panel().innerText()))

// delete → progress comes back; undo → it returns
await panel().getByRole('button', { name: new RegExp(`Delete the session on ${t}`) }).first().click(); await wait(1200)
ok('deleting the newest session puts progress back', T.library_sessions.length === 2 && /Page 40 of 300/.test(await panel().innerText()))
await p.keyboard.press('Control+z'); await wait(1500)
ok('⌘Z brings it back, and the server has it again', T.library_sessions.length === 3 && /Page 100 of 300/.test(await panel().innerText()))

// the end of the book
await panel().getByRole('button', { name: 'Log a session' }).click(); await f('Minutes').fill('30'); await f('Now on page').fill('300'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(1200)
ok('the last page offers Mark finished — and does not do it', /reached the last page/.test(await panel().innerText()) && T.library_books[0].status === 'reading')
await panel().getByRole('button', { name: 'Mark finished' }).click(); await wait(1200)
ok('the reader decides: finished, with the day', T.library_books[0].status === 'finished' && T.library_books[0].finished_on === t && !/reached the last page/.test(await panel().innerText()))

// ── the stopwatch ───────────────────────────────────────────────────────────
await p.keyboard.press('Escape'); await wait(300)
await pick('Audio Book')
await panel().getByRole('button', { name: 'Start timer' }).click(); await wait(2200)
ok('the timer runs, showing a clock', /^0:0\d$/.test((await panel().getByLabel('Time so far').innerText()).trim()), await panel().getByLabel('Time so far').innerText())
ok('an audio book times as listening', /listening/.test(await panel().innerText()))
await p.evaluate(() => { const t = JSON.parse(localStorage.getItem('library-timer')); t.startedAt = Date.now() - 12 * 60000; localStorage.setItem('library-timer', JSON.stringify(t)) })
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500); await pick('Audio Book')
ok('a reload does not lose it — it is a start time, not a counter', /^1[23]:\d\d$/.test((await panel().getByLabel('Time so far').innerText()).trim()), await panel().getByLabel('Time so far').innerText())
await p.keyboard.press('Escape'); await wait(300); await pick('Deep Work')
ok('on another book it says where the timer is, and will not start a second', /running for “Audio Book”/.test(await panel().innerText()) && await panel().getByRole('button', { name: 'Start timer' }).isDisabled())
await p.keyboard.press('Escape'); await wait(300); await pick('Audio Book')
await panel().getByRole('button', { name: 'Stop' }).click(); await wait(400)
ok('Stop opens the form with the measured time to correct', await f('Minutes').inputValue() === '12' && await panel().getByLabel('Now on page').count() === 0)
await f('Minutes').fill('11'); await panel().getByRole('button', { name: 'Save session' }).click(); await wait(1200)
const s4 = T.library_sessions.find(x => x.book_id === B2)
ok('the corrected figure is what is saved, as listening, with no page', !!s4 && s4.kind === 'listen' && s4.minutes === 11 && s4.to_page === null && /11 min listening/.test(await panel().innerText()))
ok('and the timer is gone', await p.evaluate(() => localStorage.getItem('library-timer')) === null)

// a forgotten timer is capped at a day
await panel().getByRole('button', { name: 'Start timer' }).click()
await p.evaluate(() => { const t = JSON.parse(localStorage.getItem('library-timer')); t.startedAt = Date.now() - 3 * 86400000; localStorage.setItem('library-timer', JSON.stringify(t)) })
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500); await pick('Audio Book')
await panel().getByRole('button', { name: 'Stop' }).click(); await wait(300)
ok('a timer left running for days stops at 1440, to be corrected', await f('Minutes').inputValue() === '1440')
await panel().getByRole('button', { name: 'Cancel' }).click()

// ── a bad row the form let through is still refused by the server ───────────
ok('the server\'s CHECK was never tripped by the form', refused.length === 0)

// ── migration not run ───────────────────────────────────────────────────────
await ctx.close()
missing = true
;({ p, ctx } = await open())
await pick('Deep Work')
ok('without 20260030 the card says so and offers no timer', /20260030_library_sessions/.test(await panel().innerText()) && await panel().getByRole('button', { name: 'Start timer' }).count() === 0)
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
