// node scripts/assistant-persists.mjs   — needs a dev server on 5199
//
// "On iPad Safari, after the screen dims and I reopen, the page reloads and the conversation is gone."
// Proved here in a real browser against a STATEFUL stand-in for the project: a small PostgREST that keeps
// `assistant_conversations` / `assistant_messages` (unique indexes and all), and an `assistant-chat` function
// that writes its answer from NODE on a timer — so the answer keeps arriving whether or not the page is alive,
// which is the whole claim. A page killed mid-answer is a real kill; the rows it comes back to are real rows.
//
// Controls (each can fail): a function that answers 404 must fall back to the browser path with nothing left
// behind; a streaming row that nobody has written for minutes must read as interrupted, not as "typing"; an idle
// page shows another device's message only when the page comes back (no event → no message).
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 15000, step = 150) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true } catch { /* not yet */ } await sleep(step) } return false }


import { CORS, U, iso, makeWorld, rest } from './fixtures/assistant-world.mjs'

// ── a browser as one "device" ───────────────────────────────────────────────
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`
const anthropicText = t => ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }) + ev('content_block_stop', { type: 'content_block_stop', index: 0 }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) + ev('message_stop', { type: 'message_stop' })

async function device(w, { goto = 'http://localhost:5199/', open = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 } })
  const seen = { anthropic: 0, anthropicBodies: [], fnBodies: [] }
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url())
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (u.pathname === '/auth/v1/user') return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(user) })
    if (u.pathname.startsWith('/auth/v1/token')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(session) })
    if (u.pathname.startsWith('/functions/v1/assistant-chat')) {
      const body = JSON.parse(q.postData() || '{}'); seen.fnBodies.push(body); w.fn.push({ mode: body.mode, provider: body.provider })
      if (w.fnStatus !== 200) return r.fulfill({ status: w.fnStatus, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error: 'nope' }) })
      void w.serve(body)   // carries on in Node, whatever happens to this page
      return r.fulfill({ status: 202, contentType: 'application/json', headers: CORS, body: JSON.stringify({ accepted: true }) })
    }
    if (u.pathname.startsWith('/rest/v1/assistant_')) { const out = rest(w, q, u); if (out) return r.fulfill(out) }
    if (u.pathname.startsWith('/auth')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{}' })
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '[]' })
  })
  await ctx.route('https://api.anthropic.com/**', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    seen.anthropic++; seen.anthropicBodies.push(JSON.parse(r.request().postData() || '{}'))
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicText('Answered in the browser.') })
  })
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test' }))
    localStorage.setItem('assistant-persona', JSON.stringify({ name: 'Beau', asked: true })) } catch {} }, session)
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto(goto, { waitUntil: 'domcontentloaded' }); await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 })
  await p.waitForTimeout(1200)
  if (open) { await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(500) }
  return { p, ctx, seen }
}
const win = p => p.locator('[data-assistant-window]')
const text = p => win(p).innerText()
const box = p => win(p).locator('textarea').first()
const say = async (p, t) => { await box(p).fill(t); await box(p).press('Enter') }
const shown = p => win(p).getAttribute('data-shown').then(v => v === 'true')
const convId = p => p.evaluate(() => new URL(location.href).searchParams.get('c'))

// ═══ 1 ── a message goes to the server, and the answer is the server's ═══════
{
  const w = makeWorld()
  const { p, ctx, seen } = await device(w)
  await say(p, 'what is on today?')
  await until(async () => (await text(p)).includes('This is a'))
  ok('the question is a row on the server, written by the page', w.msgs.some(m => m.role === 'user' && m.content === 'what is on today?' && m.client_id))
  const fb = seen.fnBodies[0]
  ok('the function was asked for a TURN with the page\'s own prompt, tools and model', fb?.mode === 'turn' && fb.provider === 'anthropic' && fb.tools.length > 5 && /Professor|assistant/i.test(fb.system) && /claude/.test(fb.model), JSON.stringify({ mode: fb?.mode, tools: fb?.tools?.length, model: fb?.model }))
  ok('the browser did NOT call Anthropic itself', seen.anthropic === 0)
  ok('the address now carries the conversation', !!(await convId(p)) && (await convId(p)) === w.convs[0]?.id, await convId(p))
  await until(async () => w.msgs.find(m => m.role === 'assistant')?.status === 'complete')
  await until(async () => (await text(p)).includes('while the page is gone.'))
  ok('the answer arrived on screen while it was being written (polled from the rows)', (await text(p)).includes('while the page is gone.'))
  await ctx.close()
}

// ═══ 2 ── the iPad case: the page dies mid-answer, and the answer is waiting ═══
{
  const w = makeWorld(); w.chunkMs = 700
  const { p, ctx } = await device(w)
  await say(p, 'tell me something long')
  await until(async () => (await text(p)).includes('This is a'))
  const midLen = w.msgs.find(m => m.role === 'assistant').content.length
  const id = await convId(p)
  await p.goto('about:blank')                       // the tab is gone — frozen, discarded, anything
  const gone = w.msgs.find(m => m.role === 'assistant')
  ok('the answer was still unfinished when the page went', gone.status === 'streaming', gone.status)
  await sleep(2500)                                  // dimmed. The server does not care.
  ok('and it kept being written with no page open', gone.content.length > midLen, `${midLen} → ${gone.content.length} chars`)
  await p.goto('http://localhost:5199/?c=' + id, { waitUntil: 'domcontentloaded' })
  await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 })
  ok('reopened: the window comes up by itself because an answer is on its way', await until(() => shown(p), 10000))
  ok('the question is back', await until(async () => (await text(p)).includes('tell me something long'), 8000), (await text(p)).slice(0, 120))
  ok('the answer so far is back', await until(async () => (await text(p)).includes('This is a'), 8000))
  await until(() => gone.status === 'complete', 20000)
  ok('and it finishes on screen', await until(async () => (await text(p)).includes('while the page is gone.'), 8000))
  ok('the composer is free again afterwards', (await box(p).getAttribute('placeholder')).startsWith('Ask'), await box(p).getAttribute('placeholder'))
  ok('the conversation id survived in the address', (await convId(p)) === id)
  await ctx.close()
}

// ═══ 3 ── another device, and the page coming back to the front ═══════════════
{
  const w = makeWorld(); w.chunkMs = 150; w.text = 'Hello from the laptop.'
  const A = await device(w)
  await say(A.p, 'hi from the laptop'); await until(async () => w.msgs.some(m => m.status === 'complete' && m.role === 'assistant'))
  const B = await device(w)       // the iPad: a fresh context, no ?c, no storage of its own
  ok('a second device with no address finds the same thread', await until(async () => (await text(B.p)).includes('Hello from the laptop.'), 10000))
  ok('…and puts it in its address', (await convId(B.p)) === w.convs[0].id)
  // an idle page does not poll; a message from the laptop reaches it when it comes back to the front
  w.addMsg({ conversation_id: w.convs[0].id, user_id: U, role: 'assistant', content: 'A late note.' })
  await sleep(3500)
  ok('CONTROL: with no event, an idle page does not have the new message yet', !(await text(B.p)).includes('A late note.'))
  await B.p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  ok('visibilitychange pulls it', await until(async () => (await text(B.p)).includes('A late note.'), 6000))
  w.addMsg({ conversation_id: w.convs[0].id, user_id: U, role: 'assistant', content: 'And a second.' })
  await B.p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  ok('pageshow pulls it too (the back/forward cache restore)', await until(async () => (await text(B.p)).includes('And a second.'), 6000))
  await A.ctx.close(); await B.ctx.close()
}

// ═══ 4 ── an answer that stopped being written reads as stopped ══════════════
{
  const w = makeWorld(); const cid = crypto.randomUUID(); const old = new Date(Date.now() - 5 * 60000).toISOString()
  w.convs.push({ id: cid, user_id: U, archived_at: null, title: null, provider: 'anthropic', turn: null, created_at: old, updated_at: old })
  w.addMsg({ conversation_id: cid, user_id: U, role: 'user', content: 'a question' })
  const dead = w.addMsg({ conversation_id: cid, user_id: U, role: 'assistant', status: 'streaming', content: 'half an ans' }).row
  dead.updated_at = old
  const { p, ctx } = await device(w, { goto: 'http://localhost:5199/?c=' + cid, open: false })
  await p.waitForTimeout(2000)
  const autoOpened = await shown(p)
  await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(800)
  ok('a streaming row nobody has touched for five minutes shows as interrupted, not as typing', await until(async () => /interrupted/i.test(await text(p)), 8000), (await text(p)).slice(-160))
  ok('the box is not held shut waiting for it', (await box(p).getAttribute('placeholder')).startsWith('Ask'))
  ok('every device is told: the row is marked error on the server', await until(async () => dead.status === 'error', 6000), dead.status)
  ok('the window did NOT pop open for a dead answer (it does for a live one — scenario 2)', autoOpened === false)
  await ctx.close()
}

// ═══ 5 ── drafts ══════════════════════════════════════════════════════════════
{
  const w = makeWorld(); w.chunkMs = 100; w.text = 'ok done'
  const { p, ctx } = await device(w)
  await box(p).fill('half a thought, not sent')
  await p.waitForTimeout(500)
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(800)
  await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(500)
  ok('a half-typed message is still in the box after a reload', (await box(p).inputValue()) === 'half a thought, not sent', await box(p).inputValue())
  await say(p, 'now sent'); await until(async () => (await text(p)).includes('ok done'))
  await p.waitForTimeout(500)
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(800)
  await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(500)
  ok('once sent, the draft is gone (CONTROL: it is not simply sticky)', (await box(p).inputValue()) === '')
  ok('and the sent conversation came back by itself (newest live thread)', (await text(p)).includes('now sent') && (await text(p)).includes('ok done'))
  await ctx.close()
}

// ═══ 6 ── tools: parked by the server, run by the page, once ═════════════════
{
  const w = makeWorld(); w.mode = 'tool'; w.tool = { name: 'list_habits', input: {} }; w.chunkMs = 120
  const A = await device(w)
  await say(A.p, 'what habits do I have?')
  ok('the page ran the parked tool itself and wrote its result back', await until(() => w.msgs.some(m => m.role === 'tool' && m.tool_state === 'done' && m.tool_result != null), 15000))
  const t = w.msgs.find(m => m.role === 'tool')
  ok('it was claimed by this device first', !!t.claimed_by && t.claimed_by === await A.p.evaluate(() => localStorage.getItem('assistant-device')), t.claimed_by)
  ok('then it asked for the next step, and the function saw the result', await until(() => w.fn.some(f => f.mode === 'continue') && !!w.continueSaw, 10000) && w.continueSaw[0].state === 'done', JSON.stringify(w.continueSaw))
  ok('and the final answer is on screen', await until(async () => (await text(A.p)).includes('All done.'), 10000))
  const chips = win(A.p).locator('.ai-chip')
  ok('the tool chip exists and settled to "done" (nothing spinning under a finished answer)', (await chips.count()) === 1 && (await chips.first().getAttribute('data-state')) === 'done' && /Read habits/.test(await chips.first().innerText()), await chips.first().innerText().catch(() => 'no chip'))
  await A.ctx.close()
}

// two open devices, one parked call: it runs exactly once
{
  const w = makeWorld(); w.mode = 'tool'; w.tool = { name: 'list_habits', input: {} }; w.chunkMs = 120
  const A = await device(w); const first = await say(A.p, 'warm up').then(() => until(async () => (await text(A.p)).includes('All done.'), 15000))
  const before = w.patches.filter(p => p.table === 'assistant_messages' && p.patch.tool_state === 'done').length
  const B = await device(w); await until(async () => (await text(B.p)).includes('All done.'), 10000)
  w.mode = 'tool'
  // park a call by hand and let BOTH pages see it at the same instant
  const cid = w.convs[0].id
  const row = w.addMsg({ conversation_id: cid, user_id: U, role: 'tool', content: 'list_habits', tool: 'list_habits', tool_state: 'running', tool_use_id: 'toolu_race', tool_input: {} }).row
  const poke = p => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await Promise.all([poke(A.p), poke(B.p)])
  await until(() => row.tool_state === 'done', 10000)
  await sleep(1500)
  const finishes = w.patches.filter(p => p.table === 'assistant_messages' && p.patch.tool_state === 'done').length - before
  ok('two devices saw the same parked call at once; it was finished exactly once', first && finishes === 1, `finishes=${finishes}`)
  const claims = w.patches.filter(p => p.patch.claimed_by && p.n === 1)
  const failed = w.patches.filter(p => p.patch.claimed_by && p.n === 0)
  ok('one claim won and the other came back empty-handed (the conditional update is the lock)', claims.length >= 2 && failed.length >= 1, `won=${claims.length} lost=${failed.length}`)
  await A.ctx.close(); await B.ctx.close()
}

// ═══ 7 ── an approval card survives a reload ═══════════════════════════════════
{
  const w = makeWorld(); w.mode = 'tool'; w.tool = { name: 'delete_task', input: { task_id: 'abc' } }; w.chunkMs = 120
  const A = await device(w)
  await say(A.p, 'delete that task')
  const card = p => p.locator('[role="group"][aria-label="Approval needed"]')
  await card(A.p).waitFor({ timeout: 15000 })
  ok('a destructive call waits for a click, as before', /Delete/.test(await card(A.p).innerText()))
  const t = w.msgs.find(m => m.role === 'tool')
  ok('and nothing has run meanwhile (the row is still "running", no result)', t.tool_state === 'running' && t.tool_result == null)
  const id = await convId(A.p)
  await A.p.goto('about:blank')
  await A.p.goto('http://localhost:5199/?c=' + id, { waitUntil: 'domcontentloaded' })
  await card(A.p).waitFor({ timeout: 20000 })
  ok('reloaded: the card is back (the page reclaimed its own earlier claim instead of waiting out two minutes)', await card(A.p).count() === 1 && (await shown(A.p)))
  ok('CONTROL: still nothing has run', t.tool_state === 'running' && t.tool_result == null)
  await card(A.p).getByRole('button', { name: 'Approve' }).click()
  ok('approving finishes the call and the turn carries on', await until(() => t.tool_state === 'done', 10000) && await until(async () => (await text(A.p)).includes('All done.'), 12000))
  await A.ctx.close()
}

// ═══ 8 ── the function is not there: the browser path, and nothing left behind ═
{
  const w = makeWorld(); w.fnStatus = 404
  const A = await device(w)
  await say(A.p, 'anyone home?')
  ok('a 404 from the function falls back: the browser asked Anthropic itself', await until(() => A.seen.anthropic === 1, 10000))
  ok('…and the answer is on screen', await until(async () => (await text(A.p)).includes('Answered in the browser.'), 8000))
  await sleep(1500)
  const live = w.convs.find(c => !c.archived_at)
  const rows = w.msgs.filter(m => m.conversation_id === live?.id)
  ok('the failed attempt left no orphan: exactly one user row (the retry was deleted, the turn persisted once)', rows.filter(m => m.role === 'user').length === 1, JSON.stringify(rows.map(r => r.role)))
  ok('the browser turn was written to the thread afterwards, so it survives a reload', rows.some(m => m.role === 'assistant' && m.content === 'Answered in the browser.'))
  const id = await convId(A.p)
  await A.p.reload({ waitUntil: 'domcontentloaded' }); await A.p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await A.p.waitForTimeout(800)
  await A.p.locator('[data-assistant-fab]').click(); await A.p.waitForTimeout(500)
  ok('reload: the browser-path conversation is still there', !!id && (await text(A.p)).includes('Answered in the browser.') && (await text(A.p)).includes('anyone home?'))
  await say(A.p, 'second question')
  await until(() => A.seen.anthropic === 2, 10000)
  const afterReload = w.fn.length
  ok('after a reload the page tries the function once more (it forgot), and the browser path answers when that fails', afterReload === 2 && A.seen.anthropic === 2, `fn=${afterReload} anthropic=${A.seen.anthropic}`)
  const sent = A.seen.anthropicBodies[1]?.messages ?? []
  ok('the browser path remembers the thread it was handed from the rows', sent.length >= 3 && sent[0].content === 'anyone home?', JSON.stringify(sent.map(m => m.role + ':' + String(m.content).slice(0, 20))))
  await until(async () => (await box(A.p).getAttribute('placeholder')).startsWith('Ask'), 8000)
  await say(A.p, 'third question')
  await until(() => A.seen.anthropic === 3, 10000)
  ok('and within that page it is not asked again', w.fn.length === afterReload && A.seen.anthropic === 3, `fn=${w.fn.length}`)
  await A.ctx.close()
}

// ═══ 9 ── a file stays in the browser; closing forgets ═══════════════════════
{
  const w = makeWorld(); w.chunkMs = 100; w.text = 'fine'
  const A = await device(w)
  await win(A.p).locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('remember the milk') })
  await A.p.waitForTimeout(500)
  await say(A.p, 'what is in this?')
  await until(() => A.seen.anthropic === 1, 10000)
  ok('a message with a file goes to the browser path (the bytes are not sent through the function)', A.seen.anthropic === 1 && w.fn.length === 0)
  ok('the file reached the model, fenced', JSON.stringify(A.seen.anthropicBodies[0]).includes('--- notes.txt ---'))
  await until(async () => w.msgs.some(m => m.role === 'assistant'), 8000)
  ok('the thread still persisted, with the file as a chip', w.msgs.some(m => m.role === 'user' && m.files?.[0]?.name === 'notes.txt'))
  // close = forget
  const id = w.convs[0].id
  await win(A.p).getByRole('button', { name: 'Close the assistant' }).click()
  ok('closing archives the conversation on the server', await until(() => !!w.convs.find(c => c.id === id)?.archived_at, 6000))
  ok('…and takes it out of the address', (await convId(A.p)) === null)
  await A.p.reload({ waitUntil: 'domcontentloaded' }); await A.p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await A.p.waitForTimeout(1000)
  await A.p.locator('[data-assistant-fab]').click(); await A.p.waitForTimeout(500)
  ok('after a reload the archived thread does not come back', !(await text(A.p)).includes('what is in this?'))
  await A.ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
