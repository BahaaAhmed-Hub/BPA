// A payment plan is the loan's budget, stored once. The real src/modules/finance
// files (loanPlan, budgetEntries, loans) bundled with rolldown and run here — no
// browser, no server.
//   node scripts/loan-plan.mjs
//
// Every claim has a control: the same input with the one property that should
// change the answer changed.
import { rolldown } from 'rolldown'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = { dispatchEvent: () => true }
globalThis.Event = class { constructor(t) { this.type = t } }

const root = resolve(new URL('..', import.meta.url).pathname)
const fin = p => join(root, 'src/modules/finance', p)
const dir = mkdtempSync(join(tmpdir(), 'loanplan-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export * from '${fin('loanPlan.ts')}'
export * from '${fin('loans.ts')}'
export { occurrencesFor, runBudgetEntries, forgetWrittenEntries } from '${fin('budgetEntries.ts')}'
`)
const bundle = await rolldown({
  input: entry, platform: 'node',
  resolve: { alias: { '@': join(root, 'src') } },
})
const { output } = await bundle.generate({ format: 'esm' })
const out = join(dir, 'bundle.mjs')
writeFileSync(out, output[0].code)
const L = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
// Key order is not a difference.
const canon = v => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
const eq = (name, got, want) => {
  const ok = canon(got) === canon(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${canon(got)}\n      want ${canon(want)}`}`)
}

const loan = { currency: 'EGP' }
const plan = (o = {}) => ({ frequency: 'monthly', amount: 2000, start: '2026-11-15', payFromId: 'cib', ...o })

// ── the plan is a budget rule, and back ──────────────────────────────────────
{
  const p = plan({ ends: '2027-03' })
  const r = L.ruleFromPlan(p, loan)
  eq('a plan becomes a repeating fixed-cost budget in the loan\'s currency', [r.schedule, r.bucket, r.currency, r.frequency], ['repeat', 'fixed', 'EGP', 'monthly'])
  eq('…on the day of the first payment, from its month, to its last', [r.dueDay, r.starts, r.ends, r.dueAccountId, r.amount], [15, '2026-11', '2027-03', 'cib', 2000])
  eq('…and reads back as the same plan', L.planFromRule(r), p)
  for (const f of ['quarterly', 'yearly']) {
    const q = plan({ frequency: f })
    eq(`a ${f} plan round-trips`, L.planFromRule(L.ruleFromPlan(q, loan)), q)
  }
  eq('no last month and no account survive as absent', L.planFromRule(L.ruleFromPlan(plan({ payFromId: undefined }), loan)), plan({ payFromId: undefined }))
}

// ── the amount is the one in force, not the base ─────────────────────────────
{
  const base = L.ruleFromPlan(plan(), loan)
  const raised = { ...base, steps: [{ from: '2000-01', amount: 2500 }] }
  eq('a raise made earlier is the plan\'s amount now', L.planFromRule(raised).amount, 2500)
  eq('control — a raise planned for the far future is not yet', L.planFromRule({ ...base, steps: [{ from: '2099-01', amount: 2500 }] }).amount, 2000)
}

// ── what is not a plan ───────────────────────────────────────────────────────
{
  const ok = L.ruleFromPlan(plan(), loan)
  eq('control: a valid rule is a plan', L.planFromRule(ok) !== null, true)
  eq('a weekly budget is not', L.planFromRule({ ...ok, frequency: 'weekly' }), null)
  eq('an every-two-months budget is not', L.planFromRule({ ...ok, frequency: 'every_2_months' }), null)
  eq('a dated budget is not', L.planFromRule({ ...ok, schedule: 'custom' }), null)
  eq('a one-off is not', L.planFromRule({ ...ok, schedule: 'once' }), null)
  eq('a budget with no day is not', L.planFromRule({ ...ok, dueDay: undefined }), null)
  eq('a budget with no amount is not', L.planFromRule({ ...ok, amount: 0 }), null)
  eq('a budget with no start month is not', L.planFromRule({ ...ok, starts: undefined }), null)
  eq('nothing is not', L.planFromRule(undefined), null)
}

// ── what the form refuses ────────────────────────────────────────────────────
eq('control: a good plan has no issue', L.planIssue(plan()), null)
eq('no amount', L.planIssue(plan({ amount: 0 })) !== null, true)
eq('no first day', L.planIssue(plan({ start: '' })) !== null, true)
eq('a last month before the first payment', L.planIssue(plan({ ends: '2026-10' })) !== null, true)
eq('a last month the same as the first is allowed', L.planIssue(plan({ ends: '2026-11' })), null)

// ── the dates ────────────────────────────────────────────────────────────────
{
  eq('monthly, from the first', L.scheduleDates(plan(), '2026-01-01', 4), ['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15'])
  eq('…skipping what has already passed', L.scheduleDates(plan(), '2026-12-16', 2), ['2027-01-15', '2027-02-15'])
  eq('quarterly steps three months', L.scheduleDates(plan({ frequency: 'quarterly' }), '2026-01-01', 3), ['2026-11-15', '2027-02-15', '2027-05-15'])
  eq('annual steps a year', L.scheduleDates(plan({ frequency: 'yearly' }), '2026-01-01', 2), ['2026-11-15', '2027-11-15'])
  eq('a payment on the 31st takes a short month\'s last day, then comes back',
    L.scheduleDates(plan({ start: '2027-01-31' }), '2027-01-01', 4), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  eq('it stops at the last month', L.scheduleDates(plan({ ends: '2027-01' }), '2026-01-01', 99), ['2026-11-15', '2026-12-15', '2027-01-15'])
  eq('control: with no last month it keeps going', L.scheduleDates(plan(), '2026-01-01', 99).length, 99)
  eq('an invalid plan has no dates', L.scheduleDates(plan({ amount: 0 }), '2026-01-01'), [])
}

// ── the form and the writer agree ────────────────────────────────────────────
{
  const now = new Date(2026, 9, 29, 12)              // 29 Oct 2026
  const horizon = '2027-02-28'                        // the writer's: end of now + 4 months
  const same = (name, p) => {
    const writer = L.occurrencesFor(L.ruleFromPlan(p, loan), now, 4).map(o => o.date)
    const form = L.scheduleDates(p, '2026-10-29', 99).filter(d => d <= horizon)
    eq(name, form, writer)
  }
  same('monthly: the dates the form promises are the dates the writer writes', plan())
  same('quarterly', plan({ frequency: 'quarterly', start: '2026-11-30' }))
  same('a plan that has already begun', plan({ start: '2026-08-31' }))
  same('with a last month', plan({ ends: '2026-12' }))
  eq('control: the writer writes something to compare against', L.occurrencesFor(L.ruleFromPlan(plan(), loan), now, 4).length >= 3, true)
}

// ── how long it takes ────────────────────────────────────────────────────────
{
  const r = L.payoff(plan(), 10000, '2026-10-29')
  eq('10,000 at 2,000 a month is five payments, the last in March', [r.payments, r.last, r.short], [5, '2027-03-15', 0])
  eq('10,001 needs a sixth', L.payoff(plan(), 10001, '2026-10-29').payments, 6)
  const cut = L.payoff(plan({ ends: '2027-01' }), 10000, '2026-10-29')
  eq('a plan that ends first says how much would be left', [cut.payments, cut.short], [3, 4000])
  eq('nothing owed, nothing to pay', L.payoff(plan(), 0, '2026-10-29').payments, 0)
  eq('annual: 5,000 at 2,000 a year is three years', L.payoff(plan({ frequency: 'yearly' }), 5000, '2026-10-29').payments, 3)
}

// ── which loan, which category ───────────────────────────────────────────────
{
  const accounts = [
    { id: 'cib', accountType: 'payment' },
    { id: 'ahmed', accountType: 'loan' },
    { id: 'omar', accountType: 'loan' },
  ]
  const rules = { ahmed: L.ruleFromPlan(plan(), loan), cib: L.ruleFromPlan(plan(), loan) }
  eq('only a loan\'s own rule is its plan', Object.keys(L.plansOf(rules, accounts)), ['ahmed'])
  eq('control: a loan with no rule has none', L.planOf(rules, 'omar'), null)
  eq('a category with a loan\'s id is a loan\'s line', [L.isLoanCategory('ahmed', accounts), L.isLoanCategory('cib', accounts), L.isLoanCategory('x', accounts), L.isLoanCategory(undefined, accounts)], [true, false, false, false])
}

// ── in words ─────────────────────────────────────────────────────────────────
eq('a plan in words', L.planPhrase(plan({ ends: '2027-03' }), 'EGP'), '2,000 EGP every month, from 15 Nov 2026, until Mar 2027')
eq('…and one with no end', L.planPhrase(plan({ frequency: 'quarterly' }), 'USD'), '2,000 USD every quarter, from 15 Nov 2026')

// ── the budget writes the instalments as transfers into the lender ───────────
{
  const NOW = new Date(2026, 9, 29, 12)   // 29 Oct 2026
  const cats = [
    { id: 'p', name: 'Loan repayments', txType: 'expense', isSystem: true },
    { id: 'ahmed', name: 'Ahmed', txType: 'expense', isSystem: true, parentId: 'p' },
  ]
  const rules = { ahmed: L.ruleFromPlan(plan(), loan) }
  const run = (over = {}) => {
    // The writer remembers what it wrote this session so a reload cannot make a
    // second copy; each case here is its own session.
    L.forgetWrittenEntries()
    const added = [], removed = []
    const r = L.runBudgetEntries(cats, over.rules ?? rules, over.txs ?? [], 'cib', 2026,
      { add: t => added.push(...t), remove: id => removed.push(id) }, NOW, over.loans ?? { ahmed: { owed: 10000 } })
    return { ...r, added, removed }
  }
  const a = run()
  eq('two instalments fall inside the next three months of this year', a.added.map(t => t.date), ['2026-11-15', '2026-12-15'])
  const t0 = a.added[0]
  eq('each is a transfer out of the pay-from account into the lender', [t0.type, t0.accountId, t0.toAccountId], ['transfer', 'cib', 'ahmed'])
  eq('…filed under the loan\'s own category, unpaid, tagged as the budget\'s', [t0.categoryId, t0.paidAt, t0.isCleared, t0.tags], ['ahmed', undefined, false, ['budget']])
  eq('…of the instalment, in the loan\'s currency, named for the payment', [t0.amount, t0.currency, t0.payee], [2000, 'EGP', 'Payment to Ahmed'])

  // Control: the same plan read as an ordinary budget is spending that leaves the lender untouched.
  L.forgetWrittenEntries()
  const ordinary = L.runBudgetEntries(cats, rules, [], 'cib', 2026, { add: () => {}, remove: () => {} }, NOW)
  eq('control — with no loans map the same rule is an expense and names no lender', (() => {
    L.forgetWrittenEntries()
    const out = []
    L.runBudgetEntries(cats, rules, [], 'cib', 2026, { add: t => out.push(...t), remove: () => {} }, NOW)
    return [out[0]?.type, out[0]?.toAccountId]
  })(), ['expense', undefined])
  eq('…and it did write something to compare against', ordinary.made, 2)

  eq('a cleared loan schedules nothing', run({ loans: { ahmed: { owed: 0 } } }).made, 0)
  eq('control — the same loan, still owed, does', run().made, 2)
  eq('what is owed is a ceiling: 3,000 owed is 2,000 and then 1,000', run({ loans: { ahmed: { owed: 3000 } } }).added.map(t => t.amount), [2000, 1000])
  eq('…and 2,500 owed is 2,000 and then 500, not a third payment', run({ loans: { ahmed: { owed: 2500 } } }).added.map(t => t.amount), [2000, 500])

  // The ledger is what stops a second copy.
  const filed = a.added.map((t, i) => ({ ...t, id: `w${i}` }))
  const again = run({ txs: filed })
  eq('written once: the next pass writes nothing and removes nothing', [again.made, again.dropped], [0, 0])
  const changed = run({ txs: filed, rules: { ahmed: L.ruleFromPlan(plan({ amount: 2500 }), loan) } })
  eq('a changed instalment replaces the unpaid ones it wrote', [changed.dropped, changed.made, changed.added.map(t => t.amount)], [2, 2, [2500, 2500]])
  const cleared = run({ txs: filed, loans: { ahmed: { owed: 0 } } })
  eq('a loan cleared since takes its unpaid future instalments with it', [cleared.dropped, cleared.made], [2, 0])
  const oneSettled = [{ ...filed[0], paidAt: '2026-11-15', isCleared: true }, filed[1]]
  const partly = run({ txs: oneSettled, loans: { ahmed: { owed: 0 } } })
  eq('…but one already paid is a record of money that moved, and stays', partly.removed, [filed[1].id])
  const noPlan = run({ txs: filed, rules: {} })
  eq('a plan taken away removes its unpaid instalments', [noPlan.dropped, noPlan.made], [2, 0])
  eq('the lender cannot be the account it is paid from', run({ rules: { ahmed: { ...L.ruleFromPlan(plan({ payFromId: 'ahmed' }), loan) } } }).made, 0)
}

// ── a repayment is spending for the envelope and for nothing else ────────────
{
  const exp = { type: 'expense', categoryId: 'c' }
  const repay = { type: 'transfer', categoryId: 'ahmed' }
  const plain = { type: 'transfer', categoryId: undefined }
  eq('an expense counts in an expense envelope', L.spendsEnvelope(exp, 'expense'), true)
  eq('a repayment filed under the loan\'s category counts in it', L.spendsEnvelope(repay, 'expense'), true)
  eq('a transfer with no category does not (control: a move between your accounts)', L.spendsEnvelope(plain, 'expense'), false)
  eq('income does not count in an expense envelope', L.spendsEnvelope({ type: 'income', categoryId: 'c' }, 'expense'), false)
  eq('a repayment is not income for an income envelope', L.spendsEnvelope(repay, 'income'), false)
  eq('income counts in an income envelope', L.spendsEnvelope({ type: 'income', categoryId: 'c' }, 'income'), true)
}

// ── paying a lender back settles the instalment that is waiting ──────────────
{
  const inst = (id, date, o = {}) => ({ id, type: 'transfer', accountId: 'cib', toAccountId: 'ahmed', amount: 2000, currency: 'EGP', date,
    paidAt: undefined, isCleared: false, tags: ['budget'], categoryId: 'ahmed', ...o })
  const ledger = [
    inst('oct', '2026-10-29'), inst('nov', '2026-11-29'), inst('dec', '2026-12-29'),
    inst('paid', '2026-09-29', { paidAt: '2026-09-29', isCleared: true }),
    inst('typed', '2026-08-01', { tags: undefined }),                 // someone typed it: not the plan's
    inst('other', '2026-07-01', { toAccountId: 'omar' }),             // another lender's
  ]
  const pick = (txs, d) => L.instalmentFor(txs, 'ahmed', d)?.id
  eq('a payment in the month an instalment is due settles it', pick(ledger, '2026-10-29'), 'oct')
  eq('…and so does one made earlier in that month', pick(ledger, '2026-10-02'), 'oct')
  eq('one made before it is due settles nothing (that is a prepayment, its own entry)', pick(ledger, '2026-09-30'), undefined)
  eq('an older instalment nobody paid is settled before a newer one: the earliest due', pick(ledger, '2026-11-30'), 'oct')
  eq('control — with October paid, the same November payment settles November', pick(ledger.map(t => t.id === 'oct' ? { ...t, paidAt: '2026-10-29' } : t), '2026-11-30'), 'nov')
  eq('a paid entry is never the one settled', ledger.filter(t => L.isPlannedInstalment(t, 'ahmed')).map(t => t.id).includes('paid'), false)
  eq('an entry someone typed (no budget tag) is not the plan\'s', L.isPlannedInstalment(ledger.find(t => t.id === 'typed'), 'ahmed'), false)
  eq('another lender\'s instalment is not this one\'s', L.isPlannedInstalment(ledger.find(t => t.id === 'other'), 'ahmed'), false)
  eq('control — it is that lender\'s own', L.isPlannedInstalment(ledger.find(t => t.id === 'other'), 'omar'), true)
}

// ── what Pay back starts with ────────────────────────────────────────────────
{
  const lender = { id: 'ahmed', name: 'Ahmed', currency: 'EGP' }
  const accounts = [{ id: 'sav', accountType: 'asset' }, { id: 'cib', accountType: 'payment' }, { id: 'wal', accountType: 'wallet' }, { id: 'ahmed', accountType: 'loan' }]
  const due = [{ type: 'transfer', toAccountId: 'ahmed', paidAt: undefined, tags: ['budget'], date: '2026-10-29', amount: 2500 }]
  const P = plan({ payFromId: 'wal' })
  const t = '2026-10-29'
  const a = L.payBackStart(lender, accounts, due, P, 10000, t)
  eq('it opens as a transfer into the lender, named for the payment, in the lender\'s currency', [a.type, a.toAccountId, a.payee, a.currency], ['transfer', 'ahmed', 'Payment to Ahmed', 'EGP'])
  eq('for the instalment that is due (2,500), not the plan\'s figure', a.amount, 2500)
  eq('…from the plan\'s account', a.accountId, 'wal')
  eq('with nothing due it is the plan\'s own amount', L.payBackStart(lender, accounts, [], P, 10000, t).amount, 2000)
  eq('with no plan it is the whole debt', L.payBackStart(lender, accounts, [], null, 10000, t).amount, 10000)
  eq('never more than is owed: 1,500 left on a plan of 2,000', L.payBackStart(lender, accounts, [], P, 1500, t).amount, 1500)
  eq('a plan paid from an account that is gone falls back to the first you can pay from', L.payBackStart(lender, accounts, [], plan({ payFromId: 'gone' }), 5000, t).accountId, 'cib')
  eq('a plan paid from the lender itself does too', L.payBackStart(lender, accounts, [], plan({ payFromId: 'ahmed' }), 5000, t).accountId, 'cib')
  eq('an asset is not somewhere you pay from, whatever order they come in', L.payBackStart(lender, [{ id: 'sav', accountType: 'asset' }, { id: 'cib', accountType: 'payment' }], [], null, 5000, t).accountId, 'cib')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
