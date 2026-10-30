#!/usr/bin/env node
/**
 * finance-nav-groups — Finance's tabs are three groups, and Shopping lives in the main menu
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/finance-nav-groups.mjs [5199] [groups|shopping|lock|all]
 *
 * P2.3 of docs/ui-unification.md. Measured on the real screens, not the source:
 *   groups   — the Finance bar's groups are Money [Today, Balance, Budget],
 *              Plan [Goals], Review [Financials, Reports], in that order; the
 *              tabs are not draggable; the bar is still ONE line.
 *   shopping — with Shopping enabled, it is a button in the main rail and NOT a
 *              tab in the Finance bar; pressing it opens the shopping screen.
 *              With it disabled it is in neither (and the rail still has its
 *              other modules, so "absent" is not an empty rail).
 *   lock     — with the finance lock on and locked, the Shopping rail item shows
 *              the lock gate and not the shopping lists.
 * The stub can refuse: every read answers [] and the setting is what's varied.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const argv = process.argv.slice(2)
const port = argv.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = argv.find(a => /^(groups|shopping|lock|all)$/.test(a)) ?? 'all'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function open({ shopping, lock, module = 'finance' }) {
  const ctx = await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const req = r.request(), u = req.url()
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
    if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
    if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
    return r.fulfill({ json: [], headers: CORS })
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
  await page.addInitScript(([s, shop, lk, mod]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('shopping-settings', JSON.stringify({ enabled: shop, viewMode: 'byWeek', priceWatchFrequency: 'off', markCalendarDoneOnPurchase: false, markTaskDoneOnPurchase: false }))
    if (lk) localStorage.setItem('finance-lock', JSON.stringify({ enabled: true, relock: 'session', password: { salt: 'AAAA', hash: 'AAAA', rounds: 1000 } }))
    sessionStorage.removeItem('finance-lock-session')
  }, [session, shopping, lock, module])
  const traffic = watchTraffic(page)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
  await settled(page, traffic, 9000)
  await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})
  return { page, ctx }
}

if (MODE === 'groups' || MODE === 'all') {
  const { page, ctx } = await open({ shopping: false })
  await page.locator('[data-finance-tabs]').waitFor({ timeout: 8000 })
  const g = await page.evaluate(() => [...document.querySelectorAll('[data-finance-group]')].map(el => ({
    group: el.getAttribute('data-finance-group'),
    tabs: [...el.querySelectorAll('button')].map(b => b.textContent.trim()),
    draggable: [...el.querySelectorAll('button')].some(b => b.draggable),
  })))
  ok('the bar has three groups', g.length === 3, JSON.stringify(g.map(x => x.group)))
  ok('Money = Today · Balance · Budget', JSON.stringify(g[0]?.tabs) === JSON.stringify(['Today', 'Balance', 'Budget']), JSON.stringify(g[0]?.tabs))
  ok('Plan = Goals', JSON.stringify(g[1]?.tabs) === JSON.stringify(['Goals']), JSON.stringify(g[1]?.tabs))
  ok('Review = Financials · Reports', JSON.stringify(g[2]?.tabs) === JSON.stringify(['Financials', 'Reports']), JSON.stringify(g[2]?.tabs))
  ok('no tab is draggable', g.every(x => !x.draggable))
  const bar = await page.locator('[data-finance-tabs]').boundingBox()
  ok('the bar is still one line (44px)', Math.abs(bar.height - 44) < 1.5, `${bar.height}px`)
  // exactly one tab is active, and pressing another moves it (a control for "active" being a real state)
  const active = () => page.evaluate(() => [...document.querySelectorAll('[data-finance-tabs] button[data-active]')].map(b => b.textContent.trim()))
  ok('on arrival exactly one tab is active: Today', JSON.stringify(await active()) === '["Today"]', JSON.stringify(await active()))
  await page.locator('[data-finance-group="Review"] button', { hasText: 'Reports' }).click()
  await page.waitForTimeout(250)
  ok('pressing Reports in the Review group makes it the one active tab', JSON.stringify(await active()) === '["Reports"]', JSON.stringify(await active()))
  await page.locator('[data-finance-group="Plan"] button', { hasText: 'Goals' }).click()
  await page.waitForTimeout(250)
  ok('and pressing Goals in Plan moves it there', JSON.stringify(await active()) === '["Goals"]', JSON.stringify(await active()))
  await ctx.close()
}

if (MODE === 'shopping' || MODE === 'all') {
  for (const shopping of [true, false]) {
    const { page, ctx } = await open({ shopping })
    await page.locator('[data-side-rail]').waitFor({ timeout: 8000 })
    const rail = await page.evaluate(() => [...document.querySelectorAll('[data-side-rail] button[aria-label]')].map(b => b.getAttribute('aria-label')))
    const bar = await page.evaluate(() => [...document.querySelectorAll('[data-finance-tabs] button')].map(b => b.textContent.trim()))
    ok(`[shopping ${shopping ? 'on' : 'off'}] the rail has its other modules (not an empty rail)`, rail.includes('Finance') && rail.includes('Tasks'), rail.join(','))
    ok(`[shopping ${shopping ? 'on' : 'off'}] the Finance bar has no Shopping tab`, !bar.includes('Shopping'), bar.join(','))
    ok(`[shopping ${shopping ? 'on' : 'off'}] the rail ${shopping ? 'has' : 'does not have'} Shopping`, rail.includes('Shopping') === shopping)
    if (shopping) {
      await page.locator('[data-side-rail] button[aria-label="Shopping"]').click()
      await page.locator('[data-side-rail] button[aria-label="Shopping"][aria-current="page"]').waitFor({ timeout: 4000 })
      ok('[shopping on] pressing it opens the shopping module (its own marker, visible)', await page.locator('[data-shopping-module]').isVisible())
    }
    await ctx.close()
  }
}

if (MODE === 'lock' || MODE === 'all') {
  const { page, ctx } = await open({ shopping: true, lock: true })
  await page.locator('[data-side-rail] button[aria-label="Shopping"]').click()
  await page.waitForTimeout(400)
  const text = await page.evaluate(() => document.body.innerText)
  ok('[lock on] the Shopping item shows the lock gate', /unlock|password|Touch ID|locked/i.test(text), text.slice(0, 80).replace(/\n/g, ' | '))
  ok('[lock on] and not the shopping lists', !/No shopping lists yet|New list/i.test(text))
  await ctx.close()
}
await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
