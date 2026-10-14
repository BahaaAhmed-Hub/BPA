// node scripts/library-cover-change.mjs — needs a dev server on 5199
// Changing a book's cover from the panel: a picture of your own (made small, stored in the row), another edition's
// cover from the catalogues, and none at all. Read off what was POSTed to library_books.
import { chromium } from 'playwright-core'
import { deflateSync } from 'node:zlib'
import { session, user } from './session.mjs'

const png = (w, h, rgb) => { // a real PNG, built byte by byte
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
    let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())])
  const raw = Buffer.concat(Array(h).fill(row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const now = new Date().toISOString()
const ID = '00000000-0000-4000-8000-0000000000c1'
const books = [{ id: ID, user_id: user.id, title: 'Dune', authors: ['Frank Herbert'], pages: 600, source: 'manual', status: 'want', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, cover_url: null }]
const posts = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const json = (r, x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', r => { const q = r.request(), u = new URL(q.url()), t = u.pathname.split('/').pop()
  if (u.pathname === '/auth/v1/user') return json(r, user); if (u.pathname.startsWith('/auth/v1/token')) return json(r, session)
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  if (t === 'library_books') { if (q.method() === 'GET') return json(r, books); if (q.method() === 'POST') { for (const x of JSON.parse(q.postData() || '[]')) { posts.push(x); Object.assign(books[0], x) } return json(r, [], 201) } }
  return json(r, []) })
const olCover = 'https://covers.openlibrary.org/b/id/777-L.jpg'
await ctx.route('https://openlibrary.org/**', r => json(r, { docs: [{ key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'], cover_i: 777 }] }))
await ctx.route('https://www.googleapis.com/books/**', r => json(r, { items: [{ id: 'g1', volumeInfo: { title: 'Dune', authors: ['Frank Herbert'], imageLinks: { thumbnail: 'https://books.google.com/dune.jpg' } } }] }))
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: png(40, 60, [200, 40, 40]) }))
await ctx.route('https://books.google.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: png(40, 60, [40, 40, 200]) }))
await ctx.addInitScript(s => { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s)); localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 })) }, session)
const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', String(e).slice(0, 200)))
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.getByRole('button', { name: /^Dune by/ }).click({ timeout: 20000 })
const panel = p.getByRole('complementary')
ok('the Cover card is in the panel', await panel.getByText('Cover', { exact: true }).count() > 0)
ok('no cover yet, so no Remove button', await panel.getByRole('button', { name: /Remove cover/ }).count() === 0)

// 1. a picture of your own: a big PNG is made small and stored as a JPEG data address
await panel.getByLabel('Choose a cover picture').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: png(1600, 2400, [30, 160, 90]) })
await p.waitForFunction(() => document.querySelector('[data-book-cover-target] img')?.src.startsWith('data:image/jpeg'), null, { timeout: 8000 }).catch(() => {})
await p.waitForTimeout(1500)
const own = books[0].cover_url
ok('an uploaded picture is saved as a JPEG data address', typeof own === 'string' && own.startsWith('data:image/jpeg;base64,'))
ok('and it is small enough to live in the row (< 180k chars)', own && own.length <= 180000, String(own?.length))
const dims = await p.evaluate(u => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = u }), own)
ok('scaled to 520px on the long edge, shape kept', dims[1] === 520 && Math.abs(dims[0] / dims[1] - 2 / 3) < 0.01, dims.join('×'))
ok('the panel now shows it', await p.locator('[data-book-cover-target] img').count() === 1)

// 2. a file that is not a picture is refused and changes nothing
const before = posts.length
await panel.getByLabel('Choose a cover picture').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
await p.waitForTimeout(800)
ok('a text file is refused, with a sentence, and nothing is saved', await panel.getByText(/could not be used as a picture/).count() === 1 && posts.length === before)

// 3. another cover from the catalogues
await panel.getByRole('button', { name: /Other covers online/ }).click()
await panel.getByRole('group', { name: 'Other covers' }).waitFor({ timeout: 8000 })
const opts = await panel.getByRole('button', { name: 'Use this cover' }).count()
ok('other covers are offered (Open Library and Google), not the current one', opts === 2, String(opts))
await panel.getByRole('button', { name: 'Use this cover' }).first().click()
await p.waitForTimeout(1200)
ok('choosing one saves just that address', /^https:\/\/(covers\.openlibrary|books\.google)/.test(books[0].cover_url ?? ''), books[0].cover_url)
ok('and it changed only the cover (title, pages kept)', books[0].title === 'Dune' && books[0].pages === 600)

// 4. remove
await panel.getByRole('button', { name: /Remove cover/ }).click()
await p.waitForTimeout(1200)
ok('removing clears the cover (null, not left behind)', books[0].cover_url === null)
ok('the panel falls back to the title page', await p.locator('[data-book-cover-target] img').count() === 0)
ok('Remove disappears once there is none', await panel.getByRole('button', { name: /Remove cover/ }).count() === 0)

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
