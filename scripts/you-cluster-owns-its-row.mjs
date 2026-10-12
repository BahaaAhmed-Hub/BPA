// You, the bell and search — in a row of their own, on every page.
//
// They were drawn `position: fixed` in the window's top-right corner, which
// is a corner each page also uses: on Today it landed **on** the dark
// ON FIRE / CARRIED OVER banner, and no `z-index` answers that, because the
// problem is two things wanting one box rather than one being underneath.
// Owning a row in the content column means nothing can be under them on any
// page, including ones nobody has written yet — 48px, less than the header
// this replaced.
//
// Measured as **rectangles**, not as a class or a style: the claim is that
// two boxes do not overlap, and the only thing that can answer it is their
// geometry. The control re-applies `position: fixed` to the very same
// element and re-measures, so the failure and the fix differ in one property.
//
//   node scripts/you-cluster-owns-its-row.mjs [today|calendar|rail|control]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const MODE = process.argv[2] ?? 'today'
const U = user.id

const COMPANIES = [
  { id: 'co-teradix', name: 'Teradix Ltd',     color: '#3B82F6', users: [], calendarId: 'teradix-cal' },
  { id: 'co-dx',      name: 'DX Technologies', color: '#0C8140', users: [], accountId: 'acc-dx' },
]

// Today's banner is drawn from open tasks, and the urgent ones are what make
// it the dark bar the bell was sitting on. Without them the page has nothing
// in that corner and the overlap cannot be measured at all — a fixture that
// cannot fail is the bug.
const now = new Date().toISOString()
const TASKS = [
  { id: 'tk-1', user_id: U, title: 'Teradix — send the deck', quadrant: 'do', status: 'open', completed: false, urgent: true,  priority: 'P0', company_tag: 'co-teradix', created_at: now },
  { id: 'tk-2', user_id: U, title: 'DX — chase the invoice',  quadrant: 'do', status: 'open', completed: false, urgent: true,  priority: 'P1', company_tag: 'co-dx', created_at: now },
  { id: 'tk-3', user_id: U, title: 'Write the brief',         quadrant: 'schedule', status: 'open', completed: false, urgent: false, priority: 'P2', created_at: now },
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/tasks')) return j(r.request().method() === 'GET' ? TASKS : {})
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary',     summary: user.email,    primary: true,  accessRole: 'owner', backgroundColor: '#9B9180', selected: true },
    { id: 'teradix-cal', summary: 'Teradix Ltd', primary: false, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
  ] })
  if (u.pathname.includes('/events')) return j({ items: [] })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

const START = MODE === 'calendar' ? 'calendar' : 'morning'
await ctx.addInitScript(([s, cos, start]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
} catch { /* quota */ } }, [session, COMPANIES, START])

const p = await ctx.newPage()
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6500)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)

/** What is actually **painted** inside the cluster's box, and whether its
 *  box overlaps the module's at all.
 *
 *  A plain rect-against-rect sweep of `main`'s descendants is wrong here, and
 *  measuring it that way reported eleven collisions on a clean calendar: the
 *  grid is a scroll container, so a row scrolled out of view keeps a rect
 *  above the viewport that intersects anything up there while painting
 *  nothing.
 *
 *  So the question is what is **underneath** the cluster's own box, and the
 *  hit-test has to be taken with the cluster standing aside
 *  (`pointerEvents: none`) — asked through it, every point answers the
 *  cluster itself, however empty the page behind it is, and the control
 *  passes for the wrong reason. Only a hit inside `<main>` counts: the shell
 *  and the body are always behind everything.
 */
const collisions = () => p.evaluate(() => {
  const you = document.querySelector('[data-you]')
  const main = document.querySelector('main')
  if (!you || !main) return { you: null, hits: ['no cluster or no main'], n: 1 }
  const y = you.getBoundingClientRect()
  const m = main.getBoundingClientRect()
  const hits = []
  const was = you.style.pointerEvents
  you.style.pointerEvents = 'none'
  // 11 x 5 points inside the cluster, inset a pixel so an edge is not a hit.
  for (let i = 0; i <= 10; i++) for (let k = 0; k <= 4; k++) {
    const px = y.left + 1 + (y.width - 2) * (i / 10)
    const py = y.top + 1 + (y.height - 2) * (k / 4)
    const el = document.elementFromPoint(px, py)
    if (!el || el === you || you.contains(el)) continue
    if (!main.contains(el)) continue
    hits.push({ tag: el.tagName.toLowerCase(), at: [Math.round(px), Math.round(py)],
                text: (el.innerText || '').slice(0, 40) })
  }
  you.style.pointerEvents = was
  const ow = Math.min(y.right, m.right) - Math.max(y.left, m.left)
  const oh = Math.min(y.bottom, m.bottom) - Math.max(y.top, m.top)
  const overlap = ow > 0 && oh > 0 ? Math.round(ow * oh) : 0
  return { you: { x: y.x, y: y.y, w: y.width, h: y.height },
           main: { x: m.x, y: m.y, w: m.width, h: m.height },
           overlap, hits: hits.slice(0, 6), n: hits.length }
})

ok('the rail is drawn', await p.locator('[data-side-rail]').count() === 1)
ok('the cluster is drawn', await p.locator('[data-you]').count() === 1)

if (MODE === 'rail') {
  // Search moved out of the rail's foot and in beside the two round
  // controls — it is a thing you reach for, not a place you go.
  ok('search is in the cluster', await p.locator('[data-you] button[aria-label="Search everything"]').count() === 1)
  ok('and no longer in the rail', await p.locator('[data-side-rail] button[aria-label="Search everything"]').count() === 0)
  ok('the bell is in the cluster too',
     await p.locator('[data-you] button[aria-label*="otification"], [data-you] button[title*="otification"]').count() >= 1)
  ok('the avatar is in the cluster', await p.locator('[data-you] button[aria-haspopup="menu"]').count() === 1)
  ok('the rail carries no account control at all',
     await p.locator('[data-side-rail] button[aria-haspopup="menu"]').count() === 0)

  // Search, bell, avatar — in that order, left to right, so the thing you
  // press most often is nearest the edge your hand is already at.
  const xs = await p.evaluate(() => {
    const q = s => document.querySelector(s)?.getBoundingClientRect().x ?? null
    return {
      search: q('[data-you] button[aria-label="Search everything"]'),
      avatar: q('[data-you] button[aria-haspopup="menu"]'),
    }
  })
  ok('search sits to the left of the avatar', xs.search !== null && xs.avatar !== null && xs.search < xs.avatar,
     JSON.stringify(xs))

  // **Centred down the window.** Two lozenges pinned to the top edge hang
  // off the corner; centred they read as floating beside the page.
  const rail = await p.evaluate(() => {
    const nav = document.querySelector('[data-side-rail]')
    const groups = [...nav.children].flatMap(c => [...c.children].length ? [...c.children] : [c])
    const n = nav.getBoundingClientRect()
    const boxes = groups.map(g => g.getBoundingClientRect())
    const top = Math.min(...boxes.map(b => b.top))
    const bot = Math.max(...boxes.map(b => b.bottom))
    return { navTop: n.top, navBottom: n.bottom, top, bot,
             gapTop: top - n.top, gapBottom: n.bottom - bot, groups: boxes.length }
  })
  ok('the rail holds two groups', rail.groups === 2, JSON.stringify(rail.groups))
  ok('they are not pinned to the top edge', rail.gapTop > 40, JSON.stringify(rail))
  ok('and they are centred, within 2px',
     Math.abs(rail.gapTop - rail.gapBottom) <= 2, `top=${Math.round(rail.gapTop)} bottom=${Math.round(rail.gapBottom)}`)
  await b.close(); process.exit(code)
}

if (MODE === 'control') {
  // The shape of the bug, on the fixed code: the one property that changed.
  // Restoring it has to bring the overlap back, or the fix was not the fix.
  ok('Today is open', /(ON FIRE|CARRIED OVER|chase the invoice)/i.test(await text()))
  const clean = await collisions()
  ok('owning a row, nothing of the module is underneath it', clean.n === 0, JSON.stringify(clean.hits))
  ok('and the two boxes do not overlap', clean.overlap === 0, JSON.stringify([clean.you, clean.main]))
  await p.evaluate(() => {
    const y = document.querySelector('[data-you]')
    y.style.position = 'fixed'
    y.style.top = '0'; y.style.right = '0'; y.style.zIndex = '200'
  })
  await p.waitForTimeout(400)
  const broke = await collisions()
  ok('made fixed again, the module is drawn under it', broke.overlap > 0,
     `overlap=${broke.overlap}px²`)
  ok('and the module is what is underneath', broke.n > 0,
     `${broke.n} points, e.g. ${JSON.stringify(broke.hits[0])}`)
  await b.close(); process.exit(code)
}

// ─── today / calendar: the cluster's box against the page's own ─────────────
if (MODE === 'today') ok('Today is open', /(ON FIRE|CARRIED OVER|chase the invoice)/i.test(await text()))
else ok('the calendar is open', /Ideal Week/.test(await text()))

const got = await collisions()
ok('the cluster has a real box', (got.you?.w ?? 0) > 80 && (got.you?.h ?? 0) > 20, JSON.stringify(got.you))
ok('it is at the top right', (got.you?.y ?? 99) < 20 && (got.you.x + got.you.w) > 1400, JSON.stringify(got.you))
ok('nothing of the module is underneath it', got.n === 0, `${got.n}: ${JSON.stringify(got.hits)}`)
ok("and its box does not overlap the module's at all", got.overlap === 0, JSON.stringify([got.you, got.main]))

// And the page still gets the rest of the window — a row that quietly ate
// the module would be a different bug in the same place.
const main = await p.evaluate(() => {
  const m = document.querySelector('main').getBoundingClientRect()
  return { top: m.top, h: m.height }
})
ok('the module keeps the rest of the window', main.h > 820, JSON.stringify(main))

await b.close()
process.exit(code)
