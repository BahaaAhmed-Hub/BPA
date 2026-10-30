// node scripts/assistant-usage-counter.mjs   — needs a dev server on 5199
//
// "For the billing of the keys I need the counter of tokens or used amount reflected beside the model during usage."
//
// Measured on the header's own box and on Settings → AI, against a stand-in project whose "function" writes the answer
// (and the tokens the provider reported) from Node, and a stand-in Anthropic / Groq that report usage with each reply.
// What is claimed: tokens are EXACT and are never counted twice; the figure moves WHILE an answer is being written (and is
// marked "~" until the real number lands); an amount is an ESTIMATE that says so, is the person's own when they set a
// rate, and is simply absent for a model nobody has priced; the month's total is a sum over the rows and leaves out last
// month; and the counter never costs the model name its place (the name gives way, the numbers stay).
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { CORS, U, iso, makeWorld, rest } from './fixtures/assistant-world.mjs'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 15000, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true } catch { /* not yet */ } await sleep(step) } return false }
const LONG = 'meta-llama/llama-4-scout-17b-16e-instruct-extra-long-experimental-build-2026'
const SONNET = 'claude-sonnet-4-6'

const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`
const anthropicReply = (t, u) => ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', stop_reason: null, stop_sequence: null, usage: { input_tokens: u.input, output_tokens: 1 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }) + ev('content_block_stop', { type: 'content_block_stop', index: 0 }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: u.output } }) + ev('message_stop', { type: 'message_stop' })

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function launch(w, { config, module = 'morning', goto = 'http://localhost:5199/', anthropicUsage = { input: 12000, output: 800 }, groqUsage = { prompt_tokens: 3000, completion_tokens: 100 } } = {}) {
  const seen = { anthropic: [], groq: [], fn: [] }
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url())
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(session.user)
    if (u.pathname.startsWith('/auth/v1/token')) return j(session)
    if (u.pathname.startsWith('/functions/v1/assistant-chat')) {
      const body = JSON.parse(q.postData() || '{}'); seen.fn.push(body)
      if (w.fnStatus !== 200) return j({ error: 'nope' }, w.fnStatus)
      void w.serve(body)
      return j({ accepted: true }, 202)
    }
    if (u.pathname.startsWith('/rest/v1/assistant_')) { const out = rest(w, q, u); if (out) return r.fulfill(out) }
    return j(u.pathname.startsWith('/auth') ? {} : [])
  })
  await ctx.route('https://api.anthropic.com/**', async r => {
    const q = r.request()
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (new URL(q.url()).pathname.endsWith('/models')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: [{ id: SONNET }] }) })
    const body = JSON.parse(q.postData() || '{}'); seen.anthropic.push(body)
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicReply('Hello from Claude', anthropicUsage) })
  })
  await ctx.route('https://api.groq.com/**', async r => {
    const q = r.request()
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = x => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
    if (new URL(q.url()).pathname.endsWith('/models')) return j({ data: [{ id: 'llama-3.1-8b-instant' }, { id: LONG }, { id: 'openai/gpt-oss-120b' }] })
    const body = JSON.parse(q.postData() || '{}'); seen.groq.push(body)
    return j({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello from Groq' } }], usage: groqUsage })
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{}' }))
  await ctx.addInitScript(([s, cfg, mod]) => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify(cfg))
    localStorage.setItem('assistant-persona', JSON.stringify({ name: 'Beau', asked: true })) } catch {} }, [session, config, module])
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto(goto, { waitUntil: 'domcontentloaded' })
  await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(900)
  return { p, ctx, seen }
}
const claude = (extra = {}) => ({ provider: 'anthropic', anthropicKey: 'sk-ant-test1234567890', groqKey: '', groqModel: 'llama-3.1-8b-instant', claudeModel: '', prices: {}, ...extra })
const groqC = (model = 'llama-3.1-8b-instant', extra = {}) => ({ provider: 'groq', anthropicKey: '', groqKey: 'gsk_test1234567890', groqModel: model, claudeModel: '', prices: {}, ...extra })
const win = p => p.locator('[data-assistant-window]')
const counter = p => p.locator('[data-usage-counter]').first()
const tokens = async p => Number(await counter(p).getAttribute('data-usage-tokens'))
const text = async p => ((await counter(p).textContent()) ?? '').replace(/^·\s*/, '').trim()
const open = async p => { if ((await win(p).getAttribute('data-shown')) !== 'true') { await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(500) } }
const say = async (p, t) => { await open(p); const box = win(p).locator('textarea').first(); await box.fill(t); await box.press('Enter') }
const dbUsage = (w, cid) => w.msgs.filter(m => m.conversation_id === cid && m.usage).map(m => m.usage)
const sumTokens = list => list.reduce((n, u) => n + u.input + u.output + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), 0)
const seed = (w, rows, convUpdated = iso()) => {
  const cid = crypto.randomUUID()
  w.convs.push({ id: cid, user_id: U, archived_at: null, title: null, provider: 'anthropic', turn: null, created_at: convUpdated, updated_at: convUpdated })
  for (const r of rows) w.addMsg({ conversation_id: cid, user_id: U, ...r })
  return cid
}

// ═══ 1 ── the in-browser path: Anthropic reports usage; it is counted, kept, and counted once ═══
{
  const w = makeWorld(); w.fnStatus = 404
  const { p, ctx } = await launch(w, { config: claude() })
  await open(p)
  ok('before anything is said the counter is there and reads zero', (await tokens(p)) === 0 && (await text(p)) === '0 tokens', await text(p))
  await say(p, 'hi')
  ok('after the reply: exactly what the provider reported (12,000 in + 800 out), with an amount marked ≈', await until(async () => (await tokens(p)) === 12800, 15000) && (await text(p)) === '13k tokens · ≈$0.05', `${await tokens(p)} | ${await text(p)}`)
  const tip = await p.locator('[data-model-badge]').first().getAttribute('title')
  ok('the tooltip gives the breakdown and says the amount is an estimate', /12,000 in · 800 out/.test(tip) && /estimate from list prices/.test(tip) && /1 request/.test(tip), tip.replace(/\n/g, ' | '))
  const cid = w.convs.at(-1)?.id
  ok('the turn was written to the thread WITH its usage, on the answer', await until(() => dbUsage(w, cid).length === 1, 8000) && dbUsage(w, cid)[0].input === 12000 && dbUsage(w, cid)[0].output === 800 && dbUsage(w, cid)[0].model === SONNET && dbUsage(w, cid)[0].provider === 'anthropic', JSON.stringify(dbUsage(w, cid)))
  await sleep(2500)
  ok('and once the rows are read back it is NOT counted twice (still 12,800)', (await tokens(p)) === 12800, String(await tokens(p)))
  await say(p, 'again')
  ok('a second message adds to it: 25,600', await until(async () => (await tokens(p)) === 25600, 15000) && (await text(p)) === '26k tokens · ≈$0.10', `${await tokens(p)} | ${await text(p)}`)
  await sleep(2500)
  ok('the server holds exactly the sum, one usage per answer, none duplicated', sumTokens(dbUsage(w, cid)) === 25600 && dbUsage(w, cid).length === 2, JSON.stringify(dbUsage(w, cid).map(u => u.input + u.output)))
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(1500)
  ok('after a reload the counter is rebuilt from the rows alone: 25,600', await until(async () => (await tokens(p)) === 25600, 10000), String(await tokens(p)))
  await ctx.close()
}

// ═══ 2 ── Groq reports usage in a different shape ═══════════════════════════════════
{
  const w = makeWorld(); w.fnStatus = 404
  const { p, ctx } = await launch(w, { config: groqC('llama-3.1-8b-instant') })
  await say(p, 'hi')
  ok('Groq: prompt + completion tokens (3,000 + 100), and a sub-cent amount reads "<$0.01" without a "≈"', await until(async () => (await tokens(p)) === 3100, 15000) && (await text(p)) === '3.1k tokens · <$0.01', `${await tokens(p)} | ${await text(p)}`)
  const cid = w.convs.at(-1)?.id
  ok('and is kept tagged with Groq and the model', await until(() => dbUsage(w, cid).some(u => u.provider === 'groq' && u.model === 'llama-3.1-8b-instant' && u.input === 3000 && u.output === 100), 8000), JSON.stringify(dbUsage(w, cid)))
  await ctx.close()
}

// ═══ 3 ── the server path: the number MOVES while the answer is written, then becomes exact ═══
{
  const w = makeWorld(); w.chunkMs = 450; w.mode = 'text'
  w.text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
  w.usage = { input: 4000, output: 90, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' }
  const { p, ctx } = await launch(w, { config: claude() })
  await open(p)
  ok('CONTROL: nothing used yet', (await tokens(p)) === 0)
  await say(p, 'count for me')
  const seenLive = new Set(); let liveText = ''
  const t0 = Date.now()
  while (Date.now() - t0 < 15000 && w.msgs.find(m => m.role === 'assistant')?.status !== 'complete') {
    if ((await counter(p).getAttribute('data-usage-live')) === 'true') { seenLive.add(await tokens(p)); liveText = await text(p) }
    await sleep(120)
  }
  ok('WHILE the answer is being written the counter is live: it moved through at least two values', seenLive.size >= 2, JSON.stringify([...seenLive]))
  ok('…and a live figure is marked with "~"', liveText.startsWith('~'), liveText)
  ok('when it finishes the exact figure replaces the estimate: 4,090, no longer live', await until(async () => (await tokens(p)) === 4090 && (await counter(p).getAttribute('data-usage-live')) === 'false', 10000) && (await text(p)) === '4.1k tokens · ≈$0.01', `${await tokens(p)} | ${await text(p)}`)
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(1500)
  ok('on another load the same exact number comes from the rows', await until(async () => (await tokens(p)) === 4090, 10000), String(await tokens(p)))
  await ctx.close()
}

// ═══ 4 ── a tool loop is several requests and every one is billed ═══════════════════
{
  const w = makeWorld(); w.mode = 'tool'; w.tool = { name: 'list_habits', input: {} }; w.chunkMs = 120
  w.usageTool = { input: 900, output: 30, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' }
  w.usageFinal = { input: 1000, output: 12, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' }
  const { p, ctx } = await launch(w, { config: claude() })
  await say(p, 'what habits?')
  ok('the tool step AND the final answer are both counted: 900 + 30 + 1,000 + 12', await until(async () => (await tokens(p)) === 1942, 20000), String(await tokens(p)))
  await ctx.close()
}

// ═══ 4b ── a step that only asked for a tool has no words, and is still counted ═══
{
  const w = makeWorld()
  const cid = seed(w, [
    { role: 'user', content: 'what habits?' },
    { role: 'assistant', content: '', usage: { input: 900, output: 30, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' } },
    { role: 'tool', content: 'list_habits', tool: 'list_habits', tool_state: 'done', tool_use_id: 'toolu_x', tool_result: '[]' },
    { role: 'assistant', content: 'You have none.', usage: { input: 1000, output: 12, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' } },
  ])
  const { p, ctx } = await launch(w, { config: claude(), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  ok('the wordless step\'s tokens are in the total (900 + 30 + 1,000 + 12)', await until(async () => (await tokens(p)) === 1942, 10000), String(await tokens(p)))
  const bubbles = await win(p).locator('.ai-md').count()
  ok('and it draws no bubble of its own: one answer bubble, one chip', bubbles === 1 && (await win(p).locator('.ai-chip').count()) === 1 && /You have none\./.test(await win(p).innerText()), `bubbles=${bubbles}`)
  await ctx.close()
}

// ═══ 5 ── an unpriced model: tokens, and NO amount ═══════════════════════════════════
{
  const w = makeWorld()
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 5000, output: 10, cacheRead: 0, cacheWrite: 0, model: 'claude-fable-5-1', provider: 'anthropic' } }])
  const { p, ctx } = await launch(w, { config: claude({ claudeModel: 'claude-fable-5-1' }), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  await until(async () => (await tokens(p)) === 5010, 10000)
  const t = await text(p); const tip = await p.locator('[data-model-badge]').first().getAttribute('title')
  ok('a model nobody has priced shows tokens only — no "$" anywhere in the counter', t === '5k tokens' && !(await counter(p).textContent()).includes('$') && (await counter(p).getAttribute('data-usage-usd')) === '', t)
  ok('…and the tooltip says why', /No price known for claude-fable-5-1/.test(tip), tip.replace(/\n/g, ' | '))
  await ctx.close()
}

// ═══ 6 ── the person's own rate ═════════════════════════════════════════════════════
for (const [label, prices, want, wantTip] of [
  ['without one it is an estimate', {}, '1.5M tokens · ≈$10.5', /estimate from list prices/],
  ['with their own rate ($1 / $1) it is theirs, with no "≈"', { [SONNET]: { in: 1, out: 1 } }, '1.5M tokens · $1.50', /price you set/],
]) {
  const w = makeWorld()
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' } }])
  const { p, ctx } = await launch(w, { config: claude({ prices }), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  await until(async () => (await tokens(p)) === 1_500_000, 10000)
  const tip = await p.locator('[data-model-badge]').first().getAttribute('title')
  ok(label, (await text(p)) === want && wantTip.test(tip), `${await text(p)}`)
  await ctx.close()
}

// ═══ 7 ── the counter never costs the buttons their place; the NAME gives way ═══════
{
  const w = makeWorld()
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 123456, output: 7890, cacheRead: 0, cacheWrite: 0, model: LONG, provider: 'groq' } }])
  const { p, ctx } = await launch(w, { config: groqC(LONG), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  await until(async () => (await tokens(p)) === 131346, 10000)
  const m = await p.evaluate(() => {
    const win = document.querySelector('[data-assistant-window]').getBoundingClientRect()
    const badge = document.querySelector('[data-model-badge]').getBoundingClientRect()
    const lab = document.querySelector('[data-model-label]'); const c = document.querySelector('[data-usage-counter]')
    const close = document.querySelector('[data-assistant-window] button[aria-label="Close the assistant"]')?.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return { clipped: lab.scrollWidth > lab.clientWidth, counterWhole: c.scrollWidth <= c.clientWidth + 1, counterW: cr.width, counterRight: cr.right, badgeRight: badge.right, closeLeft: close?.left, winRight: win.right, text: c.textContent }
  })
  ok('a very long model name AND the counter: the name is the one that is cut', m.clipped && m.counterWhole && m.counterW > 40, JSON.stringify(m))
  ok('the counter stays inside the header and clear of the Close button', m.counterRight <= m.badgeRight + 1 && m.counterRight <= (m.closeLeft ?? m.winRight) + 1, `counter→${m.counterRight} badge→${m.badgeRight} close@${m.closeLeft}`)
  ok('and reads in full', /131k tokens/.test(m.text), m.text)
  await ctx.close()
}

// ═══ 8 ── Settings → AI: this month, across rows; last month is left out; the price row ═══
{
  const w = makeWorld()
  const lastMonth = new Date(Date.now() - 40 * 86400000).toISOString()
  seed(w, [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'x', usage: { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' } },
    { role: 'assistant', content: 'y', usage: { input: 2_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, model: 'openai/gpt-oss-120b', provider: 'groq' } },
    { role: 'assistant', content: 'old', created_at: lastMonth, usage: { input: 9_000_000, output: 900_000, cacheRead: 0, cacheWrite: 0, model: SONNET, provider: 'anthropic' } },
  ])
  const { p, ctx } = await launch(w, { config: claude(), module: 'settings' })
  await p.locator('main button').filter({ hasText: /^AI\d*$/ }).last().click({ timeout: 8000 })
  const month = p.locator('[data-month-usage]')
  await month.waitFor({ timeout: 10000 })
  ok('this month is the sum of the rows from this month: 3.3M tokens', await until(async () => (await month.getAttribute('data-month-usage')) === '3300000', 10000), await month.getAttribute('data-month-usage'))
  ok('CONTROL: last month\'s 9.9M tokens are NOT in it', (await month.getAttribute('data-month-usage')) !== '13200000')
  const first = (await month.textContent()) ?? ''
  ok('it carries an estimated amount (≈$6.4: Sonnet $6.00 + gpt-oss-120b $0.375)', /3\.3M tokens · ≈\$6\.3[78]/.test(first), first)
  ok('with a line per model', (await p.locator('[data-month-line]').count()) === 2 && /Sonnet 4\.6 · 1\.2M tokens · ≈\$6\.00/.test(await p.locator(`[data-month-line="${SONNET}"]`).textContent()), await p.locator('[data-month-line]').allTextContents().then(x => x.join(' | ')))
  ok('the price row shows the built-in estimate as a placeholder and says it is one', (await p.locator('input[aria-label^="Price per million in"]').getAttribute('placeholder')) === '3' && (await p.locator('input[aria-label^="Price per million out"]').getAttribute('placeholder')) === '15' && (await p.locator('[data-price-note]').getAttribute('data-price-note')) === 'estimate')
  await p.locator('input[aria-label^="Price per million in"]').fill('1')
  await p.locator('input[aria-label^="Price per million out"]').fill('1')
  ok('entering your rate is saved for that model', await until(async () => { const c = await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ai-config') || '{}')); return c.prices?.[SONNET]?.in === 1 && c.prices?.[SONNET]?.out === 1 }, 4000))
  await p.locator('button[aria-label="Refresh this month’s usage"]').click()
  ok('the month recalculates with it: Sonnet $1.20 + gpt-oss $0.375 ≈ $1.6 (still an estimate for the part you did not set)', await until(async () => /3\.3M tokens · ≈\$1\.5[78]/.test((await month.textContent()) ?? ''), 6000), await month.textContent())
  ok('and the note now says it is using your rate', (await p.locator('[data-price-note]').getAttribute('data-price-note')) === 'yours')
  await p.locator('input[aria-label^="Price per million in"]').fill('')
  await p.locator('input[aria-label^="Price per million out"]').fill('')
  ok('clearing both boxes returns to the estimate and removes the override', await until(async () => { const c = await p.evaluate(() => JSON.parse(localStorage.getItem('professor-ai-config') || '{}')); return !c.prices?.[SONNET] }, 4000))
  await ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
