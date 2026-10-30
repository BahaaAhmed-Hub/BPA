/**
 * The synced half of the look follows the account, on an address the browser has
 * never seen: the accent arrives after boot, so it has to be applied when it does.
 * (The page's size is not part of this — it is fixed at 90% and read from nothing;
 * see app-is-at-90.mjs.)
 *
 *   node scripts/appearance-follows-prefs.mjs 5199 [accent|control]
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['accent', 'control'].includes(a)) ?? 'accent'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const U = session.user.id
const shared = MODE === 'control' ? {} : { 'professor-accent': 'sky' }
const USERROW = { id: U, email: session.user.email, schedule_rules: { shared_prefs: shared } }

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (m !== 'GET') return r.fulfill({ status: 201, json: [], headers: CORS })
  if (t === 'users') {
    const single = /object/.test(req.headers()['accept'] ?? '')
    return r.fulfill({ json: single ? USERROW : [USERROW], headers: CORS })
  }
  return r.fulfill({ json: [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0, 200)); failed++ })
// A brand-new origin: only the sign-in, nothing the app ever stored.
await page.addInitScript(s => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('bpa-wizard-done', '1')
}, session)
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
const until = async (cond, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise(r => setTimeout(r, 60)) } return cond() }
const read = () => page.evaluate(() => ({
  zoom: document.documentElement.style.zoom,
  stored: localStorage.getItem('professor-compact'),
  accent: localStorage.getItem('professor-accent'),
  token: getComputedStyle(document.documentElement).getPropertyValue('--sb-accent').trim(),
}))

ok('the app is up (positive: the rail is on screen)', await page.locator('[data-side-rail]').count() > 0)
if (MODE === 'accent') {
  // Sky is #7FA9D8; the unfixed page stays on the default amber #F5D14E.
  await until(async () => (await read()).accent != null)
  ok('the saved accent arrived', (await read()).accent != null, JSON.stringify(await read()))
  await until(async () => (await read()).token.toUpperCase() === '#7FA9D8')
  ok('…and the accent token on the page is Sky, not the default amber', (await read()).token.toUpperCase() === '#7FA9D8', JSON.stringify(await read()))
}
if (MODE === 'control') {
  await new Promise(r => setTimeout(r, 1500))
  const s = await read()
  ok('CONTROL: nothing saved on the server, so the accent stays the default amber', s.token.toUpperCase() === '#F5D14E' && s.accent == null, JSON.stringify(s))
}
await br.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
