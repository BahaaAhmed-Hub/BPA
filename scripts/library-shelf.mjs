// node scripts/library-shelf.mjs [add|pick|lists|off]   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Phase 1 of the Library: a shelf you can add to, pick a book from, edit,
// delete from, shelve under a list — and switch off. The server is a small
// in-memory PostgREST (it has to be able to REFUSE: an unknown column is a 400,
// as the real one answers), and Open Library / Google Books are stubbed.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const MODE = process.argv[2] ?? 'all'
const tables = { library_books: [], library_lists: [], library_list_books: [] }
const KNOWN = {
  library_books: 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at'.split(' '),
  library_lists: 'id user_id name kind description thumb_url color sort_order created_at'.split(' '),
  library_list_books: 'list_id book_id user_id sort_order added_at'.split(' '),
}
let writes = 0, bad = null
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })

await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }, { module_id: 'tasks', label: 'Tasks', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (t in tables) {
    if (m === 'GET') return json(r, tables[t])
    if (m === 'POST') {
      const rows = JSON.parse(q.postData() || '[]'); const list = Array.isArray(rows) ? rows : [rows]
      for (const row of list) for (const k of Object.keys(row)) if (!KNOWN[t].includes(k)) { bad = `${t}.${k}`; return json(r, { code: 'PGRST204', message: `no column ${k}` }, 400) }
      writes++
      const key = t === 'library_list_books' ? x => x.list_id + x.book_id : x => x.id
      for (const row of list) { const i = tables[t].findIndex(x => key(x) === key(row)); if (i >= 0) tables[t][i] = { ...tables[t][i], ...row }; else tables[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') {
      writes++
      const id = u.searchParams.get('id'); const book = u.searchParams.get('book_id'); const lid = u.searchParams.get('list_id')
      const eq = s => s?.replace(/^eq\./, ''); const inn = s => s?.replace(/^in\.\(|\)$/g, '').split(',')
      tables[t] = tables[t].filter(x => {
        if (id) return x.id !== eq(id)
        if (book && lid) return !(x.book_id === eq(book) && inn(lid).includes(x.list_id))
        return true
      })
      return json(r, [])
    }
  }
  return json(r, [])
})
await ctx.route('https://openlibrary.org/**', r => json(r, { docs: [{ key: '/works/OL1W', title: 'Atomic Habits', author_name: ['James Clear'], first_publish_year: 2018, isbn: ['9780735211292'], cover_i: 1, number_of_pages_median: 320 }] }))
await ctx.route('https://www.googleapis.com/books/**', r => json(r, { items: [{ id: 'g1', volumeInfo: { title: 'Atomic Habits', authors: ['James Clear'], description: 'Tiny changes.', pageCount: 320, imageLinks: { thumbnail: 'http://books.google.com/x&zoom=1&edge=curl' } } }] }))
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }))
await ctx.route('https://books.google.com/**', r => r.abort())

await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── The module is reachable and says what it is ─────────────────────────────
ok('Library is in the top menu', await p.getByRole('button', { name: /^Library$/ }).count() > 0)
ok('an empty shelf says so', await p.getByText('Your shelf is empty').count() > 0)

// ── Add by searching ────────────────────────────────────────────────────────
await p.getByRole('button', { name: /Add book/ }).first().click()
await p.getByRole("complementary", { name: "Add a book" }).getByLabel('Search for a book').fill('atomic habits')
await p.waitForTimeout(1500)
const hit = p.getByRole("complementary", { name: "Add a book" }).getByRole('button', { name: /Atomic Habits/ }).first()
ok('searching finds the book', await hit.count() > 0)
await hit.click()
const titleVal = await p.getByRole("complementary", { name: "Add a book" }).locator('input').nth(1).inputValue()
ok('picking a result fills the form', titleVal === 'Atomic Habits', JSON.stringify(titleVal))
ok('both sources merged into one candidate', await p.getByRole("complementary", { name: "Add a book" }).getByRole('button', { name: /Atomic Habits/ }).count() === 1)
await p.getByRole('button', { name: 'Add to library' }).click(); await p.waitForTimeout(800)
ok('it is on the shelf', await p.getByRole('button', { name: /Atomic Habits by James Clear/ }).count() === 1)
ok('it reached the server, as one row', tables.library_books.length === 1 && tables.library_books[0].title === 'Atomic Habits')
ok('the cover came from the merged result', !!tables.library_books[0]?.cover_url)
ok('no write named a column the server does not have', bad === null, bad ?? '')

// ── Pick it: the panel opens, the real cover is there when the flight ends ──
await p.getByRole('button', { name: /Atomic Habits by James Clear/ }).click(); await p.waitForTimeout(900)
ok('picking opens its panel', await p.getByRole('complementary', { name: /Atomic Habits/ }).count() === 1)
ok('the slot it left is drawn empty', await p.locator('.lib-spine[data-picked]').count() === 1)
const vis = await p.locator('[data-book-cover-target]').evaluate(e => getComputedStyle(e).visibility)
ok('the real cover shows once the flight has landed', vis === 'visible', vis)

// ── Edit through: status, rating, a note typed and held ─────────────────────
const panel = p.getByRole('complementary')
await panel.getByRole('button', { name: 'Reading', exact: true }).click(); await p.waitForTimeout(500)
ok('status writes straight through', tables.library_books[0].status === 'reading')
ok('starting dates itself', !!tables.library_books[0].started_on)
await panel.getByRole('radio', { name: '4 stars' }).click(); await p.waitForTimeout(500)
ok('a rating writes straight through', tables.library_books[0].rating === 4)
await panel.getByLabel('Your review').fill('Small things compound.'); await p.waitForTimeout(1300)
ok('words are held, then written', tables.library_books[0].review === 'Small things compound.')
await panel.getByRole('button', { name: 'Finished', exact: true }).click(); await p.waitForTimeout(500)
ok('finishing dates itself', !!tables.library_books[0].finished_on)
await panel.getByRole('button', { name: 'Paused', exact: true }).click(); await p.waitForTimeout(500)
ok('coming off finished clears the date', tables.library_books[0].finished_on == null)

// ── Lists: create, shelve, filter ───────────────────────────────────────────
await p.getByRole('tab', { name: 'Lists' }).click(); await p.waitForTimeout(300)
await p.getByRole('button', { name: /New list/ }).click()
await p.getByRole('complementary', { name: 'New list' }).getByRole('textbox').first().fill('Summer reading')
await p.getByRole('button', { name: 'Create' }).click(); await p.waitForTimeout(700)
ok('a list is created and shows its count', await p.getByText('Summer reading').count() > 0 && await p.getByText('0 books').count() > 0)
ok('the list reached the server', tables.library_lists.some(l => l.name === 'Summer reading' && l.kind === 'list'))
await p.getByRole('tab', { name: 'Shelf' }).click(); await p.waitForTimeout(300)
// The panel is still docked beside the lists, and the picked book is inert on the shelf.
ok('the picked book stays inert while its panel is open', await p.locator('.lib-spine[data-picked]').count() === 1)
await p.getByRole('complementary').getByRole('button', { name: 'Summer reading' }).click(); await p.waitForTimeout(600)
ok('shelving a book writes the link', tables.library_list_books.length === 1)
await p.getByRole('tab', { name: 'Lists' }).click(); await p.waitForTimeout(300)
ok('the list now counts it', await p.getByText('1 book').count() > 0)

// ── Delete is undoable ──────────────────────────────────────────────────────
await p.getByRole('tab', { name: 'Shelf' }).click(); await p.waitForTimeout(300)
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
ok('Escape closes the panel and the book goes back on the shelf', await p.getByRole('complementary').count() === 0 && await p.locator('.lib-spine[data-picked]').count() === 0)
await p.getByRole('button', { name: /Atomic Habits by James Clear/ }).click(); await p.waitForTimeout(800)
await p.getByRole('button', { name: 'Delete this book' }).click(); await p.waitForTimeout(600)
ok('delete removes it from the shelf and the server', await p.getByRole('button', { name: /Atomic Habits by James Clear/ }).count() === 0 && tables.library_books.length === 0)
await p.keyboard.press('Control+z'); await p.waitForTimeout(900)
ok('undo brings it back, and its list with it', tables.library_books.length === 1 && tables.library_list_books.length === 1)

// ── The switch ──────────────────────────────────────────────────────────────
await p.evaluate(() => { localStorage.setItem('library-settings', JSON.stringify({ enabled: false })); window.dispatchEvent(new Event('professor:libraryPrefsChanged')) })
await p.waitForTimeout(600)
ok('switched off, it leaves the menu', await p.getByRole('button', { name: /^Library$/ }).count() === 0)
ok('and its screen is not drawn', await p.getByText('Your shelf').count() === 0)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
