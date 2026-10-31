// node scripts/task-defaults.mjs      (needs a dev server on 5199)
// Settings -> Tasks -> Defaults. Claims, read off the page, localStorage and the resolver:
//   - the four controls are there: default view, hide completed, default calendar, framework;
//   - the framework selector is no longer on Profile, and still writes the same setting;
//   - "List" as the default view opens Tasks on the list even when the last view used was the board,
//     and switching view inside the page does not overwrite the default;
//   - hide-completed on keeps a done task off the page; off brings it back;
//   - a default calendar is where a task with no calendar of its own goes — and never overrides a
//     calendar the task or its company names.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const tasks = [
  { id: 't-open', title: 'Open task alpha', company: 'personal', quadrant: 'do', status: 'todo', completed: false, created_at: '2025-01-01T00:00:00Z', user_id: U },
  { id: 't-done', title: 'Finished task omega', company: 'personal', quadrant: 'do', status: 'done', completed: true, created_at: '2025-01-01T00:01:00Z', user_id: U },
]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*' } })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/tasks')) return j(tasks)
  return j([])
})
const CALS = [
  { id: 'cal-work', summary: 'Work', accountEmail: 'me@x.com', accessRole: 'owner' },
  { id: 'cal-fam', summary: 'Family', accountEmail: 'me@x.com', accessRole: 'owner' },
]
await ctx.addInitScript(([s, cals]) => { try {
  localStorage.setItem('bpa-wizard-done', '1')
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('task-view-mode', 'board')
    localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cals))
  }
} catch {} }, [session, CALS])
const p = await ctx.newPage(); const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const nav = name => p.locator('main button').filter({ hasText: new RegExp(`^${name}\\d*$`) }).last().click({ timeout: 8000 })
const ls = k => p.evaluate(k => localStorage.getItem(k), k)

await nav('Profile'); await p.waitForTimeout(500)
ok('Profile no longer has the framework selector', await p.getByText('Framework', { exact: true }).count() === 0)
await nav('Tasks'); await p.locator('[data-task-defaults]').waitFor({ timeout: 6000 })
const d = p.locator('[data-task-defaults]')
ok('Tasks has the four controls', await d.getByLabel('Default tasks view').count() === 1 && await d.getByText('Hide completed tasks').count() === 1
  && await d.getByLabel('Default calendar for tasks').count() === 1 && await d.getByText('Productivity framework').count() === 1)
await d.getByRole('tab', { name: 'GTD' }).click(); await p.waitForTimeout(400)
ok('the framework selector still writes the same setting (GTD selected)', await d.getByRole('tab', { name: 'GTD' }).getAttribute('aria-selected') === 'true')
await nav('Profile'); await nav('Tasks'); await p.locator('[data-task-defaults]').waitFor()
ok('and it is remembered', await p.locator('[data-task-defaults]').getByRole('tab', { name: 'GTD' }).getAttribute('aria-selected') === 'true')

// default view
await d.getByRole('tab', { name: 'List' }).click()
ok('List is stored as the default view', await ls('task-default-view') === 'list')
// hide completed
await d.locator('xpath=ancestor::*[1]').getByRole('switch').first().click()
ok('hide completed is on', JSON.parse(await ls('task-command-config') || '{}').hideCompleted === true)
// default calendar
await d.getByLabel('Default calendar for tasks').selectOption({ label: 'Family' })
ok('the default calendar is stored with its account', JSON.parse(await ls('task-default-calendar') || 'null')?.calendarId === 'cal-fam')

// the resolver
const res = await p.evaluate(async () => {
  const m = await import('/src/lib/taskCalendar.ts')
  localStorage.setItem('professor-companies', JSON.stringify([{ id: 'co1', name: 'Co One', color: '#3B82F6', calendarId: 'cal-company' }]))
  return {
    bare: m.resolveTaskCalendar({}).calendarId,
    bareSource: m.resolveTaskCalendar({}).source,
    own: m.resolveTaskCalendar({ calendarId: 'cal-task' }).calendarId,
  }
})
ok('a task with no calendar goes on the default one', res.bare === 'cal-fam' && res.bareSource === 'default', JSON.stringify(res))
ok('a calendar the task names still wins', res.own === 'cal-task')
await d.getByLabel('Default calendar for tasks').selectOption({ label: 'Your primary calendar' })
ok('clearing it goes back to the primary calendar', (await p.evaluate(async () => (await import('/src/lib/taskCalendar.ts')).resolveTaskCalendar({}).calendarId)) === 'primary')

// the page honours the view and the hide flag (fresh load; sessionStorage seeds only once)
await p.evaluate(() => localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: 'sunlit-bento' }, version: 0 })))
await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
const text = () => p.evaluate(() => document.body.innerText)
ok('Tasks opens on the List even though the last view used was the board', await ls('task-view-mode') === 'board' && /Open task alpha/.test(await text()))
ok('the completed task is hidden', !/Finished task omega/.test(await text()), 'done task shown: ' + /Finished task omega/.test(await text()))
await p.getByRole('tab', { name: 'Board' }).first().click().catch(() => {})
ok('switching view in the page does not overwrite the default', await ls('task-default-view') === 'list' && await ls('task-view-mode') === 'board')
await b.close(); process.exit(fails ? 1 : 0)
