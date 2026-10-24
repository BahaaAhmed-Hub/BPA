// Telegram and Siri can invite people to an event.
//
// The real toolAddCalendarEvent / toolUpdateCalendarEvent are lifted out of each
// bot's file (no Deno here) and run against a fake Google that records the
// requests and can refuse. The gate is the real _shared/assistantGate.ts.
//   node scripts/bots-invite-guests.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

let failed = 0
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); if (!cond) failed++ }

const lift = (src, name) => {
  const start = src.indexOf(`async function ${name}(`)
  if (start < 0) return null
  const end = src.indexOf('\n}\n', start)
  return src.slice(start, end + 3)
}

for (const bot of ['telegram-bot', 'professor-siri']) {
  const src = fs.readFileSync(`supabase/functions/${bot}/index.ts`, 'utf8')
  const add = lift(src, 'toolAddCalendarEvent'), upd = lift(src, 'toolUpdateCalendarEvent')
  ok(`${bot}: both tools found`, !!add && !!upd)
  ok(`${bot}: the schema offers guests / add_guests`, /guests:\s+\{ type: 'array'/.test(src) && /add_guests:\s+\{ type: 'array'/.test(src))
  ok(`${bot}: the prompt tells the model to ask for an address`, /ASK for the address/.test(src))
  if (!add || !upd) continue

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invite-'))
  const file = path.join(dir, 'h.ts')
  fs.writeFileSync(file, `
import { parseGuests } from ${JSON.stringify(path.resolve('supabase/functions/_shared/googleCalendars.ts'))}
const calls: { method: string; url: string; body: any }[] = []
let existing: any[] = [{ email: 'me@x.com', self: true, organizer: true }, { email: 'old@x.com' }]
let refuse = false
globalThis.fetch = (async (url: string, init: any = {}) => {
  const method = init.method ?? 'GET'
  calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null })
  if (refuse) return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 })
  if (method === 'GET') return new Response(JSON.stringify({ attendees: existing }), { status: 200 })
  return new Response(JSON.stringify({ summary: 'Sync', start: { dateTime: '2030-05-10T15:00:00' } }), { status: 200 })
}) as any
const cal = { calendarId: 'primary', accountId: 'a', accountEmail: 'me@x.com', name: 'Main', primary: true, writable: true }
const hub = {
  configured: true, unreachable: [] as string[],
  pickWritable: async () => cal, token: async () => 't',
  locate: async () => ({ calendar: cal, token: 't', eventId: 'ev1' }),
}
const calendarHub = (_: string) => hub
${add}
${upd}
const out: any = {}
out.created = await toolAddCalendarEvent('u', { title: 'Sync', start: '2030-05-10T15:00:00', guests: ['ahmed@x.com', 'Sara'] })
out.createCalls = calls.splice(0)
out.plain = await toolAddCalendarEvent('u', { title: 'Solo', start: '2030-05-10T15:00:00' })
out.plainCalls = calls.splice(0)
out.updated = await toolUpdateCalendarEvent('u', { event_id: 'ev1::primary', add_guests: ['new@x.com', 'OLD@x.com'] })
out.updateCalls = calls.splice(0)
out.badOnly = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_guests: ['Sara'] })
out.badCalls = calls.splice(0)
refuse = true
out.refused = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_guests: ['new@x.com'] })
out.refusedCalls = calls.splice(0)
console.log(JSON.stringify(out))
`)
  const stdout = execFileSync('node', ['--experimental-strip-types', '--no-warnings', file], { encoding: 'utf8' })
  const o = JSON.parse(stdout.trim().split('\n').pop())

  const post = o.createCalls[0]
  ok(`${bot}: create asks Google to send the invitations`, /sendUpdates=all/.test(post.url), post.url)
  ok(`${bot}: create sends exactly the one address (the name is dropped)`, JSON.stringify(post.body.attendees) === '[{"email":"ahmed@x.com"}]', JSON.stringify(post.body.attendees))
  ok(`${bot}: the reply names who was invited and who was not`, /Invited ahmed@x.com/.test(o.created) && /Not invited[^.]*Sara/.test(o.created), o.created)
  ok(`${bot}: control — no guests means no attendees and no sendUpdates`, o.plainCalls[0].body.attendees === undefined && !/sendUpdates/.test(o.plainCalls[0].url))

  const patch = o.updateCalls.find(c => c.method === 'PATCH')
  ok(`${bot}: update reads the guest list first`, o.updateCalls[0].method === 'GET')
  ok(`${bot}: update keeps the existing guests, adds the new one once`, JSON.stringify(patch.body.attendees.map(a => a.email)) === '["me@x.com","old@x.com","new@x.com"]', JSON.stringify(patch.body.attendees))
  ok(`${bot}: update tells the guests`, /sendUpdates=all/.test(patch.url))
  ok(`${bot}: only a name is refused without touching Google`, o.badCalls.length === 0 && /Not an email address/.test(o.badOnly), o.badOnly)
  ok(`${bot}: a refusal is not reported as an invitation`, !/Invited/.test(o.refused) && !o.refusedCalls.some(c => c.method === 'PATCH'), o.refused)
}

// The gate: guests make it an outward act, in front of the person.
const gate = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')), 'g.ts')
fs.writeFileSync(gate, `
import { approvalFor } from ${JSON.stringify(path.resolve('supabase/functions/_shared/assistantGate.ts'))}
const k = (n: string, i: any) => approvalFor(n, i)?.kind ?? null
console.log(JSON.stringify([
  k('add_calendar_event', { title: 't', start: 's', guests: ['a@x.com'] }),
  k('add_calendar_event', { title: 't', start: 's' }),
  k('add_calendar_event', { title: 't', start: 's', guests: [] }),
  k('update_calendar_event', { event_id: 'e', add_guests: ['a@x.com'] }),
  k('update_calendar_event', { event_id: 'e', title: 'x' }),
  JSON.stringify(approvalFor('add_calendar_event', { title: 't', start: 's', guests: ['a@x.com'] })?.lines),
]))`)
const g = JSON.parse(execFileSync('node', ['--experimental-strip-types', '--no-warnings', gate], { encoding: 'utf8' }).trim())
ok('gate: creating with guests is outward', g[0] === 'outward')
ok('gate: control — creating alone is not asked about', g[1] === null && g[2] === null)
ok('gate: adding guests to an event is outward', g[3] === 'outward')
ok('gate: control — a plain edit is not asked about', g[4] === null)
ok('gate: the card shows the real address', /a@x\.com/.test(g[5]))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
