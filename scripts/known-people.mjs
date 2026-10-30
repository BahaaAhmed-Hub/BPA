// Runs the real src/lib/knownPeople.ts (type-stripped), not a copy of it.
import { knownPeopleFrom, matchPeople } from '../src/lib/knownPeople.ts'
let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
const ev = [
  { organizer: { email: 'Boss@x.com', displayName: 'The Boss' }, attendees: [{ email: 'me@x.com', self: true }, { email: 'maya.k@x.com', displayName: 'Maya K.' }, { email: 'room@resource.calendar.google.com' }] },
  { attendees: [{ email: 'MAYA.K@x.com' }, { email: 'MAYA.K@x.com' }, { email: 'sam@x.com' }] },
]
const all = knownPeopleFrom(ev)
ok(all[0].email === 'maya.k@x.com' && all[0].count === 2, 'most-shared first, case folded, counted once per event')
ok(all[0].name === 'Maya K.', 'display name kept from whichever event had one')
ok(!all.some(p => p.email === 'me@x.com'), 'self never offered')
ok(!all.some(p => p.email.includes('resource.calendar')), 'rooms never offered')
ok(!knownPeopleFrom(ev, ['BOSS@x.com']).some(p => p.email === 'boss@x.com'), 'excluded address (organiser) dropped')
ok(matchPeople(all, 'maya').length === 1 && matchPeople(all, '@ma').length === 1, 'name and @-prefixed query match')
ok(matchPeople(all, '').length === 0, 'empty query suggests nothing')
ok(matchPeople(all, 'zzz').length === 0, 'control: no match returns nothing')
process.exit(fail ? 1 : 0)
