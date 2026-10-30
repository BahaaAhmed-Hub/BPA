// node scripts/library-reader.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 2b: upload a PDF, read it, bookmark a page, turn a selection into a
// quote that knows its page. The PDF is built here, byte by byte, so pdf.js
// really parses and draws it — a mocked renderer would prove nothing. The
// storage server refuses an upload outside the owner's own folder, as the
// bucket's policy does, and has a control that shows it.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

// ── A real three-page PDF (scripts/pdf-fixture.mjs) ─────────────────────────
import { PDF } from './pdf-fixture.mjs'

const BOOK = '00000000-0000-4000-8000-000000000001', BAD = '00000000-0000-4000-8000-000000000002'
const now = new Date().toISOString()
const mk = (id, title, extra = {}) => ({ id, user_id: user.id, title, authors: ['A. Writer'], pages: null, source: 'manual', status: 'reading', format: 'pdf', rating: 0, shelf_order: 0, added_at: now, updated_at: now, ...extra })
const T = { library_books: [mk(BOOK, 'Reader Test'), mk(BAD, 'Broken Copy', { file_path: `${user.id}/${BAD}/book.pdf`, shelf_order: 1 })], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [] }
const KNOWN = {
  library_books: 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at'.split(' '),
  library_quotes: 'id user_id book_id kind body image_path page line color created_at updated_at'.split(' '),
  library_bookmarks: 'id user_id kind book_id quote_id page line label created_at'.split(' '),
}
const markOk = m => m.kind === 'book' || (m.kind === 'quote' && m.quote_id) || (m.kind === 'page' && m.page != null) || (m.kind === 'line' && m.page != null && m.line != null)
const objects = { [`${user.id}/${BAD}/book.pdf`]: Buffer.from('this is not a pdf at all') }
let uploads = [], refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])

  // ── storage ───────────────────────────────────────────────────────────────
  const so = /\/storage\/v1\/object\/library(?:\/(.+))?$/.exec(u.pathname)
  if (so) {
    const path = decodeURIComponent(so[1] ?? '')
    if (m === 'POST' || m === 'PUT') {
      // The bucket policy: the first path segment must be the caller's own id.
      if (path.split('/')[0] !== user.id) { refused.push(`upload ${path}`); return json(r, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403) }
      const buf = q.postDataBuffer() ?? Buffer.alloc(0)
      const i = buf.indexOf('%PDF-'), j = buf.lastIndexOf('%%EOF')
      objects[path] = i >= 0 && j > i ? buf.subarray(i, j + 6) : buf
      uploads.push(path)
      return json(r, { Key: `library/${path}` })
    }
    if (m === 'GET') {
      if (!objects[path]) return json(r, { statusCode: '404', error: 'not_found', message: 'Object not found' }, 404)
      return r.fulfill({ status: 200, contentType: 'application/pdf', body: objects[path] })
    }
    if (m === 'DELETE') {
      const { prefixes = [] } = JSON.parse(q.postData() || '{}')
      for (const p of prefixes) delete objects[p]
      return json(r, prefixes.map(name => ({ name })))
    }
  }

  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  if (m === 'GET') return json(r, T[t])
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) {
      for (const k of Object.keys(row)) if (KNOWN[t] && !KNOWN[t].includes(k)) { refused.push(`${t}.${k}`); return json(r, { code: 'PGRST204', message: `no column ${k}` }, 400) }
      if (t === 'library_bookmarks' && !markOk(row)) { refused.push('bookmark check'); return json(r, { code: '23514', message: 'check' }, 400) }
    }
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
  return json(r, [])
})
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)
const inked = () => p.evaluate(() => {   // is anything dark drawn on the canvas?
  const c = document.querySelector('canvas'); if (!c) return -1
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 0) n++
  return n
})
const layerText = () => p.evaluate(() => document.querySelector('.lib-textlayer')?.textContent ?? '')

await p.getByRole('button', { name: /Reader Test by/ }).click(); await wait(900)
const panel = p.getByRole('complementary')

// ── Upload ──────────────────────────────────────────────────────────────────
ok('with no file, the card offers an upload and no reader', await panel.getByRole('button', { name: /Upload a PDF/ }).count() === 1 && await panel.getByRole('button', { name: /Open and read/ }).count() === 0)
await panel.getByLabel('Choose a PDF').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ not a pdf, just named like one') }); await wait(500)
ok('a file that is not a PDF is refused before any upload', await panel.getByRole('alert').innerText().then(t => /does not look like a PDF/.test(t)) && uploads.length === 0)
await panel.getByLabel('Choose a PDF').setInputFiles({ name: 'reader-test.pdf', mimeType: 'application/pdf', buffer: PDF }); await wait(1200)
ok('a real PDF uploads to <owner>/<book>/book.pdf', uploads.length === 1 && uploads[0] === `${user.id}/${BOOK}/book.pdf`, uploads[0])
ok('the book now points at its file', T.library_books.find(x => x.id === BOOK).file_path === `${user.id}/${BOOK}/book.pdf`)
ok('Open and read replaces Upload', await panel.getByRole('button', { name: /Open and read/ }).count() === 1)

// control: the bucket refuses somebody else's folder
const st = await p.evaluate(async () => (await fetch('https://placeholder.supabase.co/storage/v1/object/library/someone-else/x/book.pdf', { method: 'POST', body: 'x' })).status)
ok('control: an upload into another account\'s folder is refused', st === 403)
refused = []

// ── Read ────────────────────────────────────────────────────────────────────
await panel.getByRole('button', { name: /Open and read/ }).click(); await wait(2500)
ok('the reader opens on the book', await p.getByRole('dialog', { name: /Reading Reader Test/ }).count() === 1)
ok('page 1 is drawn: dark pixels on the canvas', (await inked()) > 200, String(await inked()))
ok('its words are in the text layer', /Alpha chapter opens here/.test(await layerText()), JSON.stringify((await layerText()).slice(0, 40)))
ok('the page count is read from the file', await p.getByRole('dialog').getByText('/ 3').count() === 1)
ok('a book with no length learns it from its file', T.library_books.find(x => x.id === BOOK).pages === 3)
const geom = await p.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(), s = document.querySelector('.lib-textlayer span')?.getBoundingClientRect(); return s ? { inside: s.left >= c.left - 1 && s.right <= c.right + 1 && s.top >= c.top - 1 && s.bottom <= c.bottom + 1, h: s.height } : null })
ok('the words sit over the canvas, at a real size', !!geom && geom.inside && geom.h > 8, JSON.stringify(geom))

await p.getByRole('button', { name: 'Next page' }).click(); await wait(1200)
ok('next page shows page 2', /Beta page two/.test(await layerText()))
ok('and it is drawn too', (await inked()) > 200)
await p.getByLabel('Page number').fill('3'); await p.getByLabel('Page number').press('Enter'); await wait(1200)
ok('typing a page number goes there', /Gamma closes/.test(await layerText()))
await p.getByLabel('Page number').fill('99'); await p.getByLabel('Page number').press('Enter'); await wait(800)
ok('a page past the end stops at the last', await p.getByLabel('Page number').inputValue() === '3')
await p.keyboard.press('ArrowLeft'); await wait(1000)
ok('the arrow key turns the page', /Beta page two/.test(await layerText()))

// ── Zoom ────────────────────────────────────────────────────────────────────
const w1 = await p.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width)
await p.getByRole('button', { name: 'Zoom in' }).click(); await wait(1200)
const w2 = await p.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width)
ok('zooming in makes the page wider', w2 > w1 * 1.1, `${Math.round(w1)} → ${Math.round(w2)}`)
await p.getByRole('button', { name: 'Zoom out' }).click(); await wait(800)

// ── Bookmarks ───────────────────────────────────────────────────────────────
await p.getByRole('button', { name: 'Bookmark this page' }).click(); await wait(500)
ok('a page bookmark is written with its page', T.library_bookmarks.some(x => x.kind === 'page' && x.page === 2 && x.book_id === BOOK))
await p.getByRole('button', { name: 'Next page' }).click(); await wait(900)
ok('the next page is not bookmarked', await p.getByRole('button', { name: 'Bookmark this page' }).count() === 1)
await p.getByRole('button', { name: 'Bookmarks and quotes' }).click()
await p.getByRole('menuitem', { name: /Page 2/ }).click(); await wait(1000)
ok('the list jumps to a bookmarked page', /Beta page two/.test(await layerText()))
await p.getByRole('button', { name: 'Remove the bookmark on this page' }).click(); await wait(500)
ok('removing it takes the row off the server', !T.library_bookmarks.some(x => x.kind === 'page'))

// ── Selection → quote with its page ─────────────────────────────────────────
ok('Save as quote is off with nothing selected', await p.getByRole('button', { name: /Save as quote/ }).isDisabled())
await p.evaluate(() => { const l = document.querySelector('.lib-textlayer'); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(l); s.addRange(r) }); await wait(400)
ok('selecting text enables it', await p.getByRole('button', { name: /Save as quote/ }).isEnabled())
await p.getByRole('button', { name: /Save as quote/ }).click(); await wait(600)
const q = T.library_quotes[0]
ok('the quote is filed with the page it came from', !!q && q.page === 2 && q.book_id === BOOK, JSON.stringify(q?.page))
ok('its words are the page\'s, joined into one line', !!q && /^Beta page two begins/.test(q.body) && !/\n/.test(q.body), JSON.stringify(q?.body))
ok('saving clears the selection and the button', await p.getByRole('button', { name: /Save as quote/ }).isDisabled())
await p.getByRole('button', { name: 'Bookmarks and quotes' }).click()
ok('the quote appears in the reader\'s list with its page', await p.getByRole('menuitem', { name: /p\. 2/ }).count() === 1)
await p.keyboard.press('Escape')   // closes the menu? no — the reader; assert below

// ── Resume, close, panel survives ───────────────────────────────────────────
await wait(500)
ok('Escape closes the reader and leaves the panel', await p.getByRole('dialog', { name: /Reading/ }).count() === 0 && await p.getByRole('complementary').count() === 1)
await p.getByRole('button', { name: /Open and read/ }).click(); await wait(2500)
ok('reopening resumes at the page you stopped on', await p.getByLabel('Page number').inputValue() === '2' && /Beta page two/.test(await layerText()))
await p.getByRole('button', { name: 'Close the reader' }).click(); await wait(400)

// ── Remove the file (asked twice) ───────────────────────────────────────────
await panel.getByRole('button', { name: /Remove file/ }).click()
ok('removing asks again and deletes nothing yet', !!objects[`${user.id}/${BOOK}/book.pdf`] && await panel.getByRole('button', { name: 'Yes, delete the file' }).count() === 1)
await panel.getByRole('button', { name: 'Keep it' }).click()
ok('Keep it backs out', !!T.library_books.find(x => x.id === BOOK).file_path)
await panel.getByRole('button', { name: /Remove file/ }).click(); await panel.getByRole('button', { name: 'Yes, delete the file' }).click(); await wait(800)
ok('confirming deletes the stored file', !objects[`${user.id}/${BOOK}/book.pdf`])
ok('and clears the book\'s pointer', T.library_books.find(x => x.id === BOOK).file_path == null)
ok('the upload offer is back', await panel.getByRole('button', { name: /Upload a PDF/ }).count() === 1)

// ── A file that is not a PDF is a message, not a crash ──────────────────────
await p.keyboard.press('Escape'); await wait(300)
await p.getByRole('button', { name: /Broken Copy by/ }).click(); await wait(900)
await p.getByRole('complementary').getByRole('button', { name: /Open and read/ }).click(); await wait(2500)
ok('a corrupt file says so in the reader', await p.getByRole('alert').filter({ hasText: /could not be opened/ }).count() === 1)
await p.getByRole('button', { name: 'Close the reader' }).click(); await wait(300)

ok('nothing the UI sent was refused', refused.length === 0, refused.join(', '))
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
