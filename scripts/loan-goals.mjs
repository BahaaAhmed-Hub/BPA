// A loan's payment plan is paid first. The real src/modules/finance files (goalPlan,
// forecast, monthsAhead, loanPlan, loans, balances) bundled with rolldown and run
// here — no browser, no server.
//   node scripts/loan-goals.mjs
//
// Every claim has a control: the same fixture with the plan taken away.
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
const dir = mkdtempSync(join(tmpdir(), 'loangoals-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export { scheduleGoals, planGoals, debtGoals, capacityFrom, DEBT_PREFIX } from '${fin('goalPlan.ts')}'
export { buildForecast, emptyState } from '${fin('forecast.ts')}'
export { monthsAhead } from '${fin('monthsAhead.ts')}'
export { ruleFromPlan, plansOf, planPhrase } from '${fin('loanPlan.ts')}'
export { setRate } from '${fin('fx.ts')}'
`)
const bundle = await rolldown({ input: entry, platform: 'node', resolve: { alias: { '@': join(root, 'src') } } })
const { output } = await bundle.generate({ format: 'esm' })
const out = join(dir, 'bundle.mjs')
writeFileSync(out, output[0].code)
const L = await import(pathToFileURL(out).href)

let pass = 0, fail = 0
const canon = v => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
const eq = (name, got, want) => {
  const ok = canon(got) === canon(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${canon(got)}\n      want ${canon(want)}`}`)
}

const TODAY = '2026-10-29'
const acc = (o) => ({ bank: '', balance: 0, emoji: 'x', color: 'c', sortOrder: 0, ...o })
const tx = (o) => ({ id: o.id ?? Math.random().toString(36).slice(2), accountId: 'cash', amount: 100, currency: 'EGP', type: 'expense', payee: 'p',
  date: '2026-10-01', paidAt: o.date ?? '2026-10-01', isCleared: true, isRecurring: false, createdAt: '', ...o })
const salary = ['2026-08-05', '2026-09-05', '2026-10-05'].map(d => tx({ type: 'income', amount: 5000, date: d, paidAt: d, categoryId: 'salary' }))
const plan = (o = {}) => ({ frequency: 'monthly', amount: 2000, start: '2026-11-15', payFromId: 'cash', ...o })
const loanOf = (id, owed, cur = 'EGP') => acc({ id, name: 'Ahmed', accountType: 'loan', currency: cur, balance: -owed })
const cashOf = (n = 0) => acc({ id: 'cash', name: 'CIB', accountType: 'payment', currency: 'EGP', balance: n })
const car = { id: 'car', name: 'Car', icon: 'x', targetAmount: 6000, currentAmount: 0, color: 'c', sub: '', rank: 1, currency: 'EGP' }

/** Run the real planner the way the Goals screen does. */
function run({ owed = 10000, free = 0, cash = 0, plans = { ahmed: plan() }, policy = 'ladder', goals = [car], rules, state, accounts, txs = salary, extra = {} }) {
  const accts = accounts ?? [cashOf(cash), loanOf('ahmed', owed)]
  const budgets = rules ?? Object.fromEntries(Object.entries(plans).map(([id, p]) => [id, L.ruleFromPlan(p, { currency: 'EGP' })]))
  const flat = L.capacityFrom(accts, txs, 0, TODAY, goals)
  const forecast = L.buildForecast({ accounts: accts, transactions: txs, categories: [], budgets, capacity: flat, state: state ?? L.emptyState(), today: TODAY, months: 24 })
  // Spare cash is set, not read: the salary in the fixture lands in the cash
  // account, which would otherwise be 15,000 of spare cash clearing the debt on
  // day one and every row below would be about that instead.
  const capacity = { ...forecast.capacity, free }
  const all = [...goals, ...L.debtGoals(accts, txs, {}, L.plansOf(budgets, accts))]
  const opts = { policy, today: TODAY, surplusAt: forecast.surplusAt, outflowAt: forecast.outflowAt, fixed: forecast.fixed, ...extra }
  const schedule = L.scheduleGoals(all, capacity, opts, TODAY)
  const rows = schedule.rows
  const paid = id => rows.reduce((n, r) => n + (r.shares.find(s => s.goalId === id)?.amount ?? 0), 0)
  const inMonth = (i, id) => rows[i]?.shares.find(s => s.goalId === id)?.amount ?? 0
  return { schedule, rows, forecast, capacity, accts, budgets, all, paid, inMonth, landed: id => schedule.landsIn.get(id) ?? null }
}
const D = 'debt:ahmed'

// ── the instalment first, and the rest to the next goal ──────────────────────
{
  const withPlan = run({})
  eq('a debt goal exists for the loan, and it is ranked ahead of the car', [withPlan.all.some(g => g.id === D), withPlan.all.find(g => g.id === D).rank < car.rank], [true, true])
  eq('month 1: the instalment 2,000, and the next goal gets the other 3,000', [withPlan.inMonth(0, D), withPlan.inMonth(0, 'car')], [2000, 3000])
  eq('month 2: the same', [withPlan.inMonth(1, D), withPlan.inMonth(1, 'car')], [2000, 3000])
  eq('the car lands in month 2 and the debt in month 5, on its plan', [withPlan.landed('car'), withPlan.landed(D)], ['2026-12', '2027-03'])
  eq('the debt was paid exactly once: 10,000, not the instalments plus a share of the surplus', withPlan.paid(D), 10000)

  // Control: the same ranking with the plan taken away. The debt is first, so it
  // takes everything: the whole 5,000, and the car waits.
  const without = run({ plans: {} })
  eq('control — with no plan the debt takes the whole surplus: 5,000 a month', [without.inMonth(0, D), without.inMonth(0, 'car')], [5000, 0])
  eq('…so it lands in month 2 and the car has to wait for it', [without.landed(D), without.landed('car')], ['2026-12', '2027-02'])
}

// ── under every policy ───────────────────────────────────────────────────────
for (const policy of ['ladder', 'share', 'commit']) {
  const extra = {}
  const goals = policy === 'commit' ? [{ ...car, monthlyCommit: 1000 }] : [car]
  const r = run({ policy, goals })
  eq(`${policy}: the instalment is exactly 2,000 every month, not a ranked share`, [0, 1, 2, 3, 4].map(i => r.inMonth(i, D)), [2000, 2000, 2000, 2000, 2000])
  eq(`${policy}: the debt lands on its plan, in month 5`, r.landed(D), '2027-03')
  eq(`${policy}: the next goal still gets what the plan leaves, 3,000 a month`, [r.inMonth(0, 'car'), r.inMonth(1, 'car')], [3000, 3000])
}

// ── "paid whatever happens" ──────────────────────────────────────────────────
{
  // A month that leaves 1,000 against an instalment of 2,000.
  const thin = run({ extra: { surplusAt: () => 1000 } })
  eq('a short month still pays the instalment in full', thin.inMonth(0, D), 2000)
  eq('…and the next goal gets nothing, rather than the instalment being the thing that is cut', thin.inMonth(0, 'car'), 0)
  eq('…the month runs at a deficit that is carried, not hidden', [thin.rows[0].carried, thin.rows[1].carried], [-1000, -2000])
  eq('the debt still lands on its plan', thin.landed(D), '2027-03')
  // Control: the same short month with no plan is funded from what there is.
  const thinNo = run({ plans: {}, extra: { surplusAt: () => 1000 } })
  eq('control — with no plan, the debt takes only the 1,000 there is', thinNo.inMonth(0, D), 1000)
}

// ── what is owed is a ceiling ────────────────────────────────────────────────
{
  const small = run({ owed: 3000 })
  eq('3,000 owed on a plan of 2,000: 2,000, then 1,000, then nothing', [0, 1, 2].map(i => small.inMonth(i, D)), [2000, 1000, 0])
  eq('…and it lands in month 2', small.landed(D), '2026-12')
}

// ── spare cash today may still finish it early ───────────────────────────────
{
  const rich = run({ free: 4000 })
  eq('spare cash today goes to the debt first, as it does for any debt', rich.schedule.lump.get(D), 4000)
  eq('…and the plan then pays the remaining 6,000 in 2,000s: month 1 is an instalment, 10,000 in all', [rich.inMonth(1, D), rich.paid(D)], [2000, 10000])
  eq('…landing in month 3, sooner than the plan alone', rich.landed(D), '2027-01')
}

// ── the forecast ─────────────────────────────────────────────────────────────
{
  const r = run({})
  const f = r.forecast.fixed.get(D)
  eq('the forecast has this loan\'s instalments, by its goal', typeof f, 'function')
  eq('month 0 is nothing: this month\'s are already unpaid entries, which are committed', f(0), 0)
  eq('months 1–5 are the plan, and 6 is past the debt', [1, 2, 3, 4, 5, 6].map(f), [2000, 2000, 2000, 2000, 2000, 0])
  eq('all the cash leaving into lenders in month 1', r.forecast.loansAt(1), 2000)
  eq('a year of them (the debt ends first): 10,000', r.forecast.loansYearly, 10000)
  const rule = r.forecast.rules.find(x => x.id === 'loans')
  eq('it is a rule you can see, on, with its figure', [rule.on, rule.value, !!rule.dormant], [true, 10000, false])
  eq('the normal month is untouched by it (control: the same with no plan)', r.forecast.surplusAt(1), run({ plans: {} }).forecast.surplusAt(1))

  const off = run({ state: { off: ['loans'], values: {}, own: [] } })
  eq('switched off: nothing is taken first and the cash view charges nothing', [off.forecast.fixed.size, off.forecast.loansAt(1), off.forecast.loansYearly], [0, 0, 0])
  const scaled = run({ state: { off: [], values: { loans: 5000 }, own: [] } })
  eq('a figure of your own is a year\'s worth, scaled onto the same months: 5,000 is half', scaled.forecast.fixed.get(D)(1), 1000)

  const settled = run({ owed: 0 })
  const none = settled.forecast.rules.find(x => x.id === 'loans')
  eq('a cleared loan has no instalments, and the rule says why it is dormant', [settled.forecast.fixed.size, !!none.dormant], [0, true])
  const noPlan = run({ plans: {} })
  eq('a loan with no plan is dormant too', [noPlan.forecast.fixed.size, !!noPlan.forecast.rules.find(x => x.id === 'loans').dormant], [0, true])

  // A dollar loan: 2,000 USD is 96,000 at 48.
  L.setRate('USD', 48)
  const usd = run({ accounts: [cashOf(0), loanOf('ahmed', 5000, 'USD')], rules: { ahmed: L.ruleFromPlan(plan(), { currency: 'USD' }) } })
  eq('a plan in dollars is charged in the base at the rate: 2,000 USD = 96,000', usd.forecast.fixed.get(D)(1), 96000)
}

// ── the cash projection ──────────────────────────────────────────────────────
{
  const mk = (plans) => {
    const r = run({ plans })
    return L.monthsAhead({ capacity: r.capacity, forecast: r.forecast, transactions: salary, today: TODAY, horizon: 6 })
  }
  const withPlan = mk({ ahmed: plan() }), without = mk({})
  const line = withPlan.months[0].charges.find(c => c.label === 'Loan payment plans')
  eq('next month charges the loan plans as cash leaving', [line?.amount, line?.source], [-2000, 'budget'])
  eq('…and lands on the month, so a short month can be told what put it there', withPlan.months[0].landed, true)
  eq('the month closes 2,000 lower than with no plan', Math.round(without.months[0].closing - withPlan.months[0].closing), 2000)
  eq('control — with no plan there is no such line', without.months[0].charges.some(c => c.label === 'Loan payment plans'), false)
  eq('after the debt is paid the line is gone (month 6)', withPlan.months[5].charges.some(c => c.label === 'Loan payment plans'), false)
}

// ── an unpaid instalment THIS month is cash spoken for; later ones are the plan's ──
{
  const accts = [cashOf(8000), loanOf('ahmed', 10000), acc({ id: 'sav', name: 'Savings', accountType: 'payment', currency: 'EGP' })]
  const inst = (date, o = {}) => tx({ id: `i${date}`, type: 'transfer', accountId: 'cash', toAccountId: 'ahmed', amount: 2000, date, paidAt: undefined, isCleared: false, tags: ['budget'], categoryId: 'ahmed', ...o })
  const move = tx({ id: 'mv', type: 'transfer', accountId: 'cash', toAccountId: 'sav', amount: 2000, date: '2026-10-31', paidAt: undefined, isCleared: false })
  const cap = (txs) => L.capacityFrom(accts, txs, 0, TODAY, [])
  eq('an unpaid repayment due later this month is committed', cap([inst('2026-10-31')]).committed, 2000)
  eq('…and is named as the budget\'s own, so the cash projection does not charge it again', cap([inst('2026-10-31')]).detail.pending.map(p => [p.amount, p.fromBudget]), [[-2000, true]])
  eq('one due NEXT month is not: the plan takes it off that month\'s money, and counting it here would take it twice', cap([inst('2026-11-03')]).committed, 0)
  eq('control — an unpaid move between your own accounts leaves nothing, so is not', cap([move]).committed, 0)
  eq('it takes the spare cash down by what is spoken for', cap([]).free - cap([inst('2026-10-31')]).free, 2000)
  eq('control — a month of instalments filed ahead takes none off it', cap([]).free - cap([inst('2026-11-03'), inst('2026-12-03')]).free, 0)
}

// ── the goal says how it is being paid ───────────────────────────────────────
{
  const accts = [cashOf(0), loanOf('ahmed', 10000)]
  const sub = (plans) => L.debtGoals(accts, [], {}, plans)[0].sub
  eq('with a plan the goal says so', sub({ ahmed: plan() }), 'loan · 2,000 EGP every month, from 15 Nov 2026')
  eq('control — with none it says what it is', sub({}), 'money you borrowed')
}

// ── an instalment due later THIS month is already filed, and is not in the schedule ──
{
  // The plan begins today, so the writer has filed today's instalment as an unpaid
  // transfer: committed cash, month 0. The schedule starts at month 1.
  const startToday = plan({ start: TODAY })
  const filed = tx({ id: 'inst0', type: 'transfer', accountId: 'cash', toAccountId: 'ahmed', amount: 2000, date: TODAY, paidAt: undefined, isCleared: false, tags: ['budget'], categoryId: 'ahmed' })
  const r = run({ plans: { ahmed: startToday }, txs: [...salary, filed] })
  const goal = r.all.find(g => g.id === D)
  eq('the goal asks for what is left once this month\'s filed instalment is paid: 8,000, not 10,000', goal.targetAmount, 8000)
  eq('the plan pays that in months 1–4', [1, 2, 3, 4, 5].map(m => r.forecast.fixed.get(D)(m)), [2000, 2000, 2000, 2000, 0])
  eq('so the goal LANDS (month 4), instead of waiting for money no month provides', r.landed(D), '2027-02')
  eq('and nothing is paid twice: 8,000 in the schedule, 2,000 already filed', r.paid(D), 8000)
  // Control: the same plan with nothing filed yet asks for the whole debt.
  const unfiled = run({ plans: { ahmed: startToday } })
  eq('control — with today\'s instalment not yet filed the goal asks for all 10,000', unfiled.all.find(g => g.id === D).targetAmount, 10000)
  eq('…and the plan pays it in months 1–5', [1, 2, 3, 4, 5].map(m => unfiled.forecast.fixed.get(D)(m)), [2000, 2000, 2000, 2000, 2000])
  // A paid one is not "due": it is already out of the balance.
  const paid = run({ plans: { ahmed: startToday }, owed: 10000, txs: [...salary, { ...filed, paidAt: TODAY, isCleared: true }] })
  eq('an instalment already paid is in the balance, so it takes nothing off the goal: 8,000', paid.all.find(g => g.id === D).targetAmount, 8000)
  // The last payment of the debt falling this month leaves nothing to schedule.
  const last = run({ plans: { ahmed: startToday }, owed: 2000, txs: [...salary, filed] })
  eq('when this month\'s instalment clears it, there is no goal and nothing scheduled', [last.all.some(g => g.id === D), last.forecast.fixed.size], [false, 0])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
