// node scripts/library-follow.mjs   — needs a dev server on 5199
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 3d: following an author or a series. Open Library is faked and keeps a
// mutable list of works, so a "new release" is a real change between two visits;
// it can be told to fail (everything, or just one series) because the cases that
// matter are the ones where a check cannot be made.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const book = (id, title, a) => ({ id, user_id: user.id, title, authors: [a], source: 'manual', status: 'want', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now })
const T = {
  library_books: [book('00000000-0000-4000-8000-0000000000a1', 'A World Without Email', 'Cal Newport')],
  library_follows: [], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [],
}
let followsMissing = false, olDown = false, expanseDown = false
const W = (key, title, author = 'Cal Newport', year = 2016) => ({ key, title, author_name: [author], first_publish_year: year })
let works = [W('/works/OL2W', 'Deep Work'), W('/works/OL3W', "So Good They Can't Ignore You", 'Cal Newport', 2012)]
let expanse = [W('/works/OL10W', 'Leviathan Wakes', 'James S. A. Corey', 2011)]
const seenQueries = []
const KNOWN_F = 'id user_id kind name query author_key seen_keys created_at'.split(' ')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200, h = {}) => r.fulfill({ status, contentType: 'application/json', headers: h, body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*' }

async function page() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_follows' && followsMissing) return json(r, { code: 'PGRST205', message: 'no table' }, 404)
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_follows') for (const row of rows) for (const k of Object.keys(row)) if (!KNOWN_F.includes(k)) return json(r, { code: 'PGRST204', message: k }, 400)
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace(/^eq\./, ''); if (id) T[t] = T[t].filter(x => x.id !== id); return json(r, []) }
    return json(r, [])
  })
  await ctx.route('https://openlibrary.org/**', r => {
    const u = new URL(r.request().url())
    if (olDown) return r.fulfill({ status: 503, headers: cors, body: '' })
    if (u.pathname === '/search/authors.json') return json(r, { docs: [{ key: 'OL123A', name: 'Cal Newport', top_work: 'Deep Work', work_count: 12 }] }, 200, cors)
    const q = u.searchParams.get('q') ?? ''
    seenQueries.push({ q, sort: u.searchParams.get('sort'), limit: u.searchParams.get('limit') })
    if (q.includes('Expanse')) return expanseDown ? r.fulfill({ status: 503, headers: cors, body: '' }) : json(r, { docs: expanse }, 200, cors)
    if (q.startsWith('author_key:')) return json(r, { docs: works }, 200, cors)
    return json(r, { docs: [] }, 200, cors)
  })
  await ctx.route('https://www.googleapis.com/books/**', r => json(r, { items: [] }, 200, cors))
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, headers: cors, body: '' }))
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'discover')
  } catch {} }, session)
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

let { p, ctx } = await page()
const text = () => p.locator('main').innerText()
const wait = ms => p.waitForTimeout(ms)

// ── the pure module ─────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/followCheck.ts')
  const cand = (key, title) => ({ title, authors: ['X'], source: 'openlibrary', sourceKey: key })
  return {
    a: m.authorQuery('OL123A'), badA: m.authorQuery('OL1A OR title:x'),
    s: m.seriesQuery('The "Expanse"\\'), withBy: m.seriesQuery('The Expanse', 'OL123A'), badBy: m.seriesQuery('The Expanse', 'evil'), short: m.seriesQuery(' a '),
    longQ: m.seriesQuery('x'.repeat(200)).length,
    fresh: m.newReleases({ seenKeys: ['/works/1'] }, [cand('/works/1', 'Old'), cand('/works/2', 'New'), cand('/works/2', 'New again'), cand('/works/3', 'Owned')], [{ id: 'b', title: 'Owned', authors: ['X'] }]).map(c => c.title),
  }
})
ok('an author key is checked before it reaches a query', u.a === 'author_key:OL123A' && u.badA === null)
ok('a series name loses its quotes and backslashes, and is searched as a title', u.s === 'title:"The Expanse"', u.s)
ok('narrowing to an author adds only a valid key', u.withBy === 'title:"The Expanse" AND author_key:OL123A' && u.badBy === 'title:"The Expanse"')
ok('a one-letter series is refused, a huge one clipped', u.short === null && u.longQ < 100)
ok('new = not seen, not duplicated, not already on the shelf', u.fresh.join() === 'New', u.fresh.join())

// ── follow an author ────────────────────────────────────────────────────────
await p.getByRole('tab', { name: 'Authors' }).click(); await wait(300)
await p.getByLabel('Search online').fill('cal newport'); await wait(1500)
await p.getByRole('button', { name: /Cal Newport/ }).first().click(); await wait(1200)
olDown = true; seenQueries.length = 0
await p.getByRole('button', { name: 'Follow Cal Newport' }).click(); await wait(1500)
ok('if their books cannot be read, nothing is followed — and it says so', T.library_follows.length === 0 && /nothing was followed/.test(await text()))
olDown = false
await p.getByRole('button', { name: 'Follow Cal Newport' }).click(); await wait(1500)
const fo = T.library_follows[0]
ok('following snapshots everything they have written, newest first', seenQueries.some(s => s.q === 'author_key:OL123A' && s.sort === 'new' && s.limit === '100'), JSON.stringify(seenQueries.slice(-1)))
ok('and stores the question and what already existed', !!fo && fo.kind === 'author' && fo.name === 'Cal Newport' && fo.query === 'author_key:OL123A' && fo.author_key === 'OL123A' && fo.seen_keys.join() === '/works/OL2W,/works/OL3W', JSON.stringify(fo))
ok('the button becomes "Following"', /Following/.test(await text()) && await p.getByRole('button', { name: 'Follow Cal Newport' }).count() === 0)

// ── the Following view ──────────────────────────────────────────────────────
await p.getByRole('tab', { name: 'Following' }).click(); await wait(1500)
ok('a followed author has a card, with nothing new', /Cal Newport/.test(await text()) && /Nothing new since you followed/.test(await text()))

// A new book appears, and one more that is already on the shelf. The module-
// level cache would answer from memory inside 30 minutes, so reload for a visit.
works = [W('/works/OL9W', 'Slow Productivity', 'Cal Newport', 2024), W('/works/OL8W', 'A World Without Email', 'Cal Newport', 2021), ...works]
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2000)
ok('a new release is announced, with a count', /1 new/.test(await text()) && await p.getByRole('button', { name: 'Want to read: Slow Productivity' }).count() === 1)
ok('one already on the shelf is not "new"', await p.getByRole('button', { name: /Want to read: A World Without Email/ }).count() === 0)
await p.getByRole('button', { name: 'Want to read: Slow Productivity' }).click(); await wait(1500)
ok('shelving it adds the book and clears it from new', T.library_books.some(x => x.title === 'Slow Productivity' && x.status === 'want') && /Nothing new/.test(await text()))

// mark all seen
works = [W('/works/OL7W', 'A Newer One', 'Cal Newport', 2025), ...works]
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2000)
ok('another release shows', /1 new/.test(await text()) && await p.getByRole('button', { name: 'Want to read: A Newer One' }).count() === 1)
await p.getByRole('button', { name: 'Mark all seen' }).click(); await wait(1200)
ok('Mark all seen widens the stored set, never narrows it', T.library_follows[0].seen_keys.includes('/works/OL7W') && T.library_follows[0].seen_keys.includes('/works/OL2W') && /Nothing new/.test(await text()))
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2000)
ok('and it stays seen after a reload', /Nothing new/.test(await text()) && !/1 new/.test(await text()))

// ── a series ────────────────────────────────────────────────────────────────
await p.getByRole('button', { name: /Follow a series/ }).click(); await wait(300)
ok('the form says a series is matched by name', /matched by name/.test(await text()))
expanseDown = true
await p.getByLabel('Series name').fill('The "Expanse"'); await p.getByRole('button', { name: 'Follow', exact: true }).click(); await wait(1500)
ok('a series that cannot be read is not followed', T.library_follows.length === 1 && /nothing was followed/.test(await text()))
expanseDown = false; seenQueries.length = 0
await p.getByLabel('Only by an author you follow').selectOption({ label: 'Cal Newport' })
await p.getByRole('button', { name: 'Follow', exact: true }).click(); await wait(1500)
ok('narrowed to a followed author, the query says so', seenQueries.some(s => s.q === 'title:"The Expanse" AND author_key:OL123A'), seenQueries.map(s => s.q).join('|'))
const sf = T.library_follows.find(x => x.kind === 'series')
ok('the series is stored as a title search', !!sf && sf.name === 'The "Expanse"' && sf.query.startsWith('title:"The Expanse"') && sf.seen_keys.join() === '/works/OL10W')
ok('and appears as a card marked Series', /The "Expanse"/.test(await text()) && /Series/.test(await text()))

// one follow failing does not hide the others
expanse = [W('/works/OL11W', "Caliban's War", 'James S. A. Corey', 2012), ...expanse]
expanseDown = true
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2500)
ok('a failed check names that follow; the author still answers', /Could not check The "Expanse"/.test(await text()) && /Nothing new since you followed/.test(await text()))
expanseDown = false
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2500)
ok('and when it answers, the series shows its new book', await p.getByRole('button', { name: "Want to read: Caliban's War" }).count() === 1)

// ── unfollow, and take it back ──────────────────────────────────────────────
await p.getByRole('button', { name: 'Unfollow Cal Newport' }).click(); await wait(1200)
ok('unfollowing deletes the row and the card goes', !T.library_follows.some(x => x.name === 'Cal Newport') && await p.getByRole('button', { name: 'Unfollow Cal Newport' }).count() === 0)
await p.keyboard.press('Control+z'); await wait(1500)
ok('⌘Z follows again, seen-set intact', T.library_follows.some(x => x.name === 'Cal Newport' && x.seen_keys.includes('/works/OL7W')))

// ── the migration has not run ───────────────────────────────────────────────
await ctx.close()
followsMissing = true
;({ p, ctx } = await page())
await p.getByRole('tab', { name: 'Following' }).click(); await wait(800)
ok('without 20260029 it names the migration, and the shelf is untouched', /20260029_library_follows/.test(await p.locator('main').innerText()))
await p.getByRole('tab', { name: 'Books' }).click(); await wait(300)
ok('Discover itself still works', await p.getByLabel('Search online').count() === 1)
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
