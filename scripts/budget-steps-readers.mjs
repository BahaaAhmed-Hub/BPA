#!/usr/bin/env node
/**
 * budget-steps-readers — everything that reads a budget agrees on what it was in a month
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/budget-steps-readers.mjs [5199]
 *
 * The real modules, imported through the dev server and run in the page:
 *   1. budgetEntries.occurrencesFor — a rent due on the 5th at 10,000, raised to 13,000 from
 *      November. The entry written for October must stay 10,000 and November's must be 13,000,
 *      weekly rules included. Written at the new figure for October, the unpaid entry the
 *      ledger already holds is "corrected" to a number nobody agreed to.
 *   2. the assistant — set_budget_envelope raises Rent to 13,000: it records a change from this
 *      month and says so; list_budget_envelopes for last month still answers 10,000 (spent
 *      12,000, 120%), for this month 13,000. spending_by_category over both months sums each
 *      month's own budget, 23,000 — not 26,000.
 * The stub refuses: it answers [] for anything it was not given.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? '5199'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
if (now.getMonth() === 0) { console.log('Run this outside January: "last month" would be in another year.'); process.exit(2) }
const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const lastMonth = `${now.getFullYear()}-${pad(now.getMonth())}`
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const tx = (id, date) => ({ id, user_id: U, account_id: 'a1', to_account_id: null, category_id: 'c-rent', amount: 12000, currency: 'EGP',
  tx_type: 'expense', payee: id, date, paid_at: date, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0 })
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [{ id: 'c-rent', user_id: U, name: 'Rent', icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [tx('last', `${lastMonth}-10`), tx('this', `${thisMonth}-${pad(Math.min(now.getDate(), 27))}`)],
}

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const req = r.request(), u = req.url()
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
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
  localStorage.setItem('finance-budget-rules', JSON.stringify({ 'c-rent': { amount: 10000, frequency: 'monthly', rollover: false, warn80: false, currency: 'EGP', bucket: 'fixed' } }))
}, [session])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)

// ── 1. the entries a budget with a day writes ────────────────────────────────
const occ = await page.evaluate(async () => {
  const { occurrencesFor } = await import('/BPA/src/modules/finance/budgetEntries.ts')
  const at = new Date(2026, 9, 1)   // 1 Oct 2026, fixed: the dates below are not the clock's
  const steps = [{ from: '2026-11', amount: 13000 }]
  const monthly = { amount: 10000, frequency: 'monthly', rollover: false, warn80: false, dueDay: 5, steps }
  const weekly  = { amount: 2000, frequency: 'weekly', rollover: false, warn80: false, dueDay: 3, steps: [{ from: '2026-11', amount: 2500 }] }
  const plain   = { amount: 10000, frequency: 'monthly', rollover: false, warn80: false, dueDay: 5 }
  return { monthly: occurrencesFor(monthly, at, 3), weekly: occurrencesFor(weekly, at, 2), plain: occurrencesFor(plain, at, 3) }
})
console.log('  monthly:', JSON.stringify(occ.monthly.map(o => `${o.date}:${o.amount}`)))
ok('a rule with a change plans four entries', occ.monthly.length === 4, String(occ.monthly.length))
const by = d => occ.monthly.find(o => o.date === d)?.amount
ok('October (before the change) is written at 10,000', by('2026-10-05') === 10000, String(by('2026-10-05')))
ok('November is written at 13,000', by('2026-11-05') === 13000, String(by('2026-11-05')))
ok('December and January follow it', by('2026-12-05') === 13000 && by('2027-01-05') === 13000)
const wk = occ.weekly
ok('weekly: entries exist on both sides of the change', wk.some(o => o.date < '2026-11-01') && wk.some(o => o.date >= '2026-11-01'), String(wk.length))
ok('weekly: each entry carries its own month\'s figure', wk.every(o => o.amount === (o.date < '2026-11-01' ? 2000 : 2500)), JSON.stringify(wk.map(o => `${o.date}:${o.amount}`)))
ok('a rule that never changed is written exactly as before', occ.plain.length === 4 && occ.plain.every(o => o.amount === 10000))

// ── 2. the assistant ─────────────────────────────────────────────────────────
const asst = await page.evaluate(async ([thisM, lastM]) => {
  const { executeFinanceTool } = await import('/BPA/src/lib/financeTools.ts')
  const { useFinanceStore } = await import('/BPA/src/modules/finance/financeStore.ts')
  const deadline = Date.now() + 8000
  while (!useFinanceStore.getState().categories.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  const set = await executeFinanceTool('set_budget_envelope', { category: 'Rent', amount: 13000 })
  const rule = JSON.parse(localStorage.getItem('finance-budget-rules'))['c-rent']
  const last = await executeFinanceTool('list_budget_envelopes', { month: lastM })
  const cur = await executeFinanceTool('list_budget_envelopes', { month: thisM })
  const span = await executeFinanceTool('spending_by_category', { from: `${lastM}-01`, to: `${thisM}-28`, type: 'expense' })
  return { set, rule, last, cur, span, cats: useFinanceStore.getState().categories.length }
}, [thisMonth, lastMonth])
ok('the store has Rent, so the tool can find it', asst.cats === 1, String(asst.cats))
console.log('  set_budget_envelope →', JSON.stringify({ ok: asst.set.ok, was: asst.set.was, now: asst.set.now?.amount, from: asst.set.applies_from, note: asst.set.note_history, error: asst.set.error }))
ok('the assistant\'s write is a recorded change, base untouched', asst.rule?.amount === 10000 && asst.rule?.steps?.length === 1 && asst.rule.steps[0].from === thisMonth && asst.rule.steps[0].amount === 13000, JSON.stringify(asst.rule))
ok('it says what it was and what it is now', asst.set.was?.amount === 10000 && asst.set.now?.amount === 13000)
ok('it says the change applies from this month', asst.set.applies_from === thisMonth && /Earlier months keep 10000/.test(asst.set.note_history ?? ''), asst.set.note_history ?? '')
const envLast = asst.last.envelopes?.find(e => e.category === 'Rent')
const envCur = asst.cur.envelopes?.find(e => e.category === 'Rent')
console.log('  last month:', JSON.stringify(envLast), ' this month:', JSON.stringify(envCur))
ok('last month\'s envelope is still 10,000, 120% used', !!envLast && /10,?000/.test(String(envLast.budget)) && envLast.used === '120%', JSON.stringify(envLast))
ok('this month\'s envelope is 13,000', !!envCur && /13,?000/.test(String(envCur.budget)), JSON.stringify(envCur))
const rentRow = asst.span.categories?.find(c => c.category === 'Rent')
console.log('  two-month range:', JSON.stringify(rentRow))
ok('a two-month range sums each month\'s own budget: 23,000, not 26,000', !!rentRow && /23,?000/.test(String(rentRow.budget)), JSON.stringify(rentRow))

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
