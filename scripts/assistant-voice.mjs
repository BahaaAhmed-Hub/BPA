// node scripts/assistant-voice.mjs   — needs a dev server on 5199 (restart after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Calling the assistant by name: from the search box, by tapping the mic, and by
// "listen for its name while the app is open". There is no microphone here, so a
// fake SpeechRecognition (the one iPhone Safari exposes as webkitSpeechRecognition)
// and a fake speechSynthesis are injected, and Claude is faked as a *stream* —
// the SDK ends "without sending any chunks" for anything else.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { backoffMs, recognitionLang, speechText } from '../src/lib/speech.ts'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── pure ────────────────────────────────────────────────────────────────────
ok('what is read aloud has no markup, code, links or lists', speechText('## Today\n- **Two** meetings: see [the diary](https://x.y/z)\n```js\nconsole.log(1)\n```\nNothing else.') === 'Today Two meetings: see the diary Nothing else.', speechText('## Today\n- **Two** meetings: see [the diary](https://x.y/z)\n```js\nconsole.log(1)\n```\nNothing else.'))
ok('and not a wall of it: cut at a sentence, with an ellipsis only when cut mid-sentence', speechText('One. '.repeat(200)).length <= 481 && speechText('One. '.repeat(200)).endsWith('One.') && speechText('word '.repeat(300)).endsWith('…') && speechText('Short.') === 'Short.' && speechText('') === '')
ok('the listening loop backs off and is capped', [0, 1, 2, 3, 4, 9].map(backoffMs).join() === '400,800,1600,3200,5000,5000')
ok('the language is what was chosen, else the browser’s, else English — never junk', recognitionLang('ar-EG', 'en-US') === 'ar-EG' && recognitionLang('', 'fr-FR') === 'fr-FR' && recognitionLang('', '') === 'en-US' && recognitionLang('<script>', 'en-GB') === 'en-US')

// ── the page ────────────────────────────────────────────────────────────────
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
let asked = []
async function open({ persona = { name: 'Beau', asked: true }, speech = true } = {}) {
  asked = []
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(user)
    if (u.pathname.startsWith('/auth/v1/token')) return j(session)
    return j(u.pathname.startsWith('/auth') || u.pathname.endsWith('/rpc/my_modules') ? (u.pathname.endsWith('my_modules') ? [] : {}) : [])
  })
  await ctx.route('https://api.anthropic.com/**', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const body = JSON.parse(r.request().postData() || '{}')
    if (body.tools?.length) asked.push(body)   // the Today screen asks Claude things of its own; only the assistant sends tools
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('You have **nothing** on today. See [the diary](https://x.y).') })
  })
  await ctx.addInitScript(([s, pr, sp]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test' }))
    localStorage.setItem('assistant-persona', JSON.stringify(pr))
    window.__srs = []; window.__spoken = []
    if (!sp) { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; try { Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }) } catch { /* already gone */ } }
    if (sp) {
      window.webkitSpeechRecognition = window.SpeechRecognition = class { constructor() { window.__srs.push(this); this.started = false }
        start() { if (this.started) throw new Error('InvalidStateError'); this.started = true }
        stop() { this.abort() } abort() { if (this.started) { this.started = false; setTimeout(() => this.onend && this.onend(), 0) } } }
      window.__live = () => window.__srs.filter(x => x.started).at(-1)
      window.__say = (text, final = true) => { const r = window.__live(); r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] }); if (final && !r.continuous) { r.started = false; setTimeout(() => r.onend && r.onend(), 0) } }  // a one-shot session ends itself after its phrase
      window.__fail = code => { const r = window.__live(); r.onerror({ error: code }); r.started = false; r.onend() }
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.volume = 1 } }
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { if (u.volume === 0) return; window.__spoken.push(u.text); window.__utter = u; u.onstart && u.onstart() }, cancel() {} } })
      window.__endSpeech = () => window.__utter && window.__utter.onend && window.__utter.onend()
    }
  }, [session, persona, speech])
  const p = await ctx.newPage()
  p.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200)) })
  p.on('pageerror', e => console.log('  [pageerror]', String(e.stack || e).slice(0, 300)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
const lastUser = body => { const m = [...(body.messages ?? [])].reverse().find(x => x.role === 'user'); return typeof m?.content === 'string' ? m.content : (m?.content ?? []).map(c => c.text ?? '').join('') }
const panelText = p => p.locator('body').innerText()

// A — the search box
let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)
await p.keyboard.press('Control+k'); await wait(400)
await p.keyboard.type('Beau, what is on today'); await wait(400)
const first = await p.locator('[data-idx="0"]').first().innerText()
ok('typing "Beau, …" offers to ask it first, ahead of "create a task"', /Ask Beau: “what is on today”/.test(first), first.replace(/\n/g, ' '))
await p.keyboard.press('Enter'); await wait(2500)
ok('Enter opens the assistant and sends only what comes after the name', asked.length === 1 && lastUser(asked[0]) === 'what is on today', lastUser(asked[0] ?? {}))
ok('it knows what it is called, and says so in its header', JSON.stringify(asked[0]?.system ?? '').includes('The user calls you Beau') && /Beau/.test(await p.locator('body').innerText()))
ok('typed, the answer is written and not spoken', /nothing/.test(await p.locator('body').innerText()) && (await p.evaluate(() => window.__spoken)).length === 0)
await p.keyboard.press('Control+k'); await wait(300)
await p.keyboard.type('Beau budget'); await wait(400)
ok('an unmarked "Beau budget" stays a search for budget things', !/Ask Beau/.test(await p.locator('[data-idx="0"]').first().innerText()))
await p.keyboard.press('Escape')

// B — the mic
await p.getByRole('button', { name: 'Talk to Beau', exact: true }).last().click(); await wait(400)
ok('tapping the mic starts a one-shot session in the browser’s language', await p.evaluate(() => { const r = window.__live(); return !!r && r.lang === navigator.language && r.continuous === false && r.interimResults === true }))
await p.evaluate(() => window.__say('add m', false)); await wait(150)
ok('words appear as they are heard', /“add m”/.test(await panelText(p)))
await p.evaluate(() => window.__say('Beau, add milk to the list')); await wait(2500)
ok('"Beau, add milk" sends "add milk to the list" — the name is not part of the request', asked.length === 2 && lastUser(asked[1]) === 'add milk to the list', lastUser(asked[1] ?? {}))
const spoken = await p.evaluate(() => window.__spoken)
ok('a spoken question is answered aloud, once, with the markup removed', spoken.length === 1 && spoken[0] === 'You have nothing on today. See the diary.', JSON.stringify(spoken))
await p.getByRole('button', { name: 'Talk to Beau', exact: true }).last().click(); await wait(300)
await p.evaluate(() => window.__say('what about tomorrow')); await wait(2500)
ok('without the name, what was said is the request', asked.length === 3 && lastUser(asked[2]) === 'what about tomorrow')
await p.getByRole('button', { name: 'Talk to Beau', exact: true }).last().click(); await wait(300)
await p.evaluate(() => window.__say('Beau')); await wait(700)
ok('only the name means "I’m here": it listens again for the request, and sends nothing', asked.length === 3 && /Listening/.test(await panelText(p)) && await p.evaluate(() => !!window.__live()))
await p.evaluate(() => window.__fail('not-allowed')); await wait(300)
ok('a blocked microphone is said plainly, with what to do', /microphone is switched off/.test(await panelText(p)))
await ctx.close()

// C — listening for the name while the app is open
;({ p, ctx } = await open({ persona: { name: 'Beau', asked: true, listen: true } }))
await wait(1500)
const live0 = await p.evaluate(() => { const r = window.__live(); return !!r && r.continuous === true })
const pill0 = await p.getByText(/Listening for “Beau”/).count()
ok('with the setting on, a continuous session is running and a visible pill says so', live0 && pill0 === 1, JSON.stringify({ live0, pill0 }))
await p.evaluate(() => window.__say('I told Beau about it')); await wait(800)
ok('a sentence that merely mentions the name does nothing', asked.length === 0)
await p.evaluate(() => window.__say('hey Beau what time is it')); await wait(2500)
ok('"hey Beau, …" opens the assistant and asks it — hands free', asked.length === 1 && lastUser(asked[0]) === 'what time is it')
ok('and, because it was spoken, the answer is spoken', (await p.evaluate(() => window.__spoken)).length === 1)
await p.evaluate(() => window.__say('Beau stop talking')); await wait(600)
ok('it does not hear its own voice: speech heard while it is speaking is ignored', asked.length === 1)
await p.evaluate(() => window.__endSpeech()); await wait(1000)
await p.evaluate(() => window.__say('Beau what about tomorrow')); await wait(2500)
ok('and listens again once it has finished', asked.length === 2 && lastUser(asked[1]) === 'what about tomorrow')
// hidden → stops; visible → returns
const before = await p.evaluate(() => window.__srs.length)
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) }); await wait(500)
ok('when the page is hidden it stops listening — a web page may not listen in the background', await p.evaluate(() => !window.__live()))
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) }); await wait(1200)
ok('and when it is visible again it comes back', await p.evaluate(() => !!window.__live()) && await p.evaluate(() => window.__srs.length) > before)
// the mic button shares the microphone
await p.getByRole('button', { name: 'Talk to Beau', exact: true }).last().click(); await wait(500)
ok('the panel’s mic takes the microphone and the listener waits rather than fighting it', await p.evaluate(() => window.__live()?.continuous === false))
await p.evaluate(() => window.__say('cancel that')); await wait(3500)
ok('after it, the listener has the microphone back', await p.evaluate(() => window.__live()?.continuous === true))
await ctx.close()

// D — iPhone: not allowed to start without a tap
;({ p, ctx } = await open({ persona: { name: 'Beau', asked: true, listen: true } }))
await wait(800)
await p.evaluate(() => window.__fail('service-not-allowed')); await wait(500)
ok('where the browser refuses to start without a tap, the pill becomes the tap — and says so', await p.getByRole('button', { name: /Tap to listen for Beau/ }).count() === 1)
await p.getByRole('button', { name: /Tap to listen for Beau/ }).click(); await wait(500)
ok('tapping it starts listening', await p.evaluate(() => window.__live()?.continuous === true) && await p.getByText(/Listening for “Beau”/).count() === 1)
await p.evaluate(() => window.__fail('not-allowed')); await wait(500)
ok('a refused microphone is named, not retried for ever', /microphone is blocked/.test(await p.locator('body').innerText()))
await p.getByRole('button', { name: 'Talk to Beau' }).first().isVisible().catch(() => false)
const n = await p.evaluate(() => window.__srs.length); await wait(4500)
ok('…and it stays blocked: no session is started behind its back', await p.evaluate(() => window.__srs.length) === n)
await ctx.close()

// E — a browser with no speech recognition
;({ p, ctx } = await open({ persona: { name: 'Beau', asked: true, listen: true }, speech: false }))
await p.getByRole('button', { name: /Talk to Beau/ }).last().click(); await wait(800)
ok('no microphone button, and no pill promising to listen, where the browser cannot', await p.getByRole('button', { name: 'Talk to Beau', exact: true }).count() === 0 && await p.getByText(/Listening for/).count() === 0)
await ctx.close()

// F — unnamed
;({ p, ctx } = await open({ persona: { name: '', asked: false, listen: true } }))
await p.getByRole('button', { name: /Talk to your assistant/ }).click(); await wait(600)
ok('with no name it asks for one first, and listens for nothing', await p.getByText('What would you like to call me?').count() === 1 && await p.evaluate(() => !window.__live()) && await p.getByText(/Listening for/).count() === 0)
await p.getByRole('button', { name: 'Hadi', exact: true }).click(); await wait(800)
ok('choosing a name saves it, and the panel greets by it', /I’m Hadi/.test(await p.locator('body').innerText()) && JSON.parse(await p.evaluate(() => localStorage.getItem('assistant-persona'))).name === 'Hadi')
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
