// node scripts/habit-logs-past-1000.mjs [cap|flaky|deaf]     (needs a dev server on 5199)
//   cap    the 1,000-row ceiling (below)
//   flaky  the second page of the answer fails: this device's own logs must survive it
//   deaf   a server (or proxy, or stub) that ignores the range and answers the same rows every time:
//          the app must still stop asking, and still load what it was given
//
// "I have filled the habits till today, but I can't find my logs for the last 5 days."
//
// PostgREST answers any one read with at most 1,000 rows (`max-rows`), whatever the
// client asked for. `loadHabitLogsFromDB` — and the stale-row check inside
// `saveHabitLogsToDB` — read `habit_logs` with one plain select, so on an account with
// more than 1,000 logged days the answer is the *first* 1,000 rows in the server's own
// order, which is oldest first: the newest days are the ones that never arrive. A
// device that already held them locally kept showing them; a device that had not (a new
// address, a new browser) shows a record that stops five days short.
//
// The stub is the server as it is: it caps a read at 1,000, honours `limit`/`offset` and
// `order` when the app asks, and records every delete — so a fix that pages is accepted
// and a fix that deletes is caught.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'

const MODE = process.argv[2] ?? 'cap'     // cap | flaky
const U = user.id
const DAYS = 200, HABITS = 6, CAP = 1000
const iso = d => d.toISOString().slice(0, 10)
const today = iso(new Date())
const dayN = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d) }
const hab = (i) => ({
  id: `33333333-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, user_id: U, name: `Habit ${i + 1}`, frequency: 'daily', is_active: true,
  current_streak: 0, longest_streak: 0, emoji: '🎯', color: '#3B82F6', type: 'boolean', goal: null, unit: null, image: null, created_at: '2026-01-01T00:00:00Z',
})
const habits = Array.from({ length: HABITS }, (_, i) => hab(i))
// The server's own order: oldest day first (rows are written as the days happen).
let n = 0
let logs = []
for (let back = DAYS - 1; back >= 0; back--) for (const h of habits) logs.push({ id: `log-${String(n++).padStart(5, '0')}`, user_id: U, habit_id: h.id, date: dayN(back), quantity: null, completed: true })
const TOTAL = logs.length                       // 1,200: the newest 30 are past the cap

let biggestAnswer = 0, reads = 0, deletedIds = 0, posted = 0
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(), u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*' } })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/habits')) return j(q.method() === 'GET' ? habits : [])
  if (u.pathname.endsWith('/habit_logs')) {
    if (q.method() === 'GET') {
      reads++
      if (MODE === 'flaky' && (Number(u.searchParams.get('offset') ?? 0) > 0 || /^(\d+)-/.test(q.headers()['range'] ?? '') && !/^0-/.test(q.headers()['range'] ?? ''))) return j({ message: 'upstream timeout', code: '57014' }, 500)
      let rows = [...logs]
      if (MODE === 'deaf') { biggestAnswer = Math.max(biggestAnswer, 50); const sel0 = (u.searchParams.get('select') ?? '*').split(',').map(x => x.trim()); const first = rows.slice(0, 50); return j(sel0[0] === '*' ? first : first.map(row => Object.fromEntries(sel0.map(k => [k, row[k]])))) }
      // `order=date.asc,habit_id.asc` — honoured, so a paging fix with a stable order is accepted.
      const order = u.searchParams.get('order')
      if (order) for (const part of order.split(',').reverse()) { const [col, dir] = part.split('.'); rows.sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)) }
      const off = Number(u.searchParams.get('offset') ?? 0)
      const hdr = /(\d+)-(\d+)/.exec(q.headers()['range'] ?? '')
      const from = hdr ? Number(hdr[1]) : off
      const asked = hdr ? Number(hdr[2]) - Number(hdr[1]) + 1 : Number(u.searchParams.get('limit') ?? Infinity)
      const out = rows.slice(from, from + Math.min(asked, CAP))      // the server's own ceiling
      biggestAnswer = Math.max(biggestAnswer, out.length)
      const sel = (u.searchParams.get('select') ?? '').split(',').map(s => s.trim())
      return j(sel.length && sel[0] !== '*' ? out.map(row => Object.fromEntries(sel.map(k => [k, row[k]]))) : out)
    }
    if (q.method() === 'DELETE') {
      const m = (u.searchParams.get('id') || '').match(/\(([^)]*)\)/)
      const ids = new Set((m ? m[1] : '').split(',').map(s => s.replace(/"/g, '').trim()).filter(Boolean))
      deletedIds += ids.size; logs = logs.filter(x => !ids.has(x.id)); return j([])
    }
    const body = JSON.parse(q.postData() ?? '[]'); posted += [].concat(body).length
    for (const row of [].concat(body)) { const i = logs.findIndex(x => x.habit_id === row.habit_id && x.date === row.date); if (i >= 0) logs[i] = { ...logs[i], ...row }; else logs.push({ id: `new-${logs.length}`, ...row }) }
    return j([])
  }
  return j([])
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [] }, headers: { 'access-control-allow-origin': '*' } }))
// A browser that has never held this account's logs: only the sign-in.
await ctx.addInitScript(([s, mine]) => { try {
  if (mine) localStorage.setItem('professor-habit-logs', JSON.stringify(mine))
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('bpa-wizard-done', '1')
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'habits', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, [session, MODE === 'flaky' ? { [habits[0].id]: [dayN(0), dayN(1), dayN(2)] } : null])
const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 9000)
await p.waitForTimeout(2500)

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const local = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('professor-habit-logs') || '{}') } catch { return {} } })
const have = Object.values(local).reduce((s, d) => s + d.length, 0)
const newest5 = Array.from({ length: 5 }, (_, i) => dayN(i))
const missing = []
for (const h of habits) for (const d of newest5) if (!(local[h.id] ?? []).includes(d)) missing.push(`${h.name} ${d}`)

if (MODE === 'cap') {
ok('the fixture is past the server\'s cap (positive: it holds more than 1,000 rows)', TOTAL > CAP, `${TOTAL} rows`)
ok('the server\'s ceiling was actually in force (positive: no answer was larger than 1,000)', reads > 0 && biggestAnswer <= CAP, `${reads} read(s), biggest answer ${biggestAnswer}`)
ok('the habits hydrated (positive)', Object.keys(local).length === HABITS, `${Object.keys(local).length} habits with logs`)
ok('every one of the last 5 days is there for every habit', missing.length === 0, missing.length ? `${missing.length} missing, e.g. ${missing.slice(0, 3).join(', ')}` : `${HABITS * 5} of ${HABITS * 5}`)
ok('the whole record arrived, not the first 1,000', have === TOTAL, `${have} of ${TOTAL}`)
ok('the app deleted nothing from the server', deletedIds === 0, `${deletedIds} row(s) deleted`)
}
if (MODE === 'deaf') {
  ok('the server really ignored the range (positive: every answer was the same 50 rows)', reads >= 2, `${reads} read(s)`)
  ok('the app stopped asking (did not page for ever)', reads <= 6, `${reads} read(s)`)
  ok('…and loaded what it was given, once', have === 50, `${have} of 50 distinct rows`)
}
if (MODE === 'flaky') {
  const mine = local[habits[0].id] ?? []
  ok('the server really did fail a page (positive)', reads >= 2, `${reads} read(s)`)
  ok('this device\'s own three ticks are still there after a failed read', [dayN(0), dayN(1), dayN(2)].every(d => mine.includes(d)), JSON.stringify(mine.slice(0, 5)))
  ok('and nothing was deleted from the server', deletedIds === 0, `${deletedIds} row(s) deleted`)
}
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
