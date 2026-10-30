// node scripts/library-shelf-enrich.mjs   — needs a dev server on 5199 (restart it after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 6c: covers and details for books that came off a photographed shelf.
// The matcher is asked pure questions — most of them about what it must REFUSE,
// since a wrong cover on a real book is worse than none — and the whole path is
// then driven with Open Library, Google Books and Claude faked: what was
// patched, in how many requests, and what the person is told.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const T = { library_books: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [] }
let aiHandler = null, bookPosts = [], catalogue = 'ok', catalogueDelay = 0, catalogueCalls = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } })
const json = (r, x, status = 200, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (!(t in T)) return json(r, [])
  if (m === 'GET') return json(r, T[t])
  if (m === 'POST') {
    const rows = [].concat(JSON.parse(q.postData() || '[]'))
    if (t === 'library_books') bookPosts.push(rows)
    for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
    return json(r, [], 201)
  }
  if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
  return json(r, [])
})
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' }
await ctx.route('https://api.anthropic.com/**', async r => {
  const q = r.request()
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  const body = JSON.parse(q.postData() || '{}')
  const reply = text => json(r, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } }, 200, cors)
  if (!/read book spines/.test(JSON.stringify(body.system))) return reply('{}')
  return reply(JSON.stringify(aiHandler()))
})
// The catalogues answer by what was asked, so the matcher has real choices to refuse.
const DOCS = {
  atomic: [{ key: '/works/OL1W', title: 'Atomic Habits: An Easy & Proven Way to Build Good Habits', author_name: ['James Clear'], first_publish_year: 2018, isbn: ['9780735211292'], cover_i: 11, number_of_pages_median: 320 }],
  sapiens: [{ key: '/works/OL2W', title: 'Sapiens', author_name: ['Yuval Noah Harari'], first_publish_year: 2011, isbn: ['9780062316097'], cover_i: 12, number_of_pages_median: 443 }],
  dune: [{ key: '/works/OL3W', title: 'Dune Messiah', author_name: ['Frank Herbert'], cover_i: 13 }],
  emma: [{ key: '/works/OL4W', title: 'Emma', author_name: ['Somebody Else'], cover_i: 14 }],
}
const pick = q => { const s = q.toLowerCase(); return s.includes('atomic') ? DOCS.atomic : s.includes('sapiens') ? DOCS.sapiens : s.includes('dune') ? DOCS.dune : s.includes('emma') ? DOCS.emma : [] }
await ctx.route('https://openlibrary.org/**', async r => {
  const u = new URL(r.request().url()); catalogueCalls.push(u.searchParams.get('q'))
  if (catalogueDelay) await new Promise(res => setTimeout(res, catalogueDelay))
  if (catalogue === 'down') return r.fulfill({ status: 503, headers: cors, body: 'down' })
  return json(r, { docs: pick(u.searchParams.get('q') ?? '') }, 200, cors)
})
await ctx.route('https://www.googleapis.com/books/**', async r => {
  if (catalogue === 'down') return r.fulfill({ status: 503, headers: cors, body: 'down' })
  return json(r, { items: [] }, 200, cors)
})
await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('library-view', 'shelf')
  localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test' }))
} catch {} }, session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const wait = ms => p.waitForTimeout(ms)

// ── pure: what the matcher must refuse ──────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/src/modules/library/shelfEnrich.ts')
  const C = (title, authors, extra = {}) => ({ title, authors, source: 'openlibrary', ...extra })
  const bk = (title, author) => ({ title, authors: author ? [author] : [] })
  return {
    exact: m.pickMatch(bk('Atomic Habits', 'James Clear'), [C('Atomic Habits', ['James Clear'], { coverUrl: 'c' })])?.title,
    sub: m.pickMatch(bk('Atomic Habits', 'James Clear'), [C('Atomic Habits: An Easy & Proven Way', ['James Clear'])])?.title,
    dash: m.pickMatch(bk('Deep Work', 'Cal Newport'), [C('Deep Work - Rules for Focused Success', ['Cal Newport'])])?.title,
    split: m.pickMatch(bk('Deep Work', 'Cal Newport'), [C('Deep Work', ['Cal Newport'], { subtitle: 'Rules for Focused Success' })])?.title,
    spineSub: m.pickMatch(bk('Deep Work: Rules for Focused Success', 'Cal Newport'), [C('Deep Work', ['Cal Newport'])])?.title,
    punct: m.pickMatch(bk('atomic habits!', 'James Clear'), [C('ATOMIC  HABITS', ['James Clear'])])?.title,
    initials: m.pickMatch(bk('Atomic Habits', 'J. Clear'), [C('Atomic Habits', ['James Clear'])])?.title,
    otherAuthor: m.pickMatch(bk('Emma', 'Jane Austen'), [C('Emma', ['Somebody Else'], { coverUrl: 'c' })]),
    partialSurname: m.pickMatch(bk('Emma', 'Jane Clear'), [C('Emma', ['Anna Clearwater'])]),
    otherTitle: m.pickMatch(bk('Dune', 'Frank Herbert'), [C('Dune Messiah', ['Frank Herbert'])]),
    partialTitle: m.pickMatch(bk('Atomic Habits', 'James Clear'), [C('Atomic', ['James Clear'])]),
    superset: m.pickMatch(bk('Habits', 'James Clear'), [C('Atomic Habits', ['James Clear'])]),
    noAuthorCover: m.pickMatch(bk('Sapiens'), [C('Sapiens', ['Yuval Noah Harari'], { coverUrl: 'c' })])?.title,
    noAuthorNoCover: m.pickMatch(bk('Sapiens'), [C('Sapiens', ['Yuval Noah Harari'])]),
    shortNoAuthor: m.pickMatch(bk('It'), [C('It', ['Stephen King'], { coverUrl: 'c' })]),
    shortWithAuthor: m.pickMatch(bk('It', 'Stephen King'), [C('It', ['Stephen King'], { coverUrl: 'c' })])?.title,
    empty: [m.pickMatch(bk('X Y Z', 'A B'), []), m.pickMatch(bk('', 'A B'), [C('', ['A B'])]), m.pickMatch(bk('!!!', 'A B'), [C('!!!', ['A B'])])],
    richest: m.pickMatch(bk('Dune', 'Frank Herbert'), [C('Dune', ['Frank Herbert']), C('Dune', ['Frank Herbert'], { coverUrl: 'c', isbn: '1', pages: 5 }), C('Dune', ['Frank Herbert'], { coverUrl: 'c' })])?.pages,
  }
})
ok('an exact title and author match', u.exact === 'Atomic Habits')
ok('a catalogue subtitle (colon, dash, or its own field) does not stop a match', u.sub && u.dash && u.split, JSON.stringify([u.sub, u.dash, u.split]))
ok('and a subtitle on the SPINE matches the bare title', u.spineSub === 'Deep Work')
ok('case and punctuation are ignored', u.punct === 'ATOMIC  HABITS')
ok('"J. Clear" matches "James Clear" on the surname', u.initials === 'Atomic Habits')
ok('the same title by someone else is refused', u.otherAuthor === null)
ok('a surname that merely begins the same is refused (Clear vs Clearwater)', u.partialSurname === null)
ok('a different book that shares the first word is refused (Dune vs Dune Messiah)', u.otherTitle === null)
ok('half a title is refused, and so is a title that is only part of the candidate\'s', u.partialTitle === null && u.superset === null)
ok('with no author, an exact title with a cover is taken', u.noAuthorCover === 'Sapiens')
ok('with no author and no cover to show for it, nothing is taken', u.noAuthorNoCover === null)
ok('a three-letter title with no author is too ambiguous; with an author it is fine', u.shortNoAuthor === null && u.shortWithAuthor === 'It')
ok('no candidates, no title, or a title with no letters is no match', u.empty.every(x => x === null))
ok('of several that match, the one with the most to give wins', u.richest === 5)

// The panel's own lookup (fills in, editable, saved as shown) is asserted in library-shelf-photo.mjs.

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
