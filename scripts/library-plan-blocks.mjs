// node scripts/library-plan-blocks.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 4d: a plan's time as one repeating block on the primary calendar.
// buildBlock is imported and asked pure questions with the clock fixed; the card
// is then driven with www.googleapis.com intercepted (so the REQUESTS are what is
// asserted, not the pixels) against a PostgREST fake that knows the 20260032
// columns — or, in the last case, does not.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const B1 = '00000000-0000-4000-8000-0000000000b1'
const iso = (d = 0) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const book = { id: B1, user_id: user.id, title: 'Deep Work', authors: ['Cal Newport'], pages: 300, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now }
const T = { library_books: [book], library_sessions: [], library_plans: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [] }
const freshPlan = (extra = {}) => ({ id: 'pl-1', user_id: user.id, book_id: B1, finish_by: iso(10), minutes: 30, per: 'day', created_at: now, block_at: null, block_event_id: null, block_sig: null, ...extra })
let migrated = true
let gcal = []        // { method, path, body }
let gmode = 'ok'     // ok | gone | refuse | failPost
let nextId = 1

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1500 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_plans' && !migrated && (u.searchParams.get('select') ?? '').includes('block_')) return json(r, { code: '42703', message: 'column does not exist' }, 400)
    if (m === 'GET') {
      if (t === 'library_plans' && !migrated) return json(r, T[t].map(({ block_at, block_event_id, block_sig, ...rest }) => rest))
      return json(r, T[t])
    }
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_plans') for (const row of rows) {
        if (!migrated && Object.keys(row).some(k => k.startsWith('block_'))) return json(r, { code: 'PGRST204', message: 'block' }, 400)
        if (row.block_at != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.block_at)) return json(r, { code: '23514', message: 'block_at' }, 400)
      }
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
    return json(r, [])
  })
  await ctx.route('**://www.googleapis.com/**', r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    const mm = u.pathname.match(/calendars\/([^/]+)\/events(?:\/([^/?]+))?/)
    if (!mm || m === 'GET') {
      if (u.pathname.endsWith('/events')) return json(r, { items: [] })
      if (u.pathname.includes('/users/me/calendarList')) return json(r, { items: [] })
      return json(r, {})
    }
    gcal.push({ method: m, cal: decodeURIComponent(mm[1]), id: mm[2], body: q.postData() ? JSON.parse(q.postData()) : null })
    if (m === 'POST') return gmode === 'failPost' ? json(r, { error: { message: 'no' } }, 403) : json(r, { id: 'ev-' + nextId++ })
    if (gmode === 'gone') return json(r, { error: { message: 'Not Found' } }, 404)
    if (gmode === 'refuse') return json(r, { error: { message: 'forbidden' } }, 403)
    if (m === 'DELETE') return r.fulfill({ status: 204, body: '' })
    return json(r, { id: mm[2] })
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'shelf')
    localStorage.setItem('google_provider_token', 'tok-primary')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  } catch {} }, session)
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)
const panel = () => p.getByRole('complementary')
const calls = (method) => gcal.filter(c => c.method === method)

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/src/modules/library/planBlock.ts')
  const bk = { id: 'b', title: 'Deep Work', authors: ['Cal Newport'], pages: 300, status: 'reading' }
  const P = (extra = {}) => ({ id: 'p', bookId: 'b', per: 'day', minutes: 30, createdAt: '', ...extra })
  const T0 = '2026-10-12', tz = 'Africa/Cairo'
  const b = (plan, at, hm = '09:00') => m.buildBlock(bk, plan, at, tz, T0, hm)
  const dur = r => r.ok ? (new Date(r.event.end.dateTime) - new Date(r.event.start.dateTime)) / 60000 : null
  return {
    later: b(P({ finishBy: '2026-10-21' }), '20:00'), earlier: b(P({ finishBy: '2026-10-21' }), '07:00'), same: b(P({ finishBy: '2026-10-21' }), '09:00'),
    weekly: b(P({ per: 'week', finishBy: '2026-10-26' }), '20:00'), weekly2: b(P({ per: 'week', finishBy: '2026-10-25' }), '20:00'),
    open: b(P(), '20:00'), openWeek: b(P({ per: 'week' }), '20:00'),
    nomin: b(P({ minutes: undefined }), '20:00'), badtime: b(P(), '25:00'), badtime2: b(P(), ''), past: b(P({ finishBy: '2026-10-10' }), '20:00'),
    lastday: b(P({ finishBy: '2026-10-12' }), '20:00'), lastdayEarly: b(P({ finishBy: '2026-10-12' }), '07:00'),
    long: b(P({ finishBy: '2028-10-12' }), '20:00'), longw: b(P({ per: 'week', finishBy: '2030-10-12' }), '20:00'),
    d90: dur(b(P({ minutes: 90 }), '20:00')), d30: dur(b(P(), '20:00')),
    sigs: [m.blockSig(bk, P(), '20:00'), m.blockSig(bk, P(), '21:00'), m.blockSig(bk, P({ minutes: 45 }), '20:00'), m.blockSig(bk, P({ per: 'week' }), '20:00'), m.blockSig(bk, P({ finishBy: '2026-11-01' }), '20:00'), m.blockSig({ title: 'Other' }, P(), '20:00'), m.blockSig(bk, P(), '20:00')],
    valid: ['00:00', '23:59', '24:00', '9:30', '12:60', '', '12:3'].map(m.validTime),
  }
})
const rr = r => r.ok ? r.event.recurrence[0] : r.error
ok('a time still ahead today starts today; one that has passed starts tomorrow', u.later.first === '2026-10-12' && u.earlier.first === '2026-10-13' && u.same.first === '2026-10-13', `${u.later.first} ${u.earlier.first} ${u.same.first}`)
ok('daily to a finish date: one block a day inclusive of both ends', rr(u.later) === 'RRULE:FREQ=DAILY;COUNT=10' && rr(u.earlier) === 'RRULE:FREQ=DAILY;COUNT=9', `${rr(u.later)} ${rr(u.earlier)}`)
ok('weekly: one block a week, the first week counted', rr(u.weekly) === 'RRULE:FREQ=WEEKLY;COUNT=3' && rr(u.weekly2) === 'RRULE:FREQ=WEEKLY;COUNT=2', `${rr(u.weekly)} ${rr(u.weekly2)}`)
ok('no finish date is four weeks, never a series with no end', rr(u.open) === 'RRULE:FREQ=DAILY;COUNT=28' && rr(u.openWeek) === 'RRULE:FREQ=WEEKLY;COUNT=4', `${rr(u.open)} ${rr(u.openWeek)}`)
ok('COUNT, not UNTIL (UNTIL on a timed event is a timezone question)', !/UNTIL/.test(rr(u.later)))
ok('no minutes: refused, naming why', !u.nomin.ok && /minutes/.test(u.nomin.error))
ok('a bad or missing time is refused', !u.badtime.ok && !u.badtime2.ok && /time of day/.test(u.badtime.error))
ok('a finish date already gone is refused rather than writing a series in the past', !u.past.ok && /passed/.test(u.past.error))
ok('finishing today: one block if the time is ahead, none to make if it has passed', u.lastday.ok && rr(u.lastday) === 'RRULE:FREQ=DAILY;COUNT=1' && !u.lastdayEarly.ok)
ok('the series is capped (366 daily, 52 weekly)', rr(u.long) === 'RRULE:FREQ=DAILY;COUNT=366' && rr(u.longw) === 'RRULE:FREQ=WEEKLY;COUNT=52', `${rr(u.long)} ${rr(u.longw)}`)
ok('the block is as long as the minutes', u.d90 === 90 && u.d30 === 30)
ok('the event names the book and carries the timezone', u.later.event.summary === '📖 Read: Deep Work' && u.later.event.start.timeZone === 'Africa/Cairo' && /Cal Newport/.test(u.later.event.description))
ok('the signature moves with time, minutes, per, date and title — and only those', new Set(u.sigs.slice(0, 6)).size === 6 && u.sigs[0] === u.sigs[6])
ok('time validation: 00:00 and 23:59 pass; 24:00, 9:30, 12:60, empty fail', u.valid.join() === 'true,true,false,false,false,false,false', u.valid.join())
await ctx.close()

// ── the card ────────────────────────────────────────────────────────────────
const reset = (planExtra = {}, plan = true) => { T.library_plans = plan ? [freshPlan(planExtra)] : []; gcal = []; gmode = 'ok'; nextId = 1 }
const openBook = async () => { await p.getByRole('button', { name: /Deep Work by/ }).click(); await wait(1000) }
const stored = () => T.library_plans[0]
const status = () => panel().getByRole('status', { name: 'Calendar block' }).innerText()

reset()
;({ p, ctx } = await open()); await openBook()
ok('a plan with minutes offers a time and a Block button, and has written nothing to Google', await panel().getByLabel('Time of day for the calendar block').count() === 1 && await panel().getByRole('button', { name: 'Block this time' }).count() === 1 && gcal.length === 0)
ok('it says what it will make before it makes it', /One repeating 30 min block every day until/.test(await status()), await status())
await panel().getByLabel('Time of day for the calendar block').fill('23:59')
await panel().getByRole('button', { name: 'Block this time' }).click(); await wait(1500)
const post = calls('POST')[0]
ok('exactly one POST, to the primary calendar', calls('POST').length === 1 && post?.cal === 'primary', JSON.stringify(gcal.map(c => c.method + ' ' + c.cal)))
ok('it carries a daily recurrence to the finish date', post && /^RRULE:FREQ=DAILY;COUNT=11$/.test(post.body.recurrence[0]), post?.body.recurrence?.[0])
ok('title and length are the book\'s and the plan\'s', post && post.body.summary === '📖 Read: Deep Work' && (new Date(post.body.end.dateTime) - new Date(post.body.start.dateTime)) === 30 * 60000)
ok('the plan remembers the event, the time and what it was built from', stored().block_event_id === 'ev-1' && stored().block_at === '23:59' && /^23:59\|30\|day\|/.test(stored().block_sig ?? ''), JSON.stringify(stored()))
ok('the card says it is on the calendar, and Block is now an unavailable Update', /On your calendar: every day at 23:59, 30 min/.test(await status()) && await panel().getByRole('button', { name: 'Update the block' }).isDisabled())

await panel().getByLabel('Minutes').fill('45'); await wait(1500)
ok('changing the plan turns the block stale and says so', /no longer matches this plan/.test(await status()) && await panel().getByRole('button', { name: 'Update the block' }).isEnabled())
ok('and nothing was written to Google by the edit itself', calls('PATCH').length === 0 && calls('POST').length === 1)
await panel().getByRole('button', { name: 'Update the block' }).click(); await wait(1500)
const patch = calls('PATCH')[0]
ok('Update PATCHes the same event with the new length — no second event', calls('PATCH').length === 1 && patch.id === 'ev-1' && calls('POST').length === 1 && (new Date(patch.body.end.dateTime) - new Date(patch.body.start.dateTime)) === 45 * 60000)
ok('and the signature catches up', /^23:59\|45\|day\|/.test(stored().block_sig ?? '') && /45 min/.test(await status()))

// a different time of day alone is also stale
await panel().getByLabel('Time of day for the calendar block').fill('22:15'); await wait(300)
ok('the time picker alone makes it stale (nothing sent until Update)', /no longer matches/.test(await status()) && calls('PATCH').length === 1)

// the event was deleted in Google meanwhile
gmode = 'gone'
await panel().getByRole('button', { name: 'Update the block' }).click(); await wait(1500)
ok('Update on an event deleted in Google makes a fresh one instead of failing', calls('PATCH').length === 2 && calls('POST').length === 2 && stored().block_event_id === 'ev-2' && stored().block_at === '22:15' && await panel().getByRole('alert').count() === 0, JSON.stringify(gcal.map(c => c.method)))

// Take it off: Google refuses → the id is kept
gmode = 'refuse'
await panel().getByRole('button', { name: 'Take it off' }).click(); await wait(1200)
ok('a refused delete keeps the id and says the block is still there', stored().block_event_id === 'ev-2' && /still on your calendar/.test(await panel().getByRole('alert').innerText()))
gmode = 'ok'
await panel().getByRole('button', { name: 'Take it off' }).click(); await wait(1500)
ok('Take it off DELETEs that event and forgets it', calls('DELETE').length === 2 && calls('DELETE')[1].id === 'ev-2' && stored().block_event_id == null && stored().block_at == null && stored().block_sig == null && !(await panel().getByRole('alert').count()), JSON.stringify(stored()))
ok('the plan itself is untouched', stored().minutes === 45 && stored().finish_by === iso(10) && /One repeating 45 min block/.test(await status()))

// Take it off when Google has already lost it
await panel().getByLabel('Time of day for the calendar block').fill('23:50')
await panel().getByRole('button', { name: 'Block this time' }).click(); await wait(1500)
gmode = 'gone'
await panel().getByRole('button', { name: 'Take it off' }).click(); await wait(1500)
ok('taking off an event already gone is success, not an error', stored().block_event_id == null && await panel().getByRole('alert').count() === 0)

// POST refused: nothing remembered
reset(); gmode = 'failPost'
await ctx.close(); ;({ p, ctx } = await open()); await openBook()
await panel().getByRole('button', { name: 'Block this time' }).click(); await wait(1500)
ok('a refused POST remembers nothing and says why', stored().block_event_id == null && /Google said no/.test(await panel().getByRole('alert').innerText()))

// Removing a plan takes its block with it, first
reset(); await ctx.close(); ;({ p, ctx } = await open()); await openBook()
await panel().getByLabel('Time of day for the calendar block').fill('23:59')
await panel().getByRole('button', { name: 'Block this time' }).click(); await wait(1500)
gmode = 'refuse'
await panel().getByRole('button', { name: 'Remove this plan' }).click(); await wait(1500)
ok('removing a plan whose block Google will not remove keeps the plan (the id is the only handle)', T.library_plans.length === 1 && stored().block_event_id === 'ev-1' && /still on your calendar/.test(await panel().getByRole('alert').innerText()))
gmode = 'ok'
await panel().getByRole('button', { name: 'Remove this plan' }).click(); await wait(1800)
ok('removing it again deletes the event, then the plan', calls('DELETE').filter(c => c.id === 'ev-1').length === 2 && T.library_plans.length === 0, `deletes=${JSON.stringify(calls('DELETE').map(c => c.id))} plans=${T.library_plans.length}`)
await p.keyboard.press('Control+z'); await wait(1200)
ok('undo restores the plan without a block pointing at a deleted event', T.library_plans.length === 1 && stored().block_event_id == null)

// Undo of an edit does not take the block off the plan
reset(); await ctx.close(); ;({ p, ctx } = await open()); await openBook()
await panel().getByLabel('Time of day for the calendar block').fill('23:59')
await panel().getByRole('button', { name: 'Block this time' }).click(); await wait(1500)
await panel().getByLabel('Finish by').fill(iso(5)); await wait(1200)
await panel().getByRole('heading').first().click().catch(() => {}); await p.locator('body').click({ position: { x: 5, y: 5 } }); await wait(200)
await p.keyboard.press('Control+z'); await wait(1200)
ok('undoing a date change puts the date back and leaves the block alone', stored().finish_by === iso(10) && stored().block_event_id === 'ev-1', JSON.stringify(stored()))

// No minutes → no block section
reset({ minutes: null })
await ctx.close(); ;({ p, ctx } = await open()); await openBook()
ok('a plan with no minutes shows no calendar controls', await panel().getByLabel('Time of day for the calendar block').count() === 0)
await ctx.close()

// 20260032 not run
reset(); migrated = false
;({ p, ctx } = await open()); await openBook()
ok('without 20260032 the card names the migration and offers no Block button', /20260032_library_plan_blocks/.test(await panel().innerText()) && await panel().getByRole('button', { name: 'Block this time' }).count() === 0)
ok('and nothing reached Google', gcal.length === 0)
await panel().getByLabel('Minutes').fill('50'); await wait(1500)
ok('while the plan itself still saves', stored().minutes === 50)
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
