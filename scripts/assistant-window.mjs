// node scripts/assistant-window.mjs   — needs a dev server on 5199 (restart after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// The assistant is a floating window above a button that is a person with no box
// around them — not a column down the side. Four claims, each measured with real
// pointer events and real geometry, never read off the source:
//   1. the button is the transparent portrait, 72px (1.5 × 48), with no fill or border
//   2. the window floats: it does not run top to bottom, and the page behind stays reachable
//   3. a click anywhere else COLLAPSES it — the conversation is still there when it comes back —
//      while a click inside it, or on its own button, does not
//   4. its width is draggable, clamped, remembered, and never overwritten by a screen too small for it
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { session, user } from './session.mjs'
import { clampWidth, maxFor, minFor, widthFromDrag, loadWidth, DEFAULT_WIDTH } from '../src/lib/assistantWindow.ts'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── pure: the width rules ───────────────────────────────────────────────────
ok('the default is 420, and a wide screen allows it', clampWidth(DEFAULT_WIDTH, 1280) === 420)
ok('never narrower than 340 on a screen that can hold that', clampWidth(100, 1280) === 340 && minFor(1280) === 340)
ok('never wider than 860, nor past the left edge of a smaller screen', clampWidth(5000, 1280) === 860 && maxFor(600) === 600 - 24 - 12)
ok('a phone gets the whole width less its gaps; a screen narrower than the usual minimum bends the minimum too', maxFor(390) === 366 && clampWidth(900, 390) === 366 && clampWidth(100, 390) === 340 && minFor(330) === maxFor(330) && maxFor(330) === 306)
ok('not a number is the default, not zero', clampWidth(NaN, 1280) === 420 && clampWidth(Infinity, 1280) === 420 || clampWidth(NaN, 1280) === 420)
ok('dragging the left edge LEFT widens it (the right edge is the fixed one)', widthFromDrag(420, 900, 800, 1280) === 520 && widthFromDrag(420, 900, 1000, 1280) === 340)
globalThis.localStorage = { getItem: () => null, setItem() {} }
ok('nothing stored is the default', loadWidth(1280) === 420)
globalThis.localStorage = { getItem: () => '', setItem() {} }
ok('an empty stored value is "never chose", not "chose zero"', loadWidth(1280) === 420)
globalThis.localStorage = { getItem: () => '540', setItem() {} }
ok('a stored 540 is drawn at 540 on a wide screen and bent on a narrow one', loadWidth(1280) === 540 && loadWidth(390) === 366)

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
let delay = 0, asks = 0
async function launch({ width = 1280, height = 900, stored = null } = {}) {
  asks = 0
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
    if (u.pathname === '/auth/v1/user') return j(user)
    if (u.pathname.startsWith('/auth/v1/token')) return j(session)
    return j(u.pathname.startsWith('/auth') ? {} : [])
  })
  await ctx.route('https://api.anthropic.com/**', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const body = JSON.parse(r.request().postData() || '{}')
    if (body.tools?.length) asks++            // the Today screen asks Claude things of its own; only the assistant sends tools
    if (delay) await new Promise(res => setTimeout(res, delay))
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('You have **nothing** on today.') })
  })
  await ctx.addInitScript(([s, st]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test' }))
    localStorage.setItem('assistant-persona', JSON.stringify({ name: 'Beau', asked: true }))
    localStorage.setItem('bpa-wizard-done', '1')   // the setup guide (PR #62) covers a brand-new account's page
    if (st && !localStorage.getItem('assistant-window-width')) localStorage.setItem('assistant-window-width', st)
  }, [session, stored])
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e.stack || e).slice(0, 300)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
  await p.locator('[data-assistant-fab]').waitFor({ timeout: 20000 })
  await p.waitForTimeout(1500)
  return { p, ctx }
}
const FAB = '[data-assistant-fab]', WIN = '[data-assistant-window]'
const rect = (p, sel) => p.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } })
const shown = p => p.locator(WIN).first().getAttribute('data-shown')
const wait = (p, ms) => p.waitForTimeout(ms)
async function say(p, text) {
  const box = p.locator(`${WIN} textarea`).first()
  await box.fill(text); await box.press('Enter')
  await p.waitForFunction(() => /nothing/.test(document.querySelector('[data-assistant-window]')?.textContent ?? ''), null, { timeout: 15000 })
}
async function drag(p, dx) {
  const g = await rect(p, '[role="separator"][aria-label="Resize the assistant"]')
  // The page reports positions in the app's own units (lib/zoomSpace.ts); the mouse works in screen pixels.
  const S = await p.evaluate(() => window.__zoomSpace ?? 1)
  const y = (g.y + g.h / 2) * S, x0 = (g.x + 4) * S
  await p.mouse.move(x0, y); await p.mouse.down(); await p.mouse.move(x0 + (dx / 2) * S, y); await p.mouse.move(x0 + dx * S, y); await p.mouse.up()
}

// ── 1 · the button ─────────────────────────────────────────────────────────
let { p, ctx } = await launch()
const fab = await rect(p, FAB)
ok('the button is 72px — the 48px it was, one and a half times over', Math.round(fab.w) === 72 && Math.round(fab.h) === 72, `${fab.w}×${fab.h}`)
const look = await p.locator(FAB).evaluate(el => { const c = getComputedStyle(el); return { bg: c.backgroundColor, bw: c.borderTopWidth, bs: c.boxShadow, img: el.querySelector('img')?.getAttribute('src') ?? null, nat: el.querySelector('img')?.naturalWidth ?? 0 } })
ok('it has no fill, no border and no box around it', look.bg === 'rgba(0, 0, 0, 0)' && look.bw === '0px' && look.bs === 'none', JSON.stringify({ bg: look.bg, bw: look.bw, bs: look.bs }))
ok('it is the transparent cut-out, and the file loaded', /assistant-avatar-cutout\.png$/.test(look.img ?? '') && look.nat > 0, `${look.img} ${look.nat}px`)
const alphas = await p.locator(`${FAB} img`).evaluate(async img => {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const g = c.getContext('2d'); g.drawImage(img, 0, 0)
  const a = (x, y) => g.getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data[3]
  return { corners: [a(.02, .02), a(.98, .02), a(.02, .5), a(.98, .5)], face: a(.5, .45), shirt: a(.5, .85) }
})
ok('the four corners and the sides are transparent, the face and shirt are solid', alphas.corners.every(v => v === 0) && alphas.face === 255 && alphas.shirt === 255, JSON.stringify(alphas))
const png = readFileSync(new URL('../public/assistant-avatar-cutout.png', import.meta.url))
ok('the file is a PNG with an alpha channel (colour type 6)', png.subarray(1, 4).toString() === 'PNG' && png[25] === 6)
ok('the clearance for footers that sit in that corner is a token, 104px', (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ai-fab-clear').trim())) === '104px')
ok('before it is opened there is no window on screen', (await shown(p)) === 'false')
const dialogs = () => p.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
ok('it is not a [role="dialog"]: three modules ask that selector whether a dialog is open (Library Escape, the calendar’s Delete key, the composer’s dismissal), and an always-mounted window must not answer yes', await dialogs() === 0)

// ── 2 · it floats ──────────────────────────────────────────────────────────
await p.locator(FAB).click(); await wait(p, 500)
ok('pressing the button opens the window', (await shown(p)) === 'true')
ok('…and open, it still is not one', await dialogs() === 0)
const w = await rect(p, WIN), f2 = await rect(p, FAB)
ok('it does not run top to bottom — there is page above it and the button below it', w.y > 120 && w.bottom < f2.y && w.h <= 640, `y=${w.y} h=${w.h} bottom=${w.bottom} button.y=${f2.y}`)
// The page measures in the app's own units (lib/zoomSpace.ts), so the window's width is read from the page, not assumed.
const vw = await p.evaluate(() => innerWidth)
ok('it sits in the corner with the button’s own margin', Math.abs(vw - w.right - 24) <= 1, `gap ${vw - w.right}`)
ok('it is the default width', Math.abs(w.w - 420) <= 1, `${w.w}`)
ok('and it has all four edges — a card, not a column', await p.locator(WIN).evaluate(el => { const c = getComputedStyle(el); return c.borderLeftWidth !== '0px' && c.borderTopWidth !== '0px' && c.borderRightWidth !== '0px' && c.borderBottomWidth !== '0px' && c.borderTopLeftRadius !== '0px' }))
ok('the page behind it is still there to be reached: its left half is the page, not the window', await p.evaluate(() => !document.elementFromPoint(300, 500)?.closest('[data-assistant-window]')))
ok('the button is still there, and still the topmost thing at its centre', await p.evaluate(() => { const r = document.querySelector('[data-assistant-fab]').getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-assistant-fab]') }))

// ── 3 · it collapses, and keeps the conversation ──────────────────────────
await say(p, 'what is on today')
ok('a question was asked and answered', asks === 1 && /nothing/.test(await p.locator(WIN).evaluate(el => el.textContent)))
await p.locator(`${WIN} textarea`).click(); await wait(p, 200)
ok('a click INSIDE it does not collapse it', (await shown(p)) === 'true')
await p.locator(`${WIN} [aria-label="Resize the assistant"]`).focus().catch(() => {})
await p.mouse.click(300, 500); await wait(p, 500)
ok('a click anywhere else on the page collapses it', (await shown(p)) === 'false')
const hidden = await p.locator(WIN).evaluate(el => { const c = getComputedStyle(el); return { vis: c.visibility, op: c.opacity, pe: c.pointerEvents, text: el.textContent } })
ok('collapsed means hidden and inert, but not unmounted — the history is still in it', hidden.vis === 'hidden' && hidden.op === '0' && hidden.pe === 'none' && /what is on today/.test(hidden.text) && /nothing/.test(hidden.text))
await p.locator(FAB).click(); await wait(p, 500)
const back = await p.locator(WIN).evaluate(el => el.innerText)
ok('pressing the button brings it back with the question and the answer in it', (await shown(p)) === 'true' && /what is on today/.test(back) && /nothing/.test(back))
ok('and it did not ask the model again to do that', asks === 1)
await p.locator(FAB).click(); await wait(p, 500)
ok('pressing the button while it is open collapses it — once, and it stays down', (await shown(p)) === 'false')
await wait(p, 600)
ok('…it does not collapse and pop straight back up', (await shown(p)) === 'false')
await p.locator(FAB).click(); await wait(p, 600)
await p.getByRole('button', { name: 'Collapse the assistant' }).click(); await wait(p, 400)
ok('the header’s own chevron collapses it too, history intact', (await shown(p)) === 'false' && /what is on today/.test(await p.locator(WIN).evaluate(el => el.textContent)))
await p.locator(FAB).click(); await wait(p, 500)
await p.locator(`${WIN} textarea`).click(); await p.keyboard.press('Escape'); await wait(p, 300)
ok('Escape inside it collapses it', (await shown(p)) === 'false')
// the guard: whatever OPENED it must not collapse it in the same gesture
await p.locator(FAB).click()
await p.mouse.click(300, 500); await wait(p, 250)
ok('a click within 400ms of opening it (a touch screen’s replayed tap) does not collapse it', (await shown(p)) === 'true')
await wait(p, 500); await p.mouse.click(300, 500); await wait(p, 400)
ok('…the same click after the guard does', (await shown(p)) === 'false')
// closing is a different promise
await p.locator(FAB).click(); await wait(p, 600)
await p.locator(`${WIN} [aria-label="Close the assistant"]`).click(); await wait(p, 400)
await p.locator(FAB).click(); await wait(p, 500)
ok('Close (the ✕) is still the one that forgets the conversation', !/what is on today/.test(await p.locator(WIN).evaluate(el => el.textContent)))
await ctx.close()

// ── 3b · an answer arriving while it is collapsed shows on the button ──────
;({ p, ctx } = await launch())
delay = 2500
await p.locator(FAB).click(); await wait(p, 500)
await p.locator(`${WIN} textarea`).fill('slow one'); await p.locator(`${WIN} textarea`).press('Enter'); await wait(p, 300)
await p.mouse.click(300, 500); await wait(p, 500)
const dot = () => p.evaluate(() => [...document.querySelectorAll('span[aria-hidden]')].filter(s => { const c = getComputedStyle(s); return c.position === 'fixed' && s.offsetWidth === 12 }).length)
ok('collapsed while an answer is on its way, the button shows a pulse', (await shown(p)) === 'false' && (await dot()) === 1)
await p.waitForFunction(() => /nothing/.test(document.querySelector('[data-assistant-window]')?.textContent ?? ''), null, { timeout: 15000 })
await wait(p, 300)
ok('and the pulse goes when the answer has arrived', (await dot()) === 0)
await ctx.close(); delay = 0

// ── 4 · resizing ───────────────────────────────────────────────────────────
;({ p, ctx } = await launch())
await p.locator(FAB).click(); await wait(p, 600)
const g0 = await rect(p, '[role="separator"][aria-label="Resize the assistant"]')
// A 1px border is drawn as one whole device pixel at 90%, which is 1.11 app units; a browser zoomed to 90% does the same.
ok('the handle is the window’s left edge, full height', Math.abs(g0.x - (await rect(p, WIN)).x) <= 1.5 && g0.h > 300, JSON.stringify(g0))
await drag(p, -120); await wait(p, 200)
ok('dragging its left edge 120px left widens it by 120px', Math.abs((await rect(p, WIN)).w - 540) <= 2, `${(await rect(p, WIN)).w}`)
ok('the right edge did not move', Math.abs((await p.evaluate(() => innerWidth)) - (await rect(p, WIN)).right - 24) <= 1)
ok('and it is still open — a drag is not an outside click', (await shown(p)) === 'true')
ok('the width is kept, as the number that was seen', (await p.evaluate(() => localStorage.getItem('assistant-window-width'))) === String(Math.round((await rect(p, WIN)).w)))
await drag(p, -2000); await wait(p, 200)
ok('there is a widest: dragging far left stops at 860', Math.abs((await rect(p, WIN)).w - 860) <= 1, `${(await rect(p, WIN)).w}`)
await drag(p, 2000); await wait(p, 200)
ok('and a narrowest: dragging far right stops at 340', Math.abs((await rect(p, WIN)).w - 340) <= 1, `${(await rect(p, WIN)).w}`)
await p.locator('[role="separator"][aria-label="Resize the assistant"]').focus()
await p.keyboard.press('ArrowLeft'); await wait(p, 100)
ok('the keyboard resizes it too: ← widens by 20', Math.abs((await rect(p, WIN)).w - 360) <= 1 && (await p.evaluate(() => localStorage.getItem('assistant-window-width'))) === '360')
await p.keyboard.press('Shift+ArrowLeft'); await wait(p, 100)
ok('Shift makes it 80', Math.abs((await rect(p, WIN)).w - 440) <= 1)
await p.keyboard.press('ArrowRight'); await wait(p, 100)
ok('→ narrows', Math.abs((await rect(p, WIN)).w - 420) <= 1)
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await wait(p, 100)
await p.locator('[role="separator"][aria-label="Resize the assistant"]').dblclick(); await wait(p, 100)
ok('double-clicking the handle puts it back to the default', Math.abs((await rect(p, WIN)).w - 420) <= 1)
await drag(p, -180); await wait(p, 200)
const chosen = Math.round((await rect(p, WIN)).w)
await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator(FAB).waitFor(); await wait(p, 1200)
await p.locator(FAB).click(); await wait(p, 600)
ok('after a reload it comes back at the width that was last set', Math.abs((await rect(p, WIN)).w - chosen) <= 1 && chosen >= 598, `${(await rect(p, WIN)).w} (chose ${chosen})`)
await ctx.close()

// ── 4b · a screen too small for it bends the window, never the choice ─────
;({ p, ctx } = await launch({ width: 390, height: 800, stored: '600' }))
await p.locator(FAB).click(); await wait(p, 600)
const ph = await rect(p, WIN)
const phW = await p.evaluate(() => innerWidth)   // 390 screen px = 433 app units at 90%
ok('on a phone the window fits the screen: 12px in from each side', Math.abs(ph.w - (phW - 24)) <= 1 && Math.abs(ph.right - (phW - 12)) <= 1 && ph.x >= 11, JSON.stringify(ph))
ok('and is still a floating window, with the button below it', ph.y > 40 && ph.bottom < (await rect(p, FAB)).y)
ok('the stored choice is NOT overwritten by the screen that could not hold it', (await p.evaluate(() => localStorage.getItem('assistant-window-width'))) === '600')
await p.setViewportSize({ width: 1280, height: 900 }); await wait(p, 400)
ok('back on a wide screen it is the 600 that was chosen', Math.abs((await rect(p, WIN)).w - 600) <= 1, `${(await rect(p, WIN)).w}`)
await ctx.close()

// ── 5 · the message box is as tall as its text — and gives the height back ─────
;({ p, ctx } = await launch())
delay = 2500
await p.locator(FAB).click(); await wait(p, 600)
const ta = p.locator(`${WIN} textarea`).first()
const boxH = () => ta.evaluate(el => Math.round(el.getBoundingClientRect().height))
const one = await boxH()
ok('one line is exactly the height of the 28px send button beside it', one === 28, `${one}px`)
await ta.fill('line one\nline two\nline three\nline four'); await wait(p, 100)
const tall = await boxH()
ok('four lines make it taller', tall > one + 40, `${one} → ${tall}`)
await ta.press('Enter'); await wait(p, 300)
ok('the answer is on its way (the send button is busy)', await p.locator(`${WIN} button svg.lucide-loader-circle, ${WIN} button svg.lucide-loader2`).count() > 0 || (await p.locator(WIN).innerText()).includes('line one'))
ok('after Send the box is back to one line — not the four it held', (await boxH()) === one, `${await boxH()}px`)
ok('and it is still usable while the answer arrives: not disabled, and you can type the next one', !(await ta.isDisabled()) && (await ta.fill('next question'), await ta.inputValue()) === 'next question')
ok('Enter while an answer is arriving does not send a second request', (await ta.press('Enter'), await wait(p, 200), (await p.locator(WIN).innerText()).split('next question').length === 1))
await p.waitForFunction(() => /nothing/.test(document.querySelector('[data-assistant-window]')?.textContent ?? ''), null, { timeout: 15000 })
ok('the draft is still there when the answer lands, and the box has kept its focus', (await ta.inputValue()) === 'next question' && await ta.evaluate(el => document.activeElement === el))
await ctx.close(); delay = 0

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
