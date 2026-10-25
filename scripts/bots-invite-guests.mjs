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
import { meetRequest, meetLinkOf, meetSentence, supportsMeet, noMeetSentence } from ${JSON.stringify(path.resolve('supabase/functions/_shared/meet.ts'))}
const calls: { method: string; url: string; body: any; auth?: string }[] = []
let existing: any[] = [{ email: 'me@x.com', self: true, organizer: true }, { email: 'old@x.com' }]
let refuse = false
let hasMeet = false
let pending = false
globalThis.fetch = (async (url: string, init: any = {}) => {
  const method = init.method ?? 'GET'
  calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization })
  if (refuse) return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 })
  if (method === 'GET') return new Response(JSON.stringify({ attendees: existing, ...(hasMeet ? { hangoutLink: 'https://meet.google.com/old-old-old' } : {}) }), { status: 200 })
  const wants = init.body && JSON.parse(init.body).conferenceData
  return new Response(JSON.stringify({ summary: 'Sync', start: { dateTime: '2030-05-10T15:00:00' }, ...(wants && !pending ? { hangoutLink: 'https://meet.google.com/new-new-new' } : {}) }), { status: 200 })
}) as any
const cal: any = { calendarId: 'primary', accountId: 'a', accountEmail: 'me@x.com', name: 'Main', primary: true, writable: true, meetTypes: ['hangoutsMeet', 'eventHangout'] }
const co: any = { calendarId: 'tx@group.calendar.google.com', accountId: 'acct-teradix', accountEmail: 'ceo@teradix.com', name: 'Teradix Ltd', primary: false, writable: true, meetTypes: ['hangoutsMeet'] }
const hub = {
  configured: true, unreachable: [] as string[],
  pickWritable: async (name?: string) => (name && /teradix/i.test(name) ? co : cal),
  token: async (id: string) => 'tok:' + id,
  locate: async (ref: string) => { const c = ref.includes('::') && ref.split('::')[1] === co.calendarId ? co : cal; return { calendar: c, token: 'tok:' + c.accountId, eventId: 'ev1' } },
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
out.coNew = await toolAddCalendarEvent('u', { title: 'Board', start: '2030-05-10T15:00:00', add_meet: true, calendar: 'teradix' })
out.coNewCall = calls.splice(0)[0]
existing = [{ email: 'me@x.com', self: true, organizer: true }]
out.coUpd = await toolUpdateCalendarEvent('u', { event_id: 'ev1::tx@group.calendar.google.com', add_meet: true })
out.coUpdCalls = calls.splice(0)
out.defUpd = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true })
out.defUpdCalls = calls.splice(0)
out.meetUpd = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true })
out.meetUpdCalls = calls.splice(0)
hasMeet = true
out.meetHave = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true })
out.meetHaveCalls = calls.splice(0)
hasMeet = false; pending = true
out.meetPending = await toolAddCalendarEvent('u', { title: 'Call', start: '2030-05-10T15:00:00', add_meet: true })
calls.splice(0); pending = false
cal.meetTypes = ['addOn']
out.noMeetNew = await toolAddCalendarEvent('u', { title: 'Call', start: '2030-05-10T15:00:00', add_meet: true })
out.noMeetNewCall = calls.splice(0)[0]
out.noMeetUpd = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true })
out.noMeetUpdCalls = calls.splice(0)
out.noMeetWithGuest = await toolUpdateCalendarEvent('u', { event_id: 'ev1', add_meet: true, add_guests: ['g@x.com'] })
out.noMeetGuestCalls = calls.splice(0)
cal.meetTypes = undefined
out.unknownNew = await toolAddCalendarEvent('u', { title: 'Call', start: '2030-05-10T15:00:00', add_meet: true })
out.unknownCall = calls.splice(0)[0]
cal.meetTypes = ['hangoutsMeet']
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
  ok(`${bot}: Meet on a company calendar is created with that calendar's own account`, o.coNewCall.url.includes(encodeURIComponent('tx@group.calendar.google.com')) && o.coNewCall.auth === 'Bearer tok:acct-teradix' && !!o.coNewCall.body.conferenceData && /Teradix Ltd/.test(o.coNew), JSON.stringify([o.coNewCall.url, o.coNewCall.auth]))
  ok(`${bot}: Meet on an existing company event reads and patches with that account`, o.coUpdCalls.length === 2 && o.coUpdCalls.every(c => c.auth === 'Bearer tok:acct-teradix' && c.url.includes(encodeURIComponent('tx@group.calendar.google.com'))), JSON.stringify(o.coUpdCalls.map(c => [c.method, c.auth])))
  ok(`${bot}: control — a plain event id uses the default account, never the company one`, o.defUpdCalls.length === 2 && o.defUpdCalls.every(c => c.auth === 'Bearer tok:a' && c.url.includes('/calendars/primary/')), JSON.stringify(o.defUpdCalls.map(c => [c.method, c.auth])))
  ok(`${bot}: Meet — a calendar whose provider is not Meet is never asked for one, and the reply says why`, o.noMeetNewCall.body.conferenceData === undefined && !/conferenceDataVersion/.test(o.noMeetNewCall.url) && /does not allow Google Meet/.test(o.noMeetNew) && /addOn/.test(o.noMeetNew) && /Created/.test(o.noMeetNew), o.noMeetNew)
  ok(`${bot}: Meet — update on such a calendar writes nothing and says why`, !o.noMeetUpdCalls.some(c => c.method === 'PATCH') && /does not allow Google Meet/.test(o.noMeetUpd), o.noMeetUpd)
  const ng = o.noMeetGuestCalls.find(c => c.method === 'PATCH')
  ok(`${bot}: Meet — guests are still added when Meet is not possible, without a conference`, !!ng && ng.body.conferenceData === undefined && /Invited g@x.com/.test(o.noMeetWithGuest) && /does not allow/.test(o.noMeetWithGuest), o.noMeetWithGuest)
  ok(`${bot}: Meet — control: a calendar that does not say is tried`, !!o.unknownCall.body.conferenceData)
  ok(`${bot}: Meet — the hub reads the provider from Google's calendar list`, /allowedConferenceSolutionTypes/.test(fs.readFileSync('supabase/functions/_shared/googleCalendars.ts', 'utf8')))
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
  const c = grab('create_calendar_event'), u = grab('update_calendar_event'), l = grab('list_calendar_events'), d = grab('delete_calendar_event')
  ok('app: all four calendar cases found', !!c && !!u && !!l && !!d)
  ok('app: the schema offers guests / add_guests', /guests:\s+\{ type: 'array'/.test(src) && /add_guests:\s+\{ type: 'array'/.test(src))
  if (c && u && l && d) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appinv-'))
    const file = path.join(dir, 'a.ts')
    const h0 = src.indexOf('// ─── Which calendar, on which account'), h1 = src.indexOf('async function calPost<T>(')
    const lifted = h0 > 0 && h1 > h0 ? src.slice(h0, h1).replace(/^export /gm, '') : ''
    ok('app: the calendar resolver and meetTypesOf were found', /function resolveCal/.test(lifted) && /async function meetTypesOf/.test(lifted))
    const fix = t => t.replace(/\n    \}\n$/, '\n    },')
    fs.writeFileSync(file, `
import { parseGuests } from ${JSON.stringify(path.resolve('supabase/functions/_shared/guests.ts'))}
import { meetRequest, meetLinkOf, meetSentence, supportsMeet, noMeetSentence } from ${JSON.stringify(path.resolve('supabase/functions/_shared/meet.ts'))}
const calls: any[] = []
let cur: any = { summary: 'Sync', attendees: [{ email: 'me@x.com', self: true, organizer: true }, { email: 'old@x.com', responseStatus: 'accepted' }], start: { dateTime: '2030-05-10T15:00:00Z' }, end: { dateTime: '2030-05-10T16:00:00Z' } }
const tokenForEmail = async (e: any, _: any) => 'tok:' + (e ?? 'primary')
const CTX: any = { primaryEmail: 'me@x.com', accounts: [] }
const store: Record<string, string> = {
  'cal-intel-cals-cache': JSON.stringify([
    { id: 'me@x.com', summary: 'Personal', accountEmail: 'me@x.com', accessRole: 'owner', primary: true },
    { id: 'teradix-cal@group.calendar.google.com', summary: 'Teradix Ltd', accountEmail: 'ceo@teradix.com', accessRole: 'owner' },
    { id: 'readonly@group.calendar.google.com', summary: 'Holidays', accountEmail: 'me@x.com', accessRole: 'reader' },
    { id: 'hidden@group.calendar.google.com', summary: 'Hidden one', accountEmail: 'me@x.com', accessRole: 'owner' },
  ]),
  'cal-intel-hidden': JSON.stringify(['hidden@group.calendar.google.com']),
}
;(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null }
const fetched: { url: string; auth: string; method: string }[] = []
;(globalThis as any).fetch = async (url: string, init: any = {}) => { fetched.push({ url, auth: init.headers?.Authorization, method: init.method }); return new Response(null, { status: 204 }) }
let failFor = ''
let appTypes: string[] | undefined = ['hangoutsMeet']
const calGet = async (t: string, p: string) => { calls.push({ method: 'GET', path: p, token: t }); if (failFor && p.includes(failFor)) throw new Error('boom'); if (p.includes('/events?')) return { items: [{ id: 'e-' + p.split('/')[2].slice(0, 6), summary: 'on ' + decodeURIComponent(p.split('/')[2]), start: { dateTime: '2030-05-10T10:00:00Z' }, end: { dateTime: '2030-05-10T11:00:00Z' } }] }; if (p.includes('calendarList')) return { conferenceProperties: appTypes ? { allowedConferenceSolutionTypes: appTypes } : undefined }; return cur }
const setMeet = (on: boolean) => { cur = { ...cur, hangoutLink: on ? 'https://meet.google.com/old-old-old' : undefined } }
const calPost = async (t: string, p: string, body: any, method = 'POST') => { calls.push({ method, path: p, body, token: t }); return { id: 'n1', htmlLink: 'l', ...(body.conferenceData ? { hangoutLink: 'https://meet.google.com/new-new-new' } : {}) } }
const meetOn: any = { v: false }
${lifted}
const T: any = {
${fix(c)}
${fix(u)}
${fix(l)}
${fix(d)}
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
const TX = 'teradix-cal@group.calendar.google.com'
out.coCreate = await T.create_calendar_event({ title: 'Board', start_datetime: 'a', end_datetime: 'b', add_meet: true, guests: ['cfo@teradix.com'], calendar: 'teradix' }, undefined, CTX)
out.coCreateCalls = calls.splice(0)
out.defCreate = await T.create_calendar_event({ title: 'Mine', start_datetime: 'a', end_datetime: 'b', add_meet: true }, undefined, CTX)
out.defCreateCalls = calls.splice(0)
out.badName = await T.create_calendar_event({ title: 'X', start_datetime: 'a', end_datetime: 'b', calendar: 'nonexistent' }, undefined, CTX).catch((e: any) => 'ERR ' + e.message)
out.badNameCalls = calls.splice(0).length
out.roName = await T.create_calendar_event({ title: 'X', start_datetime: 'a', end_datetime: 'b', calendar: 'holidays' }, undefined, CTX).catch((e: any) => 'ERR ' + e.message)
out.roCalls = calls.splice(0).length
cur = { ...cur, attendees: [{ email: 'me@x.com', self: true, organizer: true }] }
out.coUpd = await T.update_calendar_event({ event_id: 'ev9::' + TX, add_meet: true }, undefined, CTX)
out.coUpdCalls = calls.splice(0)
out.list = await T.list_calendar_events({ date_from: '2030-05-10', date_to: '2030-05-10' }, undefined, CTX)
out.listCalls = calls.splice(0)
failFor = 'teradix'
out.listFail = await T.list_calendar_events({ date_from: '2030-05-10', date_to: '2030-05-10' }, undefined, CTX)
failFor = ''
calls.splice(0)
out.coDel = await T.delete_calendar_event({ event_id: 'ev9::' + TX }, undefined, CTX)
out.delFetched = fetched.splice(0)
out.meetNew = await T.create_calendar_event({ title: 'C', start_datetime: 'a', end_datetime: 'b', add_meet: true }, undefined, {})
out.meetNewCall = calls.splice(0).find((x: any) => x.method === 'POST')
cur = { ...cur, attendees: [{ email: 'me@x.com', self: true, organizer: true }] }
out.meetUpd = await T.update_calendar_event({ event_id: 'ev1', add_meet: true }, undefined, {})
out.meetUpdCalls = calls.splice(0)
appTypes = ['addOn']
out.noMeetNew = await T.create_calendar_event({ title: 'C', start_datetime: 'a', end_datetime: 'b', add_meet: true }, undefined, {})
out.noMeetNewCall = calls.splice(0).find((x: any) => x.method === 'POST')
out.noMeetUpd = await T.update_calendar_event({ event_id: 'ev1', add_meet: true }, undefined, {})
out.noMeetUpdCalls = calls.splice(0)
appTypes = ['hangoutsMeet']
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
    const TXE = encodeURIComponent('teradix-cal@group.calendar.google.com')
    const cp = o.coCreateCalls.find(x => x.method === 'POST'), cm = o.coCreateCalls.find(x => x.path.includes('calendarList'))
    ok('app: a company calendar is written with ITS OWN account, not the default', cp.path.startsWith(`/calendars/${TXE}/events`) && cp.token === 'tok:ceo@teradix.com', `${cp.path} ${cp.token}`)
    ok('app: the Meet link is created on that same calendar and account', !!cp.body.conferenceData && /conferenceDataVersion=1/.test(cp.path) && cm?.path.includes(TXE) && cm?.token === 'tok:ceo@teradix.com', JSON.stringify(cm))
    ok('app: the reply names the calendar and carries an id that finds it again', /Teradix Ltd/.test(o.coCreate.message) && o.coCreate.event_id === 'n1::teradix-cal@group.calendar.google.com', JSON.stringify(o.coCreate))
    const dp = o.defCreateCalls.find(x => x.method === 'POST')
    ok('app: control — no calendar named means the default account\'s main calendar', dp.path.startsWith('/calendars/primary/events') && dp.token === 'tok:primary', `${dp.path} ${dp.token}`)
    ok('app: a name that matches nothing writes nothing and does not fall back', /^ERR No writable calendar matches "nonexistent"/.test(o.badName) && o.badNameCalls === 0, o.badName)
    ok('app: a read-only calendar is never written to', /^ERR No writable calendar matches "holidays"/.test(o.roName) && o.roCalls === 0, o.roName)
    const cu = o.coUpdCalls.filter(x => x.path.includes('/events/ev9'))
    ok('app: editing by the id from a listing goes to that calendar with its account (read and write)', cu.length >= 2 && cu.every(x => x.path.startsWith(`/calendars/${TXE}/events/ev9`) && x.token === 'tok:ceo@teradix.com'), JSON.stringify(cu))
    ok('app: listing reads every visible calendar with its own account, skips the hidden one', o.listCalls.length === 3 && o.listCalls.some(x => x.token === 'tok:ceo@teradix.com' && x.path.includes(TXE)) && !o.listCalls.some(x => x.path.includes('hidden%40')), JSON.stringify(o.listCalls.map(x => x.path.slice(0, 40) + x.token)))
    ok('app: listed events say which calendar they are on and carry a usable id', o.list.length === 3 && o.list.every(e => e.calendar) && o.list.some(e => e.id.includes('::')), JSON.stringify(o.list))
    ok('app: an unreadable calendar is named, not an empty day', Array.isArray(o.listFail.could_not_read) && o.listFail.could_not_read.includes('Teradix Ltd') && o.listFail.events.length === 2, JSON.stringify(o.listFail))
    ok('app: delete goes to the right calendar with its account', o.delFetched.length === 1 && o.delFetched[0].url.includes(`/calendars/${TXE}/events/ev9`) && o.delFetched[0].auth === 'Bearer tok:ceo@teradix.com' && /Teradix Ltd/.test(o.coDel.message), JSON.stringify(o.delFetched))
    ok('app: Meet — create asks for a Meet link and returns the real one', o.meetNewCall.body.conferenceData?.createRequest?.conferenceSolutionKey?.type === 'hangoutsMeet' && /conferenceDataVersion=1/.test(o.meetNewCall.path) && /new-new-new/.test(o.meetNew.message), o.meetNew.message)
    const ap = o.meetUpdCalls.find(x => x.method === 'PATCH')
    ok('app: Meet — update adds one to an event without', !!ap?.body.conferenceData && /conferenceDataVersion=1/.test(ap.path) && /new-new-new/.test(o.meetUpd.message), JSON.stringify(o.meetUpd))
    ok('app: Meet — an event that has one is left alone', !o.meetHaveCalls.some(x => x.method === 'PATCH') && /old-old-old/.test(o.meetHave.message), JSON.stringify(o.meetHave))
    ok('app: Meet — a main calendar that does not allow Meet is never asked for one', o.noMeetNewCall.body.conferenceData === undefined && !/conferenceDataVersion/.test(o.noMeetNewCall.path) && /does not allow Google Meet/.test(o.noMeetNew.message) && o.noMeetNew.success === true, JSON.stringify(o.noMeetNew))
    ok('app: Meet — update on such a calendar writes nothing and says why', !o.noMeetUpdCalls.some(x => x.method === 'PATCH') && /does not allow Google Meet/.test(o.noMeetUpd.message), JSON.stringify(o.noMeetUpd))
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
