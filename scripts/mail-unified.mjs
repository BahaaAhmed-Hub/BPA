// node scripts/mail-unified.mjs      — needs a dev server on 5199
//
// One answer to "what needs me", and acts that really happen — on every screen.
//
// Three places judged mail three ways: the Mail page from stored analysis, the Today card from its own
// sender rules, the assistant from nothing (a raw Gmail search). And archive/RSVP were written three times:
// Today archived one *message* and swallowed a refusal; none of it told the smart view. Gmail and Google
// Calendar are faked **and can refuse**; every claim is read off the request that went out.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id, ME = 'a@x.com'
const DAY = 86400000
const b64 = s => Buffer.from(s).toString('base64url')
const at = d => new Date(Date.now() - d * DAY).toISOString()
const srow = (id, over) => ({ user_id: U, account_email: ME, thread_id: id, last_message_id: id + 'm', last_at: at(1), subject: `Subject ${id}`, from_name: `Sender ${id}`, from_email: `${id}@example.com`,
  section: 'action', reply_state: 'none', need: 'They are waiting on you.', draft: '', direct: true, addressed_to: true, named_in_body: true, bottleneck: false, awaiting_customer: false,
  kind: 'reply', muted: false, archived_at: null, acknowledged_at: null, handled_at: null, analyzed_at: new Date().toISOString(), ...over })
let stored = [
  srow('tA', { subject: 'Answer A please' }),
  srow('tB', { subject: 'Handled B', handled_at: at(0.5) }),
  srow('tC', { subject: 'Archived C', archived_at: at(0.5) }),
  srow('tD', { subject: 'Heads up D', section: 'attention', kind: 'security' }),
]
const thread = (id, subject) => ({ id, messages: [{ id: id + 'm', threadId: id, labelIds: ['INBOX', 'UNREAD'], internalDate: String(Date.now() - DAY), snippet: 'x',
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: `Sender ${id} <${id}@example.com>` }, { name: 'To', value: ME }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: `<${id}@x>` }],
    body: { data: b64('Please can you answer this today.') } } }] })
const unread = [['tA', 'Answer A please'], ['tB', 'Handled B'], ['tC', 'Archived C'], ['tD', 'Heads up D'], ['tE', 'Fresh E not yet analysed']]
let gmailFail = false, calFail = false
const gmailCalls = [], calCalls = [], storePatches = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const j = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', async r => { const q = r.request(); const u = new URL(q.url())
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (u.pathname === '/auth/v1/user') return j(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return j(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return j(r, {})
  if (u.pathname.endsWith('/mail_smart_threads')) {
    if (q.method() === 'GET') return j(r, stored)
    if (q.method() === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); const tid = (u.searchParams.get('thread_id') || '').replace('eq.', ''); storePatches.push({ tid, body })
      stored = stored.map(x => x.thread_id === tid ? { ...x, ...body } : x); return j(r, []) }
    return j(r, [])
  }
  if (u.pathname.endsWith('/users')) return j(r, [{ id: U, email: ME, full_name: 'A' }])
  return j(r, []) })
await ctx.route('**://gmail.googleapis.com/**', async r => { const q = r.request(); const u = new URL(q.url())
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (/\/modify$/.test(u.pathname)) {
    gmailCalls.push({ path: u.pathname, body: JSON.parse(q.postData() || '{}') })
    return gmailFail ? j(r, { error: { message: 'Gmail refused' } }, 403) : j(r, {})
  }
  const m = u.pathname.match(/\/threads\/([^/]+)$/)
  if (m) { const hit = unread.find(x => x[0] === m[1]); return hit ? j(r, thread(hit[0], hit[1])) : j(r, { error: { message: 'no' } }, 404) }
  if (u.pathname.endsWith('/threads')) return j(r, { threads: unread.map(x => ({ id: x[0] })) })
  if (u.pathname.endsWith('/labels')) return j(r, { labels: [] })
  return j(r, {}) })
await ctx.route('**://www.googleapis.com/calendar/**', async r => { const q = r.request(); const u = new URL(q.url())
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (q.method() === 'PATCH') { calCalls.push({ url: q.url(), body: JSON.parse(q.postData() || '{}') }); return calFail ? j(r, { error: { message: 'Calendar refused' } }, 403) : j(r, { id: 'ev1' }) }
  if (u.pathname.endsWith('/calendarList')) return j(r, { items: [] })
  if (u.pathname.includes('/events')) return j(r, !u.searchParams.get('iCalUID') ? { items: [] } : { items: [{ id: 'ev1', attendees: [{ email: ME, self: true, responseStatus: 'needsAction' }, { email: 'boss@x.com', organizer: true, responseStatus: 'accepted' }] }] })
  return j(r, {}) })
const go = mod => ctx.addInitScript(([s, m]) => { try { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: m, themeId: 'sunlit-bento' }, version: 0 })); localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-test' })) } catch {} }, [session, mod])
await go('morning')
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(5000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const body = () => p.locator('body').innerText()
const needs = () => p.evaluate(async email => { const t = await import('/BPA/src/lib/assistantTools.ts'); return t.executeTool('mail_needs', {}, { primaryEmail: email, accounts: [], tasks: [], habits: [], addTask() {}, updateTask() {}, deleteTask() {} }) }, ME)

// ── one list, three screens ──────────────────────────────────────────────────
let t = await body()
ok('Today shows the thread the smart view calls an action', /Answer A please/.test(t))
ok('…and the one it has not analysed yet, from its own live rules (a fallback, not a second opinion)', /Fresh E not yet analysed/.test(t))
ok('…but NOT the thread you marked done, nor the one you archived — decisions made anywhere', !/Handled B/.test(t) && !/Archived C/.test(t))
let n = await needs()
ok('the assistant is given the same list: exactly the one action, and the one to know about', n.available && n.action.map(x => x.thread_id).join() === 'tA' && n.attention.map(x => x.thread_id).join() === 'tD', JSON.stringify([n.action, n.attention].map(a => a?.map?.(x => x.thread_id))))
ok('…with what is wanted, so its answer says why', n.action[0]?.what_is_wanted === 'They are waiting on you.')
ok('…and never the handled or archived ones', !JSON.stringify(n).includes('tB') && !JSON.stringify(n).includes('tC'))

// ── archive: Gmail first, the whole thread, and every screen hears about it ──
const archiveRow = (text) => p.evaluate(t => { const all = [...document.querySelectorAll('*')].filter(e => e.children.length && e.textContent.includes(t))
  let el = all.at(-1); while (el && el.querySelectorAll('button[title="Archive"]').length !== 1) el = el.parentElement
  const btn = el?.querySelector('button[title="Archive"]'); if (btn) { btn.click(); return true } return false }, text)
ok('the row offers Archive', await archiveRow('Answer A please'))
await p.waitForTimeout(1500)
const aCall = gmailCalls.find(c => /\/threads\/tA\/modify$/.test(c.path))
ok('Archive on Today asks Gmail to archive the THREAD (not one message)', !!aCall && aCall.body.removeLabelIds?.includes('INBOX') && !gmailCalls.some(c => /\/messages\//.test(c.path)), JSON.stringify(gmailCalls.map(c => c.path)))
ok('…and tells the smart view, which stamps it', storePatches.some(x => x.tid === 'tA' && x.body.archived_at))
n = await needs()
ok('so the assistant no longer lists it', n.available && n.action.length === 0, JSON.stringify(n.action))
ok('and it left the card', !/Answer A please/.test(await body()))

// ── a refusal is said, and nothing pretends ─────────────────────────────────
gmailFail = true; gmailCalls.length = 0; const before = storePatches.length
await archiveRow('Fresh E not yet analysed'); await p.waitForTimeout(1500)
ok('Gmail was asked, and refused', gmailCalls.length >= 1)
ok('the row is BACK on the card — it did not leave Gmail, so it does not leave here', /Fresh E not yet analysed|Heads up D/.test(await body()))
ok('the refusal is said in words', /Not archived/.test(await body()))
ok('and the smart view was not told it was archived', storePatches.length === before)
gmailFail = false

// ── RSVP: really on the calendar, really told to the organiser, marked on every screen ──
const inv = { uid: 'u1', summary: 'Sync with Boss', startsAt: new Date().toISOString(), endsAt: new Date().toISOString(), organizer: 'boss@x.com', cancelled: false }
const act = (answer) => p.evaluate(async ([invite, email, answer]) => { const m = await import('/BPA/src/lib/mailActions.ts'); const a = await import('/BPA/src/modules/inbox/mailAccounts.ts')
  const acc = a.mailAccounts(email)[0]; return m.answerInvitation(invite, acc, 'tD', answer) }, [inv, ME, answer])
calFail = true; storePatches.length = 0; gmailCalls.length = 0
let r = await act('accepted')
ok('Calendar refusing the answer is reported, with its reason', r.ok === false && /Calendar refused/.test(r.why ?? ''), JSON.stringify(r))
ok('…and nothing is marked: not handled, not read', storePatches.length === 0 && gmailCalls.length === 0)
calFail = false
r = await act('accepted'); await p.waitForTimeout(1000)
const cal = calCalls.at(-1)
ok('RSVP is a real PATCH to Google Calendar with the guest\'s answer on the event', r.ok && !!cal && cal.body.attendees?.find(a => a.self)?.responseStatus === 'accepted', JSON.stringify(cal?.body))
ok('…which tells the organiser (sendUpdates=all)', /sendUpdates=all/.test(cal?.url ?? ''))
ok('…then marks the thread handled for every screen', storePatches.some(x => x.tid === 'tD' && x.body.handled_at))
ok('…and marks it read in Gmail', gmailCalls.some(c => /\/threads\/tD\/modify$/.test(c.path) && c.body.removeLabelIds?.includes('UNREAD')))
n = await needs()
ok('an answered invitation is no longer "worth knowing" to the assistant either', !JSON.stringify(n.attention.map(x => x.thread_id)).includes('tD'), JSON.stringify(n.attention.map(x => x.thread_id)))

// ── the Mail page agrees ────────────────────────────────────────────────────
const p2 = await ctx.newPage(); await go('inbox')
p2.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p2.addInitScript(() => { try { localStorage.setItem('mail-smart-view', 'action') } catch {} })
await p2.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(5000)
const mt = await p2.locator('body').innerText()
ok('the Mail page also shows no action left (A archived, B handled, C archived) and not the handled D', !/Answer A please|Handled B|Archived C/.test(mt), mt.slice(0, 0))

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close(); process.exit(fails ? 1 : 0)
