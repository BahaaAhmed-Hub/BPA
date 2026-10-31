// node scripts/panel-scrollbar-inside.mjs [theme]   (dev server on 5199)
// The details panel is a rounded card; its scroll area must sit inside the
// curve, scrollbar included. Measures the scroller's right/bottom edge and
// the card's corner curve rather than reading a style.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const THEME = process.argv[2] ?? 'glass-depth'
const tasks = [{
  id: 't1', title: 'Water the office plants', company: 'personal', quadrant: 'important_not_urgent',
  status: 'todo', completed: false, task_type: 'do', created_at: new Date().toISOString(), user_id: user.id,
  description: Array.from({ length: 40 }, (_, i) => `Line ${i} of notes that makes this panel scroll`).join('\n'),
}]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 620 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname === '/rest/v1/tasks') return j(tasks)
  return j([])
})
await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
await ctx.addInitScript(([s, theme]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: theme }, version: 0 }))
  localStorage.setItem('task-view-mode', 'matrix')
} catch {} }, [session, THEME])
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
await p.getByText('Water the office plants').first().click(); await p.waitForTimeout(600)
const m = await p.evaluate(() => {
  const aside = [...document.querySelectorAll('aside')].find(a => a.querySelector('textarea'))
  if (!aside) return null
  const sc = [...aside.querySelectorAll('div')].find(d => getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > d.clientHeight)
  const cs = getComputedStyle(aside), a = aside.getBoundingClientRect(), s = sc?.getBoundingClientRect()
  return { aside: { r: a.right, b: a.bottom, radius: cs.borderRadius, overflow: cs.overflow }, scroller: sc ? { r: s.right, b: s.bottom, mid: (s.top + s.bottom) / 2, bar: sc.offsetWidth - sc.clientWidth } : null }
})
console.log(JSON.stringify(m))
const png = await p.screenshot({ path: process.env.SHOT ?? 'panel.png' })
// What is drawn, not what is declared: walk the row across the middle of the
// scroll area from the card's own border inward and note where the thumb is.
const row = await p.evaluate(async ([b64, y, x0, x1, dpr]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d'); g.drawImage(img, 0, 0)
  const px = []
  for (let x = x0; x <= x1; x++) { const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; px.push([x, d[0] + d[1] + d[2]]) }
  return px
}, [png.toString('base64'), m.scroller.mid, m.aside.r - 24, m.aside.r - 0.3, await p.evaluate(() => window.__zoomSpace ?? 1)])
const bg = row[0][1]
const lit = row.filter(([, v]) => Math.abs(v - bg) > 6)
console.log(row.map(([x, v]) => `${Math.round(x)}:${v}`).join(' '))
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}  ${x}`); if (!c) fails++ }
ok('the panel opened and scrolls', !!m && !!m.scroller)
ok('the scrollbar is drawn', m.scroller.bar > 0, `${m.scroller.bar}px`)
// the border is the last lit pixel; the thumb is the lit run before it
const xs = lit.map(([x]) => x)
const border = Math.max(...xs)
const thumb = xs.filter(x => x < border - 1)
const gap = thumb.length ? border - Math.max(...thumb) : -1
ok('the thumb is drawn', thumb.length >= 3, `${thumb.length}px wide`)
ok('the thumb clears the card border by 3px or more (clear pixels)', gap >= 3, `gap ${gap}px`)
await b.close(); process.exit(fails ? 1 : 0)
