// node scripts/composer-scrollbars-inside.mjs [theme] [height]   (dev server on 5199)
// The new-event composer is a rounded card. Any scrollbar that appears beside
// or under it must belong to the card itself and sit inside it — not to a row,
// the grid or the page around it. Measured on the page: every ancestor that
// draws a scrollbar, and where that bar is relative to the card.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const THEME = process.argv[2] ?? 'glass-depth', H = Number(process.argv[3] ?? 760)
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const NOW = new Date(), TODAY = ymd(NOW)
const TZ = (() => { const o = -NOW.getTimezoneOffset(); const s = o < 0 ? '-' : '+'; const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()
const at = h => `${TODAY}T${pad(h)}:00:00${TZ}`
const me = { email: user.email, self: true, responseStatus: 'accepted' }
const EVENTS = [{ id: 'e1', status: 'confirmed', summary: 'Weekly Sync', start: { dateTime: at(9) }, end: { dateTime: at(10) }, attendees: [me], organizer: { email: user.email, self: true } }]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: H } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  return j(u.pathname.startsWith('/auth/v1') ? {} : [])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [{ id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true }] })
  const m = /\/calendars\/([^/]+)\/events/.exec(u.pathname)
  if (m && q.method() === 'GET') return j({ items: decodeURIComponent(m[1]) === 'primary' ? EVENTS : [] })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(([s, theme]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: theme }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('bpa-wizard-done', '1'); localStorage.setItem('professor-wizard-done', '1')
} catch {} }, [session, THEME])
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
await p.getByRole('button', { name: /New event/ }).click()
await p.getByPlaceholder('Event title').waitFor({ timeout: 6000 }); await p.waitForTimeout(500)
const m = await p.evaluate(() => {
  const aside = document.querySelector('aside.sb-compose'); const a = aside.getBoundingClientRect()
  const bars = []
  const seen = new Set()
  const add = (el, label) => { if (seen.has(el)) return; seen.add(el)
    const cs = getComputedStyle(el); const v = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
    const h = el.offsetHeight - el.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
    if (v > 1 || h > 1) { const r = el.getBoundingClientRect(); bars.push({ label, v: Math.round(v), h: Math.round(h), right: Math.round(r.right), bottom: Math.round(r.bottom) }) } }
  add(aside, 'card')
  // <html> reports its zoomed and unzoomed widths side by side, which reads as a bar
  for (let e = aside.parentElement; e && e !== document.documentElement; e = e.parentElement) add(e, e.tagName + '.' + String(e.className).split(' ')[0])
  return { card: { right: Math.round(a.right), bottom: Math.round(a.bottom), h: Math.round(a.height) }, win: [innerWidth, innerHeight], bars }
})
console.log(JSON.stringify(m))
await p.screenshot({ path: process.env.SHOT ?? 'composer.png' })
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}  ${x}`); if (!c) fails++ }
const outside = m.bars.filter(x => x.label !== 'card')
ok('the card sits inside the window', m.card.bottom <= m.win[1] + 1, `card bottom ${m.card.bottom}, window ${Math.round(m.win[1])}`)
ok('the card scrolls itself when it is taller than its row', m.card.h >= 640 || m.bars.some(x => x.label === 'card'), JSON.stringify(m.bars.map(x => x.label)))
ok('the card is on screen', m.card.right > 0 && m.card.bottom > 0)
ok('no row, grid or page scrollbar is drawn around the card', outside.length === 0, JSON.stringify(outside))
await b.close(); process.exit(fails ? 1 : 0)
