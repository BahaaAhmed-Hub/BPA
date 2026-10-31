// node scripts/segmented-fits-its-options.mjs [port=5199] — needs a dev server (npx vite --port 5199 --strictPort).
//   CHROME=/path/to/chrome overrides the default /opt/pw-browsers/chromium.
// A segmented control is exactly as wide as its options — never as wide as the window, the dialog or the card it sits in.
//
// **Measured, not read.** For every `.sb-segmented` that is not `data-block` the track's own width is compared with what its
// options need: Σ option widths + the gaps between them + the track's padding. A stylesheet assertion passes with the rule
// missing from the sheet; this reads `getBoundingClientRect`.
//
// **Coverage is asserted, not assumed.** Every rail module, every control inside each (each option of each control is pressed
// in turn, which opens the sub-views), the Library's book dialogs, and every Settings section. The run fails if it measured
// fewer than MIN_CONTROLS controls — a harness that visited nothing would otherwise report a clean zero.
//
// **Control.** The same controls on the same page with the fix removed — `width: auto` put back on `.sb-segmented`, nothing
// else changed — must reproduce the bug (a track wider than its options) in at least one place, or this proves nothing.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const port = process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? '5199'
const BASE = `http://localhost:${port}/BPA/`
const TOL = 1.5
const MIN_CONTROLS = 25

const now = new Date().toISOString()
const BOOK = '00000000-0000-4000-8000-0000000000e1'
const books = [{ id: BOOK, user_id: user.id, title: 'Dune', authors: ['Frank Herbert'], pages: 600, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, cover_url: null, description: 'A desert planet.' }]
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS, DELETE' }
const json = (r, x, s = 200, h = {}) => r.fulfill({ status: s, contentType: 'application/json', headers: h, body: JSON.stringify(x) })

const br = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function newPage(viewport) {
  const ctx = await br.newContext({ viewport, reducedMotion: 'reduce' })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method()
    if (u.pathname.startsWith('/functions/v1/library-videos')) {
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
      return json(r, { status: 'ok', items: [{ id: 'dQw4w9WgXcQ', title: 'Dune in ten minutes', channel: 'Reads', publishedAt: '2024-01-01T00:00:00Z' }], cached: false }, 200, cors)
    }
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, ['library', 'finance', 'mail', 'tasks', 'habits', 'calendar'].map(module_id => ({ module_id, label: module_id, enabled: true })))
    const t = u.pathname.split('/').pop()
    if (t === 'library_books') return m === 'GET' ? json(r, books) : json(r, [], 201)
    return m === 'GET' ? json(r, []) : json(r, [], 201)
  })
  await ctx.route('https://i.ytimg.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }))
  await ctx.route('**://www.googleapis.com/**', r => json(r, { items: [] }))
  await ctx.addInitScript(([s]) => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    localStorage.setItem('bpa-wizard-done', '1')
    const prev = (() => { try { return JSON.parse(localStorage.getItem('professor-ui') ?? '{}') } catch { return {} } })()
    localStorage.setItem('professor-ui', JSON.stringify({ ...prev, state: { ...(prev.state ?? {}), themeId: 'glass-depth' }, version: 0 }))
  } catch {} }, [session])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
  return page
}

// Runs in the page. One row per visible, non-block segmented control under `root` (a selector; 'body' = the whole page).
const MEASURE = (root) => [...document.querySelector(root).querySelectorAll('.sb-segmented:not([data-block])')].flatMap(el => {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === 'hidden') return []
  const cs = getComputedStyle(el)
  const opts = [...el.querySelectorAll('.sb-segmented-opt')]
  const gap = parseFloat(cs.columnGap) || 0
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
  const need = opts.reduce((n, o) => n + o.getBoundingClientRect().width, 0) + gap * Math.max(0, opts.length - 1) + pad
  const p = el.parentElement.getBoundingClientRect()
  return [{
    label: el.getAttribute('aria-label') || opts.map(o => o.textContent.trim()).join(' | ').slice(0, 50),
    w: Math.round(r.width * 10) / 10, need: Math.round(need * 10) / 10, parentW: Math.round(p.width),
    // The parent has room the control is NOT using: this is what tells "fits" from "fills".
    roomy: p.width - r.width > 12,
    clipped: r.right > window.innerWidth + 0.5 || r.right > p.right + 0.5,
  }]
})

const seen = new Map()   // "screen › label" → row
let controls = 0
async function measure(page, screen, root = 'body') {
  const rows = await page.evaluate(MEASURE, root)
  for (const row of rows) { seen.set(`${screen} › ${row.label}`, row); controls++ }
  return rows
}

// Press every option of every control on the current screen, measuring after each — which opens the sub-views.
async function sweep(page, screen, cap = 40) {
  await measure(page, screen)
  let pressed = 0
  const count = await page.locator('.sb-segmented:not([data-block])').count()
  for (let i = 0; i < count && pressed < cap; i++) {
    const seg = page.locator('.sb-segmented:not([data-block])').nth(i)
    if (!(await seg.isVisible().catch(() => false))) continue
    const n = await seg.locator('.sb-segmented-opt').count()
    for (let k = 0; k < n && pressed < cap; k++) {
      const opt = seg.locator('.sb-segmented-opt').nth(k)
      if (!(await opt.isEnabled().catch(() => false))) continue
      await opt.click({ timeout: 1500 }).catch(() => {}); pressed++
      await page.waitForTimeout(120)
      await measure(page, `${screen}/${i}.${k}`)
    }
  }
}

/* ── the app, at desktop width ─────────────────────────────────────────── */
const page = await newPage({ width: 1280, height: 900 })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-side-rail]', { timeout: 30000 })
await page.getByText('Skip for now').first().click({ timeout: 1500 }).catch(() => {})
let opened = []
for (const mod of ['Today', 'Calendar', 'Mail', 'Tasks', 'Habits', 'Finance', 'Library']) {
  const btn = page.locator(`[data-side-rail] button[aria-label="${mod}"]`)
  try { await btn.click({ timeout: 4000 }); await page.locator(`[data-side-rail] button[aria-label="${mod}"][aria-current="page"]`).waitFor({ timeout: 4000 }) } catch { continue }
  opened.push(mod)
  await page.waitForTimeout(500)
  await sweep(page, mod)
}

/* ── the Library's own dialogs (the reported ones) ─────────────────────── */
// The sweep left the Library on whichever view its last option opened; start again from the shelf.
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^library-(view|quote-mode|mode)/.test(k)) localStorage.removeItem(k) })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-side-rail]', { timeout: 30000 })
await page.locator('[data-side-rail] button[aria-label="Library"]').click()
await page.getByRole('button', { name: /^Dune by/ }).click({ timeout: 20000 })
const panel = page.getByRole('complementary')
await panel.getByRole('button', { name: 'Videos about this book' }).click()
const dlg = page.getByRole('dialog'); await dlg.waitFor()
await page.waitForTimeout(500)
const videoRows = await measure(page, 'Videos dialog', '[role="dialog"]')
await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })
await panel.getByRole('button', { name: 'Summary of this book' }).click(); await dlg.waitFor()
await page.waitForTimeout(400)
const summaryRows = await measure(page, 'Summary dialog', '[role="dialog"]')
// Control, on this very element: the fix taken out. The Summary dialog's selector sits in a COLUMN, which is where a
// parent stretches an `auto`-width item (the Videos dialog's two sit side by side in a row, which never stretches).
await page.addStyleTag({ content: '.sb-segmented{width:auto !important;max-width:none !important}' })
await page.waitForTimeout(100)
const controlRows = await page.evaluate(MEASURE, '[role="dialog"]')
await page.evaluate(() => { document.querySelectorAll('style').forEach(s => { if (s.textContent.includes('width:auto !important')) s.remove() }) })
await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })

/* ── Settings, every section ───────────────────────────────────────────── */
await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => x.includes('professor-ui'))
  if (k) { const v = JSON.parse(localStorage.getItem(k)); v.state.activeModule = 'settings'; localStorage.setItem(k, JSON.stringify(v)) }
  location.reload()
})
await page.getByRole('button', { name: 'Appearance', exact: true }).waitFor({ timeout: 30000 })
const sections = await page.evaluate(() => {
  const a = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Appearance')
  let n = a?.parentElement
  while (n && n.querySelectorAll('button').length < 12) n = n.parentElement
  return n ? [...n.querySelectorAll('button')].map(b => b.textContent.trim().replace(/\d+$/, '').trim()).filter(Boolean) : []
})
let settingsOpened = 0
for (const name of [...new Set(sections)]) {
  const b = page.getByRole('button', { name, exact: true }).first()
  if (!(await b.isVisible().catch(() => false))) continue
  await b.click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(250); settingsOpened++
  await sweep(page, `Settings · ${name}`, 12)
}
await page.context().close()

/* ── the two dialogs again, at phone width: the track gives way, it does not run off ── */
const phone = await newPage({ width: 390, height: 800 })
await phone.goto(BASE, { waitUntil: 'domcontentloaded' })
await phone.waitForSelector('[data-side-rail], nav, [data-bottom-nav]', { timeout: 30000 }).catch(() => {})
await phone.getByText('Skip for now').first().click({ timeout: 1500 }).catch(() => {})
let phoneRows = []
try {
  await phone.locator('button[aria-label="Library"]').first().click({ timeout: 8000 })
  await phone.getByRole('button', { name: /^Dune by/ }).click({ timeout: 20000 })
  await phone.getByRole('button', { name: 'Videos about this book' }).click({ timeout: 8000 })
  await phone.getByRole('dialog').waitFor(); await phone.waitForTimeout(400)
  phoneRows = await phone.evaluate(MEASURE, '[role="dialog"]')
} catch (e) { console.log('  (phone visit did not open:', String(e).split('\n')[0].slice(0, 90) + ')') }
await br.close()

/* ── verdict ───────────────────────────────────────────────────────────── */
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const all = [...seen.entries()]
const wide = all.filter(([, r]) => r.w - r.need > TOL)
const roomy = all.filter(([, r]) => r.roomy)

ok(`modules opened: ${opened.join(', ')}`, opened.length >= 6, `${opened.length} of 7`)
ok('Settings sections visited', settingsOpened >= 8, String(settingsOpened))
ok(`measured ${all.length} distinct controls (${controls} readings)`, all.length >= MIN_CONTROLS)
ok('some had empty room beside them, so "fits" is distinguishable from "fills"', roomy.length >= 10, `${roomy.length} of ${all.length}`)
ok('every control is as wide as its options need, within 1.5px', wide.length === 0, wide.length ? wide.slice(0, 5).map(([k, r]) => `${k}: ${r.w} vs ${r.need}`).join(' ; ') : '')
ok('no control runs off its parent or the window', all.every(([, r]) => !r.clipped))
ok('the Videos dialog has three controls: the topic switch, the Results / Favourites / Removed switch and the order', videoRows.length === 3 && /What to look for/.test(videoRows[0].label) && /Which videos/.test(videoRows[1].label) && /Order/.test(videoRows[2].label), videoRows.map(r => r.label).join(' ; '))
ok('…and all three fit their options', videoRows.length === 3 && videoRows.every(r => Math.abs(r.w - r.need) <= TOL), videoRows.map(r => `${r.w}/${r.need}`).join(' '))
ok('the Summary dialog control fits', summaryRows.length >= 1 && summaryRows.every(r => Math.abs(r.w - r.need) <= TOL), summaryRows.map(r => `${r.w}/${r.need}`).join(' '))
ok('CONTROL — with the fix removed, the Summary dialog’s selector runs the dialog’s width (the reported bug)', controlRows.some(r => r.w - r.need > 100), controlRows.map(r => `${r.w} vs ${r.need}`).join(' ; '))
ok('phone width: the dialog control is on screen and inside it', phoneRows.length >= 1 && phoneRows.every(r => !r.clipped), phoneRows.map(r => `${r.w}≤${r.parentW}`).join(' '))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
