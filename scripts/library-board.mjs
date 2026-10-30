// node scripts/library-board.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 2d: the quote board. Cards / Poster / Explain across every book, and
// an AI explanation stored on the quote. The fake PostgREST refuses an unknown
// column — `explanation` is known only once 20260027 has run — and the fake
// Anthropic can be a refusal, a rate limit, prose or an empty object, because the
// board must say what happened and never store an explanation that is not one.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const B1 = '00000000-0000-4000-8000-000000000001', B2 = '00000000-0000-4000-8000-000000000002'
const Q = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const now = n => new Date(Date.now() - n * 60000).toISOString()
const book = (id, title, a) => ({ id, user_id: user.id, title, authors: [a], pages: 200, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now(0), updated_at: now(0) })
const quote = (n, bookId, body, extra = {}) => ({ id: Q(n), user_id: user.id, book_id: bookId, kind: 'text', body, page: null, line: null, color: null, created_at: now(n), updated_at: now(n), ...extra })
const T = {
  library_books: [book(B1, 'Atomic Habits', 'James Clear'), book(B2, 'Deep Work', 'Cal Newport')],
  library_lists: [], library_list_books: [],
  library_quotes: [
    quote(1, B1, 'You do not rise to the level of your goals. You fall to the level of your systems.', { page: 27 }),
    quote(2, B2, 'Clarity about what matters provides clarity about what does not.'),
    quote(3, B1, 'Habits are the compound interest of self-improvement.'),
    quote(4, B2, null, { kind: 'image', image_path: `${user.id}/${B2}/quotes/x.png` }),
  ],
  library_notes: [{ id: '00000000-0000-4000-8000-000000000201', user_id: user.id, book_id: B1, quote_id: Q(3), scope: 'quote', body: 'Think of my savings.', created_at: now(0), updated_at: now(0) }],
  library_bookmarks: [{ id: '00000000-0000-4000-8000-000000000301', user_id: user.id, book_id: B1, quote_id: Q(1), kind: 'quote', created_at: now(0) }],
}
let migrated = true
const known = () => 'id user_id book_id kind body image_path page line color created_at updated_at'.split(' ').concat(migrated ? ['explanation'] : [])
let ai = { mode: 'ok' }, aiCalls = [], refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } })
const json = (r, x, status = 200, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(x) })

await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  if (u.pathname.startsWith('/storage/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  if (m === 'GET') return json(r, T[t])
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
    if (t === 'library_quotes') for (const row of rows) for (const k of Object.keys(row)) if (!known().includes(k)) { refused.push(`${t}.${k}`); return json(r, { code: 'PGRST204', message: `Could not find the '${k}' column of '${t}'` }, 400) }
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
  return json(r, [])
})

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
await ctx.route('https://api.anthropic.com/**', async r => {
  const q = r.request()
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  const sent0 = JSON.parse(q.postData() || '{}')
  if (String(sent0.system).startsWith('You explain a passage')) aiCalls.push(sent0)
  const reply = text => json(r, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } }, 200, cors)
  switch (ai.mode) {
    case 'ok': return reply(JSON.stringify({ meaning: 'Outcomes follow from the routines you run, not the targets you set.', apply: ['Write down one daily routine that serves this goal', 'Remove one friction point from it this week'] }))
    case 'prose': return reply('I think this means be disciplined.')
    case 'empty': return reply('{}')
    case '401': return json(r, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401, cors)
    case '429': return json(r, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, cors)
  }
})

await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test-key' }))
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)
const text = () => p.locator('main').innerText()

await p.getByRole('tab', { name: 'Quotes' }).click(); await wait(800)
ok('the Quotes view lists all 4 quotes', /4 of 4 quotes/.test(await text()))
ok('the shelf toolbar is not shown here', await p.getByLabel('Search quotes').count() === 1 && await p.getByPlaceholder(/Search books/i).count() === 0)
ok('cards name their book', await p.getByRole('button', { name: /Open this quote from Atomic Habits/ }).count() === 2)

// ── filters ─────────────────────────────────────────────────────────────────
await p.getByLabel('Search quotes').fill('compound'); await wait(300)
ok('search narrows by the words', /1 of 4 quotes/.test(await text()))
await p.getByLabel('Search quotes').fill('newport'); await wait(300)
ok('and by the author', /2 of 4 quotes/.test(await text()))
await p.getByLabel('Search quotes').fill('')
await p.getByLabel('Only this book').selectOption(B1); await wait(300)
ok('the book filter works', /2 of 4 quotes/.test(await text()))
await p.getByLabel('Only this book').selectOption('')
await p.getByRole('button', { name: /Bookmarked/ }).click(); await wait(300)
ok('bookmarked-only shows the 1 bookmarked quote', /1 of 4 quotes/.test(await text()))
await p.getByRole('button', { name: /Bookmarked/ }).click(); await wait(200)

// ── poster ──────────────────────────────────────────────────────────────────
await p.getByRole('button', { name: /Open this quote from Atomic Habits/ }).first().click(); await wait(500)
ok('a card opens as a poster', await p.locator('blockquote').count() === 1)
const first = await p.locator('blockquote').innerText()
ok('the poster counts only quotes with words (3, not 4)', /1 of 3|2 of 3|3 of 3/.test(await text()) && /photo quote.*no text yet/.test(await text()))
await p.keyboard.press('ArrowRight'); await wait(300)
ok('the right arrow turns to another quote', await p.locator('blockquote').innerText() !== first)
await p.getByRole('button', { name: 'Previous quote' }).click(); await wait(300)
ok('Previous returns', await p.locator('blockquote').innerText() === first)
const size = s => p.locator('blockquote').evaluate(e => parseFloat(getComputedStyle(e).fontSize))
ok('the poster sets type large', await size() >= 24, `${await size()}px`)
await p.getByRole('button', { name: /Open this book|Atomic Habits|Deep Work/ }).filter({ hasText: /Atomic|Deep/ }).first().click(); await wait(700)
ok('the book title opens that book\'s panel', await p.getByRole('complementary').count() === 1)
await p.keyboard.press('Escape'); await wait(300)

// ── explain ─────────────────────────────────────────────────────────────────
await p.getByRole('tab', { name: 'Explain' }).click(); await wait(500)
ok('explain lists the 3 quotes with words', await p.getByRole('button', { name: /Explain this/ }).count() === 3)
const row = p.locator('main').locator('div', { hasText: 'Habits are the compound interest' }).last()
await p.getByRole('button', { name: /Explain this/ }).nth(2).click(); await wait(1500)
ok('it asked Claude once', aiCalls.length === 1, aiCalls.map(c => String(c.system).slice(0, 50) + '/' + JSON.stringify(c.messages?.[0]?.content).slice(0, 60)).join(' | '))
const sent = JSON.stringify(aiCalls[0]?.messages?.[0]?.content ?? '')
ok('with the passage, the book, and the reader\'s own note', /Habits are the compound/.test(sent) && /Atomic Habits/.test(sent) && /Think of my savings/.test(sent))
ok('and told it has not read the book', /have NOT read the book/.test(aiCalls[0]?.system ?? ''))
ok('the meaning and the actions are shown', /Outcomes follow from the routines/.test(await text()) && /Remove one friction point/.test(await text()))
ok('labelled as an AI explanation', /AI explanation/.test(await text()))
const stored = T.library_quotes.find(x => x.id === Q(3))
ok('it is stored on the quote, as JSON', !!stored.explanation && JSON.parse(stored.explanation).apply.length === 2)

// survives a reload of the store
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Quotes' }).click(); await wait(500)
await p.getByRole('tab', { name: 'Explain' }).click(); await wait(500)
ok('and is still there after a reload (no second call)', /Outcomes follow from the routines/.test(await text()) && aiCalls.length === 1)

// remove + again
await p.getByRole('button', { name: 'Remove the explanation' }).click(); await wait(800)
ok('Remove clears it on the server too', T.library_quotes.find(x => x.id === Q(3)).explanation == null && await p.getByRole('button', { name: /Explain this/ }).count() === 3)

// ── failures: nothing is stored, the person is told ─────────────────────────
for (const [mode, re, label] of [['401', /key was refused.*Settings → AI/s, 'a refused key'], ['429', /rate-limited/, 'a rate limit'], ['prose', /not in a form that could be read/, 'a reply that is not JSON'], ['empty', /not in a form that could be read/, 'an empty object']]) {
  ai.mode = mode
  await p.getByRole('button', { name: /Explain this/ }).first().click(); await wait(mode === '429' ? 5000 : 1300)
  ok(`${label} is named`, re.test(await text()), (await p.getByRole('alert').first().innerText().catch(() => '')).slice(0, 80))
  ok(`and nothing was stored for it`, T.library_quotes.every(x => !x.explanation || x.id === Q(3) && false))
}
ai.mode = 'ok'

// ── no key ──────────────────────────────────────────────────────────────────
await p.evaluate(() => localStorage.removeItem('professor-ai-config'))
const calls = aiCalls.length
await p.getByRole('button', { name: /Explain this/ }).first().click(); await wait(800)
ok('with no key it says where to add one, and makes no call', /Anthropic key under Settings/.test(await text()) && aiCalls.length === calls)
await p.evaluate(() => localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test-key' })))

// ── the migration has not run ───────────────────────────────────────────────
migrated = false
await p.getByRole('button', { name: /Explain this/ }).first().click(); await wait(2000)
ok('without 20260027 the write is refused by the server, not swallowed', refused.some(x => x === 'library_quotes.explanation'), refused.join(','))
ok('and the screen does not claim it is saved', T.library_quotes.every(x => !x.explanation))

// ── the mode is remembered ──────────────────────────────────────────────────
await p.getByRole('tab', { name: 'Poster' }).click(); await wait(300)
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Quotes' }).click(); await wait(600)
ok('the mode is remembered', await p.locator('blockquote').count() === 1)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
