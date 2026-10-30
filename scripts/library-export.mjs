// node scripts/library-board.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 2e: export and 'apply this idea'.
// (fixture shared in shape with library-board.mjs)
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
    quote(1, B1, 'You do not rise to the level of your goals. You fall to the level of your systems.', { page: 27, explanation: JSON.stringify({ meaning: 'Routines beat targets.', apply: ['Design one daily routine'] }) }),
    quote(2, B2, 'Clarity about what matters provides clarity about what does not.'),
    quote(3, B1, 'Habits are the compound interest of self-improvement.'),
    quote(4, B2, null, { kind: 'image', image_path: `${user.id}/${B2}/quotes/x.png` }),
  ],
  library_notes: [{ id: '00000000-0000-4000-8000-000000000201', user_id: user.id, book_id: B1, quote_id: Q(3), scope: 'quote', body: 'Think of my savings.', created_at: now(0), updated_at: now(0) }],
  tasks: [],
  library_bookmarks: [{ id: '00000000-0000-4000-8000-000000000301', user_id: user.id, book_id: B1, quote_id: Q(1), kind: 'quote', created_at: now(0) }],
}
let migrated = true
const known = () => 'id user_id book_id kind body image_path page line color created_at updated_at'.split(' ').concat(migrated ? ['explanation'] : [])
let ai = { mode: 'ok' }, aiCalls = [], refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
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

await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test-key' }))
} catch {} }, session)


const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
import { writeFileSync, mkdtempSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)
const text = () => p.locator('main').innerText()
const dlg = () => p.getByRole('dialog', { name: 'Export quotes' })
const preview = () => dlg().getByLabel('Preview').inputValue()

// ── pure pieces, from the module the dev server serves ──────────────────────
const unit = await p.evaluate(async () => {
  const m = await import('/src/modules/library/exportQuotes.ts')
  const z = await import('/src/modules/library/zip.ts')
  return { name: m.safeName('A: B/C #1? [x] ^y |z'), empty: m.safeName('???'), crc: z.crc32(new TextEncoder().encode('123456789')) }
})
ok('safeName removes what breaks a path or a wikilink', unit.name === 'A B C 1 x y z', unit.name)
ok('and never returns an empty name', unit.empty === 'Untitled')
ok('crc32 matches the standard check value', unit.crc === 0xcbf43926, unit.crc.toString(16))

// ── apply this idea: an explanation's suggestion ────────────────────────────
await p.getByRole('tab', { name: 'Quotes' }).click(); await wait(600)
await p.getByRole('tab', { name: 'Explain' }).click(); await wait(500)
const idea = p.getByRole('button', { name: /Make a task: Design one daily routine/ })
ok('each suggestion carries a make-a-task button', await idea.count() === 1)
await idea.click(); await wait(2500)
const t1 = T.tasks.find(t => t.title === 'Design one daily routine')
ok('it makes exactly one task', T.tasks.length === 1 && !!t1, JSON.stringify(T.tasks.map(t => t.title)))
ok('placed, not left in the brain dump', !!t1?.quadrant, String(t1?.quadrant))
ok('described by where it came from, with the quote', /^From “Atomic Habits” · p\. ?27/.test(t1?.description ?? '') && /fall to the level of your systems/.test(t1?.description ?? ''), (t1?.description ?? '').slice(0, 80))
ok('and not open, not done', t1?.completed === false)
ok('the button becomes a receipt, not a second copy', await p.getByRole('button', { name: 'Task made' }).isDisabled())
await p.getByRole('button', { name: 'Task made' }).click({ force: true }).catch(() => {}); await wait(800)
ok('clicking it again makes nothing', T.tasks.length === 1)
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Quotes' }).click(); await wait(500)
await p.getByRole('tab', { name: 'Explain' }).click(); await wait(500)
ok('after a reload it is still a receipt', await p.getByRole('button', { name: 'Task made' }).count() === 1)

// ── apply this idea: a note of your own ─────────────────────────────────────
await p.getByRole('tab', { name: 'Cards' }).click(); await wait(300)
await p.getByLabel('Search quotes').fill('compound'); await wait(300)
await p.getByRole('button', { name: /Open this quote from Atomic Habits/ }).first().click(); await wait(300)
await p.getByRole('button', { name: /Open this book|Atomic Habits/ }).filter({ hasText: 'Atomic Habits' }).first().click(); await wait(900)
const panel = p.getByRole('complementary')
await panel.getByRole('button', { name: '1 note' }).click(); await wait(300)
await panel.getByRole('button', { name: /Make a task: Think of my savings/ }).click({ timeout: 5000 }); await wait(2500)
const t2 = T.tasks.find(t => t.title === 'Think of my savings.')
ok('a note becomes a task', !!t2 && T.tasks.length === 2)
ok('with its quote and place in the description', /^From “Atomic Habits”/.test(t2?.description ?? '') && /compound interest/.test(t2?.description ?? ''))
await p.keyboard.press('Escape'); await wait(300)

// ── export ──────────────────────────────────────────────────────────────────
await p.getByLabel('Search quotes').fill('')
await p.getByRole('tab', { name: 'Cards' }).click(); await wait(300)
await p.getByRole('button', { name: /Export/ }).click(); await wait(500)
ok('the dialog opens on Markdown with a preview', await dlg().count() === 1 && /^# Quotes from my library/.test(await preview()))
let md = await preview()
ok('says how many quotes and books', /4 quotes from 2 books/.test(md))
ok('each book is a heading with its author', /## Atomic Habits — James Clear/.test(md) && /## Deep Work — Cal Newport/.test(md))
ok('quotes are blockquotes with page and bookmark', /> You do not rise to the level of your goals\.[^\n]*\n> — p\. ?27 · bookmarked/.test(md), md.slice(0, 400))
ok('a photo with no text is kept as a line, not dropped', /> \*\(a photo of the page — no text yet\)\*/.test(md))
ok('a note on a quote comes with it', /- Think of my savings\./.test(md))
ok('AI explanations are off until asked for', !/Explanation \(AI\)/.test(md))
await dlg().getByLabel('AI explanations').check(); await wait(200)
md = await preview()
ok('and then they come, labelled as AI', /- \*\*Explanation \(AI\):\*\* Routines beat targets\./.test(md) && /  - Try: Design one daily routine/.test(md))
await dlg().getByLabel('My notes').uncheck(); await wait(200)
ok('notes can be left out', !/Think of my savings/.test(await preview()))
await dlg().getByLabel('My notes').check()

// copy
await dlg().getByRole('button', { name: /Copy/ }).click(); await wait(400)
ok('Copy puts exactly the preview on the clipboard', await p.evaluate(() => navigator.clipboard.readText()) === await preview())

// download markdown
const dir = mkdtempSync(join(tmpdir(), 'lib-export-'))
let [d] = await Promise.all([p.waitForEvent('download'), dlg().getByRole('button', { name: /Download \.md|Download/ }).click()])
ok('Markdown downloads as one .md named for the library', d.suggestedFilename() === 'Library quotes.md', d.suggestedFilename())

// obsidian, two books → a zip
await dlg().getByRole('tab', { name: 'Obsidian' }).click(); await wait(300)
ok('Obsidian over two books offers a zip', await dlg().getByRole('button', { name: 'Download .zip' }).count() === 1 && await dlg().getByRole('button', { name: /Copy/ }).isDisabled())
ok('its preview is a note with properties', /^---\ntitle: "Atomic Habits"\nauthor:\n  - "James Clear"\ntags:\n  - book\nstatus: "reading"/.test(await preview()), (await preview()).slice(0, 120))
ok('and a block id on every quote', /\^q-[0-9a-f]{8}/.test(await preview()))
;[d] = await Promise.all([p.waitForEvent('download'), dlg().getByRole('button', { name: 'Download .zip' }).click()])
const zipPath = join(dir, 'out.zip'); await d.saveAs(zipPath)
let listing = '', test = ''
try { test = execSync(`unzip -t "${zipPath}"`).toString(); listing = execSync(`unzip -Z1 "${zipPath}"`).toString() } catch (e) { test = String(e) }
ok('the zip is a valid archive', /No errors detected/.test(test), test.slice(-120))
ok('with one note per book', listing.split('\n').filter(Boolean).sort().join('|') === 'Atomic Habits.md|Deep Work.md', JSON.stringify(listing))
const inner = execSync(`unzip -p "${zipPath}" "Atomic Habits.md"`).toString()
ok('whose contents are the note', /^---\ntitle: "Atomic Habits"/.test(inner) && /> You do not rise/.test(inner) && !/Deep Work/.test(inner))

// notion
await dlg().getByRole('tab', { name: 'Notion' }).click(); await wait(300)
ok('Notion is the single Markdown file, with how to bring it in', /Import → Text & Markdown/.test(await dlg().innerText()) && /^# Quotes from my library/.test(await preview()))

// the board's filters decide what is exported
await p.keyboard.press('Escape'); await wait(300)
await p.getByLabel('Only this book').selectOption(B2); await wait(300)
await p.getByRole('button', { name: /Export/ }).click(); await wait(400)
md = await preview()
ok('a filtered board exports only what it shows', /Deep Work/.test(md) && !/Atomic Habits/.test(md) && /2 quotes from 1 book\./.test(md), md.slice(0, 120))
;[d] = await Promise.all([p.waitForEvent('download'), dlg().getByRole('button', { name: /Download/ }).click()])
ok('one book downloads under its own name', d.suggestedFilename() === 'Deep Work - quotes.md', d.suggestedFilename())
await dlg().getByRole('tab', { name: 'Obsidian' }).click(); await wait(300)
;[d] = await Promise.all([p.waitForEvent('download'), dlg().getByRole('button', { name: /Download/ }).click()])
ok('and as an Obsidian note it is a plain .md, not a zip of one', d.suggestedFilename() === 'Deep Work.md', d.suggestedFilename())
await p.keyboard.press('Escape'); await wait(300)
ok('Escape closes it', await dlg().count() === 0)

// nothing to export
await p.getByLabel('Search quotes').fill('zzzz-no-such'); await wait(300)
ok('with nothing shown, Export is off', await p.getByRole('button', { name: /Export/ }).isDisabled())

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
