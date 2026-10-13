// node scripts/library-goals.mjs   — needs a dev server on 5199 (restart it after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 4e: yearly goals and challenges. The maths is imported and asked pure
// questions with the clock fixed; the card is then driven against a PostgREST
// fake that enforces the table's CHECKs, its unique index (scope coalesced, as
// in the migration) and the cascade from lists.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const iso = (d = 0) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const YEAR = new Date().getFullYear()
const thisYear = n => `${YEAR}-01-${String(n).padStart(2, '0')}`   // always inside the year, however early in it we run
const id = n => `00000000-0000-4000-8000-0000000000${n}`
const [A, B, C, D, E] = [id('a1'), id('b2'), id('c3'), id('d4'), id('e5')]
const L1 = id('11')
const book = (bid, title, extra = {}) => ({ id: bid, user_id: user.id, title, authors: ['X'], pages: 300, source: 'manual', status: 'finished', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, ...extra })
const T = {
  library_books: [
    book(A, 'Alpha', { finished_on: thisYear(3) }), book(B, 'Bravo', { finished_on: thisYear(5) }), book(C, 'Charlie', { finished_on: thisYear(7) }),
    book(D, 'Delta', { finished_on: `${YEAR - 1}-06-01` }), book(E, 'Echo', { status: 'reading' }),
  ],
  library_lists: [{ id: L1, user_id: user.id, name: 'Classics', kind: 'list', description: null, thumb_url: null, color: null, sort_order: 0 }],
  library_list_books: [A, C, D].map(bid => ({ list_id: L1, book_id: bid, user_id: user.id, sort_order: 0 })),
  library_sessions: [
    { id: 's1', user_id: user.id, book_id: A, kind: 'read', on_date: iso(0), minutes: 30, pages: 20, to_page: 20, created_at: now },
    { id: 's2', user_id: user.id, book_id: B, kind: 'read', on_date: iso(0), minutes: 40, pages: 50, to_page: 50, created_at: now },
    { id: 's3', user_id: user.id, book_id: B, kind: 'listen', on_date: iso(0), minutes: 25, pages: null, to_page: null, created_at: now },
    { id: 's4', user_id: user.id, book_id: A, kind: 'read', on_date: `${YEAR - 1}-12-30`, minutes: 99, pages: 99, to_page: 99, created_at: now },
  ],
  library_goals: [], library_plans: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [],
}
let missing = false, refused = []
const KNOWN = 'id user_id year kind target list_id created_at'.split(' ')
const scopeKey = r => `${r.year}|${r.kind}|${r.list_id ?? 'none'}`

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1700 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_goals' && missing) return json(r, { code: 'PGRST205', message: 'no table' }, 404)
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_goals') for (const row of rows) {
        for (const k of Object.keys(row)) if (!KNOWN.includes(k)) return json(r, { code: 'PGRST204', message: k }, 400)
        const bad = !['books', 'pages', 'minutes'].includes(row.kind) || !(row.target >= 1 && row.target <= 1000000) || !(row.year >= 2000 && row.year <= 2200)
        const dup = T.library_goals.some(g => g.id !== row.id && scopeKey(g) === scopeKey(row))
        if (bad || dup) { refused.push(row); return json(r, { code: dup ? '23505' : '23514', message: 'constraint' }, dup ? 409 : 400) }
      }
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') {
      const rid = u.searchParams.get('id')?.replace(/^eq\./, ''); if (rid) T[t] = T[t].filter(x => x.id !== rid)
      if (t === 'library_lists' && rid) { T.library_goals = T.library_goals.filter(g => g.list_id !== rid); T.library_list_books = T.library_list_books.filter(l => l.list_id !== rid) }
      return json(r, [])
    }
    return json(r, [])
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'tracker')
  } catch {} }, session)
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/goalStats.ts')
  const bk = (id, fin) => ({ id, title: id, authors: [], status: 'finished', finishedOn: fin })
  const ln = (list, ...ids) => ids.map(b => ({ listId: list, bookId: b, sortOrder: 0 }))
  const S = (bookId, on, kind, minutes, pages) => ({ id: bookId + on + kind, bookId, kind, on, minutes, pages, createdAt: '' })
  const G = (extra = {}) => ({ id: 'g', year: 2026, kind: 'books', target: 24, createdAt: '', ...extra })
  const many = n => Array.from({ length: n }, (_, i) => bk('b' + i, '2026-03-01'))
  const T0 = '2026-07-02'   // day 183 of 365 → the straight line asks for 12.04 of 24
  const st = (g, books, links, sessions, today) => m.goalStatus(g, books, links, sessions, today)
  const sessions = [
    S('a', '2026-03-01', 'read', 30, 20), S('a', '2026-03-02', 'read', 10, undefined), S('b', '2026-03-03', 'read', 40, 50),
    S('b', '2026-03-04', 'listen', 25, undefined), S('a', '2025-12-31', 'read', 99, 99), S('a', '2027-01-01', 'read', 99, 99), S('z', '2026-03-05', 'read', 7, 7),
  ]
  const books = [bk('a', '2026-01-01'), bk('b', '2025-12-31'), bk('c', '2027-01-01'), bk('d', '2026-12-31'), { id: 'e', title: 'e', authors: [], status: 'reading' }]
  return {
    ahead: st(G(), many(14), [], [], T0), on: st(G(), many(12), [], [], T0), behind: st(G(), many(8), [], [], T0),
    lumpOn: st(G({ target: 12 }), many(1), [], [], '2026-02-20'), lumpBehind: st(G({ target: 12 }), [], [], [], '2026-02-20'),
    pagesBehind: st(G({ kind: 'pages', target: 10000 }), [bk('a', '2026-01-01')], [], [S('a', '2026-03-01', 'read', 30, 100)], '2026-02-20'),
    startingJan10: st(G({ kind: 'pages', target: 10000 }), [], [], [], '2026-01-10'), judgedJan14: st(G({ kind: 'pages', target: 10000 }), [], [], [], '2026-01-14'),
    done: st(G(), many(24), [], [], T0), over: st(G(), many(30), [], [], T0), doneLate: st(G(), many(24), [], [], '2027-03-01'),
    missed: st(G(), many(10), [], [], '2027-01-01'), upcoming: st(G(), [], [], [], '2025-12-31'),
    lastDay: st(G(), many(20), [], [], '2026-12-31'), firstDay: st(G(), [], [], [], '2026-01-01'),
    count: [m.goalProgress(G(), books, [], []), m.goalProgress(G({ year: 2025 }), books, [], []), m.goalProgress(G({ year: 2027 }), books, [], [])],
    challenge: [m.goalProgress(G({ listId: 'L' }), books, ln('L', 'a', 'c', 'e'), []), m.goalProgress(G({ listId: 'L' }), books, ln('L', 'b'), []), m.goalProgress(G({ listId: 'M' }), books, ln('L', 'a'), [])],
    pages: [m.goalProgress(G({ kind: 'pages' }), books, [], sessions), m.goalProgress(G({ kind: 'pages', listId: 'L' }), books, ln('L', 'a'), sessions)],
    minutes: [m.goalProgress(G({ kind: 'minutes' }), books, [], sessions), m.goalProgress(G({ kind: 'minutes', listId: 'L' }), books, ln('L', 'b'), sessions)],
    leap: m.goalStatus(G({ year: 2028, target: 366 }), [], [], [], '2028-12-31'), plain: m.goalStatus(G({ target: 365 }), [], [], [], '2026-12-31'),
    perDay: [st(G({ kind: 'pages', target: 3650 }), [], [], [], '2026-01-01').perDay, st(G({ kind: 'pages', target: 1000 }), [], [], [S('a', '2026-03-01', 'read', 1, 400)].concat([]), '2026-12-21').perDay],
    prog: [m.fmtProgress('books', 3, 24), m.fmtProgress('pages', 70, 1000), m.fmtProgress('minutes', 95, 6000), m.fmtProgress('books', 1, 1)],
    amount: ['books', 'pages', 'minutes'].map(k => [m.fmtAmount(k, 1), m.fmtAmount(k, 2), m.fmtAmount(k, 1200), m.fmtAmount(k, 125)]),
    sentences: [m.goalSentence('books', st(G(), many(8), [], [], T0)), m.goalSentence('pages', st(G({ kind: 'pages', target: 10000 }), [bk('a', '2026-01-01')], [], [S('a', '2026-03-01', 'read', 1, 1000)], T0)), m.goalSentence('minutes', st(G({ kind: 'minutes', target: 6000 }), [], [], [], T0)),
      m.goalSentence('books', st(G(), many(24), [], [], T0)), m.goalSentence('books', st(G(), many(30), [], [], T0)), m.goalSentence('books', st(G(), many(10), [], [], '2027-01-01')), m.goalSentence('books', st(G(), [], [], [], '2025-12-31')),
      m.goalSentence('books', st(G(), many(20), [], [], T0))],
  }
})
ok('ahead: 14 books against a line asking for 12.04', u.ahead.state === 'ahead' && u.ahead.progress === 14 && Math.abs(u.ahead.expected - 12.04) < 0.01, `${u.ahead.state} ${u.ahead.expected}`)
ok('on track: 12 against 12.04', u.on.state === 'on')
ok('behind: 8 against 12.04', u.behind.state === 'behind' && u.behind.remaining === 16)
ok('a book is a lump: 0.68 of a book short of the line is not behind', u.lumpOn.state === 'on', `${u.lumpOn.state} exp ${u.lumpOn.expected}`)
ok('but a whole book short is', u.lumpBehind.state === 'behind')
ok('pages have no lump: 100 pages against a line asking for ~1400 is behind', u.pagesBehind.state === 'behind')
ok('the first 13 days of the year are "just started", not judged', u.startingJan10.state === 'starting' && u.judgedJan14.state === 'behind', `${u.startingJan10.state} ${u.judgedJan14.state}`)
ok('met is done — even past the year\'s end — and exceeding it is a full bar, not 125%', u.done.state === 'done' && u.doneLate.state === 'done' && u.over.state === 'done' && u.over.pct === 100 && u.over.progress === 30)
ok('the year over and short is missed; before the year is upcoming', u.missed.state === 'missed' && u.upcoming.state === 'upcoming')
ok('today counts as a day left: Dec 31 has 1, Jan 1 has 365', u.lastDay.daysLeft === 1 && u.firstDay.daysLeft === 365, `${u.lastDay.daysLeft} ${u.firstDay.daysLeft}`)
ok('a leap year has 366 days', u.leap.daysLeft === 1 && u.firstDay.daysLeft === 365)
ok('perDay is what is left over the days left', Math.abs(u.perDay[0] - 3650 / 365) < 1e-9 && u.perDay[0] === 10, String(u.perDay[0]))
ok('no projection inside the grace period; one after it', u.startingJan10.projected === null && u.behind.projected !== null && Math.abs(u.behind.projected - (8 / 183) * 365) < 1e-9)
ok('books are counted by finish date inside the year only (Dec 31 and Jan 1 on the right sides)', u.count.join() === '2,1,1', u.count.join())
ok('a challenge counts only books on its list, and an unfinished one counts for nothing', u.challenge.join() === '1,0,0', u.challenge.join())
ok('pages are read sessions in the year, new ground only (no listening, no other year, no unknown book)', u.pages[0] === 70, u.pages.join())
ok('and a challenge narrows them to its books', u.pages[1] === 20)
ok('minutes are both kinds, in the year, in scope', u.minutes[0] === 105 + 0 && u.minutes[1] === 65, u.minutes.join())
ok('amounts read naturally (1 book, 2 books, 1,200 pages, 2 h 5 min)', u.amount[0][0] === '1 book' && u.amount[0][1] === '2 books' && u.amount[1][0] === '1 page' && u.amount[1][2] === '1,200 pages' && u.amount[2][0] === '1 min' && u.amount[2][3] === '2 h 5 min', JSON.stringify(u.amount))
ok('progress puts the unit once, at the end (3 of 24 books, 1 h 35 min of 100 h)', u.prog.join(' | ') === '3 of 24 books | 70 of 1,000 pages | 1 h 35 min of 100 h | 1 of 1 book', u.prog.join(' | '))
ok('sentences name the pace in the kind\'s own unit', /(about \d|one every \d+ days)/.test(u.sentences[0]) && /pages a day/.test(u.sentences[1]) && /a day/.test(u.sentences[2]) && /h/.test(u.sentences[2]), u.sentences.slice(0, 3).join(' | '))
ok('and say met, exceeded, missed and not started plainly', u.sentences[3] === 'Met.' && /6 books to spare/.test(u.sentences[4]) && /ended 14 books short/.test(u.sentences[5]) && /24 books to read over the year/.test(u.sentences[6]), u.sentences.slice(3, 7).join(' | '))
ok('a pace slower than a book a week reads as "one every N days"', /one every \d+ days/.test(u.sentences[7]), u.sentences[7])
await ctx.close()

// ── the card ────────────────────────────────────────────────────────────────
;({ p, ctx } = await open())
const card = () => p.getByText('Goals', { exact: true }).first().locator('xpath=ancestor::*[contains(@class,"sb-card") or self::div][3]')
const body = () => p.locator('body').innerText()
const goalRows = () => p.getByRole('group', { name: /goal$/ })
ok('the Tracker opens with the Goals card and no goal yet', /No goals for \d{4} yet/.test(await body()))
await p.getByLabel('New goal target').fill('24')
await p.getByRole('button', { name: 'Set goal' }).click(); await wait(1200)
const g1 = T.library_goals[0]
ok('setting one writes year, kind, target and no list', !!g1 && g1.year === YEAR && g1.kind === 'books' && g1.target === 24 && g1.list_id == null, JSON.stringify(g1))
ok('the card counts this year\'s finished books (3 of 24), not last year\'s', /3 of 24 books/.test(await body()), (await body()).match(/\d+ (books )?of \d+ books[^\n]*/)?.[0])
ok('the bar is 13% (3/24)', await p.getByRole('progressbar', { name: /Books progress/ }).getAttribute('aria-valuenow') === '13')
await p.getByLabel('New goal target').fill('30'); await p.getByRole('button', { name: 'Set goal' }).click(); await wait(800)
ok('a second whole-library books goal for the year is refused in words, and nothing is sent', /already have a books goal/.test(await p.getByRole('alert').innerText()) && T.library_goals.length === 1 && refused.length === 0)
await p.getByLabel('New goal target').fill('0'); await p.getByRole('button', { name: 'Set goal' }).click(); await wait(500)
ok('zero is refused on the form', /At least 1/.test(await p.getByRole('alert').innerText()) && T.library_goals.length === 1)
await p.getByLabel('New goal target').fill('1e3x'); await wait(200)
ok('non-digits never get into the box', await p.getByLabel('New goal target').inputValue() === '13')

// challenge on the Classics list: A and C finished this year, D last year
await p.getByLabel('New goal target').fill('5')
await p.getByLabel('Goal scope').selectOption({ label: 'Classics' }); await wait(200)
ok('choosing a list says it is a challenge', /A challenge: it counts only the books on “Classics”/.test(await body()))
await p.getByRole('button', { name: 'Set goal' }).click(); await wait(1200)
const g2 = T.library_goals.find(g => g.list_id === L1)
ok('a challenge is the same row with a list', !!g2 && g2.kind === 'books' && g2.target === 5 && g2.year === YEAR)
ok('and counts only the list: 2 of 5 (A and C; D finished last year)', /2 of 5 books/.test(await body()), (await body()).match(/\d+ of 5 books/)?.[0])
const before = T.library_goals.length
await p.getByLabel('New goal target').fill('7'); await p.getByRole('button', { name: 'Set goal' }).click(); await wait(600)
ok('the same list and kind again is refused, naming the list, and nothing is sent', /already have a books goal for “Classics”/.test(await p.getByRole('alert').innerText()) && T.library_goals.length === before && refused.length === 0)

// pages and hours
await p.getByRole('tab', { name: 'Pages' }).click(); await p.getByLabel('New goal target').fill('1000')
await p.getByLabel('Goal scope').selectOption(''); await p.getByRole('button', { name: 'Set goal' }).click(); await wait(1200)
ok('a pages goal counts new-ground pages read this year (70)', T.library_goals.some(g => g.kind === 'pages' && g.target === 1000) && /70 of 1,000 pages/.test(await body()))
await p.getByRole('tab', { name: 'Hours' }).click(); await p.getByLabel('New goal target').fill('100'); await p.getByRole('button', { name: 'Set goal' }).click(); await wait(1200)
const gm = T.library_goals.find(g => g.kind === 'minutes')
ok('hours are typed and stored as minutes (100 h = 6000)', gm?.target === 6000)
ok('time counts both kinds this year (95 min) and reads as hours', /1 h 35 min of 100 h/.test(await body()), (await body()).match(/[^\n]* of 100 h[^\n]*/)?.[0])

// edit a target
const booksRow = goalRows().filter({ hasText: /^Books\b/ }).first()
await p.getByRole('group', { name: 'Books goal' }).getByLabel('Target').fill('30'); await wait(1500)
ok('editing the target writes straight through', T.library_goals.find(g => g.id === g1.id).target === 30 && /3 of 30 books/.test(await body()))
await p.getByRole('group', { name: 'Time goal' }).getByLabel('Target (hours)').fill('0'); await wait(1300)
ok('a zero target is ignored (the table would refuse it)', T.library_goals.find(g => g.kind === 'minutes').target === 6000 && refused.length === 0)
void booksRow

// other years
await p.getByRole('button', { name: 'Previous year' }).first().click(); await wait(300)
ok('the year stepper shows another year with its own (empty) goals', new RegExp(`No goals for ${YEAR - 1} yet`).test(await body()))
await p.getByRole('tab', { name: 'Books' }).click(); await p.getByLabel('New goal target').fill('10'); await p.getByRole('button', { name: 'Set goal' }).click(); await wait(1200)
ok('a goal for last year is stored for that year and counts that year\'s books (1 of 10), and is missed', T.library_goals.some(g => g.year === YEAR - 1) && /1 of 10 books/.test(await body()) && /Missed/.test(await body()))
await p.getByRole('button', { name: 'Next year' }).first().click(); await wait(300)
ok('and this year\'s goals are still there', goalRows().count().then(n => n >= 4) && await goalRows().count() === 4)

// remove + undo
await p.getByRole('button', { name: /Remove the Pages goal/ }).click(); await wait(1200)
ok('removing a goal deletes it', !T.library_goals.some(g => g.kind === 'pages'))
await p.locator('body').click({ position: { x: 5, y: 5 } }); await p.keyboard.press('Control+z'); await wait(1300)
ok('undo brings it back', T.library_goals.some(g => g.kind === 'pages' && g.target === 1000))

// deleting the list takes its challenge; undo brings both back
await p.evaluate(async lid => (await import('/BPA/src/modules/library/libraryStore.ts')).useLibraryStore.getState().deleteList(lid), L1)
await wait(1500)
ok('deleting a list takes its challenge with it (the server cascades it)', !T.library_goals.some(g => g.list_id === L1) && (await goalRows().count()) === 3)
await p.keyboard.press('Control+z'); await wait(1800)
ok('undo restores the list and the challenge', T.library_goals.some(g => g.list_id === L1) && (await goalRows().count()) === 4)
ok('the server never refused a row along the way', refused.length === 0, JSON.stringify(refused))
await ctx.close()

// ── migration not run ───────────────────────────────────────────────────────
missing = true
;({ p, ctx } = await open())
ok('without 20260033 the card names the migration', /20260033_library_goals/.test(await body()))
ok('and the rest of the Tracker still draws', /Streak/i.test(await body()))
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
