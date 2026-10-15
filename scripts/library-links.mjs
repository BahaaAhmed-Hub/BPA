// node scripts/library-links.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 3b: where to read a book free, where to buy it in your country, and
// the buy-later flag. The fake PostgREST knows `to_buy` only once 20260028 has
// "run", and refuses it before — because the case that matters is a project
// that has not migrated, which must keep saving everything else.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const BOOK = '00000000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const T = {
  library_books: [{ id: BOOK, user_id: user.id, title: 'Rich Dad & Poor Dad #1', authors: ['Robert Kiyosaki'], isbn: '9781612680194', pages: 336, source: 'manual', status: 'want', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now }],
  library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [],
}
let migrated = true, refused = []
const known = () => 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at'.split(' ').concat(migrated ? ['to_buy'] : [])

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'en-GB' })
const json = (r, x, status = 200, h = {}) => r.fulfill({ status, contentType: 'application/json', headers: h, body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*' }
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  // A project that has not migrated has no such column to return.
  if (m === 'GET') return json(r, t === 'library_books' && !migrated ? T[t].map(({ to_buy: _x, ...rest }) => rest) : T[t])
  if (m === 'POST') {
    const rows = [].concat(JSON.parse(q.postData() || '[]'))
    if (t === 'library_books') for (const row of rows) for (const k of Object.keys(row)) if (!known().includes(k)) { refused.push(k); return json(r, { code: 'PGRST204', message: `Could not find the '${k}' column` }, 400) }
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') return json(r, [])
  return json(r, [])
})
await ctx.route('https://openlibrary.org/**', r => json(r, { docs: [{ key: '/works/OL9W', title: 'Deep Work', author_name: ['Cal Newport'], first_publish_year: 2016, isbn: ['9781455586691'] }, { key: '/works/OL9W', title: 'Rich Dad Poor Dad', author_name: ['Robert T. Kiyosaki'], ebook_access: 'borrowable', first_publish_year: 1997, isbn: ['9781612680194'] }] }, 200, cors))
await ctx.route('https://archive.org/**', r => json(r, { response: { docs: [] } }, 200, cors))
await ctx.route('https://gutendex.com/**', r => json(r, { results: [] }, 200, cors))
await ctx.route('https://www.googleapis.com/books/**', r => json(r, { items: [] }, 200, cors))
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, headers: cors, body: '' }))
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

// ── the pure module, from what the dev server serves ────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/bookLinks.ts')
  const prefs = await import('/BPA/src/modules/library/libraryPrefs.ts')
  const book = { title: 'Rich Dad & Poor Dad #1', authors: ['Robert Kiyosaki'], isbn: '978-1-61268-019-4' }
  const all = c => { const s = m.linksFor(book, c); return [...s.free, ...s.buy] }
  localStorage.setItem('library-settings', JSON.stringify({ enabled: true, country: 'EG' })); const eg = prefs.loadLibrarySettings()
  localStorage.setItem('library-settings', JSON.stringify({ enabled: true, country: 'egypt' })); const bad = prefs.loadLibrarySettings()
  localStorage.removeItem('library-settings')
  return {
    gb: m.linksFor(book, 'GB'), eg: m.linksFor(book, 'EG'), us: m.linksFor(book, 'US'), zz: m.linksFor(book, 'ZZ'), jp: m.linksFor(book, 'JP'),
    byTitle: m.linksFor({ title: 'Rich Dad & Poor Dad #1', authors: ['Robert Kiyosaki'] }, 'US'),
    hrefs: all('GB').map(l => l.href),
    defaults: [m.defaultCountry('en-GB'), m.defaultCountry('ar-EG'), m.defaultCountry('en'), m.defaultCountry('pt_BR'), m.defaultCountry('')],
    egName: m.countryName('EG'), codes: m.COUNTRY_CODES, eg2: eg, bad,
  }
})
const id = (s, k) => [...s.free, ...s.buy].find(l => l.id === k)
ok('Amazon follows the country', /amazon\.co\.uk\/s\?k=9781612680194/.test(id(u.gb, 'amazon').href) && /amazon\.eg\//.test(id(u.eg, 'amazon').href) && /amazon\.co\.jp\//.test(id(u.jp, 'amazon').href))
ok('a region Amazon has no store for falls back to .com and says it ships abroad', /amazon\.com\//.test(id(u.zz, 'amazon').href) && /Ships to many/.test(id(u.zz, 'amazon').note))
ok('the ISBN is used when there is one, punctuation stripped', /k=9781612680194/.test(id(u.us, 'amazon').href) && /isbn\/9781612680194/.test(id(u.us, 'openlibrary').href) && /isbn=9781612680194/.test(id(u.us, 'abebooks').href))
ok('and the title and author when there is not, encoded', /k=Rich%20Dad%20%26%20Poor%20Dad%20%231%20Robert%20Kiyosaki/.test(id(u.byTitle, 'amazon').href), id(u.byTitle, 'amazon').href)
ok('a & or # in a title cannot cut the query short', !/k=Rich Dad & /.test(id(u.byTitle, 'amazon').href) && !/[?&]k=[^&]*#/.test(id(u.byTitle, 'amazon').href))
ok('Bookshop.org only where it serves (US, GB)', !!id(u.gb, 'bookshop') && !!id(u.us, 'bookshop') && !id(u.eg, 'bookshop'))
ok('Jamalon only in its region (Egypt yes, UK no)', !!id(u.eg, 'jamalon') && !id(u.gb, 'jamalon'))
ok('Play Books is told the country', /gl=GB/.test(id(u.gb, 'play').href) && /gl=EG/.test(id(u.eg, 'play').href))
ok('five free, legal sources, and none is a "free pdf" site', u.gb.free.length === 5 && u.gb.free.map(l => l.id).join() === 'openlibrary,archive,gutenberg,googlebooks,worldcat')
ok('every link is https', u.hrefs.every(h => /^https:\/\//.test(h)))
ok('browser language gives the default region', u.defaults.join() === 'GB,EG,US,BR,US', u.defaults.join())
ok('region names come from Intl, not a table', u.egName === 'Egypt' && u.codes.includes('EG') && u.codes.length >= 20)
ok('a saved country is read back; a malformed one is dropped', u.eg2.country === 'EG' && u.bad.country === undefined && u.bad.enabled === true)

// ── the card ────────────────────────────────────────────────────────────────
await p.getByRole('button', { name: /Rich Dad & Poor Dad #1 by/ }).click(); await wait(1000)
const panel = p.getByRole('complementary')
ok('the panel has a Get it card, defaulting to the browser region (en-GB → United Kingdom)', /Buy in United Kingdom/.test(await panel.innerText()) && await panel.getByLabel('Country for buy links').inputValue() === 'GB')
const href = n => panel.getByRole('link', { name: n }).first().getAttribute('href')
ok('Amazon.co.uk searches the ISBN', /amazon\.co\.uk\/s\?k=9781612680194/.test(await href(/Amazon\.co\.uk/)))
await panel.getByRole('link', { name: /Open Library · Borrow/ }).waitFor({ timeout: 8000 })
ok('Open Library is offered because it was asked and has the book, and goes to the book', await href(/Open Library/) === 'https://openlibrary.org/works/OL9W')
ok('the sources that do not have it are NOT shown (Internet Archive, Gutenberg, Google Books, WorldCat)', await panel.getByRole('link', { name: /Internet Archive|Gutenberg|Google Books|library near you/ }).count() === 0)
ok('links open in a new tab without handing over the opener', await panel.getByRole('link', { name: /Open Library/ }).evaluate(a => a.target === '_blank' && /noopener/.test(a.rel) && /noreferrer/.test(a.rel)))
ok('and it says nothing here checks price or stock', /rices and stock are not checked/.test(await panel.innerText()))
await panel.getByLabel('Country for buy links').selectOption('EG'); await wait(300)
ok('choosing Egypt re-points the shops', /Buy in Egypt/.test(await panel.innerText()) && /amazon\.eg/.test(await href(/Amazon\.eg/)) && await panel.getByRole('link', { name: /Jamalon/ }).count() === 1 && await panel.getByRole('link', { name: /Bookshop/ }).count() === 0)
ok('and is remembered, with Library still on', await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('library-settings')); return s.country === 'EG' && s.enabled === true }))

// ── buy later (migrated) ────────────────────────────────────────────────────
await panel.getByRole('button', { name: /Buy later/ }).click(); await wait(1200)
ok('Buy later writes the flag', T.library_books[0].to_buy === true && refused.length === 0, JSON.stringify(refused))
ok('the pill says it is on the list', await panel.getByRole('button', { name: /On your buy list/ }).getAttribute('aria-pressed') === 'true')
await p.keyboard.press('Escape'); await wait(300)
ok('the shelf gets a To buy filter with its count', await p.getByRole('button', { name: /To buy 1/ }).count() === 1)

// Discover → Buy later
await p.getByRole('tab', { name: 'Discover' }).click(); await wait(300)
await p.getByLabel('Search online').fill('newport'); await wait(1500)
await p.getByRole('button', { name: 'Buy later: Deep Work' }).click(); await wait(1200)
const dw = T.library_books.find(x => x.title === 'Deep Work')
ok('Buy later on a search result adds it wanted and flagged', !!dw && dw.status === 'want' && dw.to_buy === true)
ok('and it is then on the shelf, not offered again', await p.getByRole('button', { name: 'On your shelf: Deep Work' }).count() === 1)

await p.getByRole('tab', { name: 'Shelf' }).click(); await wait(500)
await p.getByRole('button', { name: /To buy 2/ }).click(); await wait(400)
ok('the To buy filter narrows the shelf to flagged books', await p.getByRole('button', { name: /Deep Work by/ }).count() === 1 && await p.getByRole('button', { name: /Rich Dad/ }).count() === 1)
await p.getByRole('button', { name: /To buy 2/ }).click(); await wait(200)

// ── buy later when the migration has not run ────────────────────────────────
migrated = false; refused = []
await p.getByRole('button', { name: /Rich Dad & Poor Dad #1 by/ }).click(); await wait(900)
await panel.getByRole('button', { name: /On your buy list/ }).click(); await wait(1500)
ok('without 20260028 the server refuses the flag, by name', refused.includes('to_buy'), refused.join())
const rename = panel.getByLabel('Title', { exact: true }); await rename.fill('Rich Dad Poor Dad'); await rename.blur(); await wait(1500)
ok('but every other change still saves', T.library_books[0].title === 'Rich Dad Poor Dad' && !refused.slice(1).includes('title'))

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
