// node scripts/assistant-library.mjs   — needs a dev server on 5199 (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// The assistant can work the user's shelf, by name, with the app's own rules. The database is a small
// in-memory PostgREST that RECORDS every write and refuses an unknown column; Open Library / Google Books
// are faked. Every claim is read off what was written, not off what the tool said.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id
const book = (id, title, authors, over = {}) => ({ id, user_id: U, title, subtitle: null, authors, isbn: null, publisher: null, published_year: null, pages: 300, language: null, description: null, cover_url: null, source: 'manual', source_key: null, status: 'want', format: 'print', rating: 0, review: null, spine_color: null, file_path: null, shelf_order: 0, started_on: null, finished_on: null, added_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over })
const list = (id, name, kind) => ({ id, user_id: U, name, kind, description: null, thumb_url: null, color: null, sort_order: 0 })
const T = {
  library_books: [book('00000000-0000-4000-8000-0000000000b1', 'Deep Work', ['Cal Newport'], { status: 'reading', pages: 300 }), book('00000000-0000-4000-8000-0000000000b2', 'Dune', ['Frank Herbert']), book('00000000-0000-4000-8000-0000000000b3', 'Dune Messiah', ['Frank Herbert'])],
  library_lists: [list('00000000-0000-4000-8000-0000000000c1', 'Fiction', 'category'), list('00000000-0000-4000-8000-0000000000c2', 'Summer reading', 'list')],
  library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [],
}
const writes = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', async r => { const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (t in T) {
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') { const rows = JSON.parse(q.postData() || '[]'); const l = Array.isArray(rows) ? rows : [rows]; writes.push({ t, op: 'upsert', rows: l })
      const key = t === 'library_list_books' ? x => x.list_id + x.book_id : x => x.id
      for (const row of l) { const i = T[t].findIndex(x => key(x) === key(row)); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201) }
    if (m === 'DELETE') { writes.push({ t, op: 'delete', q: u.search }); const id = u.searchParams.get('id')?.replace('eq.', ''); const bk = u.searchParams.get('book_id')?.replace('eq.', ''); const lid = u.searchParams.get('list_id')?.replace(/^in\.\(|\)$|^eq\./g, '').split(',')
      T[t] = T[t].filter(x => id ? x.id !== id : bk && lid ? !(x.book_id === bk && lid.includes(x.list_id)) : true); return json(r, []) }
  }
  return json(r, []) })
let olDocs = []
await ctx.route('https://openlibrary.org/**', r => json(r, { docs: olDocs }))
await ctx.route('https://www.googleapis.com/books/**', r => json(r, { items: [] }))
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
await ctx.addInitScript(s => { try { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 })) } catch {} }, session)
const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const tool = (name, input = {}) => p.evaluate(async ([name, input]) => { const t = await import('/BPA/src/lib/assistantTools.ts'); return t.executeTool(name, input, { primaryEmail: 'a@x.com', accounts: [], tasks: [], habits: [], addTask() {}, updateTask() {}, deleteTask() {} }) }, [name, input])
const wrote = () => writes.filter(w => w.op === 'upsert' && w.t === 'library_books').flatMap(w => w.rows)
const settle = () => p.waitForTimeout(900)

// read
let o = await tool('library_overview')
ok('overview: the shelf at a glance — counts, what is being read, categories and lists', o.total === 3 && o.by_status.reading === 1 && o.reading_now[0].title === 'Deep Work' && o.categories[0].name === 'Fiction' && o.lists[0].name === 'Summer reading', JSON.stringify(o).slice(0, 160))
let f = await tool('library_find_books', { query: 'herbert' })
ok('find: by author words', f.total === 2 && f.books.every(x => x.authors[0] === 'Frank Herbert'))
f = await tool('library_find_books', { status: 'reading' })
ok('find: by status', f.total === 1 && f.books[0].title === 'Deep Work')

// add: looked up strictly
olDocs = [{ key: '/works/OL1W', title: 'Atomic Habits', author_name: ['James Clear'], first_publish_year: 2018, isbn: ['9780735211292'], cover_i: 9, number_of_pages_median: 320 }]
writes.length = 0
let a = await tool('library_add_book', { title: 'atomic habits', author: 'James Clear', shelves: ['Summer reading'] }); await settle()
const added = wrote().find(x => x.title === 'Atomic Habits')
ok('add: a clear match fills the proper title, cover, year and pages', a.added && a.matched_online && added?.cover_url?.includes('covers.openlibrary.org') && added?.published_year === 2018 && added?.pages === 320, JSON.stringify(added))
ok('…and files it under the existing list', writes.some(w => w.t === 'library_list_books' && w.rows.some(r => r.list_id === '00000000-0000-4000-8000-0000000000c2')))
olDocs = []; writes.length = 0
a = await tool('library_add_book', { title: 'My Own Notes', status: 'reading' }); await settle()
const own = wrote().find(x => x.title === 'My Own Notes')
ok('add: no confident match → added as typed, with no invented cover; reading dates itself', a.added && !a.matched_online && own?.cover_url == null && own?.started_on === new Date().toLocaleDateString('en-CA'))
writes.length = 0
a = await tool('library_add_book', { title: 'Deep Work', author: 'Cal Newport' }); await settle()
ok('add: a book already on the shelf is not added twice', a.already_on_shelf === true && wrote().length === 0)
a = await tool('library_add_book', { title: 'Zed', shelves: ['Nonexistent'] }); await settle()
ok('add: a shelf name that does not exist is refused with the ones that do, and nothing is written', /no category or list called "Nonexistent"/.test(a.error) && /Fiction/.test(a.error) && wrote().length === 0)

// update
writes.length = 0
let u = await tool('library_update_book', { book: 'dune', status: 'finished', rating: 5 })
ok('update: "dune" is ambiguous (Dune, Dune Messiah?) — exact title wins', u.updated === true && u.book.title === 'Dune')
await settle()
const fin = wrote().find(x => x.id === '00000000-0000-4000-8000-0000000000b2')
ok('…finishing it dates it, and the rating is stored', fin?.status === 'finished' && fin?.finished_on === new Date().toLocaleDateString('en-CA') && fin?.rating === 5, JSON.stringify(fin && { s: fin.status, f: fin.finished_on, r: fin.rating }))
u = await tool('library_update_book', { book: 'mess' })
ok('update: nothing to change is refused', /Nothing to change/.test(u.error))
u = await tool('library_update_book', { book: 'D', rating: 3 })
ok('update: a name that matches several books is refused, with what matched', /matches \d+ books/.test(u.error) && /Deep Work/.test(u.error), u.error)
u = await tool('library_update_book', { book: 'Dune Messiah', rating: 9 })
ok('update: a rating outside 0–5 is refused', /0 to 5/.test(u.error))

// shelve
writes.length = 0
let s = await tool('library_shelve_book', { book: 'Dune Messiah', add_to: ['fiction'] }); await settle()
ok('shelve: by name, any case', s.shelved && s.shelves.includes('Fiction') && writes.some(w => w.t === 'library_list_books'))
s = await tool('library_shelve_book', { book: 'Dune Messiah', remove_from: ['Fiction'] }); await settle()
ok('shelve: remove', s.shelved && s.shelves.length === 0 && writes.some(w => w.t === 'library_list_books' && w.op === 'delete'))
let c = await tool('library_create_list', { name: 'Lend out', kind: 'list' }); await settle()
ok('create list: made, and a duplicate is refused', c.created && writes.some(w => w.t === 'library_lists' && w.rows?.some(r => r.name === 'Lend out')) && /already a category or list/.test((await tool('library_create_list', { name: 'lend OUT', kind: 'list' })).error))

// quote and reading
writes.length = 0
let q = await tool('library_add_quote', { book: 'Deep Work', text: 'Clarity about what matters provides clarity about what does not.', page: 42 }); await settle()
ok('quote: saved with its page', q.saved && writes.some(w => w.t === 'library_quotes' && w.rows.some(r => r.page === 42 && /Clarity/.test(r.body))))
writes.length = 0
let l = await tool('library_log_reading', { book: 'Deep Work', minutes: 30, to_page: 90 }); await settle()
ok('reading: a sitting is logged with the pages it covered', l.logged && writes.some(w => w.t === 'library_sessions' && w.rows.some(r => r.minutes === 30 && r.to_page === 90 && r.pages === 90)) && l.progress.page === 90 && l.progress.percent === 30, JSON.stringify(l.progress))
l = await tool('library_log_reading', { book: 'Deep Work', minutes: 10, to_page: 400 })
ok('reading: past the end of the book is refused, naming the page count', /300 pages/.test(l.error))
l = await tool('library_log_reading', { book: 'Deep Work', minutes: 10, date: '2999-01-01' })
ok('reading: a day that has not happened is refused', /has not happened/.test(l.error))
l = await tool('library_log_reading', { book: 'Deep Work', minutes: 5000 })
ok('reading: minutes outside 1–1440 are refused', /1 to 1440/.test(l.error))

// delete
writes.length = 0
let d = await tool('library_delete_book', { book: 'My Own Notes' }); await settle()
ok('delete: goes through the store (the server is told), and says undo is there', d.deleted && writes.some(w => w.op === 'delete' && w.t === 'library_books') && /Undo/.test(d.undo))

// switched off means off
await p.evaluate(() => localStorage.setItem('library-settings', JSON.stringify({ enabled: false })))
writes.length = 0
const off = await tool('library_add_book', { title: 'Should Not Land' }); await settle()
ok('Library switched off: refused in words, and nothing is written', /switched off/.test(off.error) && writes.length === 0, JSON.stringify(off))

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
