// node scripts/project-events.mjs [panel|page|sync|delete|compose]
// Needs a dev server on 5199.
//
// Chunk 5 of Projects: an event belongs to a project, from the calendar's own
// event panel, and the project page lists what is on the calendar for it.
// Google is served by a stub that records every non-GET: linking an event must
// write nothing to it — the link lives in `project_links`, not on the event.
//
//   panel   the Project row in an event's panel: options, link with its snapshot
//           on the server, replace, clear; a task's block shows its task's project
//   page    the Calendar tab: linked events and task blocks, grouped and ordered,
//           a block that is also linked shows once, unlink, open in calendar
//   sync    the calendar refreshes a link's snapshot when it loads the event, and
//           writes nothing when the snapshot is already right or the event is not loaded
//   compose the composer holds a Project choice and links it once Google has made the event
//   delete  deleting the event drops its links; undoing the delete puts them back
//           on the event's new id
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'panel'
const P_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const P_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const P_OLD = 'aaaaaaaa-0000-4000-8000-00000000000c'
const P_ARCH = 'aaaaaaaa-0000-4000-8000-00000000000d'
const now = new Date().toISOString()
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
const tid = n => `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const lid = n => `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const iso = (d, hm) => `${d}T${hm}:00Z`
const project = (id, name, o = {}) => ({
  id, user_id: U, name, kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null,
  target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o,
})
const task = (n, title, o = {}) => ({
  id: tid(n), user_id: U, company_id: null, title, description: null, quadrant: 'important_not_urgent',
  effort_minutes: null, due_date: null, status: 'todo', delegated_to: null, done_looks_like: null, created_at: now,
  completed_at: null, planned_time: null, owner_id: null, company_tag: null, completed: false, task_type: null,
  priority: null, board_status: null, calendar_id: null, gcal_event_id: null, parent_task_id: null, captured_via: null,
  urgent: false, checklist: [], attachments: [], links: [], project_id: null, milestone_id: null, ...o,
})
const TODAY = day(0)
const gEvents = [
  { id: 'evt-kickoff', summary: 'Kickoff meeting', start: { dateTime: iso(TODAY, '10:00') }, end: { dateTime: iso(TODAY, '11:00') }, status: 'confirmed', calendarId: 'primary', organizer: { email: 'a@x.com' } },
  { id: 'evt-design', summary: 'Design review', start: { dateTime: iso(TODAY, '14:00') }, end: { dateTime: iso(TODAY, '15:00') }, status: 'confirmed', calendarId: 'primary', organizer: { email: 'a@x.com' } },
  { id: 'evt-retro', summary: 'Retro', start: { dateTime: iso(TODAY, '16:00') }, end: { dateTime: iso(TODAY, '17:00') }, status: 'confirmed', calendarId: 'primary', organizer: { email: 'a@x.com' } },
]
const metaOf = e => ({ title: e.summary, start: e.start.dateTime, end: e.end.dateTime, allDay: false, calendarId: 'primary' })
const link = (n, pid, ref, meta) => ({ id: lid(n), project_id: pid, user_id: U, kind: 'event', ref_id: ref, meta: meta ?? null, created_at: now })

const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
db.projects = [project(P_A, 'Launch the site'), project(P_B, 'Kitchen renovation', { kind: 'personal', color: '#1D8A6A' }), project(P_OLD, 'Annual report', { status: 'done' }), project(P_ARCH, 'Put-away', { archived: true })]
// A task whose block is the "Design review" event, in project A.
db.tasks = [
  task(1, 'Prepare the review', { project_id: P_A, gcal_event_id: 'evt-design', due_date: TODAY, planned_time: '14:00', effort_minutes: 60 }),
  task(2, 'Other project block', { project_id: P_B, gcal_event_id: 'evt-other', due_date: TODAY, planned_time: '09:00', effort_minutes: 30 }),
]
if (MODE === 'page') {
  db.project_links = [
    link(1, P_A, 'evt-kickoff', metaOf(gEvents[0])),
    link(2, P_A, 'evt-old', { title: 'Old planning session', start: iso(day(-5), '09:00'), end: iso(day(-5), '10:00'), allDay: false, calendarId: 'primary' }),
    link(3, P_A, 'evt-future', { title: 'Launch party', start: iso(day(7), '18:00'), end: iso(day(7), '20:00'), allDay: false, calendarId: 'primary' }),
    link(4, P_A, 'evt-design', metaOf(gEvents[1])),               // also a task's block: must show once
    link(5, P_A, 'evt-allday', { title: 'Offsite', start: day(9), allDay: true, calendarId: 'primary' }),
    link(6, P_B, 'evt-retro', metaOf(gEvents[2])),                 // another project's
  ]
}
if (MODE === 'sync') {
  db.project_links = [
    link(1, P_A, 'evt-kickoff', { ...metaOf(gEvents[0]), title: 'Old title for kickoff' }),   // stale: the calendar has it loaded
    link(2, P_A, 'evt-retro', metaOf(gEvents[2])),                                             // already right
    link(3, P_A, 'evt-unloaded', { title: 'Not in this week', start: iso(day(30), '09:00'), end: iso(day(30), '10:00'), allDay: false, calendarId: 'primary' }),
  ]
}
if (MODE === 'delete') db.project_links = [link(1, P_A, 'evt-kickoff', metaOf(gEvents[0]))]

const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const googleWrites = []
let linkWrites = 0
let created = []
let failCreate = false
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 }, timezoneId: 'UTC', locale: 'en-GB' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  const table = Object.keys(db).find(t => u.pathname.endsWith('/' + t))
  if (!table) return j([])
  const m = q.method()
  if (m === 'GET') return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table])
  if (table === 'project_links') linkWrites++
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) {
      const at = db[table].findIndex(x => x.id === row.id || (table === 'project_links' && x.project_id === row.project_id && x.kind === row.kind && x.ref_id === row.ref_id))
      if (at >= 0) db[table][at] = { ...db[table][at], ...row }; else db[table].push(row)
    }
    return j([])
  }
  if (m === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); for (const row of db[table]) Object.assign(row, body); return j([]) }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.route('**://*.googleapis.com/**', r => {
  const q = r.request(); const u = q.url()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (q.method() !== 'GET') {
    googleWrites.push(`${q.method()} ${u.replace(/\?.*/, '')}`)
    if (q.method() === 'DELETE') { const id = decodeURIComponent(u.match(/events\/([^/?]+)/)?.[1] ?? ''); const at = gEvents.findIndex(e => e.id === id); if (at >= 0) gEvents.splice(at, 1); return r.fulfill({ status: 204, headers: cors, body: '' }) }
    if (q.method() === 'POST' && failCreate) return r.fulfill({ status: 500, headers: cors, json: { error: { message: 'nope' } } })
    if (q.method() === 'POST') { const body = JSON.parse(q.postData() || '{}'); const ev = { ...body, id: `evt-new-${created.length + 1}`, status: 'confirmed', calendarId: 'primary' }; created.push(ev); gEvents.push({ ...ev }); return r.fulfill({ headers: cors, json: ev }) }
    return r.fulfill({ headers: cors, json: {} })
  }
  if (/calendarList/.test(u)) return r.fulfill({ headers: cors, json: { items: [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner' }] } })
  if (/\/calendars\/[^/]+\/events/.test(u)) return r.fulfill({ headers: cors, json: { items: gEvents } })
  return r.fulfill({ headers: cors, json: { items: [] } })
})
const CALS = [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner', accountEmail: 'a@x.com' }]
await ctx.addInitScript(([s, start, cals]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'list')
  localStorage.setItem('google_provider_token', 'tok'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cals)); localStorage.setItem('cal-view', 'week')
} catch {} }, [session, MODE === 'page' ? 'projects' : 'calendar', CALS])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
p.on('dialog', d => d.accept())
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore'), tasks: await urlOf('taskStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore, tasks = (await import(urls.tasks)).useTaskStore
  return await (new Function('proj', 'tasks', `return (${src})(proj, tasks)`))(proj, tasks)
}, [fn.toString(), URLS])
const linksNow = () => S(proj => proj.getState().links)
ok('found the app\'s own store modules', !!URLS.proj && !!URLS.tasks)

const openEvent = async title => {
  const card = p.locator('.event-card', { hasText: title }).first()
  await card.waitFor({ state: 'visible', timeout: 8000 })
  await card.click()
  await p.locator('[data-event-project]').first().waitFor({ state: 'visible', timeout: 6000 })
}
const sel = () => p.getByLabel('Project for this event')

if (MODE === 'compose') {
  const open = async () => {
    await p.getByRole('button', { name: /New event/i }).first().click()
    await p.getByPlaceholder('Event title').waitFor({ state: 'visible', timeout: 8000 })
  }
  const sel = () => p.getByLabel('Project for this event')
  await p.locator('.event-card').first().waitFor({ state: 'visible', timeout: 10000 })
  await open()
  ok('the composer has a Project row, before anything exists', await p.locator('[data-composer-project]').count() === 1)
  const opts = await sel().locator('option').allTextContents()
  ok('it offers live projects only', JSON.stringify(opts) === JSON.stringify(['No project', 'Launch the site', 'Kitchen renovation']), JSON.stringify(opts))
  await p.getByPlaceholder('Event title').fill('Planning session')
  await sel().selectOption({ label: 'Launch the site' })
  ok('choosing one links NOTHING yet — there is no event to link', (await linksNow()).length === 0 && linkWrites === 0)
  await p.getByRole('button', { name: /Create event/ }).click(); await p.waitForTimeout(3500)
  const made = created[0]
  ok('Google was asked to create exactly one event', created.length === 1 && made?.summary === 'Planning session', JSON.stringify(created.map(c => c.summary)))
  ok('the project is not in what Google was sent', !/Launch|project/i.test(JSON.stringify(made).replace(/Planning session/, '')), JSON.stringify(made).slice(0, 160))
  const l = (await linksNow()).filter(x => x.kind === 'event')
  ok('then it is linked: that project, the id Google gave', l.length === 1 && l[0].projectId === P_A && l[0].refId === made?.id, JSON.stringify(l))
  ok('with a snapshot of the event', l[0]?.meta?.title === 'Planning session' && l[0].meta.allDay === false, JSON.stringify(l[0]?.meta))
  ok('and it reached the server', db.project_links.some(x => x.ref_id === made?.id && x.project_id === P_A))
  ok('the only things written to Google are the create', googleWrites.length === 1 && /POST/.test(googleWrites[0]), JSON.stringify(googleWrites))
  // No project chosen: no link.
  await open(); await p.getByPlaceholder('Event title').fill('Loose chat')
  await p.getByRole('button', { name: /Create event/ }).click(); await p.waitForTimeout(3500)
  ok('an event made with no project is linked to nothing', created.length === 2 && (await linksNow()).filter(x => x.kind === 'event').length === 1)
  // A failed create leaves no link behind.
  failCreate = true
  await open(); await p.getByPlaceholder('Event title').fill('Will fail')
  await sel().selectOption({ label: 'Kitchen renovation' })
  await p.getByRole('button', { name: /Create event/ }).click(); await p.waitForTimeout(3500)
  ok('when Google refuses, no link is made', (await linksNow()).filter(x => x.kind === 'event').length === 1 && created.length === 2, JSON.stringify(await linksNow()))
}
if (MODE === 'panel') {
  await openEvent('Kickoff meeting')
  ok('the event panel has a Project row', await p.locator('[data-event-project]').count() === 1)
  const opts = await sel().locator('option').allTextContents()
  ok('it offers live projects only — not the done one, not the archived one', JSON.stringify(opts) === JSON.stringify(['No project', 'Launch the site', 'Kitchen renovation']), JSON.stringify(opts))
  ok('and starts on "No project"', (await sel().inputValue()) === '')
  await sel().selectOption({ label: 'Launch the site' }); await p.waitForTimeout(2800)
  const l1 = (await linksNow()).filter(l => l.kind === 'event')
  ok('choosing one makes exactly one event link, to that project and event', l1.length === 1 && l1[0].projectId === P_A && l1[0].refId === 'evt-kickoff', JSON.stringify(l1))
  ok('with a snapshot of the event (title, hours, calendar)', JSON.stringify(l1[0].meta) === JSON.stringify(metaOf(gEvents[0])), JSON.stringify(l1[0].meta))
  const srv = db.project_links.filter(l => l.kind === 'event')
  ok('and it reached the server with the user and the snapshot', srv.length === 1 && srv[0].user_id === U && srv[0].ref_id === 'evt-kickoff' && srv[0].meta?.title === 'Kickoff meeting', JSON.stringify(srv))
  ok('nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))
  await sel().selectOption({ label: 'Kitchen renovation' }); await p.waitForTimeout(2800)
  const l2 = (await linksNow()).filter(l => l.kind === 'event')
  ok('choosing another REPLACES: still one link, now to the other project', l2.length === 1 && l2[0].projectId === P_B, JSON.stringify(l2.map(l => l.projectId)))
  ok('and the server holds one, for that project', db.project_links.length === 1 && db.project_links[0].project_id === P_B, JSON.stringify(db.project_links.map(l => l.project_id)))
  await sel().selectOption({ label: 'No project' }); await p.waitForTimeout(2800)
  ok('"No project" removes the link', (await linksNow()).filter(l => l.kind === 'event').length === 0 && db.project_links.length === 0)
  ok('and still nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))

  // An event that is a task's block belongs to that task's project.
  await p.keyboard.press('Escape').catch(() => {})
  await openEvent('Design review')
  ok('a task\'s block says so and offers no competing choice', await p.locator('[data-event-project-via-task]').count() === 1 && await sel().count() === 0)
  ok('naming the project and the way it got there', /Launch the site · via its task/.test(await p.locator('[data-event-project-via-task]').innerText()))
  await p.locator('[data-event-project-via-task]').click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  ok('pressing it opens that project', await p.locator(`[data-project-page="${P_A}"]`).count() === 1)
}

if (MODE === 'page') {
  await p.locator(`[data-project-card="${P_A}"]`).waitFor({ state: 'visible', timeout: 6000 })
  await p.locator(`[data-project-card="${P_A}"]`).click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible' })
  const tab = p.getByRole('tab', { name: /^Calendar/ })
  ok('the tab counts what is on the calendar: 5 (kickoff, task block, old, future, all-day — the double counted once)', /Calendar · 5/.test(await tab.innerText()), await tab.innerText())
  await tab.click()
  const groups = await p.locator('[data-project-events-group]').evaluateAll(els => els.map(e => [e.getAttribute('data-project-events-group'), [...e.querySelectorAll('[data-project-event]')].map(r => r.getAttribute('data-project-event'))]))
  ok('Upcoming then Earlier', groups.map(g => g[0]).join() === 'Upcoming,Earlier', JSON.stringify(groups.map(g => g[0])))
  ok('upcoming is in time order: today 10:00, today 14:00 (task block), +7d party, +9d all-day', JSON.stringify(groups[0][1]) === JSON.stringify(['evt-kickoff', 'evt-design', 'evt-future', 'evt-allday']), JSON.stringify(groups[0][1]))
  ok('earlier holds the old one', JSON.stringify(groups[1][1]) === JSON.stringify(['evt-old']), JSON.stringify(groups[1][1]))
  ok('another project\'s event and another project\'s task block are not listed', await p.locator('[data-project-event="evt-retro"], [data-project-event="evt-other"]').count() === 0)
  ok('the block that is also linked is listed ONCE, as the task\'s', await p.locator('[data-project-event="evt-design"]').count() === 1 && (await p.locator('[data-project-event="evt-design"]').getAttribute('data-via')) === 'task')
  const k = await p.locator('[data-project-event="evt-kickoff"]').innerText()
  ok('a row shows day, hours and title', /10:00–11:00/.test(k) && /Kickoff meeting/.test(k), k.replace(/\n/g, ' | '))
  ok('the task block shows the task\'s own hours: 14:00–15:00', /14:00–15:00/.test(await p.locator('[data-project-event="evt-design"]').innerText()), (await p.locator('[data-project-event="evt-design"]').innerText()).replace(/\n/g, ' | '))
  ok('an all-day event says "All day"', /All day/.test(await p.locator('[data-project-event="evt-allday"]').innerText()))
  ok('a task block has no unlink; an explicit link does', await p.locator('[data-project-event="evt-design"] button[aria-label^="Unlink"]').count() === 0 && await p.locator('[data-project-event="evt-kickoff"] button[aria-label^="Unlink"]').count() === 1)
  await p.getByRole('button', { name: 'Unlink Old planning session from this project' }).click(); await p.waitForTimeout(2800)
  ok('unlinking removes the row and the link, on the server too', await p.locator('[data-project-event="evt-old"]').count() === 0 && !db.project_links.some(l => l.ref_id === 'evt-old') && !(await linksNow()).some(l => l.refId === 'evt-old'))
  ok('and the others are untouched', db.project_links.some(l => l.ref_id === 'evt-kickoff') && db.project_links.some(l => l.ref_id === 'evt-retro'))
  ok('nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))
  await p.getByRole('button', { name: 'Open Kickoff meeting in the calendar' }).click()
  await p.waitForTimeout(1200)
  ok('Open in calendar goes to the calendar module', await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ui') || '{}').state?.activeModule) === 'calendar')
  ok('and lands on that event\'s panel', await p.locator('[data-event-project]').count() === 1)
}

if (MODE === 'sync') {
  await p.locator('.event-card', { hasText: 'Kickoff meeting' }).first().waitFor({ state: 'visible', timeout: 8000 })
  await p.waitForTimeout(3500)
  const ls = await linksNow()
  const k = ls.find(l => l.refId === 'evt-kickoff'), r = ls.find(l => l.refId === 'evt-retro'), u = ls.find(l => l.refId === 'evt-unloaded')
  ok('a stale snapshot is refreshed from the loaded event', k?.meta?.title === 'Kickoff meeting', JSON.stringify(k?.meta))
  ok('and the refresh reached the server', db.project_links.find(l => l.ref_id === 'evt-kickoff')?.meta?.title === 'Kickoff meeting')
  ok('a snapshot that is already right is left alone', JSON.stringify(r.meta) === JSON.stringify(metaOf(gEvents[2])))
  ok('an event that is not loaded keeps what it had — it is not blanked or "refreshed" from nothing', u?.meta?.title === 'Not in this week' && db.project_links.find(l => l.ref_id === 'evt-unloaded')?.meta?.title === 'Not in this week')
  const before = linkWrites
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(7000)
  ok('a reload that changes nothing writes nothing back (no ping-pong)', linkWrites === before, `${before} -> ${linkWrites}`)
  ok('nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))
}

if (MODE === 'delete') {
  await openEvent('Kickoff meeting')
  ok('the event starts linked to Launch the site', (await sel().inputValue()) === P_A)
  await p.getByTitle('Delete this event').click()
  // The app asks in its own dialog now (askConfirm), not the browser's confirm().
  await p.getByRole('button', { name: 'Delete event', exact: true }).click()
  await p.waitForTimeout(2800)
  ok('Google was asked to delete it (and only that)', googleWrites.length === 1 && /DELETE .*evt-kickoff/.test(googleWrites[0]), JSON.stringify(googleWrites))
  ok('its link is gone from the store and the server', (await linksNow()).filter(l => l.kind === 'event').length === 0 && db.project_links.length === 0, JSON.stringify(db.project_links))
  await p.keyboard.press('Control+z'); await p.waitForTimeout(3500)
  ok('undo wrote the event again (a POST) under a new id', created.length === 1 && created[0].id === 'evt-new-1', JSON.stringify(created.map(c => c.id)))
  const ls = (await linksNow()).filter(l => l.kind === 'event')
  ok('and the link came back with it — to the NEW id, in the same project', ls.length === 1 && ls[0].refId === 'evt-new-1' && ls[0].projectId === P_A, JSON.stringify(ls))
  ok('with its snapshot', ls[0]?.meta?.title === 'Kickoff meeting')
  ok('and on the server', db.project_links.length === 1 && db.project_links[0].ref_id === 'evt-new-1', JSON.stringify(db.project_links.map(l => l.ref_id)))
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
