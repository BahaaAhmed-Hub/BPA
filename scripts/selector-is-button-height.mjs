#!/usr/bin/env node
/**
 * selector-is-button-height — a Segmented control is exactly a Button tall
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/selector-is-button-height.mjs [5199]
 *
 * It was 36px (md) and 38px (lg) beside 34px buttons: the option was floored at
 * --sb-h-min and then the track's padding was added on top. Measured two ways:
 *   probe  — the real `.sb-segmented` and `.sb-btn` classes mounted side by side
 *            in the live page, every size, all four themes, desktop AND a phone
 *            (coarse pointer, where --sb-h-min is 40). sm pairs with a small
 *            button; md and lg with a regular one.
 *   screen — the Segmented the app really draws on Tasks, Habits and Library,
 *            against a Button on the same screen.
 * The probe asserts both elements EXIST and have a size before comparing, and a
 * control case (the old formula, set inline on the very same element) must fail.
 */
import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv[2] ?? '5199'
const THEMES = ['sunlit-bento', 'warm-minimal', 'evergreen', 'glass-depth']
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) failed++ }
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function open(theme, coarse) {
  const ctx = await br.newContext(coarse
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1500, height: 1000 } })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const u = r.request().url()
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: user, headers: CORS })
    if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
    return r.fulfill({ json: [], headers: CORS })
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [] }, headers: CORS }))
  const page = await ctx.newPage()
  await page.addInitScript(([s, t]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('bpa-wizard-done', '1')
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: t }, version: 0 }))
  }, [session, theme])
  const traffic = watchTraffic(page)
  await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
  await settled(page, traffic, 9000)
  return { ctx, page }
}

const probe = page => page.evaluate(() => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;display:flex;gap:8px;align-items:center;z-index:99999'
  host.innerHTML = `
    <button class="sb-btn" data-variant="secondary" id="b-md">Button</button>
    <div class="sb-segmented" data-size="md" id="s-md" role="tablist"><button class="sb-segmented-opt" data-active>One</button><button class="sb-segmented-opt">Two</button></div>
    <div class="sb-segmented" data-size="lg" id="s-lg" role="tablist"><button class="sb-segmented-opt" data-active>One</button><button class="sb-segmented-opt">Two</button></div>
    <button class="sb-btn" data-size="sm" data-variant="secondary" id="b-sm">Small</button>
    <div class="sb-segmented" data-size="sm" id="s-sm" role="tablist"><button class="sb-segmented-opt" data-active>One</button><button class="sb-segmented-opt">Two</button></div>`
  document.body.appendChild(host)
  const h = id => document.getElementById(id).getBoundingClientRect().height
  const r = { bmd: h('b-md'), smd: h('s-md'), slg: h('s-lg'), bsm: h('b-sm'), ssm: h('s-sm') }
  // Control: the old formula (option floored at --sb-h-min, track padding 3px) on the very same element.
  const seg = document.getElementById('s-md'); seg.style.padding = '3px'
  const opt = seg.querySelectorAll('.sb-segmented-opt'); opt.forEach(o => { o.style.height = 'max(var(--sb-h-min), calc(var(--sb-h-pill) - 6px))' })
  r.oldMd = h('s-md')
  host.remove()
  return r
})

for (const coarse of [false, true]) {
  for (const theme of THEMES) {
    const { ctx, page } = await open(theme, coarse)
    const tag = `${coarse ? 'phone' : 'desktop'}/${theme}`
    const r = await probe(page)
    ok(`${tag}: probe elements exist and have a height`, r.bmd > 20 && r.smd > 20 && r.slg > 20 && r.bsm > 20 && r.ssm > 20, JSON.stringify(r))
    ok(`${tag}: md is a Button tall`, Math.abs(r.smd - r.bmd) < 0.5, `${r.smd} vs ${r.bmd}`)
    ok(`${tag}: lg is a Button tall too`, Math.abs(r.slg - r.bmd) < 0.5, `${r.slg} vs ${r.bmd}`)
    ok(`${tag}: sm is a small Button tall`, Math.abs(r.ssm - r.bsm) < 0.5, `${r.ssm} vs ${r.bsm}`)
    if (!coarse && theme === 'sunlit-bento') ok('control: the old formula is taller than a Button (the report)', r.oldMd - r.bmd >= 1.5, `${r.oldMd} vs ${r.bmd}`)
    await ctx.close()
  }
}

// ── The real screens ────────────────────────────────────────────────────────
{
  const { ctx, page } = await open('sunlit-bento', false)
  for (const mod of ['Tasks', 'Habits', 'Library']) {
    await page.locator(`[data-side-rail] button[aria-label="${mod}"]`).click()
    await page.locator('.sb-segmented').first().waitFor({ timeout: 8000 }).catch(() => {})
    await page.waitForFunction(() => [...document.querySelectorAll('.sb-btn')].some(e => e.getBoundingClientRect().width > 0), null, { timeout: 8000 }).catch(() => {})
    const m = await page.evaluate(() => {
      const vis = e => e.getBoundingClientRect().width > 0
      const seg = [...document.querySelectorAll('.sb-segmented')].filter(vis).map(e => e.getBoundingClientRect().height)
      const btn = [...document.querySelectorAll('.sb-btn')].filter(vis).filter(e => e.dataset.size !== 'sm' && !e.hasAttribute('data-icon-only')).map(e => e.getBoundingClientRect().height)
      return { seg, btn }
    })
    ok(`${mod}: it draws a selector and a Button (not a vacuous pass)`, m.seg.length > 0 && m.btn.length > 0, JSON.stringify(m))
    ok(`${mod}: every selector is exactly the Button height`, m.seg.length > 0 && m.btn.length > 0 && m.seg.every(x => Math.abs(x - m.btn[0]) < 0.5), `${m.seg} vs ${m.btn[0]}`)
  }
  await ctx.close()
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
