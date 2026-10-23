// node scripts/project-lens.mjs [tasks|calendar|mail|rail|dots]
// Needs a dev server on 5199.
//
// Chunk 9 of Projects: the project lens, beside the company one. With a project in
// focus, every task, calendar event and mail thread that is not that project's goes
// quiet — dimmed, never hidden — on whatever screen is open. Measured as the card's
// DRAWN opacity (its own and its ancestors'), never as a class name.
//
//   tasks     a task answers from its own projectId
//   calendar  an event answers from the project's event links, and so does the
//             calendar block of one of its tasks
//   mail      a thread answers from the project's thread links (mailbox|thread)
//   dots      each calendar card wears the colour of its project (a link, or its task's) and says its name
//   rail      the Focus button sets it, the rail chip shows it and clears it,
//             it survives a reload, and a project that is deleted takes it with it
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id, ME = 'me@x.com'
const MODE = process.argv[2] ?? 'tasks'
const P_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const P_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const now = new Date().toISOString()
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
const TODAY = day(0)
const iso = (d, hm) => `${d}T${hm}:00Z`
const project = (id, name, o = {}) => ({ id, user_id: U, name, kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null, target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o })
const task = (n, title, o = {}) => ({
  id: `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, user_id: U, company_id: null, title, description: null, quadrant: 'important_not_urgent',
  effort_minutes: null, due_date: null, status: 'todo', delegated_to: null, done_looks_like: null, created_at: now, completed_at: null, planned_time: null,
  owner_id: null, company_tag: null, completed: false, task_type: null, priority: null, board_status: null, calendar_id: null, gcal_event_id: null,
  parent_task_id: null, captured_via: null, urgent: false, checklist: [], attachments: [], links: [], project_id: null, milestone_id: null, ...o,
})
const link = (n, pid, kind, ref) => ({ id: `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, project_id: pid, user_id: U, kind, ref_id: ref, meta: null, created_at: now })
const gEv = (id, summary, hm) => ({ id, summary, start: { dateTime: iso(TODAY, hm) }, end: { dateTime: iso(TODAY, hm.replace(/^(\d\d)/, h => String(+h + 1).padStart(2, '0'))) }, status: 'confirmed', calendarId: 'primary', organizer: { email: 'a@x.com' } })
const gEvents = [gEv('e-a', 'Alpha kickoff', '09:00'), gEv('e-b', 'Beta standup', '11:00'), gEv('e-none', 'Gamma lunch', '13:00'), gEv('e-block', 'Alpha task block', '15:00')]
const at = i => new Date(Date.now() - (i + 1) * 864e5 / 6).toISOString()
const mrow = (id, subject, i) => ({ user_id: U, account_email: ME, thread_id: id, last_message_id: `m-${id}`, last_at: at(i), subject, from_name: 'Sender', from_email: `s${i}@x.com`, section: 'action', reply_state: 'none', need: 'They are waiting.', draft: null, direct: true, addressed_to: 'to', named_in_body: true, bottleneck: false, awaiting_customer: false, kind: 'reply', muted: false, archived_at: null, acknowledged_at: null, handled_at: null, analyzed_at: now })
const stored = [mrow('ta', 'Alpha copy review', 0), mrow('tb', 'Beta tiles quote', 1), mrow('tn', 'Gamma lunch plans', 2)]

const db = { tasks: [], projects: [project(P_A, 'Alpha'), project(P_B, 'Beta', { kind: 'personal', color: '#1D8A6A' })], project_milestones: [], project_links: [] }
if (MODE === 'tasks' || MODE === 'rail') db.tasks = [task(1, 'Alpha task one', { project_id: P_A }), task(2, 'Beta task two', { project_id: P_B }), task(3, 'Loose task three')]
if (MODE === 'calendar' || MODE === 'dots') {
  db.tasks = [task(4, 'Alpha block task', { project_id: P_A, gcal_event_id: 'e-block', due_date: TODAY, planned_time: '15:00', effort_minutes: 60 })]
  db.project_links = [link(1, P_A, 'event', 'e-a'), link(2, P_B, 'event', 'e-b')]
}
if (MODE === 'mail') db.project_links = [link(1, P_A, 'thread', `${ME}|ta`), link(2, P_B, 'thread', `${ME}|tb`)]

const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1100 }, timezoneId: 'UTC', locale: 'en-GB' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/mail_smart_threads')) return q.method() === 'GET' && MODE === 'mail' ? j(stored) : j([])
  if (u.pathname.endsWith('/users')) return j([{ id: U, email: ME, full_name: 'A' }])
  const table = Object.keys(db).find(t => u.pathname.endsWith('/' + t))
  if (!table) return j([])
  const m = q.method()
  if (m === 'GET') return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table])
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const rw of rows) { const i = db[table].findIndex(x => x.id === rw.id); if (i >= 0) db[table][i] = { ...db[table][i], ...rw }; else db[table].push(rw) }
    return j([])
  }
  if (m === 'PATCH') return j([])
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.route('**://gmail.googleapis.com/**', r => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  const u = new URL(r.request().url())
  if (/\/threads\/[^/]+$/.test(u.pathname)) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ id: u.pathname.split('/').pop(), messages: [] }) })
  return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(u.pathname.includes('/threads') ? { threads: [] } : {}) })
})
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = q.url()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (q.method() !== 'GET') return r.fulfill({ headers: cors, json: {} })
  if (/calendarList/.test(u)) return r.fulfill({ headers: cors, json: { items: [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner' }] } })
  if (/\/calendars\/[^/]+\/events/.test(u)) return r.fulfill({ headers: cors, json: { items: gEvents } })
  return r.fulfill({ headers: cors, json: { items: [] } })
})
const START = { tasks: 'tasks', calendar: 'calendar', dots: 'calendar', mail: 'inbox', rail: 'projects' }[MODE]
const CALS = [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner', accountEmail: 'a@x.com' }]
await ctx.addInitScript(([s, start, cals, lens]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'list'); localStorage.setItem('mail-mode', 'smart'); localStorage.setItem('mail-smart-view', 'action')
  localStorage.setItem('google_provider_token', 'tok'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cals)); localStorage.setItem('cal-view', 'week')
  if (lens && !sessionStorage.getItem('lens-seeded')) { localStorage.setItem('professor-project-focus', lens); sessionStorage.setItem('lens-seeded', '1') }
} catch {} }, [session, START, CALS, MODE === 'rail' || MODE === 'dots' ? null : P_A])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
// What is DRAWN: the element's opacity times every ancestor's, and whether it still has a box.
const drawn = (sel, text) => p.locator(sel, { hasText: text }).first().evaluate(el => {
  let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
  const r = el.getBoundingClientRect(); return { opacity: +o.toFixed(3), box: r.width > 0 && r.height > 0 }
})
const quiet = async (sel, text) => { const d = await drawn(sel, text); return d.opacity < 0.5 && d.box }
const full = async (sel, text) => (await drawn(sel, text)).opacity === 1
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const PROJ = await urlOf('projectStore')
ok('found the app\'s own project store', !!PROJ)
const setLens = id => p.evaluate(v => { if (v) localStorage.setItem('professor-project-focus', v); else localStorage.removeItem('professor-project-focus'); window.dispatchEvent(new Event('professor:projectFocusChanged')) }, id)

if (MODE === 'tasks') {
  const C = '[data-task-node]'
  for (const t of ['Alpha task one', 'Beta task two', 'Loose task three']) await p.locator(C, { hasText: t }).first().waitFor({ state: 'visible', timeout: 10000 })
  ok('the lens is on (the harness seeded Alpha)', await p.evaluate(() => localStorage.getItem('professor-project-focus')) === P_A)
  ok('the project\'s own task is untouched', await full(C, 'Alpha task one'))
  if (process.env.DBG) console.log(JSON.stringify(await drawn(C, 'Beta task two')), await p.locator(C, { hasText: 'Beta task two' }).first().evaluate(e => e.className))
  ok('another project\'s task is quiet — and still has a box', await quiet(C, 'Beta task two'))
  ok('a task in no project is quiet too', await quiet(C, 'Loose task three'))
  await setLens(P_B); await p.waitForTimeout(400)
  ok('another lens swaps which one is quiet', await full(C, 'Beta task two') && await quiet(C, 'Alpha task one'))
  await setLens(null); await p.waitForTimeout(400)
  ok('clearing it puts everything back', await full(C, 'Alpha task one') && await full(C, 'Beta task two') && await full(C, 'Loose task three'))
}
if (MODE === 'calendar') {
  const C = '.event-card'
  for (const t of ['Alpha kickoff', 'Beta standup', 'Gamma lunch', 'Alpha task block']) await p.locator(C, { hasText: t }).first().waitFor({ state: 'visible', timeout: 12000 })
  ok('the lens is on', await p.evaluate(() => localStorage.getItem('professor-project-focus')) === P_A)
  ok('an event linked to the project is untouched', await full(C, 'Alpha kickoff'))
  ok('the calendar block of one of its tasks is untouched', await full(C, 'Alpha task block'))
  ok('an event linked to another project is quiet', await quiet(C, 'Beta standup'))
  ok('an event linked to nothing is quiet', await quiet(C, 'Gamma lunch'))
  await setLens(null); await p.waitForTimeout(400)
  ok('clearing it puts all four back', (await Promise.all(['Alpha kickoff', 'Beta standup', 'Gamma lunch', 'Alpha task block'].map(t => full(C, t)))).every(Boolean))
}
if (MODE === 'dots') {
  const C = '.event-card'
  for (const t of ['Alpha kickoff', 'Beta standup', 'Gamma lunch', 'Alpha task block']) await p.locator(C, { hasText: t }).first().waitFor({ state: 'visible', timeout: 12000 })
  const dot = t => p.locator(C, { hasText: t }).first().evaluate(card => {
    const d = card.querySelector('[data-event-project-dot]'); if (!d) return null
    const r = d.getBoundingClientRect(), c = card.getBoundingClientRect()
    return { bg: getComputedStyle(d).backgroundColor, label: d.getAttribute('aria-label'), inside: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom, w: r.width }
  })
  const a = await dot('Alpha kickoff'), bb = await dot('Beta standup'), n = await dot('Gamma lunch'), blk = await dot('Alpha task block')
  ok('an event linked to a project wears its colour and name', a?.bg === 'rgb(47, 99, 168)' && a.label === 'Project: Alpha', JSON.stringify(a))
  ok('another project\'s event wears that one\'s', bb?.bg === 'rgb(29, 138, 106)' && bb.label === 'Project: Beta', JSON.stringify(bb))
  ok('an event in no project wears none', n === null)
  ok('a task\'s calendar block wears its task\'s project', blk?.bg === 'rgb(47, 99, 168)', JSON.stringify(blk))
  ok('the dot sits inside its card and is a real dot', a?.inside && a.w === 9, JSON.stringify(a))
  ok('exactly three dots on the grid — not one per card', await p.locator('[data-event-project-dot]').count() === 3)
}
if (MODE === 'mail') {
  const C = 'div'
  const row = t => p.getByText(t, { exact: false }).first()
  for (const t of ['Alpha copy review', 'Beta tiles quote', 'Gamma lunch plans']) await row(t).waitFor({ state: 'visible', timeout: 12000 })
  const drawnText = t => row(t).evaluate(el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); const r = el.getBoundingClientRect(); return { opacity: +o.toFixed(3), box: r.width > 0 && r.height > 0 } })
  ok('the lens is on', await p.evaluate(() => localStorage.getItem('professor-project-focus')) === P_A)
  const a = await drawnText('Alpha copy review'), bb = await drawnText('Beta tiles quote'), n = await drawnText('Gamma lunch plans')
  ok('a thread filed under the project is untouched', a.opacity === 1, JSON.stringify(a))
  ok('a thread filed under another project is quiet, with a box', bb.opacity < 0.5 && bb.box, JSON.stringify(bb))
  ok('an unfiled thread is quiet', n.opacity < 0.5 && n.box, JSON.stringify(n))
  await setLens(null); await p.waitForTimeout(400)
  ok('clearing it puts all three back', (await Promise.all(['Alpha copy review', 'Beta tiles quote', 'Gamma lunch plans'].map(drawnText))).every(d => d.opacity === 1))
  void C
}
if (MODE === 'rail') {
  const rail = '[data-side-rail]'
  const goto = name => p.locator(`${rail} button[aria-label="${name}"]`).click()
  await p.locator('[data-project-card]', { hasText: 'Alpha' }).first().waitFor({ state: 'visible', timeout: 10000 })
  ok('with no lens there is no chip', await p.locator('[data-project-lens]').count() === 0)
  await p.locator('[data-project-card]', { hasText: 'Alpha' }).first().click()
  const btn = p.locator('[data-project-focus]')
  await btn.waitFor({ state: 'visible' })
  ok('the page offers Focus, unpressed', (await btn.getAttribute('aria-pressed')) === 'false' && /Focus/.test(await btn.innerText()))
  await btn.click()
  ok('pressing it says Focused', (await btn.getAttribute('aria-pressed')) === 'true' && /Focused/.test(await btn.innerText()))
  await p.locator('[data-project-lens]').waitFor({ state: 'visible', timeout: 3000 })
  const chip = p.locator('[data-project-lens] button')
  ok('the rail draws a chip that names the project', /Alpha/.test(await chip.getAttribute('aria-label')))
  ok('and rings it in the project\'s colour', /rgb\(47, 99, 168\)/.test(await chip.evaluate(e => getComputedStyle(e).boxShadow)))
  await goto('Tasks')
  const C = '[data-task-node]'
  await p.locator(C, { hasText: 'Beta task two' }).first().waitFor({ state: 'visible', timeout: 8000 })
  if (process.env.DBG) console.log(JSON.stringify([await drawn(C, 'Beta task two'), await drawn(C, 'Alpha task one')]))
  ok('in Tasks the other project\'s task is quiet and this one is not', await quiet(C, 'Beta task two') && await full(C, 'Alpha task one'))
  ok('the chip is on that screen too — the way out is always drawn', await p.locator('[data-project-lens]').count() === 1)
  await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
  await goto('Tasks')
  await p.locator(C, { hasText: 'Beta task two' }).first().waitFor({ state: 'visible', timeout: 10000 })
  ok('it survives a reload', await quiet(C, 'Beta task two') && await p.locator('[data-project-lens]').count() === 1)
  await p.locator('[data-project-lens] button').click(); await p.waitForTimeout(400)
  ok('pressing the chip clears it: everything back, chip gone', await full(C, 'Beta task two') && await p.locator('[data-project-lens]').count() === 0)
  // A project that is deleted while it is the lens takes the lens with it.
  await setLens(P_B); await p.waitForTimeout(400)
  ok('Beta in focus dims Alpha\'s task', await quiet(C, 'Alpha task one'))
  await p.evaluate(async url => (await import(url)).useProjectStore.getState().deleteProject('aaaaaaaa-0000-4000-8000-00000000000b'), PROJ)
  await p.waitForTimeout(600)
  ok('deleting the focused project clears the lens', await p.evaluate(() => localStorage.getItem('professor-project-focus')) === null && await p.locator('[data-project-lens]').count() === 0)
  ok('and nothing is left dimmed with no way out', await full(C, 'Alpha task one') && await full(C, 'Loose task three'))
}
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
