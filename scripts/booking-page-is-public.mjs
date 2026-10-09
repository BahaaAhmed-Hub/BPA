// The booking page, opened by somebody with no account at all.
//
// The measurement that matters is an **absence**: a stranger's browser must
// not make a single authenticated read. The booking tables have no policy for
// anybody but their owner, so a read from here would be denied — and a denied
// read renders as an empty page, which is the failure this whole shape exists
// to avoid. So the trace is asserted, not just the pixels.
//
//   node scripts/booking-page-is-public.mjs [book|unreadable|taken|manage]
//
// Control: `git stash push -- src` and the same URL shows the sign-in screen —
// the branch in main.tsx is what makes the page reachable at all.
import { chromium } from 'playwright-core'

const MODE = process.argv[2] ?? 'book'
const HANDLE = 'bahaa'
const TZ = 'Africa/Cairo'

// Three days of half hours, as instants, starting tomorrow at 09:00 Cairo.
const day = (n) => {
  const d = new Date(Date.now() + n * 86400000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
const slotsOn = (dateStr, hours) => hours.map(h => `${dateStr}T${String(h - 2).padStart(2, '0')}:00:00.000Z`)
const SLOTS = [...slotsOn(day(1), [9, 10, 11]), ...slotsOn(day(3), [14, 15])]

const PROFILE = {
  handle: HANDLE, name: 'Bahaa', blurb: 'Half an hour, whenever suits.',
  timezone: TZ,
  plans: [
    { slug: 'intro', title: 'Intro call', blurb: 'A first conversation.', duration_minutes: 30, location_mode: 'meet', requires_approval: false },
    { slug: 'demo', title: 'Teradix demo', blurb: null, duration_minutes: 45, location_mode: 'place', requires_approval: true },
  ],
}

const booked = []
const restReads = []
const fnCalls = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 900 }, timezoneId: 'Europe/Berlin' })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request()
  const u = new URL(q.url())
  const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })

  // Anything under /rest/v1 is a table read. From this page there must be none.
  if (u.pathname.startsWith('/rest/v1')) { restReads.push(u.pathname + u.search); return j([]) }

  if (u.pathname.includes('/functions/v1/book-me')) {
    const action = u.searchParams.get('action')
    let body = {}
    try { body = JSON.parse(q.postData() ?? '{}') } catch { /* GET */ }
    fnCalls.push({ action: action ?? body.action, body })

    if (action === 'profile') return j(PROFILE)
    if (action === 'slots') {
      if (MODE === 'unreadable') return j({ unreadable: true, why: 'diary_unreadable', accounts: 1 })
      return j({
        slots: SLOTS, from: day(0), to: day(30), timezone: TZ, duration: 30,
        title: 'Intro call', blurb: 'A first conversation.',
        location_mode: 'meet', requires_approval: false,
      })
    }
    if (action === 'book') {
      if (MODE === 'taken' && booked.length === 0) {
        booked.push('refused')
        return j({ error: 'slot_gone', slots: SLOTS.filter(s => s !== body.start) }, 409)
      }
      booked.push(body)
      return j({
        status: 'confirmed', start: body.start,
        end: new Date(Date.parse(body.start) + 1800000).toISOString(),
        manage_token: 'tok-abc', name: 'Bahaa', title: 'Intro call', location_mode: 'meet',
      }, 201)
    }
    if (action === 'manage') {
      if (body.what === 'cancel') return j({ status: 'cancelled' })
      return j({
        status: 'confirmed', start: SLOTS[0],
        end: new Date(Date.parse(SLOTS[0]) + 1800000).toISOString(),
        title: 'Intro call', name: 'Bahaa', timezone: TZ, duration: 30,
      })
    }
    return j({ error: 'unknown_action' }, 404)
  }
  if (u.pathname.startsWith('/auth/v1')) return j({})
  return j({})
})
await ctx.route('**://www.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)

const url = MODE === 'manage'
  ? 'http://localhost:5199/BPA/?manage=tok-abc'
  : `http://localhost:5199/BPA/?book=${HANDLE}`
await p.goto(url, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)

// **No session anywhere.** This is what a stranger's browser looks like.
const stored = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')))
ok('nobody is signed in', stored.length === 0, JSON.stringify(stored))

if (MODE === 'manage') {
  ok('the booking is shown', /Intro call/.test(await text()), (await text()).slice(0, 120).replace(/\n+/g, ' | '))
  ok('with the time on it', /your booking/i.test(await text()))
  await p.getByRole('button', { name: /Cancel this booking/i }).click()
  await p.waitForTimeout(900)
  ok('and it can be cancelled', /cancelled/i.test(await text()))
  ok('no table was ever read', restReads.length === 0, JSON.stringify(restReads.slice(0, 3)))
  await b.close(); process.exit(code)
}

ok('the page draws without a sign-in', /book a time with/i.test(await text()) && /Bahaa/.test(await text()),
   (await text()).slice(0, 90).replace(/\n+/g, ' | '))
ok('the login screen is nowhere on it', !/Sign in|Continue with Google/i.test(await text()))
ok('both calls are offered', /Intro call/.test(await text()) && /Teradix demo/.test(await text()))

await p.getByRole('button', { name: /Intro call/ }).first().click()
await p.waitForTimeout(1200)

if (MODE === 'unreadable') {
  const t = await text()
  ok('a diary it could not read says so', /cannot be read just now/i.test(t), t.match(/[^\n]*cannot be read[^\n]*/)?.[0] ?? '')
  ok('and never claims there are no times', !/No times are open/i.test(t))
  ok('no table was read even then', restReads.length === 0, JSON.stringify(restReads.slice(0, 3)))
  await b.close(); process.exit(code)
}

// ─── The month, on the visitor's clock ──────────────────────────────────────
// The context is Europe/Berlin and the owner is Africa/Cairo, so a 09:00 Cairo
// slot reads as 08:00 here — and that is what has to be on screen.
const first = SLOTS[0]
// Compared as numbers: the page writes the hour in the browser's own locale
// ("9:00 AM"), and restating that format here would be testing the formatter.
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(Date.parse(first)))
const berlin = hourIn('Europe/Berlin')
const cairo = hourIn(TZ)
ok('the days with something free are the pressable ones',
   (await p.locator('button[aria-label*="times"]').count()) === 2,
   String(await p.locator('button[aria-label*="times"]').count()))

const times = await p.locator('button[aria-pressed]').filter({ hasText: /:/ }).allInnerTexts()
// The *first* pill against the first slot, read both ways. Comparing against
// "is Cairo's hour anywhere in the list" would pass vacuously — Cairo's 10:00
// is Berlin's reading of the slot after it.
const shownFirst = Number(/(\d{1,2}):/.exec(times[0] ?? '')?.[1] ?? -1)
const h12 = (h) => (h % 12 === 0 ? 12 : h % 12)
ok(`the first time is the visitor's reading of it (${berlin}:00 in Berlin, ${cairo}:00 in Cairo)`,
   berlin !== cairo && shownFirst === h12(berlin), JSON.stringify(times))

await p.locator('button[aria-pressed]').filter({ hasText: /:/ }).first().click()
await p.waitForTimeout(500)
ok('picking a time asks who is coming', /your details/i.test(await text()))

await p.getByLabel('Your name').fill('Omar Khalil')
await p.getByLabel('Your email').fill('omar@example.com')
await p.getByLabel('What is it about').fill('About the hosting proposal')
await p.getByRole('button', { name: /^Book it$/ }).click()
await p.waitForTimeout(1200)

if (MODE === 'taken') {
  const t = await text()
  ok('a slot taken a moment earlier says exactly that', /just been taken/i.test(t), t.match(/[^\n]*just been taken[^\n]*/)?.[0] ?? '')
  ok('and the list it offers is the fresh one',
     (await p.locator('button[aria-pressed]').filter({ hasText: /:/ }).count()) === 2,
     String(await p.locator('button[aria-pressed]').filter({ hasText: /:/ }).count()))
  ok('no table was read', restReads.length === 0, JSON.stringify(restReads.slice(0, 3)))
  await b.close(); process.exit(code)
}

// ─── What was sent, and what came back ──────────────────────────────────────
const sent = booked[booked.length - 1]
ok('the booking carried the right plan and slot',
   sent?.handle === HANDLE && sent?.plan === 'intro' && sent?.start === first, JSON.stringify(sent?.start))
ok('and who is coming', sent?.name === 'Omar Khalil' && sent?.email === 'omar@example.com', JSON.stringify([sent?.name, sent?.email]))
ok('and the visitor\'s own zone, so the invitation reads right for them',
   sent?.timezone === 'Europe/Berlin', String(sent?.timezone))

const done = await text()
ok('it says it is booked', /Booked/.test(done) && /Intro call/.test(done), done.slice(0, 100).replace(/\n+/g, ' | '))
ok('it names the invitation that is coming', /calendar invitation/i.test(done))
ok('and offers the way to change it',
   await p.getByRole('link', { name: /Change or cancel/i }).count() === 1)

// ─── The absence that makes all of it mean something ────────────────────────
ok('not one table was read by a stranger\'s browser', restReads.length === 0, JSON.stringify(restReads.slice(0, 4)))
ok('everything went through the function', fnCalls.length >= 3, JSON.stringify(fnCalls.map(c => c.action)))

await b.close()
process.exit(code)
