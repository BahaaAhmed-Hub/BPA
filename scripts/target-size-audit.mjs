// node scripts/target-size-audit.mjs [port=5199]     (needs a dev server)
// CHROME=<path> overrides the browser. TARGET_MIN=<px> sets the line (default 32).
//
// Walks the seven modules and measures every visible interactive element's
// border box. WCAG 2.2 (2.5.8) sets 24px as the floor; this app's own control
// token is 34-36px; Apple and Material ask 44px/48px on touch. Prints, per
// screen, how many sit under 24 and under TARGET_MIN, and the worst offenders
// grouped by what they are. A screen that never opened is named, because a
// count of 0 from a screen that did not load is not a pass.
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

const measure = (min) => p.evaluate(min => {
  const SEL = 'button, a[href], [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'
  const out = []
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('[aria-hidden="true"]') || el.disabled) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // Inline links inside a sentence are exempt under 2.5.8.
    if (el.tagName === 'A' && cs.display === 'inline') continue
    // A `.sb-hit` control keeps its look and borrows a transparent ::after as its
    // target. That is only counted if it is real: a point just outside the
    // box, inside the pad, must hit-test back to this element.
    let w = r.width, h = r.height, borrowed = 0
    if (el.classList.contains('sb-hit')) {
      // inset is from the padding box, so the border eats into the pad
      const pad = (parseFloat(cs.getPropertyValue('--sb-hit-pad')) || 0) - (parseFloat(cs.borderLeftWidth) || 0)
      const probe = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)) }
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const inner = pad - 1
      if (probe(r.left - inner, cy) && probe(r.right + inner, cy) && probe(cx, r.top - inner) && probe(cx, r.bottom + inner)) {
        w += pad * 2; h += pad * 2; borrowed = pad
      }
    }
    if (w < min || h < min) {
      const name = (el.getAttribute('aria-label') || el.title || el.textContent || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 28)
      out.push({ tag: el.tagName.toLowerCase(), name, w: Math.round(w), h: Math.round(h), cls: (el.className?.toString?.() || '').split(' ')[0], html: el.outerHTML.slice(0, 120) })
    }
  }
  return out
}, min)

const screens = [['Today', 'Today'], ['Calendar', 'Calendar'], ['Mail', 'Mail'], ['Tasks', 'Tasks'], ['Habits', 'Habits'], ['Finance', 'Finance'], ['Library', 'Library']]
let total24 = 0, totalMin = 0
const report = {}
for (const [label, aria] of screens) {
  const btn = p.locator(`[data-side-rail] button[aria-label="${aria}"]`)
  if (!(await btn.count())) { console.log(`*** ${label}: no rail button — NOT MEASURED`); continue }
  await btn.first().click()
  await p.waitForTimeout(1800)
  const small = await measure(MIN)
  const tiny = small.filter(x => x.w < 24 || x.h < 24)
  total24 += tiny.length; totalMin += small.length
  const groups = {}
  for (const x of small) { const k = `${x.tag} ${x.w}x${x.h} ${x.name || x.cls || x.html}`; groups[k] = (groups[k] ?? 0) + 1 }
  const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 6))
  report[label] = { under24: tiny.length, underMin: small.length, top }
  console.log(`${label.padEnd(9)} <24px: ${String(tiny.length).padStart(3)}   <${MIN}px: ${String(small.length).padStart(3)}`)
  for (const [k, n] of top) console.log(`            ${String(n).padStart(3)}x  ${k}`)
}
console.log(`\nTOTAL  <24px: ${total24}   <${MIN}px: ${totalMin}`)
await b.close()
