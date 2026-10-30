// node scripts/library-scan.mjs   — needs a dev server on 5199, python3 + Pillow
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 3c: scanning a book's barcode. Chromium is given a real EAN-13 as its
// fake camera (scripts/make-barcode.py draws one from the standard's tables), so
// the ZXing path decodes actual bars off an actual video stream. The native
// `BarcodeDetector` path is covered with a stand-in, since headless Linux has no
// real one. Catalogues and Supabase are faked; the catalogues can be told that an
// ISBN is unknown or that they are down.
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { session, user } from './session.mjs'

const dir = mkdtempSync(join(tmpdir(), 'lib-scan-'))
const GOOD = '9781612680194'                 // Rich Dad Poor Dad — a valid ISBN-13
const NOT_BOOK = '5012345678900'             // a valid EAN-13 that is not an ISBN
for (const c of [GOOD, NOT_BOOK]) execSync(`python3 scripts/make-barcode.py ${c} ${dir}`)
execSync(`python3 - <<'PY'
from PIL import Image
im = Image.open("${dir}/${GOOD}.png"); im.rotate(90, expand=True).save("${dir}/sideways.png")
Image.new("RGB", (640, 480), "white").save("${dir}/blank.png")
PY`)

const T = { library_books: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [] }
const UNKNOWN = '9780306406157', OFFLINE = '9780140449136'
let lookups = []
const KNOWN = 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at to_buy'.split(' ')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: [
  '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${dir}/${GOOD}.y4m`] })
const json = (r, x, status = 200, h = {}) => r.fulfill({ status, contentType: 'application/json', headers: h, body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*' }

async function newPage(init = '') {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, permissions: ['camera'] })
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
      if (t === 'library_books') for (const row of rows) for (const k of Object.keys(row)) if (!KNOWN.includes(k)) return json(r, { code: 'PGRST204', message: k }, 400)
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    return json(r, [])
  })
  await ctx.route('https://openlibrary.org/**', r => {
    const u = new URL(r.request().url()); const q = u.searchParams.get('q') ?? ''
    lookups.push(q)
    const isbn = q.replace('isbn:', '')
    if (isbn === OFFLINE) return r.fulfill({ status: 503, headers: cors, body: '' })
    if (isbn === GOOD) return json(r, { docs: [{ key: '/works/OL1W', title: 'Rich Dad Poor Dad', author_name: ['Robert Kiyosaki'], first_publish_year: 1997, isbn: ['9781612680194', '9781612681139'] }] }, 200, cors)
    return json(r, { docs: [] }, 200, cors)
  })
  await ctx.route('https://www.googleapis.com/books/**', r => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? ''
    if (q.includes(OFFLINE)) return r.fulfill({ status: 503, headers: cors, body: '' })
    return json(r, { items: [] }, 200, cors)
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, headers: cors, body: '' }))
  await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'discover')
    // Every stream the page opens, so a test can ask whether it was let go.
    window.__streams = []
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
    if (gum) navigator.mediaDevices.getUserMedia = async c => { const s = await gum(c); window.__streams.push(s); return s }
  } catch {} }, session)
  if (init) await ctx.addInitScript(init)
  const p = await ctx.newPage()
  const requests = []
  p.on('request', r => requests.push(r.url()))
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx, requests }
}

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const open = async p => { await p.getByRole('button', { name: /Scan ISBN/ }).click(); await p.waitForTimeout(400) }
const dlg = p => p.getByRole('dialog', { name: 'Scan an ISBN' })
const streamsEnded = p => p.evaluate(() => window.__streams.length > 0 && window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended')))

// ── the pure module ─────────────────────────────────────────────────────────
{
  const { p, ctx } = await newPage()
  const u = await p.evaluate(async () => {
    const m = await import('/src/modules/library/isbn.ts')
    return { a: m.parseIsbn('978-1-61268-019-4'), b: m.parseIsbn(' 9781612680194 '), c: m.parseIsbn('1-61268-019-4'), bad: m.parseIsbn('9781612680195'), mag: m.parseIsbn('9771234567003'),
      ean: m.parseIsbn('5012345678900'), short: m.parseIsbn('12345'), x: m.parseIsbn('0-8044-2957-X'), x2: m.parseIsbn('080442957X'), empty: m.parseIsbn('') }
  })
  ok('a hyphenated ISBN-13 and a bare one are the same book', u.a === '9781612680194' && u.b === '9781612680194')
  ok('an ISBN-10 becomes its ISBN-13', u.c === '9781612680194', String(u.c))
  ok('an ISBN-10 ending in X is accepted', u.x === '9780804429573' && u.x2 === u.x, `${u.x}`)
  ok('a wrong check digit is refused', u.bad === null)
  ok('an EAN that is not a book (a magazine 977, a product) is refused', u.mag === null && u.ean === null)
  ok('short and empty input are refused', u.short === null && u.empty === null)
  await ctx.close()
}

// ── the live camera, ZXing reading real bars ────────────────────────────────
{
  const { p, ctx, requests } = await newPage('delete window.BarcodeDetector')
  await open(p)
  ok('the dialog opens with a live camera', await dlg(p).count() === 1 && await p.locator('video').count() === 1)
  await p.getByText('Rich Dad Poor Dad').first().waitFor({ timeout: 15000 }).catch(() => {})
  ok('it reads the barcode off the video and finds the book', await dlg(p).getByText('Rich Dad Poor Dad').count() >= 1 && /ISBN 9781612680194/.test(await dlg(p).innerText()))
  ok('by ISBN, the precise question', lookups.includes(`isbn:${GOOD}`), lookups.join('|'))
  ok('ZXing was loaded on demand to do it', requests.some(u => /zxing/.test(u)))
  const n = lookups.length
  await p.waitForTimeout(2500)
  ok('the scanner pauses on a result: the same book is not looked up again', lookups.length === n, `${lookups.length - n} extra`)
  ok('a scan never adds anything by itself', T.library_books.length === 0)
  await dlg(p).getByRole('button', { name: 'Want to read' }).click(); await p.waitForTimeout(1200)
  const bk = T.library_books[0]
  ok('Want to read shelves it, with the scanned edition\'s ISBN', !!bk && bk.isbn === GOOD && bk.status === 'want' && bk.title === 'Rich Dad Poor Dad')
  ok('and says so, counting the session', /Added to your shelf/.test(await dlg(p).innerText()) && /1 added/.test(await dlg(p).innerText()))
  await dlg(p).getByRole('button', { name: 'Scan next' }).click(); await p.waitForTimeout(3500)
  ok('scanning on finds it again — and now it is on the shelf', await dlg(p).getByRole('button', { name: /On your shelf/ }).count() === 1 && T.library_books.length === 1)
  await dlg(p).getByRole('button', { name: /On your shelf/ }).click(); await p.waitForTimeout(900)
  ok('opening it closes the scanner and opens the book', await dlg(p).count() === 0 && await p.getByRole('complementary').count() === 1)
  ok('the camera was let go', await streamsEnded(p))

  // typed
  await p.getByRole('tab', { name: 'Discover' }).click(); await p.waitForTimeout(500)
  await open(p)
  await dlg(p).getByLabel('Or type the ISBN').fill('9781612680195'); await dlg(p).getByRole('button', { name: 'Look up' }).click(); await p.waitForTimeout(300)
  ok('a mistyped ISBN says the check digit fails, and asks nothing', /check digit does not add up/.test(await dlg(p).innerText()) && !lookups.includes('isbn:9781612680195'))
  lookups = []
  await dlg(p).getByLabel('Or type the ISBN').fill(UNKNOWN); await dlg(p).getByRole('button', { name: 'Look up' }).click(); await p.waitForTimeout(1500)
  ok('an ISBN no catalogue knows says so', /No catalogue knows 9780306406157/.test(await dlg(p).innerText()))
  await dlg(p).getByRole('button', { name: 'Add it by hand' }).click(); await p.waitForTimeout(600)
  ok('and offers the Add form with the ISBN already in it', await p.getByLabel('ISBN').last().inputValue() === UNKNOWN, await p.getByLabel('ISBN').last().inputValue().catch(() => 'no field'))
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  await open(p)
  await dlg(p).getByLabel('Or type the ISBN').fill(OFFLINE); await dlg(p).getByRole('button', { name: 'Look up' }).click(); await p.waitForTimeout(1500)
  ok('catalogues down is not "unknown"', /could not be reached/.test(await dlg(p).innerText()) && !/No catalogue knows/.test(await dlg(p).innerText()))
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  ok('Escape closes it and the camera is let go', await dlg(p).count() === 0 && await streamsEnded(p))
  await ctx.close()
}

// ── no camera: a photo, or the number ───────────────────────────────────────
{
  const { p, ctx } = await newPage(`navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('no', 'NotAllowedError') }; delete window.BarcodeDetector`)
  await open(p)
  ok('a refused camera is explained, with the way round it', /camera was refused/.test(await dlg(p).innerText()) && await p.locator('video').count() === 0)
  const file = dlg(p).getByLabel('Choose a photo of a barcode')
  lookups = []
  await file.setInputFiles(join(dir, `${GOOD}.png`)); await p.waitForTimeout(3000)
  ok('a photo of the barcode is read', await dlg(p).getByText('Rich Dad Poor Dad').count() >= 1 && lookups.includes(`isbn:${GOOD}`))
  await dlg(p).getByRole('button', { name: 'Scan next' }).click()
  await file.setInputFiles(join(dir, 'sideways.png')); await p.waitForTimeout(3000)
  ok('and so is one taken sideways', await dlg(p).getByText('Rich Dad Poor Dad').count() >= 1)
  await dlg(p).getByRole('button', { name: 'Scan next' }).click()
  lookups = []
  await file.setInputFiles(join(dir, `${NOT_BOOK}.png`)); await p.waitForTimeout(3000)
  ok('a barcode that is not a book is not looked up', /No ISBN barcode could be read/.test(await dlg(p).innerText()) && lookups.length === 0)
  await file.setInputFiles(join(dir, 'blank.png')); await p.waitForTimeout(2500)
  ok('a photo with no barcode says so', /No ISBN barcode could be read/.test(await dlg(p).innerText()))
  await ctx.close()
}

// ── the browser's own detector, when it has one ─────────────────────────────
{
  const native = `window.__detects = 0; window.BarcodeDetector = class { static async getSupportedFormats() { return ['ean_13'] } constructor(o) { window.__formats = o.formats } async detect() { window.__detects++; return [{ rawValue: window.__detects < 3 ? '${NOT_BOOK}' : '${GOOD}' }] } }`
  const { p, ctx, requests } = await newPage(native)
  lookups = []; T.library_books.length = 0
  await open(p)
  await p.getByText('Rich Dad Poor Dad').first().waitFor({ timeout: 15000 }).catch(() => {})
  ok('the native detector is used, asked for EAN-13 only', await dlg(p).getByText('Rich Dad Poor Dad').count() >= 1 && (await p.evaluate(() => window.__formats)).join() === 'ean_13')
  ok('a non-book barcode seen first is passed over: one lookup, for the right one', lookups.length === 1 && lookups[0] === `isbn:${GOOD}`, lookups.join('|'))
  ok('and ZXing was never downloaded', !requests.some(u => /zxing/.test(u)))
  await ctx.close()
}
{
  const { p, ctx, requests } = await newPage(`window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code'] } async detect() { return [] } }`)
  await open(p)
  await p.waitForTimeout(2500)
  ok('a detector that cannot read EAN-13 is not trusted: ZXing takes over', requests.some(u => /zxing/.test(u)))
  await ctx.close()
}

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
