// node scripts/focus-ring-audit.mjs [port=5199]     (needs a dev server)
// CHROME=<path> overrides the browser. TABS=<n> sets how many Tab presses per screen (default 60).
//
// WCAG 2.4.7: a keyboard user can see where focus is. Walks the seven modules
// pressing Tab, and at each stop reads the computed outline and box-shadow of
// the focused element. A stop with neither is a control you can reach and
// cannot see. An inline `outline: none` outranks the global :focus-visible
// rule, which is how 74 of them got there. The count of stops is printed too:
// 0 stops on a screen means the audit never moved, not that the screen is clean.
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


const TABS = Number(process.env.TABS ?? 60)
const screens = [['Today'], ['Calendar'], ['Mail'], ['Tasks'], ['Habits'], ['Finance'], ['Library']]
let totalStops = 0, totalBlind = 0
screens.push(['Settings'])
for (const [label] of screens) {
  if (label === 'Settings') {
    // Settings left the rail for the avatar menu.
    await p.locator('button[aria-haspopup="menu"]').first().click()
    await p.waitForTimeout(400)
    const item = p.getByRole('menuitem', { name: /Settings/ })
    if (!(await item.count())) { console.log('*** Settings: no menu item — NOT MEASURED'); continue }
    await item.first().click()
  } else {
    const btn = p.locator(`[data-side-rail] button[aria-label="${label}"]`)
    if (!(await btn.count())) { console.log(`*** ${label}: no rail button — NOT MEASURED`); continue }
    await btn.first().click()
  }
  await p.waitForTimeout(1500)
  await p.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0) })
  await p.locator('main').first().click({ position: { x: 4, y: 4 }, force: true }).catch(() => {})
  const seen = new Set(), blind = new Map()
  let stops = 0
  for (let i = 0; i < TABS; i++) {
    await p.keyboard.press('Tab')
    const r = await p.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const shadow = cs.boxShadow !== 'none'
      const name = (el.getAttribute('aria-label') || el.title || el.textContent || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 26)
      const key = el.tagName + '|' + (el.getAttribute('data-flip-id') || '') + '|' + name + '|' + Math.round(el.getBoundingClientRect().top) + '|' + Math.round(el.getBoundingClientRect().left)
      // Text you type into shows a caret, not a ring (index.css) — by design.
      const typed = el.matches('textarea, [contenteditable=""], [contenteditable="true"], input:not([type]), input:is([type="text"],[type="search"],[type="number"],[type="email"],[type="password"],[type="tel"],[type="url"],[type="date"],[type="time"],[type="datetime-local"],[type="month"],[type="week"])')
      return { key, tag: el.tagName.toLowerCase(), name, ring: ring || typed, shadow, inRail: !!el.closest('[data-side-rail]') }
    })
    if (!r || seen.has(r.key)) continue
    seen.add(r.key); stops++
    if (!r.ring && !r.shadow) blind.set(`${r.tag} "${r.name}"`, (blind.get(`${r.tag} "${r.name}"`) ?? 0) + 1)
  }
  totalStops += stops; totalBlind += blind.size
  console.log(`${label.padEnd(9)} stops: ${String(stops).padStart(3)}   no visible focus: ${String(blind.size).padStart(3)}`)
  for (const [k, n] of [...blind].slice(0, Number(process.env.TOP ?? 5))) console.log(`            ${k}${n > 1 ? ' x' + n : ''}`)
}
console.log(`\nTOTAL  stops: ${totalStops}   no visible focus: ${totalBlind}`)
await b.close()
