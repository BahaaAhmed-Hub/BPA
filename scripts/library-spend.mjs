// node scripts/library-spend.mjs   — needs a dev server on 5199 (restart after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 7d: what a book cost. The fake PostgREST knows the four columns only
// once 20260035 has "run", and enforces its CHECKs (amount >= 0, currency is
// three capitals) — a bad value must be refused by the *server*, not just the form.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const B1 = '00000000-0000-4000-8000-000000000301', B2 = '00000000-0000-4000-8000-000000000302'
const row = (id, title, o = {}) => ({ id, user_id: user.id, title, authors: ['Someone'], source: 'manual', status: 'want', format: 'print', rating: 0, shelf_order: o.n ?? 0, added_at: now, updated_at: now, to_buy: !!o.toBuy, paid_amount: o.amt ?? null, paid_currency: o.cur ?? null, bought_on: o.on ?? null, bought_at: o.at ?? null })
const year = new Date().getFullYear()
let T, migrated = true, writes = []
const reset = () => { T = { library_books: [row(B1, 'Deep Work', { n: 0, toBuy: true }), row(B2, 'Dune', { n: 1, amt: 100, cur: 'EGP', on: `${year}-02-01`, at: 'Diwan' })], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [], library_quote_reviews: [] } }
reset()
const PAID = ['paid_amount', 'paid_currency', 'bought_on', 'bought_at']
const known = () => 'id user_id title subtitle authors isbn publisher published_year pages language description cover_url source source_key status format rating review spine_color file_path shelf_order started_on finished_on added_at updated_at to_buy'.split(' ').concat(migrated ? PAID : [])

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1600 }, locale: 'en-GB' })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5199' })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (m === 'GET') return json(r, t === 'library_books' && !migrated ? T[t].map(x => Object.fromEntries(Object.entries(x).filter(([k]) => !PAID.includes(k)))) : T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_books') for (const rw of rows) {
        for (const k of Object.keys(rw)) if (!known().includes(k)) return json(r, { code: 'PGRST204', message: `Could not find the '${k}' column` }, 400)
        if (rw.paid_amount != null && !(rw.paid_amount >= 0)) return json(r, { code: '23514', message: 'library_books_paid_amount_check' }, 400)
        if (rw.paid_currency != null && !/^[A-Z]{3}$/.test(rw.paid_currency)) return json(r, { code: '23514', message: 'library_books_paid_currency_check' }, 400)
        writes.push(rw)
      }
      for (const rw of rows) { const i = T[t].findIndex(x => x.id === rw.id); if (i >= 0) T[t][i] = { ...T[t][i], ...rw }; else T[t].push(rw) }
      return json(r, [], 201)
    }
    return json(r, [])
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  } catch {} }, session)
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

let { p, ctx } = await open()
const wait = ms => p.waitForTimeout(ms)

// ── pure ────────────────────────────────────────────────────────────────────
const u = await p.evaluate(async () => {
  const m = await import('/BPA/src/modules/library/spendStats.ts')
  const ys = await import('/BPA/src/modules/library/yearStats.ts')
  const bk = (amt, cur, on) => ({ paidAmount: amt, paidCurrency: cur, boughtOn: on })
  const books = [bk(0.1, 'USD', '2026-03-01'), bk(0.2, 'USD', '2026-12-31'), bk(900, 'EGP', '2026-06-01'), bk(40, 'USD', '2027-01-01'), bk(50, 'USD', '2025-12-31'),
    bk(10, undefined, '2026-05-05'), bk(10, 'USD', undefined), bk(undefined, 'USD', '2026-05-05'), bk(0, 'GBP', '2026-05-05')]
  const money = ['12.50', '12,5', '12,50', '1,299', '1,299,000', '1.299,50', '1,299.50', '1.299.000', ' 249 ', '0', '', 'abc', '-5', '12.5.5', '1e3', '12,3456', '1 299,5', '99999999999']
  const full = ys.yearReview(2026, [{ id: 'a', title: 'A', authors: [], status: 'want', rating: 0, ...bk(900, 'EGP', '2026-06-01') }], [], [], [], [], '2026-12-31')
  return {
    parsed: money.map(x => m.parseMoney(x)),
    cur: ['egp', ' usd ', 'EG', 'EGPP', '', 'U$D'].map(x => m.parseCurrency(x)),
    y26: m.spendInYear(books, 2026), y27: m.spendInYear(books, 2027), y25: m.spendInYear(books, 2025), y24: m.spendInYear(books, 2024), lost: m.unplaced(books),
    fm: [m.fmtMoney(1299.5, 'EGP'), m.fmtMoney(0.3, 'USD'), m.fmtMoney(5, 'ZZZ')],
    spentInReview: full.spent, mdEmpty: ys.yearMarkdown(ys.yearReview(2026, [{ id: 'a', title: 'A', authors: [], status: 'want', rating: 0, ...bk(900, 'EGP', '2026-06-01') }], [], [], [], [], '2026-12-31')),
  }
})
ok('amounts parse the way people type them', JSON.stringify(u.parsed) === JSON.stringify([12.5, 12.5, 12.5, 1299, 1299000, 1299.5, 1299.5, 1299000, 249, 0, null, null, null, null, null, null, 1299.5, null]), JSON.stringify(u.parsed))
ok('a currency is three letters, upper-cased', JSON.stringify(u.cur) === JSON.stringify(['EGP', 'USD', null, null, null, null]))
ok('sums are exact: 0.10 + 0.20 is 0.30, per currency, by the day bought', JSON.stringify(u.y26) === JSON.stringify([{ currency: 'EGP', amount: 900, books: 1 }, { currency: 'USD', amount: 0.3, books: 2 }, { currency: 'GBP', amount: 0, books: 1 }]), JSON.stringify(u.y26))
ok('Dec 31 is this year and Jan 1 the next; the year before is its own', u.y27[0].amount === 40 && u.y25[0].amount === 50 && u.y27.length === 1 && u.y25.length === 1)
ok('a year with no purchases is empty, not zero', u.y24.length === 0)
ok('a price with no currency or no date is counted as left out, not guessed (and no price at all is not "left out")', u.lost === 2, String(u.lost))
ok('money is formatted with its code and never with a converted figure', u.fm[0] === 'EGP 1,299.50' && u.fm[1] === 'USD 0.30' && /ZZZ/.test(u.fm[2]), u.fm.join(' | '))
ok('the year review carries what was spent; the Markdown says it even with no book finished', u.spentInReview.length === 1 && /No books finished in 2026 yet\./.test(u.mdEmpty) && /Spent on books: \*\*EGP 900\.00\*\*/.test(u.mdEmpty), u.mdEmpty)

// ── the card ────────────────────────────────────────────────────────────────
const pick = async title => { await p.getByRole('button', { name: new RegExp(title) }).first().click(); await wait(1000) }
const panel = () => p.getByRole('complementary')
await pick('Deep Work')
const card = () => panel().locator('div', { has: p.getByText('What it cost', { exact: true }) }).last()
const amount = () => panel().getByLabel('Price paid'), curr = () => panel().getByLabel('Currency', { exact: true })
ok('the card is in the panel, empty for a book never priced', await amount().inputValue() === '' && await curr().inputValue() === '')
const last = () => writes[writes.length - 1]
writes = []
await amount().fill('249,50'); await amount().blur(); await wait(1200)
ok('typing a price writes it as a number, with today as the day (pre-answered, and visible)', last()?.paid_amount === 249.5 && last()?.bought_on === new Date().toLocaleDateString('en-CA'), JSON.stringify(last()))
ok('the currency arrives pre-filled with the last one you used (Dune is in EGP)', last()?.paid_currency === 'EGP' && await curr().inputValue() === 'EGP')
await curr().fill(''); await curr().blur(); await wait(1200)
ok('without a currency the card says what is missing and the book is not counted', /Add a currency to count this/.test(await panel().innerText()) && last()?.paid_currency === null)
await curr().fill('egp'); await curr().blur(); await wait(1200)
ok('a currency is stored upper-case', last()?.paid_currency === 'EGP' && await curr().inputValue() === 'EGP')
ok('and the price is shown back in full', /EGP 249\.50/.test(await panel().innerText()))
ok('the hint is gone once it is complete', !/to count this in the year/.test(await panel().innerText()))
const nBefore = writes.length
await amount().fill('abc'); await amount().blur(); await wait(1000)
ok('a nonsense price saves nothing and says so', writes.length === nBefore && await panel().getByRole('alert').count() === 1 && /not an amount/.test(await panel().getByRole('alert').innerText()))
await amount().fill('249,50'); await amount().blur(); await wait(1000)
const nMid = writes.length
await curr().fill('EG'); await curr().blur(); await wait(1000)
ok('a two-letter currency saves nothing and says so', writes.length === nMid && /three letters/.test(await panel().getByRole('alert').innerText()))
await curr().fill('EGP'); await curr().blur(); await wait(500)
await panel().getByLabel('Bought at').fill('Diwan, Zamalek'); await panel().getByLabel('Bought at').blur(); await wait(1200)
ok('where it was bought is kept', last()?.bought_at === 'Diwan, Zamalek')
await panel().getByRole('button', { name: /Bought it — take it off the buy list/ }).click(); await wait(1000)
ok('a priced book on the buy list offers to come off it, and does', last()?.to_buy === false && await panel().getByRole('button', { name: /Bought it/ }).count() === 0)
await amount().fill(''); await amount().blur(); await wait(1200)
ok('clearing the price writes null — it really clears', last()?.paid_amount === null)
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
await pick('Dune')
ok('another book keeps its own figures after a reload', await amount().inputValue() === '100' && await curr().inputValue() === 'EGP' && await panel().getByLabel('Bought at').inputValue() === 'Diwan')

// the second price brings the last currency
await p.keyboard.press('Escape'); await wait(300)
await pick('Deep Work')
writes = []
await amount().fill('30'); await amount().blur(); await wait(1200)
ok('the next price starts from the currency you last used', last()?.paid_currency === 'EGP' && await curr().inputValue() === 'EGP', JSON.stringify(last()))

// the Tracker's year card
await p.getByRole('tab', { name: 'Tracker' }).click(); await wait(800)
const body = await p.locator('body').innerText()
ok('the year in review says what was spent: 100 + 30 EGP', new RegExp(`Spent on books\\s*EGP 130\\.00 \\(2\\)`).test(body.replace(/\n/g, ' ')) || /EGP 130\.00/.test(body), (body.match(/Spent on books[^\n]*\n?[^\n]*/) ?? [''])[0])
await ctx.close()

// ── a project that has not run 20260035 ─────────────────────────────────────
migrated = false; reset()
;({ p, ctx } = await open())
await pick('Deep Work')
writes = []
await amount().fill('10'); await amount().blur(); await wait(1500)
ok('without the migration the price is refused and the notice says why', writes.length === 0 && /Could not save the change/.test(await p.locator('body').innerText()) && /paid_amount/.test(await p.locator('body').innerText()))
await p.getByRole('radio', { name: /^4/ }).first().click(); await wait(1200)
ok('and the rest still saves: a rating goes through, carrying none of the new columns', writes.length === 1 && writes[0].rating === 4 && PAID.every(k => !(k in writes[0])), JSON.stringify(writes.map(w => w.rating)))
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)
