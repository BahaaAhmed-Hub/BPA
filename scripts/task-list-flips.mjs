// node scripts/task-list-flips.mjs [motion|reduced]
// Needs a dev server on 5199. CHROME=<path> overrides the browser.
//
// The List view's rows glide when a tick re-lays the list (hideCompleted on:
// tick the first row, the rows below move up). Measured, not read: the last
// row's top is sampled ~90ms after the tick and again once everything has
// settled. Under Flip it is still travelling at 90ms; under
// prefers-reduced-motion (the control) it is already where it ends.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const HOW = process.argv[2] ?? 'motion'
const names = ['Alpha row', 'Bravo row', 'Charlie row', 'Delta row']
const tasks = names.map((title, i) => ({
  id: 'flip-' + i, title, company: 'personal', quadrant: 'important_not_urgent',
  status: 'todo', completed: false, task_type: null,
  created_at: new Date(Date.now() - i * 1000).toISOString(), user_id: user.id,
}))

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--ignore-certificate-errors'],
})
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 },
  reducedMotion: HOW === 'reduced' ? 'reduce' : 'no-preference' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname === '/rest/v1/tasks') return j(tasks)
  return j([])
})
await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'list')
  localStorage.setItem('task-command-config', JSON.stringify({ hideCompleted: true, groupBy: 'none' }))
} catch {} }, session)

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6500)

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const rows = () => p.locator('[data-flip-id]')
const topOf = id => p.evaluate(i => document.querySelector(`[data-flip-id="${i}"]`)?.getBoundingClientRect().top ?? null, id)

ok('the list drew its four rows', await rows().count() === 4, `count=${await rows().count()}`)
const start = await topOf('flip-3')
ok('the last row exists to be measured', start != null, `top=${start}`)

// The tick may take a moment to reach the list, so rather than guess when,
// the last row's top is sampled every frame from before the click and the
// trace is read afterwards: it either steps from start to end or glides.
await p.evaluate(() => {
  window.__trace = []
  const t0 = performance.now()
  const tick = () => {
    const el = document.querySelector('[data-flip-id="flip-3"]')
    if (el) window.__trace.push([Math.round(performance.now() - t0), el.getBoundingClientRect().top])
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await rows().first().getByTitle('Complete', { exact: true }).click()
await p.waitForTimeout(2700)
const trace = await p.evaluate(() => window.__trace)
const end = trace[trace.length - 1][1]
const gone = await rows().count()
ok('the ticked row left the list', gone === 3, `count=${gone}`)
ok('and the rows below moved up', end < start - 20, `start=${Math.round(start)} end=${Math.round(end)}`)
// Frames strictly between where the row began and where it ended.
const between = trace.filter(([, y]) => y < start - 2 && y > end + 2).length
console.log(`  frames in flight: ${between}`)
if (HOW === 'reduced') ok('control: under reduced motion the row never glides', between === 0, `frames=${between}`)
else ok('with motion the row glides through intermediate positions', between >= 3, `frames=${between}`)
const left = await p.evaluate(() => [...document.querySelectorAll('[data-flip-id]')].filter(e => e.style.position || e.style.width).length)
ok('and Flip cleans its inline styles off every row afterwards', left === 0, `rows with leftovers=${left}`)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close(); process.exit(fails ? 1 : 0)
