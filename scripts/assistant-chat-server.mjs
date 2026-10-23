// node scripts/assistant-chat-server.mjs
// The server half of the assistant turn (supabase/functions/_shared/assistantChat.ts),
// transpiled from the REAL file and run against a fake database that enforces the
// one-streaming-answer lock and a fake model that can stream, split a tool call's
// JSON across events, fail mid-stream, and refuse. Nothing is restated.
//
// Controls: with the lock removed from the fake, two simultaneous requests BOTH
// call the model (so the "busy" assertions can fail); a fake model that always
// succeeds would never exercise the error rows.
import ts from 'typescript'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../supabase/functions/_shared/assistantChat.ts', import.meta.url)
const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-'))
fs.writeFileSync(path.join(dir, 'ac.mjs'), js.outputText)
const M = await import(path.join(dir, 'ac.mjs'))

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !extra ? '' : '  → ' + extra)) }

// ── a database that can say no ──────────────────────────────────────────────
function makeDb({ lock = true } = {}) {
  const s = { rows: [], turn: null, nextId: 1, log: [], t: 1000 }
  const db = {
    s,
    async rows() { return s.rows.map(r => ({ ...r })) },
    async getTurn() { return s.turn ? JSON.parse(JSON.stringify(s.turn)) : null },
    async setTurn(_c, t) { s.log.push(t ? 'setTurn' : 'clearTurn'); s.turn = t ? JSON.parse(JSON.stringify(t)) : null },
    async startAnswer() {
      if (lock && s.rows.some(r => r.status === 'streaming')) return null
      const r = { id: s.nextId++, role: 'assistant', content: '', status: 'streaming', updated: s.t }
      s.rows.push(r); s.log.push('startAnswer'); return r.id
    },
    async updateAnswer(id, content) { const r = s.rows.find(x => x.id === id); r.content = content; r.writes = (r.writes ?? 0) + 1 },
    async finishAnswer(id, status, content, usage) { const r = s.rows.find(x => x.id === id); r.status = status; r.content = content; if (usage) r.usage = usage; s.log.push('finish:' + status) },
    async deleteRow(id) { s.rows = s.rows.filter(x => x.id !== id); s.log.push('deleteRow') },
    async addToolRows(_c, calls) { for (const c of calls) s.rows.push({ id: s.nextId++, role: 'tool', content: c.name, status: 'complete', tool: c.name, tool_state: 'running', tool_use_id: c.id, tool_input: c.input }); s.log.push('toolRows') },
    async toolRows(_c, ids) { return s.rows.filter(r => r.tool_use_id && ids.includes(r.tool_use_id)).map(r => ({ ...r })) },
    async sweepStale(_c, ms) { for (const r of s.rows) if (r.status === 'streaming' && s.t - (r.updated ?? 0) > ms) { r.status = 'error'; r.content = 'interrupted' } },
  }
  return db
}
const user = (db, text) => db.s.rows.push({ id: db.s.nextId++, role: 'user', content: text, status: 'complete' })

// ── a model that can stream, or fail ────────────────────────────────────────
const enc = new TextEncoder()
const sse = events => new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close() } })
const textStream = (...chunks) => [
  { type: 'message_start' }, { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  ...chunks.map(t => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
  { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
]
/** Put the numbers a provider reports into a stream: input at message_start, the running output total at message_delta. */
const withUsage = (events, u) => events.map(e => e.type === 'message_start'
  ? { ...e, message: { ...(e.message ?? {}), usage: { input_tokens: u.input, output_tokens: 1, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0 } } }
  : e.type === 'message_delta' ? { ...e, usage: { output_tokens: u.output } } : e)
const toolStream = (lead, id, name, jsonParts) => [
  { type: 'message_start' },
  ...(lead ? [{ type: 'content_block_start', index: 0, content_block: { type: 'text' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: lead } }, { type: 'content_block_stop', index: 0 }] : []),
  { type: 'content_block_start', index: lead ? 1 : 0, content_block: { type: 'tool_use', id, name } },
  ...jsonParts.map(p => ({ type: 'content_block_delta', index: lead ? 1 : 0, delta: { type: 'input_json_delta', partial_json: p } })),
  { type: 'content_block_stop', index: lead ? 1 : 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
]
function fakeFetch(replies) {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    const r = replies.shift()
    if (!r) throw new Error('the fake model was asked more than it was told to answer')
    if (r.status) return new Response(JSON.stringify({ error: { message: r.message } }), { status: r.status })
    if (r.groq) return new Response(JSON.stringify(r.groq), { status: 200 })
    return new Response(sse(r.events), { status: 200 })
  }
  f.calls = calls
  return f
}
const P = (db, over = {}) => ({ provider: 'anthropic', conversationId: 'c1', mode: 'turn', key: 'sk-ant-SECRET-1234', model: 'claude-x', system: 'SYS', tools: [{ name: 'list_habits' }], ...over })
let clock = 1000
const deps = (db, fetchFn) => ({ db, fetchFn, now: () => (clock += 1000) })

// 1 ── history
{
  const R = (id, role, content, status = 'complete') => ({ id, role, content, status })
  const rows = [R(1, 'user', 'a'), R(2, 'assistant', 'b'), R(3, 'tool', 'list_habits'), R(4, 'assistant', 'half', 'streaming'), R(5, 'error', 'boom'), R(6, 'assistant', 'oops', 'error'), R(7, 'user', 'c'), R(8, 'user', 'd')]
  const h = M.turnStart(rows)
  ok(JSON.stringify(h.map(m => m.role)) === '["user","assistant","user"]', 'history alternates and opens on the user', JSON.stringify(h))
  ok(h[2].content === 'c\n\nd', 'two user messages in a row are merged, not sent as two')
  ok(!h.some(m => /half|boom|oops|list_habits/.test(m.content)), 'tool chips, errors and a half-written answer are not history')
  const big = Array.from({ length: 60 }, (_, i) => R(i * 2 + 1, 'user', 'x'.repeat(900))).flatMap((u, i) => [u, R(u.id + 1, 'assistant', 'y'.repeat(900))])
  big.push(R(999, 'user', 'now'))
  const w = M.turnStart(big)
  ok(w.length <= 21 && w.reduce((n, m) => n + m.content.length, 0) < 14000 && w[w.length - 1].content === 'now' && w[0].role === 'user', 'the window is bounded and still ends on the question', `${w.length} msgs`)
  ok(M.turnStart([R(1, 'assistant', 'x')]).length === 0, 'no user message → nothing to answer')
}

// 2 ── a text answer streams into one row, then completes
{
  const db = makeDb(); user(db, 'hello')
  const f = fakeFetch([{ events: textStream('Hel', 'lo ', 'there', '!') }])
  const out = await M.runStep(deps(db, f), P(db))
  const a = db.s.rows.find(r => r.role === 'assistant')
  ok(out === 'done', 'a plain answer ends the turn', out)
  ok(a.status === 'complete' && a.content === 'Hello there!', 'the row ends complete with the whole text', JSON.stringify(a))
  ok(a.writes >= 1, `the row was written while streaming (${a.writes} write/s before the final)`)
  ok(db.s.turn === null, 'no turn state is left behind')
  const c = f.calls[0]
  ok(c.url.includes('api.anthropic.com') && c.headers['x-api-key'] === 'sk-ant-SECRET-1234' && c.body.stream === true, 'the request is a streamed Anthropic call with the key')
  ok(c.body.system === 'SYS' && c.body.tools[0].name === 'list_habits' && c.body.model === 'claude-x', 'the page\'s system prompt, tools and model are what was sent')
  ok(c.body.messages.length === 1 && c.body.messages[0].role === 'user' && c.body.messages[0].content === 'hello', 'the question went as the last user message')
}

// 3 ── a tool call is parked, not run, and the turn is saved BEFORE the row exists
{
  const db = makeDb(); user(db, 'what habits?')
  const f = fakeFetch([{ events: toolStream('Let me look.', 'toolu_1', 'list_habits', ['{"da', 'y":"to', 'day"}']) }])
  const out = await M.runStep(deps(db, f), P(db))
  const t = db.s.rows.find(r => r.role === 'tool')
  ok(out === 'tools', 'a tool request stops the step', out)
  ok(t && t.tool === 'list_habits' && t.tool_state === 'running' && t.tool_use_id === 'toolu_1', 'the call is parked as a running row')
  ok(JSON.stringify(t.tool_input) === '{"day":"today"}', 'input JSON split across events is reassembled', JSON.stringify(t.tool_input))
  ok(db.s.turn.pending[0] === 'toolu_1' && db.s.turn.steps === 1, 'the turn remembers what it is waiting for')
  ok(db.s.log.indexOf('setTurn') < db.s.log.indexOf('toolRows'), 'turn state is written before the row a device could act on')
  ok(db.s.rows.find(r => r.role === 'assistant').content === 'Let me look.' && db.s.rows.find(r => r.role === 'assistant').status === 'complete', 'the lead-in text stays, completed')
  const blocks = db.s.turn.msgs[1].content
  ok(blocks.length === 2 && blocks[0].type === 'text' && blocks[1].type === 'tool_use' && blocks[1].input.day === 'today', 'the saved assistant message has its blocks in order')

  // 4 ── continue: not ready, then ready
  const f2 = fakeFetch([{ events: textStream('You have 3.') }])
  ok(await M.runStep(deps(db, f2), P(db, { mode: 'continue' })) === 'not_ready' && f2.calls.length === 0, 'continuing before the tool has answered does nothing (and does not call the model)')
  t.tool_state = 'done'; t.tool_result = '[{"name":"Water"}]'
  const out2 = await M.runStep(deps(db, f2), P(db, { mode: 'continue' }))
  const sent = f2.calls[0].body.messages
  ok(out2 === 'done', 'once the result is in, the next step completes the turn', out2)
  ok(sent.length === 3 && sent[2].role === 'user' && sent[2].content[0].type === 'tool_result' && sent[2].content[0].tool_use_id === 'toolu_1' && sent[2].content[0].content === '[{"name":"Water"}]', 'the model gets the result as a tool_result for the same id')
  ok(sent[1].content[1].type === 'tool_use' && sent[1].content[1].id === 'toolu_1', 'the assistant tool_use it is answering is still there (exact fidelity)')
  ok(db.s.turn === null && db.s.rows.filter(r => r.role === 'assistant').pop().content === 'You have 3.', 'the turn is cleared and the final text is a new row')
  ok(await M.runStep(deps(db, f2), P(db, { mode: 'continue' })) === 'nothing', 'a second "continue" for a finished turn is a no-op')
}

// 4b ── a failed tool is reported as an error result
{
  const db = makeDb(); user(db, 'q')
  await M.runStep(deps(db, fakeFetch([{ events: toolStream('', 'toolu_9', 'delete_task', ['{}']) }])), P(db))
  const kept = db.s.rows.find(r => r.role === 'assistant')
  ok(kept && kept.status === 'complete' && kept.content === '', 'a step with no words keeps its (empty) answer row — it is where the tokens are counted')
  ok(M.turnStart([...db.s.rows, { id: 99, role: 'user', content: 'next', status: 'complete' }]).every(m => m.content.trim()), 'and an empty answer is never sent back to the model as history')
  const t = db.s.rows.find(r => r.role === 'tool'); t.tool_state = 'failed'; t.tool_result = 'DECLINED by the person'
  const f = fakeFetch([{ events: textStream('Okay, left it.') }])
  await M.runStep(deps(db, f), P(db, { mode: 'continue' }))
  const tr = f.calls[0].body.messages.at(-1).content[0]
  ok(tr.is_error === true && tr.content === 'DECLINED by the person', 'a declined / failed tool goes back as is_error with its text', JSON.stringify(tr))
}

// 4c ── two tools, answered out of order, come back in the order asked
{
  const db = makeDb(); user(db, 'q')
  const ev = [{ type: 'message_start' },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'A', name: 'one' } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'B', name: 'two' } }, { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } }]
  await M.runStep(deps(db, fakeFetch([{ events: ev }])), P(db))
  const [ta, tb] = db.s.rows.filter(r => r.role === 'tool')
  tb.tool_state = 'done'; tb.tool_result = '"b"'
  const f = fakeFetch([{ events: textStream('ok') }])
  ok(await M.runStep(deps(db, f), P(db, { mode: 'continue' })) === 'not_ready', 'with one of two tools still running, nothing continues')
  ta.tool_state = 'done'; ta.tool_result = '"a"'
  await M.runStep(deps(db, f), P(db, { mode: 'continue' }))
  const ids = f.calls[0].body.messages.at(-1).content.map(b => b.tool_use_id)
  ok(ids.join() === 'A,B', 'results are returned in the order the model asked', ids.join())
}

// 5 ── the lock: a second request while one is answering is turned away
{
  const run = async lock => {
    const db = makeDb({ lock }); user(db, 'hello')
    const f = fakeFetch([{ events: textStream('a') }, { events: textStream('b') }])
    const outs = await Promise.all([M.runStep(deps(db, f), P(db)), M.runStep(deps(db, f), P(db))])
    return { outs, calls: f.calls.length }
  }
  const real = await run(true)
  ok(real.calls === 1 && real.outs.includes('busy'), 'two simultaneous requests: one answers, one is "busy", the model is called once', JSON.stringify(real))
  const control = await run(false)
  ok(control.calls === 2, 'CONTROL: with the lock removed from the fake, both call the model', JSON.stringify(control))
}

// 6 ── a dead invocation's streaming row is swept so the conversation is not stuck
{
  const db = makeDb(); user(db, 'hello')
  db.s.rows.push({ id: 50, role: 'assistant', content: 'half an ans', status: 'streaming', updated: 1000 }); db.s.t = 1000 + M.STALE_MS + 1
  const f = fakeFetch([{ events: textStream('fresh') }])
  ok(await M.runStep(deps(db, f), P(db)) === 'done', 'a stale streaming row does not block the next answer')
  ok(db.s.rows.find(r => r.id === 50).status === 'error', 'the dead one is marked error')
  const db2 = makeDb(); user(db2, 'hello'); db2.s.rows.push({ id: 50, role: 'assistant', content: 'live', status: 'streaming', updated: db2.s.t })
  ok(await M.runStep(deps(db2, fakeFetch([])), P(db2)) === 'busy', 'CONTROL: a fresh streaming row still blocks')
}

// 7 ── the model refuses: the reason is on the screen, the lock is released
for (const [status, message, want] of [[401, 'invalid x-api-key', /refused the key.*1234.*Settings → AI/], [429, 'slow down', /rate-limiting/], [529, 'overloaded', /problem on its side/]]) {
  const db = makeDb(); user(db, 'hello')
  const out = await M.runStep(deps(db, fakeFetch([{ status, message }])), P(db))
  const a = db.s.rows.find(r => r.role === 'assistant')
  ok(out === 'error' && a.status === 'error' && want.test(a.content), `a ${status} becomes an error row that says what to do`, a?.content)
  ok(!a.content.includes('SECRET'), `…without leaking the key (${status})`)
  ok(!db.s.rows.some(r => r.status === 'streaming') && db.s.turn === null, `…and nothing is left streaming (${status})`)
}
{
  const db = makeDb(); user(db, 'hello')
  const f = fakeFetch([{ events: [{ type: 'message_start' }, { type: 'content_block_start', index: 0, content_block: { type: 'text' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial ' } }, { type: 'error', error: { message: 'Overloaded' } }] }])
  const out = await M.runStep(deps(db, f), P(db))
  const a = db.s.rows.find(r => r.role === 'assistant')
  ok(out === 'error' && a.status === 'error' && !db.s.rows.some(r => r.status === 'streaming'), 'an error event in the middle of a stream ends in an error row, not a stuck "streaming" one', JSON.stringify(a))
}
{
  const db = makeDb(); user(db, 'hello')
  const f = fakeFetch([{ events: [...textStream('cut'), { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }] }])
  await M.runStep(deps(db, f), P(db))
  ok(db.s.rows.find(r => r.role === 'assistant').content === 'cut …', 'an answer cut off by max_tokens is marked, not passed off as whole')
}
{
  const db = makeDb(); user(db, 'q'); db.s.turn = { provider: 'anthropic', msgs: [], pending: ['x'], steps: M.MAX_STEPS }
  db.s.rows.push({ id: 90, role: 'tool', content: 't', status: 'complete', tool: 't', tool_state: 'done', tool_use_id: 'x', tool_result: '1' })
  const out = await M.runStep(deps(db, fakeFetch([])), P(db, { mode: 'continue' }))
  ok(out === 'error' && /more steps than I will chain/.test(db.s.rows.find(r => r.role === 'assistant').content), 'a runaway tool loop is stopped with a sentence')
}

// 6b ── what it cost: the provider's own numbers, kept on the answer
{
  const db = makeDb(); user(db, 'hello')
  const f = fakeFetch([{ events: withUsage(textStream('Hi'), { input: 1234, output: 56, cacheRead: 1000, cacheWrite: 200 }) }])
  await M.runStep(deps(db, f), P(db))
  const a = db.s.rows.find(r => r.role === 'assistant')
  ok(a.usage && a.usage.input === 1234 && a.usage.output === 56 && a.usage.cacheRead === 1000 && a.usage.cacheWrite === 200, 'Anthropic: input from message_start, output from the running total in message_delta, cache tokens too', JSON.stringify(a.usage))
  ok(a.usage.model === 'claude-x' && a.usage.provider === 'anthropic', '…tagged with the model and provider that produced them (a conversation can change both)')
}
{
  const db = makeDb(); user(db, 'q')
  const f = fakeFetch([{ events: withUsage(toolStream('', 'toolu_u', 'list_habits', ['{}']), { input: 900, output: 30 }) }, { events: withUsage(textStream('done'), { input: 1000, output: 12 }) }])
  await M.runStep(deps(db, f), P(db))
  const t = db.s.rows.find(r => r.role === 'tool'); t.tool_state = 'done'; t.tool_result = '[]'
  await M.runStep(deps(db, f), P(db, { mode: 'continue' }))
  const rows = db.s.rows.filter(r => r.role === 'assistant')
  ok(rows.length === 2 && rows[0].usage.input === 900 && rows[1].usage.input === 1000, 'a tool loop is two requests and both are counted, each on its own row', JSON.stringify(rows.map(r => r.usage)))
  ok(rows.reduce((n, r) => n + r.usage.input + r.usage.output, 0) === 900 + 30 + 1000 + 12, 'the sum of the rows is exactly what the provider reported')
}
{
  const db = makeDb(); user(db, 'hi')
  const f = fakeFetch([{ groq: { choices: [{ finish_reason: 'stop', message: { content: 'yo' } }], usage: { prompt_tokens: 321, completion_tokens: 9, total_tokens: 330 } } }])
  await M.runStep(deps(db, f), P(db, { provider: 'groq', model: 'openai/gpt-oss-120b', key: 'gsk_1', tools: [] }))
  const a = db.s.rows.find(r => r.role === 'assistant')
  ok(a.usage?.input === 321 && a.usage.output === 9 && a.usage.provider === 'groq' && a.usage.model === 'openai/gpt-oss-120b', 'Groq: prompt_tokens and completion_tokens, tagged', JSON.stringify(a.usage))
}
{
  const db = makeDb(); user(db, 'hi')
  await M.runStep(deps(db, fakeFetch([{ status: 401, message: 'bad' }])), P(db))
  ok(db.s.rows.find(r => r.role === 'assistant').usage === undefined, 'CONTROL: a request that failed has no usage to record (nothing is invented)')
  const db2 = makeDb(); user(db2, 'hi')
  await M.runStep(deps(db2, fakeFetch([{ events: textStream('no numbers') }])), P(db2))
  const u = db2.s.rows.find(r => r.role === 'assistant').usage
  ok(u && u.input === 0 && u.output === 0, 'a provider that said nothing records zeros, not a guess', JSON.stringify(u))
}

// 7b ── the other two ways the chosen model stops working, each with its own sentence
for (const [status, message, want, label] of [
  [404, 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.', /cannot use the model “claude-x”.*Settings → AI/, 'a model the key cannot use'],
  [400, 'Your credit balance is too low to access the Anthropic API.', /out of credit or past its billing date.*Settings → AI/, 'an account out of credit'],
]) {
  const db = makeDb(); user(db, 'hello')
  const out = await M.runStep(deps(db, fakeFetch([{ status, message }])), P(db))
  const a = db.s.rows.find(r => r.role === 'assistant')
  ok(out === 'error' && want.test(a.content) && !/refused the key/.test(a.content), `${label} reads as that, not as a bad key`, a?.content)
}

// 8 ── Groq
{
  const db = makeDb(); user(db, 'hi')
  const f = fakeFetch([{ groq: { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'g1', type: 'function', function: { name: 'list_habits', arguments: '{"x":1}' } }] } }] } }])
  const out = await M.runStep(deps(db, f), P(db, { provider: 'groq', model: 'llama', key: 'gsk_abcd', tools: [{ type: 'function' }] }))
  ok(out === 'tools' && db.s.rows.find(r => r.role === 'tool').tool_input.x === 1, 'Groq: a tool call is parked the same way')
  ok(f.calls[0].url.includes('groq.com') && f.calls[0].headers.authorization === 'Bearer gsk_abcd' && f.calls[0].body.messages[0].role === 'system' && f.calls[0].body.messages[0].content === 'SYS', 'Groq: bearer key, system as the first message')
  const t = db.s.rows.find(r => r.role === 'tool'); t.tool_state = 'done'; t.tool_result = '[]'
  const f2 = fakeFetch([{ groq: { choices: [{ finish_reason: 'stop', message: { content: 'Nothing today.' } }] } }])
  const out2 = await M.runStep(deps(db, f2), P(db, { provider: 'groq', mode: 'continue', key: 'gsk_abcd' }))
  const sent = f2.calls[0].body.messages
  ok(out2 === 'done' && sent.at(-1).role === 'tool' && sent.at(-1).tool_call_id === 'g1' && sent.some(m => m.role === 'assistant' && m.tool_calls?.[0].id === 'g1'), 'Groq: the result goes back as a tool message after the assistant tool_calls')
  ok(db.s.rows.filter(r => r.role === 'assistant').pop().content === 'Nothing today.', 'Groq: the final text is saved')
}
{
  const db = makeDb(); user(db, 'hi')
  const out = await M.runStep(deps(db, fakeFetch([{ status: 401, message: 'Invalid API Key' }])), P(db, { provider: 'groq', key: 'gsk_wxyz' }))
  ok(out === 'error' && /Groq refused the key.*wxyz/.test(db.s.rows.find(r => r.role === 'assistant').content), 'Groq: a refused key names Groq and the last four')
}

// 8b ── switching provider mid-turn is refused with a sentence, not a 400
{
  const db = makeDb(); user(db, 'hi')
  await M.runStep(deps(db, fakeFetch([{ events: toolStream('', 'toolu_p', 'list_habits', ['{}']) }])), P(db))
  const t = db.s.rows.find(r => r.role === 'tool'); t.tool_state = 'done'; t.tool_result = '[]'
  const f = fakeFetch([])
  const out = await M.runStep(deps(db, f), P(db, { provider: 'groq', mode: 'continue', key: 'gsk_1' }))
  ok(out === 'error' && f.calls.length === 0 && /provider was changed/.test(db.s.rows.filter(r => r.role === 'assistant').pop().content) && db.s.turn === null, 'continuing on a different provider than the turn began on is refused without calling anyone')
}

// 9 ── the throttle
{
  let t = 1_700_000_000_000; const writes = []
  const w = M.throttledWriter(async s => { writes.push(s) }, 700, () => t)
  for (const s of ['a', 'ab', 'abc']) { w.push(s); t += 100 }
  const end = await w.finish()
  ok(writes.length === 2 && writes[0] === 'a' && end === 'abc' && writes.at(-1) === 'abc', 'the writer batches (3 chunks → 2 writes) and the last text always lands', JSON.stringify(writes))
}

// 10 ── the function file itself: no Deno here, so at least parse it and typecheck it
// strictly against stand-ins for the two things it imports from outside the repo.
{
  const fn = fileURLToPath(new URL('../supabase/functions/assistant-chat/index.ts', import.meta.url))
  const amb = path.join(dir, 'ambient.d.ts')
  fs.writeFileSync(amb, `declare module 'https://esm.sh/*' { export function createClient(...a: any[]): any }
declare const Deno: { env: { get(k: string): string | undefined }, serve(h: (r: Request) => Response | Promise<Response>): void }`)
  const prog = ts.createProgram([fn, amb], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], allowImportingTsExtensions: true, skipLibCheck: true })
  const diags = ts.getPreEmitDiagnostics(prog).filter(d => d.file && !d.file.fileName.includes('node_modules'))
  ok(diags.length === 0, 'assistant-chat/index.ts parses and typechecks (strict)', diags.slice(0, 3).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join(' | '))
  const src = fs.readFileSync(fn, 'utf8')
  ok(/getUser\(jwt\)/.test(src) && /eq\('user_id', userId\)/.test(src), 'it authenticates the caller and checks the conversation is theirs')
  ok(!/console\.(log|error)\([^)]*\bkey\b/.test(src.replace(/'could not read the saved AI key:'/, '')), 'it never logs the key')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
