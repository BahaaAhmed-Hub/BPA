#!/usr/bin/env node
/**
 * attendee-suggestions — the Attendees field suggests people already on the calendar
 *
 *   node scripts/attendee-suggestions.mjs [compose|edit|control]
 *
 * Google is served with three meetings: Ali is on two, Mona on one, and the
 * organiser (you) on all. Measured in the page: the listbox, its options, which
 * row the Enter hint is on, and what actually reaches the invite (composing: the
 * rows; editing: the PATCH body Google received).
 * Control: nobody is suggested for a name nobody on the calendar has, and a
 * click on an option does not also add the half-typed fragment.
 */
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'compose'
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const NOW = new Date(), TODAY = ymd(NOW)
const TZ = (() => { const o = -NOW.getTimezoneOffset(); const s = o < 0 ? '-' : '+'; const a = Math.abs(o); return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}` })()
const at = (h) => `${TODAY}T${pad(h)}:00:00${TZ}`
const me = { email: user.email, self: true, responseStatus: 'accepted' }
const ALI = { email: 'ali@teradix.com', displayName: 'Ali Hassan' }
const MONA = { email: 'mona@teradix.com', displayName: 'Mona Saleh' }
const EVENTS = [
  { id: 'e1', status: 'confirmed', summary: 'Weekly Sync', start: { dateTime: at(9) },  end: { dateTime: at(10) }, attendees: [me, ALI, MONA], organizer: { email: user.email, self: true } },
  { id: 'e2', status: 'confirmed', summary: 'Design review', start: { dateTime: at(11) }, end: { dateTime: at(12) }, attendees: [me, ALI], organizer: { email: user.email, self: true } },
  { id: 'e3', status: 'confirmed', summary: 'Standup', start: { dateTime: at(14) }, end: { dateTime: at(15) }, attendees: [me], organizer: { email: user.email, self: true } },
]
const patches = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  return j(u.pathname.startsWith('/auth/v1') ? {} : [])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [{ id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6', selected: true }] })
  const m = /\/calendars\/([^/]+)\/events(?:\/([^/?]+))?/.exec(u.pathname)
  if (m) {
    if (q.method() === 'GET') return j({ items: decodeURIComponent(m[1]) === 'primary' ? EVENTS : [] })
    if (q.method() === 'PATCH') { const body = JSON.parse(q.postData() ?? '{}'); patches.push({ id: m[2], body }); return j({ ...EVENTS.find(e => e.id === m[2]), ...body }) }
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'calendar', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('google_provider_token', 'stub-token'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('bpa-wizard-done', '1'); localStorage.setItem('professor-wizard-done', '1')
} catch {} }, session)
const p = await ctx.newPage(); const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const input = () => p.getByPlaceholder('name or name@company.com')
const opts = () => p.evaluate(() => [...document.querySelectorAll('#cal-invitee-list [role=option]')].map(o => ({ text: o.innerText.replace(/\s+/g, ' ').trim(), sel: o.getAttribute('aria-selected'), enter: /Enter/.test(o.innerText) })))
const invited = () => p.evaluate(() => [...document.querySelectorAll('span')].filter(s => /@teradix\.com$/.test(s.textContent ?? '') && s.children.length === 0).map(s => s.textContent))

ok('the meetings are on the grid', /Weekly Sync/.test(await p.evaluate(() => document.body.innerText)))
if (MODE === 'edit') await p.locator('.event-card').filter({ hasText: 'Standup' }).first().click()
else await p.getByRole('button', { name: /New event/ }).click()
await input().waitFor({ timeout: 6000 })
ok('the Attendees field is open', await input().count() === 1)
ok('nothing is listed before anything is typed', (await opts()).length === 0)

await input().click(); await input().fill('ali')
let o = await opts()
ok('typing "ali" lists Ali', o.length === 1 && /Ali Hassan/.test(o[0].text) && /ali@teradix\.com/.test(o[0].text), JSON.stringify(o))
ok('with how many events they share', /on 2 events/.test(o[0]?.text ?? ''))
ok('the first is highlighted and carries the Enter hint', o[0]?.sel === 'true' && o[0]?.enter)
ok('the input says it is a combobox with a list open', await input().getAttribute('aria-expanded') === 'true' && await input().getAttribute('role') === 'combobox')
ok('you are never offered to yourself', !(await opts()).some(x => x.text.includes(user.email)))

await input().fill('teradix')
o = await opts()
ok('a shared domain lists both, the most-shared first', o.length === 2 && /Ali/.test(o[0].text) && /Mona/.test(o[1].text), o.map(x => x.text.split(' ')[0] + ' ' + x.text.split(' ')[1]).join(' | '))
await input().press('ArrowDown'); o = await opts()
ok('ArrowDown moves the highlight', o[1]?.sel === 'true' && o[0]?.sel === 'false' && o[1]?.enter)
await input().press('Escape'); ok('Escape closes the list', (await opts()).length === 0)
if (MODE !== 'control') await input().fill('mo')

if (MODE === 'control') {
  await input().fill('zzz')
  ok('control: a name nobody on the calendar has lists nothing', (await opts()).length === 0 && await input().getAttribute('aria-expanded') === 'false')
  await input().fill('teradix'); o = await opts()
  const box = await p.locator('#cal-invitee-list [role=option]').first().boundingBox()
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(300)
  const got = await invited()
  ok('control: clicking an option adds that person and not the typed fragment', got.length === 1 && got[0] === 'ali@teradix.com', JSON.stringify(got))
  await b.close(); process.exit(fails ? 1 : 0)
}

// Enter takes the highlighted suggestion.
await input().press('Enter'); await p.waitForTimeout(900)
ok('Enter on "mo" adds Mona', (await invited()).includes('mona@teradix.com'), JSON.stringify(await invited()))
ok('and clears the field', await input().inputValue() === '')
await input().fill('mon')
ok('someone already invited is not offered again', (await opts()).length === 0)
await input().fill('ali'); await p.waitForTimeout(100)
const first = p.locator('#cal-invitee-list [role=option]').first()
const bb = await first.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(900)
if (false) { console.log('DBG panel', await p.getByPlaceholder('name or name@company.com').count(), JSON.stringify(bb), await p.evaluate(() => document.body.innerText.slice(0, 300))); await p.screenshot({ path: '/tmp/att-dbg.png' }) }
ok('a click adds Ali', (await invited()).includes('ali@teradix.com'), JSON.stringify(await invited()))
ok('and no error about the half-typed "ali" not being an address', !/is not an email address/.test(await p.evaluate(() => document.body.innerText)))
if (MODE === 'edit') {
  const last = patches.filter(x => x.body.attendees).at(-1)
  ok('editing: Google received the attendees', !!last && last.id === 'e3', JSON.stringify(last?.body.attendees))
  ok('and both people are in the PATCH', !!last && ['mona@teradix.com', 'ali@teradix.com'].every(e => last.body.attendees.some(a => a.email === e)))
  ok('and nobody but the two picked', !!last && last.body.attendees.every(a => /teradix\.com$/.test(a.email)) || (last?.body.attendees.length ?? 0) >= 2)
}
await p.screenshot({ path: process.env.SHOT ?? '/tmp/attendees.png' })
await b.close(); console.log(fails ? `\n${fails} failing` : '\nall passing'); process.exit(fails ? 1 : 0)
