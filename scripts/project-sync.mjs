// node scripts/project-sync.mjs [create|elsewhere|refused|edit-wins|orphan|orphan-patch]
// Needs a dev server on 5199.
//
// Chunk 1 of Projects has no screen, so the store is driven directly and the
// claim is read off the **stub server's rows** and the store — never off pixels.
//
//   create    a project, a milestone and a link made here reach the server, and
//             the task linked to the project carries project_id there
//   elsewhere a project made on another device arrives on reload, and one made
//             here and not yet pushed is NOT read as deleted elsewhere
//   refused   the server refuses every write: a reload neither drops the local
//             project nor undoes an edit made to it
//   edit-wins a project the server HAS, edited here while writes are refused: a
//             reload keeps the edit instead of putting the server's name back
//   orphan-patch  the task push is refused, so the ONLY thing that can clear
//             project_id on the server is the direct update made on delete
//   orphan    deleting a project keeps its tasks, clears project_id in the store
//             AND on the server, removes the project / milestone / link, and a
//             reload (with the delete push refused) does not bring any back
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'create'
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const T1 = '11111111-0000-4000-8000-000000000001'
const T2 = '11111111-0000-4000-8000-000000000002'
const now = new Date().toISOString()

const task = (id, title, project) => ({
  id, user_id: U, company_id: null, title, description: null, quadrant: 'schedule',
  effort_minutes: null, due_date: null, status: 'open', delegated_to: null, done_looks_like: null,
  created_at: now, completed_at: null, planned_time: null, owner_id: null, company_tag: null,
  completed: false, task_type: null, priority: null, board_status: null, calendar_id: null,
  gcal_event_id: null, parent_task_id: null, captured_via: null, urgent: false,
  checklist: [], attachments: [], links: [], project_id: project ?? null, milestone_id: null,
})
const project = (id, name) => ({
  id, user_id: U, name, kind: 'work', color: null, status: 'active', company_id: null,
  start_date: null, target_date: null, notes: null, archived: false, created_at: now, updated_at: now,
})

// The server. Rows are real state, so a write that lands is visible to the next
// read — and `refuse` lets it say no, because a stub that cannot refuse proves nothing.
const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
let refuse = false
let refuseTasksPost = false
const reads = {}
const log = []   // [method, table, n]
if (MODE === 'create' || MODE === 'refused') {
  db.tasks = [task(T1, 'Write the brief', null)]
}
if (MODE === 'elsewhere') {
  db.projects = [project(P2, 'Made on the iPad')]
  db.tasks = [task(T1, 'Write the brief', null)]
}
if (MODE === 'edit-wins') {
  db.projects = [project(P1, 'Server name')]
  db.tasks = [task(T1, 'Write the brief', null)]
}
if (MODE === 'orphan' || MODE === 'orphan-patch') {
  db.projects = [project(P1, 'Doomed project')]
  db.project_milestones = [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', project_id: P1, user_id: U, title: 'Draft', due_date: null, done: false, sort_order: 0 }]
  db.project_links = [{ id: 'cccccccc-0000-4000-8000-000000000001', project_id: P1, user_id: U, kind: 'thread', ref_id: 'me@x.com|t1' }]
  db.tasks = [task(T1, 'Belongs to the doomed one', P1), task(T2, 'Loose task', null)]
}

const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } })
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
  if (m === 'GET') reads[table] = (reads[table] ?? 0) + 1
  if (m === 'GET') return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table])
  if (refuseTasksPost && table === 'tasks' && m === 'POST') { log.push([m, table, 'refused']); return j({ message: 'permission denied for table tasks' }, 403) }
  if (refuse) { log.push([m, table, 'refused']); return j({ message: `permission denied for table ${table}` }, 403) }
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) {
      const at = db[table].findIndex(x => x.id === row.id)
      if (at >= 0) db[table][at] = { ...db[table][at], ...row }; else db[table].push(row)
    }
    log.push([m, table, rows.length]); return j([])
  }
  if (m === 'PATCH') {
    const body = JSON.parse(q.postData() || '{}')
    const pid = (u.searchParams.get('project_id') || '').replace('eq.', '')
    let n = 0
    for (const row of db[table]) if (!pid || row.project_id === pid) { Object.assign(row, body); n++ }
    log.push([m, table, n]); return j([])
  }
  if (m === 'DELETE') {
    const ids = new Set(idsIn(u)); const before = db[table].length
    db[table] = db[table].filter(x => !ids.has(x.id)); log.push([m, table, before - db[table].length]); return j([])
  }
  return j([])
})
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// The app's own store instances. Vite appends `?t=<n>` to a module's URL once
// the file has been edited, so importing a bare path can hand back a SECOND copy
// of the store — one the app never reads from and liveSync never reloads. The
// URL is taken from what the page itself loaded, and asserted below.
const urlOf = (name) => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name)
  .find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore'), tasks: await urlOf('taskStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore
  const tasks = (await import(urls.tasks)).useTaskStore
  return await (new Function('proj', 'tasks', `return (${src})(proj, tasks)`))(proj, tasks)
}, [fn.toString(), URLS])
const pstate = () => S((proj) => { const s = proj.getState(); return { projects: s.projects, milestones: s.milestones, links: s.links } })
const tstate = () => S((_p, tasks) => tasks.getState().tasks.map(t => ({ id: t.id, title: t.title, projectId: t.projectId ?? null })))
const wake = async () => {
  await p.evaluate(() => { window.dispatchEvent(new Event('online')) })   // 'online' is never throttled
  const was = reads.projects ?? 0
  await p.waitForTimeout(6500)
  // A reload that never ran proves nothing about what survives one.
  ok('the wake really re-read projects', (reads.projects ?? 0) > was, `${was} -> ${reads.projects ?? 0}`)
}

ok('the harness found the app\'s own store modules (not a second copy)', !!URLS.proj && !!URLS.tasks, JSON.stringify(URLS))
const before = await pstate()

if (MODE === 'create') {
  ok('the page reached the store (a vacuous run reads an empty store either way)',
     (await tstate()).some(t => t.id === T1), JSON.stringify(await tstate()))
  await S((proj, tasks) => {
    const id = proj.getState().addProject({ name: 'Launch the site', kind: 'work' })
    proj.getState().addMilestone(id, { title: 'Design signed off', dueDate: '2026-11-01' })
    proj.getState().addLink(id, 'thread', 'me@x.com|t9')
    proj.getState().addLink(id, 'thread', 'me@x.com|t9')   // twice is one link
    tasks.getState().updateTask('11111111-0000-4000-8000-000000000001', { projectId: id })
  })
  await p.waitForTimeout(4500)
  ok('the project reached the server', db.projects.length === 1 && db.projects[0].name === 'Launch the site', JSON.stringify(db.projects.map(x => x.name)))
  ok('the milestone reached the server, under that project',
     db.project_milestones.length === 1 && db.project_milestones[0].project_id === db.projects[0]?.id && db.project_milestones[0].due_date === '2026-11-01')
  ok('linking the same thing twice is one link', db.project_links.length === 1, `${db.project_links.length}`)
  ok('every row carries the user', [...db.projects, ...db.project_milestones, ...db.project_links].every(r => r.user_id === U))
  ok('the task carries project_id on the server', db.tasks[0].project_id === db.projects[0]?.id, `${db.tasks[0].project_id}`)
  ok('and the other twelve task columns still travelled', db.tasks[0].board_status === null && Array.isArray(db.tasks[0].checklist))
  const sent = log.filter(l => l[1] === 'projects').length
  await wake()
  ok('a reload that changes nothing writes nothing back (no ping-pong)',
     log.filter(l => l[1] === 'projects').length === sent, `${log.filter(l => l[1] === 'projects').length} vs ${sent}`)
}

if (MODE === 'elsewhere') {
  ok('before reload, this device has not seen it', before.projects.length === 0 || before.projects.some(x => x.id === P2))
  await wake()
  const s = await pstate()
  ok('a project made on another device arrives', s.projects.some(x => x.id === P2 && x.name === 'Made on the iPad'), JSON.stringify(s.projects.map(x => x.name)))
  // Made here, push held back by a refusing server: it is not on the server.
  refuse = true
  await S((proj) => { proj.getState().addProject({ name: 'Only here' }) })
  await p.waitForTimeout(2500)
  await wake()
  const after = await pstate()
  ok('a project made here and not yet pushed is not read as deleted elsewhere',
     after.projects.some(x => x.name === 'Only here'), JSON.stringify(after.projects.map(x => x.name)))
  ok('and the server really does not have it (the fixture can refuse)', !db.projects.some(x => x.name === 'Only here'))
}

if (MODE === 'refused') {
  refuse = true
  const id = await S((proj) => proj.getState().addProject({ name: 'Draft plan' }))
  await p.waitForTimeout(2500)
  await S((proj, _t) => proj.getState().updateProject(proj.getState().projects[0].id, { name: 'Draft plan v2' }))
  await p.waitForTimeout(2500)
  await wake()
  const s = await pstate()
  ok('the project survives a reload while every write is refused', s.projects.length === 1, `${s.projects.length}`)
  ok('and so does the edit', s.projects[0]?.name === 'Draft plan v2', s.projects[0]?.name)
  ok('the server holds nothing (so the survival is the dirty set, not luck)', db.projects.length === 0, `${db.projects.length}`)
  void id
  refuse = false
  await p.waitForTimeout(500)
  await p.evaluate(() => window.dispatchEvent(new Event('online')))
  await p.waitForTimeout(9000)
  ok('once the server answers, it is pushed with the edit', db.projects.length === 1 && db.projects[0].name === 'Draft plan v2', JSON.stringify(db.projects.map(x => x.name)))
}

if (MODE === 'edit-wins') {
  await wake()
  ok('the server\'s project is here', (await pstate()).projects.some(x => x.id === P1 && x.name === 'Server name'))
  refuse = true
  await S((proj) => proj.getState().updateProject('aaaaaaaa-0000-4000-8000-000000000001', { name: 'My edit' }))
  await p.waitForTimeout(2500)
  await wake()
  const s = await pstate()
  ok('the edit outranks the server\'s copy after a reload', s.projects[0]?.name === 'My edit', s.projects[0]?.name)
  ok('and the server still holds the old name (so it was offered)', db.projects[0].name === 'Server name')
}

if (MODE === 'orphan-patch') {
  await wake()
  refuseTasksPost = true            // writes otherwise succeed
  await S((proj) => proj.getState().deleteProject('aaaaaaaa-0000-4000-8000-000000000001'))
  await p.waitForTimeout(4500)
  ok('the task push really was refused (so the PATCH is the only way)', log.some(l => l[0] === 'POST' && l[1] === 'tasks' && l[2] === 'refused'), JSON.stringify(log))
  ok('the server row is cleared by the direct update', db.tasks.find(t => t.id === T1)?.project_id === null, `${db.tasks.find(t => t.id === T1)?.project_id}`)
  ok('the project is gone from the server', db.projects.length === 0)
  ok('both tasks kept', db.tasks.length === 2)
}

if (MODE === 'orphan') {
  await wake()
  const s0 = await pstate()
  ok('fixture loaded: the project, its milestone and its link', s0.projects.length === 1 && s0.milestones.length === 1 && s0.links.length === 1, JSON.stringify([s0.projects.length, s0.milestones.length, s0.links.length]))
  ok('the task points at it', (await tstate()).find(t => t.id === T1)?.projectId === P1)
  // The delete push is refused for tasks/projects: only the tombstone stands between a reload and a resurrection.
  refuse = true
  await S((proj) => proj.getState().deleteProject('aaaaaaaa-0000-4000-8000-000000000001'))
  const s1 = await pstate(), t1 = await tstate()
  ok('project, milestone and link are out of the store', s1.projects.length + s1.milestones.length + s1.links.length === 0)
  ok('both tasks are KEPT', t1.length === 2, JSON.stringify(t1.map(t => t.title)))
  ok('the task no longer points at the deleted project', t1.find(t => t.id === T1)?.projectId === null, `${t1.find(t => t.id === T1)?.projectId}`)
  await p.waitForTimeout(2500)
  await wake()
  const s2 = await pstate(), t2 = await tstate()
  ok('a reload with the delete refused does not resurrect the project', s2.projects.length === 0, `${s2.projects.length}`)
  ok('nor its milestone', s2.milestones.length === 0, `${s2.milestones.length}`)
  ok('nor its link', s2.links.length === 0, `${s2.links.length}`)
  ok('the server still holds them (so the absence above is the tombstone)', db.projects.length === 1)
  ok('the kept task is still unassigned after the reload', t2.find(t => t.id === T1)?.projectId === null && t2.length === 2, JSON.stringify(t2))
  refuse = false
  await p.evaluate(() => window.dispatchEvent(new Event('online')))
  await p.waitForTimeout(9000)
  ok('once the server answers the deletes land', db.projects.length === 0 && db.project_milestones.length === 0 && db.project_links.length === 0,
     JSON.stringify([db.projects.length, db.project_milestones.length, db.project_links.length]))
  ok('and the task row on the server is cleared too', db.tasks.find(t => t.id === T1)?.project_id === null, `${db.tasks.find(t => t.id === T1)?.project_id}`)
  ok('the loose task is untouched', db.tasks.some(t => t.id === T2))
}

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
