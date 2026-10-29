import type { Account } from './types'
import type { BudgetRule } from './modals/BudgetRuleModal'
import { isLoan } from './loans'
import { amountFor } from './budgetSteps'

// ─── A payment plan is the loan's budget, stored once ────────────────────────
//
// "2,000 every month from 1 November" is a budget: an amount, a frequency, a day,
// the month it starts and the month it ends. Storing it a second time on the
// loan would be two answers to what the plan is, and they would drift — the
// budget line saying one thing, the goal another.
//
// So the plan **is** the loan's budget rule, and the rule lives at the loan's
// own account id: the budget category made for a loan has the loan's id, so
// there is nothing to map between the two (different tables, no collision).
// Everything that needs the plan — the budget writer, the forecast, the goal —
// reads `rules[loan.id]` through `planOf`, and the form edits it through
// `ruleFromPlan`.
//
// Pure, no React and no store, so it can be run directly: scripts/loan-plan.mjs.

export type PlanFrequency = 'monthly' | 'quarterly' | 'yearly'

export const PLAN_FREQUENCIES: { v: PlanFrequency; label: string; every: string; months: number }[] = [
  { v: 'monthly',   label: 'Monthly',   every: 'every month',   months: 1 },
  { v: 'quarterly', label: 'Quarterly', every: 'every quarter', months: 3 },
  { v: 'yearly',    label: 'Annual',    every: 'once a year',   months: 12 },
]

export interface LoanPlan {
  frequency: PlanFrequency
  /** Each payment, in the loan's own currency. */
  amount: number
  /** The first payment, 'YYYY-MM-DD'. Its day of the month is the day every one
   *  after it falls on (a short month takes its last day). */
  start: string
  /** The last month a payment falls in, 'YYYY-MM'. Absent runs until the loan
   *  is cleared. */
  ends?: string
  /** The account the payments leave. */
  payFromId?: string
}

/** The system parent every loan's line sits under in the Budget. */
export const LOAN_PARENT_NAME = 'Loan repayments'

const monthsOf = (f: PlanFrequency) => PLAN_FREQUENCIES.find(x => x.v === f)?.months ?? 1
const pad = (n: number) => String(n).padStart(2, '0')

/** The 31st of a 30-day month is the 30th, not the 1st of the next one. */
function onDay(year: number, monthIndex: number, day: number): string {
  const last = new Date(year, monthIndex + 1, 0).getDate()
  return `${year}-${pad(monthIndex + 1)}-${pad(Math.min(Math.max(1, day), last))}`
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const isMonth = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}$/.test(s)

/** What is wrong with this plan, in words — or null. A plan that cannot be
 *  written is refused in the form rather than saved half-formed. */
export function planIssue(plan: LoanPlan): string | null {
  if (!(plan.amount > 0)) return 'Give the amount of each payment.'
  if (!isDate(plan.start)) return 'Pick the day of the first payment.'
  if (plan.ends && !isMonth(plan.ends)) return 'The last month is not a month.'
  if (plan.ends && plan.ends < plan.start.slice(0, 7)) return 'The last payment cannot come before the first.'
  return null
}

/** The budget rule that is this plan. A fixed cost — a loan is the example the
 *  Fixed bucket's own help text gives — in the loan's currency, on the day of
 *  the first payment, paid out of `payFromId`. */
export function ruleFromPlan(plan: LoanPlan, loan: Pick<Account, 'currency'>): BudgetRule {
  return {
    schedule: 'repeat',
    amount: plan.amount,
    frequency: plan.frequency,
    rollover: false,
    warn80: false,
    bucket: 'fixed',
    currency: loan.currency,
    starts: plan.start.slice(0, 7),
    ends: plan.ends || undefined,
    dueDay: Number(plan.start.slice(8, 10)),
    dueAccountId: plan.payFromId || undefined,
  }
}

/** The plan a budget rule describes, or null when it is not one: a weekly or
 *  two-monthly rule, a dated one, or one with no day cannot be put in a form
 *  that asks for an amount, a frequency and a first date. */
export function planFromRule(rule: BudgetRule | undefined): LoanPlan | null {
  if (!rule) return null
  if (rule.schedule && rule.schedule !== 'repeat') return null
  const f = rule.frequency
  if (f !== 'monthly' && f !== 'quarterly' && f !== 'yearly') return null
  if (!(rule.amount > 0) || rule.dueDay == null || !isMonth(rule.starts)) return null
  const [y, m] = rule.starts.split('-').map(Number)
  return {
    frequency: f,
    // What the plan asks for now. `rule.amount` is only the base — what every
    // month before the first change had (`budgetSteps.ts`).
    amount: amountFor(rule),
    start: onDay(y, m - 1, rule.dueDay),
    ends: isMonth(rule.ends) ? rule.ends : undefined,
    payFromId: rule.dueAccountId || undefined,
  }
}

/** The plan this loan has, if it has one. */
export const planOf = (rules: Record<string, BudgetRule>, loanId: string): LoanPlan | null =>
  planFromRule(rules[loanId])

/** Every loan's plan, by loan id. */
export function plansOf(rules: Record<string, BudgetRule>, accounts: Pick<Account, 'id' | 'accountType'>[]): Record<string, LoanPlan> {
  const out: Record<string, LoanPlan> = {}
  for (const a of accounts) {
    if (!isLoan(a)) continue
    const p = planOf(rules, a.id)
    if (p) out[a.id] = p
  }
  return out
}

/** Whether this category is a loan's own line. The id is the loan's. */
export const isLoanCategory = (categoryId: string | undefined, accounts: Pick<Account, 'id' | 'accountType'>[]): boolean =>
  !!categoryId && accounts.some(a => isLoan(a) && a.id === categoryId)

/**
 * The dates this plan falls on, from `from` (inclusive) on, at most `limit`.
 * Stops at the plan's last month. Independent of the budget writer on purpose —
 * this is what the form tells you before anything is written — and a harness
 * holds the two to the same dates.
 */
export function scheduleDates(plan: LoanPlan, from: string, limit = 120): string[] {
  if (planIssue(plan)) return []
  const step = monthsOf(plan.frequency)
  const day = Number(plan.start.slice(8, 10))
  const [sy, sm] = plan.start.split('-').map(Number)
  const out: string[] = []
  for (let k = 0; out.length < limit && k < limit * 12; k++) {
    const idx = (sy * 12 + (sm - 1)) + k * step
    const y = Math.floor(idx / 12), mi = idx % 12
    if (plan.ends && `${y}-${pad(mi + 1)}` > plan.ends) break
    const date = onDay(y, mi, day)
    if (date < from) continue
    out.push(date)
  }
  return out
}

/** How many payments clear `owed`, and the day of the last. An open-ended plan
 *  is simulated until the debt is gone; one with a last month that cannot clear
 *  it says by how much it falls short. */
export function payoff(plan: LoanPlan, owed: number, from: string): { payments: number; last: string | null; short: number } {
  if (!(owed > 0) || planIssue(plan)) return { payments: 0, last: null, short: Math.max(0, owed) }
  let left = owed, n = 0, last: string | null = null
  for (const date of scheduleDates(plan, from, 1200)) {
    left -= plan.amount; n++; last = date
    if (left <= 0.005) return { payments: n, last, short: 0 }
  }
  return { payments: n, last, short: Math.max(0, left) }
}

const ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "1 Nov 2026" — a date as a person says it. */
export function dayPhrase(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${ORDER[m - 1] ?? ''} ${y}`
}
export function monthPhrase(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${ORDER[m - 1] ?? ''} ${y}`
}

const grouped = (n: number) => Math.round(n).toLocaleString('en-US')

/** "2,000 EGP every month, from 1 Nov 2026" */
export function planPhrase(plan: LoanPlan, currency: string): string {
  const every = PLAN_FREQUENCIES.find(f => f.v === plan.frequency)?.every ?? ''
  return `${grouped(plan.amount)} ${currency} ${every}, from ${dayPhrase(plan.start)}`
    + (plan.ends ? `, until ${monthPhrase(plan.ends)}` : '')
}
