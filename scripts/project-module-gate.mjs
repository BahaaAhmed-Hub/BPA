// node scripts/project-module-gate.mjs [on|off|lapsed]
// Needs a dev server on 5199.
//
// Projects is a module on the plan like the others. `my_modules` is stubbed:
//   on      Projects included — the tab is drawn, the tables are read, the task panel
//           offers the project (the control that makes the absences below mean something)
//   warm-off  same, but this device's cached answer still says on (the plan changed since)
//   off     Projects not included — no tab, NO read of the three project tables while
//           tasks ARE read, the copy this device kept from when it was on is not drawn
//           anywhere (task panel, lens), and a laptop reopened on Projects lands elsewhere
//   lapsed  on at boot, then the plan loses it while the app is open: the next sync
//           does not read the tables
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'on'
const OFF = MODE === 'off' || MODE === 'warm-off'
const P = 'aaaaaaaa-0000-4000-8000-00000000000a'
const now = new Date().toISOString()
const project = { id: P, user_id: U, name: 'Alpha', kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null, target_date: null, notes: null, archived: false, created_at: now, updated_at: now }
const task = (n, title, o = {}) => ({
  id: `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, user_id: U, company_id: null, title, description: null, quadrant: 'important_not_urgent',
  effort_minutes: null, due_date: null, status: 'todo', delegated_to: null, done_looks_like: null, created_at: now, completed_at: null, planned_time: null,
  owner_id: null, company_tag: null, completed: false, task_type: null, priority: null, board_status: null, calendar_id: null, gcal_event_id: null,
  parent_task_id: null, captured_via: null, urgent: false, checklist: [], attachments: [], links: [], project_id: null, milestone_id: null, ...o,
})
const db = { tasks: [task(1, 'Alpha task one', { project_id: P }), task(2, 'Loose task two')], projects: [project], project_milestones: [], project_links: [] }
const reads = {}
let withProjects = !OFF
const modules = () => [
  { module_id: 'dashboard', label: 'Dashboard', enabled: true }, { module_id: 'tasks', label: 'Tasks', enabled: true },
  { module_id: 'calendar', label: 'Calendar', enabled: true }, { module_id: 'projects', label: 'Projects', enabled: withProjects },
]
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 }, timezoneId: 'UTC', locale: 'en-GB' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/rpc/my_modules')) return j(modules())
  const table = Object.keys(db).find(t => u.pathname.endsWith('/' + t))
  if (!table) return j([])
  const m = q.method()
  if (m === 'GET') { reads[table] = (reads[table] ?? 0) + 1; if (!withProjects && !process.env.NO_RLS && /^project/.test(table)) return j([])   // row-level security refuses
    return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table]) }
  if (m === 'POST') { const body = JSON.parse(q.postData() || '[]'); for (const rw of Array.isArray(body) ? body : [body]) { const i = db[table].findIndex(x => x.id === rw.id); if (i >= 0) db[table][i] = { ...db[table][i], ...rw }; else db[table].push(rw) } return j([]) }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.addInitScript(([s, start, proj, uid, warm]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'list')
  // What this device kept from when Projects was on: a project, and a lens on it.
  localStorage.setItem('professor-projects', JSON.stringify({ state: { projects: [proj], milestones: [], links: [] }, version: 0 }))
  localStorage.setItem('professor-project-focus', proj.id)
  // The cached answer for this user is the previous plan — Projects on — as a device that has been used would hold.
  if (warm) localStorage.setItem('professor-modules', JSON.stringify({ uid, at: Date.now() - 3600e3, modules: { dashboard: true, tasks: true, calendar: true, projects: true }, labels: { projects: 'Projects' } }))
} catch {} }, [session, OFF ? 'projects' : 'tasks', project, U, MODE !== 'off'])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const navHas = name => p.locator(`[data-side-rail] button[aria-label="${name}"]`).count()
const projReads = () => (reads.projects ?? 0) + (reads.project_milestones ?? 0) + (reads.project_links ?? 0)
await p.locator('[data-side-rail] button[aria-label="Tasks"]').waitFor({ state: 'visible', timeout: 10000 })
ok('Tasks is on the plan and was read (the positive control)', await navHas('Tasks') === 1 && (reads.tasks ?? 0) > 0, JSON.stringify(reads))

if (MODE === 'on') {
  ok('the Projects tab is drawn', await navHas('Projects') === 1)
  ok('and its tables were read', projReads() >= 3, JSON.stringify(reads))
  await p.locator('[data-side-rail] button[aria-label="Tasks"]').click()
  await p.locator('[data-task-node]', { hasText: 'Alpha task one' }).first().waitFor({ state: 'visible', timeout: 8000 })
  await p.locator('[data-task-node]', { hasText: 'Alpha task one' }).first().click()
  ok('the task panel offers the project', await p.getByLabel('Project', { exact: true }).count() === 1)
}
if (OFF) {
  ok('no Projects tab', await navHas('Projects') === 0)
  if (MODE === 'off') ok('cold boot: NONE of the three project tables was read', projReads() === 0, JSON.stringify(reads))
  else ok('warm boot (the cache still said on): at most the one read made before the answer landed', projReads() <= 3, JSON.stringify(reads))
  const landed = await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ui')).state.activeModule)
  ok('a laptop reopened on Projects lands on a module that is on', await p.locator('[data-side-rail] button[aria-current="page"]').getAttribute('aria-label') !== 'Projects', landed)
  await p.locator('[data-side-rail] button[aria-label="Tasks"]').click()
  await p.locator('[data-task-node]', { hasText: 'Alpha task one' }).first().waitFor({ state: 'visible', timeout: 8000 })
  const dim = await p.locator('[data-task-node]', { hasText: 'Loose task two' }).first().evaluate(e => { let o = 1; for (let n = e; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o })
  ok('a lens kept from when it was on dims nothing, and draws no chip', dim === 1 && await p.locator('[data-project-lens]').count() === 0, String(dim))
  await p.locator('[data-task-node]', { hasText: 'Alpha task one' }).first().click()
  await p.waitForTimeout(600)
  ok('the task panel is open', await p.getByRole('button', { name: /Close/i }).count() > 0 || await p.locator('[data-task-node]').count() > 1)
  ok('and offers no project — the kept copy is not drawn', await p.getByLabel('Project', { exact: true }).count() === 0)
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('professor-projects') || '{"state":{}}').state?.projects?.length ?? 0)
  ok('the kept copy was emptied, not just hidden', kept === 0, String(kept))
  ok('and the task still exists with its pointer (nothing was deleted)', db.tasks.find(t => t.id.endsWith('01')).project_id === P)
}
if (MODE === 'lapsed') {
  ok('on at boot: the Projects tab is drawn', await navHas('Projects') === 1)
  const before = projReads()
  withProjects = false
  await p.evaluate(async () => { const m = await import('/BPA/src/lib/entitlements.ts'); return m.fetchModules(JSON.parse(localStorage.getItem('sb-placeholder-auth-token')).user.id) })
  await p.waitForTimeout(600)
  ok('the plan changed under the open app: the tab goes', await navHas('Projects') === 0)
  // A sync wake (focus / online) is what would read the tables again.
  await p.evaluate(() => { window.dispatchEvent(new Event('online')) })
  await p.waitForTimeout(3500)
  ok('and the next sync does not read the project tables', projReads() === before, `${before} -> ${projReads()}`)
  ok('while tasks still sync (the control)', (reads.tasks ?? 0) >= 2, JSON.stringify(reads))
}
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close(); process.exit(fails ? 1 : 0)
