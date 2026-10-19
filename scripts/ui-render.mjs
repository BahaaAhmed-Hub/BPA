// ─── UI render — what the browser actually shows ─────────────────────────────
//
//   npx vite --port 5199 --strictPort            (in one shell)
//   node scripts/ui-render.mjs 5199 [--narrow] [--phase=p0-1] [--inject-bad]
//   INK_THEME=glass-depth node scripts/ui-render.mjs 5199     (one theme)
//
// Visits every module (plus the public booking page) in each theme and
// measures, from `getComputedStyle` and the DOM rather than the source:
//
//   1. **the screen opened** — the rail marks it `aria-current`, and at least
//      10 visible text elements are on it. A screen that never opened reports
//      0 violations over 0 elements, which reads exactly like a clean one.
//   2. **type floor** — nothing under 11px; nothing under 12px unless it is
//      uppercase. (Fails until P0.1 lands; that is the baseline.)
//   3. **emoji in visible text** — outside `[data-user-content]`.
//   4. **native dialogs** — any `confirm`/`prompt`/`alert` fired in the run.
//   5. `--narrow` (375x812): no sideways scroll, and every button/link at
//      least 36x36. Gated: enforced only once P1.3 is done.
//   6. screenshots — screenshots/ui/<phase>/<theme>/<module>.png.
//
// **Control: `--inject-bad`.** An init script appends a 9px span holding a
// flame to <body> and calls `window.confirm`. Checks 2, 3 and 4 must all
// fail; if any of them does not, the run says so and exits 1 — a check that
// cannot fail is not a check.
//
// The stub server answers every read with `[]`, so many screens are in their
// empty state. That is deliberate: it is the same on every run and every
// phase, so a before/after pair is comparable. The ink audit is the one that
// needs the dense fixtures.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? '5199'
const argv = process.argv.slice(2)
const NARROW = argv.includes('--narrow')
const BAD = argv.includes('--inject-bad')
const PHASE = argv.find(a => a.startsWith('--phase='))?.slice(8) ?? 'adhoc'
const BASE = `http://localhost:${port}/BPA/`

const ALL_THEMES = ['sunlit-bento', 'warm-minimal', 'glass-depth', 'evergreen']
// Each theme's own `--sb-page`, as Chrome reports it (same table as ink-audit):
// a theme that did not apply is a run about another theme's colours.
const GROUNDS = {
  'sunlit-bento': 'rgb(247, 244, 234)', 'warm-minimal': 'rgb(244, 241, 234)',
  'glass-depth': 'rgb(11, 10, 18)', 'evergreen': 'rgb(245, 247, 246)',
}
const THEMES = process.env.INK_THEME ? [process.env.INK_THEME] : ALL_THEMES
for (const t of THEMES) {
  if (!ALL_THEMES.includes(t)) { console.error(`INK_THEME=${t} is not a theme id. One of: ${ALL_THEMES.join(', ')}`); process.exit(2) }
}

const VIEW = NARROW ? { width: 375, height: 812 } : { width: 1500, height: 1050 }
const MIN_TEXT = 10
const MIN_TAP = 36

// ─── The stub server ─────────────────────────────────────────────────────────
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const BOOKING_PAGE = {
  handle: 'bahaa', name: 'Bahaa', blurb: 'Half an hour, whenever suits.', timezone: 'Africa/Cairo',
  plans: [
    { slug: 'intro', title: 'Intro call', blurb: 'A first conversation.', duration_minutes: 30, location_mode: 'meet', requires_approval: false },
    { slug: 'demo', title: 'Teradix demo', blurb: null, duration_minutes: 45, location_mode: 'place', requires_approval: true },
  ],
}
const BOOKING_SLOTS = (() => {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  return {
    slots: [9, 10, 11].map(h => `${date}T${String(h).padStart(2, '0')}:00:00.000Z`),
    from: new Date().toISOString().slice(0, 10), to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    timezone: 'Africa/Cairo', duration: 30, title: 'Intro call', blurb: 'A first conversation.', location_mode: 'meet', requires_approval: false,
  }
})()

async function stub(ctx) {
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const req = r.request(), u = req.url()
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = json => r.fulfill({ json, headers: CORS })
    if (u.includes('/auth/v1/user')) return j(session.user)
    if (u.includes('/auth/v1/token')) return j(session)
    if (u.includes('/functions/v1/book-me')) {
      const action = new URL(u).searchParams.get('action')
      return j(action === 'profile' ? BOOKING_PAGE : action === 'slots' ? BOOKING_SLOTS : {})
    }
    // Every module on: `has_module` is an rpc, and an empty array reads as "no".
    if (u.includes('/rpc/')) return j(true)
    return j([])
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({
    json: { items: [], threads: [], labels: [] }, headers: CORS,
  }))
}

// ─── The measurement, run inside the page ────────────────────────────────────
// Returns plain data; the verdicts are made in Node. `min`/`tap` are passed in
// as arguments — an init-script/evaluate body cannot see Node variables.
const MEASURE = ({ narrow, tap }) => {
  const EMOJI = /\p{Extended_Pictographic}/u
  const TEXT_SYMBOLS = /[©®™]/g
  const visible = el => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0
  }
  const name = el => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
  }
  // P0.4 — the colour each place draws "Do now" in, read from the page.
  const probe = document.createElement('i'); probe.style.color = 'var(--sb-negative)'; document.body.appendChild(probe)
  const want = getComputedStyle(probe).color; probe.remove()
  const doNow = []
  for (const el of document.querySelectorAll('[data-quadrant="do"]')) if (visible(el)) doNow.push(getComputedStyle(el).color)
  // The other three, so a swapped pair cannot hide behind "do" being right.
  const others = {}
  for (const q of ['schedule', 'delegate', 'eliminate']) others[q] = [...document.querySelectorAll(`[data-quadrant="${q}"]`)].filter(visible).map(el => getComputedStyle(el).color)
  const out = { doNow, others, want, texts: 0, small: [], emoji: [], taps: [], scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }
  const seenSmall = new Set(), seenEmoji = new Set()

  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'PATH'].includes(el.tagName.toUpperCase())) continue
    // The element's *own* text: its direct text nodes, not its children's.
    let own = ''
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent
    own = own.replace(/\s+/g, ' ').trim()
    if (own && visible(el)) {
      out.texts++
      const cs = getComputedStyle(el)
      // SVG text is in the drawing's units; what the eye gets is that times the scale.
      const scale = el instanceof SVGGraphicsElement && el.getScreenCTM() ? el.getScreenCTM().a : 1
      const px = Math.round(parseFloat(cs.fontSize) * scale * 10) / 10
      const upper = cs.textTransform === 'uppercase'
      if (px < 11 || (px < 12 && !upper)) {
        const key = `${px}|${own.slice(0, 30)}`
        if (!seenSmall.has(key)) { seenSmall.add(key); out.small.push({ px, sel: name(el), text: own.slice(0, 40) }) }
      }
      if (EMOJI.test(own.replace(TEXT_SYMBOLS, '')) && !el.closest('[data-user-content]')) {
        const key = own.slice(0, 40)
        if (!seenEmoji.has(key)) { seenEmoji.add(key); out.emoji.push({ sel: name(el), text: own.slice(0, 40) }) }
      }
    }
  }
  if (narrow) {
    for (const el of document.body.querySelectorAll('button, a, [role=button]')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      // `.sb-hit` extends the tappable area past the box with a pseudo-element
      // (--sb-hit-pad each side); that is what a thumb meets, so it counts.
      const pad = el.classList.contains('sb-hit') ? parseFloat(getComputedStyle(el).getPropertyValue('--sb-hit-pad')) || 0 : 0
      const w = r.width + 2 * pad, h = r.height + 2 * pad
      if (w < tap || h < tap) {
        out.taps.push({ sel: name(el), w: Math.round(w), h: Math.round(h),
          text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) })
      }
    }
  }
  return out
}

// The control. A node appended to <body>, outside React's root, so a re-render
// cannot remove it; and a confirm fired after load, outside any handler.
const INJECT = () => {
  const add = () => {
    const s = document.createElement('span')
    s.textContent = '🔥 injected'
    s.style.cssText = 'font-size:9px;text-transform:none;position:fixed;bottom:0;left:0;z-index:99999'
    document.body.appendChild(s)
  }
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add)
  window.addEventListener('load', () => setTimeout(() => window.confirm('injected'), 600))
}

/** Wait until the visible text stops changing — a condition, not a number. */
async function stable(page, cap = 5000) {
  const t0 = Date.now()
  let last = -1, same = 0
  while (Date.now() - t0 < cap && same < 3) {
    const n = await page.evaluate(() => document.body.innerText.length)
    same = n === last ? same + 1 : 0
    last = n
    await page.waitForTimeout(120)
  }
}

// ─── Running ─────────────────────────────────────────────────────────────────
const RAIL = ['Today', 'Dashboard', 'Calendar', 'Mail', 'Tasks', 'Habits', 'Finance', 'Library']
const results = []   // { theme, screen, opened, texts, fails: {type, emoji, narrow, tap}, ... }
const dialogs = []   // { theme, screen, message }
const topBar = []    // { theme, exists, opens }
const calView = []   // { theme, picked }

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

for (const theme of THEMES) {
  mkdirSync(`screenshots/ui/${PHASE}/${theme}${NARROW ? '-375' : ''}`, { recursive: true })
  const shot = (page, name) => page.screenshot({ path: `screenshots/ui/${PHASE}/${theme}${NARROW ? '-375' : ''}/${name}.png`, fullPage: false })
  let current = 'boot'

  const newPage = async ({ signedIn }) => {
    // --narrow is a phone: touch, so `(pointer: coarse)` is true and the app's own hit areas apply.
    const ctx = await br.newContext({ viewport: VIEW, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce', ...(NARROW ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) })
    await stub(ctx)
    const page = await ctx.newPage()
    page.on('pageerror', e => console.log('   [pageerror]', String(e).slice(0, 200)))
    // **Native dialogs.** Dismissed, so a confirm reads as "no" and the run
    // goes on; recorded against the screen that was open.
    page.on('dialog', d => { dialogs.push({ theme, screen: current, message: d.message() }); d.dismiss().catch(() => {}) })
    // Args are passed in: this runs in the page, where Node's variables are not.
    await page.addInitScript(([s, signed, th]) => {
      if (signed) {
        localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
        localStorage.setItem('google_provider_token', 'tok')
        localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
        localStorage.setItem('cal-view', 'week')
      }
      // Merged, never replaced: this runs before every navigation, and Settings
      // is reached by writing `activeModule` and reloading (see ink-audit).
      const prev = (() => { try { return JSON.parse(localStorage.getItem('professor-ui') ?? '{}') } catch { return {} } })()
      localStorage.setItem('professor-ui', JSON.stringify({ ...prev, state: { ...(prev.state ?? {}), themeId: th }, version: 0 }))
    }, [session, signedIn, theme])
    if (BAD) await page.addInitScript(INJECT)
    return page
  }

  const measure = async (page, screen, { opened, shotName }) => {
    await stable(page)
    const m = await page.evaluate(MEASURE, { narrow: NARROW, tap: MIN_TAP })
    const isOpen = opened && m.texts >= MIN_TEXT
    results.push({ theme, screen, opened: isOpen, why: !opened ? 'the screen did not open' : m.texts < MIN_TEXT ? `only ${m.texts} visible text elements` : '', m })
    await shot(page, shotName ?? screen.toLowerCase().replace(/\W+/g, '-')).catch(() => {})
  }

  // ── The app ──
  {
    const page = await newPage({ signedIn: true })
    const traffic = watchTraffic(page)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await settled(page, traffic, 8000)
    // Measured, not assumed: the theme has to be the one asked for.
    const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    if (ground !== GROUNDS[theme]) { console.error(`${theme} did not apply — body is ${ground}, expected ${GROUNDS[theme]}`); process.exit(2) }
    await page.getByText('Skip for now').first().click({ timeout: 1500 }).catch(() => {})

    for (const mod of RAIL) {
      current = mod
      let opened = true
      try {
        const btn = page.locator(`[data-side-rail] button[aria-label="${mod}"]`)
        // A module can be off for this plan; say so rather than pass it.
        await btn.click({ timeout: 4000 })
        await page.locator(`[data-side-rail] button[aria-label="${mod}"][aria-current="page"]`).waitFor({ timeout: 4000 })
      } catch { opened = false }
      if (mod === 'Tasks' && opened) {
        // The matrix is one view of several; ask for it by name if it is offered.
        await page.getByText('Matrix', { exact: true }).first().click({ timeout: 2000 }).catch(() => {})
      }
      if (mod === 'Calendar' && opened && NARROW) {
        // cal-view is stored as 'week' (see the init script): a phone-width window must still open on the day.
        const picked = await page.evaluate(() => [...document.querySelectorAll('[data-cal-header] [role=tab]')].filter(b => b.getAttribute('aria-selected') === 'true').map(b => b.textContent.trim()))
        calView.push({ theme, picked })
      }
      await measure(page, mod, { opened })
    }

    // P1.1 — the top bar's Search opens the command palette; it is not a dead button.
    // Asserted to exist first, then that pressing it brings up the palette's field.
    {
      current = 'Top bar'
      const search = page.locator('button[aria-label="Search everything"]')
      const exists = await search.count() === 1
      let opens = false
      if (exists) {
        await search.click()
        opens = await page.getByPlaceholder(/^Search tasks, calendar/).first().isVisible({ timeout: 2500 }).catch(() => false)
        await page.keyboard.press('Escape')
      }
      topBar.push({ theme, exists, opens })
    }

    // Settings: behind the avatar menu, so reached by writing activeModule and reloading.
    current = 'Settings'
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find(x => x.includes('professor-ui'))
      if (k) { const v = JSON.parse(localStorage.getItem(k)); v.state.activeModule = 'settings'; localStorage.setItem(k, JSON.stringify(v)) }
      location.reload()
    })
    await settled(page, traffic, 8000, { want: 'text=Appearance' })
    const inSettings = await page.getByRole('button', { name: 'Appearance', exact: true }).count() > 0
    await measure(page, 'Settings', { opened: inSettings })
    await page.context().close()
  }

  // ── The public booking page: its own document, no session, no shell ──
  {
    const page = await newPage({ signedIn: false })
    current = 'Public booking'
    const traffic = watchTraffic(page)
    await page.goto(`${BASE}?book=bahaa`, { waitUntil: 'domcontentloaded' })
    await settled(page, traffic, 8000, { shell: null, want: 'text=Intro call' })
    const has = await page.getByText('Intro call').count() > 0
    await measure(page, 'Public booking', { opened: has, shotName: 'public-booking' })
    // The day grid is behind the choice of call: a stranger on a phone reaches it
    // in one tap, and it is the screen the 7 columns have to fit on.
    if (has) {
      await page.getByText('Intro call').first().click({ timeout: 3000 }).catch(() => {})
      const grid = await page.getByRole('button', { name: /times$/ }).first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false)
      await measure(page, 'Public booking · days', { opened: grid, shotName: 'public-booking-days' })
    }
    await page.context().close()
  }
}
await br.close()

// ─── Verdicts ────────────────────────────────────────────────────────────────
let failed = 0
const fail = (s) => { failed++; console.log(`  ✗ ${s}`) }
const MORE = process.env.UI_VERBOSE ? 1000 : 4
const head = (rows, f) => rows.slice(0, MORE).map(f).join('; ') + (rows.length > MORE ? `; … (+${rows.length - MORE})` : '')

const totals = { type: 0, emoji: 0, scroll: 0, tap: 0, unopened: 0 }
for (const theme of THEMES) {
  console.log(`\n${theme}${NARROW ? ' · 375px' : ''}`)
  for (const r of results.filter(x => x.theme === theme)) {
    const line = [`${r.screen.padEnd(15)} ${String(r.m.texts).padStart(4)} text els`]
    console.log(`  ${r.screen.padEnd(15)} ${r.opened ? '' : '✗ NOT OPENED — ' + r.why}${r.opened ? `${r.m.texts} text elements` : ''}`)
    if (!r.opened) { totals.unopened++; failed++; continue }
    if (r.m.small.length) { totals.type += r.m.small.length; fail(`type floor: ${r.m.small.length} — ${head(r.m.small, s => `${s.px}px ${s.sel} “${s.text}”`)}`) }
    if (r.m.emoji.length) { totals.emoji += r.m.emoji.length; fail(`emoji: ${r.m.emoji.length} — ${head(r.m.emoji, s => `${s.sel} “${s.text}”`)}`) }
    if (NARROW) {
      if (r.m.scrollW > r.m.innerW) { totals.scroll++; fail(`sideways scroll: page is ${r.m.scrollW}px wide in a ${r.m.innerW}px window`) }
      if (r.m.taps.length) { totals.tap += r.m.taps.length; fail(`tap targets under ${MIN_TAP}px: ${r.m.taps.length} — ${head(r.m.taps, s => `${s.sel} ${s.w}x${s.h} “${s.text}”`)}`) }
    }
  }
  for (const d of dialogs.filter(x => x.theme === theme)) fail(`native dialog on ${d.screen}: “${d.message}”`)
}

// P1.1 — Search in the top bar opens the palette.
for (const t of topBar) {
  if (!t.exists) { failed++; console.log(`  ✗ ${t.theme}: no Search button in the top bar`) }
  else if (!t.opens) { failed++; console.log(`  ✗ ${t.theme}: Search is pressed and the command palette does not open`) }
  else console.log(`  ✓ ${t.theme}: Search opens the command palette`)
}

// P1.3 — below 760px the calendar opens on the day, though 'week' is what is stored.
for (const c of calView) {
  if (c.picked.length === 1 && c.picked[0] === 'Day') console.log(`  ✓ ${c.theme}: the calendar opens on Day at 375px`)
  else { failed++; console.log(`  ✗ ${c.theme}: the calendar opened on [${c.picked.join(', ') || 'nothing selected'}] at 375px, expected Day`) }
}

// P0.4 — "Do now" must be the same colour wherever it is drawn: on Tasks and
// on the Dashboard, and it must be the negative token. Asserted to EXIST first.
for (const theme of THEMES) {
  const seen = results.filter(x => x.theme === theme && x.m.doNow.length).map(x => ({ screen: x.screen, colours: [...new Set(x.m.doNow)], want: x.m.want }))
  const screens = seen.map(x => x.screen)
  const all = new Set(seen.flatMap(x => x.colours))
  const ok = screens.includes('Dashboard') && all.size === 1 && [...all][0] === seen[0].want
  if (!ok) { failed++; console.log(`  ✗ ${theme}: "Do now" colour — seen on [${screens.join(', ') || 'nowhere'}] as ${[...all].join(' | ') || '—'}, expected ${seen[0]?.want ?? 'var(--sb-negative)'}`) }
  else console.log(`  ✓ ${theme}: "Do now" is ${[...all][0]} on ${screens.join(' and ')}`)
}

console.log(`\n${THEMES.length} theme(s) × ${results.length / THEMES.length} screens · type ${totals.type} · emoji ${totals.emoji} · dialogs ${dialogs.length}` +
  (NARROW ? ` · sideways ${totals.scroll} · taps ${totals.tap}` : '') + (totals.unopened ? ` · NOT OPENED ${totals.unopened}` : ''))

if (BAD) {
  // The control: every check must have fired, or it cannot be trusted.
  const fired = { 'type floor': totals.type > 0, 'emoji': totals.emoji > 0, 'native dialog': dialogs.length > 0 }
  for (const [k, v] of Object.entries(fired)) console.log(`  control · ${k}: ${v ? 'caught the injected fault ✓' : 'MISSED the injected fault ✗'}`)
  if (Object.values(fired).some(v => !v)) { console.log('control FAILED — a check that cannot fail proves nothing'); process.exit(1) }
  console.log('control passed: all three checks failed on the injected faults, as they must')
  process.exit(0)
}
process.exit(failed ? 1 : 0)
