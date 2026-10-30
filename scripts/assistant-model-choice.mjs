// node scripts/assistant-model-choice.mjs   — needs a dev server on 5199
//
// "I changed to Groq and it gives me: The model `llama-3.3-70b-versatile` does not exist or you do not have access to
// it. Fix it, let me select the model in Settings, and show the model name in the chat window."
//
// A stand-in Groq/Anthropic that can SAY NO: the model in the report is refused (404, the exact words), others work,
// the list endpoint includes speech/guard models that must never be offered, and a billing refusal can be switched on.
// Every claim is read off what reached the provider, the saved config and the header's own box — not off the source.
import { chromium } from 'playwright-core'
import { session } from './session.mjs'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 12000, step = 120) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true } catch { /* not yet */ } await sleep(step) } return false }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const DEAD = 'llama-3.3-70b-versatile'
const LONG = 'meta-llama/llama-4-scout-17b-16e-instruct-extra-long-experimental-build-2026'

const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`
const anthropicText = t => ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }) + ev('content_block_stop', { type: 'content_block_stop', index: 0 }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) + ev('message_stop', { type: 'message_stop' })

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function launch({ config, module = 'morning', usable = ['openai/gpt-oss-120b', 'llama-3.1-8b-instant', LONG], billing = false, limitMsg = '', width = 1280 } = {}) {
  const seen = { groqChat: [], groqList: 0, anthropic: [], anthropicList: 0 }
  const ctx = await b.newContext({ viewport: { width, height: 1000 } })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const u = new URL(r.request().url())
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = x => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(session.user)
    if (u.pathname.startsWith('/auth/v1/token')) return j(session)
    return j(u.pathname.startsWith('/auth') ? {} : [])
  })
  await ctx.route('https://api.groq.com/**', async r => {
    const q = r.request(); const u = new URL(q.url())
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
    if (u.pathname.endsWith('/models')) { seen.groqList++; return j({ data: [DEAD, 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', LONG, 'whisper-large-v3', 'llama-guard-4-12b', 'playai-tts'].map(id => ({ id, active: true })) }) }
    const body = JSON.parse(q.postData() || '{}'); seen.groqChat.push(body)
    if (limitMsg && body.max_tokens !== 1) return j({ error: { message: limitMsg } }, 429)
    if (billing) return j({ error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }, 429)
    if (!usable.includes(body.model)) return j({ error: { message: `The model \`${body.model}\` does not exist or you do not have access to it.` } }, 404)
    return j({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Hello from ${body.model}` } }] })
  })
  await ctx.route('https://api.anthropic.com/**', async r => {
    const q = r.request(); const u = new URL(q.url())
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (u.pathname.endsWith('/models')) { seen.anthropicList++; return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-5-5' }, { id: 'claude-opus-5-5' }] }) }) }
    seen.anthropic.push(JSON.parse(q.postData() || '{}'))
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicText('Hello from Claude') })
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{}' }))
  await ctx.addInitScript(([s, cfg, mod]) => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify(cfg))
    localStorage.setItem('assistant-persona', JSON.stringify({ name: 'Beau', asked: true })) } catch {} }, [session, config, module])
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
  await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(1000)
  return { p, ctx, seen }
}
const groqCfg = (model = DEAD) => ({ provider: 'groq', groqKey: 'gsk_test1234567890', groqModel: model, anthropicKey: '', claudeModel: '' })
const saved = p => p.evaluate(() => JSON.parse(localStorage.getItem('professor-ai-config') || '{}'))
const win = p => p.locator('[data-assistant-window]')
const say = async (p, t) => { await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(500); const box = win(p).locator('textarea').first(); await box.fill(t); await box.press('Enter') }
const badge = p => p.locator('[data-model-badge]').first()
const openAI = async p => { await p.locator('main button').filter({ hasText: /^AI\d*$/ }).last().click({ timeout: 8000 }); await p.locator('input[aria-label="Model"]').waitFor({ timeout: 8000 }) }

// ═══ 1 ── Settings → AI: pick from what the key can use ═══════════════════════
{
  const { p, ctx, seen } = await launch({ config: groqCfg(), module: 'settings' })
  await openAI(p)
  const input = p.locator('input[aria-label="Model"]')
  ok('the Model box exists and holds the saved (dead) model', (await input.inputValue()) === DEAD)
  await p.waitForSelector('[data-model-status="bad"]', { timeout: 8000 }).catch(() => {})
  const status = await p.locator('[role="status"][data-model-status]').first().innerText().catch(() => '')
  ok('it TRIED the model with the key and says it cannot be used, in the provider\'s words', /cannot use this model/.test(status) && /does not exist or you do not have access/.test(status), status.slice(0, 160))
  ok('the probe was one token on the model being checked', seen.groqChat.some(c => c.model === DEAD && c.max_tokens === 1))
  const offered = await p.locator('datalist#ai-models-groq option').evaluateAll(os => os.map(o => o.value))
  ok('the list is what the key can use: the chat models are offered', offered.includes('openai/gpt-oss-120b') && offered.includes('llama-3.1-8b-instant') && offered.includes(DEAD), JSON.stringify(offered))
  ok('…and speech, guard and TTS models are NOT', !offered.some(o => /whisper|guard|tts/.test(o)), JSON.stringify(offered))
  const sug = p.locator('[data-model-suggestion]')
  ok('a one-click replacement is offered, the best the key can use', (await sug.count()) === 1 && (await sug.getAttribute('data-model-suggestion')) === 'openai/gpt-oss-120b')
  await sug.click()
  ok('choosing it fills the box and saves it', (await input.inputValue()) === 'openai/gpt-oss-120b' && (await saved(p)).groqModel === 'openai/gpt-oss-120b', JSON.stringify(await saved(p)))
  ok('then the same check says it works, and the suggestion goes away', await until(async () => /works with your key/.test(await p.locator('[role="status"][data-model-status]').first().innerText()), 8000) && (await sug.count()) === 0)
  await input.fill(LONG)
  ok('typing any id is allowed and saved (a newer model than the app has heard of)', (await saved(p)).groqModel === LONG)
  ok('CONTROL: the other provider\'s field is untouched', (await saved(p)).claudeModel === '')
  ok('the Groq key field still holds the Groq key (the provider labels were not disturbed)', await p.locator('input[placeholder="gsk_..."]').inputValue() === 'gsk_test1234567890')
  await ctx.close()
}

// ═══ 2 ── the report: send with a model the key cannot use ═════════════════════
{
  const { p, ctx, seen } = await launch({ config: groqCfg() })
  await say(p, 'hello')
  ok('the answer arrives, from a model that works', await until(async () => /Hello from openai\/gpt-oss-120b/.test(await win(p).innerText()), 15000), (await win(p).innerText()).slice(-200))
  const asked = seen.groqChat.map(c => c.model)
  ok('the dead model was tried once, a working one was tried, then the message went to that one', asked[0] === DEAD && asked.at(-1) === 'openai/gpt-oss-120b' && asked.filter(m => m === DEAD).length === 1, JSON.stringify(asked))
  ok('the real message did not go to the dead model', !seen.groqChat.some(c => c.model === DEAD && c.max_tokens !== 1))
  ok('the new model is SAVED, so it is not asked again', (await saved(p)).groqModel === 'openai/gpt-oss-120b')
  ok('the person is told what changed and where to change it', await until(async () => /Groq cannot use llama-3\.3-70b-versatile.*switched to openai\/gpt-oss-120b.*Settings → AI/s.test(await p.evaluate(() => document.body.innerText)), 4000))
  ok('the header names the model now in use', (await badge(p).getAttribute('data-model-id')) === 'openai/gpt-oss-120b' && /GPT OSS 120B/.test(await badge(p).textContent()), await badge(p).textContent())
  const before = seen.groqChat.length
  const box = win(p).locator('textarea').first(); await box.fill('and again'); await box.press('Enter')
  await until(async () => seen.groqChat.length > before, 8000)
  await sleep(500)
  ok('a second message costs no further check (one request, to the same model)', seen.groqChat.length === before + 1 && seen.groqChat.at(-1).model === 'openai/gpt-oss-120b', JSON.stringify(seen.groqChat.slice(before).map(c => c.model)))
  await ctx.close()
}
// CONTROL: a model that works is not touched
{
  const { p, ctx, seen } = await launch({ config: groqCfg('llama-3.1-8b-instant') })
  await say(p, 'hello')
  ok('CONTROL: a working model is used as chosen, with one check and no list request, and nothing is saved over it', await until(async () => /Hello from llama-3\.1-8b-instant/.test(await win(p).innerText()), 15000) && (await saved(p)).groqModel === 'llama-3.1-8b-instant' && seen.groqList === 0 && seen.groqChat.filter(c => c.max_tokens === 1).length === 1, JSON.stringify(seen.groqChat.map(c => [c.model, c.max_tokens])))
  await ctx.close()
}

// ═══ 3 ── billing is not a missing model ═══════════════════════════════════════
{
  const { p, ctx, seen } = await launch({ config: groqCfg('llama-3.1-8b-instant'), billing: true })
  await say(p, 'hello')
  ok('an account out of quota says so and points at the fix', await until(async () => /out of credit or past its billing date.*Settings → AI/s.test(await win(p).innerText()), 15000), (await win(p).innerText()).slice(-260))
  ok('CONTROL: it did not change the model on a billing error', (await saved(p)).groqModel === 'llama-3.1-8b-instant' && seen.groqList === 0)
  await ctx.close()
}

// ═══ 3b ── THE REPORT: a Groq rate limit (whose message ends in a "billing" link) is a rate limit ═══
{
  const REPORT = 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kmxnv3tbfj7v6xwq55m11kb5` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 1939, Requested 7776. Please try again in 3.567s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing'
  const { p, ctx, seen } = await launch({ config: groqCfg('openai/gpt-oss-120b'), usable: ['openai/gpt-oss-120b'], limitMsg: REPORT })
  await say(p, 'hello')
  ok('it is explained as a rate limit, with the provider\'s numbers and the real remedy', await until(async () => /per-minute limit on tokens for openai\/gpt-oss-120b: it allows 8,000, 1,939 were already used and this message needs about 7,776/.test(await win(p).innerText()) && /opens again in 4s/.test(await win(p).innerText()) && /nearly fills the whole allowance/.test(await win(p).innerText()), 15000), (await win(p).innerText()).slice(-420))
  ok('and it does NOT say "out of credit" (the bug in the report)', !/out of credit|billing date/.test(await win(p).innerText()))
  // (the control — a genuine quota/credit refusal still reads "out of credit" — is scenario 3 directly above)
  ok('the model was left alone (a rate limit says nothing about whether the model is yours)', (await saved(p)).groqModel === 'openai/gpt-oss-120b' && seen.groqList === 0)
  const real = seen.groqChat.filter(c => c.max_tokens !== 1)
  ok('the room reserved for the reply is 2,048, not 4,096 — Groq counts it against the per-minute allowance (this was 7,776 "requested")', real.length >= 1 && real.every(c => c.max_tokens === 2048), JSON.stringify(real.map(c => c.max_tokens)))
  await ctx.close()
}

// ═══ 4 — the chat window names the model, and a long one is cut with an ellipsis ═══
{
  const { p, ctx } = await launch({ config: groqCfg(LONG) })
  await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(600)
  const lab = p.locator('[data-model-label]').first()
  const m = await lab.evaluate(el => { const cs = getComputedStyle(el); const win = document.querySelector('[data-assistant-window]').getBoundingClientRect(); const b = el.closest('[data-model-badge]').getBoundingClientRect(); const x = document.querySelector('[data-assistant-window] button[aria-label="Close the assistant"]')?.getBoundingClientRect(); return { overflow: cs.textOverflow, ws: cs.whiteSpace, clip: el.scrollWidth > el.clientWidth, text: el.textContent, badgeRight: b.right, winRight: win.right, closeLeft: x?.left ?? null, closeRight: x?.right ?? null } })
  ok('a long model name is cut with an ellipsis (it really is wider than its box)', m.overflow === 'ellipsis' && m.ws === 'nowrap' && m.clip, JSON.stringify(m))
  ok('…and does not push the header\'s buttons out of the window', m.badgeRight <= (m.closeLeft ?? m.winRight) + 1 && (m.closeRight ?? 0) <= m.winRight + 1, `badge→${m.badgeRight} close ${m.closeLeft}..${m.closeRight} window→${m.winRight}`)
  ok('the full id is the tooltip and the accessible name', (await badge(p).getAttribute('title'))?.startsWith(LONG) && /Model: Groq/.test(await badge(p).getAttribute('aria-label')))
  await ctx.close()
  const short = await launch({ config: groqCfg('llama-3.1-8b-instant') })
  await short.p.locator('[data-assistant-fab]').click(); await short.p.waitForTimeout(600)
  const clipped = await short.p.locator('[data-model-label]').first().evaluate(el => el.scrollWidth > el.clientWidth)
  ok('CONTROL: a short name is shown whole, not clipped', clipped === false && /Llama 3\.1 8B/.test(await short.p.locator('[data-model-label]').first().innerText()))
  await short.ctx.close()
}

// ═══ 5 — change it in Settings and the open chat window follows, no reload ═════
{
  const { p, ctx } = await launch({ config: groqCfg('llama-3.1-8b-instant'), module: 'settings' })
  ok('the chat header starts on the saved model', (await badge(p).getAttribute('data-model-id')) === 'llama-3.1-8b-instant')
  await openAI(p)
  await p.locator('input[aria-label="Model"]').fill('openai/gpt-oss-120b')
  ok('changing it in Settings changes the chat header at once (no reload)', await until(async () => (await badge(p).getAttribute('data-model-id')) === 'openai/gpt-oss-120b', 4000))
  await ctx.close()
}

// ═══ 6 — Claude: choose the model, and the request uses it ═════════════════════
{
  const { p, ctx, seen } = await launch({ config: { provider: 'anthropic', anthropicKey: 'sk-ant-test1234567890', groqKey: '', groqModel: DEAD, claudeModel: '' }, module: 'settings' })
  await openAI(p)
  const input = p.locator('input[aria-label="Model"]')
  ok('Claude: the box is empty with the default shown as a placeholder (the app\'s default follows the app)', (await input.inputValue()) === '' && /claude-sonnet-4-6/.test(await input.getAttribute('placeholder')))
  const offered = await p.locator('datalist#ai-models-anthropic option').evaluateAll(os => os.map(o => o.value))
  ok('Claude: the list is what the key can use', await until(async () => (await p.locator('datalist#ai-models-anthropic option').count()) === 3, 6000) && offered !== null, JSON.stringify(offered))
  await input.fill('claude-haiku-5-5')
  ok('choosing a Claude model saves claudeModel and leaves the Groq choice alone', (await saved(p)).claudeModel === 'claude-haiku-5-5' && (await saved(p)).groqModel === DEAD)
  ok('the header says Haiku 5.5', await until(async () => /Haiku 5\.5/.test(await badge(p).textContent()), 4000), await badge(p).textContent())
  await say(p, 'hi')
  // the app asks Claude things of its own too (Today); the assistant's request is the one that carries its tools
  await until(async () => seen.anthropic.some(r => r.tools?.length), 12000)
  const chat = seen.anthropic.filter(r => r.tools?.length)
  ok('Claude keeps its full 4,096-token reply room (only Groq is capped)', seen.anthropic.filter(r => r.tools?.length).every(r => r.max_tokens === 4096), JSON.stringify(seen.anthropic.map(r => r.max_tokens)))
  ok('and the assistant\'s request went to the chosen model, not the default', chat.length >= 1 && chat.every(r => r.model === 'claude-haiku-5-5'), JSON.stringify(chat.map(r => r.model)))
  ok('the app\'s other Claude calls follow the choice too', seen.anthropic.filter(r => !r.tools?.length).every(r => r.model === 'claude-haiku-5-5'), JSON.stringify(seen.anthropic.map(r => r.model)))
  // back to the default
  await p.locator('[data-assistant-fab]').click().catch(() => {})
  await openAI(p).catch(() => {})
  await p.getByRole('button', { name: 'Use the default' }).click({ timeout: 6000 }).catch(() => {})
  ok('"Use the default" clears it, and the header returns to the app\'s default', (await saved(p)).claudeModel === '' && await until(async () => /Sonnet 4\.6/.test(await badge(p).textContent()), 4000))
  await ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
