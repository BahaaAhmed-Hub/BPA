// node scripts/library-watch.mjs   — needs a dev server on 5199 (restart after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 7d-2: a book on Shopping's price watch. The fake PostgREST has the
// library and shopping tables, knows watch_item_id only once 20260036 has "run",
// and a faked shopping-price-watch function answers the check.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const B1 = '00000000-0000-4000-8000-000000000401', B2 = '00000000-0000-4000-8000-000000000402', B3 = '00000000-0000-4000-8000-000000000403'
const GONE = '00000000-0000-4000-8000-0000000004ff'
const book = (id, title, o = {}) => ({ id, user_id: user.id, title, authors: ['Someone'], source: 'manual', status: o.status ?? 'want', format: 'print', rating: 0, shelf_order: o.n ?? 0, added_at: now, updated_at: now, to_buy: false, watch_item_id: o.watch ?? null })
const STORE = { id: '00000000-0000-4000-8000-0000000004a1', user_id: user.id, name: 'Diwan', url: 'https://diwan.example', country: 'EG', categories: ['Books'], last_scraped_at: null, last_scrape_ok: null, sort_order: 0, created_at: now, updated_at: now }
let shopGets = 0, T, modules, migrated, refusedLib, checkBody, shopWrites, itemsDelay
const reset = (o = {}) => {
  T = { library_books: [book(B1, 'Deep Work', { n: 0 }), book(B2, 'Dune', { n: 1, watch: GONE }), book(B3, 'Emma', { n: 2, status: 'finished' })], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [], library_quote_reviews: [],
    shopping_groups: [], shopping_items: [], shopping_stores: o.stores === false ? [] : [STORE], shopping_price_snapshots: [] }
  modules = [{ module_id: 'library', label: 'Library', enabled: true }, { module_id: 'finance', label: 'Finance', enabled: o.finance !== false }]
  migrated = o.migrated !== false; refusedLib = []; checkBody = null; shopWrites = []; itemsDelay = o.itemsDelay ?? 0
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open({ enabled = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1800 }, locale: 'en-GB' })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, modules)
    if (u.pathname.endsWith('/functions/v1/shopping-price-watch')) {
      checkBody = JSON.parse(q.postData() || '{}')
      const it = checkBody.items?.[0]
      return json(r, { results: it ? [{ itemId: it.id, storeId: it.stores[0].id, price: 180, currency: 'EGP', productUrl: 'https://diwan.example/p/1', available: true }] : [] })
    }
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (m === 'GET') {
      if (t.startsWith('shopping_')) shopGets++
      if (t === 'library_books' && !migrated && u.searchParams.get('select')?.includes('watch_item_id')) return json(r, { code: '42703', message: 'column library_books.watch_item_id does not exist' }, 400)
      if (t === 'shopping_items' && itemsDelay) await new Promise(res => setTimeout(res, itemsDelay))
      return json(r, t === 'library_books' && !migrated ? T[t].map(({ watch_item_id: _w, ...rest }) => rest) : T[t])
    }
    if (m === 'POST' || m === 'PATCH') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_books') for (const rw of rows) if ('watch_item_id' in rw && !migrated) { refusedLib.push(rw.id); return json(r, { code: 'PGRST204', message: "Could not find the 'watch_item_id' column" }, 400) }
      if (t.startsWith('shopping_')) shopWrites.push({ t, rows })
      if (m === 'PATCH') { const id = u.searchParams.get('id')?.replace('eq.', ''); T[t] = T[t].map(x => (x.id === id ? { ...x, ...rows[0] } : x)); return json(r, [], 204) }
      for (const rw of rows) { const i = T[t].findIndex(x => x.id === rw.id); if (i >= 0) T[t][i] = { ...T[t][i], ...rw }; else T[t].push(rw) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') { const id = u.searchParams.get('id')?.replace('eq.', ''); if (id) { shopWrites.push({ t, del: id }); T[t] = T[t].filter(x => x.id !== id) } return json(r, []) }
    return json(r, [])
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(() => { try { localStorage.setItem('bpa-wizard-done', '1') } catch {} })
  await ctx.addInitScript(([s, en]) => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    if (en) localStorage.setItem('shopping-settings', JSON.stringify({ enabled: true }))
  } catch {} }, [session, enabled])
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e.stack || e).slice(0, 700)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── pure ────────────────────────────────────────────────────────────────────
reset()
let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)
const u = await p.evaluate(async () => {
  const m = await import('/src/modules/library/priceWatch.ts')
  const t = Date.now()
  return {
    v: [m.verdict(180, 200), m.verdict(200, 200), m.verdict(200.004, 200), m.verdict(200.01, 200), m.verdict(undefined, 200), m.verdict(180, undefined), m.verdict(180, 0)],
    name: [m.watchName({ title: ' Deep Work ', authors: ['Cal Newport', 'X'] }), m.watchName({ title: 'Untitled', authors: [] })],
    ago: [m.checkedAgo(new Date(t - 20_000).toISOString(), t), m.checkedAgo(new Date(t - 5 * 60_000).toISOString(), t), m.checkedAgo(new Date(t - 3 * 3600_000).toISOString(), t), m.checkedAgo(new Date(t - 72 * 3600_000).toISOString(), t), m.checkedAgo(new Date(t + 60_000).toISOString(), t)],
  }
})
ok('a price is judged to the cent against the target; no price or no target says nothing', JSON.stringify(u.v) === JSON.stringify(['at-or-below', 'at-or-below', 'at-or-below', 'above', 'none', 'none', 'none']), JSON.stringify(u.v))
ok('the item is named for the title and first author', u.name[0] === 'Deep Work Cal Newport' && u.name[1] === 'Untitled')
ok('"checked" reads as time ago, and a clock slip reads as just now', JSON.stringify(u.ago) === JSON.stringify(['just now', '5 min ago', '3 h ago', '3 days ago', 'just now']), JSON.stringify(u.ago))
await ctx.close()

// ── Finance off ─────────────────────────────────────────────────────────────
reset({ finance: false })
shopGets = 0
;({ p, ctx } = await open())
const pick = async title => { await p.getByRole('button', { name: new RegExp(title) }).first().click(); await wait(1200) }
const panel = () => p.getByRole('complementary')
await pick('Deep Work')
ok('with Finance off the card says why and offers nothing', /Finance is not on your plan/.test(await panel().innerText()) && await panel().getByRole('button', { name: /Watch this book/ }).count() === 0)
ok('and Shopping was never read', shopGets === 0, String(shopGets))
await ctx.close()

// ── no store for Books ──────────────────────────────────────────────────────
reset({ stores: false })
;({ p, ctx } = await open())
await pick('Deep Work')
ok('with no store carrying Books the card warns before anything is made', /No store in Shopping is set to check “Books”/.test(await panel().innerText()))
await ctx.close()

// ── the whole path ──────────────────────────────────────────────────────────
reset()
;({ p, ctx } = await open())
await pick('Deep Work')
ok('a book not being watched offers it, with no warning when a bookshop exists', await panel().getByRole('button', { name: /Watch this book/ }).count() === 1 && !/No store in Shopping/.test(await panel().innerText()))
ok('a finished book has no watch card', await (async () => { await p.keyboard.press('Escape'); await wait(300); await pick('Emma'); return !/Watch the price/.test(await panel().innerText()) })())
await p.keyboard.press('Escape'); await wait(300); await pick('Deep Work')
await panel().getByLabel('Target price').fill('200'); await panel().getByLabel('Target currency').fill('egp')
shopWrites = []
await panel().getByRole('button', { name: /Watch this book/ }).click(); await wait(1500)
const item = T.shopping_items[0]
ok('it makes one Shopping item: the name, Books, the target and the currency', T.shopping_items.length === 1 && item?.name === 'Deep Work Someone' && item.category === 'Books' && item.target_price_max === 200 && item.currency === 'EGP', JSON.stringify(item))
ok('and only then points the book at it', T.library_books.find(x => x.id === B1).watch_item_id === item?.id)
ok('the card now shows the watch: no price yet, the target, and that the watch is off', /No price seen yet/.test(await panel().innerText()) && await panel().getByLabel('Target price').inputValue() === '200' && /switched off in Shopping/.test(await panel().innerText()))
ok('Check now is unavailable while the watch is off', await panel().getByRole('button', { name: 'Check now' }).isDisabled())
await panel().getByRole('button', { name: 'Switch the watch on' }).click(); await wait(500)
await panel().getByRole('button', { name: 'Check now' }).click(); await wait(2000)
ok('Check now asks the price function about this item at the Books store only', checkBody?.items?.length === 1 && checkBody.items[0].id === item.id && checkBody.items[0].name === 'Deep Work Someone' && checkBody.items[0].stores.map(s => s.id).join() === STORE.id, JSON.stringify(checkBody))
const txt = async () => (await panel().innerText()).replace(/\n/g, ' ')
ok('the price comes back with its shop, when, and a verdict against the target', /EGP 180\.00/.test(await txt()) && /Diwan · checked just now/.test(await txt()) && /at or under your target/.test(await txt()), (await txt()).slice(0, 300))
ok('and links to the shop’s page', await panel().getByRole('link', { name: /open the shop’s page/ }).getAttribute('href') === 'https://diwan.example/p/1')
ok('with the edition caveat on screen', /can be a different edition/.test(await txt()))
shopWrites = []
await panel().getByLabel('Target price').fill('150'); await panel().getByLabel('Target price').blur(); await wait(1200)
ok('a new target is written to the Shopping item and the verdict follows', T.shopping_items[0].target_price_max === 150 && /above your target/.test(await txt()))
const nw = shopWrites.length
await panel().getByLabel('Target price').fill('abc'); await panel().getByLabel('Target price').blur(); await wait(800)
ok('a nonsense target saves nothing and says so', shopWrites.length === nw && await panel().getByRole('alert').count() === 1)
await panel().getByLabel('Target price').fill(''); await panel().getByLabel('Target price').blur(); await wait(1000)
ok('clearing it clears it', T.shopping_items[0].target_price_max === null)

// reload: the link survives, and Shopping is read before a verdict
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await pick('Deep Work')
ok('after a reload the book is still watched, with the price', /EGP 180\.00/.test(await txt()))

// stop
await panel().getByRole('button', { name: 'Stop watching' }).click(); await wait(300)
ok('stopping asks first and nothing is deleted yet', T.shopping_items.length === 1 && await panel().getByRole('button', { name: /Yes, stop/ }).count() === 1)
await panel().getByRole('button', { name: 'Keep watching' }).click(); await wait(300)
ok('"Keep watching" backs out', T.shopping_items.length === 1 && T.library_books.find(x => x.id === B1).watch_item_id === item.id)
await panel().getByRole('button', { name: 'Stop watching' }).click(); await panel().getByRole('button', { name: /Yes, stop/ }).click(); await wait(1500)
ok('confirming removes the Shopping item and the pointer', T.shopping_items.length === 0 && T.library_books.find(x => x.id === B1).watch_item_id === null && await panel().getByRole('button', { name: /Watch this book/ }).count() === 1)

// "Bought it" ends the watch
await panel().getByLabel('Target price').fill('100'); await panel().getByRole('button', { name: /Watch this book/ }).click(); await wait(1500)
ok('watching again starts a fresh item', T.shopping_items.length === 1)
await panel().getByRole('button', { name: /Buy later/ }).click(); await wait(800)
await panel().getByLabel('Price paid').fill('150'); await panel().getByLabel('Price paid').blur(); await wait(1200)
await panel().getByRole('button', { name: /Bought it/ }).click(); await wait(1500)
ok('"Bought it" takes it off the buy list and ends the watch, removing its Shopping item', T.shopping_items.length === 0 && T.library_books.find(x => x.id === B1).watch_item_id === null && T.library_books.find(x => x.id === B1).to_buy === false)
await ctx.close()

// ── a Shopping item that was removed there ──────────────────────────────────
reset({ itemsDelay: 2500 })
;({ p, ctx } = await open())
await pick('Dune')
ok('before Shopping has been read the card does not claim the item is gone', !/has been removed/.test(await panel().innerText()) && /Reading your shopping list/.test(await panel().innerText()))
await wait(4000)
ok('once read, a missing item is said plainly, with nothing checking the price', /has been removed, so nothing is checking its price/.test(await panel().innerText()))
await panel().getByRole('button', { name: 'Forget it' }).click(); await wait(1200)
ok('"Forget it" clears the pointer and offers a new watch', T.library_books.find(x => x.id === B2).watch_item_id === null && await panel().getByRole('button', { name: /Watch this book/ }).count() === 1)
await ctx.close()

// ── a project that has not run 20260036 ─────────────────────────────────────
reset({ migrated: false })
;({ p, ctx } = await open())
await pick('Deep Work')
ok('without the migration nothing is added to Shopping and the card names the file', /20260036_library_watch\.sql/.test(await panel().innerText()) && T.shopping_items.length === 0 && await panel().getByRole('button', { name: /Watch this book/ }).count() === 0)
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
