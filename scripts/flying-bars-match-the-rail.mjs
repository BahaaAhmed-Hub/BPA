#!/usr/bin/env node
/**
 * flying-bars-match-the-rail — every module's menu bar is the rail's shape
 *
 *   node scripts/flying-bars-match-the-rail.mjs [bars|stats|control]
 *
 * Five bars now float instead of sitting as slabs or loose rows: the
 * calendar's header, Today's brief bar, the Tasks controls, the Habits header
 * and the Finance tabs. The claim is that they are **the same object as the
 * rail**, so each one is measured against the rail's own lozenge in the same
 * page — a hard-coded `borderRadius: 999` passes a one-sided assertion and
 * drifts the day `SideRail` changes.
 *
 * `stats` is the other half of the request: the calendar's "N events · N
 * clashes · next in Nh" line is gone, and the lens sentence that shared it is
 * not — that one is the only thing on screen that says why a week went quiet.
 *
 * Control: the old values restored on each very same element.
 */

import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'

import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'bars'

const BARS = [
  ['calendar', '[data-cal-header]',  'the calendar header'],
  ['morning',  '[data-today-bar]',   'Today’s brief bar'],
  ['tasks',    '[data-tasks-bar]',   'the Tasks controls'],
  ['habits',   '[data-habits-bar]',  'the Habits header'],
  ['finance',  '[data-finance-tabs]','the Finance tabs'],
  ['inbox',    '[data-mail-bar]',    'the Mail bar'],
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  sessionStorage.setItem('finance-unlocked', '1')
} catch {} }, session)

const p = await ctx.newPage()

// Installed before the first navigation, or the counter misses the boot.

const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 140)))

let fails = 0
const ok = (n, c, x = '') => {
  console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const shapeOf = sel => p.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const c = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const m = (document.querySelector('main') ?? document.body).getBoundingClientRect()
  return {
    radius: c.borderTopLeftRadius, bg: c.backgroundColor, shadow: c.boxShadow,
    border: c.borderTopWidth + ' ' + c.borderTopStyle,
    sameAllRound: c.borderTopWidth === c.borderBottomWidth && c.borderTopStyle === c.borderBottomStyle,
    insetL: Math.round(r.left - m.left), insetR: Math.round(m.right - r.right),
  }
}, sel)

const BASE = 'http://localhost:5199/'

async function go(mod) {
  // **localStorage belongs to an origin, and `about:blank` is not one.** The
  // first call wrote the module into a store the app never reads, the write
  // was swallowed by its own try/catch, and the app came up on the default
  // module — so `[data-cal-header]` was absent and every "no event count"
  // assertion passed against an empty string. The positive assertions beside
  // them are the only reason that showed. Land on the origin first.
  if (!p.url().startsWith(BASE)) await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.evaluate(m => { try {
    const ui = JSON.parse(localStorage.getItem('professor-ui') || '{}')
    localStorage.setItem('professor-ui', JSON.stringify({
      ...ui, state: { ...(ui.state || {}), activeModule: m, themeId: 'sunlit-bento' }, version: 0 }))
  } catch {} }, mod)
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(p, traffic, 5600)
}

if (MODE === 'bars' || MODE === 'control') {
  for (const [mod, sel, label] of BARS) {
    await go(mod)
    if (MODE === 'control') {
      // The shape each bar had before: square, no shadow, the page's own band.
      await p.evaluate(s => {
        const el = document.querySelector(s); if (!el) return
        el.style.borderRadius = '0'; el.style.boxShadow = 'none'
        el.style.background = 'var(--sb-header)'; el.style.border = 'none'
        el.style.margin = '0'
      }, sel)
      await p.waitForTimeout(200)
    }
    const bar  = await shapeOf(sel)
    const rail = await shapeOf('[data-side-rail] > div > div')
    if (!bar) { ok(`${label} is on screen`, false, sel); continue }
    ok(`${label} — the rail's radius`, bar.radius === rail.radius, `${bar.radius} vs ${rail.radius}`)
    ok(`${label} — its ground`,        bar.bg === rail.bg,         `${bar.bg}`)
    ok(`${label} — its shadow`,        bar.shadow === rail.shadow, bar.shadow === 'none' ? 'none' : '')
    ok(`${label} — a border all round, not a rule under it`, bar.sameAllRound, bar.border)
    ok(`${label} — it floats off both edges`, bar.insetL > 0 && bar.insetR > 0,
      `${bar.insetL}px / ${bar.insetR}px`)
  }
}

if (MODE === 'stats') {
  await go('calendar')
  const n = await p.locator('[data-cal-header]').count()
  ok('the calendar header is on screen at all', n === 1, `${n} found`)
  if (n !== 1) { await b.close(); console.log('\nFAILED'); process.exit(1) }
  const txt = await p.evaluate(() =>
    (document.querySelector('[data-cal-header]')?.innerText ?? '').replace(/\s+/g, ' '))
  console.log('   header reads:', JSON.stringify(txt.slice(0, 90)))
  ok('no event count', !/\d+ events?\b/.test(txt), txt.match(/\d+ events?/)?.[0] ?? '')
  ok('no clash count', !/clash/i.test(txt))
  ok('no "next in"',   !/next in/i.test(txt))
  ok('the date range is still there', /\w{3} \d+/.test(txt))
  ok('and the controls are still there', /Today/.test(txt) && /New event/.test(txt))

  // The lens sentence shared that line and is deliberately kept: it is the
  // only thing that says *why* a week has gone quiet.
  const src = (await import('node:fs')).readFileSync('src/modules/calendar/CalendarIntelligence.tsx', 'utf8')
  ok('the lens sentence survived the deletion', /none here is \$\{lensName\}/.test(src))
  ok('and it only draws while a lens is on', /\{lensName && \(/.test(src))
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
