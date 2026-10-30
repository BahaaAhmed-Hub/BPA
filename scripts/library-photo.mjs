// node scripts/library-photo.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 2c: a photographed page becomes a quote. Claude vision is faked at
// api.anthropic.com (with CORS, as the SDK's browser fetch needs) and Storage is
// faked with a switchable failure — because what matters here is everything that
// can go wrong: no key, a refused key, a rate limit, an empty page, a reply that
// is not JSON, a photo that will not upload. Each must leave the person able to
// type the quote, and none may leave a quote pointing at a photo that is not there.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const BOOK = '00000000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const T = {
  library_books: [{ id: BOOK, user_id: user.id, title: 'Photo Test', authors: ['A. Writer'], pages: 200, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now }],
  library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [],
}
const KNOWN = {
  library_quotes: 'id user_id book_id kind body image_path page line color created_at updated_at'.split(' '),
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const objects = {}
let ai = { mode: 'ok' }, aiCalls = [], uploadFails = 0, uploads = [], refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } })
const json = (r, x, status = 200, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(x) })

await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const so = /\/storage\/v1\/object\/library(?:\/(.+))?$/.exec(u.pathname)
  if (so) {
    const path = decodeURIComponent(so[1] ?? '')
    if (m === 'POST' || m === 'PUT') {
      if (path.split('/')[0] !== user.id) { refused.push(`upload ${path}`); return json(r, { statusCode: '403', message: 'row-level security' }, 403) }
      if (uploadFails > 0) { uploadFails--; return json(r, { statusCode: '500', error: 'Internal', message: 'storage is down' }, 500) }
      objects[path] = PNG; uploads.push(path)
      return json(r, { Key: `library/${path}` })
    }
    if (m === 'GET') return objects[path] ? r.fulfill({ status: 200, contentType: 'image/png', body: objects[path] }) : json(r, { statusCode: '404', message: 'not found' }, 404)
    return json(r, [])
  }
  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  if (m === 'GET') return json(r, T[t])
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) for (const k of Object.keys(row)) if (KNOWN[t] && !KNOWN[t].includes(k)) { refused.push(`${t}.${k}`); return json(r, { code: 'PGRST204', message: `no column ${k}` }, 400) }
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
  return json(r, [])
})

// ── Claude vision, faked ────────────────────────────────────────────────────
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
await ctx.route('https://api.anthropic.com/**', async r => {
  const q = r.request()
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  aiCalls.push(JSON.parse(q.postData() || '{}'))
  const reply = text => json(r, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } }, 200, cors)
  switch (ai.mode) {
    case 'ok': return reply(JSON.stringify({ text: 'Habits are the compound interest of self-improvement.', page: 27, marked: true }))
    case 'fenced': return reply('```json\n' + JSON.stringify({ text: 'Fenced text.', page: null, marked: false }) + '\n```')
    case 'prose': return reply('The page says: nothing in JSON at all')
    case 'empty': return reply(JSON.stringify({ text: '', page: null, marked: false }))
    case '401': return json(r, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401, cors)
    case '429': return json(r, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, cors)
  }
})

await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)
const setKey = k => p.evaluate(key => { key ? localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: key })) : localStorage.removeItem('professor-ai-config') }, k)
const photo = (name = 'page.png', type = 'image/png', buffer = PNG) => ({ name, mimeType: type, buffer })

await p.getByRole('button', { name: /Photo Test by/ }).click(); await wait(900)
const panel = p.getByRole('complementary')
const dlg = () => p.getByRole('dialog', { name: 'Quote from a photo' })
const open = async f => { await panel.getByLabel('Choose a photo of a page').setInputFiles(f); await wait(1500) }

// ── No key: the page cannot be read, the quote can still be typed ───────────
await setKey(null)
await open(photo())
ok('the dialog opens with the photo shown', await dlg().count() === 1 && await dlg().getByRole('img', { name: 'The photographed page' }).count() === 1)
ok('with no key it says what to do', /Anthropic key under Settings/.test(await dlg().innerText()))
ok('and made no AI call', aiCalls.length === 0)
await dlg().getByLabel('Quote text').fill('Typed by hand.'); await dlg().getByLabel('Page (optional)').fill('12')
await dlg().getByRole('button', { name: 'Save quote' }).click(); await wait(1500)
ok('the dialog closes and the quote is saved as an image quote', await dlg().count() === 0 && T.library_quotes.length === 1 && T.library_quotes[0].kind === 'image')
let q1 = T.library_quotes[0]
ok('with the typed words and page', q1.body === 'Typed by hand.' && q1.page === 12)
ok('and its photo under <owner>/<book>/quotes/', q1.image_path?.startsWith(`${user.id}/${BOOK}/quotes/`) && !!objects[q1.image_path], q1.image_path)
ok('the photo shows in the quote list, loaded', await p.evaluate(() => { const i = [...document.querySelectorAll('img[alt="Photo of the page"]')][0]; return !!i && i.complete && i.naturalWidth > 0 }))
await panel.getByRole('button', { name: 'Enlarge the photo' }).click()
ok('tapping the photo enlarges it', await panel.getByRole('button', { name: 'Shrink the photo' }).count() === 1)

// ── With a key: the page is read ────────────────────────────────────────────
await setKey('sk-ant-test-key'); ai.mode = 'ok'
await open(photo())
ok('it asks Claude with the photo as an image block', aiCalls.length === 1 && aiCalls[0].messages[0].content.some(c => c.type === 'image' && c.source.type === 'base64' && c.source.data.length > 20))
ok('and tells it to copy, not correct', /Copy the words exactly/.test(aiCalls[0].system) && /ONLY the marked part/.test(aiCalls[0].system))
ok('the words land in the box for checking', await dlg().getByLabel('Quote text').inputValue() === 'Habits are the compound interest of self-improvement.')
ok('the printed page number is filled in', await dlg().getByLabel('Page (optional)').inputValue() === '27')
ok('it says a marked passage was read, and to check it', /marked passage.*Check it/.test(await dlg().innerText()))
await dlg().getByLabel('Quote text').fill('Habits are the compound interest of self-improvement. (edited)')
await dlg().getByRole('button', { name: 'Save quote' }).click(); await wait(1500)
const q2 = T.library_quotes.find(x => x.page === 27)
ok('what is saved is what the person corrected it to', !!q2 && q2.body.endsWith('(edited)') && q2.kind === 'image')

// ── Read again ──────────────────────────────────────────────────────────────
await open(photo())
const before = aiCalls.length
await dlg().getByRole('button', { name: 'Read again' }).click(); await wait(1200)
ok('Read again asks once more', aiCalls.length === before + 1)
await p.keyboard.press('Escape'); await wait(400)
ok('Escape closes without adding anything', await dlg().count() === 0 && T.library_quotes.length === 2)

// ── A reply that is not clean JSON ──────────────────────────────────────────
ai.mode = 'fenced'; await open(photo())
ok('JSON in code fences is still understood', await dlg().getByLabel('Quote text').inputValue() === 'Fenced text.')
await dlg().getByRole('button', { name: 'Cancel' }).click(); await wait(300)
ai.mode = 'prose'; await open(photo())
ok('a reply with no JSON is taken as the text rather than lost', /nothing in JSON at all/.test(await dlg().getByLabel('Quote text').inputValue()))
await dlg().getByRole('button', { name: 'Cancel' }).click(); await wait(300)

// ── Refusals ────────────────────────────────────────────────────────────────
ai.mode = '401'; await open(photo())
ok('a refused key says so and names where to fix it', /key was refused.*Settings → AI/.test(await dlg().innerText()))
ok('and the quote can still be typed', await dlg().getByLabel('Quote text').isEnabled())
await dlg().getByRole('button', { name: 'Cancel' }).click(); await wait(300)
ai.mode = '429'; await open(photo())
ok('a rate limit says so', /rate-limited/.test(await dlg().innerText()))
await dlg().getByRole('button', { name: 'Cancel' }).click(); await wait(300)

// ── An empty page ───────────────────────────────────────────────────────────
ai.mode = 'empty'; await open(photo())
ok('a photo with no text says so', /No readable text/.test(await dlg().innerText()))
ok('and can still be kept as a photo', await dlg().getByRole('button', { name: 'Save quote' }).isEnabled())
await dlg().getByRole('button', { name: 'Save quote' }).click(); await wait(1500)
const q3 = T.library_quotes[T.library_quotes.length - 1]
ok('a photo-only quote has no body and still has its photo', q3.body == null && !!q3.image_path && !!objects[q3.image_path])
ok('the list says it has no text yet', await panel.getByText(/No text yet/).count() === 1)

// ── The upload fails: nothing is saved ──────────────────────────────────────
ai.mode = 'ok'; await open(photo())
const nq = T.library_quotes.length
uploadFails = 1
await dlg().getByRole('button', { name: 'Save quote' }).click(); await wait(1500)
ok('a failed upload says nothing was added', /Nothing was added/.test(await dlg().getByRole('alert').innerText()))
ok('no quote row was written', T.library_quotes.length === nq)
ok('the dialog stays open with the words kept', await dlg().count() === 1 && (await dlg().getByLabel('Quote text').inputValue()).length > 10)
await dlg().getByRole('button', { name: 'Save quote' }).click(); await wait(1500)
ok('trying again works', T.library_quotes.length === nq + 1 && await dlg().count() === 0)

// ── Not an image ────────────────────────────────────────────────────────────
await open(photo('notes.txt', 'text/plain', Buffer.from('hello')))
ok('a file that is not an image says so', /is not an image/.test(await dlg().getByRole('alert').innerText()))
ok('and cannot be saved', await dlg().getByRole('button', { name: 'Save quote' }).isDisabled())
await p.keyboard.press('Escape'); await wait(300)

ok('every upload went to the owner\'s own folder', uploads.every(u => u.startsWith(`${user.id}/`)))
ok('nothing the UI sent was refused', refused.length === 0, refused.join(', '))
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
