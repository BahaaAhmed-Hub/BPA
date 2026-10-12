// node scripts/library-discover.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 3a: Discover. Open Library and Google Books are faked (with the CORS
// headers the real ones send, or the browser would refuse the answer) and can
// each be switched off, because the interesting cases are the ones where a
// source is down or an author's key is not what it should be.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const BOOK = '00000000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const T = {
  library_books: [{ id: BOOK, user_id: user.id, title: 'Atomic Habits', authors: ['James Clear'], isbn: '9780735211292', pages: 320, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now }],
  library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [],
}
const KNOWN = 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at'.split(' ')
const seen = []; let olDown = false, gbDown = false, bad = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
const json = (r, x, status = 200, h = {}) => r.fulfill({ status, contentType: 'application/json', headers: h, body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*' }
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  if (m === 'GET') return json(r, T[t])
  if (m === 'POST') {
    const rows = [].concat(JSON.parse(q.postData() || '[]'))
    if (t === 'library_books') for (const row of rows) for (const k of Object.keys(row)) if (!KNOWN.includes(k)) { bad.push(k); return json(r, { code: 'PGRST204', message: `no ${k}` }, 400) }
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
  return json(r, [])
})

const OL_ATOMIC = { key: '/works/OL1W', title: 'Atomic Habits', author_name: ['James Clear'], first_publish_year: 2018, isbn: ['9780735211292'], cover_i: 11, number_of_pages_median: 320 }
const OL_DEEP = { key: '/works/OL2W', title: 'Deep Work', author_name: ['Cal Newport'], first_publish_year: 2016, isbn: ['9781455586691'], cover_i: 12, number_of_pages_median: 304 }
const OL_SGT = { key: '/works/OL3W', title: "So Good They Can't Ignore You", author_name: ['Cal Newport'], first_publish_year: 2012, cover_i: 13 }
await ctx.route('https://openlibrary.org/**', r => {
  const u = new URL(r.request().url()); seen.push(u.pathname + u.search)
  if (olDown) return r.fulfill({ status: 503, headers: cors, body: 'down' })
  if (u.pathname === '/search/authors.json') return json(r, { docs: [{ key: 'OL123A', name: 'Cal Newport', top_work: 'Deep Work', work_count: 12, birth_date: '1982' }] }, 200, cors)
  if ((u.searchParams.get('q') ?? '').startsWith('author_key:')) return json(r, { docs: [OL_DEEP, OL_SGT] }, 200, cors)
  return json(r, { docs: [OL_ATOMIC, OL_DEEP] }, 200, cors)
})
await ctx.route('https://www.googleapis.com/books/**', r => {
  seen.push('google')
  if (gbDown) return r.fulfill({ status: 503, headers: cors, body: 'down' })
  return json(r, { items: [
    { id: 'g1', volumeInfo: { title: 'Atomic Habits', authors: ['James Clear'], description: 'Tiny changes.', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780735211292' }] } },
    { id: 'g2', volumeInfo: { title: 'Digital Minimalism', authors: ['Cal Newport'], publishedDate: '2019-02-05', pageCount: 288 } },
  ] }, 200, cors)
})
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 200, contentType: 'image/gif', headers: cors, body: GIF }))

await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)
const text = () => p.locator('main').innerText()
const search = async v => { await p.getByLabel('Search online').fill(v); await wait(1500) }

await p.getByRole('tab', { name: 'Discover' }).click(); await wait(500)
ok('Discover opens with a prompt, and asks nothing yet', /Search the world/.test(await text()) && seen.length === 0)

// ── books ───────────────────────────────────────────────────────────────────
await search('newport')
ok('both catalogues are asked', seen.some(s => s.startsWith('/search.json')) && seen.includes('google'))
ok('Atomic Habits (in both sources) is one card, not two', await p.getByRole('button', { name: /Atomic Habits$/ }).count() === 1)
ok('a book already on the shelf says so (matched by ISBN)', await p.getByRole('button', { name: 'On your shelf: Atomic Habits' }).count() === 1 && await p.getByRole('button', { name: 'Want to read: Atomic Habits' }).count() === 0)
ok('one only Google knows still appears', await p.getByRole('button', { name: 'Want to read: Digital Minimalism' }).count() === 1)

await p.getByRole('button', { name: 'Want to read: Deep Work' }).click(); await wait(1500)
const dw = T.library_books.find(x => x.title === 'Deep Work')
ok('adding writes the book as want-to-read with its details', !!dw && dw.status === 'want' && dw.isbn === '9781455586691' && dw.source === 'openlibrary' && /covers\.openlibrary\.org\/b\/id\/12/.test(dw.cover_url ?? ''), JSON.stringify(dw)?.slice(0, 160))
ok('the server accepted every column sent', bad.length === 0, bad.join(','))
ok('the card turns into a receipt, so it cannot be added twice', await p.getByRole('button', { name: 'On your shelf: Deep Work' }).count() === 1 && T.library_books.length === 2)

// ── a source down ───────────────────────────────────────────────────────────
gbDown = true; await search('newport work');
ok('one source down is named, the other still answers', /Google Books could not be reached; showing the other/.test(await text()) && await p.getByRole('button', { name: /Deep Work/ }).count() >= 1)
olDown = true; await search('newport deep')
ok('both down says so rather than "nothing found"', /Could not reach the book catalogues/.test(await text()) && !/Nothing found/.test(await text()))
olDown = false; gbDown = false

// ── authors ─────────────────────────────────────────────────────────────────
await p.getByRole('tab', { name: 'Authors' }).click(); await wait(300)
ok('switching mode clears the old answers', await p.getByRole('button', { name: /Want to read/ }).count() === 0)
await search('cal newport')
ok('an author is a person with a best-known work', /Cal Newport/.test(await text()) && /Best known for “Deep Work”/.test(await text()) && /12 works/.test(await text()))
seen.length = 0
await p.getByRole('button', { name: /Cal Newport/ }).first().click(); await wait(1200)
ok('their books are fetched by the author\'s key, most-edited first', seen.some(s => s.includes('author_key%3AOL123A') && s.includes('sort=editions')), seen.join(' | '))
ok('and listed with a heading', await p.getByRole('heading', { name: 'Cal Newport' }).count() === 1 && await p.getByRole('button', { name: "Want to read: So Good They Can't Ignore You" }).count() === 1)
ok('a book of theirs already shelved shows as such', await p.getByRole('button', { name: 'On your shelf: Deep Work' }).count() === 1)
await p.getByRole('button', { name: /Authors/ }).first().click(); await wait(1200)
ok('back returns to the author list', /Best known for/.test(await text()) && await p.getByRole('heading', { name: 'Cal Newport' }).count() === 0)

// ── an author key is not free text ──────────────────────────────────────────
seen.length = 0
const unit = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/bookLookup.ts')
  const bad = await m.booksByAuthor('OL1A OR title:x')
  const empty = await m.searchAuthors('a')
  const books = [{ id: 'a', title: 'Atomic Habits: Tiny Changes!', authors: ['James Clear'] }, { id: 'b', title: 'Other', authors: ['X'], isbn: '123' }]
  return {
    bad, empty,
    byTitle: m.shelfMatch(books, { title: 'atomic habits tiny changes', authors: ['james clear'], source: 'google' })?.id,
    byIsbn: m.shelfMatch(books, { title: 'Different title', authors: ['Y'], isbn: '123', source: 'google' })?.id,
    none: m.shelfMatch(books, { title: 'Atomic Habits', authors: ['Someone Else'], source: 'google' })?.id ?? null,
  }
})
ok('a malformed author key asks nothing and returns nothing', unit.bad.length === 0 && seen.length === 0, seen.join(','))
ok('a one-letter author search asks nothing', unit.empty.length === 0)
ok('shelf matching ignores case and punctuation', unit.byTitle === 'a')
ok('and finds the same ISBN under another title', unit.byIsbn === 'b')
ok('and does not confuse two authors with one title', unit.none === null)

// ── opening a shelved result, and remembering the view ──────────────────────
await p.getByRole('tab', { name: 'Books' }).click(); await wait(300)
await search('newport')
await p.getByRole('button', { name: 'On your shelf: Atomic Habits' }).click(); await wait(1000)
ok('"On your shelf" opens that book on the shelf', await p.getByRole('complementary').count() === 1 && /James Clear/.test(await p.getByRole('complementary').innerText()))
await p.getByRole('tab', { name: 'Discover' }).click(); await wait(300)
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
ok('the view is remembered across a reload', await p.getByLabel('Search online').count() === 1)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
