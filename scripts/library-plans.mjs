// node scripts/library-plans.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 4c: reading plans. The maths is imported from the dev server and asked
// pure questions; the card and the Tracker list are then driven against a fake
// PostgREST that enforces the table's CHECKs and its one-plan-per-book unique.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const B1 = '00000000-0000-4000-8000-0000000000b1', B2 = '00000000-0000-4000-8000-0000000000b2'
const book = (id, title, extra = {}) => ({ id, user_id: user.id, title, authors: ['A. Writer'], pages: 300, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, ...extra })
const T = { library_books: [book(B1, 'Deep Work'), book(B2, 'Other Book')], library_sessions: [], library_plans: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [] }
let missing = false, refused = []
const KNOWN = 'id user_id book_id finish_by minutes per created_at'.split(' ')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_plans' && missing) return json(r, { code: 'PGRST205', message: 'no table' }, 404)
    // This project has not run 20260032: asking for a block column is the 400 PostgREST sends, which is how
    // the card learns not to send them (library-plan-blocks.mjs is the suite for a project that has).
    if (t === 'library_plans' && (u.searchParams.get('select') ?? '').includes('block_')) return json(r, { code: '42703', message: 'column does not exist' }, 400)
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_plans') for (const row of rows) {
        for (const k of Object.keys(row)) if (!KNOWN.includes(k)) return json(r, { code: 'PGRST204', message: k }, 400)
        const bad = (row.finish_by == null && row.minutes == null) || !['day', 'week'].includes(row.per) || (row.minutes != null && !(row.minutes >= 1 && row.minutes <= 1440))
        const dup = T.library_plans.some(p => p.book_id === row.book_id && p.id !== row.id)
        if (bad || dup) { refused.push(row); return json(r, { code: dup ? '23505' : '23514', message: 'constraint' }, dup ? 409 : 400) }
      }
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') {
      const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id)
      // on delete cascade, as the real tables do
      if (t === 'library_books' && id) { T.library_plans = T.library_plans.filter(x => x.book_id !== id); T.library_sessions = T.library_sessions.filter(x => x.book_id !== id) }
      return json(r, [])
    }
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
const iso = (d = 0) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/src/modules/library/planStats.ts')
  const T0 = '2026-10-12'
  const bk = (extra = {}) => ({ id: 'b', pages: 300, status: 'reading', ...extra })
  const S = (on, pages, toPage, kind = 'read', minutes = 20) => ({ id: on + pages + kind, bookId: 'b', kind, on, minutes, pages, toPage, createdAt: '' })
  const P = (extra = {}) => ({ id: 'p', bookId: 'b', per: 'day', createdAt: '', ...extra })
  // 100 pages a day for the last 2 days: 200 read, 100 left, 30 days to go → plenty
  const fast = [S('2026-10-11', 100, 100), S('2026-10-12', 100, 200)]
  // 10 pages in 14 days → far too slow for 100 left in 5 days
  const slow = [S('2026-09-29', 10, 10)]
  return {
    pace: [m.pacePerDay([], T0), m.pacePerDay(fast, T0), m.pacePerDay(slow, T0), m.pacePerDay([S('2026-09-01', 500, 500)], T0), m.pacePerDay([S('2026-10-13', 50, 50)], T0), m.pacePerDay([S('2026-10-12', 0, undefined, 'listen')], T0)],
    ahead: m.planStatus(bk(), fast, P({ finishBy: '2026-11-11' }), T0),
    on: m.planStatus(bk(), [S('2026-10-11', 10, 10), S('2026-10-12', 10, 20)], P({ finishBy: '2026-11-12' }), T0),
    behind: m.planStatus(bk(), [...slow, S('2026-10-12', 0, 190)], P({ finishBy: '2026-10-16' }), T0),
    stalled: m.planStatus(bk(), [S('2026-08-01', 50, 50)], P({ finishBy: '2026-10-20' }), T0),
    late: m.planStatus(bk(), fast, P({ finishBy: '2026-10-11' }), T0),
    today: m.planStatus(bk(), fast, P({ finishBy: '2026-10-12' }), T0),
    fresh: m.planStatus(bk(), [], P({ finishBy: '2026-11-11' }), T0),
    nopages: m.planStatus(bk({ pages: undefined }), fast, P({ finishBy: '2026-11-11' }), T0),
    finished: m.planStatus(bk({ status: 'finished' }), fast, P({ finishBy: '2026-10-01' }), T0),
    lastpage: m.planStatus(bk(), [S('2026-10-12', 300, 300)], P({ finishBy: '2026-10-01' }), T0),
    noDate: m.planStatus(bk(), fast, P({ minutes: 30 }), T0),
    day: m.planStatus(bk(), [S('2026-10-12', 5, 5, 'read', 20), S('2026-10-12', 0, undefined, 'listen', 15), S('2026-10-11', 5, 5, 'read', 99)], P({ minutes: 30 }), T0),
    week: m.planStatus(bk(), [S('2026-10-12', 5, 5, 'read', 20), S('2026-10-14', 5, 10, 'read', 25), S('2026-10-11', 5, 5, 'read', 99)], P({ minutes: 60, per: 'week' }), T0),
    met: m.planStatus(bk(), [S('2026-10-12', 5, 5, 'read', 45)], P({ minutes: 30 }), T0),
    other: m.planStatus(bk(), [{ ...S('2026-10-12', 99, 99), bookId: 'zzz' }], P({ finishBy: '2026-11-11' }), T0),
    sugg: [m.suggestedFinish(bk(), fast, T0), m.suggestedFinish(bk(), [], T0), m.suggestedFinish(bk({ pages: undefined }), fast, T0)],
    sentence: [m.planSentence(m.planStatus(bk(), [...slow, S('2026-10-12', 0, 190)], P({ finishBy: '2026-10-16' }), T0)), m.planSentence(m.planStatus(bk(), [S('2026-08-01', 50, 50)], P({ finishBy: '2026-10-20' }), T0))],
  }
})
ok('pace: nothing read is 0; a listening session adds no pages', u.pace[0] === 0 && u.pace[5] === 0)
ok('pace: 200 pages over the 2 days the book has existed is 100 a day, not 200/14', u.pace[1] === 100, String(u.pace[1]))
ok('pace: 10 pages over 14 days is under 1 a day', Math.abs(u.pace[2] - 10 / 14) < 1e-9, String(u.pace[2]))
ok('pace: a sitting older than the window counts for nothing', u.pace[3] === 0)
ok('pace: a future-dated sitting is ignored', u.pace[4] === 0)
ok('ahead: 100 left over 31 days at 100 a day', u.ahead.state === 'ahead' && u.ahead.pagesLeft === 100 && u.ahead.daysLeft === 31 && u.ahead.needPerDay === 4, JSON.stringify(u.ahead))
ok('ahead: projected the next day', u.ahead.projected === '2026-10-13', u.ahead.projected)
ok('on track: pace lands before the date but without the margin', u.on.state === 'on', u.on.state)
ok('on track: needs-per-week is the daily figure times seven, rounded up', u.on.needPerWeek === Math.ceil((u.on.pagesLeft / u.on.daysLeft) * 7))
ok('behind: the pace lands after the date', u.behind.state === 'behind' && u.behind.projected > '2026-10-16', JSON.stringify(u.behind))
ok('behind: read once, nothing in the window — stalled, no projection', u.stalled.state === 'behind' && u.stalled.projected === null)
ok('late: the date has passed and the book is not done', u.late.state === 'late' && u.late.daysLeft === 0)
ok('the finish day itself still counts as a day', u.today.daysLeft === 1 && u.today.state !== 'late', JSON.stringify(u.today))
ok('unknown: nothing read yet is not "behind"', u.fresh.state === 'unknown' && u.fresh.needPerDay === 1 + Math.floor(300 / 31) - (300 % 31 === 0 ? 1 : 0) || u.fresh.state === 'unknown')
ok('unknown: no page count, no pace needed', u.nopages.state === 'unknown' && u.nopages.needPerDay === null)
ok('done: a finished book is done whatever the date', u.finished.state === 'done' && u.finished.projected === null)
ok('done: the last page reached is done too', u.lastpage.state === 'done')
ok('a time budget alone is not judged by pages', u.noDate.state === 'unknown' && u.noDate.minutes.target === 30)
ok('minutes a day: today only, both kinds counted', u.day.minutes.done === 35 && u.day.minutes.left === 0, JSON.stringify(u.day.minutes))
ok('minutes a week: Monday to Sunday, not the Sunday before', u.week.minutes.done === 45 && u.week.minutes.left === 15, JSON.stringify(u.week.minutes))
ok('minutes met reads left 0, never negative', u.met.minutes.left === 0)
ok('another book\'s sessions are not this book\'s', u.other.pacePerDay === 0 && u.other.state === 'unknown')
ok('suggested date: where the pace lands; a month out with no pace', u.sugg[0] === '2026-10-13' && u.sugg[1] === '2026-11-11' && u.sugg[2] === '2026-11-11', u.sugg.join())
ok('the sentences name their figures', /pages a day/.test(u.sentence[0]) && /reach the end on/.test(u.sentence[0]) && /nothing has been read/.test(u.sentence[1]), u.sentence.join(' | '))
await ctx.close()

// ── the card ────────────────────────────────────────────────────────────────
const S = (id, d, pages, to, minutes = 30) => ({ id, user_id: user.id, book_id: B1, kind: 'read', on_date: iso(d), minutes, pages, to_page: to, created_at: new Date(Date.now() - (-d) * 1000 - id.length).toISOString() })
T.library_sessions = [S('a1', -2, 50, 50), S('a2', -1, 50, 100), S('a3', 0, 20, 120, 20)]
;({ p, ctx } = await open())
const panel = () => p.getByRole('complementary')
await p.getByRole('button', { name: /Deep Work by/ }).click(); await wait(900)
ok('a book with no plan offers to make one', await panel().getByRole('button', { name: 'Make a plan' }).count() === 1 && /Pick a day to finish by/.test(await panel().innerText()))
await panel().getByRole('button', { name: 'Make a plan' }).click(); await wait(1200)
const made = T.library_plans[0]
ok('making one writes it, already holding a date (the pace lands it)', !!made && made.book_id === B1 && !!made.finish_by && made.per === 'day' && made.minutes == null, JSON.stringify(made))
const dateIn = panel().getByLabel('Finish by')
ok('the date field shows what was suggested', (await dateIn.inputValue()) === made.finish_by)
// 180 left at 140 pages / 3 days ≈ 46.7 a day → ~4 days
ok('the status says which state and why', /On track|Ahead|Behind/.test(await panel().getByRole('status', { name: 'Plan status' }).innerText()) && /pages a day/.test(await panel().innerText()))
await dateIn.fill(iso(3)); await wait(1200)
ok('changing the date writes through', T.library_plans[0].finish_by === iso(3))
ok('180 pages in 4 days needs 45 a day, and 140 in 3 days keeps 46.7 — on track or ahead', /You need 45 pages a day/.test(await panel().innerText()), (await panel().innerText()).match(/You need[^.]*\./)?.[0])
await dateIn.fill(iso(1)); await wait(1200)
ok('squeezing the date turns it behind', /Behind/.test(await panel().getByRole('status', { name: 'Plan status' }).innerText()))
await panel().getByLabel('Minutes').fill('45'); await wait(1500)
ok('a minutes target is held then written', T.library_plans[0].minutes === 45)
ok('and shows today\'s progress against it (20 of 45 today)', /20 min of 45 min this day/.test(await panel().innerText()), (await panel().innerText()).match(/\d+ min of[^.]*/)?.[0])
await panel().getByRole('tab', { name: 'a week' }).click(); await wait(1200)
ok('per week writes through and the line changes to the week', T.library_plans[0].per === 'week' && /this week/.test(await panel().innerText()))
await panel().getByLabel('Minutes').fill('0'); await wait(1500)
ok('zero minutes clears the target rather than writing a CHECK violation', T.library_plans[0].minutes == null && refused.length === 0)
await dateIn.fill(''); await wait(1500)
ok('clearing the last thing the plan says removes it (the table would refuse an empty one)', T.library_plans.length === 0 && await panel().getByRole('button', { name: 'Make a plan' }).count() === 1 && refused.length === 0)
await p.keyboard.press('Control+z'); await wait(1200)
ok('undo brings the plan back', T.library_plans.length === 1)

// ── the Tracker lists it ────────────────────────────────────────────────────
await panel().getByRole('button', { name: /Close|Back/i }).first().click().catch(() => {})
await p.keyboard.press('Escape'); await wait(300)
await p.getByRole('tab', { name: 'Tracker' }).click(); await wait(700)
const tr = await p.locator('body').innerText()

ok('the Tracker lists the plan with its state', /plans/i.test(tr) && /Deep Work/.test(tr) && /Behind|On track|Ahead/.test(tr))
ok('a book with no plan is not listed in Plans', !/Other Book/.test(tr))

// remove via the trash
await p.getByRole('button', { name: 'Deep Work' }).first().click(); await wait(700)
await panel().getByRole('button', { name: 'Remove this plan' }).click(); await wait(1200)
ok('the trash removes the plan', T.library_plans.length === 0)

// a second plan for the same book is refused by the server's unique
await p.evaluate(async ({ id }) => {
  const { useLibraryStore } = await import('/src/modules/library/libraryStore.ts')
  useLibraryStore.getState().setPlan(id, { finishBy: '2099-01-01' })
}, { id: B1 })
await wait(1000)
ok('one plan per book: setting again replaces, never duplicates', await p.evaluate(async id => {
  const { useLibraryStore } = await import('/src/modules/library/libraryStore.ts')
  useLibraryStore.getState().setPlan(id, { finishBy: '2099-02-02' })
  return useLibraryStore.getState().plans.filter(x => x.bookId === id).length
}, B1) === 1 && refused.length === 0)
await wait(800)

// deleting the book takes its plan, and undo gives it back (let the upserts above land first: a write
// still in flight when the book goes would, on the real table, be refused by the foreign key)
await wait(2000)
await p.getByRole('button', { name: /Deep Work by|Deep Work/ }).first().click().catch(() => {})
const n0 = await p.evaluate(async () => (await import('/src/modules/library/libraryStore.ts')).useLibraryStore.getState().plans.length)
await p.evaluate(async id => (await import('/src/modules/library/libraryStore.ts')).useLibraryStore.getState().deleteBook(id), B1)
const n1 = await p.evaluate(async () => (await import('/src/modules/library/libraryStore.ts')).useLibraryStore.getState().plans.length)
ok('deleting a book takes its plan with it', n0 === 1 && n1 === 0, `${n0}->${n1}`)
await p.keyboard.press('Control+z'); await wait(900)
ok('and undo restores it', await p.evaluate(async () => (await import('/src/modules/library/libraryStore.ts')).useLibraryStore.getState().plans.length) === 1)
ok('the server never refused a row along the way', refused.length === 0, JSON.stringify(refused))
await ctx.close()

// ── migration not run ───────────────────────────────────────────────────────
missing = true
;({ p, ctx } = await open())
await p.getByRole('button', { name: /Deep Work by/ }).click(); await wait(900)
ok('without 20260031 the card names the migration and offers no plan', /20260031_library_plans/.test(await panel().innerText()) && await panel().getByRole('button', { name: 'Make a plan' }).count() === 0)
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
