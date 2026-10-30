// node scripts/project-sync-gap.mjs [ok|tables|columns|error|recovers]
// Needs a dev server on 5199.
//
// Projects had no voice when the database could not hold them: a missing table, a
// refused write and a missing column all vanished into console.warn, and the other
// device simply never saw the project. The banner says it now.
//
//   ok        healthy server — no banner, and the writes landed (the control for the rest)
//   tables    the three tables do not exist (42P01): the banner names 20260042, and the
//             project is still kept on this device
//   columns   project_links.meta is refused: other rows still save, the banner names 20260043
//   error     a write is refused with a 500: the banner carries the server's words
//   recovers  the tables appear after a failed push: the next push lands and the banner goes
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'ok'
const now = new Date().toISOString()
const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
let tablesExist = MODE !== 'tables' && MODE !== 'recovers'
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const writes = { projects: 0, project_links: 0 }
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
  if (/^project/.test(table) && !tablesExist) return j({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404)
  if (m === 'GET') return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table])
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    if (MODE === 'error' && table === 'projects') return j({ code: 'XX000', message: 'disk is on fire' }, 500)
    if (MODE === 'columns' && table === 'project_links' && rows.some(r => 'meta' in r)) return j({ code: 'PGRST204', message: "Could not find the 'meta' column of 'project_links' in the schema cache" }, 400)
    if (table in writes) writes[table]++
    for (const rw of rows) { const i = db[table].findIndex(x => x.id === rw.id); if (i >= 0) db[table][i] = { ...db[table][i], ...rw }; else db[table].push(rw) }
    return j([])
  }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'projects', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)
const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const PROJ = await urlOf('projectStore')
ok('found the app\'s own project store', !!PROJ)
const banner = () => p.locator('[data-projects-gap]')
const act = fn => p.evaluate(async ([src, url]) => (new Function('s', `return (${src})(s)`))((await import(url)).useProjectStore), [fn.toString(), PROJ])
await p.waitForTimeout(1500)
if (MODE === 'tables') ok('loading alone already says so — the read found no tables', await banner().count() === 1 && await banner().getAttribute('data-projects-gap') === 'tables')
// Make a project and a link, as the page would.
const ids = await act(s => { const id = s.getState().addProject({ name: 'Alpha', kind: 'work', status: 'active', color: '#2F63A8' }); s.getState().addLink(id, 'event', 'evt-1', { title: 'T', start: '2026-01-01T10:00:00Z', allDay: false }); return id })
await p.waitForTimeout(3200)
const gap = await banner().count() ? await banner().getAttribute('data-projects-gap') : null
const text = await banner().count() ? await banner().innerText() : ''
const local = await act(s => s.getState().projects.map(x => x.name))
if (MODE === 'ok') {
  ok('no banner when the server is healthy', gap === null)
  ok('and the project and its link reached the server', db.projects.length === 1 && db.project_links.length === 1, JSON.stringify(writes))
}
if (MODE === 'tables') {
  ok('the banner says the tables are missing and names 20260042', gap === 'tables' && /20260042_projects\.sql/.test(text) && /only on this device/.test(text), text.slice(0, 160))
  ok('the project is still here — kept on this device, not thrown away', local.length === 1 && local[0] === 'Alpha')
  ok('and nothing reached the server', db.projects.length === 0)
}
if (MODE === 'columns') {
  ok('the banner names the metadata migration', gap === 'columns' && /20260043_project_link_meta\.sql/.test(text), text.slice(0, 200))
  ok('the project and the link still saved — only the snapshot is left out', db.projects.length === 1 && db.project_links.length === 1 && !('meta' in db.project_links[0] && db.project_links[0].meta), JSON.stringify(db.project_links))
}
if (MODE === 'error') {
  ok('the banner carries the server\'s words', gap === 'error' && /disk is on fire/.test(text), text.slice(0, 160))
  ok('the project is still local, to be retried', local.length === 1)
}
if (MODE === 'recovers') {
  ok('first the banner says tables', gap === 'tables')
  tablesExist = true
  await act(s => { s.getState().updateProject(s.getState().projects[0].id, { notes: 'poke' }) })
  await p.waitForTimeout(3200)
  ok('the migration runs; the next push lands and the banner clears', await banner().count() === 0 && db.projects.length === 1, JSON.stringify({ gap: await banner().count(), rows: db.projects.length }))
}
void ids
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close(); process.exit(fails ? 1 : 0)
