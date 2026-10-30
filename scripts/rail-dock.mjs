#!/usr/bin/env node
/**
 * rail-dock — the main menu's sliding bar and slide-out labels, in the dark theme
 *
 *   node scripts/rail-dock.mjs [dock|control]
 *
 * Measured, not read: the bar's rect against the active tile's rect, the label's
 * rect against the hovered tile's, computed colours for the contrast. `control`
 * removes the inline transform from the bar on the same element, which is the
 * only thing that makes it follow the active module.
 */
import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'

const MODE = process.argv[2] ?? 'dock'
const BASE = 'http://localhost:5199/'
const THEME = process.env.INK_THEME ?? 'glass-depth'

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
await ctx.addInitScript(s => { try { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s)); sessionStorage.setItem('finance-unlocked', '1'); localStorage.setItem('bpa-wizard-done', '1'); localStorage.setItem('professor-wizard-done', '1') } catch {} }, session)
const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 140)))
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

await p.goto(BASE, { waitUntil: 'domcontentloaded' })
await p.evaluate(t => { const ui = JSON.parse(localStorage.getItem('professor-ui') || '{}')
  localStorage.setItem('professor-ui', JSON.stringify({ ...ui, state: { ...(ui.state || {}), activeModule: 'morning', themeId: t }, version: 0 })) }, THEME)
await p.goto(BASE, { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 5600)

const centre = r => r.top + r.height / 2
const rects = () => p.evaluate(() => {
  const pill = document.querySelector('[data-side-rail] > div > div')
  const items = [...pill.querySelectorAll('[data-rail-item]')]
  const on = items.find(i => i.getAttribute('aria-current') === 'page')
  const bar = pill.querySelector('.rail-ind')
  const rc = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, width: r.width, height: r.height } }
  return { n: items.length, labels: items.map(i => i.getAttribute('aria-label')), titles: items.map(i => i.getAttribute('title')),
    on: rc(on), bar: rc(bar), pill: rc(pill), activeLabel: on?.getAttribute('aria-label') }
})

const theme = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sb-page').trim())
console.log(`theme ${THEME}, --sb-page ${theme}`)

ok('no dialog is over the rail', (await p.locator('[role=dialog]').count()) === 0)
let r = await rects()
ok('the rail has module tiles', r.n >= 5, `${r.n}`)
ok('the sliding bar exists', !!r.bar)
ok('no native title on a tile (the label slides out instead)', r.titles.every(t => t === null))
ok('the bar sits beside the active tile', r.bar && Math.abs(centre(r.bar) - centre(r.on)) < 1, r.bar ? `${centre(r.bar).toFixed(1)} vs ${centre(r.on).toFixed(1)}` : '')
ok('the bar is inside the pill, not past its border', r.bar && r.bar.left >= r.pill.left && r.bar.left + r.bar.width < r.on.left)

if (MODE === 'control') {
  await p.evaluate(() => { document.querySelector('.rail-ind').style.transform = 'translateY(0px)' })
  await p.waitForTimeout(500)
  r = await rects()
  ok('control: with the transform removed the bar no longer matches the tile', Math.abs(centre(r.bar) - centre(r.on)) > 1)
  await b.close(); process.exit(0)
}

// Move: press a different module, the bar follows.
const target = r.labels.find(l => l !== r.activeLabel && l !== 'Settings') ?? r.labels[1]
const before = centre(r.bar)
await p.click(`[data-rail-item][aria-label="${target}"]`)
await p.waitForTimeout(700)
r = await rects()
ok(`pressing ${target} makes it the active tile`, r.activeLabel === target)
ok('the bar moved', Math.abs(centre(r.bar) - before) > 5, `${before.toFixed(0)} → ${centre(r.bar).toFixed(0)}`)
ok('and sits beside the new active tile', Math.abs(centre(r.bar) - centre(r.on)) < 1)

// No label until hovered.
await p.mouse.move(700, 500)
ok('no label while nothing is hovered', (await p.locator('.rail-tip').count()) === 0)

// Hover another tile.
const hoverLabel = r.labels.find(l => l !== target)
const box = await p.locator(`[data-rail-item][aria-label="${hoverLabel}"]`).boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await p.waitForTimeout(400)
const tip = await p.evaluate(() => {
  const t = document.querySelector('.rail-tip'); if (!t) return null
  const r = t.getBoundingClientRect(), c = getComputedStyle(t)
  return { text: t.textContent, top: r.top, left: r.left, right: r.right, height: r.height, bg: c.backgroundColor, fg: c.color, op: c.opacity, vw: innerWidth }
})
ok('hovering shows the label', !!tip && tip.text === hoverLabel, tip?.text)
if (tip) {
  // In-page, in CSS units: Playwright's boundingBox is real pixels, and the app is drawn at 90%.
  const t = await p.evaluate(l => { const r = document.querySelector(`[data-rail-item][aria-label="${l}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } }, hoverLabel)
  ok('the label is to the right of the tile, past the pill', tip.left > t.x + t.width + 8, `${tip.left.toFixed(0)} > ${(t.x + t.width).toFixed(0)}`)
  ok('and level with it', Math.abs(tip.top + tip.height / 2 - (t.y + t.height / 2)) < 1.5, `label centre ${(tip.top + tip.height / 2).toFixed(1)} vs tile ${(t.y + t.height / 2).toFixed(1)}`)
  ok('fully visible (opacity 1) and inside the window', tip.op === '1' && tip.right < tip.vw)
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]) }
  const [a, c2] = [lum(tip.bg), lum(tip.fg)].sort((x, y) => y - x)
  const ratio = (a + .05) / (c2 + .05)
  ok('label text reads at 4.5:1 or better', ratio >= 4.5, ratio.toFixed(2))
}
await p.screenshot({ path: process.env.SHOT ?? '/tmp/rail-dock.png', clip: { x: 0, y: 0, width: 420, height: 800 } })

// Keyboard focus shows it too, and leaving removes it.
await p.mouse.move(700, 500)
await p.keyboard.press('Tab')
for (let i = 0; i < 40 && (await p.locator('.rail-tip').count()) === 0; i++) await p.keyboard.press('Tab')
ok('keyboard focus shows a label', (await p.locator('.rail-tip').count()) === 1)
await p.mouse.move(700, 500); await p.locator('main').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
await p.evaluate(() => document.activeElement?.blur())
await p.waitForTimeout(100)
ok('blurring removes it', (await p.locator('.rail-tip').count()) === 0)

await b.close()
console.log(fails ? `\n${fails} failing` : '\nall passing'); process.exit(fails ? 1 : 0)
