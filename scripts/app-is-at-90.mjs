/**
 * The whole app is drawn at 90% — not a setting, not a default.
 *
 *   node scripts/app-is-at-90.mjs 5199 [fixed|size|fills|drag|modal]
 *
 *   fixed  a brand-new address is at 0.9 from the first paint, and stays there
 *          after the account's preferences arrive — including an old
 *          `professor-compact` of "0" (the toggle that used to turn it off)
 *   size   what is drawn is 90% of what the same page draws at 100%, in real
 *          pixels (a screenshot of the same element both ways)
 *   fills  at 0.9 every main screen still reaches the bottom of the window and
 *          does not scroll sideways (zoom does not scale viewport units)
 *   space  the page's readings agree with each other: a rect's width is the element's
 *          own width, a pointer lands where the element is, hit-testing finds it
 *   calendar drawing a span on the week grid between two drawn hour lines opens an
 *          event at exactly those times
 *   popover a picker's list opens against its button, not 10% away from it
 *   dnd    an account row dragged below the next one (dnd-kit) lands there
 *   drag   a goal dragged to the top of the list lands there (pointer maths
 *          against a zoomed page)
 *   modal  the Add account window is centred in the window
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['fixed', 'size', 'fills', 'space', 'drag', 'modal', 'calendar', 'popover', 'dnd'].includes(a)) ?? 'fixed'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const acc = o => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const goal = o => ({ user_id: U, icon: 'lucide:Target', current_amount: 0, color: '#3366cc', sub: 'no deadline', rank: 0, deadline: null, currency: 'EGP', created_at: T0, ...o })
const DB = {
  finance_accounts: [
    acc({ id: 'p', name: 'CIB', account_type: 'payment', currency: 'EGP', balance: 160000 }),
    acc({ id: 'w', name: 'EGP Cash', account_type: 'wallet', currency: 'EGP', balance: 1715, sort_order: 2 }),
    acc({ id: 'l1', name: 'Baba Borrowed Money', account_type: 'loan', currency: 'EGP', balance: -150000, emoji: '🤝', sort_order: 1 }),
  ],
  finance_categories: [],
  finance_transactions: [],
  finance_goals: [
    goal({ id: 'g1', name: 'Laptop', target_amount: 30000, rank: 1 }),
    goal({ id: 'g2', name: 'Umrah', target_amount: 90000, rank: 2 }),
    goal({ id: 'g3', name: 'Car', target_amount: 400000, rank: 3 }),
  ],
}
// The account's saved preferences, with the old "compact: off" in them on purpose.
const USERROW = { id: U, email: session.user.email, schedule_rules: { shared_prefs: { 'professor-compact': '0', 'professor-accent': 'sky' } } }

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (m !== 'GET') {
    const body = JSON.parse(req.postData() ?? 'null')
    for (const row of [].concat(body ?? [])) { if (t === 'finance_goals') console.log('  [write goals]', row.name, 'rank', row.rank); const l = DB[t]; if (!l) continue; const i = l.findIndex(x => x.id === row.id); if (i >= 0) l[i] = { ...l[i], ...row }; else l.push(row) }
    return r.fulfill({ status: 201, json: [], headers: CORS })
  }
  if (t === 'users') return r.fulfill({ json: /object/.test(req.headers()['accept'] ?? '') ? USERROW : [USERROW], headers: CORS })
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0, 200)); failed++ })
await page.addInitScript(s => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('bpa-wizard-done', '1')
  localStorage.setItem('professor-compact', '0')   // what a device that once turned it off still holds
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
}, session)
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
const firstPaint = await page.evaluate(() => document.documentElement.style.zoom)
await settled(page, traffic, 9000)
const zoomNow = () => page.evaluate(() => document.documentElement.style.zoom)
const tab = name => page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name, exact: true }).click()
const until = async (cond, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise(r => setTimeout(r, 60)) } return cond() }

ok('the app is up (positive: the rail is on screen)', await page.locator('[data-side-rail]').count() > 0)
// CONTROL=100 draws the same page at 100% so a result can be told from the harness's own doing.
if (process.env.CONTROL === '100') { await page.evaluate(() => { document.documentElement.style.zoom = '' }); await new Promise(r => setTimeout(r, 400)) }
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

if (MODE === 'fixed') {
  ok('0.9 from the very first paint, before anything is fetched', firstPaint === '0.9', JSON.stringify(firstPaint))
  await new Promise(r => setTimeout(r, 1500))
  ok('…and after the account\'s preferences arrived (they say compact is "0")', (await zoomNow()) === '0.9', JSON.stringify(await zoomNow()))
  const stored = await page.evaluate(() => localStorage.getItem('professor-compact'))
  ok('…so the old setting is simply not read (it still says "0")', stored === '0', String(stored))
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
  ok('a reload is the same', (await zoomNow()) === '0.9')
}

if (MODE === 'size') {
  const rail = page.locator('[data-side-rail]').first()
  const at90 = await rail.screenshot().then(b => ({ b })).catch(() => null)
  const dims = async () => page.evaluate(async () => 0)   // placeholder keeps the shape explicit
  void dims
  const shot = async () => { const buf = await rail.screenshot(); const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); return { w, h } }
  const a = await shot()
  await page.evaluate(() => { document.documentElement.style.zoom = '' })
  await new Promise(r => setTimeout(r, 300))
  const b = await shot()
  console.log(`  rail: ${a.w}x${a.h}px at the app's size, ${b.w}x${b.h}px at 100%`)
  ok('the screenshot was taken both ways (positive)', !!at90 && b.w > 0 && a.w > 0)
  ok('drawn width is 90% of the 100% width (±1px)', Math.abs(a.w - b.w * 0.9) <= 1.5, `${a.w} vs ${(b.w * 0.9).toFixed(1)}`)
  ok('drawn height is 90% of the 100% height (±1px)', Math.abs(a.h - b.h * 0.9) <= 1.5, `${a.h} vs ${(b.h * 0.9).toFixed(1)}`)
}

if (MODE === 'fills') {
  const rows = []
  const measure = async label => {
    await new Promise(r => setTimeout(r, 700))
    const m = await page.evaluate(() => {
      const main = document.querySelector('main')
      const r = main?.getBoundingClientRect()
      return { innerH: innerHeight, innerW: innerWidth, bottom: r ? Math.round(r.bottom) : null, scrollW: document.documentElement.scrollWidth,
        scrollH: document.documentElement.scrollHeight, zoom: document.documentElement.style.zoom }
    })
    rows.push({ label, ...m })
  }
  for (const t of ['Today', 'Balance', 'Budget', 'Goals', 'Financials', 'Reports']) { await tab(t); await measure(`finance · ${t}`) }
  for (const mod of ['Calendar', 'Mail', 'Tasks', 'Habits', 'Settings']) {
    const b = page.locator(`[data-side-rail] button[aria-label="${mod}"]`)
    if (await b.count()) { await b.first().click(); await measure(mod) }
  }
  for (const r of rows) console.log(`  ${r.label.padEnd(20)} main bottom ${r.bottom} / window ${r.innerH}   scrollW ${r.scrollW} / ${r.innerW}   scrollH ${r.scrollH}`)
  ok('every screen was measured (positive)', rows.length >= 8, String(rows.length))
  ok('none scrolls sideways', rows.every(r => r.scrollW <= r.innerW + 1), JSON.stringify(rows.filter(r => r.scrollW > r.innerW + 1).map(r => r.label)))
  ok('every shell reaches the bottom of the window (within 3px)', rows.every(r => r.bottom !== null && Math.abs(r.innerH - r.bottom) <= 3), JSON.stringify(rows.filter(r => r.bottom === null || Math.abs(r.innerH - r.bottom) > 3).map(r => `${r.label}: ${r.bottom}/${r.innerH}`)))
}

if (MODE === 'space') {
  await tab('Balance')
  await page.getByText('PAYMENT ACCOUNTS').first().waitFor({ timeout: 8000 }).catch(() => {})
  // Probe: where a real pointer lands, as the page reports it, against where the element is.
  await page.evaluate(() => { window.__down = null; addEventListener('pointerdown', e => { window.__down = { x: e.clientX, y: e.clientY, t: e.target } }, true) })
  const target = page.getByRole('button', { name: /Add account/ }).first()
  const hit = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Add account/.test(x.textContent ?? '')); const g = b.getBoundingClientRect(); const e = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2); return !!e && (e === b || b.contains(e)) })
  const vis = await target.boundingBox()                         // the browser's own, scaled, box
  await page.mouse.click(vis.x + vis.width / 2, vis.y + vis.height / 2)
  await new Promise(r => setTimeout(r, 400))
  const r = await page.evaluate(() => {
    const el = window.__down?.t?.closest?.('button')
    const g = el?.getBoundingClientRect()
    return { down: window.__down && { x: window.__down.x, y: window.__down.y }, rect: g && { l: g.left, t: g.top, w: g.width, h: g.height },
      offsetW: el?.offsetWidth, innerW: innerWidth, innerH: innerHeight, scale: window.__zoomSpace ?? 1 }
  })
  console.log('  ', JSON.stringify(r))
  ok('a click was received on the button (positive)', !!r.down && !!r.rect, JSON.stringify(r))
  ok('the rect\'s width is the element\'s own width (layout units)', Math.abs(r.rect.w - r.offsetW) <= 0.6, `${r.rect.w.toFixed(1)} vs ${r.offsetW}`)
  ok('the pointer landed inside that rect, in the same units', r.down.x >= r.rect.l - 0.6 && r.down.x <= r.rect.l + r.rect.w + 0.6 && r.down.y >= r.rect.t - 0.6 && r.down.y <= r.rect.t + r.rect.h + 0.6, JSON.stringify([r.down, r.rect]))
  ok('the window is measured in the same units (1400/0.9 x 900/0.9)', Math.abs(r.innerW - 1400 / 0.9) <= 1 && Math.abs(r.innerH - 900 / 0.9) <= 1, `${r.innerW.toFixed(0)} x ${r.innerH.toFixed(0)}`)
  ok('hit-testing at a rect\'s centre finds that element', hit)
}

if (MODE === 'calendar') {
  await page.locator('[data-side-rail] button[aria-label="Calendar"]').first().click()
  await page.locator('[data-cal-cols]').first().waitFor({ timeout: 10000 })
  await new Promise(r => setTimeout(r, 800))
  // What is DRAWN: the box's top and its drawn scale (screen px per layout px), read from the browser, not from the app.
  const cols = page.locator('[data-cal-cols]').first()
  const box = await cols.boundingBox()
  const layoutH = await cols.evaluate(e => e.offsetHeight)
  const zf = box.height / layoutH
  const HOUR_PX = 64
  const yFor = min => box.y + (min / 60) * HOUR_PX * zf
  // A quarter-hour line that is actually inside the grid's visible part (about 300 drawn px from the top of the window).
  const startMin = Math.ceil(((300 - box.y) / zf / HOUR_PX) * 4) * 15
  const endMin = startMin + 60
  const x = box.x + (box.width / 7) * 1.5
  console.log(`  drawn scale ${zf.toFixed(3)}, grid top ${box.y.toFixed(1)}, drawing ${startMin}→${endMin} min`)
  ok('the drawn scale is what we asked for (positive)', Math.abs(zf - 0.9) < 0.01, zf.toFixed(3))
  await page.mouse.move(x, yFor(startMin) + 1)
  await page.mouse.down()
  await new Promise(r => setTimeout(r, 150))
  await page.mouse.move(x, yFor((startMin + endMin) / 2), { steps: 6 })
  await page.mouse.move(x, yFor(endMin) + 1, { steps: 6 })
  await new Promise(r => setTimeout(r, 100))
  await page.mouse.up()
  await page.locator('input[type="time"]').first().waitFor({ timeout: 6000 }).catch(() => {})
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 })
  const times = await page.locator('input[type="time"]').evaluateAll(els => els.map(e => e.value))
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  console.log('  composer times:', JSON.stringify(times), 'expected', hhmm(startMin), hhmm(endMin))
  ok('the composer opened with times (positive)', times.length >= 2, JSON.stringify(times))
  ok('it starts at the line it was pressed on', times[0] === hhmm(startMin), `${times[0]} vs ${hhmm(startMin)}`)
  ok('it ends at the line it was released on', times[1] === hhmm(endMin), `${times[1]} vs ${hhmm(endMin)}`)
}

if (MODE === 'popover') {
  await page.getByTitle('Add one entry').click()
  await page.getByRole('button', { name: 'Borrowed', exact: true }).waitFor({ timeout: 8000 })
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 })
  const pill = page.getByText('Account', { exact: true }).first().locator('xpath=following-sibling::*[1]')
  await pill.waitFor({ timeout: 5000 }).catch(() => {})
  const pb = await pill.boundingBox().catch(() => null)
  ok('the picker button was found (positive)', !!pb)
  if (pb) {
    await pill.click()
    await new Promise(r => setTimeout(r, 400))
    // The list that opened: a fixed element that was not there before and lists the accounts.
    const list = await page.evaluate(() => {
      const c = [...document.querySelectorAll('div')].filter(d => getComputedStyle(d).position === 'fixed' && /CIB|Cash/.test(d.textContent ?? '') && d.children.length > 1 && d.getBoundingClientRect().width < 500)
      const d = c.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]
      if (!d) return null
      // the BROWSER's drawn box, not the page's reading of it
      return { top: d.getBoundingClientRect().top, left: d.getBoundingClientRect().left }
    })
    ok('a list opened (positive)', !!list)
    if (list) {
      const lb = await page.evaluate(() => {
        const c = [...document.querySelectorAll('div')].filter(d => getComputedStyle(d).position === 'fixed' && /CIB|Cash/.test(d.textContent ?? '') && d.children.length > 1 && d.getBoundingClientRect().width < 500)
        const d = c.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]
        d.setAttribute('data-probe-list', '1'); return true
      })
      void lb
      const drawn = await page.locator('[data-probe-list="1"]').boundingBox()
      console.log(`  button ${JSON.stringify([pb.x, pb.y, pb.width, pb.height].map(Math.round))}  list ${JSON.stringify([drawn.x, drawn.y].map(Math.round))}`)
      ok('the list is drawn against the button horizontally (±4px)', Math.abs(drawn.x - pb.x) <= 4, `${Math.round(drawn.x)} vs ${Math.round(pb.x)}`)
      const gap = drawn.y - (pb.y + pb.height)
      const above = (pb.y - (drawn.y + drawn.height))
      ok('…and directly below it or directly above it (within 14px)', (gap >= -2 && gap <= 14) || (above >= -2 && above <= 14), `below gap ${gap.toFixed(1)}, above gap ${above.toFixed(1)}`)
    }
  }
}

if (MODE === 'dnd') {
  await tab('Balance')
  await page.getByText('PAYMENT ACCOUNTS').first().waitFor({ timeout: 8000 })
  const names = () => page.evaluate(() => [...document.querySelectorAll('[role="button"][title^="Show only"]')].map(e => e.getAttribute('title').replace('Show only ', '')))
  const before = await names()
  ok('the accounts are listed (positive)', before.length >= 3, JSON.stringify(before))
  const rowOf = n => page.locator(`[role="button"][title="Show only ${n}"]`)
  const a = before[0], b = before[1]                              // two accounts in the same group
  const handle = rowOf(a).locator('button').first()
  const hb = await handle.boundingBox(), rb = await rowOf(b).boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await new Promise(r => setTimeout(r, 200))
  const tx = hb.x + hb.width / 2, ty = rb.y + rb.height * 0.75   // the lower half of the next row
  for (let i = 1; i <= 14; i++) { await page.mouse.move(tx, hb.y + hb.height / 2 + ((ty - hb.y - hb.height / 2) * i) / 14); await new Promise(r => setTimeout(r, 30)) }
  await new Promise(r => setTimeout(r, 200))
  await page.mouse.up()
  await until(async () => (await names())[0] === b)
  const after = await names()
  ok(`${a} dragged below ${b} lands there`, after[0] === b && after[1] === a, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
}

if (MODE === 'drag') {
  await tab('Goals')
  await page.getByText('Every goal on one timeline').waitFor({ timeout: 8000 }).catch(() => {})
  const order = () => page.evaluate(() => [...document.querySelectorAll('[title^="Drag to change where"]')].map(e => e.getAttribute('title').replace('Drag to change where ', '').replace(' is paid in the order', '')))
  const before = await order()
  ok('the ranked list is on screen (positive)', before.length >= 3, JSON.stringify(before))
  const last = before[before.length - 1], first = before[0]
  const grip = page.locator(`[title="Drag to change where ${last} is paid in the order"]`)
  const target = page.locator(`[title="Drag to change where ${first} is paid in the order"]`)
  await target.scrollIntoViewIfNeeded()
  await grip.scrollIntoViewIfNeeded()
  await new Promise(r => setTimeout(r, 200))
  const g = await grip.boundingBox(), t = await target.boundingBox()
  ok('both rows are on screen before the press (positive)', g.y > 0 && g.y < 880 && t.y > 0 && t.y < 880, JSON.stringify([Math.round(g.y), Math.round(t.y)]))
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await new Promise(r => setTimeout(r, 250))                       // the handler is attached after the press renders
  console.log('  lifted rows during the drag:', await page.evaluate(() => [...document.querySelectorAll('[title^="Drag to change where"]')].filter(e => e.parentElement && getComputedStyle(e.parentElement).opacity === '0.4').length), ' body class:', await page.evaluate(() => document.body.className))
  for (let i = 1; i <= 12; i++) { await page.mouse.move(t.x + t.width / 2, g.y + ((t.y + 2 - g.y) * i) / 12); await new Promise(r => setTimeout(r, 25)) }
  await new Promise(r => setTimeout(r, 150))
  await page.mouse.up()
  await until(async () => (await order())[0] === last)
  const after = await order()
  ok(`${last} dragged to the top lands first`, after[0] === last, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
}

if (MODE === 'modal') {
  await tab('Balance')
  await page.getByRole('button', { name: /Add account/ }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: /Add account/ }).click()
  await page.locator('select').first().waitFor({ timeout: 5000 })
  await new Promise(r => setTimeout(r, 500))
  await page.evaluate(() => {
    let e = document.querySelector('select')
    for (; e && e.parentElement; e = e.parentElement) {
      const p = e.parentElement
      if (getComputedStyle(p).position === 'fixed' && p.getBoundingClientRect().width > innerWidth * 0.9) { e.setAttribute('data-probe-modal', '1'); return }
    }
  })
  const mb = await page.locator('[data-probe-modal="1"]').boundingBox().catch(() => null)
  ok('the Add account window was found (positive)', !!mb, JSON.stringify(mb))
  if (mb) {
    console.log(`  window drawn at x ${Math.round(mb.x)}..${Math.round(mb.x + mb.width)} of 1400, y ${Math.round(mb.y)}..${Math.round(mb.y + mb.height)} of 900`)
    ok('it is centred across the window (±6px)', Math.abs(mb.x + mb.width / 2 - 700) <= 6, `${Math.round(mb.x + mb.width / 2)} vs 700`)
    ok('…and sits inside the window, top to bottom', mb.y >= 0 && mb.y + mb.height <= 900 + 1)
  }
}
await br.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
