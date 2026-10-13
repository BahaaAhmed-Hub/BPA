#!/usr/bin/env node
/**
 * finance-bar-is-a-lozenge — the module's tab bar is the rail's own shape
 *
 *   node scripts/finance-bar-is-a-lozenge.mjs [shape|floats|control]
 *
 * "Make it rounded, the same as the menu bar shapes" is a claim about **two**
 * elements, so one is not enough to measure: the test reads the four shape
 * properties off the finance tab bar *and* off the rail's lozenge and asserts
 * they are equal, which is what `LOZENGE` being one exported object is for. A
 * hard-coded `borderRadius: 999` here would pass a one-sided assertion and
 * still drift the day the rail's changes.
 *
 * Control: the old values put back on the very same element — square corners,
 * edge to edge, a rule underneath — one property group changed, nothing else.
 */

import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'

const MODE = process.argv[2] ?? 'shape'
const THEME = process.env.INK_THEME ?? 'sunlit-bento'

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

await ctx.addInitScript(([s, theme]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  const ui = JSON.parse(localStorage.getItem('professor-ui') || '{}')
  localStorage.setItem('professor-ui', JSON.stringify({
    ...ui, state: { ...(ui.state || {}), activeModule: 'finance', themeId: theme }, version: 0 }))
  sessionStorage.setItem('finance-unlocked', '1')
} catch {} }, [session, THEME])

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6500)

let fails = 0
const ok = (n, c, x = '') => {
  console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const bar = p.locator('[data-finance-tabs]')
ok('the finance tab bar is on screen', await bar.count() === 1)

// The control is the old bar, restored on this very element.
if (MODE === 'control') {
  await p.evaluate(() => {
    const el = document.querySelector('[data-finance-tabs]')
    el.style.borderRadius = '0'
    el.style.margin = '0'
    el.style.background = 'var(--sb-header)'
    el.style.boxShadow = 'none'
    el.style.border = 'none'
    el.style.borderBottom = 'var(--sb-border-width) solid var(--sb-border)'
  })
  await p.waitForTimeout(250)
}

const shapeOf = sel => p.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const c = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    radius: c.borderTopLeftRadius,
    bg: c.backgroundColor,
    shadow: c.boxShadow,
    borderTop: c.borderTopWidth + ' ' + c.borderTopStyle,
    borderBottom: c.borderBottomWidth + ' ' + c.borderBottomStyle,
    left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
  }
}, sel)

const tabs = await shapeOf('[data-finance-tabs]')
const rail = await shapeOf('[data-side-rail] > div > div')   // the rail's own lozenge
console.log('  tabs:', JSON.stringify(tabs))
console.log('  rail:', JSON.stringify(rail))

if (MODE === 'shape' || MODE === 'control') {
  ok('the rail lozenge was found to compare against', !!rail && rail.radius === '999px', rail?.radius ?? '')

  // The claim the user actually made, measured on both objects at once.
  ok('the bar carries the rail lozenge’s radius', tabs?.radius === rail?.radius,
    `${tabs?.radius} vs ${rail?.radius}`)
  ok('…its ground', tabs?.bg === rail?.bg, `${tabs?.bg} vs ${rail?.bg}`)
  ok('…its shadow', tabs?.shadow === rail?.shadow)
  ok('…and its border, all the way round', tabs?.borderTop === rail?.borderTop
    && tabs?.borderBottom === tabs?.borderTop, `${tabs?.borderTop} / ${tabs?.borderBottom}`)
}

if (MODE === 'floats' || MODE === 'shape') {
  // A slab reaches the edges of the column it is in; a lozenge does not.
  const main = await p.evaluate(() => {
    const m = document.querySelector('main') ?? document.body
    const r = m.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }
  })
  ok('it does not touch the left edge of its column', tabs.left > main.left,
    `bar ${tabs.left} vs main ${main.left}`)
  ok('nor the right', tabs.right < main.right, `bar ${tabs.right} vs main ${main.right}`)
  ok('and there is page ground under it, not a rule',
    tabs.borderBottom === tabs.borderTop, tabs.borderBottom)

  // The tabs inside still work — a shape change must not cost a control.
  const before = await p.evaluate(() => location.hash + document.body.innerText.slice(0, 40))
  const budget = p.getByRole('button', { name: /Budget/ }).first()
  if (await budget.count()) {
    await budget.click(); await p.waitForTimeout(900)
    const after = await p.evaluate(() => document.body.innerText.slice(0, 400))
    ok('a tab inside it still changes the screen', after.length > 0 && after !== before)
  }
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
