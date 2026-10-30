// node scripts/library-shelf-flips.mjs [motion|reduced]
// Needs a dev server on 5199. CHROME=<path> overrides the browser.
//
// The shelf re-packs its rows when a filter changes which books stand on it.
// A book that survives the filter used to jump to its new place; under Flip it
// travels. Measured: one surviving book's position is sampled every frame from
// before the click, and the frames strictly between where it began and where it
// ended are counted. Controls: prefers-reduced-motion (none), and the same run
// on the code before the change (none). Also: a book is still pickable after
// the glide, so the hit area did not get stranded.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const HOW = process.argv[2] ?? 'motion'
const now = new Date().toISOString()
const N = 16
const books = Array.from({ length: N }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, user_id: user.id, title: `Book ${String(i).padStart(2, '0')}`,
  authors: ['A. Writer'], pages: 280 + i * 20, source: 'manual', status: i % 2 ? 'reading' : 'want', format: 'print',
  rating: 0, shelf_order: i, added_at: now, updated_at: now,
}))
const T = { library_books: books, library_sessions: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [] }
const TARGET = books[N - 1].id   // the last 'reading' book: first row after the filter, last before it

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--ignore-certificate-errors'],
})
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1000, height: 1300 },
  reducedMotion: HOW === 'reduced' ? 'reduce' : 'no-preference' })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (q.method() === 'GET' && t in T) return json(r, T[t])
  return json(r, [], q.method() === 'POST' ? 201 : 200)
})
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
await ctx.route('**://openlibrary.org/**', r => json(r, {}))
await ctx.route('**://www.googleapis.com/books/**', r => json(r, {}))
await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('library-view', 'shelf')
} catch {} }, session)

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6500, { shell: '[data-side-rail]' })
await p.waitForTimeout(2600)   // the settle-in owns the first 2.2s and is not Flip's

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const spines = () => p.locator('.lib-spine[data-flip-id]')
const pos = id => p.evaluate(i => { const r = document.querySelector(`[data-flip-id="${i}"]`)?.getBoundingClientRect(); return r ? [r.left, r.top] : null }, id)

ok('the shelf drew all its books', await spines().count() === N, `count=${await spines().count()}`)
const start = await pos(TARGET)
ok('the book to follow exists', !!start, JSON.stringify(start))

await p.evaluate(id => {
  window.__trace = []
  const t0 = performance.now()
  const tick = () => {
    const r = document.querySelector(`[data-flip-id="${id}"]`)?.getBoundingClientRect()
    if (r) window.__trace.push([r.left, r.top])
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}, TARGET)
await p.getByRole('button', { name: /^Reading/ }).click()
await p.waitForTimeout(2700)
const trace = await p.evaluate(() => window.__trace)
const end = trace[trace.length - 1]
ok('the filter left only the reading books', await spines().count() === N / 2, `count=${await spines().count()}`)
const moved = Math.hypot(end[0] - start[0], end[1] - start[1])
ok('and the surviving book changed place', moved > 40, `moved ${Math.round(moved)}px`)
const dist = ([x, y]) => Math.hypot(x - end[0], y - end[1])
const between = trace.filter(pt => dist(pt) > 4 && Math.hypot(pt[0] - start[0], pt[1] - start[1]) > 4).length
console.log(`  frames in flight: ${between}`)
if (HOW === 'reduced') ok('control: under reduced motion it never glides', between === 0, `frames=${between}`)
else ok('with motion it glides through intermediate positions', between >= 3, `frames=${between}`)
const left = await p.evaluate(() => [...document.querySelectorAll('[data-flip-id]')].filter(e => e.style.position).length)
ok('and Flip leaves no inline position on any book', left === 0, `leftovers=${left}`)

await p.getByRole('button', { name: /Book 15 by/ }).click()
await p.waitForTimeout(900)
ok('a book is still pickable after the glide (the hit area is where it looks)', await p.getByRole('complementary').count() > 0)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close(); process.exit(fails ? 1 : 0)
