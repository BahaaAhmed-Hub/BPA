#!/usr/bin/env node
/**
 * skeleton-shows-while-loading — "Loading…" is a skeleton now
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/skeleton-shows-while-loading.mjs [5199]
 *
 * P1.2 of docs/ui-unification.md. The Calendar's event fetch is held for
 * 1500ms at the Google stub (the places that said "Loading…" wait on Google,
 * not on Supabase), and the claim is a sequence:
 *   1. while the answer is held, a `[data-skeleton]` is on screen,
 *   2. when it lands, the skeleton is gone and the event is drawn,
 *   3. under prefers-reduced-motion its animation is `none` — and under
 *      no-preference it is the pulse (the control: a check that cannot tell
 *      the two apart proves nothing),
 *   4. no element on the page says the bare word "Loading…".
 * The stub can refuse: with `HOLD=never` the events are never delivered and
 * step 2 must FAIL (the skeleton must not vanish on its own).
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv[2] ?? '5199'
const HOLD_MS = 1500
const NEVER = process.env.HOLD === 'never'
const ME = 'a@x.com'
const D = new Date(); const at = (h, m = 0) => { const d = new Date(D); d.setHours(h, m, 0, 0); return d.toISOString() }
const events = [{ id: 'e1', summary: 'Skeleton check meeting', start: { dateTime: at(13) }, end: { dateTime: at(14) }, status: 'confirmed', calendarId: 'primary', calendarColor: '#7F77DD', organizer: { email: ME } }]
const cals = [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner', accountEmail: ME }]
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) failed++ }

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function run(reducedMotion) {
  const ctx = await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const req = r.request(), u = req.url()
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
    if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
    if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
    return r.fulfill({ json: [], headers: CORS })
  })
  let delivered = false
  await ctx.route('**://*.googleapis.com/**', async r => {
    const u = r.request().url()
    if (/\/calendars\/[^/]+\/events/.test(u)) {
      if (NEVER) { await new Promise(() => {}) }
      await new Promise(res => setTimeout(res, HOLD_MS))
      delivered = true
      return r.fulfill({ json: { items: events }, headers: CORS })
    }
    if (/calendarList/.test(u)) return r.fulfill({ json: { items: cals }, headers: CORS })
    return r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS })
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
  await page.addInitScript(([s, cs]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cs))
    localStorage.setItem('cal-view', 'week')
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  }, [session, cals])
  const traffic = watchTraffic(page)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-side-rail]', { timeout: 15000 })
  await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})
  return { page, ctx, isDelivered: () => delivered, traffic }
}

for (const mode of ['no-preference', 'reduce']) {
  const { page, ctx, isDelivered } = await run(mode)
  const label = `[${mode}]`
  // 1. visible while the answer is held
  let seen = false
  try { await page.waitForSelector('[data-skeleton]', { state: 'visible', timeout: 6000 }); seen = true } catch { /* reported */ }
  ok(`${label} a skeleton is on screen while Google is slow`, seen && !isDelivered())
  const anim = seen ? await page.evaluate(() => getComputedStyle(document.querySelector('[data-skeleton]')).animationName) : '(none on screen)'
  if (mode === 'no-preference') ok(`${label} it pulses (animation: sbPulse)`, anim === 'sbPulse', `animation-name ${anim}`)
  else ok(`${label} prefers-reduced-motion stops the pulse (animation: none)`, anim === 'none', `animation-name ${anim}`)
  // 2. replaced by the content
  if (!NEVER) {
    await page.getByText('Skeleton check meeting').first().waitFor({ timeout: 8000 }).catch(() => {})
    const gone = await page.locator('[data-skeleton]').count() === 0
    const drawn = await page.getByText('Skeleton check meeting').count() > 0
    ok(`${label} the event is drawn and the skeleton is gone`, drawn && gone, `drawn ${drawn}, skeletons left ${await page.locator('[data-skeleton]').count()}`)
  } else {
    await page.waitForTimeout(HOLD_MS + 1500)
    ok(`${label} (control) with the answer never delivered the skeleton stays`, await page.locator('[data-skeleton]').count() > 0)
  }
  // 4. no bare "Loading…"
  const bare = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /^Loading(…|\.\.\.)$/.test(e.textContent.trim())).length)
  ok(`${label} no element says only "Loading…"`, bare === 0, `found ${bare}`)
  await ctx.close()
}
await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
