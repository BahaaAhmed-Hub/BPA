// node scripts/library-news.mjs   — needs a dev server on 5199 (restart after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 7e: what the scheduled check found while the app was closed
// (library_follow_news), as the Following view and the bell show it. The fake
// keeps the news table, can have it missing (20260037 not run), and Open Library
// can be told to be down — because "the overnight rows while the live check
// cannot answer" is the case this exists for.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const hoursAgo = h => new Date(Date.now() - h * 3600_000).toISOString()
const F1 = '00000000-0000-4000-8000-000000000501', F2 = '00000000-0000-4000-8000-000000000502'
const N = (id, follow, key, title, o = {}) => ({ id: `00000000-0000-4000-8000-0000000006${id}`, user_id: user.id, follow_id: follow, work_key: key, title, authors: o.authors ?? ['Cal Newport'], isbn: o.isbn ?? null, published_year: o.year ?? 2024, cover_url: null, found_at: o.at ?? hoursAgo(5), read_at: o.read ?? null })
let T, olDown, newsMissing, ops
const W = (key, title, year = 2024) => ({ key, title, author_name: ['Cal Newport'], first_publish_year: year })
const reset = (o = {}) => {
  olDown = o.olDown ?? false; newsMissing = o.newsMissing ?? false; ops = []
  T = {
    library_books: [{ id: '00000000-0000-4000-8000-0000000005a1', user_id: user.id, title: 'A World Without Email', authors: ['Cal Newport'], source: 'manual', status: 'want', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now }],
    library_follows: [
      { id: F1, user_id: user.id, kind: 'author', name: 'Cal Newport', query: 'author_key:OL123A', author_key: 'OL123A', seen_keys: ['/works/OL2W', '/works/OL7W'], created_at: now, last_checked_at: hoursAgo(3), last_check_ok: o.lastOk ?? true },
      { id: F2, user_id: user.id, kind: 'series', name: 'The Expanse', query: 'title:"The Expanse"', author_key: null, seen_keys: ['/works/OL10W'], created_at: now, last_checked_at: null, last_check_ok: null },
    ],
    library_follow_news: [
      N('01', F1, '/works/OL9W', 'Slow Productivity'),
      N('02', F1, '/works/OL7W', 'Already Seen Elsewhere'),                 // in seen_keys
      N('03', F1, '/works/OL8W', 'A World Without Email'),                  // on the shelf
      N('04', F1, '/works/OL6W', 'Read One', { read: hoursAgo(1) }),        // already looked at
    ],
    library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_sessions: [], library_plans: [], library_goals: [], library_quote_reviews: [],
  }
}
reset()
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200, h = {}) => r.fulfill({ status, contentType: 'application/json', headers: h, body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*' }
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_follow_news' && newsMissing) return json(r, { code: 'PGRST205', message: 'no table' }, 404)
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_follows') for (const k of Object.keys(rows[0] ?? {})) if (k.startsWith('last_check')) return json(r, { code: 'PGRST204', message: `client must not write ${k}` }, 400)
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'PATCH') {
      const ids = (u.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',')
      ops.push({ t, patch: JSON.parse(q.postData() || '{}'), ids })
      T[t] = T[t].map(x => (ids.includes(x.id) ? { ...x, ...JSON.parse(q.postData() || '{}') } : x)); return json(r, [], 204)
    }
    if (m === 'DELETE') {
      const f = u.searchParams.get('follow_id')?.replace(/^eq\./, ''), keys = (u.searchParams.get('work_key') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')), id = u.searchParams.get('id')?.replace(/^eq\./, '')
      ops.push({ t, del: { f, keys, id } })
      if (t === 'library_follow_news' && f) T[t] = T[t].filter(x => !(x.follow_id === f && keys.includes(x.work_key)))
      else if (id) { T[t] = T[t].filter(x => x.id !== id); if (t === 'library_follows') T.library_follow_news = T.library_follow_news.filter(x => x.follow_id !== id) }
      return json(r, [])
    }
    return json(r, [])
  })
  await ctx.route('https://openlibrary.org/**', r => {
    if (olDown) return r.fulfill({ status: 503, headers: cors, body: '' })
    const q = new URL(r.request().url()).searchParams.get('q') ?? ''
    if (q.startsWith('author_key:')) return json(r, { docs: [W('/works/OL2W', 'Deep Work', 2016), W('/works/OL9W', 'Slow Productivity')] }, 200, cors)
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
  p.on('pageerror', e => console.log('  [pageerror]', String(e.stack || e).slice(0, 400)))
  await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
// the Unfollow button sits in the header row, whose parent is the card
const cardOf = (p, name) => p.getByRole('button', { name: `Unfollow ${name}` }).locator('xpath=ancestor::div[2]')

// ── Open Library down: the overnight finds are what there is ────────────────
reset({ olDown: true, lastOk: false })
let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2500)
let card = cardOf(p, 'Cal Newport')
let t = (await card.innerText()).replace(/\n/g, ' ')
ok('with the live check failing, the overnight finds are still on the card — once each', (t.match(/Slow Productivity/g) ?? []).length === (t.match(/Read One/g) ?? []).length && /2 new/.test(t), t.slice(0, 260))
ok('a work already marked seen, and one already on the shelf, are not offered as new', !/Already Seen Elsewhere/.test(t) && (t.match(/A World Without Email/g) ?? []).length === 0)
ok('one the bell already let go of (looked at) is still new here until you say seen — read is not seen', /Read One/.test(t))
ok('the card still says the live check could not be made', /Could not check Cal Newport just now/.test(t))
ok('and says what the overnight check saw: it could not reach Open Library', /overnight check could not reach Open Library \(3 h ago\)/.test(t), t.slice(-160))
await wait(2500)
const unreadNow = T.library_follow_news.filter(x => x.read_at === null).map(x => x.work_key)
ok('a moment on the page marks the unread finds as looked at — only those', ops.filter(o => o.t === 'library_follow_news' && o.patch).length === 1 && ops.find(o => o.patch).ids.length === 3 && !unreadNow.includes('/works/OL9W'), JSON.stringify(ops.find(o => o.patch)))
ok('and the clients never write the server-owned check columns', !ops.some(o => o.patch?.last_checked_at))
await ctx.close()

// ── live check works: the same book is not shown twice ──────────────────────
reset({})
;({ p, ctx } = await open())
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2500)
card = cardOf(p, 'Cal Newport'); t = (await card.innerText()).replace(/\n/g, ' ')
ok('the live and overnight answers are one list: the book appears once', (t.match(/Slow Productivity/g) ?? []).length === (t.match(/Read One/g) ?? []).length && /2 new/.test(t), t.slice(0, 240))
ok('a follow nothing has checked says nothing about overnight', !/overnight/.test((await cardOf(p, 'The Expanse').innerText())))
t = (await cardOf(p, 'Cal Newport').innerText()).replace(/\n/g, ' ')
ok('a good overnight check is mentioned plainly', /Also checked overnight, 3 h ago/.test(t))

// mark seen takes the news with it
await card.getByRole('button', { name: 'Mark all seen' }).click(); await wait(1500)
const f1 = T.library_follows.find(x => x.id === F1)
ok('Mark all seen widens what is seen — and the server copy of those announcements goes', f1.seen_keys.includes('/works/OL9W') && f1.seen_keys.includes('/works/OL6W') && !T.library_follow_news.some(x => ['/works/OL9W', '/works/OL6W'].includes(x.work_key)))
ok('the delete named the follow and the work, not the table', ops.some(o => o.del?.f === F1 && o.del.keys.includes('/works/OL9W')), JSON.stringify(ops.filter(o => o.del)))
ok('and the card says nothing new', /Nothing new since you followed/.test(await cardOf(p, 'Cal Newport').innerText()))

// unfollow
await p.getByRole('button', { name: 'Unfollow Cal Newport' }).click(); await wait(1200)
ok('unfollowing removes the follow, and its announcements with it', !T.library_follows.some(x => x.id === F1) && !T.library_follow_news.some(x => x.follow_id === F1))

// ── the bell ────────────────────────────────────────────────────────────────
await ctx.close()
reset({})
;({ p, ctx } = await open())
const bell = await p.evaluate(async () => {
  const n = await import('/BPA/src/lib/notifications.ts')
  const all = n.collect(n.DEFAULT_NOTIF_EVENTS).filter(x => x.kind === 'release')
  const off = n.collect(n.DEFAULT_NOTIF_EVENTS.map(s => (s.id === 'release' ? { ...s, push: false } : s))).filter(x => x.kind === 'release')
  const { useLibraryStore } = await import('/BPA/src/modules/library/libraryStore.ts')
  useLibraryStore.setState({ newsMissing: true })
  const dormant = n.dormantKinds(n.DEFAULT_NOTIF_EVENTS).filter(d => d.setting.id === 'release').map(d => d.why)
  return { all, off: off.length, defaults: n.DEFAULT_NOTIF_EVENTS.map(s => s.id), derivable: n.DERIVABLE.includes('release'), dormant }
})
ok('the bell offers exactly the unread, unseen, unshelved find', bell.all.length === 1 && bell.all[0].title === 'Slow Productivity', JSON.stringify(bell.all.map(x => x.title)))
ok('with its author, the follow it came from and the year; it opens the Library', /Cal Newport · New from Cal Newport · 2024/.test(bell.all[0].detail) && bell.all[0].go?.module === 'library' && /^release:/.test(bell.all[0].id), bell.all[0].detail)
ok('switching the kind off in the matrix silences it', bell.off === 0)
ok('it is a real kind in the matrix, and derivable', bell.defaults.includes('release') && bell.derivable)
ok('and says what it is waiting on when the migration has not run', bell.dormant.some(w => /20260037/.test(w)), bell.dormant.join())
await ctx.close()

// ── 20260037 not run ────────────────────────────────────────────────────────
reset({ newsMissing: true })
;({ p, ctx } = await open())
await p.getByRole('tab', { name: 'Following' }).click(); await wait(2500)
t = (await cardOf(p, 'Cal Newport').innerText()).replace(/\n/g, ' ')
ok('without the news table the live check still answers, and the shelf is untouched', /Slow Productivity/.test(t) && /1 new/.test(t) && !/Already Seen/.test(t) && !/Read One/.test(t))
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
