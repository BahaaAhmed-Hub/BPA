// node scripts/library-tracker.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 4b: the Tracker. The maths is imported from the dev server and asked
// pure questions (streak edge cases, week boundaries, clock changes); the view is
// then driven against sessions seeded relative to the real today.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const B1 = '00000000-0000-4000-8000-0000000000b1'
const book = (id, title, extra = {}) => ({ id, user_id: user.id, title, authors: ['A. Writer'], pages: 300, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, ...extra })
const T = { library_books: [book(B1, 'Deep Work')], library_sessions: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [] }
let missing = false

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } })
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
    if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
    return json(r, [], 201)
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'tracker')
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

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/src/modules/library/trackerStats.ts')
  const S = (on, kind = 'read', minutes = 20, pages) => ({ id: on + kind + minutes, bookId: 'x', kind, on, minutes, pages, createdAt: '' })
  const T0 = '2026-10-12' // a Monday
  return {
    monday: m.weekStart('2026-10-12'), sunday: m.weekStart('2026-10-18'), wed: m.weekStart('2026-10-14'), yearEdge: m.weekStart('2027-01-01'),
    add: [m.addDays('2026-10-31', 1), m.addDays('2026-03-01', -1), m.addDays('2026-12-31', 1)],
    // across European and US clock changes a "day" is 23 or 25 hours; the date arithmetic must not care
    dst: [m.addDays('2026-03-28', 1), m.addDays('2026-03-29', 1), m.addDays('2026-10-24', 2), m.addDays('2026-03-07', 2), m.addDays('2026-11-01', -1)],
    s: {
      none: m.streaks([], T0),
      todayIn: m.streaks([S('2026-10-12'), S('2026-10-11'), S('2026-10-10')], T0),
      notYet: m.streaks([S('2026-10-11'), S('2026-10-10')], T0),
      broken: m.streaks([S('2026-10-10'), S('2026-10-09')], T0),
      longest: m.streaks([S('2026-09-01'), S('2026-09-02'), S('2026-09-03'), S('2026-09-04'), S('2026-10-11')], T0),
      twoOneDay: m.streaks([S('2026-10-12', 'read'), S('2026-10-12', 'listen'), S('2026-10-11')], T0),
      future: m.streaks([S('2026-10-13'), S('2026-10-12')], T0),
    },
    week: m.periodTotals([S('2026-10-11', 'read', 50, 10), S('2026-10-12', 'read', 30, 20), S('2026-10-14', 'listen', 40), S('2026-10-18', 'read', 5, 1), S('2026-10-19', 'read', 99, 9)], '2026-10-12', '2026-10-18'),
    buckets: m.weekBuckets([S('2026-10-12', 'read', 30), S('2026-10-05', 'listen', 10), S('2026-08-01', 'read', 7)], T0, 12),
    byDay: [...m.byDay([S('2026-10-12', 'read', 30), S('2026-10-12', 'listen', 15)]).entries()],
    fin: m.finishedIn([{ finishedOn: '2026-01-02' }, { finishedOn: '2025-12-31' }, {}, { finishedOn: '2026-10-01' }], 2026),
  }
})
ok('weeks start on Monday, and a Sunday belongs to the week before it', u.monday === '2026-10-12' && u.sunday === '2026-10-12' && u.wed === '2026-10-12', `${u.monday} ${u.sunday} ${u.wed}`)
ok('a week can start in the previous year', u.yearEdge === '2026-12-28', u.yearEdge)
ok('adding days crosses months and years', u.add.join() === '2026-11-01,2026-02-28,2027-01-01', u.add.join())
ok('adding days is not thrown by a clock change', u.dst.join() === '2026-03-29,2026-03-30,2026-10-26,2026-03-09,2026-10-31', u.dst.join())
ok('no sessions: no streak', u.s.none.current === 0 && u.s.none.longest === 0 && !u.s.none.today)
ok('streak counts back from today when today is logged', u.s.todayIn.current === 3 && u.s.todayIn.today)
ok('streak survives a day not logged YET', u.s.notYet.current === 2 && !u.s.notYet.today)
ok('streak breaks after a whole day with nothing', u.s.broken.current === 0)
ok('longest is kept after the run ends', u.s.longest.longest === 4 && u.s.longest.current === 1)
ok('reading and listening on one day are one day', u.s.twoOneDay.current === 2)
ok('a future-dated row is not counted', u.s.future.current === 1)
ok('period totals are inclusive of both ends and keep the kinds apart', u.week.read === 35 && u.week.listen === 40 && u.week.pages === 21 && u.week.sessions === 3, JSON.stringify(u.week))
ok('twelve weekly buckets, the last being this week', u.buckets.length === 12 && u.buckets[11].start === '2026-10-12' && u.buckets[11].read === 30 && u.buckets[10].listen === 10 && u.buckets[0].start === '2026-07-27', `${u.buckets[0].start} ${u.buckets[11].start}`)
ok('a Sunday session is last week\'s, and one before the window is in no bucket', u.buckets[10].listen === 10 && u.buckets.reduce((a, x) => a + x.read + x.listen, 0) === 47)
ok('byDay sums per kind', JSON.stringify(u.byDay) === '[["2026-10-12",{"read":30,"listen":15}]]')
ok('books finished counts only the given year', u.fin === 2)

// ── the view: empty ─────────────────────────────────────────────────────────
ok('with nothing logged it says so', /Nothing logged yet/.test(await p.locator('body').innerText()))
await ctx.close()

// ── the view: seeded relative to the real today ─────────────────────────────
const iso = (d = 0) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const S = (id, d, kind, minutes, pages) => ({ id, user_id: user.id, book_id: B1, kind, on_date: iso(d), minutes, pages: pages ?? null, to_page: pages ?? null, created_at: new Date(Date.now() - (id.length + d) * 1000).toISOString() })
T.library_sessions = [S('a1', 0, 'read', 30, 20), S('a2', 0, 'listen', 15), S('a3', -1, 'read', 45, 30), S('a4', -2, 'read', 20, 10)]
;({ p, ctx } = await open())
const body = async () => p.locator('body').innerText()
let txt = await body()
ok('the streak shows three days and that today is done', /3 days/.test(txt) && /Done today/.test(txt), txt.match(/Streak[\s\S]{0,60}/)?.[0])
ok('the bars are labelled with what they hold', await p.getByRole('listitem', { name: /30 min reading/ }).count() >= 1 || await p.getByRole('listitem', { name: /reading/ }).count() >= 1)
ok('the latest sessions list names the book', await p.getByRole('button', { name: 'Deep Work' }).count() >= 1)
await p.getByRole('tab', { name: 'Listening' }).click(); await wait(300)
txt = await body()
ok('Listening narrows the list to listening', /listening/.test(txt) && !/45 min ·/.test(txt))
await p.getByRole('tab', { name: '12 weeks' }).click(); await wait(300)
ok('12 weeks draws twelve columns', await p.getByRole('listitem', { name: /Week of/ }).count() === 12)
await p.getByRole('tab', { name: 'All' }).click(); await wait(200)
await p.getByRole('button', { name: 'Deep Work' }).first().click(); await wait(900)
ok('a session\'s book opens on the shelf', await p.getByRole('complementary').count() >= 1 && /Deep Work/.test(await p.getByRole('complementary').first().innerText()))
await ctx.close()

// ── migration not run ───────────────────────────────────────────────────────
missing = true
;({ p, ctx } = await open())
ok('without 20260030 the tracker names the migration', /20260030_library_sessions/.test(await body()))
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
