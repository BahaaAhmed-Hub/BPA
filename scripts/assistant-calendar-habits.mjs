// node scripts/assistant-calendar-habits.mjs   — needs a dev server on 5199
//
// The assistant can move and edit events (it could only create and delete) and make and change habits (it
// could only log them). Google Calendar is faked and RECORDS every PATCH with its query string; the habit
// store is the real one. Claims are read off the request that went out, and off the store.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { approvalFor } from '../src/lib/assistantPolicy.ts'
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const j = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(x) })
const events = {
  solo: { id: 'solo', summary: 'Focus time', start: { dateTime: '2030-05-10T09:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2030-05-10T10:30:00Z', timeZone: 'UTC' }, attendees: [{ email: 'a@x.com', self: true, organizer: true }] },
  team: { id: 'team', summary: 'Team sync', start: { dateTime: '2030-05-10T14:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2030-05-10T15:00:00Z', timeZone: 'UTC' }, attendees: [{ email: 'a@x.com', self: true, organizer: true }, { email: 'bob@x.com' }, { email: 'cy@x.com' }] },
}
const patches = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const u = new URL(r.request().url()); if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (u.pathname === '/auth/v1/user') return j(r, user); if (u.pathname.startsWith('/auth/v1/token')) return j(r, session); return j(r, u.pathname.startsWith('/auth') ? {} : []) })
await ctx.route('**://www.googleapis.com/calendar/**', r => { const q = r.request(); const u = new URL(q.url()); if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  const m = u.pathname.match(/\/events\/([^/]+)$/)
  if (m && q.method() === 'GET') return events[m[1]] ? j(r, events[m[1]]) : j(r, { error: { message: 'Not found' } }, 404)
  if (m && q.method() === 'PATCH') { patches.push({ id: m[1], q: u.search, body: JSON.parse(q.postData() || '{}') }); return j(r, { id: m[1] }) }
  return j(r, { items: [] }) })
await ctx.addInitScript(s => { try { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s)); localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'habits', themeId: 'sunlit-bento' }, version: 0 })) } catch {} }, session)
const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
const tool = async (name, input = {}) => p.evaluate(async ([name, input]) => { const t = await import('/src/lib/assistantTools.ts')
  try { return await t.executeTool(name, input, { primaryEmail: 'a@x.com', accounts: [], tasks: [], habits: [], addTask() {}, updateTask() {}, deleteTask() {} }) } catch (e) { return { threw: String(e.message ?? e) } } }, [name, input])
const habits = () => p.evaluate(async () => (await import('/src/store/habitsStore.ts')).useHabitsStore.getState().habits.map(h => ({ name: h.name, freq: h.frequency, type: h.type, goal: h.goal, unit: h.unit, active: h.isActive, emoji: h.emoji, color: h.color })))

// ── calendar ─────────────────────────────────────────────────────────────────
let r = await tool('update_calendar_event', { event_id: 'solo', title: 'Deep work', start_datetime: '2030-05-10T13:00:00Z' })
let pt = patches.at(-1)
ok('moving an event with only a new start keeps its length (1h30)', r.success && pt?.id === 'solo' && pt.body.start.dateTime === '2030-05-10T13:00:00Z' && pt.body.end.dateTime === '2030-05-10T14:30:00.000Z', JSON.stringify(pt?.body))
ok('…and a title change rides along; with no guests nobody is emailed (sendUpdates=none)', pt?.body.summary === 'Deep work' && /sendUpdates=none/.test(pt.q))
patches.length = 0
r = await tool('update_calendar_event', { event_id: 'team', start_datetime: '2030-05-10T16:00:00Z' })
ok('an event with guests is NOT changed on the model\'s say-so: refused, says why, and Google got no write', r.needs_confirmation === true && /2 other guests/.test(r.message) && patches.length === 0, JSON.stringify(r).slice(0, 120))
ok('the policy lets the first call through (it only asks), and puts an approval in front of the confirmed one', approvalFor('update_calendar_event', { event_id: 'team' }) === null && approvalFor('update_calendar_event', { event_id: 'team', confirm_notify_guests: true })?.kind === 'outward')
r = await tool('update_calendar_event', { event_id: 'team', start_datetime: '2030-05-10T16:00:00Z', confirm_notify_guests: true })
pt = patches.at(-1)
ok('confirmed, it is written and the guests are told (sendUpdates=all)', r.success && /2 guests told/.test(r.message) && /sendUpdates=all/.test(pt?.q ?? ''), pt?.q)
patches.length = 0
r = await tool('update_calendar_event', { event_id: 'solo', start_datetime: '2030-05-10T13:00:00Z', end_datetime: '2030-05-10T12:00:00Z' })
ok('an end before the start is refused, with no write', /end must be after/.test(r.threw ?? '') && patches.length === 0)
r = await tool('update_calendar_event', { event_id: 'solo' })
ok('nothing to change is refused', /Nothing to change/.test(r.threw ?? '') && patches.length === 0)
r = await tool('update_calendar_event', { event_id: 'missing', title: 'x' })
ok('an event that does not exist says so', /Not found/.test(r.threw ?? ''))

// ── habits ───────────────────────────────────────────────────────────────────
r = await tool('create_habit', { name: 'Read 20 pages', emoji: '📖' })
let hs = await habits()
ok('create: a yes/no daily habit, with the emoji', r.created && hs.some(h => h.name === 'Read 20 pages' && h.freq === 'daily' && h.type === 'boolean' && h.emoji === '📖' && h.active))
r = await tool('create_habit', { name: 'read 20 PAGES' })
ok('create: the same name again is not made twice', r.already_exists === true && (await habits()).filter(h => /read 20/i.test(h.name)).length === 1)
r = await tool('create_habit', { name: 'Water', type: 'quantity' })
ok('create: a counted habit needs a goal', /goal above zero/.test(r.threw ?? ''))
r = await tool('create_habit', { name: 'Water', type: 'quantity', goal: 8, unit: 'glasses', frequency: 'weekdays' })
hs = await habits()
ok('create: a counted habit keeps its goal, unit and frequency, and a colour from the app\'s own set', hs.some(h => h.name === 'Water' && h.goal === 8 && h.unit === 'glasses' && h.freq === 'weekdays' && /^#[0-9A-Fa-f]{6}$/.test(h.color)))
r = await tool('update_habit', { habit: 'water', goal: 10, name: 'Drink water' })
hs = await habits()
ok('update: found by name, renamed, goal changed', r.updated && hs.some(h => h.name === 'Drink water' && h.goal === 10))
r = await tool('update_habit', { habit: 'drink water', active: false })
ok('update: pausing keeps the habit and its history', (await habits()).some(h => h.name === 'Drink water' && h.active === false))
r = await tool('update_habit', { habit: 'zzz', active: false })
ok('update: an unknown habit is refused, listing the ones that exist', /No habit matches/.test(r.threw ?? '') && /Read 20 pages/.test(r.threw))
await tool('create_habit', { name: 'Read the news' })
r = await tool('update_habit', { habit: 'read', active: false })
ok('update: an ambiguous name is refused, with what matched', /matches 2 habits/.test(r.threw ?? ''), r.threw)
ok('delete is destructive in the policy: it will ask', approvalFor('delete_habit', { habit: 'x' })?.kind === 'destructive')
r = await tool('delete_habit', { habit: 'Read the news' })
ok('delete: gone from the store', r.deleted && !(await habits()).some(h => h.name === 'Read the news'))

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
