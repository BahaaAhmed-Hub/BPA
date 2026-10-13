// node scripts/library-daily-quote.mjs   — needs a dev server on 5199 (restart it after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 7a: a quote of the day on Today. The rotation is asked pure questions
// (the expected pick here is computed a DIFFERENT way, from the calendar date
// alone, so the module is not marking its own homework); the card is then driven
// on the real Today screen: shown, cycled, opening its book in a Library that has
// never been opened, and — as important — every reason it must draw nothing.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const book = (id, title, authors) => ({ id, user_id: user.id, title, authors, pages: 300, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now })
const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b2'
const quote = (id, bookId, body, createdAt, extra = {}) => ({ id, user_id: user.id, book_id: bookId, kind: body === null ? 'image' : 'text', body, image_path: body === null ? 'u/x.png' : null, page: null, line: null, color: null, created_at: createdAt, updated_at: createdAt, ...extra })
const QUOTES = [
  quote('q5', A, 'Third line', '2026-01-05T00:00:00Z'),            // deliberately out of order: the pick must not depend on it
  quote('q1', A, 'First line', '2026-01-01T00:00:00Z', { page: 7 }),
  quote('q3', B, null, '2026-01-03T00:00:00Z'),                   // a photographed page with no words typed
  quote('q2', B, 'Second line\nwith a second row', '2026-01-02T00:00:00Z'),
  quote('q4', B, '   ', '2026-01-04T00:00:00Z'),                  // blank
]
const POOL = ['First line', 'Second line\nwith a second row', 'Third line']      // eligible, in created order
const T = { library_books: [book(A, 'Alpha', ['Ann Author']), book(B, 'Bravo', [])], library_lists: [], library_list_books: [], library_quotes: QUOTES, library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [] }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' }
async function open({ quotes = QUOTES, settings = null, module = 'morning' } = {}) {
  T.library_quotes = quotes
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1500 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    return m === 'GET' ? json(r, T[t]) : json(r, [], 201)
  })
  await ctx.route('https://api.anthropic.com/**', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : json(r, { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } }, 200, cors))
  await ctx.route('**://*.googleapis.com/**', r => json(r, { items: [] }))
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(([s, st, mod]) => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
    if (st) localStorage.setItem('library-settings', JSON.stringify(st))
  } catch {} }, [session, settings, module])
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(5000)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)
const card = () => p.getByRole('figure', { name: 'Quote of the day' })

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/dailyQuote.ts')
  const Q = (id, body, createdAt) => ({ id, body, createdAt })
  const pool = [Q('c', 'C', '2026-01-03'), Q('a', 'A', '2026-01-01'), Q('b', 'B', '2026-01-02')]
  const mixed = [Q('x', null, '2026-01-01'), ...pool, Q('y', '   ', '2026-01-02'), Q('z', '', '2026-01-02')]
  const pick = (qs, d, s = 0) => m.quoteOfTheDay(qs, d, s)?.body ?? null
  const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']
  return {
    seq: days.map(d => pick(pool, d)), shuffled: days.map(d => pick([...pool].reverse(), d)),
    cycle: [pick(pool, '2026-10-10'), pick(pool, '2026-10-13')],
    mixed: days.map(d => pick(mixed, d)), none: [pick([], '2026-10-10'), pick([Q('x', null, 'a'), Q('y', '  ', 'b')], '2026-10-10')],
    single: [pick([Q('s', 'Only', 'a')], '2026-10-10'), pick([Q('s', 'Only', 'a')], '2026-10-11')],
    shift: [pick(pool, '2026-10-10', 1), pick(pool, '2026-10-10', 3), pick(pool, '2026-10-10', -1), pick(pool, '2026-10-10', -100), pick(pool, '2026-10-10', 1000001)],
    dst: ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26'].map(d => pick(pool, d)),
    year: ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map(d => pick(pool, d)),
    sorted: m.inOrder([Q('b2', 'x', '2026-01-01'), Q('b1', 'x', '2026-01-01'), Q('a', 'x', '2025-12-31')]).map(q => q.id),
    words: [m.hasWords({ body: 'x' }), m.hasWords({ body: '  ' }), m.hasWords({ body: undefined }), m.hasWords({ body: '' })],
  }
})
// An independent oracle: the position in the order is the number of days since 1970-01-01 (by calendar date, not by
// milliseconds) modulo the pool size. Counting days by civil date is DST-proof by construction.
const dayNo = iso => { const [y, mo, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, mo - 1, d) / 86400000) }
const expected = (iso, n = 3, shift = 0) => (((dayNo(iso) + shift) % n) + n) % n
ok('the pick is the day number modulo the pool, in created order', u.seq.every((v, i) => v === ['A', 'B', 'C'][expected(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'][i])]), u.seq.join())
ok('consecutive days walk the whole pool before any repeat, then come round', new Set(u.seq.slice(0, 3)).size === 3 && u.cycle[0] === u.cycle[1], u.seq.join())
ok('it does not depend on the order the server returned the quotes in', u.seq.join() === u.shuffled.join())
ok('blank, empty and photo-only quotes are never picked', u.mixed.join() === u.seq.join() && u.mixed.every(v => ['A', 'B', 'C'].includes(v)))
ok('no quotes with words is no pick, not a crash', u.none[0] === null && u.none[1] === null)
ok('a single quote is today\'s and tomorrow\'s', u.single.join() === 'Only,Only')
ok('Another steps on by one, wraps in both directions, and survives absurd presses', u.shift[0] === ['A', 'B', 'C'][expected('2026-10-10', 3, 1)] && u.shift[1] === u.seq[0] && u.shift[2] === ['A', 'B', 'C'][expected('2026-10-10', 3, -1)] && u.shift[3] && u.shift[4], u.shift.join())
ok('clock changes do not skip or repeat a day (both hemispheres\' changes)', [u.dst.slice(0, 3), u.dst.slice(3)].every(g => new Set(g).size === 3), u.dst.join())
ok('and the year turning is just another day', new Set(u.year.slice(0, 3)).size === 3 && u.year.every((v, i) => v === ['A', 'B', 'C'][expected(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'][i])]), u.year.join())
ok('ties on time break by id, so the order is the same everywhere', u.sorted.join() === 'a,b1,b2')
ok('what counts as words', u.words.join() === 'true,false,false,false')
await ctx.close()

// ── the card on Today ───────────────────────────────────────────────────────
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const shown = () => card().locator('blockquote').innerText()
;({ p, ctx } = await open())
const iso = todayIso(); const want = POOL[expected(iso)]
ok('Today shows one quote-of-the-day card', await card().count() === 1)
ok('with today\'s quote (an independent calculation), row breaks kept', (await shown()) === want, `${JSON.stringify(await shown())} vs ${JSON.stringify(want)}`)
const caption = await card().locator('figcaption').innerText().catch(() => '')
const wantBook = want === 'Second line\nwith a second row' ? 'Bravo' : 'Alpha'
ok('it names the book, then the author and page where there are some', caption.startsWith(wantBook) && (wantBook === 'Alpha' ? /Ann Author/.test(caption) : !/·/.test(caption)) && (want === 'First line' ? /p\. 7/.test(caption) : !/p\./.test(caption)), caption)
const seen = [await shown()]
for (let i = 0; i < 3; i++) { await card().getByRole('button', { name: 'Another quote' }).click(); await wait(150); seen.push(await shown()) }
ok('Another walks the three and comes back to today\'s', new Set(seen.slice(0, 3)).size === 3 && seen[3] === seen[0], JSON.stringify(seen))
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(5000)
ok('and is for the visit only: a reload is today\'s again', (await shown()) === want)

// Open the book, from a Library that has never been opened this session
const titleBtn = card().getByRole('button', { name: wantBook })
await titleBtn.click(); await wait(1500)
ok('clicking the title opens the Library with that book\'s panel open', await p.getByRole('complementary').count() >= 1 && new RegExp(wantBook).test(await p.getByRole('complementary').first().innerText()), await p.getByRole('complementary').count() + '')
await ctx.close()

// ── every reason it must draw nothing ───────────────────────────────────────
;({ p, ctx } = await open({ settings: { enabled: true, dailyQuote: false } }))
ok('switched off in Settings → Library: no card', await card().count() === 0)
await ctx.close()
;({ p, ctx } = await open({ settings: { enabled: false } }))
ok('the Library itself switched off: no card', await card().count() === 0)
await ctx.close()
;({ p, ctx } = await open({ quotes: [quote('i1', B, null, '2026-01-03T00:00:00Z'), quote('i2', A, '  ', '2026-01-04T00:00:00Z')] }))
ok('quotes but none with words: no card and no nag about it', await card().count() === 0 && !/save a quote|no quotes/i.test(await p.locator('body').innerText()))
await ctx.close()
;({ p, ctx } = await open({ quotes: [] }))
ok('no quotes at all: no card', await card().count() === 0)
await ctx.close()
;({ p, ctx } = await open({ quotes: [quote('only', A, 'Just the one', '2026-01-01T00:00:00Z')] }))
ok('one quote: shown, with nothing to cycle to (no Another button)', await card().count() === 1 && await card().getByRole('button', { name: 'Another quote' }).count() === 0)
await ctx.close()

// ── the setting ─────────────────────────────────────────────────────────────
;({ p, ctx } = await open())
const s = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/libraryPrefs.ts')
  const out = {}
  localStorage.removeItem('library-settings'); out.fresh = [m.loadLibrarySettings().dailyQuote, m.dailyQuoteWanted()]
  m.saveLibrarySettings({ enabled: true, dailyQuote: false }); out.off = [m.loadLibrarySettings().dailyQuote, m.dailyQuoteWanted(), localStorage.getItem('library-settings')]
  m.saveLibrarySettings({ enabled: true }); out.on = [m.loadLibrarySettings().dailyQuote, m.dailyQuoteWanted()]
  localStorage.setItem('library-settings', JSON.stringify({ enabled: true, dailyQuote: 'nope', country: 'EG' })); out.junk = [m.loadLibrarySettings().dailyQuote, m.loadLibrarySettings().country]
  localStorage.setItem('library-settings', JSON.stringify({ enabled: false, dailyQuote: true })); out.libOff = m.dailyQuoteWanted()
  return out
})
ok('unset means on; off is remembered; switching back on stores nothing', s.fresh[0] === undefined && s.fresh[1] === true && s.off[0] === false && s.off[1] === false && s.on[0] === undefined && s.on[1] === true)
ok('junk is read as "not said no"; the country is untouched by it', s.junk[0] === undefined && s.junk[1] === 'EG')
ok('with the Library off the quote is unwanted whatever it says', s.libOff === false)
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
