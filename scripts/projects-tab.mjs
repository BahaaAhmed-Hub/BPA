// node scripts/projects-tab.mjs [create|cards|narrow]
// Needs a dev server on 5199.
//
// Chunk 2 of Projects: the rail entry, the grid of cards and the create/edit
// dialog. Claims are read off the store, the stub server's rows, computed
// geometry and hit-testing — never off innerText alone.
//
//   create  empty state → New project → fields, validation, company rule →
//           the card, the store row and the pushed server row
//   cards   progress numbers from the tasks pointing at it, the Open / Done /
//           Archived filters, delete keeping its tasks
//   narrow  at phone width: no horizontal scroll, the card under a point is the
//           card, and the dialog is above the page it dims
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'create'
const P_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const P_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const P_C = 'aaaaaaaa-0000-4000-8000-00000000000c'
const now = new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA')
const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA')

const task = (n, title, o = {}) => ({
  id: `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, user_id: U, company_id: null, title,
  description: null, quadrant: 'schedule', effort_minutes: null, due_date: null, status: 'open', delegated_to: null,
  done_looks_like: null, created_at: now, completed_at: null, planned_time: null, owner_id: null, company_tag: null,
  completed: false, task_type: null, priority: null, board_status: null, calendar_id: null, gcal_event_id: null,
  parent_task_id: null, captured_via: null, urgent: false, checklist: [], attachments: [], links: [],
  project_id: null, milestone_id: null, ...o,
})
const project = (id, name, o = {}) => ({
  id, user_id: U, name, kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null,
  target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o,
})

const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
if (MODE === 'cards' || MODE === 'narrow' || MODE === 'shot') {
  db.projects = [
    project(P_A, 'Launch the site', { target_date: yesterday }),
    project(P_B, 'Kitchen renovation', { kind: 'personal', color: '#1D8A6A', status: 'done' }),
    project(P_C, 'Old idea', { archived: true }),
  ]
  db.tasks = [
    task(1, 'Design signed off', { project_id: P_A, completed: true, status: 'done' }),
    task(2, 'Write copy', { project_id: P_A, due_date: yesterday }),
    task(3, 'Ship it', { project_id: P_A, due_date: today }),
    task(4, 'Cancelled thing', { project_id: P_A, status: 'deferred' }),   // how the server stores a cancelled task (statusToDb)
    task(5, 'Pick tiles', { project_id: P_B }),
  ]
  db.project_milestones = [
    { id: 'bbbbbbbb-0000-4000-8000-00000000000a', project_id: P_A, user_id: U, title: 'Beta live', due_date: '2026-12-01', done: false, sort_order: 1 },
    { id: 'bbbbbbbb-0000-4000-8000-00000000000b', project_id: P_A, user_id: U, title: 'Kickoff', due_date: '2026-10-01', done: true, sort_order: 0 },
  ]
}
let refuse = false
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const W = MODE === 'narrow' ? 390 : 1400
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: 900 } })
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
  if (m === 'GET') return j(db[table])
  if (refuse) return j({ message: `permission denied for table ${table}` }, 403)
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) { const at = db[table].findIndex(x => x.id === row.id); if (at >= 0) db[table][at] = { ...db[table][at], ...row }; else db[table].push(row) }
    return j([])
  }
  if (m === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); for (const row of db[table]) Object.assign(row, body); return j([]) }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
const companies = [
  { id: 'co-teradix', name: 'Teradix Ltd', color: '#2F63A8', users: [] },
  { id: 'co-hidden', name: 'Hidden Co', color: '#B03A3A', users: [], hidden: true },
]
await ctx.addInitScript(([s, cos]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-companies', JSON.stringify(cos))
} catch {} }, [session, companies])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const urlOf = (name) => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name)
  .find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore'), tasks: await urlOf('taskStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore
  const tasks = (await import(urls.tasks)).useTaskStore
  return await (new Function('proj', 'tasks', `return (${src})(proj, tasks)`))(proj, tasks)
}, [fn.toString(), URLS])
const projects = () => S(proj => proj.getState().projects)
const tasksNow = () => S((_p, t) => t.getState().tasks.map(x => ({ id: x.id, title: x.title, projectId: x.projectId ?? null })))
ok('found the app\'s own store modules', !!URLS.proj && !!URLS.tasks)

// ── the door ─────────────────────────────────────────────────────────────────
const railBtn = p.locator('[data-side-rail] button[aria-label="Projects"]')
ok('the rail has a Projects entry', await railBtn.count() === 1, `${await railBtn.count()}`)
ok('the module is not drawn before it is opened', await p.locator('[data-projects-module]:visible').count() === 0)
await railBtn.click()
await p.locator('[data-projects-module]').waitFor({ state: 'visible', timeout: 5000 })
ok('pressing it opens the Projects screen', await p.locator('[data-projects-module]:visible').count() === 1)
const barBox = await p.locator('[data-projects-bar]').evaluate(el => { const c = getComputedStyle(el); return { r: c.borderTopLeftRadius, bg: c.backgroundColor } })
// The rail's pill is the first element inside it drawn with a 999px radius.
const railBox = await p.locator('[data-side-rail]').evaluate(root => {
  const pill = [root, ...root.querySelectorAll('*')].find(e => getComputedStyle(e).borderTopLeftRadius === '999px' && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')
  if (!pill) return { r: 'none found', bg: '' }
  const c = getComputedStyle(pill); return { r: c.borderTopLeftRadius, bg: c.backgroundColor } })
ok('its bar is the rail\'s own lozenge (radius and ground)', barBox.r === railBox.r && barBox.bg === railBox.bg, `${JSON.stringify(barBox)} vs ${JSON.stringify(railBox)}`)

const dlg = p.locator('[data-project-dialog]')
// A card opens the project's page; the edit dialog is behind its Edit button.
const editFromCard = async (id) => {
  await p.locator(`[data-project-card="${id}"]`).click()
  await p.locator(`[data-project-page="${id}"]`).waitFor({ state: 'visible', timeout: 5000 })
  await p.getByRole('button', { name: /Edit/ }).click()
  await dlg.waitFor({ state: 'visible' })
}
const backToGrid = async (id) => {
  await p.keyboard.press('Escape').catch(() => {})
  if (await p.locator('[data-project-page]').count()) await p.getByRole('button', { name: 'Back to all projects' }).click()
  await p.locator('[data-project-page]').waitFor({ state: 'detached', timeout: 5000 })
}

if (MODE === 'create') {
  ok('with no projects, the empty state is drawn', await p.locator('[data-projects-empty]').count() === 1)
  ok('and the filters are not (nothing to filter)', await p.getByLabel('Which projects').count() === 0)
  await p.getByRole('button', { name: /Create your first project/ }).click()
  await dlg.waitFor({ state: 'visible' })
  const cx = await dlg.evaluate(el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 24] })
  const top = await p.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-project-dialog]'), cx)
  ok('the dialog is on top of the page it dims (hit-test)', top)
  ok('the name field has focus on open', await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Project name'))
  const save = dlg.getByRole('button', { name: 'Create project' })
  ok('Create is disabled with no name', await save.isDisabled())

  await dlg.getByLabel('Project name').fill('Launch the site')
  ok('Create enables once there is a name', await save.isEnabled())
  ok('a work project offers a company', await dlg.getByLabel('Company').count() === 1)
  const opts = await dlg.getByLabel('Company').locator('option').allTextContents()
  ok('the company list holds the visible company and not the hidden one', opts.includes('Teradix Ltd') && !opts.includes('Hidden Co'), JSON.stringify(opts))
  await dlg.getByLabel('Company').selectOption('co-teradix')
  await dlg.getByLabel('Start date').fill('2026-11-10')
  await dlg.getByLabel('Target date').fill('2026-11-01')
  ok('a target before the start is called out', await dlg.getByRole('alert').count() === 1)
  ok('and Create refuses it', await save.isDisabled())
  await dlg.getByLabel('Target date').fill('2026-12-15')
  ok('fixing the date clears it', await dlg.getByRole('alert').count() === 0 && await save.isEnabled())

  // Personal drops the company — both the field and the stored value.
  await dlg.getByRole('tab', { name: 'Personal' }).click()
  ok('Personal removes the company field', await dlg.getByLabel('Company').count() === 0)
  await dlg.getByRole('tab', { name: 'Work' }).click()
  await dlg.getByLabel('Company').selectOption('co-teradix')
  await dlg.getByLabel('Project colour').getByRole('radio').nth(3).click()
  await save.click()
  await p.waitForTimeout(300)
  ok('the dialog closes on save', await dlg.count() === 0)
  const stored = await projects()
  ok('exactly one project is in the store', stored.length === 1, `${stored.length}`)
  const s = stored[0] ?? {}
  ok('with the fields that were entered', s.name === 'Launch the site' && s.kind === 'work' && s.companyId === 'co-teradix' && s.startDate === '2026-11-10' && s.targetDate === '2026-12-15' && s.status === 'active', JSON.stringify(s))
  ok('and the colour that was picked (4th swatch)', s.color === '#7F8B1E', s.color)
  const card = p.locator(`[data-project-card="${s.id}"]`)
  ok('a card for it is drawn', await card.count() === 1)
  ok('showing the company by name', (await card.innerText()).includes('Teradix Ltd'))
  ok('and "No tasks yet" (nothing points at it)', (await card.locator('[data-project-count]').innerText()).includes('No tasks yet'))
  ok('the empty state is gone and the filters appear', await p.locator('[data-projects-empty]').count() === 0 && await p.getByLabel('Which projects').count() === 1)
  await p.waitForTimeout(2500)
  ok('it reached the server', db.projects.length === 1 && db.projects[0].name === 'Launch the site' && db.projects[0].company_id === 'co-teradix', JSON.stringify(db.projects.map(x => x.name)))

  // Edit: open it, change kind to personal, save → company is cleared in the store.
  await editFromCard(s.id)
  ok('a card opens the page, and Edit opens the dialog with the stored values', (await dlg.getByLabel('Project name').inputValue()) === 'Launch the site' && (await dlg.getByLabel('Company').inputValue()) === 'co-teradix')
  await dlg.getByRole('tab', { name: 'Personal' }).click()
  await dlg.getByRole('button', { name: 'Save' }).click()
  await p.waitForTimeout(300)
  await backToGrid()
  const after = (await projects())[0]
  ok('making it personal clears the stored company', after.kind === 'personal' && after.companyId === undefined, JSON.stringify(after))
  ok('and the card stops naming a company', !(await card.innerText()).includes('Teradix Ltd') && (await card.innerText()).includes('Personal'))
  // Escape cancels without saving.
  await editFromCard(s.id)
  await dlg.getByLabel('Project name').fill('Renamed but cancelled')
  await p.keyboard.press('Escape')
  ok('Escape closes without saving', await dlg.count() === 0 && (await projects())[0].name === 'Launch the site')
}

if (MODE === 'cards') {
  const cardA = p.locator(`[data-project-card="${P_A}"]`)
  await cardA.waitFor({ state: 'visible', timeout: 5000 })
  ok('the open project is shown, the done and archived ones are not', await p.locator('[data-project-card]').count() === 1)
  const count = await cardA.locator('[data-project-count]').innerText()
  ok('progress counts tasks pointing at it, cancelled excluded: 1 of 3', /1 of 3 tasks done/.test(count), count)
  ok('and the overdue one is named', /1 overdue/.test(count), count)
  const pct = await cardA.locator('[role=progressbar]').evaluate(el => {
    const f = el.firstElementChild; return Math.round(f.getBoundingClientRect().width / el.getBoundingClientRect().width * 100) })
  ok('the bar is drawn at 33% of its track (measured, not the attribute)', pct === 33, `${pct}`)
  ok('aria-valuenow agrees', await cardA.locator('[role=progressbar]').getAttribute('aria-valuenow') === '33')
  const text = await cardA.innerText()
  ok('the next milestone is the soonest one not done (Beta live, not Kickoff)', text.includes('Beta live') && !text.includes('Kickoff'), text.replace(/\n/g, ' | '))
  ok('a target date in the past reads "Was due"', /Was due/.test(text), text.replace(/\n/g, ' | '))

  await p.getByLabel('Which projects').getByText('Done', { exact: true }).click()
  ok('Done shows the finished project only', await p.locator('[data-project-card]').count() === 1 && await p.locator(`[data-project-card="${P_B}"]`).count() === 1)
  await p.getByLabel('Which projects').getByText('Archived', { exact: true }).click()
  ok('Archived shows the archived one only', await p.locator('[data-project-card]').count() === 1 && await p.locator(`[data-project-card="${P_C}"]`).count() === 1)
  await p.getByLabel('Which projects').getByText('Open', { exact: true }).click()
  await p.getByLabel('Kind of project').getByText('Personal', { exact: true }).click()
  ok('a kind filter that matches nothing says so, rather than drawing a blank', await p.locator('[data-projects-none]').count() === 1 && await p.locator('[data-project-card]').count() === 0)
  await p.getByLabel('Kind of project').getByText('All', { exact: true }).click()

  // Archive from the dialog moves it between views.
  await editFromCard(P_A)
  await dlg.getByRole('button', { name: 'Archive' }).click()
  await p.waitForTimeout(300)
  await backToGrid()
  ok('archiving takes it out of Open', await p.locator(`[data-project-card="${P_A}"]`).count() === 0)
  ok('and the store says archived', (await projects()).find(x => x.id === P_A)?.archived === true)
  await p.getByLabel('Which projects').getByText('Archived', { exact: true }).click()
  ok('it is in Archived now', await p.locator(`[data-project-card="${P_A}"]`).count() === 1)

  // Delete keeps its tasks.
  await editFromCard(P_A)
  await dlg.getByRole('button', { name: 'Unarchive' }).click()
  await backToGrid()
  await p.getByLabel('Which projects').getByText('Open', { exact: true }).click()
  await editFromCard(P_A)
  await dlg.getByRole('button', { name: 'Delete' }).click()
  const warn = await dlg.innerText()
  ok('delete asks first, and says its tasks stay (with the number: 4)', /Its tasks \(4\) stay, unassigned/.test(warn), warn.replace(/\n/g, ' | ').slice(0, 200))
  ok('nothing is deleted yet', (await projects()).some(x => x.id === P_A))
  await dlg.getByRole('button', { name: 'Keep' }).click()
  ok('"Keep" backs out', (await projects()).some(x => x.id === P_A) && await dlg.count() === 1)
  await dlg.getByRole('button', { name: 'Delete' }).click()
  await dlg.getByRole('button', { name: 'Yes, delete' }).click()
  await p.waitForTimeout(300)
  ok('the project is gone', !(await projects()).some(x => x.id === P_A) && await p.locator(`[data-project-card="${P_A}"]`).count() === 0)
  const t = await tasksNow()
  ok('all five tasks are kept', t.length === 5, `${t.length}`)
  ok('none of them points at it any more', t.filter(x => x.projectId === P_A).length === 0)
  ok('the other project\'s task still does', t.find(x => x.title === 'Pick tiles')?.projectId === P_B)
}

if (MODE === 'shot') {
  await p.locator(`[data-project-card="${P_A}"]`).waitFor({ state: 'visible', timeout: 5000 })
}

if (MODE === 'narrow') {
  await p.locator(`[data-project-card="${P_A}"]`).waitFor({ state: 'visible', timeout: 5000 })
  const over = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, mod: document.querySelector('[data-projects-module]').scrollWidth }))
  ok('no horizontal page scroll at 390px', over.sw <= over.cw + 1, JSON.stringify(over))
  const box = await p.locator(`[data-project-card="${P_A}"]`).boundingBox()
  ok('the card fits inside the viewport', box.x >= 0 && box.x + box.width <= W + 1, JSON.stringify(box))
  const hit = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-project-card]')?.getAttribute('data-project-card'), [box.x + box.width / 2, box.y + box.height / 2])
  ok('the card under a point is that card (hit-test)', hit === P_A, `${hit}`)
  await editFromCard(P_A)
  const d = await dlg.boundingBox()
  ok('the dialog fits the phone width', d.x >= 0 && d.x + d.width <= W + 1, JSON.stringify(d))
  ok('and its Save button is reachable inside the viewport', await dlg.getByRole('button', { name: 'Save' }).evaluate(el => { const r = el.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0 }))
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
