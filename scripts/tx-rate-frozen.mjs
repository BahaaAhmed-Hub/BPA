#!/usr/bin/env node
/**
 * tx-rate-frozen — changing an exchange rate does not re-price entries already added
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/tx-rate-frozen.mjs [5199] [change|assistant|unreadable]
 *
 * USD is 48. A paid 100 USD entry from July is in the ledger with no rate of its own (the
 * state of every entry older than this change). Then the rate is set to 50.
 *   change     — through the store's one door (what Settings → Exchange rates calls): the old
 *                entry is written back with its rate (fx:USD/EGP=48) BEFORE the rate moves,
 *                still totals 4,800, and a new entry added afterwards is 5,000 with the rate
 *                in its description.
 *   assistant  — the same through set_exchange_rate.
 *   unreadable — the server refuses to list the ledger: the rate must be left at 48.
 * Run on the code before this change (the module is absent) the entry totals 5,000 and nothing
 * is written — that is the control. The stub keeps what it is sent and can refuse.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['change', 'assistant', 'unreadable'].includes(a)) ?? 'change'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const year = new Date().getFullYear()
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const legacy = { id: 'tx-july', user_id: U, account_id: 'a1', to_account_id: null, category_id: 'c-rent', amount: 100, currency: 'USD',
  tx_type: 'expense', payee: 'Landlord', date: `${year}-07-10`, paid_at: `${year}-07-10`, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0 }
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [{ id: 'c-rent', user_id: U, name: 'Rent', icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [legacy],
}
const writes = []   // every write to finance_transactions, as sent
let refuseList = false

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (t === 'finance_transactions' && (m === 'POST' || m === 'PATCH')) {
    const body = JSON.parse(req.postData() ?? 'null')
    for (const row of [].concat(body ?? [])) {
      writes.push(row)
      const i = DB.finance_transactions.findIndex(x => x.id === row.id)
      if (i >= 0) DB.finance_transactions[i] = { ...DB.finance_transactions[i], ...row }; else DB.finance_transactions.push(row)
    }
    return r.fulfill({ status: 201, json: [], headers: CORS })
  }
  if (t === 'finance_transactions' && m === 'GET' && refuseList) return r.fulfill({ status: 500, json: { message: 'down' }, headers: CORS })
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await page.addInitScript(([s]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-fx-rates', JSON.stringify({ USD: 48 }))
}, [session])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)

if (MODE === 'unreadable') refuseList = true

// What an entry totals to. After this change that is txIn; before it, toBase — which is what
// every total used, and why the control (the old code) reads 5,000.
const result = await page.evaluate(async ([mode]) => {
  const fx = await import('/BPA/src/modules/finance/fx.ts')
  const { useFinanceStore } = await import('/BPA/src/modules/finance/financeStore.ts')
  const mod = await import('/BPA/src/modules/finance/txRates.ts').catch(() => null)
  const { executeFinanceTool } = await import('/BPA/src/lib/financeTools.ts')
  const deadline = Date.now() + 8000
  while (!useFinanceStore.getState().transactions.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  const worth = t => mod ? mod.txIn(t) : fx.toBase(Math.abs(t.amount), t.currency)
  const st = useFinanceStore.getState()
  const before = worth(st.transactions[0])
  let changed
  if (mode === 'assistant') changed = await executeFinanceTool('set_exchange_rate', { currency: 'USD', rate: 50 })
  else if (st.changeRate) changed = await st.changeRate('USD', 50)
  else { fx.setRate('USD', 50); changed = true }
  const after = useFinanceStore.getState().transactions.find(t => t.id === 'tx-july')
  const out = { had: !!mod, before, changed, rate: fx.rateFor('USD'), after: after ? worth(after) : null, tags: after?.tags ?? null, note: after?.note ?? null }
  if (mode !== 'unreadable') {
    await useFinanceStore.getState().upsertTransaction({ id: 'tx-new', accountId: 'a1', amount: 100, currency: 'USD', type: 'expense', payee: 'Cafe', categoryId: 'c-rent',
      date: new Date().toISOString().slice(0, 10), paidAt: new Date().toISOString().slice(0, 10), isCleared: true, isRecurring: false, createdAt: new Date().toISOString() })
    const added = useFinanceStore.getState().transactions.find(t => t.id === 'tx-new')
    out.added = { worth: added ? worth(added) : null, tags: added?.tags ?? null, note: added?.note ?? null }
  }
  return out
}, [MODE])
console.log('  ', JSON.stringify(result))
console.log('  writes:', JSON.stringify(writes.map(w => ({ id: w.id, tags: w.tags, note: w.note }))))

ok('the entry started at 4,800 (100 USD at 48)', result.before === 4800, String(result.before))
if (MODE === 'unreadable') {
  ok('the ledger could not be read, so the rate was refused', result.changed === false || result.changed?.error, JSON.stringify(result.changed))
  ok('…and the rate is still 48', result.rate === 48, String(result.rate))
  ok('…and nothing was written', writes.length === 0, String(writes.length))
} else {
  ok('the rate is now 50', result.rate === 50, String(result.rate))
  const frozen = writes.find(w => w.id === 'tx-july')
  ok('the old entry was written back with the rate it had', !!frozen && (frozen.tags ?? []).includes('fx:USD/EGP=48'), JSON.stringify(frozen?.tags))
  ok('…and its description was left alone', frozen && frozen.note == null, String(frozen?.note))
  ok('the old entry still totals 4,800, not 5,000', result.after === 4800, String(result.after))
  ok('an entry added after the change is 5,000', result.added?.worth === 5000, String(result.added?.worth))
  ok('…carries the new rate', (result.added?.tags ?? []).includes('fx:USD/EGP=50'), JSON.stringify(result.added?.tags))
  ok('…and says so in its description', /rate .*1 USD = 50 EGP/.test(result.added?.note ?? ''), String(result.added?.note))
  if (MODE === 'assistant') ok('the assistant says old entries keep their rate', /keep the rate/.test(result.changed?.note ?? ''), result.changed?.note ?? '')
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
