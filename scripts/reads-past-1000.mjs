// node scripts/reads-past-1000.mjs        (no browser, no dev server)
//   SRC=<path to a checkout>  to run the same claims against other code — the control.
//
// The server answers any single read with at most 1,000 rows and says nothing when it has cut
// the answer short. Every loader of a table that grows is run here against a server that does
// exactly that, with more rows than the ceiling, and must hand back all of them.
//
// The real files are bundled with rolldown (`supabase` is the only thing replaced): the fake
// honours range / order / in / eq / gte / lte / gt / is / not, **enforces the ceiling**, records
// every delete, and can fail the second page of an answer — so a loader that pages is accepted,
// one that does not is caught, and one that turns a failed page into "nothing" is caught too.
import { rolldown } from 'rolldown'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.env.SRC ?? new URL('..', import.meta.url).pathname)
const src = p => join(root, 'src', p)
const dir = mkdtempSync(join(tmpdir(), 'reads-'))

// ── the server ──────────────────────────────────────────────────────────────
writeFileSync(join(dir, 'fake-supabase.mjs'), `
const S = globalThis.__server
function builder(table) {
  const q = { filters: [], orders: [], from: 0, to: Infinity, cols: null, op: 'select', ids: null }
  const b = {
    select(cols) { if (q.op === 'select') q.cols = !cols || cols === '*' ? null : cols.split(',').map(s => s.trim()); return b },
    eq(c, v) { q.filters.push(r => r[c] === v); return b },
    in(c, a) { if (q.op === 'delete') q.ids = a; q.filters.push(r => a.includes(r[c])); return b },
    gte(c, v) { q.filters.push(r => r[c] >= v); return b },
    lte(c, v) { q.filters.push(r => r[c] <= v); return b },
    gt(c, v) { q.filters.push(r => r[c] > v); return b },
    is(c, v) { q.filters.push(r => (r[c] ?? null) === v); return b },
    not(c, op, v) { q.filters.push(r => !((r[c] ?? null) === v)); return b },
    order(c, o) { q.orders.push([c, o && o.ascending === false ? -1 : 1]); return b },
    range(a, z) { q.from = a; q.to = z; return b },
    limit(n) { q.to = q.from + n - 1; return b },
    delete() { q.op = 'delete'; return b },
    upsert() { q.op = 'upsert'; return b },
    insert() { q.op = 'insert'; return b },
    single() { return b }, maybeSingle() { return b },
    then(res, rej) { return Promise.resolve(run()).then(res, rej) },
  }
  function run() {
    if (q.op === 'delete') { S.deleted.push(...(q.ids || [])); return { data: [], error: null } }
    if (q.op !== 'select') return { data: [], error: null }
    S.reads++
    if (S.failFrom != null && q.from >= S.failFrom) return { data: null, error: { message: 'upstream timeout', code: '57014' } }
    let rows = (S.tables[table] || []).filter(r => q.filters.every(f => f(r)))
    for (const [c, d] of [...q.orders].reverse()) rows.sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * d)
    const want = q.to - q.from + 1
    const out = rows.slice(q.from, q.from + Math.min(want, S.cap))     // the server's own ceiling
    S.biggest = Math.max(S.biggest, out.length)
    return { data: q.cols ? out.map(r => Object.fromEntries(q.cols.map(k => [k, r[k]]))) : out, error: null }
  }
  return b
}
const user = { id: 'u1' }
export const supabase = {
  from: builder,
  auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: { user } } }) },
  supabaseUrl: 'http://stub',
}
`)
writeFileSync(join(dir, 'fake-livesync.mjs'), `export const markLocalWrite = () => {}`)

writeFileSync(join(dir, 'entry.ts'), `
export { loadHabitLogsFromDB, loadTasksFromDB, saveTasksToDB } from '${src('lib/dbSync.ts')}'
export { loadTransactions, loadTransactionsSpan, loadEveryTransaction, loadUnpaidTransactions, loadPaidInFuture } from '${src('modules/finance/financeDb.ts')}'
export { loadSmartThreads } from '${src('lib/mailSmartDb.ts')}'
export { loadAllEventMetadata, loadEventStatusMap } from '${src('lib/eventMetadata.ts')}'
export { loadItems, loadSnapshots } from '${src('modules/finance/shopping/shoppingDb.ts')}'
export { loadLibrary, loadLibraryExtras, loadSessions } from '${src('modules/library/libraryDb.ts')}'
`)
const bundle = await rolldown({
  input: join(dir, 'entry.ts'),
  platform: 'node',
  resolve: { alias: { '@': join(root, 'src') } },
  plugins: [{
    name: 'fake-server',
    resolveId(id, importer) {
      if (!importer) return null
      if (/(^|\/)supabase$/.test(id)) return join(dir, 'fake-supabase.mjs')
      if (/(^|\/)liveSync$/.test(id)) return join(dir, 'fake-livesync.mjs')
      return null
    },
  }],
})
const { output } = await bundle.generate({ format: 'esm' })
writeFileSync(join(dir, 'bundle.mjs'), output[0].code)

const server = { tables: {}, cap: 1000, reads: 0, biggest: 0, deleted: [], failFrom: null }
globalThis.__server = server
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { dispatchEvent: () => true, addEventListener() {}, location: { hostname: 'x' } }
globalThis.Event = class { constructor(t) { this.type = t } }
const L = await import(pathToFileURL(join(dir, 'bundle.mjs')).href)

let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`) }
const reset = (tables, extra = {}) => { Object.assign(server, { tables, reads: 0, biggest: 0, deleted: [], failFrom: null, ...extra }) }
const U = 'u1'
const pad = (n, w = 5) => String(n).padStart(w, '0')
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
/** Run one loader over `rows`, and say what came back against what is on the server. */
async function reads(name, tables, run, want, { count = r => r.length } = {}) {
  reset(tables)
  let got, err = null
  try { got = await run() } catch (e) { err = e }
  const n = err ? -1 : count(got)
  ok(`${name}: all ${want} rows arrive`, n === want, err ? `threw ${String(err.message ?? err).slice(0, 80)}` : `${n} of ${want} (server's biggest answer ${server.biggest}, ${server.reads} read(s))`)
}

// ── 1. habit logs (the report) ──────────────────────────────────────────────
const HABITS = 6, DAYS = 250
const logs = []
for (let d = 0; d < DAYS; d++) for (let h = 0; h < HABITS; h++) logs.push({ id: `l${pad(logs.length)}`, user_id: U, habit_id: `h${h}`, date: day(d), quantity: null, completed: true })
await reads('habit logs', { habit_logs: logs }, () => L.loadHabitLogsFromDB(), logs.length, { count: r => Object.values(r.logs).reduce((s, d) => s + d.length, 0) })
{ const newest = day(DAYS - 1)
  reset({ habit_logs: logs }); const r = await L.loadHabitLogsFromDB().catch(() => null)
  ok('habit logs: the newest day is there for every habit', !!r && Array.from({ length: HABITS }, (_, h) => (r.logs[`h${h}`] ?? []).includes(newest)).every(Boolean)) }

// ── 2. tasks: the load, and the save's stale check ──────────────────────────
const tasks = Array.from({ length: 1300 }, (_, i) => ({
  id: `t${pad(i)}`, user_id: U, title: `Task ${i}`, quadrant: 'do', status: 'open', completed: false,
  created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), company_tag: 'personal',
}))
await reads('tasks', { tasks }, () => L.loadTasksFromDB(), tasks.length)
{ reset({ tasks }); const rows = await L.loadTasksFromDB()
  const keep = rows.filter(t => t.id !== 't01299')          // a task deleted on this device: the newest one, past the ceiling
  reset({ tasks }); await L.saveTasksToDB(keep).catch(() => {})
  ok('tasks: a task deleted here that sits past the ceiling is deleted on the server', server.deleted.length === 1 && server.deleted[0] === 't01299', `deleted ${JSON.stringify(server.deleted.slice(0, 3))}`)
  reset({ tasks }); await L.saveTasksToDB(rows).catch(() => {})
  ok('tasks: and saving what it holds deletes nothing', server.deleted.length === 0, `${server.deleted.length} deleted`) }

// ── 3. the ledger ───────────────────────────────────────────────────────────
const TODAY = '2026-10-30'
const tx = (i, extra = {}) => ({ id: `x${pad(i)}`, user_id: U, account_id: 'a', amount: 10, currency: 'EGP', tx_type: 'expense', payee: 'p',
  date: i % 2 ? '2026-03-15' : day(i % 360), paid_at: day(i % 360), is_cleared: true, is_recurring: false, tags: [], created_at: '', ...extra })
const ledger = [...Array.from({ length: 2300 }, (_, i) => tx(i)), ...Array.from({ length: 40 }, (_, i) => tx(5000 + i, { date: '2025-06-01', paid_at: '2025-06-01' }))]
await reads('ledger: one year', { finance_transactions: ledger }, () => L.loadTransactions(2026), 2300)
await reads('ledger: a span of years', { finance_transactions: ledger }, () => L.loadTransactionsSpan(2025, 2026), 2340)
await reads('ledger: every entry', { finance_transactions: ledger }, () => L.loadEveryTransaction(), 2340)
await reads('ledger: every unpaid entry', { finance_transactions: ledger.map((r, i) => i < 1150 ? { ...r, paid_at: null } : r) }, () => L.loadUnpaidTransactions(), 1150)
await reads('ledger: entries paid in the future', { finance_transactions: ledger.map((r, i) => i < 1100 ? { ...r, paid_at: '2099-01-01' } : { ...r, paid_at: '2026-01-01' }) }, () => L.loadPaidInFuture(TODAY), 1100)

// ── 4. mail threads ─────────────────────────────────────────────────────────
const threads = Array.from({ length: 1400 }, (_, i) => ({ user_id: U, account_email: 'a@x.com', thread_id: `th${pad(i)}`, last_message_id: `m${i}`,
  last_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(), subject: 's', section: 'fyi', kind: 'update' }))
await reads('mail threads', { mail_smart_threads: threads }, () => L.loadSmartThreads(['a@x.com'], new Date('2026-09-01')), 1400)

// ── 5. calendar event metadata ──────────────────────────────────────────────
const meta = Array.from({ length: 1100 }, (_, i) => ({ user_id: U, event_id: `e${pad(i)}`, status: 'done', updated_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }))
await reads('event metadata', { google_event_metadata: meta }, () => L.loadAllEventMetadata(), 1100)
await reads('event statuses', { google_event_metadata: meta }, () => L.loadEventStatusMap(), 1100, { count: r => Object.keys(r).length })

// ── 6. shopping ─────────────────────────────────────────────────────────────
const items = Array.from({ length: 1200 }, (_, i) => ({ id: `i${pad(i)}`, user_id: U, group_id: 'g', name: `Item ${i}`, sort_order: i, created_at: '', qty: 1 }))
await reads('shopping items', { shopping_items: items }, () => L.loadItems(), 1200)
const snaps = Array.from({ length: 3000 }, (_, i) => ({ id: `s${pad(i)}`, item_id: items[i % 1200].id, store_id: 'st', price: 10, currency: 'EGP', scraped_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }))
await reads('price snapshots', { shopping_price_snapshots: snaps }, () => L.loadSnapshots(items.map(x => x.id)), 3000)

// ── 7. the library ──────────────────────────────────────────────────────────
const books = Array.from({ length: 1100 }, (_, i) => ({ id: `b${pad(i)}`, user_id: U, title: `Book ${i}`, authors: ['A'], source: 'manual', status: 'want', format: 'paper', rating: 0, shelf_order: i, added_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), updated_at: '' }))
const links = Array.from({ length: 1050 }, (_, i) => ({ list_id: 'l1', book_id: books[i].id, user_id: U, sort_order: i }))
await reads('library books', { library_books: books, library_lists: [], library_list_books: links }, () => L.loadLibrary(), 1100, { count: r => r.books.length })
await reads('library list links', { library_books: books, library_lists: [], library_list_books: links }, () => L.loadLibrary(), 1050, { count: r => r.links.length })
const ts = i => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString()
const quotes = Array.from({ length: 1300 }, (_, i) => ({ id: `q${pad(i)}`, user_id: U, book_id: 'b00000', kind: 'text', body: 'q', created_at: ts(i) }))
const notes = Array.from({ length: 1200 }, (_, i) => ({ id: `n${pad(i)}`, user_id: U, scope: 'book', book_id: 'b00000', body: 'n', created_at: ts(i) }))
const marks = Array.from({ length: 1050 }, (_, i) => ({ id: `k${pad(i)}`, user_id: U, kind: 'page', book_id: 'b00000', created_at: ts(i) }))
const extras = { library_quotes: quotes, library_notes: notes, library_bookmarks: marks }
await reads('library quotes', extras, () => L.loadLibraryExtras(), 1300, { count: r => r.quotes.length })
await reads('library notes', extras, () => L.loadLibraryExtras(), 1200, { count: r => r.notes.length })
await reads('library bookmarks', extras, () => L.loadLibraryExtras(), 1050, { count: r => r.bookmarks.length })
const sessions = Array.from({ length: 1250 }, (_, i) => ({ id: `r${pad(i)}`, user_id: U, book_id: 'b00000', kind: 'read', on_date: day(i % 360), minutes: 20, created_at: ts(i) }))
await reads('reading sessions', { library_sessions: sessions }, () => L.loadSessions(), 1250)

// ── 8. a page that fails is not an empty answer ─────────────────────────────
async function failsLoudly(name, tables, run, expect) {
  reset(tables, { failFrom: 1000 })
  let got, err = null
  try { got = await run() } catch (e) { err = e }
  ok(`${name}: a failed second page is ${expect.label}`, expect.test(got, err), err ? `threw` : JSON.stringify(got)?.slice(0, 60))
}
await failsLoudly('ledger (year)', { finance_transactions: ledger }, () => L.loadTransactions(2026), { label: 'an error, never an empty ledger', test: (g, e) => !!e })
await failsLoudly('habit logs', { habit_logs: logs }, () => L.loadHabitLogsFromDB(), { label: 'an error, never "no logs"', test: (g, e) => !!e })
await failsLoudly('mail threads', { mail_smart_threads: threads }, () => L.loadSmartThreads(['a@x.com'], new Date('2026-09-01')), { label: 'null (could not ask), never none', test: g => g === null })
await failsLoudly('shopping items', { shopping_items: items }, () => L.loadItems(), { label: 'null, never none', test: g => g === null })
await failsLoudly('library', { library_books: books, library_lists: [], library_list_books: links }, () => L.loadLibrary(), { label: 'null, never an empty shelf', test: g => g === null })

// ── 9. the ceiling really was in force ──────────────────────────────────────
reset({ habit_logs: logs }); await L.loadHabitLogsFromDB()
ok('the server really did cut answers at 1,000 (positive: no answer was larger)', server.biggest === 1000 && server.reads >= 2, `biggest ${server.biggest}, reads ${server.reads}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
