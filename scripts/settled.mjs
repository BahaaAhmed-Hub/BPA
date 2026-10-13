// ─── Waiting for the app, rather than for a number ───────────────────────────
//
//  Every browser harness here opened the page and then slept 5–7 seconds,
//  because that is roughly how long boot takes: auth, `hydrate()`, every
//  store's load against the stubbed server, then React committing what came
//  back. Measured across `scripts/`, those blanket settles came to **354
//  seconds** of fixed waiting — about eleven of a twelve-second suite mode,
//  and most of why a round of measurement cost minutes rather than seconds.
//
//  A number is the wrong instrument twice over: too long on a fast boot, and
//  on a slow one it is a **vacuous pass waiting to happen** — the assertions
//  run against a page that has not finished arriving and report about nothing.
//  So wait for the condition:
//
//   1. the app shell is on screen,
//   2. whatever this suite is actually about is on screen,
//   3. the boot's own reads have **stopped arriving** — nothing in flight and
//      nothing started for `quiet` ms. That is `hydrate()` and the store loads
//      being done, and it is generic: every harness here stubs the same hosts.
//
//  `cap` is the old sleep, kept as the ceiling, so **no suite can become
//  slower than it was**. Hitting the cap is not swallowed: the assertions then
//  run on whatever is there and fail honestly, which is what the old sleep did
//  on a slow boot anyway. `SETTLE_DEBUG=1` prints what it waited for.
//
//  `watchTraffic` must be installed **before** the navigation — a counter that
//  starts after the first request has already missed it.

/** The hosts a harness here talks to. A request to one of these is the app
 *  asking for something; nothing else on the page makes any. */
const WATCHED = /placeholder\.supabase\.co|googleapis\.com|i\.ytimg\.com|\/functions\/v1\//

/**
 *  **A request that never finishes must not define "settled".** Measured: the
 *  first run of this helper sat on the full cap every time with one request
 *  outstanding, and it was `oauth2.googleapis.com/tokeninfo` — `googleScopes`
 *  asking Google what a token may do, a host these harnesses do not stub, so
 *  it hangs against the egress proxy until it times out. A websocket (Supabase
 *  Realtime) and any long-poll are the same shape. So a request older than
 *  this stops counting: boot is over, that one is simply still hanging.
 */
const STALE_MS = 1200

export function watchTraffic(page) {
  const started = new Map()   // request → { at, what }
  const t = {
    seen: 0, last: Date.now(), started,
    /** In flight *and* young enough to still be part of boot. */
    pending() {
      const now = Date.now()
      let n = 0
      for (const v of started.values()) if (now - v.at < STALE_MS) n++
      return n
    },
  }
  page.on('request', r => {
    if (!WATCHED.test(r.url())) return
    t.seen++; t.last = Date.now()
    started.set(r, { at: Date.now(), what: `${r.resourceType()} ${r.url().slice(0, 90)}` })
  })
  const done = r => {
    if (!WATCHED.test(r.url())) return
    t.last = Date.now(); started.delete(r)
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return t
}

/**
 *  @param cap    the fixed sleep this replaces — the ceiling, never the cost.
 *  @param shell  the app shell. `[data-side-rail]` is on every signed-in
 *                screen; a harness measuring the sign-in gate or the public
 *                booking page has to name its own, or pass `shell: null`.
 *  @param want   what this suite is about, when it can be named — the
 *                strongest of the three conditions, so pass it where there is
 *                one.
 */
export async function settled(page, traffic, cap = 6500, opts = {}) {
  const { shell = '[data-side-rail]', want = null, quiet = 400, tail = 200 } = opts
  const t0 = Date.now()
  const left = () => Math.max(0, cap - (Date.now() - t0))

  if (shell) { try { await page.waitForSelector(shell, { timeout: left() }) } catch { /* capped */ } }
  if (want)  { try { await page.waitForSelector(want,  { timeout: left() }) } catch { /* capped */ } }

  // `seen === 0` answers at once, which is right: a page that asks for nothing
  // has nothing to wait for — the public booking page is measured on exactly
  // that absence.
  while (left() > 0 && !(traffic.pending() === 0 && Date.now() - traffic.last >= quiet)) {
    await page.waitForTimeout(50)
  }
  // React commits after the last response lands; a short tail, not six seconds.
  await page.waitForTimeout(Math.min(tail, left() || tail))

  const took = Date.now() - t0
  if (process.env.SETTLE_DEBUG) {
    console.log(`  [settled] ${took}ms of ${cap} cap · ${traffic.seen} requests` +
      (took >= cap ? '  ← HIT THE CAP' : ''))
    const now = Date.now()
    for (const v of traffic.started.values())
      console.log(`  [settled]   still open (${now - v.at}ms): ${v.what}`)
  }
  return took
}
