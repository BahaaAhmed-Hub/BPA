// Money borrowed is cash in and debt out, and neither is income. The real
// src/modules/finance files (balances, goalPlan, loans, fx, txRates) bundled with
// rolldown and run here — no browser, no server.
//   node scripts/loans.mjs
//
// Every claim has a control: the same fixture with the borrowing filed the way
// it used to have to be (as income), or one property of the fixture changed.
import { rolldown } from 'rolldown'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// fx.ts reads localStorage and announces changes on window.
const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = { dispatchEvent: () => true }
globalThis.Event = class { constructor(t) { this.type = t } }

const root = resolve(new URL('..', import.meta.url).pathname)
const fin = p => join(root, 'src/modules/finance', p)
const dir = mkdtempSync(join(tmpdir(), 'loans-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export { liveBalances, deltaFor } from '${fin('balances.ts')}'
export { debtGoals, capacityFrom, isDebtGoal } from '${fin('goalPlan.ts')}'
export * from '${fin('loans.ts')}'
export { stamped } from '${fin('txRates.ts')}'
export { setRate, rateFor } from '${fin('fx.ts')}'
`)

// goalPlan reaches for the budget screen (React, CSS) only to ask whether an
// entry came from a budget. None of these fixtures do.
const stubs = {
  [fin('budgetEntries.ts')]: 'export const isBudgetEntry = () => false',
}
const bundle = await rolldown({
  input: entry,
  platform: 'node',
  resolve: { alias: { '@': join(root, 'src') } },
  plugins: [{
    name: 'stub',
    resolveId(id, importer) {
      if (id.endsWith('budgetEntries') && importer) return fin('budgetEntries.ts')
      return null
    },
    load(id) { return stubs[id] ?? null },
  }],
})
const { output } = await bundle.generate({ format: 'esm' })
const out = join(dir, 'bundle.mjs')
writeFileSync(out, output[0].code)
const L = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}
const near = (name, got, want) => eq(name, got === null ? null : Math.round(got * 100) / 100, want)

const TODAY = '2026-10-29'
const acc = (o) => ({ bank: '', balance: 0, emoji: 'x', color: 'c', sortOrder: 0, ...o })
const cash   = acc({ id: 'cash',  name: 'CIB',        accountType: 'payment', currency: 'EGP' })
const usdAcc = acc({ id: 'usd',   name: 'USD saving', accountType: 'payment', currency: 'USD' })
const ahmed  = acc({ id: 'ahmed', name: 'Ahmed',      accountType: 'loan',    currency: 'EGP' })
const ahmedUsd = acc({ id: 'ahmed-usd', name: 'Omar', accountType: 'loan',    currency: 'USD' })
const tx = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2), accountId: 'cash', amount: 100, currency: 'EGP',
  type: 'expense', payee: 'p', date: '2026-09-10', paidAt: o.date ?? '2026-09-10', isCleared: true,
  isRecurring: false, createdAt: '', ...o,
})
const salary = ['2026-08-05', '2026-09-05', '2026-10-05'].map(d => tx({ type: 'income', amount: 5000, date: d, paidAt: d, categoryId: 'salary' }))
const borrow = (extra = {}) => tx({ type: 'transfer', accountId: 'ahmed', toAccountId: 'cash', amount: 10000, date: '2026-09-10', payee: 'From Ahmed', ...extra })

L.setRate('USD', 48)

// ── the helpers ──────────────────────────────────────────────────────────────
eq('a loan is a loan', [L.isLoan(ahmed), L.isLoan(cash), L.isLoan(null), L.isLoan(undefined)], [true, false, false, false])
eq('a lender is never somewhere to spend from', L.spendingAccounts([cash, ahmed, usdAcc]).map(a => a.id), ['cash', 'usd'])
eq('…and the spending ones are all still there', L.spendingAccounts([cash, usdAcc]).length, 2)
eq('a lender is found however it was typed', L.findLender([cash, ahmed], '  AHMED ')?.id, 'ahmed')
eq('…not an ordinary account that happens to share the name', L.findLender([acc({ id: 'x', name: 'Ahmed', accountType: 'payment', currency: 'EGP' })], 'Ahmed'), undefined)
eq('…and an empty name finds nothing', L.findLender([ahmed], '   '), undefined)
const made = L.newLender('  Sara ', 'USD')
eq('a new lender is a loan account, opening at nothing', [made.accountType, made.name, made.currency, made.balance], ['loan', 'Sara', 'USD', 0])
eq('borrowing is told from repaying', [
  L.isBorrowing(borrow(), [cash, ahmed]),
  L.isRepayment(borrow(), [cash, ahmed]),
  L.isBorrowing(borrow({ accountId: 'cash', toAccountId: 'ahmed' }), [cash, ahmed]),
  L.isRepayment(borrow({ accountId: 'cash', toAccountId: 'ahmed' }), [cash, ahmed]),
], [true, false, false, true])
eq('an ordinary transfer is neither', [
  L.isBorrowing(borrow({ accountId: 'cash', toAccountId: 'usd' }), [cash, usdAcc, ahmed]),
  L.isRepayment(borrow({ accountId: 'cash', toAccountId: 'usd' }), [cash, usdAcc, ahmed]),
], [false, false])
eq('an expense is neither', L.isBorrowing(tx({ type: 'expense', accountId: 'ahmed' }), [cash, ahmed]), false)

// ── borrowing 10,000: cash in, debt out ──────────────────────────────────────
{
  const { balances } = L.liveBalances([cash, ahmed], [borrow()])
  eq('the account it landed in holds 10,000', balances.get('cash'), 10000)
  eq('the lender is owed 10,000 (below zero)', balances.get('ahmed'), -10000)
  eq('net worth did not move', balances.get('cash') + balances.get('ahmed'), 0)
}

// ── the debt becomes a goal by itself ────────────────────────────────────────
{
  const goals = L.debtGoals([cash, ahmed], [borrow()])
  eq('one goal, for the lender', goals.map(g => g.id), ['debt:ahmed'])
  eq('…named as a person is repaid, not as a card is cleared', goals[0]?.name, 'Repay Ahmed')
  eq('…its target is what is owed', goals[0]?.targetAmount, 10000)
  eq('…and it is recognised as a debt goal', L.isDebtGoal(goals[0] ?? { id: '' }), true)
  eq('a card in the red still says "Clear"', L.debtGoals(
    [acc({ id: 'card', name: 'Visa', accountType: 'credit_card', currency: 'EGP', balance: -500, bank: 'CIB' })], [],
  )[0]?.name, 'Clear Visa')
  const repaid = [borrow(), borrow({ id: 'back', accountId: 'cash', toAccountId: 'ahmed', date: '2026-10-01', paidAt: '2026-10-01' })]
  eq('repaid in full: no goal (control: the same loan, not yet repaid, has one)',
    [L.debtGoals([cash, ahmed], repaid).length, L.debtGoals([cash, ahmed], [borrow()]).length], [0, 1])
  eq('a debt under half a unit reads as settled, as Balances prints it', L.isSettled(0.3), true)
  eq('…and half a unit does not', L.isSettled(0.5), false)
  const nearly = [borrow({ amount: 10000 }), borrow({ id: 'b2', accountId: 'cash', toAccountId: 'ahmed', amount: 9999.7, date: '2026-10-01', paidAt: '2026-10-01' })]
  eq('0.30 still owed: no goal', L.debtGoals([cash, ahmed], nearly).length, 0)
}

// ── it is not income ─────────────────────────────────────────────────────────
{
  const month = (txs) => L.capacityFrom([cash, ahmed], txs, 1, TODAY).detail.months.find(m => m.key === '2026-09')
  const withBorrow = month([...salary, borrow()])
  eq('September earned 5,000 with the borrowing in the ledger', withBorrow?.inc, 5000)
  eq('control — the same 10,000 filed as income reads 15,000', month([...salary, tx({ type: 'income', accountId: 'cash', amount: 10000, categoryId: 'loan' })])?.inc, 15000)
  eq('September spent nothing: repaying/borrowing is not an expense either', withBorrow?.out, 0)
  const cap = L.capacityFrom([cash, ahmed], [...salary, borrow()], 1, TODAY)
  eq('the cash it brought is held', cap.held >= 10000, true)
  eq('and the debt is owed, in the same figure', cap.owed, 10000)
  eq('a normal month still earns 5,000', cap.monthlyIn, 5000)
  const noLoan = L.capacityFrom([cash], salary, 1, TODAY)
  eq('control — with no borrowing, a normal month earns the same', noLoan.monthlyIn, cap.monthlyIn)
}

// ── a lender in another currency, and an account in another again ────────────
{
  // 500 USD from Omar into an EGP account, at 48 today.
  const usdEntry = L.stamped(tx({ id: 'omar', type: 'transfer', accountId: 'ahmed-usd', toAccountId: 'cash', amount: 500, currency: 'USD', date: '2026-10-02', paidAt: '2026-10-02' }))
  eq('the entry carries the rate of the day it was filed', usdEntry.tags, ['fx:USD/EGP=48'])
  const a = L.liveBalances([cash, ahmedUsd], [usdEntry]).balances
  near('the lender is owed 500 USD', a.get('ahmed-usd'), -500)
  near('the pounds that arrive are 500 at 48', a.get('cash'), 24000)

  // The rate moves afterwards. Money already borrowed did not change.
  L.setRate('USD', 50)
  const b = L.liveBalances([cash, ahmedUsd], [usdEntry]).balances
  near('after the rate moves to 50, what arrived is still 24,000', b.get('cash'), 24000)
  near('…and what is owed is still 500 USD, not 480', b.get('ahmed-usd'), -500)

  // And into a dollar account, a lender in dollars: no conversion at all.
  const same = L.stamped(tx({ id: 'omar2', type: 'transfer', accountId: 'ahmed-usd', toAccountId: 'usd', amount: 500, currency: 'USD', date: '2026-10-03', paidAt: '2026-10-03' }))
  L.setRate('USD', 52)
  const c = L.liveBalances([usdAcc, ahmedUsd], [same]).balances
  near('dollars borrowed into a dollar account stay 500 whatever the rate does', c.get('usd'), 500)
  near('…and 500 owed', c.get('ahmed-usd'), -500)
  L.setRate('USD', 48)
}

// ── the form's preview, and the case it must refuse ──────────────────────────
{
  const e = L.borrowingEnds(500, 'USD', ahmedUsd, cash)
  near('500 USD borrowed from a USD lender: 500 owed', e.owed, 500)
  near('…and 24,000 pounds arrive', e.arrives, 24000)
  const none = L.borrowingEnds(1000, 'AED', ahmed, cash)
  eq('a currency nobody gave a rate for cannot be converted — nothing is guessed', none, { owed: null, arrives: null })
  const aedLoan = acc({ id: 'aed-loan', name: 'Khalid', accountType: 'loan', currency: 'AED' })
  const unrated = tx({ type: 'transfer', accountId: 'aed-loan', toAccountId: 'cash', amount: 1000, currency: 'AED' })
  const { unconverted } = L.liveBalances([cash, aedLoan], [unrated])
  eq('filed anyway, the receiving account says AED was not counted', [...(unconverted.get('cash') ?? [])], ['AED'])
}

// ── the cash-flow views show it beside In, never inside ──────────────────────
{
  const back = borrow({ id: 'back', accountId: 'cash', toAccountId: 'ahmed', amount: 4000, date: '2026-10-01', paidAt: '2026-10-01' })
  eq('10,000 borrowed', L.borrowedIn([borrow()], [cash, ahmed], 'EGP'), 10000)
  eq('paying 4,000 back is not borrowing more (control: it is a transfer too)', [
    L.borrowedIn([borrow(), back], [cash, ahmed], 'EGP'),
    [borrow(), back].filter(t => t.type === 'transfer').length,
  ], [10000, 2])
  eq('salary and spending are not borrowing', L.borrowedIn([...salary, tx({ type: 'expense', amount: 300 })], [cash, ahmed], 'EGP'), 0)
  eq('a move between your own accounts is not borrowing', L.borrowedIn(
    [tx({ type: 'transfer', accountId: 'cash', toAccountId: 'usd', amount: 900 })], [cash, usdAcc, ahmed], 'EGP'), 0)
  const usd = L.stamped(tx({ type: 'transfer', accountId: 'ahmed-usd', toAccountId: 'cash', amount: 500, currency: 'USD' }))
  eq('500 USD is counted in the base at the rate it was filed at', L.borrowedIn([usd], [cash, ahmedUsd], 'EGP'), 24000)
  const aed = tx({ type: 'transfer', accountId: 'aed-l', toAccountId: 'cash', amount: 1000, currency: 'AED' })
  eq('a currency with no rate is left out, not added at face value (1,000 AED is not 1,000)', L.borrowedIn(
    [aed], [cash, acc({ id: 'aed-l', name: 'K', accountType: 'loan', currency: 'AED' })], 'EGP'), 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
