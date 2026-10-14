// node scripts/bots-as-assistant.mjs
//
// The Telegram bot and Siri are the app's assistant too: the same consent policy, the same new abilities.
// Nothing here can reach Telegram, Anthropic or a real database, so every claim is read off what the
// real code DID against a database that is able to refuse — and the bots' own handlers are lifted out of
// the real files (there is no Deno here), so what is tested is what is deployed.
//
// What is asserted, and the control for each:
//  - an outward / destructive / money act is parked, NOT run — and with the table missing it still is not run
//  - an approval runs the act once; a second tap, the wrong person, the wrong chat, an expired one, do nothing
//  - Siri: a bare "yes" approves the latest question; "yes, send it to Ahmed instead" is a new request
//  - the new tools act on the caller's own rows only, and obey the Library's two switches
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const kit = await import('../supabase/functions/_shared/botKit.ts')
const gate = await import('../supabase/functions/_shared/assistantGate.ts')
const guide = await import('../supabase/functions/_shared/appGuide.ts')

// ── a small database that can refuse ─────────────────────────────────────────
function makeDb({ tables = {}, missing = [], rpc = {} } = {}) {
  const db = { tables, calls: [] }
  for (const t of ['assistant_pending_actions', 'habits', 'library_books', 'library_quotes', 'library_sessions', 'mail_smart_threads', 'users']) tables[t] ??= []
  db.rpc = async (fn, args) => ({ data: rpc[fn] ? rpc[fn](args) : null, error: null })
  db.from = (t) => {
    const gone = missing.includes(t)
    const q = { op: 'select', filters: [], row: null, patch: null }
    const rows = () => (tables[t] ?? [])
    const match = r => q.filters.every(f => f(r))
    const run = () => {
      if (gone) return { data: null, error: { code: '42P01', message: `relation "${t}" does not exist` } }
      if (q.op === 'insert') {
        const r = { ...q.row }
        if (t === 'assistant_pending_actions') { r.created_at ??= new Date().toISOString(); r.expires_at ??= new Date(Date.now() + 6e5).toISOString() }
        if (t === 'library_books' && !['want', 'reading', 'finished', 'paused', 'abandoned'].includes(r.status)) return { data: null, error: { message: 'check constraint: status' } }
        if (t === 'library_sessions' && !(r.minutes >= 1 && r.minutes <= 1440)) return { data: null, error: { message: 'check constraint: minutes' } }
        r.id ??= crypto.randomUUID()
        tables[t].push(r)
        return { data: [r], error: null }
      }
      if (q.op === 'delete') { const hit = rows().filter(match); tables[t] = rows().filter(r => !match(r)); return { data: hit, error: null } }
      if (q.op === 'update') { const hit = rows().filter(match); hit.forEach(r => Object.assign(r, q.patch)); return { data: hit, error: null } }
      let out = rows().filter(match)
      if (q.order) out = [...out].sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1))
      if (q.lim) out = out.slice(0, q.lim)
      return { data: out, error: null }
    }
    const b = {
      select() { return b }, insert(r) { q.op = 'insert'; q.row = r; return b }, delete() { q.op = 'delete'; return b },
      update(p) { q.op = 'update'; q.patch = p; return b },
      eq(k, v) { q.filters.push(r => r[k] === v); return b }, gt(k, v) { q.filters.push(r => r[k] > v); return b },
      gte(k, v) { q.filters.push(r => r[k] >= v); return b },
      order(k) { q.order = k; return b }, limit(n) { q.lim = n; return b },
      single() { const r = run(); return Promise.resolve(r.error ? r : { data: r.data[0], error: null }) },
      maybeSingle() { const r = run(); return Promise.resolve(r.error ? r : { data: r.data[0] ?? null, error: null }) },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return b
  }
  return db
}
const pending = db => db.tables.assistant_pending_actions
const U = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const TG = { userId: U, channel: 'telegram', chatId: '555' }
const SIRI = { userId: U, channel: 'siri' }

// ── 0. every file that changed still parses ──────────────────────────────────
const FILES = ['supabase/functions/telegram-bot/index.ts', 'supabase/functions/professor-siri/index.ts',
  'supabase/functions/_shared/botKit.ts', 'supabase/functions/_shared/assistantGate.ts', 'supabase/functions/_shared/appGuide.ts']
for (const f of FILES) {
  const d = ts.transpileModule(readFileSync(f, 'utf8'), { reportDiagnostics: true, compilerOptions: { target: 99, module: 99 } }).diagnostics ?? []
  ok(`${f.split('/').slice(-2).join('/')} parses`, d.length === 0, d.map(x => ts.flattenDiagnosticMessageText(x.messageText, ' ')).slice(0, 2).join(' | '))
}

// ── 1. the policy ────────────────────────────────────────────────────────────
for (const [n, i] of [['reply_email', { message_id: 'm', text: 'hi' }], ['add_transaction', { amount: 5 }], ['delete_habit', { habit: 'x' }],
  ['library_delete_book', { book: 'x' }], ['send_email', {}], ['rsvp_invitation', {}]]) {
  ok(`gated: ${n}`, gate.approvalFor(n, i) !== null)
}
for (const n of ['log_habit', 'get_habits', 'create_habit', 'update_habit', 'library_add_book', 'library_update_book', 'library_log_reading', 'library_add_quote', 'mail_needs', 'app_guide', 'archive_email', 'add_task'])
  ok(`not gated: ${n}`, gate.approvalFor(n, {}) === null)
ok('the model saying confirm:true does not lift the gate', gate.approvalFor('reply_email', { message_id: 'm', text: 'hi', confirm: true }) !== null)
ok('the approval shows the call\'s real arguments', gate.approvalFor('reply_email', { message_id: 'm', text: 'I will attend' }).lines.some(l => l.value === 'I will attend'))

// ── 2. the gate parks, and the tool does not run ─────────────────────────────
{
  const db = makeDb(); const parked = []
  const ran = []
  const told = await kit.gateCall(db, TG, 'reply_email', { message_id: 'm1', text: 'Yes, I will attend' }, parked)
  ok('a reply is parked, not run', typeof told === 'string' && /WAITING/.test(told) && parked.length === 1 && pending(db).length === 1)
  ok('the parked row is the caller\'s, on Telegram, in this chat, with the real arguments',
    pending(db)[0].user_id === U && pending(db)[0].channel === 'telegram' && pending(db)[0].chat_id === '555' && pending(db)[0].input.text === 'Yes, I will attend')
  ok('the model is told not to claim it is done', /Do NOT say it is done/.test(told))
  ok('an ordinary tool passes straight through the gate', (await kit.gateCall(db, TG, 'log_habit', {}, parked)) === null && pending(db).length === 1)

  // control: the table is missing → the act must NOT happen
  const broken = makeDb({ missing: ['assistant_pending_actions'] }); const p2 = []
  const r = await kit.gateCall(broken, TG, 'add_transaction', { amount: 99, payee: 'x' }, p2)
  ok('table missing: fails CLOSED (nothing parked, told NOT DONE)', /NOT DONE/.test(r) && p2.length === 0)
}

// ── 3. approving: once, and only by the right person ─────────────────────────
async function park(db, ctx, tool = 'reply_email', input = { message_id: 'm', text: 'hi' }) {
  const p = []; await kit.gateCall(db, ctx, tool, input, p); return p[0].id
}
{
  const db = makeDb(); const id = await park(db, TG)
  ok('wrong user cannot take it', (await kit.takeAction(db, id, { ...TG, userId: OTHER })) === null && pending(db).length === 1)
  ok('wrong channel cannot take it', (await kit.takeAction(db, id, { ...TG, channel: 'siri' })) === null && pending(db).length === 1)
  ok('wrong chat cannot take it', (await kit.takeAction(db, id, { ...TG, chatId: '999' })) === null && pending(db).length === 1)
  const row = await kit.takeAction(db, id, TG)
  ok('the right person takes it', row?.tool === 'reply_email' && row.input.text === 'hi')
  ok('and only once: a second tap finds nothing', (await kit.takeAction(db, id, TG)) === null)

  const id2 = await park(db, TG); pending(db)[0].expires_at = new Date(Date.now() - 1000).toISOString()
  ok('an expired act cannot be approved', (await kit.takeAction(db, id2, TG)) === null)
}

// ── 4. the real Telegram handler, lifted out of the file ─────────────────────
function lift(file, names, stubs) {
  const src = readFileSync(file, 'utf8')
  let code = ''
  for (const n of names) {
    const i = src.search(new RegExp(`(async )?function ${n}\\(`))
    if (i < 0) throw new Error(`${n} not found in ${file}`)
    const j = src.indexOf('\n}\n', i)
    code += src.slice(i, j + 3)
  }
  const js = ts.transpileModule(code, { compilerOptions: { target: 99, module: 99 } }).outputText
  return new Function(...Object.keys(stubs), `${js}\nreturn { ${names.join(', ')} }`)(...Object.values(stubs))
}
{
  const db = makeDb(); const sent = []; const ran = []; const said = []
  const stubs = {
    sb: db, takeAction: kit.takeAction, approvalText: kit.approvalText,
    tg: async (m, b) => { sent.push([m, b]); return true },
    resolveChat: async (c) => (c === 555 ? { userId: U } : null),
    dispatchTool: async (u, t, i) => { ran.push([u, t, i]); return 'Reply sent to Ahmed.' },
    rememberExchange: async (...a) => { said.push(a) },
  }
  const { handleApproval, sendApprovalCard } = lift('supabase/functions/telegram-bot/index.ts', ['sendApprovalCard', 'handleApproval'], stubs)

  const id = await park(db, TG)
  await sendApprovalCard(555, { id, approval: gate.approvalFor('reply_email', { message_id: 'm', text: 'hi' }), tool: 'reply_email' })
  const card = sent.find(s => s[0] === 'sendMessage')[1]
  const btns = card.reply_markup.inline_keyboard[0]
  ok('the card has Approve and Not now, carrying the id', btns.length === 2 && btns[0].callback_data === `ap:${id}` && btns[1].callback_data === `no:${id}`)
  ok('callback data fits Telegram\'s 64-byte limit', btns.every(b => Buffer.byteLength(b.callback_data) <= 64))
  ok('the card shows what will be sent', /hi/.test(card.text) && /Send a reply/.test(card.text))

  const cq = (data, chat = 555) => ({ id: 'cb1', data, message: { message_id: 7, chat: { id: chat } } })
  await handleApproval(cq(`no:${id}`))
  ok('Not now: nothing is run', ran.length === 0 && pending(db).length === 0)

  const id2 = await park(db, TG)
  await handleApproval(cq(`ap:${id2}`))
  ok('Approve: runs the act once, with the stored arguments, as the linked user', ran.length === 1 && ran[0][0] === U && ran[0][1] === 'reply_email' && ran[0][2].text === 'hi')
  ok('and the message is edited to say it was done, buttons removed', sent.some(s => s[0] === 'editMessageText' && /✅/.test(s[1].text) && s[1].reply_markup.inline_keyboard.length === 0))
  await handleApproval(cq(`ap:${id2}`))
  ok('a second tap on the same button does nothing', ran.length === 1)

  const id3 = await park(db, TG)
  await handleApproval(cq(`ap:${id3}`, 777))
  ok('a tap from a chat that is not linked does nothing', ran.length === 1 && pending(db).length === 1)
  await handleApproval({ id: 'x', data: 'ap:not-a-uuid', message: { message_id: 1, chat: { id: 555 } } })
  await handleApproval({ id: 'x', data: `ap:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`, message: { message_id: 1, chat: { id: 555 } } })
  ok('junk and unknown ids do nothing', ran.length === 1)
  ok('what was decided is remembered for the conversation', said.length >= 2)
}

// ── 5. the real Siri handler ─────────────────────────────────────────────────
{
  const db = makeDb(); const ran = []; const agentCalls = []
  let agentParks = null
  const stubs = {
    sb: db, parseYesNo: kit.parseYesNo, latestPendingId: kit.latestPendingId, takeAction: kit.takeAction, approvalSpoken: kit.approvalSpoken,
    resolveToken: async () => U, extractText: async (req) => req.__text, ok: (t) => t,
    dispatchTool: async (u, t, i) => { ran.push([u, t, i]); return 'Reply sent.' },
    runAgent: async (u, text, ctx, parked) => { agentCalls.push(text); if (agentParks) { await kit.gateCall(db, ctx, agentParks[0], agentParks[1], parked); return 'Done!' } return 'plain answer' },
    Deno: { serve: (h) => { stubs.__h = h } },
  }
  // lift the whole Deno.serve(...) block
  const src = readFileSync('supabase/functions/professor-siri/index.ts', 'utf8')
  const i = src.indexOf('Deno.serve(')
  const js = ts.transpileModule(src.slice(i), { compilerOptions: { target: 99, module: 99 } }).outputText
  let handler
  new Function(...Object.keys(stubs), 'Response', `${js.replace('Deno.serve(', 'globalThis.__siri = (')}`)(...Object.values(stubs), Response)
  handler = globalThis.__siri
  const say = async (text) => handler({ method: 'POST', __text: text })

  agentParks = ['reply_email', { message_id: 'm9', text: 'I will attend' }]
  const q = await say('reply to Ahmed saying I will attend')
  ok('Siri asks, from the real arguments, and does not claim it is done', /Send a reply/.test(q) && /I will attend/.test(q) && /yes/i.test(q) && !/Done!/.test(q) && ran.length === 0)
  ok('exactly one question is open', pending(db).length === 1 && pending(db)[0].channel === 'siri')

  agentParks = null
  const longer = await say('yes send it to Ahmed instead')
  ok('"yes, send it to Ahmed instead" is a NEW request, not an approval', agentCalls.at(-1) === 'yes send it to Ahmed instead' && ran.length === 0 && pending(db).length === 1)

  ok('a bare "yes" approves the open question', (await say('Yes.')) === 'Reply sent.' && ran.length === 1 && ran[0][2].text === 'I will attend')
  ok('a second "yes" does nothing more', ran.length === 1 && pending(db).length === 0)

  agentParks = ['add_transaction', { amount: 200, payee: 'lunch' }]
  await say('spent 200 on lunch')
  agentParks = null
  ok('"no" cancels and runs nothing', /did not do it/.test(await say('no')) && ran.length === 1 && pending(db).length === 0)

  agentParks = ['add_transaction', { amount: 1, payee: 'a' }]
  await say('spent 1'); pending(db)[0].expires_at = new Date(Date.now() - 1000).toISOString(); agentParks = null
  await say('yes')
  ok('a "yes" after the question expired runs nothing', ran.length === 1)

  // control for the whole mechanism: a bare yes with nothing open goes to the agent, never to a tool
  const before = agentCalls.length
  await say('yes')
  ok('"yes" with nothing open reaches the agent and runs nothing', agentCalls.length === before + 1 && ran.length === 1)

  // two gated acts in one spoken turn: one question only
  const p = []
  const [a, b] = await Promise.all([
    kit.gateCall(db, SIRI, 'reply_email', { message_id: 'a', text: 'one' }, p),
    kit.gateCall(db, SIRI, 'add_transaction', { amount: 2 }, p),
  ])
  ok('two gated acts at once by voice: one is asked, the other is refused', p.length === 1 && [a, b].filter(x => /NOT DONE/.test(x)).length === 1 && pending(db).filter(r => r.channel === 'siri').length === 1)
}

// ── 6. yes / no ──────────────────────────────────────────────────────────────
for (const t of ['yes', 'Yes.', 'yes please', 'OK', 'go ahead', 'do it', 'send it', 'نعم', 'تمام', 'موافق']) ok(`yes: ${t}`, kit.parseYesNo(t) === 'yes')
for (const t of ['no', 'No!', 'cancel', 'never mind', "don't", 'not now', 'لا', 'الغي']) ok(`no: ${t}`, kit.parseYesNo(t) === 'no')
for (const t of ['yes send it to Ahmed instead', 'what is on today', 'no wait add milk to the list', 'yesterday', 'okay so what about tomorrow', '']) ok(`neither: "${t}"`, kit.parseYesNo(t) === null)

// ── 7. the new tools ─────────────────────────────────────────────────────────
const TODAY = '2026-10-14'
const run = (db, name, a) => kit.runKitTool(db, U, name, a, TODAY)
{
  ok('every kit tool has a name, a description and a schema', kit.KIT_TOOLS.every(t => t.name && t.description && t.input_schema.type === 'object'))
  ok('no kit tool name collides with a name the bots already had', !kit.KIT_TOOLS.some(t => ['get_today', 'add_task', 'log_habit', 'get_habits', 'reply_email'].includes(t.name)))
  ok('an unknown name is not a kit tool', (await run(makeDb(), 'get_today', {})) === null)

  // app guide
  const g = await run(makeDb(), 'app_guide', { topic: 'library' })
  ok('app_guide answers from the shared guide', g.includes(guide.APP_GUIDE.library.title) && g.includes(guide.APP_GUIDE.library.where))
  ok('an unknown topic says it does not know instead of inventing', /no entry/.test(await run(makeDb(), 'app_guide', { topic: 'quantum' })))
  ok('no topic lists the topics', /overview/.test(await run(makeDb(), 'app_guide', {})))

  // habits
  const db = makeDb()
  ok('create a habit', /created/.test(await run(db, 'create_habit', { name: 'Read' })) && db.tables.habits[0].user_id === U && db.tables.habits[0].frequency === 'daily')
  ok('a duplicate name is refused', /already have/.test(await run(db, 'create_habit', { name: ' read ' })) && db.tables.habits.length === 1)
  ok('a counted habit needs a goal', /goal above zero/.test(await run(db, 'create_habit', { name: 'Water', type: 'quantity' })) && db.tables.habits.length === 1)
  ok('a counted habit with a goal', /created/.test(await run(db, 'create_habit', { name: 'Water', type: 'quantity', goal: 8, unit: 'glasses' })) && db.tables.habits[1].goal === 8)
  ok('update by name (not id)', /updated/.test(await run(db, 'update_habit', { habit: 'wat', goal: 10 })) && db.tables.habits[1].goal === 10)
  ok('pause', /updated/.test(await run(db, 'update_habit', { habit: 'read', active: false })) && db.tables.habits[0].is_active === false)
  db.tables.habits.push({ id: 'x', user_id: OTHER, name: 'Water ball', is_active: true })
  ok('another person\'s habit is never matched', /updated/.test(await run(db, 'update_habit', { habit: 'water', goal: 12 })) && db.tables.habits[2].goal === undefined)
  ok('delete removes only the caller\'s', /deleted/.test(await run(db, 'delete_habit', { habit: 'water' })) && db.tables.habits.length === 2 && db.tables.habits.some(h => h.user_id === OTHER))
  ok('an unknown habit is said, not guessed', /No habit/.test(await run(db, 'delete_habit', { habit: 'zzz' })))

  // mail
  const hr = (h) => new Date(Date.now() - h * 36e5).toISOString()
  const row = (o) => ({ user_id: U, account_email: 'me@x.com', thread_id: 't', subject: 's', from_name: 'F', from_email: 'f@x.com', last_at: hr(2), section: 'action', need: '', muted: false, archived_at: null, handled_at: null, ...o })
  const mdb = makeDb({ tables: { mail_smart_threads: [
    row({ thread_id: 'act', subject: 'Renewal', need: 'approve the renewal' }),
    row({ thread_id: 'att', subject: 'FYI', section: 'attention' }),
    row({ thread_id: 'arch', archived_at: hr(1) }),                         // archived after the last message → hidden
    row({ thread_id: 'reply', archived_at: hr(5), last_at: hr(3) }),        // a reply came after the archive → back
    row({ thread_id: 'mute', muted: true }),
    row({ thread_id: 'done', handled_at: hr(1) }),                          // handled → FYI, in neither list
    row({ thread_id: 'old', last_at: hr(24 * 40) }),                        // outside the 30-day window
    row({ thread_id: 'theirs', user_id: OTHER }),
  ] } })
  const m = await run(mdb, 'mail_needs', {})
  const has = id => m.includes(`[thread ${id}]`)
  ok('mail_needs lists an action and an attention thread, with what is wanted', has('act') && has('att') && /approve the renewal/.test(m))
  ok('archived, muted, handled, old and other people\'s threads are not listed', !has('arch') && !has('mute') && !has('done') && !has('old') && !has('theirs'))
  ok('a reply after an archive brings the thread back (the Mail page\'s rule)', has('reply'))
  ok('counts are honest', /Needs an answer or decision \(2\)/.test(m) && /nothing to answer \(1\)/.test(m))
  ok('the store missing is said, not "nothing"', /could not read/.test(await run(makeDb({ missing: ['mail_smart_threads'] }), 'mail_needs', {})))

  // library
  const lib = (extra = {}) => makeDb({ rpc: { has_module: () => true }, ...extra })
  const off = makeDb({ rpc: { has_module: () => false } })
  ok('Library off by plan: refused', /switched off/.test(await run(off, 'library_overview', {})))
  const pref = lib(); pref.tables.users.push({ id: U, schedule_rules: { shared_prefs: { 'library-settings': JSON.stringify({ enabled: false }) } } })
  ok('Library off by the person\'s own switch: refused', /switched off/.test(await run(pref, 'library_overview', {})))
  ok('the rpc failing is off, not on', /switched off/.test(await run({ ...makeDb(), rpc: async () => { throw new Error('down') } }, 'library_overview', {})))

  const L = lib()
  ok('add a book by hand', /Added "Dune"/.test(await run(L, 'library_add_book', { title: 'Dune', author: 'Frank Herbert', pages: 600 })) && L.tables.library_books[0].user_id === U && L.tables.library_books[0].status === 'want')
  ok('a duplicate is refused', /already on the shelf/.test(await run(L, 'library_add_book', { title: 'dune' })) && L.tables.library_books.length === 1)
  ok('a bad status never reaches the table', /one of/.test(await run(L, 'library_update_book', { book: 'dune', status: 'liked' })))
  ok('the first sitting starts the book and logs new ground', /Progress: page 120 of 600 \(20%\)/.test(await run(L, 'library_log_reading', { book: 'dune', minutes: 30, to_page: 120 })) && L.tables.library_books[0].status === 'reading' && L.tables.library_books[0].started_on === TODAY && L.tables.library_sessions[0].pages === 120)
  await run(L, 'library_log_reading', { book: 'dune', minutes: 20, to_page: 100 })
  ok('re-reading earlier pages is time, not progress', L.tables.library_sessions[1].pages === 0 && /page 120/.test(await run(L, 'library_log_reading', { book: 'dune', minutes: 5 })))
  ok('minutes outside 1–1440 are refused before the table', /between 1 and 1440/.test(await run(L, 'library_log_reading', { book: 'dune', minutes: 0 })) && L.tables.library_sessions.length === 3)
  ok('a future day is refused', /not happened/.test(await run(L, 'library_log_reading', { book: 'dune', minutes: 5, date: '2026-12-01' })))
  ok('a page past the end is refused naming the length', /between 0 and 600/.test(await run(L, 'library_log_reading', { book: 'dune', minutes: 5, to_page: 900 })))
  ok('finishing stamps the day; the last page only offers it', /finished|Updated/.test(await run(L, 'library_update_book', { book: 'dune', status: 'finished', rating: 5 })) && L.tables.library_books[0].finished_on === TODAY && L.tables.library_books[0].rating === 5)
  await run(L, 'library_update_book', { book: 'dune', status: 'reading' })
  ok('coming off finished clears the finish date (the app\'s rule)', L.tables.library_books[0].finished_on === null)
  ok('a rating of 7 is refused', /0 to 5/.test(await run(L, 'library_update_book', { book: 'dune', rating: 7 })))
  ok('a quote is saved with its page', /Saved the quote/.test(await run(L, 'library_add_quote', { book: 'dune', text: 'Fear is the mind-killer.', page: 8 })) && L.tables.library_quotes[0].page === 8)
  ok('overview and find', /1 books/.test(await run(L, 'library_overview', {})) && /Dune/.test(await run(L, 'library_find_books', { query: 'herbert' })))
  L.tables.library_books.push({ id: 'o', user_id: OTHER, title: 'Dune Messiah', authors: [], status: 'want', rating: 0, shelf_order: 0 })
  ok('another person\'s books are never seen', !/Messiah/.test(await run(L, 'library_find_books', { query: 'dune' })))
  L.tables.library_books.push({ id: 'o2', user_id: U, title: 'Dune Messiah', authors: [], status: 'want', rating: 0, shelf_order: 1 })
  ok('a partial that matches two books asks which, and changes nothing', /Several/.test(await run(L, 'library_log_reading', { book: 'du', minutes: 5 })) && L.tables.library_sessions.length === 3)
  ok('delete removes only the named, own book', /Removed "Dune Messiah"/.test(await run(L, 'library_delete_book', { book: 'dune messiah' })) && L.tables.library_books.some(b => b.id === 'o') && !L.tables.library_books.some(b => b.id === 'o2'))
  ok('Library tables not migrated is said plainly', /has not been set up/.test(await run(lib({ missing: ['library_books'] }), 'library_overview', {})))
}

// ── 8. one policy, three assistants ─────────────────────────────────────────
{
  const app = readFileSync('src/lib/assistantPolicy.ts', 'utf8')
  ok('the app imports the very same policy file', /_shared\/assistantGate\.ts/.test(app) && !/new Set\(/.test(app))
  const appGuideSrc = readFileSync('src/lib/appGuide.ts', 'utf8')
  ok('the app imports the very same guide', /_shared\/appGuide\.ts/.test(appGuideSrc) && !/APP_GUIDE: Record/.test(appGuideSrc))
  for (const f of ['supabase/functions/telegram-bot/index.ts', 'supabase/functions/professor-siri/index.ts']) {
    const s = readFileSync(f, 'utf8')
    ok(`${f.split('/')[2]}: every tool call passes through gateCall`, /gateCall\(sb, gate, tu\.name!/.test(s) && (s.match(/dispatchTool\(userId, tu\.name!/g) ?? []).length === 1)
    ok(`${f.split('/')[2]}: the new tools and the rules are in the request and the prompt`, /\.\.\.KIT_TOOLS/.test(s) && /\$\{KIT_RULES\}/.test(s))
    ok(`${f.split('/')[2]}: an unknown name falls through to the kit`, /runKitTool\(sb, userId, name, args/.test(s))
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
