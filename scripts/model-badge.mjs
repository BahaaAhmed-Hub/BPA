// node scripts/model-badge.mjs   — needs a dev server on 5199 (restart after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// The panel header says which model it is — a mark and a version ("Sonnet 4.6") —
// instead of "Anthropic · Claude", which is true of every Claude model and so of
// none in particular. The claim worth proving is not that the text is pretty but that
// it is TRUE: the id on the badge is the id the request sends. So the request is
// intercepted and the two compared, not the source read.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { describeModel, ASSISTANT_CLAUDE_MODEL } from '../src/lib/modelInfo.ts'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const L = (prov, id) => describeModel(prov, id).label

// ── pure: names and versions ─────────────────────────────────────────────────
ok('claude-sonnet-4-6 is Sonnet 4.6', L('anthropic', 'claude-sonnet-4-6') === 'Sonnet 4.6')
ok('a dated id keeps its minor version and drops the date: …4-5-20250929 is 4.5, not 4.5.20250929', L('anthropic', 'claude-sonnet-4-5-20250929') === 'Sonnet 4.5')
ok('a model with no minor version is just its major', L('anthropic', 'claude-opus-5') === 'Opus 5' && L('anthropic', 'claude-opus-4-20250514') === 'Opus 4')
ok('the older id order reads the same way: claude-3-5-sonnet-20241022 is Sonnet 3.5', L('anthropic', 'claude-3-5-sonnet-20241022') === 'Sonnet 3.5' && L('anthropic', 'claude-3-haiku-20240307') === 'Haiku 3')
ok('haiku and opus too', L('anthropic', 'claude-haiku-4-5') === 'Haiku 4.5' && L('anthropic', 'claude-opus-4-1') === 'Opus 4.1')
ok('an id it does not recognise is shown as itself, never a guessed name', L('anthropic', 'claude-experimental-x') === 'claude-experimental-x' && describeModel('anthropic', 'claude-experimental-x').version === '')
ok('Groq: llama-3.3-70b-versatile is Llama 3.3 70B (no "versatile")', L('groq', 'llama-3.3-70b-versatile') === 'Llama 3.3 70B')
ok('Groq: the context window is not a version — mixtral-8x7b-32768 is Mixtral 8x7B', L('groq', 'mixtral-8x7b-32768') === 'Mixtral 8x7B' && describeModel('groq', 'mixtral-8x7b-32768').version === '')
ok('Groq: llama-3.1-8b-instant and gemma2-9b-it', L('groq', 'llama-3.1-8b-instant') === 'Llama 3.1 8B' && L('groq', 'gemma2-9b-it') === 'Gemma2 9B')
ok('the mark follows the provider, and the vendor is named', describeModel('anthropic', 'claude-sonnet-4-6').mark === 'claude' && describeModel('groq', 'llama-3.1-8b-instant').mark === 'groq' && describeModel('anthropic', 'claude-sonnet-4-6').vendor === 'Anthropic')

// ── the page ───────────────────────────────────────────────────────────────
const sse = text => [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-6', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
  ['message_stop', { type: 'message_stop' }],
].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function launch(cfg) {
  const sent = []
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.route('**://placeholder.supabase.co/**', r => { const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(user); if (u.pathname.startsWith('/auth/v1/token')) return j(session); return j(u.pathname.startsWith('/auth') ? {} : []) })
  await ctx.route('https://api.anthropic.com/**', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const body = JSON.parse(r.request().postData() || '{}'); if (body.tools?.length) sent.push(body.model)
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('Done.') })
  })
  await ctx.addInitScript(([s, c]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify(c))
    localStorage.setItem('assistant-persona', JSON.stringify({ name: 'Bibo', asked: true }))
  }, [session, cfg])
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
  await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 }); await p.waitForTimeout(1200)
  await p.locator('[data-assistant-fab]').click(); await p.waitForTimeout(600)
  return { p, ctx, sent }
}
const badge = p => p.locator('[data-assistant-window] [data-model-badge]')

// Claude
let { p, ctx, sent } = await launch({ provider: 'anthropic', anthropicKey: 'sk-ant-test', groqKey: '', groqModel: 'llama-3.3-70b-versatile' })
ok('the header has a model badge', await badge(p).count() === 1)
// The badge now also carries the usage counter ("· 0 tokens") beside the name, so the NAME is read from its own element.
const label = p => badge(p).locator('[data-model-label]')
ok('it reads "Sonnet 4.6"', (await label(p).innerText()).trim() === 'Sonnet 4.6', JSON.stringify(await label(p).innerText()))
ok('and the usage counter sits beside the name, in the same badge', (await badge(p).locator('[data-usage-counter]').count()) === 1 && /tokens?$/.test((await badge(p).locator('[data-usage-counter]').innerText()).trim()), JSON.stringify(await badge(p).innerText()))
ok('and not the old "Anthropic · Claude"', !/Anthropic · Claude/.test(await p.locator('[data-assistant-window]').innerText()))
ok('it carries a drawn mark: eight rays', await badge(p).locator('svg line').count() === 8)
ok('and says what it is to a screen reader, with the vendor', (await badge(p).getAttribute('aria-label')).startsWith('Model: Anthropic Sonnet 4.6') && /claude-sonnet-4-6 · Anthropic/.test(await badge(p).getAttribute('title')))
await p.locator('[data-assistant-window] textarea').fill('hello'); await p.locator('[data-assistant-window] textarea').press('Enter')
await p.waitForFunction(() => /Done/.test(document.querySelector('[data-assistant-window]')?.textContent ?? ''), null, { timeout: 15000 })
const claimed = await badge(p).getAttribute('data-model-id')
ok('THE CLAIM: the id on the badge is the id the request actually sent', sent.length === 1 && sent[0] === claimed && claimed === ASSISTANT_CLAUDE_MODEL, `sent=${sent[0]} badge=${claimed}`)
// colours come from tokens, so the mark reads on every ground
ok('the mark takes a theme token, not a brand hex', await badge(p).locator('svg').first().evaluate(s => /var\(--sb-/.test(s.getAttribute('style') ?? '')))
await ctx.close()

// Groq
;({ p, ctx } = await launch({ provider: 'groq', anthropicKey: '', groqKey: 'gsk_test', groqModel: 'llama-3.3-70b-versatile' }))
ok('on Groq the badge reads the Groq model: "Llama 3.3 70B"', (await label(p).innerText()).trim() === 'Llama 3.3 70B', JSON.stringify(await label(p).innerText()))
ok('with its own mark — no rays', await badge(p).locator('svg line').count() === 0 && await badge(p).locator('svg path').count() === 1)
ok('and the Groq id is the one on the badge', await badge(p).getAttribute('data-model-id') === 'llama-3.3-70b-versatile')
await ctx.close()

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
