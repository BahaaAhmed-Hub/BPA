// A meeting plan that reaches the table — and the visitor's own query for it.
//
// "Nothing can be booked here just now" on the public page is
// `plans.length === 0`, which is `doProfile`'s query coming back empty:
//
//     .eq('user_id', prof.user_id).eq('active', true)
//
// So the question is not whether the panel *drew* a plan, it is whether a row
// with that user and `active` landed in `meeting_plans` at all. The panel's
// "Add one" pushes a row into **local state** with `id: ''`, and `savePlan`
// branches on `row.id` being falsy to choose insert over update — then sends
// the whole object, **the empty id with it**. `id` is
// `uuid primary key default gen_random_uuid()`, so Postgres refuses the
// insert outright and nothing is ever stored.
//
// **The stub therefore has to be able to refuse.** A fake server that accepts
// whatever it is handed cannot tell a well-formed insert from one carrying an
// empty uuid — the lesson `accounts-come-back.mjs` learnt by passing while the
// real project 400'd. This one answers `id: ""` with PostgREST's own 22P02.
//
//   node scripts/plan-actually-saves.mjs [save|switch|visitor]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'save'
const U = user.id

// Every row the server accepted, and every insert it refused.
const stored = []
const refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
  let body = {}
  try { body = JSON.parse(q.postData() ?? '{}') } catch { /* not json */ }

  // The public endpoint, answering exactly as it does for a stranger: the
  // page is live, and `doProfile`'s query comes back with no plans — which is
  // the state behind "nothing can be booked here just now".
  if (u.pathname.endsWith('/functions/v1/book-me')) {
    const visible = stored.filter(r => r.active === true)
    return j({ handle: 'bahaa', name: 'Bahaa', blurb: null, timezone: 'Africa/Cairo',
      plans: visible.map(r => ({ slug: r.slug, title: r.title, blurb: r.blurb ?? null,
        duration_minutes: r.duration_minutes, location_mode: r.location_mode,
        requires_approval: r.requires_approval })) })
  }

  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})

  if (u.pathname.endsWith('/booking_profile')) {
    if (m === 'GET') return j({ user_id: U, handle: 'bahaa', display_name: 'Bahaa', blurb: null, timezone: 'Africa/Cairo', active: true })
    return j({})
  }

  if (u.pathname.endsWith('/meeting_plans')) {
    if (m === 'GET') return j(stored)
    if (m === 'POST') {
      const rows = Array.isArray(body) ? body : [body]
      for (const row of rows) {
        // Postgres, not politeness. An `id` that is present and not a uuid is
        // the whole failure being measured, so it is refused exactly as the
        // real project refuses it.
        if ('id' in row && !UUID.test(String(row.id ?? ''))) {
          refused.push({ why: 'bad-uuid', id: row.id, row })
          return j({ code: '22P02', details: null, hint: null,
            message: `invalid input syntax for type uuid: "${row.id}"` }, 400)
        }
        if (!row.user_id) {
          refused.push({ why: 'no-user', row })
          return j({ code: '23502', message: 'null value in column "user_id"' }, 400)
        }
        stored.push({ ...row, id: row.id || '11111111-2222-3333-4444-555555555555' })
      }
      return j(stored[stored.length - 1] ?? {})
    }
    if (m === 'PATCH') {
      const id = /id=eq\.([^&]+)/.exec(u.search)?.[1]
      const i = stored.findIndex(p => p.id === id)
      if (i >= 0) stored[i] = { ...stored[i], ...body }
      else refused.push({ why: 'patched-a-row-that-is-not-there', id })
      return j([])
    }
    if (m === 'DELETE') return j([])
  }

  if (u.pathname.endsWith('/booking_windows')) {
    if (m === 'GET') return j([{ id: 'w1', on_date: '2026-10-14', start_min: 540, end_min: 720, repeat: { kind: 'weekly', interval: 1, until: null }, skips: [], label: null }])
    return j({})
  }
  if (u.pathname.endsWith('/bookings')) return j([])
  if (u.pathname.endsWith('/tasks') || u.pathname.endsWith('/habits')) return j([])
  return j([])
})

await ctx.route('**://www.googleapis.com/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true },
  ] })
  if (u.pathname.includes('/events')) return j({ items: [] })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
} catch { /* quota */ } }, session)

const p = await ctx.newPage()

// Installed before the first navigation, or the counter misses the boot.

const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)

ok('the calendar is open', /Ideal Week/.test(await text()))
await p.getByRole('button', { name: /^Booking$/ }).click()
await p.waitForTimeout(1200)
ok('the booking panel opens', /Let people book me/i.test(await text()))

// ─── Make a plan the way a person does ──────────────────────────────────────
await p.getByRole('button', { name: /Add one/i }).click()
await p.waitForTimeout(600)
ok('the new plan card opens', /What it is called/i.test(await text()))

if (MODE === 'unsaved') {
  // The failure the user actually hit: the panel shows a call, the visitor's
  // page says nothing can be booked. Nothing is pressed but "Add one", which
  // is the state somebody is in after filling the card and closing the panel.
  await p.getByLabel(/What it is called/i).fill('Intro call')
  await p.waitForTimeout(500)
  const t = await text()
  ok('the card says it is not saved', /not saved yet/i.test(t), JSON.stringify(t.match(/Not saved[^\n]*/i)?.[0]))
  ok('and says what that costs', /nobody can book it/i.test(t))
  ok('nothing reached the table', stored.length === 0, `stored=${stored.length}`)
  // The switch is the one write that bypassed Save, and it said nothing.
  await p.locator('[role="switch"][aria-label*="can be booked"]').last().click()
  await p.waitForTimeout(900)
  ok('switching it on says to save first, rather than failing silently',
     /save it first/i.test(await text()), JSON.stringify((await text()).match(/Save it first[^\n]*/i)?.[0]))
  ok('and still wrote nothing', stored.length === 0 && refused.length === 0,
     `stored=${stored.length} refused=${refused.length}`)
  await b.close(); process.exit(code)
}

if (MODE === 'visitor') {
  // The instrument: the panel asks the public endpoint the stranger asks.
  // With no saved plan it has to report the stranger's own sentence back.
  await p.getByRole('button', { name: /Check what a visitor sees/i }).click()
  await p.waitForTimeout(1500)
  const t = await text()
  ok('the panel reports what a visitor gets', /a visitor/i.test(t), JSON.stringify(t.match(/A visitor[^\n]*/i)?.[0]))
  ok('and quotes the empty sentence they actually see',
     /nothing can be booked here just now/i.test(t))
  ok('naming the unsaved call as the reason', /not saved yet/i.test(t))
  await b.close(); process.exit(code)
}

if (MODE === 'switch') {
  // The one control that writes without going through Save. Its error was
  // thrown away (`void onSave(...)`), so a refusal here was invisible.
  const sw = p.locator('[role="switch"][aria-label*="can be booked"]').last()
  await sw.click()
  await p.waitForTimeout(1200)
  const quiet = refused.length > 0 && !/could not|invalid|uuid/i.test(await text())
  ok('a refused write is never silent', !quiet,
     `refused=${JSON.stringify(refused.map(x => x.why))} saidSomething=${/could not|invalid|uuid/i.test(await text())}`)
  await b.close(); process.exit(code)
}

// `Row` is a <label> wrapping its own text and the input, so the input is
// associated with it — named, not counted, since the card has a dozen fields
// and an index would silently move the day somebody adds one.
await p.getByLabel(/What it is called/i).fill('Intro call')
await p.waitForTimeout(400)

await p.getByRole('button', { name: /^Save$/ }).last().click()
await p.waitForTimeout(1500)

// ─── What actually reached the table ────────────────────────────────────────
ok('the insert was not refused', refused.length === 0, JSON.stringify(refused.slice(0, 2)))
ok('one plan row is stored', stored.length === 1, `stored=${stored.length}`)

const row = stored[0] ?? {}
ok('it carries no empty id', !('id' in row) || UUID.test(String(row.id)), JSON.stringify(row.id))
ok('it belongs to this user', row.user_id === U, String(row.user_id))
ok('it has a slug', typeof row.slug === 'string' && row.slug.length > 0, JSON.stringify(row.slug))
ok('it has a title', typeof row.title === 'string' && row.title.length > 0, JSON.stringify(row.title))
ok('it is active', row.active === true, String(row.active))

// ─── The visitor's own query, run against what was stored ───────────────────
// This is `doProfile`'s filter verbatim. An empty answer here IS the sentence
// "Nothing can be booked here just now", so asserting it is the whole point.
const visible = stored.filter(r => r.user_id === U && r.active === true)
ok('the public page would list it', visible.length === 1,
   `doProfile(user_id=${U}, active=true) → ${visible.length}`)
ok('and it is not the empty state', visible.length > 0)

await b.close()
process.exit(code)
