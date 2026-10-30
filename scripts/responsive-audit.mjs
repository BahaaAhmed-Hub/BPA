// node scripts/responsive-audit.mjs [port=5199]     (needs a dev server)
// CHROME=<path> overrides the browser. WIDTHS=390,768 sets the viewports.
//
// The app is built around a desktop rail. At each width, on every module, this
// reads three things off the page rather than off the code: whether the page
// scrolls sideways (document wider than the window), which visible elements
// stick out past the right edge, and the rail's own width as a share of the
// window. Sideways scroll on a phone is the failure users notice first.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const PORT = process.argv[2] ?? '5199'
const MIN = Number(process.env.TARGET_MIN ?? 32)
const now = new Date().toISOString()
const tasks = ['Plan the quarter', 'Reply to Sam', 'Book the flights', 'Review the budget', 'Water the plants'].map((title, i) => ({
  id: 't' + i, title, company: 'personal', quadrant: ['do', 'schedule', 'delegate', 'eliminate', 'schedule'][i] ?? 'schedule',
  status: 'todo', completed: false, task_type: null, created_at: now, user_id: user.id }))
const books = Array.from({ length: 10 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, user_id: user.id, title: `Book ${i}`, authors: ['A. Writer'],
  pages: 300, source: 'manual', status: ['want', 'reading', 'finished'][i % 3], format: 'print', rating: 0, shelf_order: i, added_at: now, updated_at: now }))
const T = { tasks, library_books: books }

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--ignore-certificate-errors'] })
const WIDTHS = (process.env.WIDTHS ?? '390,768').split(',').map(Number)
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })
const json = (r, x) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, ['morning','calendar','inbox','tasks','habits','finance','library'].map(id => ({ module_id: id, label: id, enabled: true })))
  const t = u.pathname.split('/').pop()
  return json(r, q.method() === 'GET' && t in T ? T[t] : [])
})
for (const host of ['**://www.googleapis.com/**', '**://openlibrary.org/**', '**://oauth2.googleapis.com/**', 'https://covers.openlibrary.org/**'])
  await ctx.route(host, r => json(r, {}))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('library-view', 'shelf'); localStorage.setItem('task-view-mode', 'list')
} catch {} }, session)

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', () => {})
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6500)


const screens = ['Today', 'Calendar', 'Mail', 'Tasks', 'Habits', 'Finance', 'Library']
let bad = 0
for (const w of WIDTHS) {
  await p.setViewportSize({ width: w, height: 900 })
  console.log(`\n── ${w}px ──`)
  for (const label of screens) {
    const btn = p.locator(`[data-side-rail] button[aria-label="${label}"]`)
    if (!(await btn.count())) { console.log(`${label.padEnd(9)} *** rail button not found — NOT MEASURED`); continue }
    await btn.first().click()
    await p.waitForTimeout(1500)
    const r = await p.evaluate(() => {
      const vw = window.innerWidth
      const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      const main = document.querySelector('main')
      const mainW = main ? main.scrollWidth : 0
      const out = []
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('[aria-hidden="true"]')) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue
        const rc = el.getBoundingClientRect()
        if (!rc.width || !rc.height) continue
        // an element inside a container that really scrolls sideways is not a leak; one inside overflow:hidden is cut off, which is
        let scrolled = false
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (/auto|scroll/.test(o) && a.scrollWidth > a.clientWidth + 1 && a.getBoundingClientRect().right <= vw + 1) { scrolled = true; break } }
        if (!scrolled && rc.right > vw + 2) out.push((el.getAttribute('aria-label') || el.title || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24) + ' →' + Math.round(rc.right))
      }
      const rail = document.querySelector('[data-side-rail]')
      return { vw, docW, mainW, rail: rail ? Math.round(rail.getBoundingClientRect().width) : 0, leaks: [...new Set(out)].slice(0, 4), nLeaks: new Set(out).size }
    })
    const sideways = r.docW > r.vw + 1
    if (sideways) bad++
    console.log(`${label.padEnd(9)} sideways scroll: ${sideways ? 'YES ' + r.docW + 'px' : 'no '.padEnd(6)}  rail ${r.rail}px (${Math.round(r.rail / r.vw * 100)}%)  elements past the edge: ${r.nLeaks}${r.leaks.length ? '  e.g. ' + r.leaks.join(' | ') : ''}`)
  }
}
console.log(`\nscreens that scroll sideways: ${bad}`)
await b.close()
