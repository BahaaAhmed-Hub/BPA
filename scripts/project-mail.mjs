// node scripts/project-mail.mjs [reader|chip|suggest|page|sync]
// Needs a dev server on 5199.
//
// Chunk 6 of Projects: a mail thread belongs to a project, from the reader; the
// row says so; Mail offers "Looks like Project X" when exactly one clearly fits;
// and the project page lists its Mail. Gmail is a stub that records every write —
// filing a thread must not touch the mailbox: the link is the app's own.
//
//   reader   the Project row in the reader: options, link with its snapshot on the
//            server, replace, clear
//   chip     a filed thread says so on its row, and only that one
//   suggest  the suggestion: which tier, which reason, and when it keeps quiet
//            (ties, an archived project, an already-filed thread, a correspondent
//            who writes about two projects); Link files it; Not this is remembered
//   page     the Mail tab: newest first, unlink, open in Mail
//   sync     the snapshot is refreshed from the loaded thread, left alone when
//            right, and kept when the thread is not loaded
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const ME = 'a@x.com'
const MODE = process.argv[2] ?? 'reader'
const DAY = 86400000
const P_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const P_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const P_BUD = 'aaaaaaaa-0000-4000-8000-00000000000c'
const P_BUD2 = 'aaaaaaaa-0000-4000-8000-00000000000d'
const P_ARCH = 'aaaaaaaa-0000-4000-8000-00000000000e'
const now = new Date().toISOString()
const project = (id, name, o = {}) => ({
  id, user_id: U, name, kind: 'work', color: '#2F63A8', status: 'active', company_id: null, start_date: null,
  target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o,
})
const at = i => Date.now() - (i + 1) * (DAY / 6)
const row = (id, subject, from, email, i) => ({
  user_id: U, account_email: ME, thread_id: id, last_message_id: `m-${id}`,
  last_at: new Date(at(i)).toISOString(), subject, from_name: from, from_email: email, section: 'action', reply_state: 'none',
  need: 'They are waiting on you.', draft: null, direct: true, addressed_to: 'to', named_in_body: true, bottleneck: false,
  awaiting_customer: false, kind: 'reply', muted: false, archived_at: null, acknowledged_at: null, handled_at: null,
  analyzed_at: new Date().toISOString(),
})
const stored = [
  row('t0', 'Launch the site — copy review', 'Ana Client', 'ana@client.com', 0),
  row('t1', 'Kitchen tiles: renovation quote', 'Tile Co', 'sales@tiles.com', 1),
  row('t2', 'Lunch on Friday?', 'Sam Friend', 'sam@friends.com', 2),
  row('t3', 'Budget review for Q4', 'Finance', 'fin@x.com', 3),
  row('t4a', 'Invoice 1041', 'Ben Vendor', 'ben@vendor.com', 4),
  row('t4b', 'Invoice 1042', 'Ben Vendor', 'ben@vendor.com', 5),
  row('t4c', 'Invoice 1043 overdue', 'Ben Vendor', 'ben@vendor.com', 6),
  row('t5', 'Hidden project plan', 'Someone', 'someone@x.com', 7),
  row('t6a', 'Status 1', 'Cy Both', 'cy@x.com', 8),
  row('t6b', 'Status 2', 'Cy Both', 'cy@x.com', 9),
  row('t6c', 'Status 3', 'Cy Both', 'cy@x.com', 10),
  row('t6d', 'Status 4', 'Cy Both', 'cy@x.com', 11),
]
const ref = id => `${ME}|${id}`
const tmeta = (id, o = {}) => { const r = stored.find(x => x.thread_id === id); return { subject: r.subject, fromName: r.from_name, fromEmail: r.from_email, at: new Date(r.last_at).getTime(), accountEmail: ME, ...o } }
const link = (n, pid, id, meta) => ({ id: `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, project_id: pid, user_id: U, kind: 'thread', ref_id: ref(id), meta: meta === undefined ? tmeta(id) : meta, created_at: now })

const db = { tasks: [], projects: [], project_milestones: [], project_links: [] }
db.projects = [
  project(P_A, 'Launch the site'), project(P_B, 'Kitchen renovation', { kind: 'personal', color: '#1D8A6A' }),
  project(P_BUD, 'Budget', { color: '#C2622B' }), project(P_BUD2, 'Budget review', { color: '#B03A73' }),
  project(P_ARCH, 'Hidden project', { archived: true }),
]
if (MODE === 'chip') db.project_links = [link(1, P_A, 't2')]
if (MODE === 'suggest') db.project_links = [
  link(1, P_A, 't4a'), link(2, P_A, 't4b'),                       // Ben is on two threads in A, none elsewhere
  link(3, P_A, 't6a'), link(4, P_A, 't6b'), link(5, P_B, 't6c'),   // Cy is on threads in both: no pattern
]
if (MODE === 'page') db.project_links = [
  link(1, P_A, 't0'), link(2, P_A, 't4a'), link(3, P_B, 't1'),
  link(4, P_A, 'gone-thread', null),   // no snapshot yet
]
if (MODE === 'sync') db.project_links = [
  link(1, P_A, 't0', { ...tmeta('t0'), subject: 'Old subject' }),         // stale: the list holds it
  link(2, P_A, 't2'),                                                       // already right
  link(3, P_A, 'not-in-list', { subject: 'Not in the list', fromName: 'X', fromEmail: 'x@x.com', at: 1700000000000, accountEmail: ME }),
]
const idsIn = u => ((u.searchParams.get('id') || '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.replace(/"/g, '').trim())
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const gmailWrites = []
let linkWrites = 0
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1700, height: 1100 }, timezoneId: 'UTC', locale: 'en-GB' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname.endsWith('/mail_smart_threads')) return q.method() === 'GET' ? j(stored) : j([])
  if (u.pathname.endsWith('/users')) return j([{ id: U, email: ME, full_name: 'A' }])
  const table = Object.keys(db).find(t => u.pathname.endsWith('/' + t))
  if (!table) return j([])
  const m = q.method()
  if (m === 'GET') return j(u.searchParams.get('select') === 'id' ? db[table].map(x => ({ id: x.id })) : db[table])
  if (table === 'project_links') linkWrites++
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const rw of rows) {
      const i = db[table].findIndex(x => x.id === rw.id || (table === 'project_links' && x.project_id === rw.project_id && x.kind === rw.kind && x.ref_id === rw.ref_id))
      if (i >= 0) db[table][i] = { ...db[table][i], ...rw }; else db[table].push(rw)
    }
    return j([])
  }
  if (m === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); for (const rw of db[table]) Object.assign(rw, body); return j([]) }
  if (m === 'DELETE') { const ids = new Set(idsIn(u)); db[table] = db[table].filter(x => !ids.has(x.id)); return j([]) }
  return j([])
})
await ctx.route('**://gmail.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const j = x => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(x) })
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (q.method() !== 'GET') gmailWrites.push(`${q.method()} ${u.pathname} ${q.postData() ?? ''}`)
  if (/\/threads\/[^/]+$/.test(u.pathname)) return j({ id: u.pathname.split('/').pop(), messages: [] })
  if (u.pathname.includes('/threads')) return j({ threads: [] })
  return j({})
})
await ctx.addInitScript(([s, start, dismissed]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: start, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('mail-mode', 'smart'); localStorage.setItem('mail-smart-view', 'action')
  localStorage.setItem('google_provider_token', 'tok'); localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  if (dismissed && !localStorage.getItem('project-suggest-dismissed')) localStorage.setItem('project-suggest-dismissed', '[]')
} catch {} }, [session, MODE === 'page' ? 'projects' : 'inbox', false])

const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const urlOf = name => p.evaluate(n => performance.getEntriesByType('resource').map(e => e.name).find(u => new RegExp('/src/store/' + n + '\\.ts').test(u)) ?? null, name)
const URLS = { proj: await urlOf('projectStore') }
const S = fn => p.evaluate(async ([src, urls]) => {
  const proj = (await import(urls.proj)).useProjectStore
  return await (new Function('proj', `return (${src})(proj)`))(proj)
}, [fn.toString(), URLS])
const linksNow = () => S(proj => proj.getState().links.filter(l => l.kind === 'thread'))
ok('found the app\'s own project store', !!URLS.proj)

const openThread = async subject => {
  await p.getByRole('button', { name: subject, exact: true }).first().click()
  await p.locator('[data-thread-project]').first().waitFor({ state: 'visible', timeout: 8000 })
}
const sel = () => p.getByLabel('Project for this thread')

if (MODE !== 'page') {
  await p.getByRole('button', { name: 'Lunch on Friday?', exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
  ok('the smart view drew the stored rows', await p.getByRole('button', { name: /^Invoice 104/ }).count() >= 3)
}

if (MODE === 'reader') {
  await openThread('Lunch on Friday?')
  ok('the reader has a Project row', await p.locator('[data-thread-project]').count() === 1)
  const opts = await sel().locator('option').allTextContents()
  ok('it offers live projects only — not the archived one', JSON.stringify(opts) === JSON.stringify(['No project', 'Launch the site', 'Kitchen renovation', 'Budget', 'Budget review']), JSON.stringify(opts))
  const w0 = gmailWrites.length
  await sel().selectOption({ label: 'Launch the site' }); await p.waitForTimeout(2800)
  const l1 = await linksNow()
  ok('choosing one files the thread: one link, that project, `mailbox|thread`', l1.length === 1 && l1[0].projectId === P_A && l1[0].refId === ref('t2'), JSON.stringify(l1.map(l => [l.projectId, l.refId])))
  ok('with a snapshot of the thread (subject, sender, when, mailbox)', JSON.stringify(l1[0].meta) === JSON.stringify(tmeta('t2')), JSON.stringify(l1[0].meta))
  const srv = db.project_links.filter(l => l.kind === 'thread')
  ok('and it reached the server with the user and the snapshot', srv.length === 1 && srv[0].user_id === U && srv[0].meta?.subject === 'Lunch on Friday?' && srv[0].ref_id === ref('t2'), JSON.stringify(srv))
  ok('nothing was written to Gmail by filing it', gmailWrites.length === w0, JSON.stringify(gmailWrites.slice(w0)))
  await sel().selectOption({ label: 'Kitchen renovation' }); await p.waitForTimeout(2800)
  const l2 = await linksNow()
  ok('choosing another REPLACES: one link, now to the other project', l2.length === 1 && l2[0].projectId === P_B && db.project_links.filter(l => l.kind === 'thread').length === 1)
  await sel().selectOption({ label: 'No project' }); await p.waitForTimeout(2800)
  ok('"No project" removes it, here and on the server', (await linksNow()).length === 0 && db.project_links.length === 0)
  ok('and Gmail was still never written to', gmailWrites.length === w0, JSON.stringify(gmailWrites.slice(w0)))
}

if (MODE === 'chip') {
  const chip = p.locator('[data-thread-project-chip]')
  await chip.first().waitFor({ state: 'visible', timeout: 8000 })
  ok('the filed thread says so on its row, naming the project', await chip.count() === 1 && (await chip.first().innerText()).includes('Launch the site'))
  const rowOf = await chip.first().evaluate(el => { let n = el; for (let i = 0; i < 8 && n; i++, n = n.parentElement) { if (n.querySelector('input[type=checkbox]')) return n.innerText } return '' })
  ok('and it is the right row (Lunch on Friday?)', /Lunch on Friday\?/.test(rowOf), rowOf.replace(/\n/g, ' | ').slice(0, 120))
  ok('no other row carries one', await p.locator('[data-thread-project-chip]').count() === 1)
  await openThread('Lunch on Friday?')
  await sel().selectOption({ label: 'No project' }); await p.waitForTimeout(800)
  ok('unfiling removes the chip', await p.locator('[data-thread-project-chip]').count() === 0)
}

if (MODE === 'suggest') {
  const sug = () => p.locator('[data-project-suggestion]')
  await openThread('Launch the site — copy review')
  ok('a subject that names the project is offered it', await sug().count() === 1 && (await sug().getAttribute('data-project-suggestion')) === P_A)
  ok('with the reason in words', /its name is in the subject/.test(await sug().innerText()), (await sug().innerText()).replace(/\n/g, ' '))
  const w0 = gmailWrites.length
  const before = (await linksNow()).length
  ok('offering alone files nothing', before === 5)
  await sug().getByRole('button', { name: 'Link' }).click(); await p.waitForTimeout(2800)
  const after = await linksNow()
  ok('Link files it to that project', after.length === 6 && after.some(l => l.refId === ref('t0') && l.projectId === P_A))
  ok('and the suggestion goes', await sug().count() === 0 && (await sel().inputValue()) === P_A)
  ok('Gmail untouched', gmailWrites.length === w0)

  await openThread('Kitchen tiles: renovation quote')
  ok('every distinctive word of a two-word name is enough: Kitchen renovation', await sug().count() === 1 && (await sug().getAttribute('data-project-suggestion')) === P_B && /kitchen and renovation/.test(await sug().innerText()), (await sug().innerText()).replace(/\n/g, ' '))
  await sug().getByRole('button', { name: 'Not this' }).click()
  ok('"Not this" hides it', await sug().count() === 0)
  ok('and remembers, per browser', await p.evaluate(() => (localStorage.getItem('project-suggest-dismissed') ?? '').includes('t1')))

  await openThread('Lunch on Friday?')
  ok('a subject that names nothing gets no suggestion', await sug().count() === 0)
  await openThread('Budget review for Q4')
  ok('two projects fit equally (Budget, Budget review): that is a question, not an answer — no suggestion', await sug().count() === 0)
  await openThread('Hidden project plan')
  ok('an archived project is never suggested, though its name is there', await sug().count() === 0)
  await openThread('Invoice 1043 overdue')
  ok('a correspondent on two threads in one project and none elsewhere → offered it', await sug().count() === 1 && (await sug().getAttribute('data-project-suggestion')) === P_A && /ben@vendor.com is on 2 threads/.test(await sug().innerText()), (await sug().innerText()).replace(/\n/g, ' '))
  await openThread('Status 4')
  ok('a correspondent who is in two projects shows no pattern — no suggestion (and the thread is unfiled, so the rule really ran)', await sug().count() === 0 && (await sel().inputValue()) === '')
  await openThread('Invoice 1041')
  ok('an already-filed thread is not suggested anything', await sug().count() === 0 && (await sel().inputValue()) === P_A)
  await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 7000)
  await openThread('Kitchen tiles: renovation quote')
  ok('a dismissed suggestion stays dismissed after a reload', await sug().count() === 0)
}

if (MODE === 'page') {
  await p.locator(`[data-project-card="${P_A}"]`).waitFor({ state: 'visible', timeout: 8000 })
  await p.locator(`[data-project-card="${P_A}"]`).click()
  await p.locator(`[data-project-page="${P_A}"]`).waitFor({ state: 'visible' })
  const tab = p.getByRole('tab', { name: /^Mail/ })
  ok('the tab counts the project\'s threads: 3 (another project\'s is not counted)', /Mail · 3/.test(await tab.innerText()), await tab.innerText())
  await tab.click()
  const order = await p.locator('[data-project-thread]').evaluateAll(els => els.map(e => e.getAttribute('data-project-thread')))
  ok('newest first, the one with no snapshot last', JSON.stringify(order) === JSON.stringify([ref('t0'), ref('t4a'), ref('gone-thread')]), JSON.stringify(order))
  const first = await p.locator(`[data-project-thread="${ref('t0')}"]`).innerText()
  ok('a row shows subject, sender, and mailbox', /Launch the site — copy review/.test(first) && /Ana Client/.test(first) && /a@x.com/.test(first), first.replace(/\n/g, ' | '))
  ok('a link with no snapshot yet says "A conversation" rather than guessing', /A conversation/.test(await p.locator(`[data-project-thread="${ref('gone-thread')}"]`).innerText()))
  ok('another project\'s thread is not listed', await p.locator(`[data-project-thread="${ref('t1')}"]`).count() === 0)
  const w0 = gmailWrites.length
  await p.getByRole('button', { name: 'Take Invoice 1041 out of this project' }).click(); await p.waitForTimeout(2800)
  ok('taking one out removes the row, the link and the server row', await p.locator(`[data-project-thread="${ref('t4a')}"]`).count() === 0 && !db.project_links.some(l => l.ref_id === ref('t4a')) && !(await linksNow()).some(l => l.refId === ref('t4a')))
  ok('the others stay', db.project_links.some(l => l.ref_id === ref('t0')) && db.project_links.some(l => l.ref_id === ref('t1')))
  ok('Gmail untouched', gmailWrites.length === w0)
  await p.getByRole('button', { name: 'Open Launch the site — copy review in Mail' }).click()
  await p.locator('[data-thread-project]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  ok('Open in Mail goes to Mail', await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ui') || '{}').state?.activeModule) === 'inbox')
  const reader = p.locator('aside').filter({ has: p.locator('[data-thread-project]') })
  ok('a reader is open (so the claims below are about something)', await reader.count() === 1)
  ok('with that thread open in it', await reader.count() === 1 && (await reader.innerText()).includes('Launch the site — copy review'))
  ok('and it is shown as filed under that project', await sel().count() === 1 && (await sel().inputValue()) === P_A)
}

if (MODE === 'sync') {
  await p.waitForTimeout(4500)
  const ls = await linksNow()
  const t0 = ls.find(l => l.refId === ref('t0')), t2 = ls.find(l => l.refId === ref('t2')), gone = ls.find(l => l.refId === ref('not-in-list'))
  ok('a stale snapshot is refreshed from the thread the list holds', t0?.meta?.subject === 'Launch the site — copy review', JSON.stringify(t0?.meta))
  ok('and the refresh reached the server', db.project_links.find(l => l.ref_id === ref('t0'))?.meta?.subject === 'Launch the site — copy review')
  ok('one that is already right is left alone', JSON.stringify(t2.meta) === JSON.stringify(tmeta('t2')))
  ok('a thread the list does not hold keeps what it had', gone?.meta?.subject === 'Not in the list' && db.project_links.find(l => l.ref_id === ref('not-in-list'))?.meta?.subject === 'Not in the list')
  const before = linkWrites
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(7000)
  ok('a reload that changes nothing writes nothing back', linkWrites === before, `${before} -> ${linkWrites}`)
  ok('Gmail untouched', gmailWrites.length === 0, JSON.stringify(gmailWrites))
}

if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
