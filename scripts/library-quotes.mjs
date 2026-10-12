// node scripts/library-quotes.mjs [missing]   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 2a: quotes, notes at every level, bookmarks. The server is an
// in-memory PostgREST that REFUSES what the real tables refuse — an unknown
// column, and a note or bookmark whose anchor is missing (the CHECKs in
// 20260026) — and cascades deletes the way the foreign keys do, so undo has
// something real to put back.
//   `missing`: 20260026 has not run (those tables answer 42P01).
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const MISSING = process.argv[2] === 'missing'
const BOOK = '00000000-0000-4000-8000-000000000001'
const T = {
  library_books: [{ id: BOOK, user_id: user.id, title: 'Deep Work', authors: ['Cal Newport'], pages: 296, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
  library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [],
}
const NEW = ['library_quotes', 'library_notes', 'library_bookmarks']
const KNOWN = {
  library_books: 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at'.split(' '),
  library_lists: 'id user_id name kind description thumb_url color sort_order created_at'.split(' '),
  library_list_books: 'list_id book_id user_id sort_order added_at'.split(' '),
  library_quotes: 'id user_id book_id kind body image_path page line color created_at updated_at'.split(' '),
  library_notes: 'id user_id scope book_id quote_id list_id page line body created_at updated_at'.split(' '),
  library_bookmarks: 'id user_id kind book_id quote_id page line label created_at'.split(' '),
}
// The CHECK constraints of 20260026, word for word.
const noteOk = n => (n.scope === 'book' && n.book_id) || (n.scope === 'quote' && n.quote_id) || (n.scope === 'list' && n.list_id)
  || (n.scope === 'page' && n.book_id && n.page != null) || (n.scope === 'line' && n.book_id && n.page != null && n.line != null)
const markOk = m => m.kind === 'book' || (m.kind === 'quote' && m.quote_id) || (m.kind === 'page' && m.page != null) || (m.kind === 'line' && m.page != null && m.line != null)
let refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
const cascade = (table, id) => {
  if (table === 'library_quotes') { T.library_notes = T.library_notes.filter(n => n.quote_id !== id); T.library_bookmarks = T.library_bookmarks.filter(m => m.quote_id !== id) }
  if (table === 'library_books') {
    const qs = T.library_quotes.filter(q => q.book_id === id).map(q => q.id)
    T.library_notes = T.library_notes.filter(n => n.book_id !== id && !qs.includes(n.quote_id))
    T.library_bookmarks = T.library_bookmarks.filter(m => m.book_id !== id); T.library_quotes = T.library_quotes.filter(q => q.book_id !== id)
    T.library_list_books = T.library_list_books.filter(l => l.book_id !== id)
  }
}
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  if (MISSING && NEW.includes(t)) return json(r, { code: '42P01', message: 'relation does not exist' }, 404)
  if (m === 'GET') return json(r, T[t])
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) {
      for (const k of Object.keys(row)) if (!KNOWN[t].includes(k)) { refused.push(`${t}.${k}`); return json(r, { code: 'PGRST204', message: `no column ${k}` }, 400) }
      if ((t === 'library_notes' && !noteOk(row)) || (t === 'library_bookmarks' && !markOk(row))) { refused.push(`${t} check`); return json(r, { code: '23514', message: 'check constraint' }, 400) }
    }
    const key = t === 'library_list_books' ? x => x.list_id + x.book_id : x => x.id
    for (const row of rows) { const i = T[t].findIndex(x => key(x) === key(row)); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') {
    const id = u.searchParams.get('id')?.replace(/^eq\./, '')
    if (id) { T[t] = T[t].filter(x => x.id !== id); cascade(t, id) }
    return json(r, [])
  }
  return json(r, [])
})
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

await p.getByRole('button', { name: /Deep Work by/ }).click(); await wait(900)
const panel = p.getByRole('complementary')

if (MISSING) {
  ok('quotes say what migration they need', await panel.getByText(/20260026_library_quotes/).count() > 0)
  ok('the quote form is not offered', await panel.getByLabel('New quote').count() === 0)
  ok('the book still opens and edits (the shelf is unaffected)', await panel.getByLabel('Your review').count() === 1)
  ok('favouriting is disabled rather than silently failing', await panel.getByRole('button', { name: 'Add to favourites' }).isDisabled())
  console.log(fails ? `\n${fails} failing` : '\nall good'); await b.close(); process.exit(fails ? 1 : 0)
}

// ── Quotes ──────────────────────────────────────────────────────────────────
await panel.getByLabel('New quote').fill('Clarity about what matters provides clarity about what does not.')
ok('line is unavailable until a page is given', await panel.getByLabel('Quote line (optional)').isDisabled())
await panel.getByLabel('Quote page (optional)').fill('42'); await panel.getByLabel('Quote line (optional)').fill('3')
await panel.getByRole('button', { name: 'Save quote' }).click(); await wait(600)
ok('a quote is saved with where it sits', T.library_quotes.length === 1 && T.library_quotes[0].page === 42 && T.library_quotes[0].line === 3 && T.library_quotes[0].body.startsWith('Clarity'))
await panel.getByLabel('New quote').fill('A second one, no page.')
await panel.getByRole('button', { name: 'Save quote' }).click(); await wait(500)
ok('a quote without a page has neither page nor line', T.library_quotes[1]?.page == null && T.library_quotes[1]?.line == null)
await panel.getByLabel('New quote').fill('Early in the book.'); await panel.getByLabel('Quote page (optional)').fill('7')
await panel.getByRole('button', { name: 'Save quote' }).click(); await wait(500)
const shown = await panel.locator('p', { hasText: '“' }).allInnerTexts()
ok('quotes are kept in the order of the book, unpaged last', shown[0]?.includes('Early') && shown[1]?.includes('Clarity') && shown[2]?.includes('second'), JSON.stringify(shown.map(s => s.slice(0, 12))))

const clarity = panel.locator('div', { has: p.locator('p', { hasText: 'Clarity about' }) }).last()
await panel.getByRole('button', { name: 'Edit this quote' }).nth(1).click()
await panel.getByLabel('Quote text').fill('Clarity matters.'); await wait(1300)
ok('an edit is held, then written', T.library_quotes.find(q => q.page === 42)?.body === 'Clarity matters.')
await panel.getByRole('button', { name: 'Colour 3' }).click(); await wait(500)
ok('a colour writes straight through', T.library_quotes.find(q => q.page === 42)?.color === 'var(--sb-cat-3)')
void clarity

// ── Bookmarks ───────────────────────────────────────────────────────────────
await panel.getByRole('button', { name: 'Bookmark this quote' }).nth(1).click(); await wait(500)
ok('bookmarking a quote writes one anchored to it', T.library_bookmarks.length === 1 && T.library_bookmarks[0].kind === 'quote' && T.library_bookmarks[0].quote_id === T.library_quotes.find(q => q.page === 42).id)
await panel.getByRole('button', { name: 'Remove bookmark' }).click(); await wait(500)
ok('un-bookmarking takes it back off the server', T.library_bookmarks.length === 0)
await panel.getByRole('button', { name: 'Add to favourites' }).click(); await wait(500)
ok('favouriting the book is a book bookmark', T.library_bookmarks.length === 1 && T.library_bookmarks[0].kind === 'book')

// ── Notes at every level ────────────────────────────────────────────────────
await panel.getByRole('button', { name: 'Add a note' }).nth(1).click()
await panel.getByLabel('Note on this quote').fill('Echoes Essentialism.'); await panel.getByLabel('Note on this quote').press('Enter'); await wait(500)
const qid = T.library_quotes.find(q => q.page === 42).id
ok('a note on a quote hangs off the quote', T.library_notes.some(n => n.scope === 'quote' && n.quote_id === qid && n.body === 'Echoes Essentialism.'))

await panel.getByLabel('New note').fill('Whole-book thought.'); await panel.getByRole('button', { name: 'Add note' }).click(); await wait(500)
ok('no page → a book note', T.library_notes.some(n => n.scope === 'book' && n.page == null && n.body === 'Whole-book thought.'))
await panel.getByLabel('New note').fill('About a page.'); await panel.getByLabel('Page (optional)', { exact: true }).fill('10'); await panel.getByRole('button', { name: 'Add note' }).click(); await wait(500)
ok('a page → a page note', T.library_notes.some(n => n.scope === 'page' && n.page === 10 && n.line == null))
await panel.getByLabel('New note').fill('About a line.'); await panel.getByLabel('Page (optional)', { exact: true }).fill('10'); await panel.getByLabel('Line (optional)', { exact: true }).fill('2'); await panel.getByRole('button', { name: 'Add note' }).click(); await wait(500)
ok('a page and a line → a line note', T.library_notes.some(n => n.scope === 'line' && n.page === 10 && n.line === 2))
ok('the server refused nothing the UI sent', refused.length === 0, refused.join(', '))

// The control: the fake really can refuse.
const bad = await p.evaluate(async ({ book }) => {
  const url = Object.keys(localStorage).length ? 'https://placeholder.supabase.co/rest/v1/library_notes' : ''
  const r = await fetch(url, { method: 'POST', body: JSON.stringify({ id: 'x', user_id: 'u', scope: 'line', book_id: book, body: 'no page', created_at: '', updated_at: '' }) })
  return r.status
}, { book: BOOK })
ok('control: a line note with no page is refused, as the real table would', bad === 400)
refused = []

const notesBefore = T.library_notes.length
await panel.getByRole('button', { name: 'Delete this note' }).first().click(); await wait(500)
ok('deleting a note removes it from the server', T.library_notes.length === notesBefore - 1)
await p.keyboard.press('Control+z'); await wait(800)
ok('undo puts the note back', T.library_notes.length === notesBefore)

// ── Cascades and undo ───────────────────────────────────────────────────────
await panel.getByRole('button', { name: 'Delete this quote' }).nth(1).click(); await wait(600)
ok('deleting a quote takes its notes and bookmarks with it (server cascade)', !T.library_quotes.some(q => q.id === qid) && !T.library_notes.some(n => n.quote_id === qid))
await p.keyboard.press('Control+z'); await wait(1000)
ok('undo restores the quote and its note', T.library_quotes.some(q => q.id === qid) && T.library_notes.some(n => n.quote_id === qid))

const counts = () => [T.library_quotes.length, T.library_notes.length, T.library_bookmarks.length].join('/')
const before = counts()
await panel.getByRole('button', { name: 'Delete this book' }).click(); await wait(700)
ok('deleting the book takes everything it carried', T.library_books.length === 0 && counts() === '0/0/0', counts())
await p.keyboard.press('Control+z'); await wait(1400)
ok('undo restores the book AND every quote, note and bookmark', T.library_books.length === 1 && counts() === before, `${counts()} vs ${before}`)
ok('nothing was refused along the way', refused.length === 0, refused.join(', '))

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
