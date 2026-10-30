// node scripts/assistant-limits-live.mjs   — needs a dev server on 5199
//
// "Is the counter the provider's usage? I need it to reflect LIVE usage, so the user can see it and act."
//
// What a provider will tell an ordinary key is how much room is LEFT (rate-limit headers on every reply), not a balance.
// Measured here in real Chromium, including the browser's own CORS rule — a page can read a response header only if the
// provider exposes it, so the same reply is sent with and without `access-control-expose-headers`, and the page must show
// the reading in the first case and invent nothing in the second. The server path (whose function always sees the
// headers) is a stand-in that stores the reading on the answer row, as the real one does.
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { CORS, U, iso, makeWorld, rest } from './fixtures/assistant-world.mjs'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 15000, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true } catch { /* not yet */ } await sleep(step) } return false }
const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`
const anthropicReply = (t, u) => ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', stop_reason: null, stop_sequence: null, usage: { input_tokens: u.input, output_tokens: 1 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }) + ev('content_block_stop', { type: 'content_block_stop', index: 0 }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: u.output } }) + ev('message_stop', { type: 'message_stop' })

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

/** groq / anthropic: { headers, expose, status } — what the provider sends back and whether it lets a browser read it. */
async function launch(w, { config, module = 'morning', goto = 'http://localhost:5199/', groq = {}, anthropic = {} } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
  const withHeaders = (cfg, extra = {}) => ({ ...CORS, ...(cfg.headers ?? {}), ...(cfg.expose === false ? {} : { 'access-control-expose-headers': '*' }), ...extra })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url())
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(session.user)
    if (u.pathname.startsWith('/auth/v1/token')) return j(session)
    if (u.pathname.startsWith('/functions/v1/assistant-chat')) { if (w.fnStatus !== 200) return j({ error: 'nope' }, w.fnStatus); void w.serve(JSON.parse(q.postData() || '{}')); return j({ accepted: true }, 202) }
    if (u.pathname.startsWith('/rest/v1/assistant_')) { const out = rest(w, q, u); if (out) return r.fulfill(out) }
    return j(u.pathname.startsWith('/auth') ? {} : [])
  })
  await ctx.route('https://api.anthropic.com/**', async r => {
    const q = r.request()
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (new URL(q.url()).pathname.endsWith('/models')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }) })
    if (anthropic.status && anthropic.status !== 200) return r.fulfill({ status: anthropic.status, contentType: 'application/json', headers: withHeaders(anthropic), body: JSON.stringify({ error: { message: anthropic.message ?? 'rate_limit_error' } }) })
    return r.fulfill({ status: 200, headers: withHeaders(anthropic, { 'content-type': 'text/event-stream' }), body: anthropicReply('Hello from Claude', { input: 100, output: 20 }) })
  })
  await ctx.route('https://api.groq.com/**', async r => {
    const q = r.request()
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: withHeaders(groq), body: JSON.stringify(x) })
    if (new URL(q.url()).pathname.endsWith('/models')) return j({ data: [{ id: 'llama-3.1-8b-instant' }] })
    if (groq.status && groq.status !== 200) return j({ error: { message: groq.message ?? 'Rate limit reached for model `llama-3.1-8b-instant` on tokens per minute (TPM).' } }, groq.status)
    return j({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello from Groq' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })
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
  return { p, ctx }
}
const groqC = () => ({ provider: 'groq', anthropicKey: '', groqKey: 'gsk_test1234567890', groqModel: 'llama-3.1-8b-instant', claudeModel: '', prices: {} })
const claude = () => ({ provider: 'anthropic', anthropicKey: 'sk-ant-test1234567890', groqKey: '', groqModel: 'llama-3.1-8b-instant', claudeModel: '', prices: {} })
const win = p => p.locator('[data-assistant-window]')
const line = p => p.locator('[data-limits-line]').first()
const counter = p => p.locator('[data-usage-counter]').first()
const open = async p => { if ((await win(p).getAttribute('data-shown')) !== 'true') { await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(500) } }
const say = async (p, t) => { await open(p); const box = win(p).locator('textarea').first(); await box.fill(t); await box.press('Enter') }
const seed = (w, rows) => { const cid = crypto.randomUUID(); w.convs.push({ id: cid, user_id: U, archived_at: null, title: null, provider: 'groq', turn: null, created_at: iso(), updated_at: iso() }); for (const r of rows) w.addMsg({ conversation_id: cid, user_id: U, ...r }); return cid }
const groqHeaders = (tokensLeft, reqLeft = 14370, extra = {}) => ({ 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': String(reqLeft), 'x-ratelimit-reset-requests': '2m59.56s', 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': String(tokensLeft), 'x-ratelimit-reset-tokens': '7.66s', ...extra })
const colour = async p => line(p).evaluate(el => getComputedStyle(el).color)

// ═══ 1 ── Groq, in-browser path, headers the browser is allowed to read ══════════════
{
  const w = makeWorld(); w.fnStatus = 404
  const { p, ctx } = await launch(w, { config: groqC(), groq: { headers: groqHeaders(5985), expose: true } })
  await open(p)
  ok('CONTROL: before any reply there is no reading (nothing is invented)', (await line(p).count()) === 0)
  await say(p, 'hi')
  ok('after a reply: the provider\'s own remaining quota sits under the model name', await until(async () => (await line(p).count()) === 1, 15000))
  const t = (await line(p).textContent()).trim()
  ok('it reads the provider\'s numbers: 14,370 of 14,400 requests (a day), 5,985 of 6,000 tokens (a minute)', /^14k req\/day · 6k tokens\/min left$/.test(t), t)
  ok('and is quiet while there is plenty', (await line(p).getAttribute('data-limits-level')) === 'ok')
  const tip = await line(p).getAttribute('title')
  ok('the tooltip gives each bucket in full and says whose count it is', !/\b60s\b/.test(tip) && /14,370 of 14,400 requests left today/.test(tip) && /5,985 of 6,000 tokens left this minute/.test(tip) && /whole account/.test(tip) && /As of /.test(tip), tip.replace(/\n/g, ' | '))
  ok('the usage counter is still there beside the model name (both are shown)', (await counter(p).count()) === 1 && Number(await counter(p).getAttribute('data-usage-tokens')) === 120)
  await ctx.close()
}

// ═══ 2 ── low, and out: said plainly, in a different colour, with what to do ═══════════
{
  const seen = {}
  for (const [name, left] of [['ok', 4000], ['low', 600], ['out', 0]]) {
    const w = makeWorld(); w.fnStatus = 404
    const { p, ctx } = await launch(w, { config: groqC(), groq: { headers: groqHeaders(left), expose: true } })
    await say(p, 'hi')
    await until(async () => (await line(p).count()) === 1, 15000)
    seen[name] = { level: await line(p).getAttribute('data-limits-level'), colour: await colour(p), text: (await line(p).textContent()).trim(), tip: await line(p).getAttribute('title') }
    await ctx.close()
  }
  ok('66% left is "ok", 10% is "low", 0% is "out"', seen.ok.level === 'ok' && seen.low.level === 'low' && seen.out.level === 'out', JSON.stringify(Object.values(seen).map(s => s.level)))
  ok('the three are visibly different colours', new Set(Object.values(seen).map(s => s.colour)).size === 3, JSON.stringify(Object.values(seen).map(s => s.colour)))
  ok('low says so in words, out says it is reached and when it opens again', /^Running low · /.test(seen.low.text) && /^Limit reached · /.test(seen.out.text) && /opens again in \d+s/.test(seen.out.text), `${seen.low.text} || ${seen.out.text}`)
  ok('and low / out tell the person what they can do about it', /switch the model or provider in Settings → AI/.test(seen.low.tip) && /switch the model or provider in Settings → AI/.test(seen.out.tip) && !/What you can do/.test(seen.ok.tip), '')
}

// ═══ 3 — the browser's own rule: a header the provider does not expose cannot be read ═══
{
  const w = makeWorld(); w.fnStatus = 404
  const { p, ctx } = await launch(w, { config: groqC(), groq: { headers: groqHeaders(5985), expose: false } })
  await say(p, 'hi')
  ok('the reply arrives and its tokens are counted…', await until(async () => Number(await counter(p).getAttribute('data-usage-tokens')) === 120, 15000))
  await sleep(1200)
  ok('…but with the headers NOT exposed the page shows NO limit line (it cannot read them, and invents nothing)', (await line(p).count()) === 0)
  await ctx.close()
}

// ═══ 4 — Anthropic's headers ═════════════════════════════════════════════════════════
{
  const w = makeWorld(); w.fnStatus = 404
  const reset = new Date(Date.now() + 41_000).toISOString()
  const { p, ctx } = await launch(w, { config: claude(), anthropic: { expose: true, headers: { 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49', 'anthropic-ratelimit-requests-reset': reset, 'anthropic-ratelimit-tokens-limit': '40000', 'anthropic-ratelimit-tokens-remaining': '4000', 'anthropic-ratelimit-tokens-reset': reset } } })
  await say(p, 'hi')
  await until(async () => (await line(p).count()) === 1, 15000)
  const t = (await line(p).textContent()).trim()
  ok('Anthropic: requests and tokens are both per minute; 4,000 of 40,000 tokens is 10%, so "low"', (await line(p).getAttribute('data-limits-level')) === 'low' && /49 req\/min · 4k tokens\/min left/.test(t), t)
  ok('and it says when the minute bucket refills', /refills in \d+s/.test(await line(p).getAttribute('title')))
  await ctx.close()
}

// ═══ 5 — a refusal: "opens again in 23s", from the provider's retry-after ══════════════
{
  const w = makeWorld(); w.fnStatus = 404
  const { p, ctx } = await launch(w, { config: groqC(), groq: { status: 429, expose: true, headers: groqHeaders(0, 14370, { 'retry-after': '23', 'x-ratelimit-reset-tokens': '23s' }) } })
  await say(p, 'hi')
  ok('a 429 is explained: used up for now, opens again in 23s, and the limit is the account\'s', await until(async () => /used up its allowance for now — it opens again in 23s/.test(await win(p).innerText()) && /whole organisation, not just this app/.test(await win(p).innerText()), 15000), (await win(p).innerText()).slice(-260))
  ok('the header shows the limit as reached', await until(async () => (await line(p).count()) === 1 && (await line(p).getAttribute('data-limits-level')) === 'out', 6000))
  ok('CONTROL: nothing was spent by a refused request', Number(await counter(p).getAttribute('data-usage-tokens')) === 0)
  await ctx.close()
}

// ═══ 6 — the server path: the reading is on the answer row, so every device and a reload see it ═══
{
  const w = makeWorld()
  const limits = { provider: 'groq', at: Date.now(), requests: { limit: 14400, remaining: 14370, resetAt: null }, tokens: { limit: 6000, remaining: 600, resetAt: Date.now() + 30_000 } }
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, model: 'llama-3.1-8b-instant', provider: 'groq', limits } }])
  const { p, ctx } = await launch(w, { config: groqC(), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  ok('a conversation opened on another device shows the reading stored with the answer', await until(async () => (await line(p).count()) === 1 && (await line(p).getAttribute('data-limits-level')) === 'low', 10000), (await line(p).textContent().catch(() => '')))
  ok('and its minute bucket counts down to a refill', /refills in \d+s/.test(await line(p).getAttribute('title')))
  await ctx.close()
}
// the reading is for the provider in use
{
  const w = makeWorld()
  const limits = { provider: 'groq', at: Date.now(), tokens: { limit: 6000, remaining: 10, resetAt: null } }
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, model: 'llama-3.1-8b-instant', provider: 'groq', limits } }])
  const { p, ctx } = await launch(w, { config: claude(), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  await until(async () => Number(await counter(p).getAttribute('data-usage-tokens')) === 120, 10000)
  ok('a Groq reading is NOT shown while Claude is the provider (it would be someone else\'s quota)', (await line(p).count()) === 0)
  await ctx.close()
}
// a bucket that has refilled since the reading
{
  const w = makeWorld()
  const limits = { provider: 'groq', at: Date.now() - 120_000, tokens: { limit: 6000, remaining: 10, resetAt: Date.now() - 60_000 } }
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, model: 'llama-3.1-8b-instant', provider: 'groq', limits } }])
  const { p, ctx } = await launch(w, { config: groqC(), goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  await until(async () => (await line(p).count()) === 1, 10000)
  ok('a minute bucket whose refill time has passed is shown full, not as the old shortfall', (await line(p).getAttribute('data-limits-level')) === 'ok' && /refilled since/.test(await line(p).getAttribute('title')) && /6k tokens\/min/.test(await line(p).textContent()), await line(p).textContent())
  ok('and it says how old the provider\'s word is', /As of 2m ago/.test(await line(p).getAttribute('title')), '')
  await ctx.close()
}

// ═══ 7 — it never costs the header's buttons their place ═══════════════════════════════
{
  const w = makeWorld()
  const LONG = 'meta-llama/llama-4-scout-17b-16e-instruct-extra-long-experimental-build-2026'
  const limits = { provider: 'groq', at: Date.now(), requests: { limit: 14400, remaining: 14370, resetAt: null }, tokens: { limit: 6000, remaining: 10, resetAt: Date.now() + 30_000 }, retryAfter: 23 }
  const cid = seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 123456, output: 7890, cacheRead: 0, cacheWrite: 0, model: LONG, provider: 'groq', limits } }])
  const { p, ctx } = await launch(w, { config: { ...groqC(), groqModel: LONG }, goto: 'http://localhost:5199/?c=' + cid })
  await open(p)
  await until(async () => (await line(p).count()) === 1, 10000)
  const m = await p.evaluate(() => {
    const l = document.querySelector('[data-limits-line]'); const close = document.querySelector('[data-assistant-window] button[aria-label="Close the assistant"]').getBoundingClientRect()
    const c = document.querySelector('[data-usage-counter]').getBoundingClientRect(); const lr = l.getBoundingClientRect(); const lab = document.querySelector('[data-model-label]')
    return { lineRight: lr.right, closeLeft: close.left, counterVisible: c.width > 40, clippedName: lab.scrollWidth > lab.clientWidth, text: l.textContent }
  })
  ok('with a very long model name, a big counter AND a limit line, the header still fits: the line stops short of the Close button and the counter is whole', m.lineRight <= m.closeLeft + 1 && m.counterVisible && m.clippedName, JSON.stringify(m))
  await ctx.close()
}

// ═══ 8 — Settings → AI shows the latest reading, with its age and what it covers ══════
{
  const w = makeWorld()
  const limits = { provider: 'groq', at: Date.now() - 20_000, requests: { limit: 14400, remaining: 14370, resetAt: null }, tokens: { limit: 6000, remaining: 0, resetAt: Date.now() + 30_000 }, retryAfter: 23 }
  seed(w, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, model: 'llama-3.1-8b-instant', provider: 'groq', limits } }])
  const { p, ctx } = await launch(w, { config: groqC(), module: 'settings' })
  await p.locator('main button').filter({ hasText: /^AI\d*$/ }).last().click({ timeout: 8000 })
  const row = p.locator('[data-live-limits]')
  await row.waitFor({ timeout: 10000 })
  ok('Settings → AI → Live limits: out, and when it opens again', await until(async () => (await row.getAttribute('data-live-limits')) === 'out' && /Limit reached · opens again in 23s/.test(await row.textContent()), 8000), await row.textContent())
  const lines = await p.locator('[data-live-limit-line]').allTextContents()
  ok('each bucket in full, with the age', lines.some(x => /14,370 of 14,400 requests left today/.test(x)) && lines.some(x => /0 of 6,000 tokens left this minute/.test(x)) && /As of 2\ds ago|As of 20s ago|As of 1\ds ago/.test(await p.locator('main').innerText()), JSON.stringify(lines))
  ok('and it is honest that this is a limit and not a balance', /not your credit balance/.test(await p.locator('main').innerText()) && /whole account/.test(await p.locator('main').innerText()))
  await ctx.close()
  const w2 = makeWorld()
  const none = await launch(w2, { config: groqC(), module: 'settings' })
  await none.p.locator('main button').filter({ hasText: /^AI\d*$/ }).last().click({ timeout: 8000 })
  ok('CONTROL: with no reading yet it says so, and shows no numbers', await until(async () => (await none.p.locator('[data-live-limits]').getAttribute('data-live-limits')) === 'none', 8000) && (await none.p.locator('[data-live-limit-line]').count()) === 0)
  await none.ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
