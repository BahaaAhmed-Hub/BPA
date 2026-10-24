// node scripts/auth-survives-dim.mjs
// Needs a dev server on 5199.
//
// "Dim the iPad for ten minutes, reopen, still signed in." Safari freezes the
// tab and may discard and reload it; the access token (1h in prod, here forced
// to be ten minutes past its expiry) is stale on return and only the refresh
// token can restore the session. Four cases, each against a stub /auth/v1:
//   A  expired access token + good refresh token  -> reload -> signed in, refreshed
//   B  no reload: the token runs into its expiry margin while the tab is open,
//      then the tab is shown again (visibilitychange) -> refreshed, still in
//   C  CONTROL: the server refuses the refresh token -> must be signed out
//   D  the refresh call cannot connect (iPad wakes before Wi-Fi is back) -> must
//      NOT be signed out, must keep the stored session, and must reach the
//      shell once the network returns. During the outage the app shows
//      "Loading your system…" - that is measured, not asserted away.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const KEY = 'sb-placeholder-auth-token'
const now = () => Math.floor(Date.now() / 1000)
const stale = () => ({ ...session, access_token: 'stale.' + session.access_token, expires_at: now() - 600 })
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function run(name, mode, { reload = true, seed = stale(), upAfterMs = 0 } = {}) {
  const t0 = Date.now()
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1024, height: 1366 } }) // iPad-ish
  let refreshes = 0
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const q = r.request(); const u = new URL(q.url())
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    const j = (x, status = 200) => r.fulfill({ status, headers: h, contentType: 'application/json', body: JSON.stringify(x) })
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h })
    if (u.pathname.startsWith('/auth/v1/token')) {
      refreshes++
      if (mode === 'refuse') return j({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }, 400)
      if (mode === 'offline' && Date.now() - t0 < upAfterMs) return r.abort('connectionfailed')
      return j({ ...session, access_token: session.access_token, expires_at: now() + 3600, expires_in: 3600 })
    }
    if (u.pathname === '/auth/v1/user') return j(user)
    if (u.pathname.startsWith('/auth/v1')) return j({})
    return j([])
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  // Seed once, on the first document only: a seed on every load would put the
  // stale token back after the app had refreshed it, and prove nothing.
  await ctx.addInitScript(([k, s]) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, JSON.stringify(s)); sessionStorage.setItem('seeded', '1') }
  }, [KEY, seed])
  const p = await ctx.newPage()
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
  if (!reload) {
    // Signed in with ~100s left (outside the 90s margin, so boot does not
    // refresh); the library's 30s ticker then brings it inside, and the tab
    // coming back to the front is what must notice.
    await p.waitForSelector('[data-side-rail]', { timeout: 20000 })
    await p.waitForTimeout(20000)
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await p.waitForTimeout(2000)
  } else {
    await p.reload({ waitUntil: 'domcontentloaded' })
  }
  const early = await p.waitForSelector('[data-side-rail]', { timeout: mode === 'offline' ? 1500 : 15000 }).then(() => true).catch(() => false)
  const loading = (await p.evaluate(() => document.body.innerText)).includes('Loading your system')
  const hint = mode === 'offline' ? await p.waitForSelector('[data-loading-slow]', { timeout: 9000 }).then(() => true).catch(() => false) : null
  const rail = await p.waitForSelector('[data-side-rail]', { timeout: 40000 }).then(() => true).catch(() => false)
  const stored = await p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return 'bad' } }, KEY)
  const body = await p.evaluate(() => document.body.innerText.slice(0, 400))
  await ctx.close()
  return { rail, early, loading, hint, stored, refreshes, body }
}

const A = await run('A', 'ok')
ok(A.rail, 'A signed-in shell is shown after reload with an expired access token')
ok(A.refreshes >= 1, `A the refresh token was exchanged (${A.refreshes} call/s)`)
ok(A.stored && A.stored.expires_at > now() + 1800, 'A stored session now has a fresh expiry')

const B = await run('B', 'ok', { reload: false, seed: { ...session, expires_at: now() + 100 } })
ok(B.rail, 'B still signed in when the tab came back, no reload')
ok(B.refreshes >= 1, `B token refreshed before it could lapse (${B.refreshes} call/s)`)

const C = await run('C', 'refuse')
ok(!C.rail, 'C CONTROL: a refused refresh token signs out (the fixture can fail)')
ok(C.stored === null, 'C CONTROL: stored session removed')

const D = await run('D', 'offline', { upAfterMs: 20000 })
ok(!D.early && D.loading, 'D during the outage: not signed out - the app waits on "Loading your system…"')
ok(D.hint === true, 'D after 6s of waiting the screen says it is still reconnecting and that you are signed in')
ok(C.hint === null && !C.rail, 'D CONTROL: a normal sign-out shows no reconnecting hint')
ok(D.rail, 'D network back: the shell arrives, signed in')
ok(D.stored && D.stored.expires_at > now() + 1800, 'D stored session refreshed once it could connect')

await b.close()
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
