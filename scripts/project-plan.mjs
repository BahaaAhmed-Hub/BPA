// node scripts/project-plan.mjs [templates|ai|messy|fail|nokey|schedule]
// Needs a dev server on 5199.
//
// Chunk 8 of Projects: a plan from a template or from words, and dates for the
// tasks that have none — always as a DRAFT you review. The Anthropic API is a stub
// that records every request and can answer well, badly or not at all, because
// what matters here is mostly what is NOT done: nothing is written until Add, no
// request is made until asked, and a bad answer neither writes nor invents.
//
//   templates  a template drafts with real dates (stretched to the target), nothing
//              exists until Add, only what is ticked is written, one undo takes it all
//   ai         one request, carrying the brief and the dates; the answer is a draft
//   messy      a hostile answer — blanks, duplicates, impossible dates, 30 tasks,
//              phases that do not exist, a 300-character title — is made safe
//   fail       a 500, prose, and an empty answer each say so and write nothing
//   nokey      no key: the AI is not offered, templates still work, no request
//   schedule   dates proposed for undated open tasks: only valid ones survive,
//              the request names only the open undated tasks, undo restores them
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'templates'
const P = 'aaaaaaaa-0000-4000-8000-00000000000a'
const now = new Date().toISOString()
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
const TODAY = day(0), TARGET = day(30)
const tid = n => `11111111-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const task = (n, title, o = {}) => ({
  id: tid(n), user_id: U, company_id: null, title, description: null, quadrant: 'urgent_important',
  effort_minutes: null, due_date: null, status: 'todo', delegated_to: null, done_looks_like: null, created_at: now,
  completed_at: null, planned_time: null, owner_id: null, company_tag: null, completed: false, task_type: null,
  priority: null, board_status: null, calendar_id: null, gcal_event_id: null, parent_task_id: null, captured_via: null,
  urgent: false, checklist: [], attachments: [], links: [], project_id: P, milestone_id: null, ...o,
})
const db = { tasks: [], projects: [{ id: P, user_id: U, name: 'Kitchen renovation', kind: 'personal', color: '#1D8A6A', status: 'active', company_id: null, start_date: null, target_date: TARGET, notes: null, archived: false, created_at: now, updated_at: now }], project_milestones: [], project_links: [] }
if (MODE === 'schedule') db.tasks = [
  task(1, 'Choose the tiles', { priority: 'P1' }), task(2, 'Order the cabinets'), task(3, 'Book the plumber', { priority: 'P2' }), task(4, 'Pick a paint colour'),
  task(5, 'Already dated', { due_date: day(9), quadrant: 'important_not_urgent' }), task(6, 'Finished one', { completed: true, status: 'done', completed_at: now }),
]
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const writes = { project_milestones: 0, tasks: 0 }
const aiReqs = []
let aiReply = () => ({ status: 200, text: '{}' })

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1100 }, timezoneId: 'UTC', locale: 'en-GB' })
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
  if (table in writes) writes[table]++
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const rw of rows) { const i = db[table].findIndex(x => x.id === rw.id); if (i >= 0) db[table][i] = { ...db[table][i], ...rw }; else db[table].push(rw) }
    return j([])
  }
  if (m === 'PATCH') return j([])
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.route('**://api.anthropic.com/**', r => {
  const q = r.request()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  let body = {}; try { body = JSON.parse(q.postData() || '{}') } catch { /* not json */ }
  // A dated task is put on the calendar by its own AI scheduler — not the planner's request.
  if (process.env.DBG) console.log('  [ai req]', String(body.system ?? '').slice(0, 70)); if (!/^You (draft|spread)/.test(String(body.system ?? ''))) { /* the calendar scheduler and the assistant ask the model too */ } else aiReqs.push({ system: String(body.system ?? ''), user: String(body.messages?.[0]?.content ?? '') })
  // The calendar scheduler is not under test: it gets no answer, so it cannot move a task.
  const planner = /^You (draft|spread)/.test(String(body.system ?? ''))
  const { status, text } = planner ? aiReply(aiReqs.length) : { status: 500, text: '' }
  if (status !== 200) return r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'overloaded' } }) })
  return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ id: 'm1', type: 'message', role: 'assistant', model: 'claude-x', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }) })
})
await ctx.addInitScript(([s, withKey]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'projects', themeId: 'sunlit-bento' }, version: 0 }))
  if (withKey) localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test-key-0123456789', groqKey: '', groqModel: 'x' }))
} catch {} }, [session, MODE !== 'nokey'])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore'), tasks: await urlOf('taskStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore, tasks = (await import(urls.tasks)).useTaskStore
  return await (new Function('proj', 'tasks', `return (${src})(proj, tasks)`))(proj, tasks)
}, [fn.toString(), URLS])
const msNow = () => S(proj => proj.getState().milestones.filter(m => m.projectId === 'aaaaaaaa-0000-4000-8000-00000000000a'))
const tsNow = () => S((_p, t) => t.getState().tasks.filter(x => x.projectId === 'aaaaaaaa-0000-4000-8000-00000000000a').map(x => ({ id: x.id, title: x.title, milestoneId: x.milestoneId ?? null, dueDate: x.dueDate ?? null, quadrant: x.quadrant ?? null, priority: x.priority ?? null, company: x.company })))
ok('found the app\'s own stores', !!URLS.proj && !!URLS.tasks)

await p.locator(`[data-project-card="${P}"]`).waitFor({ state: 'visible', timeout: 10000 })
await p.locator(`[data-project-card="${P}"]`).click()
await p.locator(`[data-project-page="${P}"]`).waitFor({ state: 'visible' })
const dlg = p.locator('[data-project-planner]')
const openPlanner = async () => { await p.getByRole('button', { name: /^Plan$|Plan$/ }).first().click(); await dlg.waitFor({ state: 'visible' }) }
const rowsOf = sel => p.locator(sel).count()
const addBtn = () => dlg.getByRole('button', { name: /^Add \d+ milestone/ })

if (MODE === 'templates') {
  ok('an empty project says so and offers to plan it', await p.locator('[data-project-plan-prompt]').count() === 1)
  await p.locator('[data-project-plan-prompt]').getByRole('button', { name: /Plan this project/ }).click()
  await dlg.waitFor({ state: 'visible' })
  const order = await dlg.locator('[data-template]').evaluateAll(els => els.map(e => e.getAttribute('data-template')))
  ok('a personal project is offered personal templates before the work one', order.indexOf('launch') === order.length - 1 && order.length === 5, JSON.stringify(order))
  const w0 = { ...writes }
  await dlg.locator('[data-template="renovation"]').click()
  ok('a template drafts 4 milestones and 8 tasks', await rowsOf('[data-draft-milestone]') === 4 && await rowsOf('[data-draft-task]') === 8)
  ok('and NOTHING exists yet — not in the store, not on the server', (await msNow()).length === 0 && (await tsNow()).length === 0 && writes.project_milestones === w0.project_milestones && writes.tasks === w0.tasks, JSON.stringify(writes))
  ok('no request was made to the AI', aiReqs.length === 0)
  const last = await dlg.getByLabel('Date for milestone 4', { exact: true }).inputValue()
  const first = await dlg.getByLabel('Date for milestone 1', { exact: true }).inputValue()
  ok('with a target date the plan is stretched to it: the last milestone IS the target', last === TARGET, `${last} vs ${TARGET}`)
  ok('and the first is soon, after today', first > TODAY && first < last, `${first}`)
  ok('a task is dated before its phase, not on or after it', await dlg.getByLabel('Date for task 1', { exact: true }).inputValue() < first)
  ok('the footer says dated tasks go on the calendar', await dlg.locator('[data-planner-calendar-note]').count() === 1 && /put on your calendar/.test(await dlg.locator('[data-planner-calendar-note]').innerText()), await dlg.locator('[data-planner-calendar-note]').innerText())
  ok('Add says exactly what it will add', /Add 4 milestones and 8 tasks/.test(await addBtn().innerText()))

  // Edit the draft: untick milestone 2 ("Quotes chosen") and task 5, rename task 1, re-date task 2.
  await dlg.getByLabel('Include milestone Quotes chosen').uncheck()
  await dlg.getByLabel(/^Include task Order tiles/).uncheck()
  await dlg.getByLabel('Task name 1').fill('Measure the kitchen twice')
  await dlg.getByLabel('Date for task 2', { exact: true }).fill(day(5))
  ok('Add recounts: 3 milestones and 7 tasks', /Add 3 milestones and 7 tasks/.test(await addBtn().innerText()), await addBtn().innerText())
  ok('a task whose phase is unticked says it goes in with none', await dlg.getByText(/its phase is unticked/).count() === 2, `${await dlg.getByText(/its phase is unticked/).count()}`)
  await addBtn().click(); await p.waitForTimeout(400)
  const toast = /Added 3 milestones and 7 tasks/.test(await p.locator('body').innerText())
  await p.waitForTimeout(2600)
  const ms = await msNow(), ts = await tsNow()
  ok('only the ticked milestones were written', ms.length === 3 && !ms.some(m => m.title === 'Quotes chosen'), JSON.stringify(ms.map(m => m.title)))
  ok('and only the ticked tasks', ts.length === 7 && !ts.some(t => /Order tiles/.test(t.title)), JSON.stringify(ts.map(t => t.title)))
  ok('the rename and the re-date are what was written', ts.some(t => t.title === 'Measure the kitchen twice') && ts.find(t => /Set a budget/.test(t.title))?.dueDate === day(5), JSON.stringify(ts.map(t => [t.title, t.dueDate])))
  ok('a task keeps its phase when that phase was added', ts.filter(t => t.milestoneId).every(t => ms.some(m => m.id === t.milestoneId)) && ts.filter(t => t.milestoneId).length === 5, `${ts.filter(t => t.milestoneId).length}`)
  ok('tasks of the unticked phase carry none', ts.filter(t => /Get three quotes|Pick the contractor/.test(t.title)).every(t => t.milestoneId === null))
  ok('every task is PLACED (a quadrant, never the brain dump) and in the project', ts.every(t => t.quadrant !== null))
  ok('and it reached the server', db.project_milestones.length === 3 && db.tasks.filter(t => t.project_id === P).length === 7, `${db.project_milestones.length} / ${db.tasks.length}`)
  ok('the planner closed and said what it did', await dlg.count() === 0 && toast)

  await p.keyboard.press('Control+z'); await p.waitForTimeout(3000)
  ok('one undo takes the whole plan back: tasks…', (await tsNow()).length === 0 && !db.tasks.some(t => t.project_id === P), `${(await tsNow()).length}`)
  ok('…and milestones, here and on the server', (await msNow()).length === 0 && db.project_milestones.length === 0, `${(await msNow()).length} / ${db.project_milestones.length}`)

  // Cancel writes nothing.
  await openPlanner(); await dlg.locator('[data-template="trip"]').click()
  const w1 = { ...writes }
  await dlg.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(1500)
  ok('Cancel writes nothing', (await msNow()).length === 0 && (await tsNow()).length === 0 && writes.tasks === w1.tasks && writes.project_milestones === w1.project_milestones)
  await openPlanner(); await dlg.locator('[data-template="trip"]').click()
  await dlg.getByRole('button', { name: 'Back' }).click()
  ok('Back returns to the choices, with nothing kept', await dlg.locator('[data-template]').count() === 5 && await dlg.locator('[data-planner-preview]').count() === 0)
  await p.keyboard.press('Escape')
  ok('Escape closes the planner and writes nothing', await dlg.count() === 0 && (await tsNow()).length === 0)
  ok('and no AI request was made at any point', aiReqs.length === 0)
}

if (MODE === 'ai') {
  await openPlanner()
  ok('before anything is asked, no request has been made', aiReqs.length === 0)
  const btn = dlg.getByRole('button', { name: /Draft with AI/ })
  ok('Draft is disabled for a few words — it needs something to go on', await btn.isDisabled())
  await dlg.getByLabel('Describe the project').fill('Redo the kitchen: new cabinets, tiles and a sink, done before guests arrive')
  ok('and enabled once there is a description', await btn.isEnabled())
  aiReply = () => ({ status: 200, text: JSON.stringify({
    milestones: [{ title: 'Design agreed', dueDate: day(7) }, { title: 'Work finished', dueDate: day(28) }],
    tasks: [{ title: 'Measure the room', milestone: 0, dueDate: day(3), priority: 'P1' }, { title: 'Order cabinets', milestone: 0 }, { title: 'Fit the sink', milestone: 1, dueDate: day(20) }, { title: 'Snag list', milestone: 'Work finished' }],
  }) })
  await btn.click()
  await dlg.locator('[data-planner-preview]').waitFor({ state: 'visible', timeout: 8000 })
  ok('exactly one request was made', aiReqs.length === 1, `${aiReqs.length}`)
  ok('it carried the description, the project, today and the target', /Redo the kitchen/.test(aiReqs[0].user) && /Kitchen renovation/.test(aiReqs[0].user) && aiReqs[0].user.includes(`Today: ${TODAY}`) && aiReqs[0].user.includes(`Target: ${TARGET}`), aiReqs[0].user.replace(/\n/g, ' | ').slice(0, 220))
  ok('and told it to answer in JSON only, with the caps', /ONLY valid JSON/.test(aiReqs[0].system) && /At most 8 milestones/.test(aiReqs[0].system) && /at most 24 tasks/.test(aiReqs[0].system))
  ok('the answer is a draft: 2 milestones, 4 tasks, "A draft from the AI"', await rowsOf('[data-draft-milestone]') === 2 && await rowsOf('[data-draft-task]') === 4 && /A draft from the AI/.test(await dlg.innerText()))
  ok('a task named its phase by title, and by index — both resolved', await dlg.getByLabel('Phase for task 4', { exact: true }).inputValue() === 'm1' && await dlg.getByLabel('Phase for task 1', { exact: true }).inputValue() === 'm0')
  ok('and nothing is written yet', (await msNow()).length === 0 && (await tsNow()).length === 0)
  await addBtn().click(); await p.waitForTimeout(3000)
  const ts = await tsNow()
  ok('adding writes the draft: priority and dates as the model gave them', ts.find(t => t.title === 'Measure the room')?.priority === 'P1' && ts.find(t => t.title === 'Fit the sink')?.dueDate === day(20) && ts.length === 4, JSON.stringify(ts.map(t => [t.title, t.priority, t.dueDate])))
  ok('and still only one request was ever made', aiReqs.length === 1)
}

if (MODE === 'messy') {
  await openPlanner()
  await dlg.getByLabel('Describe the project').fill('A hostile model answers this one')
  const tasks = [{ title: 'x'.repeat(300), milestone: 0 }, { title: 'Orphan phase task', milestone: 99, dueDate: '2026-02-30', priority: 'P9' }, { title: 'Valid one', milestone: 1, priority: 'P1', dueDate: day(10) }, { title: 'valid ONE', milestone: 1 }, { title: '   ' }, 42, null,
    ...Array.from({ length: 40 }, (_, i) => ({ title: `Filler ${i}` }))]
  aiReply = () => ({ status: 200, text: '```json\n' + JSON.stringify({ milestones: [{ title: '' }, { title: 'Ship', dueDate: day(12) }, { title: 'ship' }, { title: 'Plan', dueDate: '2026-13-45' }, 'not an object', ...Array.from({ length: 12 }, (_, i) => ({ title: `Extra ${i}` }))], tasks }) + '\n```' }) // fenced
  await dlg.getByRole('button', { name: /Draft with AI/ }).click()
  await dlg.locator('[data-planner-preview]').waitFor({ state: 'visible', timeout: 8000 })
  const msTitles = await dlg.locator('[data-draft-milestone] input[type=text], [data-draft-milestone] input:not([type])').evaluateAll(els => els.map(e => e.value))
  ok('a fenced answer is read', msTitles.length > 0)
  ok('blanks, duplicates (any case) and non-objects are dropped: Ship, Plan, then the extras', msTitles[0] === 'Ship' && msTitles[1] === 'Plan' && msTitles.filter(t => t.toLowerCase() === 'ship').length === 1 && !msTitles.includes(''), JSON.stringify(msTitles))
  ok('milestones are capped at 8', msTitles.length === 8, `${msTitles.length}`)
  ok('an impossible date is dropped, not kept', await dlg.getByLabel('Date for milestone 2', { exact: true }).inputValue() === '' && await dlg.getByLabel('Date for milestone 1', { exact: true }).inputValue() === day(12))
  const tTitles = await dlg.locator('[data-draft-task] input:not([type=date]):not([type=checkbox])').evaluateAll(els => els.map(e => e.value))
  ok('tasks are capped at 24', tTitles.length === 24, `${tTitles.length}`)
  ok('a 300-character title is cut to 120', tTitles[0].length === 120, `${tTitles[0].length}`)
  ok('a title repeated in another case is dropped; blanks and non-objects too', tTitles.filter(t => t.toLowerCase() === 'valid one').length === 1 && !tTitles.includes('') && !tTitles.includes('42'))
  ok('a phase that does not exist leaves the task with none; an impossible date is empty', await dlg.getByLabel('Phase for task 2', { exact: true }).inputValue() === '' && await dlg.getByLabel('Date for task 2', { exact: true }).inputValue() === '')
  ok('a real phase (named by the model own index, blanks and all) and a real date are kept', await dlg.getByLabel('Phase for task 3', { exact: true }).inputValue() === 'm0' && await dlg.getByLabel('Date for task 3', { exact: true }).inputValue() === day(10))
  await addBtn().click(); await p.waitForTimeout(3000)
  const ts = await tsNow()
  ok('an unknown priority was dropped, a real one kept', ts.find(t => t.title === 'Orphan phase task')?.priority === null && ts.find(t => t.title === 'Valid one')?.priority === 'P1', JSON.stringify(ts.slice(0, 3).map(t => [t.title.slice(0, 12), t.priority])))
}

if (MODE === 'fail') {
  await openPlanner()
  await dlg.getByLabel('Describe the project').fill('Something the model will fail to plan')
  const go = async () => { await dlg.getByRole('button', { name: /Draft with AI/ }).click(); await p.waitForTimeout(2500) }
  aiReply = () => ({ status: 500, text: '' })
  await go()
  const afterFirst = aiReqs.length   // the SDK retries a 5xx by itself, so this press may be more than one
  ok('a 500 says so, and shows no draft', await dlg.locator('[data-planner-error]').count() === 1 && await dlg.locator('[data-planner-preview]').count() === 0, (await dlg.locator('[data-planner-error]').innerText().catch(() => '')).slice(0, 120))
  ok('and writes nothing', (await msNow()).length === 0 && (await tsNow()).length === 0 && writes.tasks === 0)
  aiReply = () => ({ status: 200, text: 'Sure! Here is a lovely plan for your kitchen. First, measure.' })
  await go()
  ok('prose is not a plan: it says it could not read it', /could not read|form I could read/.test(await dlg.locator('[data-planner-error]').innerText()), await dlg.locator('[data-planner-error]').innerText())
  aiReply = () => ({ status: 200, text: '{"milestones":[{"title":""}],"tasks":[{"nope":1}]}' })
  await go()
  ok('an answer that is empty once validated says so, rather than showing a blank plan', /nothing usable/.test(await dlg.locator('[data-planner-error]').innerText()) && await dlg.locator('[data-planner-preview]').count() === 0)
  aiReply = () => ({ status: 200, text: '{"milestones":[{"title":"Done"}],"tasks":[{"title":"Do the thing","milestone":0}]}' })
  await go()
  ok('and the next try works: the same dialog, no reload', await dlg.locator('[data-planner-preview]').count() === 1 && await dlg.locator('[data-planner-error]').count() === 0)
  ok('after the 500 each press made exactly one request', afterFirst >= 1 && aiReqs.length === afterFirst + 3, `${afterFirst} then ${aiReqs.length}`)
  ok('through all of it nothing was written', writes.tasks === 0 && writes.project_milestones === 0)
}

if (MODE === 'nokey') {
  await openPlanner()
  ok('with no key the AI is not offered, and the dialog says why', await dlg.locator('[data-planner-nokey]').count() === 1 && await dlg.getByRole('button', { name: /Draft with AI/ }).isDisabled())
  await dlg.getByLabel('Describe the project').fill('A long enough description to enable the button')
  ok('even with a description', await dlg.getByRole('button', { name: /Draft with AI/ }).isDisabled())
  await dlg.locator('[data-template="learn"]').click()
  ok('a template still drafts', await rowsOf('[data-draft-milestone]') === 4)
  await dlg.getByRole('button', { name: 'Back' }).click()
  await dlg.getByRole('tab', { name: /Date my open tasks/ }).isDisabled().then(d => ok('and the dating tab is disabled with no open tasks to date', d))
  ok('no request was made', aiReqs.length === 0)
}

if (MODE === 'schedule') {
  await openPlanner()
  ok('the dating tab counts the open undated tasks: 4 (not the dated one, not the finished one)', /Date my open tasks · 4/.test(await dlg.getByRole('tab', { name: /Date my open tasks/ }).innerText()))
  await dlg.getByRole('tab', { name: /Date my open tasks/ }).click()
  ok('no request until asked', aiReqs.length === 0)
  aiReply = () => ({ status: 200, text: JSON.stringify([
    { id: tid(1), dueDate: day(2) }, { id: tid(2), dueDate: day(9) }, { id: tid(3), dueDate: day(16) },
    { id: tid(4), dueDate: day(45) },              // after the target: outside the window
    { id: 'ghost-id', dueDate: day(4) },           // not a task we asked about
    { id: tid(1), dueDate: day(6) },               // a second answer for the same task
    { id: tid(5), dueDate: day(6) },               // an already-dated task we never offered
  ]) })
  await dlg.getByRole('button', { name: /Propose dates/ }).click()
  await dlg.locator('[data-planner-schedule]').waitFor({ state: 'visible', timeout: 8000 })
  const asked = aiReqs[0].user
  ok('the request names exactly the four open undated tasks, with their priority', [1, 2, 3, 4].every(n => asked.includes(tid(n))) && !asked.includes(tid(5)) && !asked.includes(tid(6)) && /\| P1/.test(asked), asked.replace(/\n/g, ' | ').slice(0, 260))
  ok('and the window: today to the target', asked.includes(`Window: ${TODAY} to ${TARGET}`))
  const rows = await dlg.locator('[data-proposal]').evaluateAll(els => els.map(e => e.getAttribute('data-proposal')))
  ok('only valid proposals survive: not outside the window, not a stranger, not twice, not a task never asked about', JSON.stringify(rows) === JSON.stringify([tid(1), tid(2), tid(3)]), JSON.stringify(rows))
  ok('and the first answer for a task is the one kept', await dlg.getByLabel('Date for Choose the tiles').inputValue() === day(2))
  ok('no task has changed yet', (await tsNow()).every(t => t.id === tid(5) ? t.dueDate === day(9) : t.dueDate === null))
  ok('the footer says dated tasks go on the calendar', /Dated tasks are put on your calendar — 3 will be/.test(await dlg.locator('[data-planner-calendar-note]').innerText()), await dlg.locator('[data-planner-calendar-note]').innerText())
  await dlg.getByLabel('Date Order the cabinets').uncheck()
  await dlg.getByLabel('Date for Book the plumber').fill(day(11))
  ok('the button counts what is ticked: Date 2 tasks', await dlg.getByRole('button', { name: 'Date 2 tasks' }).count() === 1)
  await dlg.getByRole('button', { name: 'Date 2 tasks' }).click(); await p.waitForTimeout(3000)
  const ts = await tsNow(), by = id => ts.find(t => t.id === id)
  ok('the ticked tasks are dated — with the edit', by(tid(1)).dueDate === day(2) && by(tid(3)).dueDate === day(11), JSON.stringify([by(tid(1)).dueDate, by(tid(3)).dueDate]))
  ok('the unticked one is not', by(tid(2)).dueDate === null)
  ok('a task nobody offered is untouched', by(tid(5)).dueDate === day(9))
  ok('and it reached the server', db.tasks.find(t => t.id === tid(1))?.due_date === day(2) && db.tasks.find(t => t.id === tid(2))?.due_date === null)
  const q1 = by(tid(1)).quadrant
  if (process.env.DBG) console.log('  after apply', JSON.stringify(ts.map(t => [t.id.slice(-2), t.dueDate, t.quadrant])))
  await p.keyboard.press('Control+z')
  if (process.env.DBG) for (const ms of [200, 800, 2000]) { await p.waitForTimeout(ms); console.log('  undo +' + ms, JSON.stringify((await tsNow()).map(t => [t.id.slice(-2), t.dueDate, t.quadrant])), JSON.stringify(db.tasks.map(t => [t.id.slice(-2), t.due_date]))) }
  await p.waitForTimeout(3000)
  const back = await tsNow()
  ok('one undo undates them both', back.find(t => t.id === tid(1)).dueDate === null && back.find(t => t.id === tid(3)).dueDate === null, JSON.stringify(back.map(t => [t.id.slice(-2), t.dueDate])))
  ok('and puts the quadrant back too (a first date had moved it)', back.find(t => t.id === tid(1)).quadrant === 'do' && q1 !== 'do', `${q1} -> ${back.find(t => t.id === tid(1)).quadrant}`)
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
