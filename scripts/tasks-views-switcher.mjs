#!/usr/bin/env node
/**
 * tasks-views-switcher — four ways to look at your tasks, one switcher
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/tasks-views-switcher.mjs [5199]
 *
 * P2.4 of docs/ui-unification.md. Board, Matrix, List and the day planner were
 * three tabs and a separate "Plan my day" button that opened a full-page modal.
 * Now they are one tablist, and the planner is a view in the page.
 *
 * Measured on the real screen:
 *   - the tablist "View" has exactly Board · Matrix · List · Plan, in that order,
 *     and there is no "Plan my day" button;
 *   - Plan draws `[data-planner-view]` as part of the page: not position:fixed,
 *     and the switcher is still the topmost element at its own centre (a modal
 *     would cover it) — so the way out is visible;
 *   - it has no ✕ and no Cancel, Escape does not leave it, and it does have
 *     "Apply Plan";
 *   - choosing a task view leaves it; the Filters control (search, hide
 *     completed, group by) is absent in Plan and present elsewhere;
 *   - reload: the last *task* view comes back, the planner never does.
 * Control: the same script on the code before P2.4 fails the first assertion.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? '5199'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
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
await page.addInitScript(([s]) => {
  if (!sessionStorage.getItem('seeded')) {   // seed once: a reload must keep what the page itself wrote
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.removeItem('task-view-mode')
  }
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
}, [session])

async function boot() {
  const traffic = watchTraffic(page)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
  await settled(page, traffic, 9000)
  await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})
  await page.locator('[data-tasks-bar]').waitFor({ timeout: 8000 })
}
const tab = name => page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name, exact: true })
const selected = () => page.evaluate(() => [...document.querySelectorAll('[role=tablist][aria-label="View"] [role=tab][aria-selected=true]')].map(b => b.textContent.trim()))

await boot()
const names = await page.evaluate(() => [...document.querySelectorAll('[role=tablist][aria-label="View"] [role=tab]')].map(b => b.textContent.trim()))
ok('the View tablist is Board · Matrix · List · Plan', JSON.stringify(names) === '["Board","Matrix","List","Plan"]', JSON.stringify(names))
ok('there is no "Plan my day" button any more', await page.getByRole('button', { name: /Plan my day/i }).count() === 0)
ok('it opens on Board (the existing default)', JSON.stringify(await selected()) === '["Board"]', JSON.stringify(await selected()))
ok('the Filters control is there on a task view', await page.getByRole('button', { name: /Filters/ }).count() === 1)

await tab('Plan').click()
await page.locator('[data-planner-view]').waitFor({ timeout: 6000 }).catch(() => {})
const planner = page.locator('[data-planner-view]')
ok('Plan draws the planner as a view (exists and visible)', await planner.count() === 1 && await planner.isVisible())
ok('…and it is not a fixed overlay', await planner.evaluate(el => getComputedStyle(el).position) !== 'fixed')
const where = await page.evaluate(() => {
  const t = document.querySelector('[role=tablist][aria-label="View"] [role=tab][aria-selected=true]')
  const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return { same: t === top || t.contains(top), sel: t.textContent.trim() }
})
ok('the switcher is still the topmost thing at its own centre (a modal would cover it)', where.same, where.sel)
ok('Plan is the selected tab', JSON.stringify(await selected()) === '["Plan"]', JSON.stringify(await selected()))
ok('the planner has "Apply Plan"', await page.getByRole('button', { name: /Apply Plan/ }).count() === 1)
ok('…and no Cancel (it is a view, not a dialog)', await planner.getByRole('button', { name: /^Cancel$/ }).count() === 0)
ok('…and no ✕ (the lucide X icon is not drawn in it)', await planner.locator('svg.lucide-x').count() === 0)
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
ok('Escape does not take you out of it', await planner.count() === 1 && JSON.stringify(await selected()) === '["Plan"]')
ok('the Filters control is absent in Plan (it would act on nothing)', await page.getByRole('button', { name: /Filters/ }).count() === 0)

await tab('Matrix').click(); await page.waitForTimeout(250)
ok('choosing Matrix leaves the planner', await page.locator('[data-planner-view]').count() === 0 && JSON.stringify(await selected()) === '["Matrix"]')
ok('and brings the Filters back', await page.getByRole('button', { name: /Filters/ }).count() === 1)

await tab('List').click(); await page.waitForTimeout(250)
await tab('Plan').click(); await page.locator('[data-planner-view]').waitFor({ timeout: 6000 }).catch(() => {})
await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-tasks-bar]').waitFor({ timeout: 8000 })
await page.waitForTimeout(400)
ok('after a reload the last TASK view (List) is back, not the planner', JSON.stringify(await selected()) === '["List"]' && await page.locator('[data-planner-view]').count() === 0, JSON.stringify(await selected()))
ok('the planner was never written as the saved view', await page.evaluate(() => localStorage.getItem('task-view-mode')) === 'list')

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
