// node scripts/library-shelf-photo.mjs   — needs a dev server on 5199 (restart it after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 6a: a photographed shelf becomes books. Claude vision is faked at
// api.anthropic.com (with CORS) and every way it can go wrong is driven: no key,
// a refused key, one piece of the photo failing, nothing readable, a reply that
// is not JSON, a file that is not an image. The tile geometry and the parsing /
// merging are asked pure questions; the REQUESTS are asserted, not just the pixels.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const book = (id, title, authors) => ({ id, user_id: user.id, title, authors, pages: 300, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now })
const T = { library_books: [book('00000000-0000-4000-8000-0000000000b1', 'Deep Work', ['Cal Newport'])], library_lists: [{ id: '00000000-0000-4000-8000-0000000000c1', user_id: user.id, name: 'History', kind: 'category', description: null, thumb_url: null, color: null, sort_order: 0 }], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [] }
let aiCalls = [], aiHandler = null, bookPosts = [], bookDeletes = [], listPosts = [], linkPosts = [], listDeletes = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } })
const json = (r, x, status = 200, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(x) })
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
    if (t === 'library_books') bookPosts.push(rows)
    if (t === 'library_lists') listPosts.push(...rows)
    if (t === 'library_list_books') linkPosts.push(...rows)
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (t === 'library_books') bookDeletes.push(id); if (t === 'library_lists') listDeletes.push(id); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
  return json(r, [])
})
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
await ctx.route('https://api.anthropic.com/**', async r => {
  const q = r.request()
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  const body = JSON.parse(q.postData() || '{}')
  const reply = text => json(r, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } }, 200, cors)
  // The app makes AI calls of its own (the Today screen); only the spine-reading ones are this test's business.
  if (!/read book spines/.test(JSON.stringify(body.system))) return reply('{}')
  const n = aiCalls.length; aiCalls.push(body)
  const out = aiHandler ? aiHandler(n, body) : null
  if (out?.status) return json(r, { type: 'error', error: { type: out.status === 401 ? 'authentication_error' : 'invalid_request_error', message: 'no' } }, out.status, cors)
  return reply(typeof out === 'string' ? out : JSON.stringify(out))
})
// Looking up covers is on by default: answer it with nothing found (library-shelf-enrich.mjs is the suite for that).
let olDocs = []
await ctx.route('https://openlibrary.org/**', r => json(r, { docs: olDocs }, 200, cors))
await ctx.route('https://www.googleapis.com/books/**', r => json(r, { items: [] }, 200, cors))
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('library-view', 'shelf')
  localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test' }))
} catch {} }, session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const t = await import('/BPA/src/modules/library/shelfTiles.ts')
  const s = await import('/BPA/src/modules/library/readShelf.ts')
  const covers = (w, h, rs) => {
    // every pixel column and row is inside some rect, and no rect leaves the image
    const inb = rs.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h && r.w > 0 && r.h > 0)
    const xs = new Set(), ys = new Set()
    for (const r of rs) { for (let x = r.x; x < r.x + r.w; x += 25) xs.add(Math.floor(x / 25)); for (let y = r.y; y < r.y + r.h; y += 25) ys.add(Math.floor(y / 25)) }
    return inb && xs.size >= Math.floor(w / 25) && ys.size >= Math.floor(h / 25)
  }
  const small = t.planTiles(800, 600), wide = t.planTiles(3600, 900), tall = t.planTiles(3000, 4500), huge = t.planTiles(5000, 5000), edge = t.planTiles(1000, 1000), over = t.planTiles(1001, 100)
  const overlap = rs => rs.slice(0, -1).every((r, i) => r.x + r.w > rs[i + 1].x)
  return {
    small, wideN: wide.length, wideCover: covers(3600, 900, wide), wideOverlap: overlap(wide),
    tallN: tall.length, tallCover: covers(3000, 4500, tall), hugeN: huge.length, hugeCover: covers(5000, 5000, huge),
    edge: edge.length, over: over.length, zero: [t.planTiles(0, 100), t.planTiles(100, 0), t.planTiles(NaN, 5)].map(x => x.length),
    sizes: wide.map(r => [r.w, r.h]),
    fenced: s.parseSpines('```json\n{"books":[{"title":"A","author":"B","sureness":"high"}],"unreadable":3}\n```'),
    prose: s.parseSpines('I see some books on a shelf.'),
    messy: s.parseSpines(JSON.stringify({ books: [{ title: '  Spaced   Out  ', author: '  ', sureness: 'certain' }, { title: '' }, { title: 5 }, null, 'str', { title: 'T'.repeat(500) }, { title: 'X', author: 'Y', sureness: 'medium' }], unreadable: -4 })),
    notBooks: s.parseSpines(JSON.stringify({ books: 'oops', unreadable: 'many' })),
    merged: s.mergeSpines([[{ title: 'Atomic Habits', sureness: 'low' }, { title: 'Dune', author: 'F. Herbert', sureness: 'high' }], [{ title: 'ATOMIC  habits!', author: 'James Clear', sureness: 'high' }, { title: 'dune', sureness: 'medium' }, { title: '!!!', sureness: 'high' }]]),
    cat: await (async () => { const c = await import('/BPA/src/modules/library/shelfCategories.ts'); return { hit: c.resolveCategory('history', ['History', 'Science']), punct: c.resolveCategory('self  help', ['Self-Help']), fresh: c.resolveCategory('  Biography ', ['History']), none: [c.resolveCategory('', ['A']), c.resolveCategory(undefined, ['A']), c.resolveCategory('!!!', ['A'])], names: c.newCategoryNames(['Biography', 'biography!', 'history', '', 'Economics'], ['History']) } })(),
    catParse: s.parseSpines(JSON.stringify({ books: [{ title: 'A', category: '  Self   Help ' }, { title: 'B', category: 'x'.repeat(100) }, { title: 'C', category: 5 }, { title: 'D', category: '   ' }] })).books.map(b => b.category ?? null),
    catMerge: s.mergeSpines([[{ title: 'Dune', sureness: 'low', category: 'Fiction' }], [{ title: 'Dune', sureness: 'high' }], [{ title: 'Emma', sureness: 'high' }], [{ title: 'Emma', sureness: 'medium', category: 'Classics' }]]).map(b => b.category ?? null),
    capped: s.mergeSpines([Array.from({ length: 400 }, (_, i) => ({ title: 'Book ' + i, sureness: 'high' }))]).length,
  }
})
ok('a photo that fits is one piece, whole', u.small.length === 1 && u.small[0].x === 0 && u.small[0].w === 800 && u.small[0].h === 600)
ok('a wide shelf is cut into columns that overlap, stay inside the photo and cover all of it', u.wideN === 4 && u.wideCover && u.wideOverlap, `${u.wideN} ${u.wideCover} ${u.wideOverlap}`)
ok('no piece is bigger than the model\'s sweet spot plus overlap', u.sizes.every(([w]) => w <= 1000 * 1.4), JSON.stringify(u.sizes))
ok('tall and huge photos are capped at twelve pieces and still cover everything', u.tallN <= 12 && u.tallCover && u.hugeN <= 12 && u.hugeCover, `${u.tallN} ${u.hugeN}`)
ok('exactly the edge is one piece; one pixel over is two', u.edge === 1 && u.over === 2)
ok('an empty or nonsense size is no pieces, not a crash', u.zero.join() === '0,0,0')
ok('parsing survives fences, counts what could not be read', u.fenced.books.length === 1 && u.fenced.books[0].author === 'B' && u.fenced.unreadable === 3)
ok('no JSON is no books, never an exception', u.prose.books.length === 0 && u.prose.unreadable === 0 && u.notBooks.books.length === 0 && u.notBooks.unreadable === 0)
ok('junk rows are dropped; spacing tidied; unknown sureness is "low"; long titles capped; a negative count is 0', u.messy.books.length === 3 && u.messy.books[0].title === 'Spaced Out' && u.messy.books[0].sureness === 'low' && !('author' in u.messy.books[0]) && u.messy.books[1].title.length === 200 && u.messy.books[2].sureness === 'medium' && u.messy.unreadable === 0, JSON.stringify(u.messy))
ok('the same spine read twice is one row: the surer reading wins, an author seen once is kept, punctuation and case ignored', u.merged.length === 2 && u.merged[0].sureness === 'high' && u.merged[0].author === 'James Clear' && u.merged[1].author === 'F. Herbert' && u.merged[1].sureness === 'high', JSON.stringify(u.merged))
ok('a title that is only punctuation is not a book', !u.merged.some(m => m.title === '!!!'))
ok('a shelf is capped at 300 rows', u.capped === 300)
ok('a category guess lands on the one you have, in your spelling — any case or punctuation', u.cat.hit?.name === 'History' && u.cat.hit.existing && u.cat.punct?.name === 'Self-Help' && u.cat.punct.existing)
ok('a new one is new, tidied; nothing, whitespace and punctuation-only are no category', u.cat.fresh?.name === 'Biography' && !u.cat.fresh.existing && u.cat.none.every(x => x === null))
ok('new names are listed once each, never one you already have', u.cat.names.join() === 'Biography,Economics', u.cat.names.join())
ok('a parsed category is tidied, capped at 40, and dropped if not text or blank', u.catParse.join('|') === 'Self Help|' + 'x'.repeat(40) + '||', JSON.stringify(u.catParse))
ok('merging keeps a category the surer reading lacks, and the surer one\'s when both have one', u.catMerge.join() === 'Fiction,Classics', u.catMerge.join())

// ── the dialog ──────────────────────────────────────────────────────────────
const png = (w, h, color = '#8a6f4d') => p.evaluate(async ({ w, h, color }) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1] }, { w, h, color }).then(s => Buffer.from(s, 'base64'))
const file = (buffer, name = 'shelf.png', mimeType = 'image/png') => ({ name, mimeType, buffer })
const dlg = () => p.getByRole('complementary', { name: 'Books from a shelf photo' })
const choose = async f => { await p.getByLabel('Choose a photo of a shelf').setInputFiles(f); await wait(2500) }
const close = async () => { if (await dlg().count()) { await p.keyboard.press('Escape'); await wait(300) } }
const reset = h => { aiCalls = []; aiHandler = h; bookPosts = []; bookDeletes = []; listPosts = []; linkPosts = []; listDeletes = [] }
const setKey = k => p.evaluate(key => { key ? localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: key })) : localStorage.removeItem('professor-ai-config') }, k)

const SHELF = { books: [
  { title: 'Atomic Habits', author: 'James Clear', sureness: 'high', category: 'Self-help' }, { title: 'Deep Work', author: 'Cal Newport', sureness: 'high', category: 'Self-help' },
  { title: 'Sapiens', author: null, sureness: 'medium', category: 'history' }, { title: 'Blurry Title', author: null, sureness: 'low', category: null },
], unreadable: 2 }
reset(() => SHELF)
ok('there is a Scan shelf button in the header', await p.getByRole('button', { name: 'Scan shelf' }).count() === 1)
await choose(file(await png(800, 600)))
ok('the dialog opens and the photo is sent once, as a JPEG image block with the spine-reading prompt', await dlg().count() === 1 && aiCalls.length === 1
  && aiCalls[0].messages[0].content[0].type === 'image' && aiCalls[0].messages[0].content[0].source.media_type === 'image/jpeg' && /read book spines/.test(JSON.stringify(aiCalls[0].system)),
  `calls=${aiCalls.length} dlg=${await dlg().count()} type=${aiCalls[0]?.messages?.[0]?.content?.[0]?.type} mt=${aiCalls[0]?.messages?.[0]?.content?.[0]?.source?.media_type} sys=${JSON.stringify(aiCalls[0]?.system).slice(0, 60)}`)
ok('the request tells the model which categories you have, and to use them exactly', /History/.test(JSON.stringify(aiCalls[0].system)) && /EXACTLY/.test(JSON.stringify(aiCalls[0].system)))
ok('four rows are listed', await dlg().getByRole('listitem').count() === 4)
ok('a clear one is ticked, a small-print one is ticked, an unsure one is not', await dlg().getByLabel('Add Atomic Habits').isChecked() && await dlg().getByLabel('Add Sapiens').isChecked() && !(await dlg().getByLabel('Add Blurry Title').isChecked()))
ok('a book already on the shelf says so and cannot be ticked', await dlg().getByLabel('Add Deep Work').isDisabled() && /Already on your shelf as “Deep Work”/.test(await dlg().innerText()))
ok('uncertainty is named on the row, not hidden', /Small print/.test(await dlg().innerText()) && /Not sure — check this one/.test(await dlg().innerText()))
ok('it says how many spines it could not read, and does not list them', /2 spines could not be read/.test(await dlg().innerText()))
ok('a category guess that matches yours is preselected in your spelling ("history" → History)', await dlg().getByLabel('Category 3').inputValue() === 'History')
ok('a new one is offered, labelled new, and preselected; no guess is "No category"', await dlg().getByLabel('Category 1').inputValue() === 'Self-help' && /Self-help \(new\)/.test(await dlg().getByLabel('Category 1').innerText()) && await dlg().getByLabel('Category 4').inputValue() === '')
ok('the dialog says what it will create before it does', /Makes 1 new category: Self-help\./.test(await dlg().innerText()), (await dlg().innerText()).match(/Makes[^\n]*/)?.[0])
ok('a book you already own gets no category picker', await dlg().getByLabel('Category 2').count() === 0)
await dlg().getByLabel('Sort into categories').uncheck(); await wait(200)
ok('turning sorting off removes the pickers and the promise to create anything', await dlg().getByLabel('Category 1').count() === 0 && !/Makes \d/.test(await dlg().innerText()))
await dlg().getByLabel('Sort into categories').check(); await wait(200)
ok('the button counts what will be added (2)', await dlg().getByRole('button', { name: 'Add 2 books' }).count() === 1)
await dlg().getByLabel('Add Blurry Title').check()
await dlg().getByLabel('Title 4').fill('Blurry Title Fixed'); await wait(200)
ok('ticking the unsure one and correcting its title makes three', await dlg().getByRole('button', { name: 'Add 3 books' }).count() === 1)
await dlg().getByLabel('Title 3').fill('deep work'); await dlg().getByLabel('Author 3').fill(''); await wait(200)
ok('editing a title into one you own flags it at once (back to two)', await dlg().getByRole('button', { name: 'Add 2 books' }).count() === 1 || /Already on your shelf/.test(await dlg().innerText()))
await dlg().getByLabel('Title 3').fill('Sapiens'); await wait(200)
await dlg().getByRole('button', { name: 'None' }).click(); await wait(100)
ok('None unticks everything and disables Add', await dlg().getByRole('button', { name: 'Add books' }).isDisabled())
await dlg().getByRole('button', { name: 'All' }).click(); await wait(100)
ok('All ticks everything that can be added (3; the duplicate stays out)', await dlg().getByRole('button', { name: 'Add 3 books' }).count() === 1)
await dlg().getByRole('tab', { name: 'Already read' }).click()
await dlg().getByRole('button', { name: 'Add 3 books' }).click(); await wait(2200)
ok('adding is ONE request carrying all three rows', bookPosts.length === 1 && bookPosts[0].length === 3, `${bookPosts.length} posts, ${bookPosts[0]?.length}`)
const rowsPosted = bookPosts[0] ?? []
ok('with the corrected titles, the author, and the status chosen', rowsPosted.map(r => r.title).sort().join('|') === 'Atomic Habits|Blurry Title Fixed|Sapiens' && rowsPosted.find(r => r.title === 'Atomic Habits')?.authors?.[0] === 'James Clear' && rowsPosted.every(r => r.status === 'finished'), JSON.stringify(rowsPosted.map(r => [r.title, r.status])))
ok('the dialog closed and the shelf has all four books', await dlg().count() === 0 && /4 books/.test(await p.locator('body').innerText()))
const newList = listPosts.find(l => l.name === 'Self-help')
ok('exactly one category was made (Self-help), as a category, and History was reused', listPosts.filter(l => l.kind === 'category').length === 1 && newList?.kind === 'category' && !listPosts.some(l => l.name === 'History' || l.name === 'history'), JSON.stringify(listPosts.map(l => l.name)))
const idOf = t => rowsPosted.find(r => r.title === t)?.id
ok('Atomic Habits is filed under the new one and Sapiens under History; the unsure one under nothing', linkPosts.some(l => l.book_id === idOf('Atomic Habits') && l.list_id === newList?.id) && linkPosts.some(l => l.book_id === idOf('Sapiens') && l.list_id === '00000000-0000-4000-8000-0000000000c1') && !linkPosts.some(l => l.book_id === idOf('Blurry Title Fixed')), JSON.stringify(linkPosts.map(l => l.list_id.slice(-4))))
await p.keyboard.press('Control+z'); await wait(1800)
ok('one undo takes back the books AND the category it had to make (History stays)', listDeletes.length === 1 && listDeletes[0] === newList?.id)
ok('one undo takes all three back off', /1 book\b/.test(await p.locator('body').innerText()) && bookDeletes.length === 3, `${bookDeletes.length} deletes`)

reset(() => SHELF)
await choose(file(await png(800, 600)))
await dlg().getByLabel('Sort into categories').uncheck()
await dlg().getByRole('button', { name: /^Add \d books?$/ }).click(); await wait(2000)
ok('with sorting off, no category is made and no link written', listPosts.length === 0 && linkPosts.length === 0 && bookPosts.length === 1, `${listPosts.length} ${linkPosts.length}`)
await p.keyboard.press('Control+z'); await wait(1500)

// ── pieces ──────────────────────────────────────────────────────────────────
const byTile = n => ({ books: [{ title: 'Overlap Book', sureness: n === 0 ? 'low' : 'high' }, { title: `Only in ${n}`, sureness: 'high' }], unreadable: 1 })
reset(byTile)
await choose(file(await png(3600, 900)))
ok('a wide photo is read in four pieces, one call each', aiCalls.length === 4, String(aiCalls.length))
ok('each piece is a JPEG no larger than the model\'s edge and names its part', aiCalls.every((c, i) => c.messages[0].content[0].source.media_type === 'image/jpeg' && new RegExp(`part ${i + 1} of 4`).test(c.messages[0].content[1].text)))
ok('the spine seen in the overlap is one row, plus one per piece (5)', await dlg().getByRole('listitem').count() === 5)
ok('unreadable spines are summed over the pieces', /4 spines could not be read/.test(await dlg().innerText()))
await dlg().getByRole('button', { name: /Read again/ }).click(); await wait(2500)
ok('Read again asks for the whole photo again', aiCalls.length === 8)
await close()

reset(n => (n === 1 ? { status: 400 } : byTile(n)))
await choose(file(await png(3600, 900)))
ok('one piece failing costs its piece: the others are listed and the screen says so', await dlg().getByRole('listitem').count() === 4 && /1 of 4 parts of the photo could not be read/.test(await dlg().innerText()), (await dlg().innerText()).slice(-300))
await close()

// ── several photos at once ─────────────────────────────────────────────────────
const two = async (n = 2, extra = []) => { const fs = []; for (let i = 0; i < n; i++) fs.push(file(await png(800, 600, i % 2 ? '#4d6f8a' : '#8a6f4d'), `shelf${i + 1}.png`)); return [...fs, ...extra] }
const chooseMany = async fs => { await p.getByLabel('Choose a photo of a shelf').setInputFiles(fs); await wait(3000) }
ok('the file picker takes several photos', await p.getByLabel('Choose a photo of a shelf').evaluate(el => el.multiple))
reset(n => ({ books: [{ title: 'Shared Book', sureness: 'high' }, { title: `Only in photo ${n + 1}`, sureness: 'high' }], unreadable: 1 }))
await chooseMany(await two(2))
ok('two photos are read as two parts, one call each, each named by its photo', aiCalls.length === 2 && /photo 1 of 2/.test(aiCalls[0].messages[0].content[1].text) && /photo 2 of 2/.test(aiCalls[1].messages[0].content[1].text), aiCalls.map(c => c.messages[0].content[1].text).join(' | '))
ok('both photos show in the panel', await dlg().locator('img[alt^="Shelf photo"]').count() === 2)
ok('one list comes out: the book in both photos is one row, plus one per photo (3)', await dlg().getByRole('listitem').count() === 3)
ok('unreadable spines are summed over both photos', /2 spines could not be read/.test(await dlg().innerText()))
await close()

reset(n => ({ books: [{ title: `Book ${n}`, sureness: 'high' }], unreadable: 0 }))
await chooseMany(await two(6))
ok('more than five photos: the first five are read, and it says what was left out', aiCalls.length === 5 && /Only the first 5 photos are read; 1 left out/.test(await dlg().innerText()), `${aiCalls.length} calls`)
await close()

reset(n => ({ books: [{ title: `Book ${n}`, sureness: 'high' }], unreadable: 0 }))
await chooseMany(await two(1, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') }]))
ok('a file that is not an image costs that file: the photo is still read, and the file is named', aiCalls.length === 1 && /notes\.txt is not an image/.test(await dlg().innerText()) && await dlg().getByRole('listitem').count() === 1)
await close()

reset(() => SHELF)
await chooseMany([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('y') }])
ok('when none of them is an image it is an error, and no call is made', aiCalls.length === 0 && /None of the 2 photos could be opened/.test(await dlg().innerText()))
await close()

// ── failures ────────────────────────────────────────────────────────────────
reset(() => ({ status: 401 }))
await choose(file(await png(3600, 900)))
ok('a refused key stops after the first piece (the others would be refused too) and points at Settings → AI', aiCalls.length === 1 && /Your Anthropic key was refused/.test(await dlg().innerText()) && await dlg().getByRole('listitem').count() === 0)
ok('and Add stays unavailable', await dlg().getByRole('button', { name: 'Add books' }).isDisabled())
await close()

reset(() => SHELF); await setKey(null)
await choose(file(await png(800, 600)))
ok('with no key it says where to put one, and sends nothing', aiCalls.length === 0 && /Anthropic key under Settings → AI/.test(await dlg().innerText()))
await close(); await setKey('sk-ant-test')

reset(() => ({ books: [], unreadable: 0 }))
await choose(file(await png(800, 600)))
ok('a shelf with nothing readable says so and offers the way out', /No readable titles were found/.test(await dlg().innerText()) && /by hand/.test(await dlg().innerText()))
await close()

reset(() => 'I can see a shelf with several books but I will not use JSON.')
await choose(file(await png(800, 600)))
ok('a reply that is not JSON is the same honest "nothing readable", not an error screen', /No readable titles were found/.test(await dlg().innerText()) && await dlg().getByRole('alert').count() === 0)
await close()

reset(() => SHELF)
await choose(file(Buffer.from('plain text, not a picture'), 'notes.txt', 'text/plain'))
ok('a file that is not an image is refused in words, with no call', /not an image/.test(await dlg().innerText()) && aiCalls.length === 0)
await close()

await choose(file(Buffer.from('this is not really a png'), 'broken.png', 'image/png'))
ok('a corrupt image is "could not be opened", with no call', /could not be opened/.test(await dlg().innerText()) && aiCalls.length === 0)
await close()

reset(() => SHELF)
await choose(file(await png(800, 600)))
await dlg().getByRole('button', { name: 'Cancel' }).click(); await wait(400)
ok('Cancel adds nothing', await dlg().count() === 0 && bookPosts.length === 0)
await choose(file(await png(800, 600)))
await p.keyboard.press('Escape'); await wait(300)
ok('and so does Escape', await dlg().count() === 0 && bookPosts.length === 0)

// ── the online lookup happens in the panel, and every field it fills can be changed ─────────
olDocs = [{ key: '/works/OL1W', title: 'Atomic Habits', author_name: ['James Clear'], first_publish_year: 2018, isbn: ['9780735211292'], cover_i: 7, number_of_pages_median: 320 }]
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="#c33"/></svg>' }))
reset(() => ({ books: [{ title: 'atomic habits', author: null, sureness: 'high' }, { title: 'Zzzz Unknown Thing', author: null, sureness: 'high' }], unreadable: 0 }))
await choose(file(await png(800, 600)))
await wait(1500)
ok('a matched book is filled in the panel: proper title, author and year, before anything is saved', await dlg().getByLabel('Title 1').inputValue() === 'Atomic Habits' && await dlg().getByLabel('Author 1').inputValue() === 'James Clear' && await dlg().getByLabel('Published 1').inputValue() === '2018' && bookPosts.length === 0)
ok('its cover is drawn from the catalogue', await dlg().locator('img[src*="covers.openlibrary.org"]').count() === 1)
ok('a book the catalogues do not know is left as read and says so', await dlg().getByLabel('Title 2').inputValue() === 'Zzzz Unknown Thing' && /No match online/.test(await dlg().innerText()))
await dlg().getByLabel('Published 1').fill('1999'); await dlg().getByLabel('Author 1').fill('J. Clear'); await wait(200)
// ── the footer is one aligned row, inside the panel, clear of the assistant's button ─────
for (const w of [900, 1280, 1400]) {
  await p.setViewportSize({ width: w, height: 900 }); await wait(400)
  const m = await dlg().evaluate(a => { const pr = a.getBoundingClientRect(); const fab = document.querySelector('[data-assistant-fab]')?.getBoundingClientRect()
    const box = re => { const b = [...a.querySelectorAll('button')].find(x => re.test(x.textContent)); const r = b?.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width } }
    return { pr: { bottom: pr.bottom, right: pr.right, left: pr.left }, fabTop: fab?.top ?? null, again: box(/Read again/), cancel: box(/^Cancel$/), add: box(/^Add/) } })
  const inside = r => r && r.left >= m.pr.left && r.right <= m.pr.right - 8
  ok(`all three buttons are whole and inside the panel at ${w}px`, inside(m.again) && inside(m.cancel) && inside(m.add), JSON.stringify(m))
  ok(`Cancel and Add are on ONE row, the same height, with a gap between them at ${w}px`, Math.abs(m.cancel.top - m.add.top) <= 1 && Math.abs(m.cancel.bottom - m.add.bottom) <= 1 && m.add.left - m.cancel.right >= 4 && m.add.left > m.cancel.right, JSON.stringify([m.cancel, m.add]))
  ok(`the panel ends above the assistant's button, so nothing is under it at ${w}px`, m.fabTop !== null && m.pr.bottom <= m.fabTop, `panel bottom ${m.pr.bottom} · button top ${m.fabTop}`)
}
await p.setViewportSize({ width: 1280, height: 1400 })
await dlg().getByRole('button', { name: /^Add \d books?$/ }).click(); await wait(1800)
const lk = (bookPosts[0] ?? []).find(r => r.title === 'Atomic Habits')
ok('what is saved is what the panel shows: the edited year and author, the cover, the ISBN and page count from the match', lk?.published_year === 1999 && lk?.authors?.[0] === 'J. Clear' && /covers\.openlibrary\.org/.test(lk?.cover_url ?? '') && lk?.isbn === '9780735211292' && lk?.pages === 320, JSON.stringify(lk))

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
