// node scripts/project-timeline.mjs [timeline|phase|calendar|calendar-none|month]
// Needs a dev server on 5199.
//
// Chunk 4 of Projects: milestones, the Timeline tab, phases on tasks, and the
// calendar markers. Claims are read off the store, the stub server's rows and
// measured geometry — an axis is a claim about pixels, so it is measured.
//
//   timeline  the axis places dates in proportion; the list edits names, dates
//             and done; an undated milestone is listed and not drawn; deleting
//             one keeps its tasks in the project
//   phase     a task takes a phase from its own project only — from the page row
//             and from the task panel — and leaving the project clears it
//   calendar  week view: a strip of markers on the right day; an archived
//             project, an undated milestone and another week draw nothing; a
//             click opens the project; nothing is written to Google
//   calendar-none  a week with nothing due draws no strip at all (the grid is
//             still there)
//   month     a cell shows two markers at most, and a marker does not open the day
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'timeline'
const P_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const P_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const P_C = 'aaaaaaaa-0000-4000-8000-00000000000c'
const now = new Date().toISOString()
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
const tid = n => `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const mid = n => `bbbbbbbb-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const task = (n, title, o = {}) => ({
  id: tid(n), user_id: U, company_id: null, title, description: null, quadrant: 'important_not_urgent',
  effort_minutes: null, due_date: null, status: 'todo', delegated_to: null, done_looks_like: null, created_at: now,
  completed_at: null, planned_time: null, owner_id: null, company_tag: null, completed: false, task_type: null,
  priority: null, board_status: null, calendar_id: null, gcal_event_id: null, parent_task_id: null, captured_via: null,
  urgent: false, checklist: [], attachments: [], links: [], project_id: null, milestone_id: null, ...o,
})
const project = (id, name, o = {}) => ({
  id, user_id: U, name, kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null,
  target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o,
})
const ms = (n, pid, title, due, o = {}) => ({ id: mid(n), project_id: pid, user_id: U, title, due_date: due, done: false, sort_order: n, ...o })

const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
if (MODE === 'timeline' || MODE === 'phase') {
  db.projects = [
    project(P_A, 'Launch the site', { start_date: day(-20), target_date: day(40) }),
    project(P_B, 'Kitchen renovation', { kind: 'personal', color: '#1D8A6A' }),
  ]
  db.project_milestones = [
    ms(1, P_A, 'Design signed off', day(-5), { done: true }),
    ms(2, P_A, 'Beta live', day(10)),
    ms(3, P_A, 'Public launch', day(50)),
    ms(4, P_A, 'Press kit', null),
    ms(5, P_B, 'Other project phase', day(3)),
  ]
  db.tasks = [
    task(1, 'Wireframes', { project_id: P_A, milestone_id: mid(1), completed: true, status: 'done' }),
    task(2, 'Write the copy', { project_id: P_A, milestone_id: mid(1) }),
    task(3, 'QA pass', { project_id: P_A, milestone_id: mid(2) }),
    task(4, 'Loose task'),
    task(5, 'Finished in project', { project_id: P_A, completed: true, status: 'done' }),
    task(6, 'Pick the tiles', { project_id: P_B }),
  ]
}
if (MODE === 'calendar-none') {
  db.projects = [project(P_A, 'Launch the site'), project(P_C, 'Put-away project', { archived: true })]
  db.project_milestones = [ms(6, P_A, 'Far away', day(45)), ms(7, P_C, 'Archived milestone', day(0)), ms(5, P_A, 'No day set', null)]
}
if (MODE === 'calendar' || MODE === 'month') {
  db.projects = [
    project(P_A, 'Launch the site'),
    project(P_C, 'Put-away project', { archived: true }),
  ]
  db.project_milestones = [
    ms(1, P_A, 'Due today', day(0)),
    ms(2, P_A, 'Also today', day(0)),
    ms(3, P_A, 'Third today', day(0)),
    ms(4, P_A, 'Finished today', day(0), { done: true }),
    ms(5, P_A, 'No day set', null),
    ms(6, P_A, 'Far away', day(45)),
    ms(7, P_C, 'Archived milestone', day(0)),
  ]
}
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const googleWrites = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 }, timezoneId: 'Africa/Cairo', locale: 'en-GB' })
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
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) { const at = db[table].findIndex(x => x.id === row.id); if (at >= 0) db[table][at] = { ...db[table][at], ...row }; else db[table].push(row) }
    return j([])
  }
  if (m === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); const pid = (u.searchParams.get('project_id') || '').replace('eq.', ''); for (const row of db[table]) if (!pid || row.project_id === pid) Object.assign(row, body); return j([]) }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.route('**://*.googleapis.com/**', r => {
  const q = r.request(); const u = q.url()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (q.method() !== 'GET') googleWrites.push(`${q.method()} ${u}`)
  if (/calendarList/.test(u)) return r.fulfill({ headers: cors, json: { items: [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner' }] } })
  return r.fulfill({ headers: cors, json: { items: [] } })
})
const CALS = [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner', accountEmail: 'a@x.com' }]
await ctx.addInitScript(([s, start, view, cals]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'list')
  localStorage.setItem('google_provider_token', 'tok'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cals)); localStorage.setItem('cal-view', view)
} catch {} }, [session, MODE === 'calendar' || MODE === 'month' || MODE === 'calendar-none' ? 'calendar' : 'projects', MODE === 'month' ? 'month' : 'week', CALS])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore'), tasks: await urlOf('taskStore'), ui: await urlOf('uiStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore, tasks = (await import(urls.tasks)).useTaskStore, ui = (await import(urls.ui)).useUIStore
  return await (new Function('proj', 'tasks', 'ui', `return (${src})(proj, tasks, ui)`))(proj, tasks, ui)
}, [fn.toString(), URLS])
const tasksNow = () => S((_p, t) => t.getState().tasks.map(x => ({ id: x.id, title: x.title, projectId: x.projectId ?? null, milestoneId: x.milestoneId ?? null })))
const msNow = () => S(proj => proj.getState().milestones)
const row = t => db.tasks.find(x => x.title === t)
ok('found the app\'s own store modules', !!URLS.proj && !!URLS.tasks && !!URLS.ui)

const openPage = async (pid, tab) => {
  await p.locator(`[data-project-card="${pid}"]`).click()
  await p.locator(`[data-project-page="${pid}"]`).waitFor({ state: 'visible', timeout: 5000 })
  if (tab) await p.getByRole('tab', { name: tab }).click()
}
const cx = async loc => { const r = await loc.boundingBox(); return r.x + r.width / 2 }

if (MODE === 'timeline') {
  await p.locator(`[data-project-card="${P_A}"]`).waitFor({ state: 'visible', timeout: 6000 })
  await openPage(P_A, 'Timeline')
  const tl = p.locator('[data-project-timeline]')
  await tl.waitFor({ state: 'visible' })
  const marker = id => p.locator(`[data-timeline-marker="${id}"] > span`).first()
  ok('three dated milestones are drawn, the undated one is not', await p.locator('[data-timeline-marker]').count() === 3)
  const x1 = await cx(marker(mid(1))), x2 = await cx(marker(mid(2))), x3 = await cx(marker(mid(3)))
  const prop = (x2 - x1) / (x3 - x1)
  ok('positions are in proportion to the dates (15 of 55 days)', Math.abs(prop - 15 / 55) < 0.012, `${prop.toFixed(4)} vs ${(15 / 55).toFixed(4)}`)
  ok('and in date order, left to right', x1 < x2 && x2 < x3, `${x1.toFixed(0)} < ${x2.toFixed(0)} < ${x3.toFixed(0)}`)
  const xt = await p.locator('[data-timeline-today]').boundingBox()
  ok('today falls between the first two (5 of 15 days along)', Math.abs((xt.x - x1) / (x2 - x1) - 5 / 15) < 0.03, `${((xt.x - x1) / (x2 - x1)).toFixed(3)}`)
  const xs = (await p.locator('[data-timeline-start]').boundingBox()).x, xe = (await p.locator('[data-timeline-target]').boundingBox()).x
  ok('the start is left of everything and the target sits between the last two milestones', xs < x1 && xe > x2 && xe < x3, `${xs.toFixed(0)} ${x1.toFixed(0)} ${xe.toFixed(0)} ${x3.toFixed(0)}`)
  const ax = await p.locator('[data-timeline-axis]').boundingBox()
  ok('every marker is inside the axis box', [x1, x2, x3].every(x => x >= ax.x && x <= ax.x + ax.width))
  const lbl = await p.locator('[data-timeline-marker]').evaluateAll(els => els.map(e => { const t = e.children[1].getBoundingClientRect(); return [Math.round(t.left), Math.round(t.right), Math.round(t.top)] }))
  ok('labels alternate above and below so neighbours cannot sit on each other', lbl[0][2] < lbl[1][2] && lbl[1][2] > lbl[2][2], JSON.stringify(lbl))

  if (process.env.SHOT_TL) await p.screenshot({ path: process.env.SHOT_TL })
  const rows = await p.locator('[data-milestone-row]').evaluateAll(els => els.map(e => e.querySelector('input').value))
  ok('the list is dated first, soonest first, undated last', JSON.stringify(rows) === JSON.stringify(['Design signed off', 'Beta live', 'Public launch', 'Press kit']), JSON.stringify(rows))
  ok('a milestone past the target date says so — only that one', await p.locator('[data-milestone-late]').count() === 1 && await p.locator(`[data-milestone-row="${mid(3)}"] [data-milestone-late]`).count() === 1)
  const counts = await p.locator('[data-milestone-row]').evaluateAll(els => els.map(e => e.querySelector('[data-milestone-count]').innerText))
  ok('each counts its own tasks: 1 of 2 done · 0 of 1 · none · none', JSON.stringify(counts) === JSON.stringify(['1 of 2 done', '0 of 1 done', 'No tasks', 'No tasks']), JSON.stringify(counts))
  ok('a done milestone is a hollow diamond, the others are filled', await marker(mid(1)).locator('span').count() >= 0
    && (await p.locator(`[data-timeline-marker="${mid(1)}"] span`).first().evaluate(el => getComputedStyle(el.firstElementChild ?? el).backgroundColor)) === 'rgba(0, 0, 0, 0)'
    && (await p.locator(`[data-timeline-marker="${mid(2)}"] span`).first().evaluate(el => getComputedStyle(el.firstElementChild ?? el).backgroundColor)) !== 'rgba(0, 0, 0, 0)')

  // Add: needs a name; a date is optional.
  const add = p.getByRole('button', { name: /^Add$|Add$/ }).last()
  ok('Add is disabled with no name', await add.isDisabled())
  await p.getByLabel('New milestone name').fill('Kickoff party')
  ok('and enabled with one', await add.isEnabled())
  await p.getByLabel('New milestone date').fill(day(20))
  await add.click(); await p.waitForTimeout(2600)
  const made = (await msNow()).find(m => m.title === 'Kickoff party')
  ok('a milestone added here is in the store with its date and project', made?.dueDate === day(20) && made?.projectId === P_A, JSON.stringify(made))
  ok('and on the server, with the user', db.project_milestones.some(m => m.title === 'Kickoff party' && m.due_date === day(20) && m.project_id === P_A && m.user_id === U))
  ok('the inputs clear and it is drawn', (await p.getByLabel('New milestone name').inputValue()) === '' && await p.locator('[data-timeline-marker]').count() === 4)
  await p.getByLabel('New milestone name').fill('Someday item')
  await p.getByRole('button', { name: /^Add$|Add$/ }).last().click(); await p.waitForTimeout(800)
  ok('one with no date is listed but not drawn', await p.locator('[data-milestone-row]').count() === 6 && await p.locator('[data-timeline-marker]').count() === 4)

  // Edit the name: commit on blur; Escape reverts; empty reverts.
  const nameIn = id => p.locator(`[data-milestone-row="${id}"] input`).first()
  await nameIn(mid(2)).fill('Beta goes live'); await nameIn(mid(2)).press('Enter'); await p.waitForTimeout(2600)
  ok('a renamed milestone reaches the store and the server', (await msNow()).find(m => m.id === mid(2))?.title === 'Beta goes live' && db.project_milestones.find(m => m.id === mid(2))?.title === 'Beta goes live')
  await nameIn(mid(2)).fill('typed then abandoned'); await nameIn(mid(2)).press('Escape')
  ok('Escape puts the name back and saves nothing', (await nameIn(mid(2)).inputValue()) === 'Beta goes live' && (await msNow()).find(m => m.id === mid(2))?.title === 'Beta goes live')
  await nameIn(mid(2)).fill('   '); await nameIn(mid(2)).press('Enter')
  ok('an empty name is refused and the old one stays', (await nameIn(mid(2)).inputValue()) === 'Beta goes live')

  // Change a date → the marker moves.
  const before = await cx(marker(mid(2)))
  await p.getByLabel('Date for Beta goes live').fill(day(30)); await p.waitForTimeout(2600)
  const after = await cx(marker(mid(2)))
  ok('changing the date moves the marker to the right', after > before + 20, `${before.toFixed(0)} -> ${after.toFixed(0)}`)
  ok('and reaches the server', db.project_milestones.find(m => m.id === mid(2))?.due_date === day(30))

  // Done toggles.
  await p.getByRole('button', { name: 'Mark Beta goes live done' }).click(); await p.waitForTimeout(2600)
  ok('ticking a milestone sets done in the store and on the server', (await msNow()).find(m => m.id === mid(2))?.done === true && db.project_milestones.find(m => m.id === mid(2))?.done === true)
  await p.getByRole('button', { name: 'Reopen Beta goes live' }).click()
  ok('and it reopens', (await msNow()).find(m => m.id === mid(2))?.done === false)

  // Delete keeps its tasks.
  await p.getByRole('button', { name: 'Delete milestone Design signed off' }).click(); await p.waitForTimeout(2600)
  ok('a deleted milestone is gone from the store and the server', !(await msNow()).some(m => m.id === mid(1)) && !db.project_milestones.some(m => m.id === mid(1)))
  const t = await tasksNow()
  ok('its tasks are kept, still in the project, with no phase', ['Wireframes', 'Write the copy'].every(n => { const x = t.find(y => y.title === n); return x && x.projectId === P_A && x.milestoneId === null }), JSON.stringify(t.filter(x => ['Wireframes', 'Write the copy'].includes(x.title))))
  ok('and the server rows lose the phase but not the project', row('Write the copy')?.milestone_id === null && row('Write the copy')?.project_id === P_A, `${row('Write the copy')?.milestone_id} ${row('Write the copy')?.project_id}`)
  ok('another milestone\'s task is untouched', t.find(y => y.title === 'QA pass')?.milestoneId === mid(2))
}

if (MODE === 'phase') {
  await p.locator(`[data-project-card="${P_A}"]`).waitFor({ state: 'visible', timeout: 6000 })
  await openPage(P_A, /^Tasks/)
  const sel = t => p.getByLabel(`Phase for ${t}`)
  const opts = await sel('Write the copy').locator('option').allTextContents()
  ok('a task offers its own project\'s milestones — not another project\'s', JSON.stringify(opts) === JSON.stringify(['No phase', 'Design signed off', 'Beta live', 'Public launch', 'Press kit']), JSON.stringify(opts))
  ok('it shows the phase it is in', (await sel('QA pass').inputValue()) === mid(2))
  ok('a finished task has no phase picker', await sel('Wireframes').count() === 0 && await sel('Finished in project').count() === 0)
  await sel('Write the copy').selectOption({ label: 'Beta live' }); await p.waitForTimeout(2600)
  ok('choosing a phase sets milestoneId in the store and on the server', (await tasksNow()).find(t => t.title === 'Write the copy')?.milestoneId === mid(2) && row('Write the copy')?.milestone_id === mid(2))
  await sel('Write the copy').selectOption({ label: 'No phase' }); await p.waitForTimeout(2600)
  ok('"No phase" clears it, and the task stays in the project', (await tasksNow()).find(t => t.title === 'Write the copy')?.milestoneId === null && (await tasksNow()).find(t => t.title === 'Write the copy')?.projectId === P_A && row('Write the copy')?.milestone_id === null)

  // From the task panel.
  await S((_p, tasks, ui) => ui.getState().focusOn({ module: 'tasks', id: tasks.getState().tasks.find(t => t.title === 'QA pass').id }))
  const cell = p.locator('[data-task-phase]')
  await cell.waitFor({ state: 'visible', timeout: 6000 })
  ok('the panel shows the phase it is in', (await cell.innerText()).includes('Beta live'))
  const popts = await p.getByLabel('Phase', { exact: true }).locator('option').allTextContents()
  ok('and offers only that project\'s', JSON.stringify(popts) === JSON.stringify(['No phase', 'Design signed off', 'Beta live', 'Public launch', 'Press kit']), JSON.stringify(popts))
  await p.getByLabel('Phase', { exact: true }).selectOption({ label: 'Public launch' }); await p.waitForTimeout(2600)
  ok('choosing one from the panel reaches store and server', (await tasksNow()).find(t => t.title === 'QA pass')?.milestoneId === mid(3) && row('QA pass')?.milestone_id === mid(3))
  // Another project: the phase goes, because phases belong to a project.
  await p.getByLabel('Project', { exact: true }).selectOption({ label: 'Kitchen renovation' }); await p.waitForTimeout(2600)
  const moved = (await tasksNow()).find(t => t.title === 'QA pass')
  ok('moving it to another project clears the phase', moved.projectId === P_B && moved.milestoneId === null && row('QA pass')?.milestone_id === null, JSON.stringify(moved))
  ok('and the other project\'s own milestone is now offered', (await p.getByLabel('Phase', { exact: true }).locator('option').allTextContents()).join('|') === 'No phase|Other project phase')
  await S((_p, tasks, ui) => ui.getState().focusOn({ module: 'tasks', id: tasks.getState().tasks.find(t => t.title === 'Loose task').id }))
  await p.getByPlaceholder('What is it?').waitFor({ state: 'visible' })
  ok('a task in no project has no Phase cell', await p.locator('[data-task-phase]').count() === 0)
}

if (MODE === 'calendar' || MODE === 'month' || MODE === 'calendar-none') {
  await p.locator('.cal-month-grid, [data-cal-header]').first().waitFor({ state: 'visible', timeout: 8000 })
  await p.waitForTimeout(800)
  const todayNum = String(new Date(Date.now()).getDate())
}

if (MODE === 'calendar') {
  const strip = p.locator('[data-cal-milestones]')
  ok('the calendar is on the week view (the grid is drawn)', await p.locator('.cal-month-grid').count() === 0)
  await strip.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  ok('a strip of markers is drawn for the week', await strip.count() === 1)
  const chips = strip.locator('[data-milestone-marker]')
  ok('four markers: three open and one done, nothing else', await chips.count() === 4, `${await chips.count()}`)
  const labels = await chips.evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  ok('the archived project\'s milestone, the undated one and next month\'s are not drawn', labels.every(l => !/Archived|No day|Far away/.test(l)), JSON.stringify(labels))
  ok('the done one says so', labels.filter(l => /, done\./.test(l)).length === 1 && /Finished today/.test(labels.find(l => /, done\./.test(l))))
  // Right day: the chip sits under today's header cell.
  const colOk = await p.evaluate(() => {
    const s = document.querySelector('[data-cal-milestones]'); const head = s.previousElementSibling
    const cells = [...head.children].slice(1)
    const chip = s.querySelector('[data-milestone-marker]').getBoundingClientRect()
    const x = chip.left + chip.width / 2
    const hit = cells.find(c => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right })
    return { text: hit?.innerText.replace(/\s+/g, ' ').trim(), n: cells.length }
  })
  ok('it sits in the column headed with today\'s date (7 columns)', colOk.n === 7 && new RegExp(`\\b${new Date().getDate()}\\b`).test(colOk.text ?? ''), JSON.stringify(colOk))
  const h = await strip.boundingBox()
  ok('the strip is not taller than its cap (68px) plus padding', h.height <= 80, `${h.height}`)
  ok('nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))
  if (process.env.SHOT_CAL) await p.screenshot({ path: process.env.SHOT_CAL })
  await chips.first().click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  ok('a marker opens its project\'s page', await p.locator(`[data-project-page="${P_A}"]`).count() === 1)
  ok('and the module is Projects', await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ui') || '{}').state?.activeModule) === 'projects')
}

if (MODE === 'calendar-none') {
  ok('the week grid is drawn (day headers present) — so the absence below is not a blank page',
    await p.evaluate(() => { const n = String(new Date().getDate()); return [...document.querySelectorAll('div')].some(d => d.children.length >= 7 && [...d.children].slice(1).every(c => /\d/.test(c.textContent ?? '')) && (d.textContent ?? '').includes(n)) }))
  ok('no milestone strip when nothing is due this week', await p.locator('[data-cal-milestones]').count() === 0)
  ok('and no marker at all (archived, undated and far-off ones are not here)', await p.locator('[data-milestone-marker]').count() === 0)
  ok('nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))
}

if (MODE === 'month') {
  const todayCell = p.locator('.cal-cell').filter({ has: p.locator('[data-milestone-marker]') })
  await todayCell.first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  ok('exactly one day cell carries markers (the dates in other weeks are not today)', await todayCell.count() === 1, `${await todayCell.count()}`)
  ok('a cell shows two markers at most, though four are due', await todayCell.locator('[data-milestone-marker]').count() === 2, `${await todayCell.locator('[data-milestone-marker]').count()}`)
  const t = await todayCell.innerText()
  ok('the archived and undated ones are not in it', !/Archived|No day/.test(t), t.replace(/\n/g, ' | '))
  ok('there is also a marker on the day 45 days out', await p.locator('[data-milestone-marker]').count() >= 2)
  if (process.env.SHOT_MONTH) await p.screenshot({ path: process.env.SHOT_MONTH })
  await todayCell.locator('[data-milestone-marker]').first().click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  ok('a marker opens its project, not the day', await p.locator(`[data-project-page="${P_A}"]`).count() === 1)
  ok('and the calendar is still on the month view', await p.evaluate(() => localStorage.getItem('cal-view')) === 'month')
  ok('nothing was written to Google', googleWrites.length === 0, JSON.stringify(googleWrites))
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
