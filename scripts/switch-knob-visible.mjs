// node scripts/switch-knob-visible.mjs   (dev server on 5199)
// An "on" switch has to read as on: the knob must be visibly different from the
// track it sits on, in every theme. Opens Settings -> Library, turns "Show the
// Library" on, and measures the computed colours of track and knob (alpha
// composited over the card) — WCAG 3:1, the bar for a UI component.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const THEMES = ['sunlit-bento', 'warm-minimal', 'evergreen', 'glass-depth']
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}  ${x}`); if (!c) fails++ }
for (const th of THEMES) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(user)
    if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
    return j(u.pathname.startsWith('/auth/v1') ? {} : [])
  })
  await ctx.addInitScript(([s, t]) => { try {
    localStorage.setItem('bpa-wizard-done', '1')
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: t }, version: 0 }))
  } catch {} }, [session, th])
  const p = await ctx.newPage(); const traffic = watchTraffic(p)
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
  await p.locator('main button').filter({ hasText: /^Library\d*$/ }).last().click({ timeout: 8000 })
  const sw = p.getByRole('switch').first(); await sw.waitFor({ timeout: 5000 })
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
  await p.waitForTimeout(400)
  const m = await sw.evaluate(el => {
    const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
    const over = (f, bg) => ({ r: f.r * f.a + bg.r * (1 - f.a), g: f.g * f.a + bg.g * (1 - f.a), b: f.b * f.a + bg.b * (1 - f.a), a: 1 })
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    const chain = []; for (let e = el.parentElement; e; e = e.parentElement) chain.unshift(parse(getComputedStyle(e).backgroundColor))
    for (const c of chain) if (c.a > 0) bg = over(c, bg)
    const track = over(parse(getComputedStyle(el).backgroundColor), bg)
    const knob = over(parse(getComputedStyle(el.firstElementChild).backgroundColor), track)
    const L = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b) }
    const [hi, lo] = [L(track), L(knob)].sort((a, b) => b - a)
    return { on: el.getAttribute('aria-checked'), ratio: (hi + .05) / (lo + .05) }
  })
  ok(`[${th}] the switch is on`, m.on === 'true')
  ok(`[${th}] the knob stands out from the track (3:1)`, m.ratio >= 3, `${m.ratio.toFixed(2)}:1`)
  await ctx.close()
}
await b.close(); process.exit(fails ? 1 : 0)
