import type { Account, AccountType, Goal, Transaction } from './types'
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

/** What can actually be put into a goal this month. Gold, a flat and anything
 *  else filed as an asset is wealth, not cash — counting it as spare made every
 *  goal "fundable now" and left nothing to plan. It is reported separately
 *  instead, so the screen can say what it is leaving out. */
export const SPENDABLE: AccountType[] = ['payment', 'wallet']

export interface Capacity {
  /** Cash: the positive balances of the spendable accounts. What is owed on
   *  cards is not netted off here — each debt is a goal of its own
   *  (`debtGoals`), with a target of clearing it, so it takes its place in the
   *  ranking rather than silently shrinking every goal at once. */
  held: number
  /** Held in assets — named, never spent by the plan. */
  assets: number
  /** Already saved into goals. That money is sitting in the same accounts, so
   *  without this the same pound funds two things. */
  earmarked: number
  /** What the cards owe, in the base currency — the sum the debt goals carry. */
  owed: number
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
  /** The line items behind the two headline figures.
   *
   *  A number nobody can take apart is a number nobody can check, and these
   *  two are the ones the whole screen rests on. They are emitted by the same
   *  pass that produces the totals, so a breakdown can never disagree with the
   *  figure it explains. */
  detail: CapacityDetail
}

export interface CapacityDetail {
  /** Every account, what it holds in the base currency, and how it counted. */
  accounts: {
    id: string; name: string; amount: number
    /** `cash` is in `held`; `asset` is named and never spent; `owed` is a card
     *  in the red, which becomes a goal to clear rather than a subtraction;
     *  `no-rate` could not be converted and is in nothing at all. */
    counts: 'cash' | 'asset' | 'owed' | 'no-rate'
    currency: string
  }[]
  /** Each goal's saved amount — what comes off as already earmarked. */
  earmarks: { id: string; name: string; amount: number }[]
  /** The window the medians were read from, month by month. `used` is false
   *  for a month with nothing in it, which is dropped before the median. */
  months: { key: string; inc: number; out: number; used: boolean }[]
  /** How the cushion was arrived at. */
  bufferMonths: number
  /** True when a forecast rule has folded the assets into what is held, so the
   *  breakdown can say they are counted rather than named and set aside. */
  assetsCounted?: boolean
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
  goals: Goal[] = [],
): Capacity {
  const base = baseCurrency()

  // What is held, in one currency. An account whose currency has no rate is
  // left out rather than added at face value — the same rule as everywhere.
  const { balances } = liveBalances(accounts, transactions)
  let held = 0
  let assets = 0
  let owed = 0
  const acctRows: CapacityDetail['accounts'] = []
  for (const a of accounts) {
    const raw = balances.get(a.id) ?? a.balance
    const v = toBase(raw, a.currency, base)
    if (v === null) { acctRows.push({ id: a.id, name: a.name, amount: raw, counts: 'no-rate', currency: a.currency }); continue }
    if (v < 0) { owed += -v; acctRows.push({ id: a.id, name: a.name, amount: -v, counts: 'owed', currency: base }); continue }
    if (SPENDABLE.includes(a.accountType)) { held += v; acctRows.push({ id: a.id, name: a.name, amount: v, counts: 'cash', currency: base }) }
    else { assets += v; acctRows.push({ id: a.id, name: a.name, amount: v, counts: 'asset', currency: base }) }
  }

  // What the goals already hold is in those same accounts and is spoken for.
  let earmarked = 0
  const earmarks: CapacityDetail['earmarks'] = []
  for (const g of goals) {
    const v = toBase(g.currentAmount, g.currency ?? base, base)
    if (v === null) continue
    const amount = Math.max(0, v)
    earmarked += amount
    if (amount > 0) earmarks.push({ id: g.id, name: g.name, amount })
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
    assets,
    earmarked,
    owed,
    buffer,
    free: Math.max(0, held - buffer - Math.max(0, committed) - earmarked),
    monthlyIn,
    monthlyOut,
    surplus: monthlyIn - monthlyOut,
    months: live.length,
    committed,
    currency: base,
    detail: {
      accounts: acctRows,
      earmarks,
      months: keys.map(k => ({ key: k, inc: inBy.get(k)!, out: outBy.get(k)!, used: live.includes(k) })),
      bufferMonths,
    },
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
  /** What next month puts into it. Zero for a goal that is still queued
   *  behind another — `startsIn` says when that changes. */
  monthly: number
  /** Months until anything reaches it: 0 for one being funded now, null for
   *  one nothing ever reaches. */
  startsIn: number | null
  /** What it would need each month to land on its deadline. Null with none. */
  required: number | null
  /** The month it lands in, worked out by running the plan forward. `null` if
   *  nothing reaches it inside the horizon. */
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

/** How far ahead the plan is run before it gives up and says "not at this
 *  rate". Ten years is longer than any goal on this screen deserves. */
const HORIZON = 120

// ─── Running the plan forward ────────────────────────────────────────────────
//
//  Dividing what there is once and calling that the plan gets the *first*
//  month right and every month after it wrong. Under **ladder**, everything
//  goes to rank 1: rank 2 gets nothing, so "left ÷ nothing" said *nothing is
//  reaching this goal* — about a goal that starts being funded the moment the
//  one above it lands. That is the whole question the screen is asked, and it
//  was answering it with a division.
//
//  So the plan is run forward instead, a month at a time: the spare cash goes
//  in first, then each month's surplus is divided again among whatever still
//  needs money. A goal completing hands its share to the next one, which is
//  exactly what will happen.
//
//  Two ways to divide it, and the difference matters more than any other
//  setting on the screen:
//
//  **Ladder** — rank 1 is filled before rank 2 sees a pound. Things arrive one
//  after another, each as early as it possibly can. Use it when the order is a
//  real order: the deposit before the car.
//
//  **Share** — every goal moves at once, by a weight of 1/rank, so the first
//  goal gets twice the third's. Nothing arrives as early, but nothing sits
//  still either. Use it when the goals are not really in competition.
//
//  Spare cash today is always poured down the ladder first under both, because
//  a lump sum sitting in an account is not a monthly flow to be shared out —
//  it is money that could finish something now.

export interface MonthShare {
  goalId: string
  amount: number
  /** This is the month it reaches its target. */
  lands: boolean
}

export interface MonthRow {
  /** 'YYYY-MM'. */
  month: string
  /** Month 0 only: what the spare cash did. */
  fromSpare: number
  /** What that month's surplus did. */
  fromSurplus: number
  shares: MonthShare[]
  /** What that month had to work with, before anything was put anywhere. */
  came: number
  /** What left it on a date of its own — a school-fee instalment, a premium.
   *  Zero unless a forecast is supplying them. */
  went: number
  /** What was carried into the next month. Negative means the month ran at a
   *  deficit and the buffer covered it; later months pay it back before any
   *  goal is funded again, which is what actually happens. */
  carried: number
}

export interface Schedule {
  rows: MonthRow[]
  /** Goal id → the month it lands in. */
  landsIn: Map<string, string>
  /** Goal id → what the spare cash put in today. */
  lump: Map<string, number>
  /** Goal id → what the first month it is funded in puts in, and how many
   *  months away that is. */
  monthly: Map<string, number>
  startsIn: Map<string, number>
  /** True where the horizon ran out with money still needed. */
  unfinished: boolean
}

function remainingOf(g: Goal, base: string): number {
  const target = toBase(g.targetAmount, g.currency ?? base, base) ?? g.targetAmount
  const saved  = toBase(g.currentAmount, g.currency ?? base, base) ?? g.currentAmount
  return Math.max(0, target - saved)
}

/**
 * The whole plan, month by month, until everything lands or the horizon runs
 * out. This is the one piece of arithmetic the screen shows its working from.
 */
export interface ScheduleOptions {
  policy?: Policy
  today?: string
  horizon?: number
  /**
   *  What month `m` leaves over, where `m` is months from today.
   *
   *  Absent, every month leaves what a normal one does, which is what the
   *  screen has always assumed. A forecast supplies this instead, so a raise
   *  in March or inflation carried forward can move one month and not the
   *  rest.
   */
  surplusAt?: (m: number) => number
  /**
   *  What leaves in month `m` on a date of its own — a school-fee instalment,
   *  an annual premium. Kept apart from the surplus because it is *lumpy*: the
   *  whole point is that three months of the year are heavy and the rest are
   *  not, which a monthly average can never say.
   */
  outflowAt?: (m: number) => number
}

export function scheduleGoals(
  goals: Goal[],
  capacity: Capacity,
  policyOrOptions: Policy | ScheduleOptions = 'ladder',
  todayArg = todayISO(),
  horizonArg = HORIZON,
): Schedule {
  const opts: ScheduleOptions = typeof policyOrOptions === 'string'
    ? { policy: policyOrOptions, today: todayArg, horizon: horizonArg }
    : policyOrOptions
  const policy  = opts.policy  ?? 'ladder'
  const today   = opts.today   ?? todayArg
  const horizon = opts.horizon ?? horizonArg
  const base = capacity.currency
  const ordered = byRank(goals)
  const need = new Map(ordered.map(g => [g.id, remainingOf(g, base)]))
  const lump = new Map<string, number>()
  const monthly = new Map<string, number>()
  const startsIn = new Map<string, number>()
  const landsIn = new Map<string, string>()
  const rows: MonthRow[] = []

  const put = (g: Goal, amount: number, month: number, shares: MonthShare[]) => {
    const left = need.get(g.id) ?? 0
    const take = Math.min(left, amount)
    if (take <= 0) return 0
    need.set(g.id, left - take)
    if (month > 0 && !startsIn.has(g.id)) { startsIn.set(g.id, month); monthly.set(g.id, take) }
    const lands = (need.get(g.id) ?? 0) <= 0.005
    if (lands && !landsIn.has(g.id)) landsIn.set(g.id, addMonths(today, month))
    const at = shares.find(x => x.goalId === g.id)
    if (at) { at.amount += take; at.lands = at.lands || lands }
    else shares.push({ goalId: g.id, amount: take, lands })
    return take
  }

  /** Divide a pot among the goals that still need money, the way the chosen
   *  policy says to. Both the spare cash and every month's surplus go through
   *  this, or the control means nothing in the case it matters most. */
  const divide = (amount: number, month: number, shares: MonthShare[]): number => {
    const hungry = ordered.filter(g => (need.get(g.id) ?? 0) > 0)
    let left = Math.max(0, amount)
    if (left <= 0 || hungry.length === 0) return 0

    if (policy === 'share') {
      // 1/rank over what still needs money. Anything a finished goal would
      // have taken is re-divided rather than lost.
      const weights = hungry.map((g, i) => 1 / (rankOf(g, i) + 1))
      const total = weights.reduce((a, b) => a + b, 0) || 1
      let spare = 0
      hungry.forEach((g, i) => {
        const cut = left * (weights[i] / total)
        spare += cut - put(g, cut, month, shares)
      })
      // A goal that finished mid-month leaves change; it goes down the ladder.
      for (const g of hungry) { if (spare <= 0) break; spare -= put(g, spare, month, shares) }
      return left - Math.max(0, spare)
    }

    let spent = 0
    for (const g of hungry) {
      if (left <= 0) break
      const owing = need.get(g.id) ?? 0
      // A goal with a deadline takes what that deadline asks for and no more,
      // so the one behind it is not starved for the sake of arriving early.
      const months = g.deadline ? Math.max(1, monthsUntil(g.deadline, today) - month + 1) : 1
      const wanted = g.deadline ? Math.min(owing, owing / months) : owing
      const took = put(g, Math.min(left, wanted), month, shares)
      left -= took; spent += took
    }
    // Whatever a deadline left on the table still has to go somewhere.
    for (const g of hungry) {
      if (left <= 0) break
      const took = put(g, left, month, shares)
      left -= took; spent += took
    }
    return spent
  }

  // A goal that is already there lands now, before anything is divided.
  for (const g of ordered) if ((need.get(g.id) ?? 0) <= 0) landsIn.set(g.id, monthKey(today))

  // Month 0: the spare cash. It used to go down the ladder whatever the policy
  // said, which made Share a control that did nothing in the ordinary case —
  // spare cash covers the first goals outright, so both policies drew the same
  // three lumps in the same month and the toggle read as broken.
  const first: MonthShare[] = []
  const startFree = Math.max(0, capacity.free)
  let pot = startFree
  pot -= divide(startFree, 0, first)
  for (const g of ordered) lump.set(g.id, first.find(x => x.goalId === g.id)?.amount ?? 0)
  if (first.length) {
    rows.push({
      month: monthKey(today), fromSpare: first.reduce((n, s) => n + s.amount, 0), fromSurplus: 0,
      shares: first, came: startFree, went: 0, carried: pot,
    })
  }

  // Then each month, divided again among whatever still needs money.
  //
  // The pot is carried. Without a forecast every month brings the same figure
  // and nothing is ever left over — the ladder pours the remainder into the
  // goals behind, so carrying changes nothing. With one, a month can bring
  // less than nothing: an instalment leaves on its own date and the month runs
  // at a deficit, which the buffer covers and the months after it pay back
  // before any goal is funded again. That is what actually happens, and a flat
  // monthly average can never say it.
  const flat = Math.max(0, capacity.surplus)
  const comes = opts.surplusAt ?? (() => flat)
  const goes  = opts.outflowAt ?? (() => 0)
  // Nothing arrives and nothing is dated: every month would be the same empty
  // row, a hundred and twenty times.
  const barren = !opts.surplusAt && !opts.outflowAt && flat <= 0
  for (let m = 1; m <= horizon && !barren; m++) {
    if (ordered.every(g => (need.get(g.id) ?? 0) <= 0)) break
    const came = comes(m)
    const went = goes(m)
    pot += came - went
    const shares: MonthShare[] = []
    const before = Math.max(0, pot)
    if (before <= 0) {
      // A month that took something out is worth a row even though it put
      // nothing in — that *is* the news. One where simply nothing happened is
      // not, and a run of them is a wall.
      if (went > 0) rows.push({ month: addMonths(today, m), fromSpare: 0, fromSurplus: 0, shares, came, went, carried: pot })
      continue
    }

    divide(before, m, shares)

    const spent = shares.reduce((n, s) => n + s.amount, 0)
    pot -= spent
    if (spent > 0 || went > 0) {
      rows.push({ month: addMonths(today, m), fromSpare: 0, fromSurplus: spent, shares, came, went, carried: pot })
    }
  }

  return {
    rows, landsIn, lump, monthly, startsIn,
    unfinished: ordered.some(g => (need.get(g.id) ?? 0) > 0),
  }
}

/** Each goal, with what the schedule does to it. */
export function planGoals(
  goals: Goal[],
  capacity: Capacity,
  /** A bare policy, or the same options `scheduleGoals` takes — so a forecast
   *  that knows March is heavier than April reaches the dates on the rows and
   *  not only the run drawn under them. */
  policy: Policy | ScheduleOptions = 'ladder',
  today = todayISO(),
): GoalPlan[] {
  const base = capacity.currency
  const ordered = byRank(goals)
  const s = scheduleGoals(goals, capacity, policy, today)

  return ordered.map(g => {
    const remaining = remainingOf(g, base)
    const l = s.lump.get(g.id) ?? 0
    const starts = s.startsIn.get(g.id) ?? null
    const left = Math.max(0, remaining - l)
    const eta = s.landsIn.get(g.id) ?? null
    return {
      goal: g,
      remaining,
      lump: l,
      // What *next* month puts in — nothing, for a goal still queued behind
      // another. `startsIn` is where the screen gets "starts in March".
      monthly: starts === 1 ? (s.monthly.get(g.id) ?? 0) : 0,
      startsIn: left <= 0 ? 0 : starts,
      required: g.deadline ? left / monthsUntil(g.deadline, today) : null,
      eta,
      onTime: g.deadline == null ? null : eta !== null && eta <= monthKey(g.deadline),
    }
  })
}

// ─── A card with a balance is a goal with a target of zero ───────────────────
//
// The old Plan screen drew a debt payoff on sample data beside a Goals screen
// that planned from the ledger. There was never a second problem to solve:
// clearing a card is finding a sum of money by some date, which is exactly what
// a goal is. So every account that owes something appears in the ranking as a
// goal — "Clear CIB World", target the balance, nothing saved yet — and is
// funded, laddered or shared, by the same arithmetic. Paying the card down in
// Balances shrinks the target; settling it makes the goal disappear.

export const DEBT_PREFIX = 'debt:'

export const isDebtGoal = (g: Pick<Goal, 'id'>): boolean => g.id.startsWith(DEBT_PREFIX)

/** The account a debt goal stands for. */
export const debtAccountId = (g: Pick<Goal, 'id'>): string => g.id.slice(DEBT_PREFIX.length)

/**
 * One goal per account in the red. `ranks` is where each was dragged to; one
 * never ranked goes to the front, since interest on a card outruns any saving.
 */
export function debtGoals(
  accounts: Account[],
  transactions: Transaction[],
  ranks: Record<string, number> = {},
): Goal[] {
  const { balances } = liveBalances(accounts, transactions)
  const out: Goal[] = []
  accounts.forEach((a, i) => {
    const bal = balances.get(a.id) ?? a.balance
    if (bal >= 0) return
    const id = `${DEBT_PREFIX}${a.id}`
    out.push({
      id,
      name: `Clear ${a.name}`,
      icon: a.emoji || '💳',
      targetAmount: Math.round(-bal * 100) / 100,
      currentAmount: 0,
      color: a.color,
      sub: `owed on ${a.bank}${a.last4 ? ` ·· ${a.last4}` : ''}`,
      rank: ranks[id] ?? -1000 + i,
      currency: a.currency,
    })
  })
  return out
}
