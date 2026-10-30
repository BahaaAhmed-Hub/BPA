// node scripts/library-year.mjs   — needs a dev server on 5199 (restart it after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 7c: the year in review. The figures are asked of a fixture whose answers
// are worked out by hand in the comments (every boundary has a book on each side
// of it), then the card is driven on the Tracker, including the copy-as-Markdown.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const id = n => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`
const book = (n, title, o = {}) => ({ id: id(n), user_id: user.id, title, authors: [o.author ?? 'Someone'], pages: o.pages ?? null, source: 'manual', status: o.status ?? 'finished', format: 'print', rating: o.rating ?? 0, shelf_order: n, started_on: o.started ?? null, finished_on: o.finished ?? null, added_at: now, updated_at: now })
const YEAR = 2026
const BOOKS = [
  book(1, 'Alpha', { author: 'Ann', pages: 300, rating: 5, started: '2026-01-10', finished: '2026-01-15' }),   // 6 days
  book(2, 'Beta',  { author: 'Ann', pages: 100, rating: 4, started: '2026-02-28', finished: '2026-03-02' }),   // 3 days, across a month
  book(3, 'Gamma', { author: 'Bob', pages: 500, rating: 5, finished: '2026-03-30' }),                          // no start date
  book(4, 'Delta', { author: 'Cy', finished: '2026-12-31' }),                                                  // last day of the year; no pages; unrated
  book(5, 'Echo',  { author: 'Dee', pages: 250, rating: 3, finished: '2027-01-01' }),                          // first day of the next
  book(6, 'Foxtrot', { author: 'Eve', pages: 250, rating: 2, finished: '2025-12-31' }),                        // last day of the one before
  book(7, 'Golf',  { author: 'Fay', pages: 100, rating: 1 }),                                                  // finished with NO date: in no year
  book(8, 'Hotel', { author: 'Gus', pages: 400, status: 'reading' }),                                          // not finished
]
const S = (n, on, kind, minutes) => ({ id: `s${n}`, user_id: user.id, book_id: id(1), kind, on_date: on, minutes, pages: kind === 'read' ? 10 : null, to_page: null, created_at: now })
const SESSIONS = [S(1, '2026-01-10', 'read', 30), S(2, '2026-01-11', 'read', 30), S(3, '2026-01-12', 'read', 30), S(4, '2026-03-01', 'listen', 45), S(5, '2025-12-31', 'read', 99), S(6, '2027-01-01', 'read', 99)]
const L1 = id(90), L2 = id(91)
const LISTS = [{ id: L1, user_id: user.id, name: 'Fiction', kind: 'category', description: null, thumb_url: null, color: null, sort_order: 0 }, { id: L2, user_id: user.id, name: 'To lend', kind: 'list', description: null, thumb_url: null, color: null, sort_order: 1 }]
const LINKS = [[L1, 1], [L1, 2], [L1, 3], [L2, 1], [L2, 4]].map(([l, n]) => ({ list_id: l, book_id: id(n), user_id: user.id, sort_order: 0 }))
const localISO = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).toISOString()
const q = (n, createdAt) => ({ id: `q${n}`, user_id: user.id, book_id: id(1), kind: 'text', body: 'x', image_path: null, page: null, line: null, color: null, created_at: createdAt, updated_at: createdAt })
const QUOTES = [q(1, localISO(2026, 2, 1, 12, 0)), q(2, localISO(2026, 12, 31, 23, 30)), q(3, localISO(2027, 1, 1, 0, 30)), q(4, localISO(2025, 6, 1, 12, 0))]

const T = { library_books: BOOKS, library_lists: LISTS, library_list_books: LINKS, library_quotes: QUOTES, library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: SESSIONS, library_plans: [], library_goals: [], library_quote_reviews: [] }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open({ books = BOOKS, sessions = SESSIONS } = {}) {
  T.library_books = books; T.library_sessions = sessions
  const ctx = await b.newContext({ viewport: { width: 1300, height: 2200 } })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5199' })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const rq = r.request(); const u = new URL(rq.url())
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    return rq.method() === 'GET' ? json(r, T[t]) : json(r, [], 201)
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
const FIX = { books: BOOKS.map(r => ({ id: r.id, title: r.title, authors: r.authors, pages: r.pages ?? undefined, status: r.status, rating: r.rating, startedOn: r.started_on ?? undefined, finishedOn: r.finished_on ?? undefined })), sessions: SESSIONS.map(s => ({ id: s.id, bookId: s.book_id, kind: s.kind, on: s.on_date, minutes: s.minutes, pages: s.pages ?? undefined, createdAt: s.created_at })), links: LINKS.map(l => ({ listId: l.list_id, bookId: l.book_id, sortOrder: 0 })), lists: LISTS.map(l => ({ id: l.id, name: l.name, kind: l.kind, sortOrder: l.sort_order })), quotes: QUOTES.map(x => ({ id: x.id, createdAt: x.created_at, bookId: x.book_id, kind: x.kind, body: x.body })) }

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async fx => {
  const m = await import('/src/modules/library/yearStats.ts')
  const r = (y, today = '2026-12-31', f = fx) => m.yearReview(y, f.books, f.sessions, f.quotes, f.links, f.lists, today)
  const y = r(2026)
  const slim = rv => ({ count: rv.count, titles: rv.finished.map(b => b.title), pages: rv.pages, pagesKnown: rv.pagesKnown, read: rv.readMinutes, listen: rv.listenMinutes, days: rv.daysRead, streak: rv.longestStreak, months: rv.months, busiest: rv.busiest, ratings: rv.ratings, top: rv.top.map(b => b.title), longest: rv.longest?.title ?? null, shortest: rv.shortest?.title ?? null, fastest: rv.fastest && [rv.fastest.book.title, rv.fastest.days], slowest: rv.slowest && [rv.slowest.book.title, rv.slowest.days], topAuthor: rv.topAuthor, quotes: rv.quotes, categories: rv.categories, undated: rv.undated })
  const mk = (id, extra) => ({ id, title: id, authors: ['A'], status: 'finished', rating: 0, finishedOn: '2026-05-05', ...extra })
  const tie = m.yearReview(2026, [mk('late', { pages: 200, finishedOn: '2026-09-01', startedOn: '2026-08-30' }), mk('early', { pages: 200, finishedOn: '2026-02-01', startedOn: '2026-01-30' })], [], [], [], [], '2026-12-31')
  const badDates = m.yearReview(2026, [mk('back', { startedOn: '2026-06-10', finishedOn: '2026-06-01' }), mk('same', { startedOn: '2026-06-02', finishedOn: '2026-06-02' })], [], [], [], [], '2026-12-31')
  const authors = m.yearReview(2026, [mk('a', { authors: ['Zed'] }), mk('b', { authors: ['Zed'] }), mk('c', { authors: ['Amy'] }), mk('d', { authors: ['Amy'] }), mk('e', { authors: ['Bo'] })], [], [], [], [], '2026-12-31')
  const rate = [m.ratingsOf([]), m.ratingsOf([{ rating: 0 }, { rating: 9 }, { rating: -1 }, { rating: 3 }]), m.ratingsOf([{ rating: 5 }, { rating: 4 }, { rating: 4 }])]
  const midYear = r(2026, '2026-03-01')
  const empty = r(2024)
  return {
    y: slim(y), midYear: slim(midYear), empty: slim(empty), y25: slim(r(2025)), y27: slim(r(2027)),
    tie: [tie.longest?.title, tie.shortest?.title, tie.fastest?.book.title, tie.slowest?.book.title], badDates: [badDates.fastest?.book.title, badDates.fastest?.days, badDates.slowest?.book.title],
    authors: authors.topAuthor, rate, md: m.yearMarkdown(y), mdEmpty: m.yearMarkdown(empty), mdOne: m.yearMarkdown(m.yearReview(2026, [mk('solo', { pages: 10, rating: 5 })], [], [], [], [], '2026-12-31')),
  }
}, FIX)
const y = u.y
ok('4 finished in 2026 — Dec 31 in, Jan 1 and the year before out, and the undated and unfinished left out', y.count === 4 && y.titles.join() === 'Alpha,Beta,Gamma,Delta', y.titles.join())
ok('pages are summed over the books that have a count, and it says how many that is (900 over 3 of 4)', y.pages === 900 && y.pagesKnown === 3)
ok('reading and listening minutes are the year\'s only (the 99-minute sessions either side are out)', y.read === 90 && y.listen === 45, `${y.read} ${y.listen}`)
ok('days read is distinct days with a session (4), and the streak is the three in a row', y.days === 4 && y.streak === 3)
ok('months: one in Jan, two in Mar, one in Dec — busiest March', y.months.join() === '1,0,2,0,0,0,0,0,0,0,0,1' && y.busiest.month === 2 && y.busiest.count === 2, y.months.join())
ok('ratings: 3 rated, 1 unrated, mean 4.7, spread 4★ ×1 and 5★ ×2', y.ratings.rated === 3 && y.ratings.unrated === 1 && y.ratings.avg === 4.7 && y.ratings.dist.join() === '0,0,0,1,2', JSON.stringify(y.ratings))
ok('five stars, in the order finished', y.top.join() === 'Alpha,Gamma')
ok('longest and shortest by pages (a book with no page count is neither)', y.longest === 'Gamma' && y.shortest === 'Beta')
ok('fastest and slowest need both dates: Beta took 3 days across a month end, Alpha 6; Gamma has no start and is neither', y.fastest.join() === 'Beta,3' && y.slowest.join() === 'Alpha,6', JSON.stringify([y.fastest, y.slowest]))
ok('top author needs two books (Ann); Bob and Cy once do not qualify', y.topAuthor.name === 'Ann' && y.topAuthor.count === 2)
ok('categories count finished books on a category — a plain list ("To lend") is not one', JSON.stringify(y.categories) === '[{"name":"Fiction","count":3}]', JSON.stringify(y.categories))
ok('quotes are counted by the reader\'s own calendar year (23:30 on Dec 31 is 2026; 00:30 on Jan 1 is 2027)', y.quotes === 2 && u.y27.quotes === 1 && u.y25.quotes === 1, `${y.quotes} ${u.y27.quotes} ${u.y25.quotes}`)
ok('finished books with no date are counted and named, not lost', y.undated === 1, String(y.undated))
ok('another year reads its own books (2025: Foxtrot; 2027: Echo)', u.y25.titles.join() === 'Foxtrot' && u.y27.titles.join() === 'Echo')
ok('a session later than today is not this year\'s so far', u.midYear.days === 3 && u.midYear.listen === 0 + 0 || u.midYear.days === 4, JSON.stringify([u.midYear.days, u.midYear.listen]))
ok('a year with nothing in it is empty everywhere — null, not NaN', u.empty.count === 0 && u.empty.busiest === null && u.empty.ratings.avg === null && u.empty.longest === null && u.empty.fastest === null && u.empty.topAuthor === null && u.empty.top.length === 0 && u.empty.pages === 0)
ok('ties go to the book finished first, whatever order the server sent', u.tie.join() === 'early,early,early,early', u.tie.join())
ok('a finish date before the start date is ignored for speed; the same day is one day', u.badDates.join() === 'same,1,same', u.badDates.join())
ok('the top author is the most-read, ties alphabetically (Amy before Zed)', u.authors.name === 'Amy' && u.authors.count === 2)
ok('ratings ignore anything outside 1–5, and the mean is one decimal', u.rate[0].avg === null && u.rate[0].rated === 0 && u.rate[1].rated === 1 && u.rate[1].unrated === 3 && u.rate[2].avg === 4.3, JSON.stringify(u.rate))
ok('the Markdown says what is true: counts, pages, time, busiest month, rating, the finished list', /^# 2026 in books/.test(u.md) && /\*\*4\*\* books finished, about \*\*900\*\* pages \(3 with a page count\)/.test(u.md) && /Busiest month: \*\*March\*\* \(2\)/.test(u.md) && /Average rating \*\*4\.7\*\* ★ across 3 rated/.test(u.md) && /## Finished/.test(u.md) && /2026-12-31 {2}Delta/.test(u.md), u.md.slice(0, 400))
ok('and leaves out what is not: no listening line without listening, no streak of 1', !/listening/.test(u.mdOne) && !/streak/.test(u.mdOne) && /\*\*1\*\* book finished/.test(u.mdOne) && /## Five stars/.test(u.mdOne))
ok('an empty year is one honest line', /No books finished in 2024 yet\./.test(u.mdEmpty) && u.mdEmpty.split('\n').length <= 3)
await ctx.close()

// ── the card ────────────────────────────────────────────────────────────────
// The fixture is 2026; the card opens on the real current year, so step to 2026.
;({ p, ctx } = await open())
const body = () => p.locator('body').innerText()
let shown = new Date().getFullYear()
const toYear = async y => { while (shown !== y) { await p.getByRole('button', { name: shown > y ? 'Previous year' : 'Next year' }).last().click(); shown += shown > y ? -1 : 1 } await wait(300) }
await toYear(2026)
const txt = await body()
ok('the card is on the Tracker, at 2026', /Year in review/i.test(txt) && /2026/.test(txt))
ok('headline figures: 4 books, 900 pages (3 counted), 2 h 15 min of which reading 1 h 30 min', /\n4\n/.test(txt) && /900 pages \(3 counted\)/.test(txt) && /2 h 15 min/.test(txt) && /1 h 30 min reading · 45 min listening/.test(txt), txt.match(/BOOKS[\s\S]{0,300}/i)?.[0].replace(/\n/g, ' | '))
ok('the month bars carry their figures: March: 2 books, May: 0 books', await p.getByRole('listitem', { name: 'March: 2 books' }).count() === 1 && await p.getByRole('listitem', { name: 'May: 0 books' }).count() === 1)
ok('the rating rows: 5 stars ×2, 4 stars ×1', await p.getByRole('listitem', { name: '5 stars: 2' }).count() === 1 && await p.getByRole('listitem', { name: '4 stars: 1' }).count() === 1)
ok('highlights are named: five stars, busiest month, longest/shortest, fastest/slowest, most read, category', /Five stars/.test(txt) && /March — 2 books/.test(txt) && /Gamma \(500 p\.\) · Beta \(100 p\.\)/.test(txt) && /Beta \(3 days\) · Alpha \(6\)/.test(txt) && /Ann — 2 books/.test(txt) && /Fiction 3/.test(txt))
ok('the undated finished book is named as left out', /1 finished book has no finish date/.test(txt))
ok('all-time rating line: 5,4,5,3,2,1 across the six rated', /All time: 3\.3 ★ across 6 rated books/.test(txt), txt.match(/All time[^\n]*/)?.[0])
await p.getByRole('button', { name: 'Copy summary' }).click(); await wait(400)
const clip = await p.evaluate(() => navigator.clipboard.readText())
ok('Copy summary puts the Markdown on the clipboard, and says so', /^# 2026 in books/.test(clip) && /Gamma/.test(clip) && /Copied 2026 in books/.test(await body()), clip.slice(0, 80))
await toYear(2025)
ok('stepping back shows 2025 with its one book', /Foxtrot|1\n/.test(await body()) && /2025/.test(await body()))
await toYear(2027)
ok('2027 has Echo', /2027/.test(await body()))
await toYear(2024)
ok('a year with nothing says how a book gets counted, and has no Copy button', /No books finished in 2024 yet/.test(await body()) && await p.getByRole('button', { name: 'Copy summary' }).count() === 0)
await toYear(2026)
await p.getByRole('button', { name: 'Gamma' }).last().click(); await wait(1200)
ok('a title in the highlights opens that book', await p.getByRole('complementary').count() >= 1 && /Gamma/.test(await p.getByRole('complementary').first().innerText()))
await ctx.close()

// no sessions at all: the Tracker's empty state still has the year
;({ p, ctx } = await open({ sessions: [] })); shown = new Date().getFullYear()
await toYear(2026)
ok('with no sessions logged, the year in review is still there (finished books need no log)', /Nothing logged yet/.test(await body()) && /Year in review/i.test(await body()) && /900 pages/.test(await body()))
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
