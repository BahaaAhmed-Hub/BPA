// A logo fills the circle it is drawn in — or it reads as a square in a hole.
//
// The report was a picture: a navy app mark sitting as a *square* inside the
// rail's circle, and a white wordmark as a little card. Both were `contain`
// plus a 10% pad inside a circular clip, which is the one arrangement that
// cannot look right — a mark's own ground stops at its edges and the tint
// shows round the corners.
//
// So this measures **what is drawn**, not what is stored: the tile is
// screenshotted, the PNG is decoded back inside the page, and the colour is
// read on a ring just inside the circle's rim. A DOM assertion cannot answer
// this question at all — `objectFit` and `padding` are the thing under test,
// and the whole point is what the pixels come to.
//
// The two grounds are opposite and both are asserted, which is the control
// pair: a mark **with** its own background fills the circle to the rim, and a
// cut-out **without** one must not — it keeps its air and the company's tint
// is what reaches the rim.
//
//   node scripts/company-logo-fills-the-circle.mjs [opaque|wide|cutout|control]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const MODE = process.argv[2] ?? 'opaque'
const U = user.id

const COMPANIES = [
  { id: 'co-teradix', name: 'Teradix Ltd',     color: '#3B82F6', users: [], calendarId: 'teradix-cal' },
  { id: 'co-dx',      name: 'DX Technologies', color: '#0C8140', users: [], accountId: 'acc-dx' },
]

// The mark's own background, and a glyph colour that is nothing like it.
const NAVY = [16, 24, 92]
const GOLD = [240, 200, 60]
const stored = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  let body = {}
  try { body = JSON.parse(q.postData() ?? '{}') } catch { /* not json */ }
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/companies')) {
    if (m === 'GET') return j(stored)
    if (m === 'POST' || m === 'PATCH') {
      for (const row of (Array.isArray(body) ? body : [body])) {
        const i = stored.findIndex(x => x.id === row.id)
        if (i >= 0) stored[i] = { ...stored[i], ...row }; else stored.push(row)
      }
      return j([])
    }
  }
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

await ctx.addInitScript(([s, cos]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: 'sunlit-bento' }, version: 0 }))
  if (!localStorage.getItem('professor-companies')) localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
} catch { /* quota */ } }, [session, COMPANIES])

const p = await ctx.newPage()
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6000)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const near = (a, b2, tol = 14) => a && b2 && Math.abs(a[0] - b2[0]) <= tol && Math.abs(a[1] - b2[1]) <= tol && Math.abs(a[2] - b2[2]) <= tol

/** The three shapes a real logo comes in. `wide` is the DX case: a mark and a
 *  wordmark on a white card, much wider than it is tall — the one that a crop
 *  would cut in half and a `contain` would leave as a stripe. */
async function logoFile(kind) {
  const f = await p.evaluate(async ([k, navy, gold]) => {
    const [w, h] = k === 'wide' ? [600, 200] : [256, 256]
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d')
    if (k === 'cutout') {
      g.clearRect(0, 0, w, h)                       // no ground at all
    } else if (k === 'wide') {
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h)
    } else {
      g.fillStyle = `rgb(${navy.join(',')})`; g.fillRect(0, 0, w, h)
    }
    // The mark itself, in the middle, well inside the edges.
    g.fillStyle = k === 'wide' ? '#111111' : `rgb(${gold.join(',')})`
    g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2); g.fill()
    const blob = await new Promise(res => c.toBlob(res, 'image/png'))
    return { name: `${k}.png`, buffer: Array.from(new Uint8Array(await blob.arrayBuffer())) }
  }, [kind, NAVY, GOLD])
  return { name: f.name, mimeType: 'image/png', buffer: Buffer.from(f.buffer) }
}

/** What is actually painted: screenshot the element, decode it back in the
 *  page, and read a ring just inside the circle's rim plus the centre. */
async function painted(selector) {
  const shot = (await p.locator(selector).screenshot()).toString('base64')
  return p.evaluate(async b64 => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(bmp, 0, 0)
    const mid = bmp.width / 2
    const at = (x, y) => { const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]] }
    // Twelve points on a ring at 0.42r — inside the circle, outside anything
    // a centred mark occupies.
    const ring = []
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ring.push(at(mid + Math.cos(a) * bmp.width * 0.42, mid + Math.sin(a) * bmp.width * 0.42))
    }
    return { size: bmp.width, centre: at(mid, mid), ring }
  }, shot)
}

/** The stored pixels, which say what the pipeline decided about the ground. */
const storedCorners = () => p.evaluate(() => new Promise(res => {
  const src = JSON.parse(localStorage.getItem('professor-companies') || '[]')
    .find(c => c.id === 'co-teradix')?.logoUrl
  if (!src) return res(null)
  const i = new Image()
  i.onload = () => {
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0)
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data)
    res({ w: i.width, h: i.height, tl: px(1, 1), tr: px(i.width - 2, 1), bl: px(1, i.height - 2), mid: px(i.width >> 1, i.height >> 1) })
  }
  i.src = src
}))

await p.getByText('Accounts & companies', { exact: true }).last().click()
await p.waitForTimeout(1000)
ok('the company cards are open', await p.locator('[data-logo-pick]').count() === 2)

const kind = MODE === 'cutout' ? 'cutout' : MODE === 'wide' ? 'wide' : 'opaque'
await p.locator('[data-logo-pick="co-teradix"] ~ input[type=file]').setInputFiles(await logoFile(kind))
await p.waitForTimeout(1800)

const corners = await storedCorners()
ok('the logo was stored', !!corners, JSON.stringify(corners?.w))
ok('as a square', corners?.w === 128 && corners?.h === 128, `${corners?.w}x${corners?.h}`)

const tile = await painted('[data-company-tile="co-teradix"]')
const ringColour = tile.ring[0]
const ringAgrees = tile.ring.every(c => near(c, ringColour, 20))

if (MODE === 'cutout') {
  // The case that must NOT change: with no ground of its own, a cut-out mark
  // keeps its air and the company's tint is what reaches the rim.
  ok('the stored corners are transparent', corners.tl[3] < 10, JSON.stringify(corners.tl))
  ok('and the mark is in the middle', near(corners.mid, GOLD, 24), JSON.stringify(corners.mid))
  ok('the rim is not the mark', !near(ringColour, GOLD, 40), JSON.stringify(ringColour))
  // It is the tint: pale, and bluer than it is red, this company being blue.
  ok('it is the company tint', ringColour[2] > ringColour[0] && ringColour[2] > 180,
     JSON.stringify(ringColour))
  await b.close(); process.exit(code)
}

// ─── a mark that brings its own ground ──────────────────────────────────────
const GROUND = kind === 'wide' ? [255, 255, 255] : NAVY
ok('the stored corners carry the mark\'s own ground', near(corners.tl, GROUND, 10) && corners.tl[3] > 250,
   JSON.stringify(corners.tl))
ok('on every side', near(corners.tr, GROUND, 10) && near(corners.bl, GROUND, 10),
   JSON.stringify([corners.tr, corners.bl]))

ok('the drawn ring is one colour all the way round', ringAgrees, JSON.stringify(tile.ring.slice(0, 3)))
ok('and it is the ground, so the circle is full', near(ringColour, GROUND, 20),
   `ring=${JSON.stringify(ringColour)} ground=${JSON.stringify(GROUND)}`)
ok('the mark itself is still in the middle', !near(tile.centre, GROUND, 30), JSON.stringify(tile.centre))

if (MODE === 'wide') {
  // Nothing was cropped: a 600x200 mark contained in a 128 box is 128 wide,
  // so its own ground has to make up the 85px of height — which is exactly
  // what the corners being white proves. The dark mark must survive whole.
  const span = await p.evaluate(() => new Promise(res => {
    const src = JSON.parse(localStorage.getItem('professor-companies') || '[]')
      .find(c => c.id === 'co-teradix').logoUrl
    const i = new Image()
    i.onload = () => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0)
      const row = g.getImageData(0, 64, 128, 1).data
      let dark = 0
      for (let x = 0; x < 128; x++) if (row[x * 4] < 90) dark++
      res(dark)
    }
    i.src = src
  }))
  // The circle is 0.3 of the short side = 60px across in a 600x200 source,
  // which lands near 13px once the width is fitted to 128.
  ok('the mark is drawn whole, not cropped', span > 6 && span < 40, `${span}px of mark across the middle`)
}

if (MODE === 'control') {
  // The arrangement that was shipped, restored on the very same element: a
  // 10% pad and `contain`. One property pair, and the rim stops being the
  // mark's ground — which is the square-in-a-circle that was reported.
  await p.evaluate(() => {
    const img = document.querySelector('[data-company-tile="co-teradix"] img')
    img.style.objectFit = 'contain'
    img.style.padding = '10%'
    img.style.boxSizing = 'border-box'
  })
  await p.waitForTimeout(300)
  const after = await painted('[data-company-tile="co-teradix"]')
  ok('padded again, the rim is no longer the mark', !near(after.ring[0], GROUND, 20),
     `ring=${JSON.stringify(after.ring[0])} ground=${JSON.stringify(GROUND)}`)
  ok('and the tint shows through at the rim instead',
     after.ring[0][2] > after.ring[0][0], JSON.stringify(after.ring[0]))
}

await b.close()
process.exit(code)
