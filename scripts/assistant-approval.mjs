// node scripts/assistant-approval.mjs   — needs a dev server on 5199
//
// The assistant acts as the signed-in person, on their own data. That is its scope. What it may do on its
// own say-so is another question, and the answer is: not anything other people see, anything that cannot
// be undone, or anything that moves money. Those wait for a click — enforced between the model's request
// and the tool, so it holds whatever the model says. Gmail is faked and RECORDS what is sent; the model is
// faked and asks for the action. Every claim is read off what reached Gmail.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { approvalFor, DECLINED } from '../src/lib/assistantPolicy.ts'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── the policy as a table ────────────────────────────────────────────────────
const kinds = n => approvalFor(n, { x: 1 })?.kind ?? null
ok('mail, replies and RSVPs are outward', ['send_email', 'reply_to_email', 'rsvp_invitation'].every(n => kinds(n) === 'outward'))
ok('every delete and remove is destructive, whatever it is called', ['delete_task', 'delete_calendar_event', 'delete_transaction', 'remove_budget_envelope', 'delete_book', 'delete_habit', 'library_delete_book'].every(n => kinds(n) === 'destructive'))
ok('writes to the ledger are money', ['add_transaction', 'update_transaction', 'set_transaction_paid', 'add_goal', 'update_goal', 'set_exchange_rate', 'set_budget_envelope'].every(n => kinds(n) === 'money'))
ok('reading, and ordinary edits of your own things, ask nothing', ['list_emails', 'mail_needs', 'list_tasks', 'create_task', 'update_task', 'complete_task', 'list_calendar_events', 'create_calendar_event', 'log_habit_completion', 'archive_email', 'finance_overview', 'add_shopping_item'].every(n => kinds(n) === null))
const a = approvalFor('send_email', { to: 'x@y.com', subject: 'Hi', body: 'B'.repeat(500), confirm: true, empty: '' })
ok('what is shown is the call\'s own arguments — real values, long ones clipped, "confirm" and blanks left out', a.lines.some(l => l.label === 'to' && l.value === 'x@y.com') && a.lines.find(l => l.label === 'body').value.length <= 221 && !a.lines.some(l => l.label === 'confirm' || l.label === 'empty'))
ok('a refusal tells the model not to retry or find another way', DECLINED.declined === true && /not approve/.test(DECLINED.message) && /Do not try it again/.test(DECLINED.message))

// ── in the browser ───────────────────────────────────────────────────────────
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`
const head = ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-6', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
const textTurn = t => head + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }) + ev('content_block_stop', { type: 'content_block_stop', index: 0 }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) + ev('message_stop', { type: 'message_stop' })
const toolTurn = (name, input) => head + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } }) + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }) + ev('content_block_stop', { type: 'content_block_stop', index: 0 }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }) + ev('message_stop', { type: 'message_stop' })

let wants = { name: 'send_email', input: { to: 'boss@x.com', subject: 'Report', body: 'Attached.' } }
let sent = [], toolResults = []
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function launch() {
  sent = []; toolResults = []
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.route('**://placeholder.supabase.co/**', r => { const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(user); if (u.pathname.startsWith('/auth/v1/token')) return j(session); return j(u.pathname.startsWith('/auth') ? {} : []) })
  await ctx.route('https://api.anthropic.com/**', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const body = JSON.parse(r.request().postData() || '{}')
    if (!body.tools?.length) return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: textTurn('ok') })
    const last = body.messages.at(-1)
    const tr = Array.isArray(last.content) ? last.content.find(c => c.type === 'tool_result') : null
    if (tr) { toolResults.push(String(tr.content)); return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: textTurn('Finished.') }) }
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: toolTurn(wants.name, wants.input) }) })
  await ctx.route('**://gmail.googleapis.com/**', r => { const q = r.request(); if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (/messages\/send$/.test(new URL(q.url()).pathname)) { sent.push(JSON.parse(q.postData() || '{}')); return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"id":"sent1"}' }) }
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' }) })
  await ctx.addInitScript(s => { try { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test' }))
    localStorage.setItem('assistant-persona', JSON.stringify({ name: 'Beau', asked: true })) } catch {} }, session)
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(1500)
  await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(600)
  return { p, ctx }
}
const say = async (p, t) => { const box = p.locator('[data-assistant-window] textarea').first(); await box.fill(t); await box.press('Enter') }
const card = p => p.locator('[role="group"][aria-label="Approval needed"]')

// approve
let { p, ctx } = await launch()
await say(p, 'send the report to my boss'); await card(p).waitFor({ timeout: 10000 })
ok('the card names what will happen and shows the real arguments', /Send an email/.test(await card(p).innerText()) && /boss@x\.com/.test(await card(p).innerText()) && /Report/.test(await card(p).innerText()))
await p.waitForTimeout(1200)
ok('nothing has been sent while it waits — Gmail has seen no send', sent.length === 0)
ok('the card is drawn inside the assistant, in tokens, with both answers on it', await card(p).getByRole('button', { name: 'Approve' }).count() === 1 && await card(p).getByRole('button', { name: 'Not now' }).count() === 1)
await card(p).getByRole('button', { name: 'Approve' }).click(); await p.waitForTimeout(2500)
ok('approving sends exactly one message', sent.length === 1, JSON.stringify(sent.map(s => Object.keys(s))))
ok('the model is told it worked, and the card is gone', toolResults.length === 1 && !/did not approve/.test(toolResults[0]) && await card(p).count() === 0, toolResults[0])
await ctx.close()

// decline
;({ p, ctx } = await launch())
await say(p, 'send the report to my boss'); await card(p).waitFor({ timeout: 10000 })
await card(p).getByRole('button', { name: 'Not now' }).click(); await p.waitForTimeout(2500)
ok('declining sends nothing', sent.length === 0)
ok('the model is told the person did not approve, and not to retry', toolResults.length === 1 && /did not approve/.test(toolResults[0]) && /Do not try it again/.test(toolResults[0]), toolResults[0])
ok('and the thread says Finished, so the conversation goes on', /Finished\./.test(await p.locator('[data-assistant-window]').innerText()))
await ctx.close()

// destructive and money: asked, and a refusal does nothing
for (const [name, input, title] of [['delete_task', { task_id: 'abc' }, /Delete — task/], ['add_transaction', { amount: 20, description: 'Lunch' }, /Change your finances/]]) {
  wants = { name, input }
  ;({ p, ctx } = await launch())
  await say(p, 'do it'); await card(p).waitFor({ timeout: 10000 })
  ok(`${name} waits for a click: "${(await card(p).innerText()).split('\n')[0]}"`, title.test(await card(p).innerText()))
  await card(p).getByRole('button', { name: 'Not now' }).click(); await p.waitForTimeout(2000)
  ok(`${name} declined: the model is told, nothing ran`, /did not approve/.test(toolResults[0] ?? ''))
  await ctx.close()
}

// not gated: runs with no card
wants = { name: 'list_tasks', input: {} }
;({ p, ctx } = await launch())
await say(p, 'what is on my list'); await p.waitForTimeout(3500)
ok('a read asks nothing: no card, and the tool ran (the model got its result)', await card(p).count() === 0 && toolResults.length === 1 && !/did not approve/.test(toolResults[0]), toolResults[0]?.slice(0, 80))
await ctx.close()

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
