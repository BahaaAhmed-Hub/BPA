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
import { meetRequest, meetLinkOf, meetSentence } from ${JSON.stringify(path.resolve('supabase/functions/_shared/meet.ts'))}
const calls: { method: string; url: string; body: any }[] = []
let existing: any[] = [{ email: 'me@x.com', self: true, organizer: true }, { email: 'old@x.com' }]
let refuse = false
let hasMeet = false
let pending = false
globalThis.fetch = (async (url: string, init: any = {}) => {
  const method = init.method ?? 'GET'
  calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null })
  if (refuse) return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 })
  if (method === 'GET') return new Response(JSON.stringify({ attendees: existing, ...(hasMeet ? { hangoutLink: 'https://meet.google.com/old-old-old' } : {}) }), { status: 200 })
  const wants = init.body && JSON.parse(init.body).conferenceData
  return new Response(JSON.stringify({ summary: 'Sync', start: { dateTime: '2030-05-10T15:00:00' }, ...(wants && !pending ? { hangoutLink: 'https://meet.google.com/new-new-new' } : {}) }), { status: 200 })
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
out.meetNew = await toolAddCalendarEvent('u', { title: 'Call', start: '2030-05-10T15:00:00', add_meet: true })
out.meetNewCall = calls.splice(0)[0]
out.meetUpd = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true })
out.meetUpdCalls = calls.splice(0)
hasMeet = true
out.meetHave = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true })
out.meetHaveCalls = calls.splice(0)
hasMeet = false; pending = true
out.meetPending = await toolAddCalendarEvent('u', { title: 'Call', start: '2030-05-10T15:00:00', add_meet: true })
calls.splice(0); pending = false
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
  ok(`${bot}: Meet — create asks Google for a Meet link`, o.meetNewCall.body.conferenceData?.createRequest?.conferenceSolutionKey?.type === 'hangoutsMeet' && /conferenceDataVersion=1/.test(o.meetNewCall.url) && !/sendUpdates/.test(o.meetNewCall.url), o.meetNewCall.url)
  ok(`${bot}: Meet — the reply carries the link Google returned`, /meet\.google\.com\/new-new-new/.test(o.meetNew), o.meetNew)
  const mp = o.meetUpdCalls.find(c => c.method === 'PATCH')
  ok(`${bot}: Meet — update adds it to an event without one`, !!mp && !!mp.body.conferenceData && /conferenceDataVersion=1/.test(mp.url) && !/sendUpdates/.test(mp.url), JSON.stringify(mp))
  ok(`${bot}: Meet — an event that already has one is left alone and the link is quoted`, !o.meetHaveCalls.some(c => c.method === 'PATCH') && /old-old-old/.test(o.meetHave), o.meetHave)
  ok(`${bot}: Meet — a link Google has not returned is not invented`, /not returned it yet/.test(o.meetPending) && !/meet\.google\.com/.test(o.meetPending), o.meetPending)
  ok(`${bot}: Meet — control: no add_meet sends no conferenceData`, o.plainCalls[0].body.conferenceData === undefined && !/conferenceDataVersion/.test(o.plainCalls[0].url))
  ok(`${bot}: Meet — the schema and prompt offer it`, /add_meet:\s+\{ type: 'boolean'/.test(src) && /add a Meet link/.test(src))
  ok(`${bot}: a refusal is not reported as an invitation`, !/Invited/.test(o.refused) && !o.refusedCalls.some(c => c.method === 'PATCH'), o.refused)
}

// The in-app assistant: the real `create_calendar_event` / `update_calendar_event` cases, lifted out of
// src/lib/assistantTools.ts and run against the same kind of fake Google.
{
  const src = fs.readFileSync('src/lib/assistantTools.ts', 'utf8')
  const grab = name => {
    const a = src.indexOf(`    case '${name}': {`)
    const b = src.indexOf('\n    }\n', a)
    return a < 0 ? null : src.slice(a, b + 7).replace(`case '${name}': {`, `${name}: async (input: any, acctEmail: any, ctx: any) => {`)
  }
  const c = grab('create_calendar_event'), u = grab('update_calendar_event')
  ok('app: both cases found', !!c && !!u)
  ok('app: the schema offers guests / add_guests', /guests:\s+\{ type: 'array'/.test(src) && /add_guests:\s+\{ type: 'array'/.test(src))
  if (c && u) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appinv-'))
    const file = path.join(dir, 'a.ts')
    const fix = t => t.replace(/\n    \}\n$/, '\n    },')
    fs.writeFileSync(file, `
import { parseGuests } from ${JSON.stringify(path.resolve('supabase/functions/_shared/guests.ts'))}
import { meetRequest, meetLinkOf, meetSentence } from ${JSON.stringify(path.resolve('supabase/functions/_shared/meet.ts'))}
const calls: any[] = []
let cur: any = { summary: 'Sync', attendees: [{ email: 'me@x.com', self: true, organizer: true }, { email: 'old@x.com', responseStatus: 'accepted' }], start: { dateTime: '2030-05-10T15:00:00Z' }, end: { dateTime: '2030-05-10T16:00:00Z' } }
const tokenForEmail = async (_: any, __: any) => 't'
const calGet = async (_t: string, p: string) => { calls.push({ method: 'GET', path: p }); return cur }
const setMeet = (on: boolean) => { cur = { ...cur, hangoutLink: on ? 'https://meet.google.com/old-old-old' : undefined } }
const calPost = async (_t: string, p: string, body: any, method = 'POST') => { calls.push({ method, path: p, body }); return { id: 'n1', htmlLink: 'l', ...(body.conferenceData ? { hangoutLink: 'https://meet.google.com/new-new-new' } : {}) } }
const meetOn: any = { v: false }
const T: any = {
${fix(c)}
${fix(u)}
}
const out: any = {}
out.create = await T.create_calendar_event({ title: 'T', start_datetime: '2030-05-10T15:00:00', end_datetime: '2030-05-10T16:00:00', guests: ['ahmed@x.com', 'Sara'] }, undefined, {})
out.createCall = calls.splice(0)[0]
await T.create_calendar_event({ title: 'Solo', start_datetime: 'a', end_datetime: 'b' }, undefined, {})
out.soloCall = calls.splice(0)[0]
out.nameOnly = await T.create_calendar_event({ title: 'T', start_datetime: 'a', end_datetime: 'b', guests: ['Sara'] }, undefined, {}).catch((e: any) => 'ERR ' + e.message)
out.nameOnlyCalls = calls.splice(0).length
out.upd = await T.update_calendar_event({ event_id: 'ev1', add_guests: ['new@x.com', 'OLD@x.com'] }, undefined, {})
out.updCalls = calls.splice(0)
out.plain = await T.update_calendar_event({ event_id: 'ev1', title: 'Renamed' }, undefined, {})
out.plainCalls = calls.splice(0)
out.meetNew = await T.create_calendar_event({ title: 'C', start_datetime: 'a', end_datetime: 'b', add_meet: true }, undefined, {})
out.meetNewCall = calls.splice(0)[0]
cur = { ...cur, attendees: [{ email: 'me@x.com', self: true, organizer: true }] }
out.meetUpd = await T.update_calendar_event({ event_id: 'ev1', add_meet: true }, undefined, {})
out.meetUpdCalls = calls.splice(0)
setMeet(true)
out.meetHave = await T.update_calendar_event({ event_id: 'ev1', add_meet: true }, undefined, {})
out.meetHaveCalls = calls.splice(0)
console.log(JSON.stringify(out))`)
    const o = JSON.parse(execFileSync('node', ['--experimental-strip-types', '--no-warnings', file], { encoding: 'utf8' }).trim().split('\n').pop())
    ok('app: create sends the invitations', /sendUpdates=all/.test(o.createCall.path), o.createCall.path)
    ok('app: create attendees are exactly the real address', JSON.stringify(o.createCall.body.attendees) === '[{"email":"ahmed@x.com"}]', JSON.stringify(o.createCall.body.attendees))
    ok('app: the reply says who was and was not invited', /ahmed@x.com invited/.test(o.create.message) && /Sara/.test(o.create.message), o.create.message)
    ok('app: control — no guests, no attendees, no sendUpdates', o.soloCall.body.attendees === undefined && !/sendUpdates/.test(o.soloCall.path))
    ok('app: only a name creates nothing', /^ERR Not an email/.test(o.nameOnly) && o.nameOnlyCalls === 0, o.nameOnly)
    const pat = o.updCalls.find(x => x.method === 'PATCH')
    ok('app: update keeps the old guest and their reply, adds the new one once', JSON.stringify(pat.body.attendees.map(a => a.email)) === '["me@x.com","old@x.com","new@x.com"]' && pat.body.attendees[1].responseStatus === 'accepted', JSON.stringify(pat.body.attendees))
    ok('app: update with add_guests tells them without asking twice', /sendUpdates=all/.test(pat.path) && o.upd.success === true, JSON.stringify(o.upd))
    ok('app: Meet — create asks for a Meet link and returns the real one', o.meetNewCall.body.conferenceData?.createRequest?.conferenceSolutionKey?.type === 'hangoutsMeet' && /conferenceDataVersion=1/.test(o.meetNewCall.path) && /new-new-new/.test(o.meetNew.message), o.meetNew.message)
    const ap = o.meetUpdCalls.find(x => x.method === 'PATCH')
    ok('app: Meet — update adds one to an event without', !!ap?.body.conferenceData && /conferenceDataVersion=1/.test(ap.path) && /new-new-new/.test(o.meetUpd.message), JSON.stringify(o.meetUpd))
    ok('app: Meet — an event that has one is left alone', !o.meetHaveCalls.some(x => x.method === 'PATCH') && /old-old-old/.test(o.meetHave.message), JSON.stringify(o.meetHave))
    ok('app: Meet — the schema offers it', /add_meet:\s+\{ type: 'boolean'/.test(src))
    ok('app: control — a plain edit of an event with guests still asks first', o.plain.needs_confirmation === true && !o.plainCalls.some(x => x.method === 'PATCH'), JSON.stringify(o.plain))
  }
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
  k('create_calendar_event', { title: 't', guests: ['a@x.com'] }),
  k('create_calendar_event', { title: 't' }),
  JSON.stringify(approvalFor('add_calendar_event', { title: 't', start: 's', guests: ['a@x.com'] })?.lines),
]))`)
const g = JSON.parse(execFileSync('node', ['--experimental-strip-types', '--no-warnings', gate], { encoding: 'utf8' }).trim())
ok('gate: creating with guests is outward', g[0] === 'outward')
ok('gate: control — creating alone is not asked about', g[1] === null && g[2] === null)
ok('gate: adding guests to an event is outward', g[3] === 'outward')
ok('gate: control — a plain edit is not asked about', g[4] === null)
ok('gate: the app\'s create with guests is outward, without is not', g[5] === 'outward' && g[6] === null)
ok('gate: the card shows the real address', /a@x\.com/.test(g[7]))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
