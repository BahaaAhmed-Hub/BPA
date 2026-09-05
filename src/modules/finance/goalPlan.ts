import type { Account, Goal, Transaction } from './types'
import { liveBalances } from './balances'
import { toBase, baseCurrency } from './fx'
import { settled, whenPaid } from './unpaid'
import { todayISO } from './dates'

// ─── Can this goal actually happen? ──────────────────────────────────────────
//
// A target and a deadline on their own are a wish. What turns one into a plan
// is knowing three things, and this works all three out of the ledger that is
// already there:
//
//   1. What is spare **now**  — money sitting in accounts, less a buffer you
//      would not touch. Cash held against a credit-card balance is not spare:
//      the net position is what counts.
//   2. What arrives **each month** — the median of what has actually come in
//      and gone out, over the last few months. The median, not the average:
//      one bonus or one boiler should not reset the plan.
//   3. What is already **spoken for** — entries dated ahead that nobody has
//      paid yet. That money is committed even though it has not moved.
//
// Then the goals are ranked, and the money is poured down the ranking. Rank is
// the whole point: when there is not enough for everything, something has to
// go first, and saying so out loud beats each goal quietly taking a share and
// none of them arriving.

/** How many months of history to read. Long enough to average out a strange
 *  month, short enough that a raise or a move shows up. */
export const WINDOW_MONTHS = 6

/** Months of typical spending held back before any goal is funded. Emptying
 *  the account into a goal is how a goal gets raided again the next time
 *  something breaks. */
export const DEFAULT_BUFFER_MONTHS = 1

export interface Capacity {
  /** Everything held across accounts, net of what is owed on cards. */
  held: number
  /** Kept back for ordinary life. */
  buffer: number
  /** Held less the buffer, never below zero: what could go into goals today. */
  free: number
  /** Median month, from what has actually been paid. */
  monthlyIn: number
  monthlyOut: number
  /** What a normal month leaves over. Negative means the goals wait. */
  surplus: number
  /** How many complete months the medians were taken from. */
  months: number
  /** Entries dated ahead that have not been paid — already spoken for. */
  committed: number
  currency: string
}

const monthKey = (iso: string) => iso.slice(0, 7)

function median(ns: number[]): number {
  if (ns.length === 0) return 0
  const s = [...ns].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The last `WINDOW_MONTHS` complete months before this one, as keys. The
 *  current month is left out: a month you are three days into is not a month. */
function windowKeys(today: string, n = WINDOW_MONTHS): string[] {
  const [y, m] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export function capacityFrom(
  accounts: Account[],
  transactions: Transaction[],
  bufferMonths = DEFAULT_BUFFER_MONTHS,
  today = todayISO(),
): Capacity {
  const base = baseCurrency()

  // What is held, in one currency. An account whose currency has no rate is
  // left out rather than added at face value — the same rule as everywhere.
  const { balances } = liveBalances(accounts, transactions)
  let held = 0
  for (const a of accounts) {
    const v = toBase(balances.get(a.id) ?? a.balance, a.currency, base)
    if (v !== null) held += v
  }

  // A normal month, from what actually moved.
  const keys = windowKeys(today)
  const inBy = new Map<string, number>()
  const outBy = new Map<string, number>()
  for (const k of keys) { inBy.set(k, 0); outBy.set(k, 0) }
  for (const tx of settled(transactions)) {
    const k = monthKey(whenPaid(tx))
    if (!inBy.has(k)) continue
    const v = toBase(Math.abs(tx.amount), tx.currency, base)
    if (v === null) continue
    if (tx.type === 'income')  inBy.set(k, inBy.get(k)! + v)
    if (tx.type === 'expense') outBy.set(k, outBy.get(k)! + v)
  }
  // Months with nothing in them at all are months this ledger did not cover,
  // not months you earned nothing — counting them would halve the median.
  const live = keys.filter(k => inBy.get(k)! > 0 || outBy.get(k)! > 0)
  const monthlyIn  = median(live.map(k => inBy.get(k)!))
  const monthlyOut = median(live.map(k => outBy.get(k)!))

  // Dated ahead and not paid: owed, whatever the account balance says.
  let committed = 0
  for (const tx of transactions) {
    if (tx.paidAt) continue
    if (tx.date <= today) continue
    const v = toBase(Math.abs(tx.amount), tx.currency, base)
    if (v === null) continue
    if (tx.type === 'expense') committed += v
    if (tx.type === 'income')  committed -= v
  }

  const buffer = Math.max(0, monthlyOut * bufferMonths)
  return {
    held,
    buffer,
    free: Math.max(0, held - buffer - Math.max(0, committed)),
    monthlyIn,
    monthlyOut,
    surplus: monthlyIn - monthlyOut,
    months: live.length,
    committed,
    currency: base,
  }
}

// ─── Pouring the money down the ranking ──────────────────────────────────────

export type Policy = 'ladder' | 'share'

export interface GoalPlan {
  goal: Goal
  /** Still to find, in the base currency. */
  remaining: number
  /** Taken from what is spare today. */
  lump: number
  /** Taken from each month's surplus. */
  monthly: number
  /** What it would need each month to land on its deadline. Null with none. */
  required: number | null
  /** The month it lands in at this rate, `null` if nothing reaches it. */
  eta: string | null
  /** Whether the eta is on or before the deadline. Null with no deadline. */
  onTime: boolean | null
}

export const rankOf = (g: Goal, i: number) => g.rank ?? i

export function byRank(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name))
}

/** Whole months from today until a date, at least one. */
export function monthsUntil(deadline: string, today = todayISO()): number {
  const [y, m, d] = deadline.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const n = (y - ty) * 12 + (m - tm) + (d >= td ? 0 : -1)
  return Math.max(1, n)
}

function addMonths(today: string, n: number): string {
  const [y, m] = today.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 *  Two ways to divide what there is, and the difference matters more than any
 *  other setting on the screen:
 *
 *  **Ladder** — rank 1 is filled before rank 2 sees a pound. Things arrive one
 *  after another, each as early as it possibly can. Use it when the order is a
 *  real order: the deposit before the car.
 *
 *  **Share** — every goal moves at once, by a weight of 1/rank, so the first
 *  goal gets twice the third's. Nothing arrives as early, but nothing sits
 *  still either. Use it when the goals are not really in competition.
 *
 *  Spare cash today is always poured down the ladder first under both, because
 *  a lump sum sitting in an account is not a monthly flow to be shared out —
 *  it is money that could finish something now.
 */
export function planGoals(
  goals: Goal[],
  capacity: Capacity,
  policy: Policy = 'ladder',
  today = todayISO(),
): GoalPlan[] {
  const base = capacity.currency
  const ordered = byRank(goals)

  const remainingOf = (g: Goal) => {
    const target = toBase(g.targetAmount, g.currency ?? base, base) ?? g.targetAmount
    const saved  = toBase(g.currentAmount, g.currency ?? base, base) ?? g.currentAmount
    return Math.max(0, target - saved)
  }

  // 1. The lump, down the ladder, whatever the policy.
  let free = capacity.free
  const lump = new Map<string, number>()
  for (const g of ordered) {
    const take = Math.min(free, remainingOf(g))
    lump.set(g.id, take)
    free -= take
  }

  // 2. The monthly surplus.
  const need = new Map(ordered.map(g => [g.id, remainingOf(g) - (lump.get(g.id) ?? 0)]))
  const monthly = new Map<string, number>()
  const hungry = ordered.filter(g => (need.get(g.id) ?? 0) > 0)
  let surplus = Math.max(0, capacity.surplus)

  if (policy === 'share') {
    // 1/rank, normalised over what still needs money.
    const weights = hungry.map((g, i) => 1 / (rankOf(g, i) + 1))
    const total = weights.reduce((s, w) => s + w, 0) || 1
    hungry.forEach((g, i) => monthly.set(g.id, surplus * (weights[i] / total)))
  } else {
    for (const g of hungry) {
      if (surplus <= 0) { monthly.set(g.id, 0); continue }
      const left = need.get(g.id)!
      // A goal with a deadline takes what that deadline asks for and no more,
      // so the one behind it is not starved for the sake of arriving early.
      const wanted = g.deadline ? Math.min(left, left / monthsUntil(g.deadline, today)) : left
      const take = Math.min(surplus, wanted)
      monthly.set(g.id, take)
      surplus -= take
    }
  }

  return ordered.map(g => {
    const remaining = remainingOf(g)
    const l = lump.get(g.id) ?? 0
    const m = monthly.get(g.id) ?? 0
    const left = Math.max(0, remaining - l)
    const required = g.deadline ? left / monthsUntil(g.deadline, today) : null
    const eta = left <= 0 ? monthKey(today) : m > 0 ? addMonths(today, Math.ceil(left / m)) : null
    return {
      goal: g,
      remaining,
      lump: l,
      monthly: m,
      required,
      eta,
      onTime: g.deadline == null ? null : eta !== null && eta <= monthKey(g.deadline),
    }
  })
}
