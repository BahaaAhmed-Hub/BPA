// node scripts/project-page.mjs [page|panel]
// Needs a dev server on 5199.
//
// Chunk 3 of Projects: the project page (Overview, Tasks) and the Project field
// in the task's own panel. Claims are read off the store, the stub server's rows
// and computed geometry.
//
//   page   a card opens its page; the numbers; ticking, adding, bringing in and
//          taking out a task all reach the store AND the server; back; delete
//          from the page returns to the grid
//   panel  the task panel's Project cell sets / clears projectId, leaves the
//          quadrant alone, offers only live projects, and its arrow opens the page
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'page'
const P_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const P_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const P_DONE = 'aaaaaaaa-0000-4000-8000-00000000000c'
const now = new Date().toISOString()
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
const task = (n, title, o = {}) => ({
  id: `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, user_id: U, company_id: null, title,
  description: null, quadrant: 'important_not_urgent', effort_minutes: null, due_date: null, status: 'todo', delegated_to: null,
  done_looks_like: null, created_at: now, completed_at: null, planned_time: null, owner_id: null, company_tag: null,
  completed: false, task_type: null, priority: null, board_status: null, calendar_id: null, gcal_event_id: null,
  parent_task_id: null, captured_via: null, urgent: false, checklist: [], attachments: [], links: [],
  project_id: null, milestone_id: null, ...o,
})
const project = (id, name, o = {}) => ({
  id, user_id: U, name, kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null,
  target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o,
})
const id = n => `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
db.projects = [
  project(P_A, 'Launch the site', { target_date: day(-6), start_date: '2026-09-01', notes: 'Done looks like: live, fast, and announced.' }),
  project(P_B, 'Kitchen renovation', { kind: 'personal', color: '#1D8A6A' }),
  project(P_DONE, 'Annual report', { status: 'done', color: '#C2622B' }),
]
db.tasks = [
  task(1, 'Design signed off', { project_id: P_A, completed: true, status: 'done' }),
  task(2, 'Write the copy', { project_id: P_A, due_date: day(-2) }),
  task(3, 'Ship it', { project_id: P_A, due_date: day(5) }),
  task(4, 'Cancelled thing', { project_id: P_A, status: 'deferred' }),
  task(5, 'Pick the tiles', { project_id: P_B }),
  task(6, 'Loose task one'),
  task(7, 'Loose task two'),
  task(8, 'Already finished loose', { completed: true, status: 'done' }),
  task(9, 'Filed in the done project', { project_id: P_DONE }),
]
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
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
await ctx.addInitScript(([s, start]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'list')
} catch {} }, [session, MODE === 'page' ? 'projects' : 'tasks'])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore'), tasks: await urlOf('taskStore'), ui: await urlOf('uiStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore, tasks = (await import(urls.tasks)).useTaskStore, ui = (await import(urls.ui)).useUIStore
  return await (new Function('proj', 'tasks', 'ui', `return (${src})(proj, tasks, ui)`))(proj, tasks, ui)
}, [fn.toString(), URLS])
const tasksNow = () => S((_p, t) => t.getState().tasks.map(x => ({ id: x.id, title: x.title, projectId: x.projectId ?? null, completed: x.completed, quadrant: x.quadrant ?? null, company: x.company, status: x.status })))
const row = t => db.tasks.find(x => x.title === t)
ok('found the app\'s own store modules', !!URLS.proj && !!URLS.tasks && !!URLS.ui)

if (MODE === 'page') {
  const card = p.locator(`[data-project-card="${P_A}"]`)
  await card.waitFor({ state: 'visible', timeout: 6000 })
  ok('the grid is drawn first', await p.locator('[data-project-page]').count() === 0)
  await card.click()
  const page = p.locator(`[data-project-page="${P_A}"]`)
  await page.waitFor({ state: 'visible', timeout: 4000 })
  ok('a card opens that project\'s page', await page.count() === 1 && await p.locator('[data-project-card]').count() === 0)
  ok('the page names it', (await page.locator('h1').innerText()) === 'Launch the site')
  const stat = k => page.locator(`[data-project-stat="${k}"]`).innerText().then(t => t.replace(/\s+/g, ' ').trim())
  ok('progress 33% (1 of 3, cancelled excluded)', /33%/.test(await stat('progress')), await stat('progress'))
  ok('done 1', /\b1\b/.test(await stat('done')), await stat('done'))
  ok('open 2', /\b2\b/.test(await stat('open')), await stat('open'))
  ok('overdue 1', /\b1\b/.test(await stat('overdue')), await stat('overdue'))
  const od = await page.locator('[data-project-stat="overdue"] div').nth(1).evaluate(el => getComputedStyle(el).color)
  const normal = await page.locator('[data-project-stat="done"] div').nth(1).evaluate(el => getComputedStyle(el).color)
  ok('a non-zero overdue figure is drawn in the negative ink, the others are not', od !== normal, `${od} vs ${normal}`)
  const w = await page.locator('[role=progressbar]').evaluate(el => Math.round(el.firstElementChild.getBoundingClientRect().width / el.getBoundingClientRect().width * 100))
  ok('the bar is drawn at 33% (measured)', w === 33, `${w}`)
  ok('target says 6 days late', /6 days late/.test(await page.locator('[data-project-target]').innerText()), await page.locator('[data-project-target]').innerText())
  ok('the notes are shown', (await page.locator('[data-project-notes]').innerText()).includes('live, fast, and announced'))

  if (process.env.SHOT_OVERVIEW) await p.screenshot({ path: process.env.SHOT_OVERVIEW })
  await page.getByRole('tab', { name: /^Tasks/ }).click()
  const groups = await page.locator('[data-project-group]').evaluateAll(els => els.map(e => [e.getAttribute('data-project-group'), e.querySelectorAll('[data-project-task]').length]))
  ok('Open 2 · Done 1 · Not doing 1', JSON.stringify(groups) === JSON.stringify([['Open', 2], ['Done', 1], ['Not doing', 1]]), JSON.stringify(groups))
  ok('another project\'s task is not listed', await page.getByText('Pick the tiles').count() === 0)

  if (process.env.SHOT_TASKS) await p.screenshot({ path: process.env.SHOT_TASKS })
  // Tick one — reaches the store and the server, and the numbers follow.
  await page.getByRole('button', { name: 'Mark Write the copy done' }).click()
  await p.waitForTimeout(2600)
  ok('ticking sets completed in the store', (await tasksNow()).find(t => t.title === 'Write the copy')?.completed === true)
  ok('and on the server', row('Write the copy')?.completed === true)
  await page.getByRole('tab', { name: 'Overview' }).click()
  ok('progress moves to 67% and overdue to 0', /67%/.test(await stat('progress')) && /\b0\b/.test(await stat('overdue')), `${await stat('progress')} / ${await stat('overdue')}`)
  await page.getByRole('tab', { name: /^Tasks/ }).click()

  // Add a task: it carries the project, and it is PLACED (not in the brain dump).
  await page.getByLabel('New task title').fill('Book the launch party')
  await page.getByRole('button', { name: /^Add$|Add$/ }).click()
  await p.waitForTimeout(2600)
  const added = (await tasksNow()).find(t => t.title === 'Book the launch party')
  ok('a task added here exists and carries the project', added?.projectId === P_A, JSON.stringify(added))
  ok('it is placed in a quadrant — not the brain dump (null)', added?.quadrant === 'do', `${added?.quadrant}`)
  ok('the server row carries project_id', row('Book the launch party')?.project_id === P_A, `${row('Book the launch party')?.project_id}`)
  ok('the input is cleared and the row is listed', (await page.getByLabel('New task title').inputValue()) === '' && await page.getByText('Book the launch party').count() === 1)

  // Bring in an existing task.
  const opts = await page.getByLabel('Bring in an existing task').locator('option').allTextContents()
  ok('only open tasks in no project are offered', JSON.stringify(opts.filter(o => !o.startsWith('Bring'))) === JSON.stringify(['Loose task one', 'Loose task two']), JSON.stringify(opts))
  await page.getByLabel('Bring in an existing task').selectOption({ label: 'Loose task one' })
  await p.waitForTimeout(2600)
  ok('bringing one in sets its project', (await tasksNow()).find(t => t.title === 'Loose task one')?.projectId === P_A && row('Loose task one')?.project_id === P_A)
  ok('and it leaves the offer', !(await page.getByLabel('Bring in an existing task').locator('option').allTextContents()).includes('Loose task one'))

  // Take it out: kept, unassigned.
  await page.getByRole('button', { name: 'Take Loose task one out of this project' }).click()
  await p.waitForTimeout(2600)
  const out = (await tasksNow()).find(t => t.title === 'Loose task one')
  ok('taking it out keeps the task and clears its project', !!out && out.projectId === null, JSON.stringify(out))
  ok('and clears it on the server', row('Loose task one')?.project_id === null, `${row('Loose task one')?.project_id}`)

  // Open a task from the list → the Tasks module with its panel.
  await page.getByRole('button', { name: 'Ship it', exact: true }).click()
  await p.waitForTimeout(800)
  ok('a task opens in Tasks (module switched)', await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ui') || '{}').state?.activeModule) === 'tasks')
  ok('with its detail panel showing that task', await p.getByPlaceholder('What is it?').inputValue() === 'Ship it')
  await p.locator('[data-side-rail] button[aria-label="Projects"]').click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible', timeout: 3000 })
  ok('coming back, the page is still open', true)

  // Back, then delete from the page.
  await page.getByRole('button', { name: 'Back to all projects' }).click()
  ok('back returns to the grid', await p.locator('[data-project-card]').count() >= 1 && await p.locator('[data-project-page]').count() === 0)
  await p.locator(`[data-project-card="${P_A}"]`).click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible' })
  await p.getByRole('button', { name: /Edit/ }).click()
  await p.locator('[data-project-dialog]').getByRole('button', { name: 'Delete' }).click()
  await p.locator('[data-project-dialog]').getByRole('button', { name: 'Yes, delete' }).click()
  await p.waitForTimeout(500)
  ok('deleting from the page returns to the grid, not a blank screen', await p.locator('[data-project-page]').count() === 0 && await p.locator('[data-projects-module]:visible').count() === 1 && await p.locator(`[data-project-card="${P_A}"]`).count() === 0)
  ok('its tasks are kept', (await tasksNow()).filter(t => ['Write the copy', 'Ship it', 'Design signed off', 'Book the launch party'].includes(t.title)).length === 4)
  ok('and unassigned', (await tasksNow()).filter(t => t.projectId === P_A).length === 0)
}

if (MODE === 'panel') {
  await S((_p, tasks, ui) => ui.getState().focusOn({ module: 'tasks', id: tasks.getState().tasks.find(t => t.title === 'Loose task one').id }))
  const cell = p.locator('[data-task-project]')
  await cell.waitFor({ state: 'visible', timeout: 6000 })
  ok('the panel is on the task asked for', await p.getByPlaceholder('What is it?').inputValue() === 'Loose task one')
  ok('the Project cell says "No project"', (await cell.innerText()).includes('No project'))
  const q0 = (await tasksNow()).find(t => t.title === 'Loose task one').quadrant
  ok('the fixture task really is placed (a null quadrant would make the next claim vacuous)', q0 === 'schedule', `${q0}`)
  const opts = await p.getByLabel('Project', { exact: true }).locator('option').allTextContents()
  ok('it offers live projects only (not the done one) and "No project"', JSON.stringify(opts) === JSON.stringify(['No project', 'Launch the site', 'Kitchen renovation']), JSON.stringify(opts))
  await p.getByLabel('Project', { exact: true }).selectOption({ label: 'Launch the site' })
  await p.waitForTimeout(2600)
  const t1 = (await tasksNow()).find(t => t.title === 'Loose task one')
  ok('choosing one sets projectId in the store', t1.projectId === P_A, JSON.stringify(t1))
  ok('and on the server', row('Loose task one')?.project_id === P_A)
  ok('the quadrant is untouched (it keeps its board)', t1.quadrant === q0, `${q0} -> ${t1.quadrant}`)
  ok('the cell now names it', (await cell.innerText()).includes('Launch the site'))
  const dot = await cell.locator('span').first().evaluate(el => getComputedStyle(el).backgroundColor)
  ok('with that project\'s colour', dot === 'rgb(47, 99, 168)', dot)

  await p.getByRole('button', { name: 'Open Launch the site' }).click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible', timeout: 4000 })
  ok('the arrow opens that project\'s page', true)
  ok('listing the task', await p.getByText('Loose task one').count() >= 1)

  // A task in a done project still shows it, and can be moved out of it.
  await S((_p, tasks, ui) => ui.getState().focusOn({ module: 'tasks', id: tasks.getState().tasks.find(t => t.title === 'Filed in the done project').id }))
  await p.locator('[data-task-project]').waitFor({ state: 'visible', timeout: 6000 })
  ok('a task in a finished project still shows it', (await p.locator('[data-task-project]').innerText()).includes('Annual report'))
  const opts2 = await p.getByLabel('Project', { exact: true }).locator('option').allTextContents()
  ok('and that project stays selectable for it', opts2.includes('Annual report'), JSON.stringify(opts2))
  await p.getByLabel('Project', { exact: true }).selectOption({ label: 'No project' })
  await p.waitForTimeout(2600)
  const t2 = (await tasksNow()).find(t => t.title === 'Filed in the done project')
  ok('clearing keeps the task and removes the project', !!t2 && t2.projectId === null && row('Filed in the done project')?.project_id === null, JSON.stringify(t2))
  ok('no Open arrow when there is no project', await p.getByRole('button', { name: /^Open Annual report/ }).count() === 0)
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
