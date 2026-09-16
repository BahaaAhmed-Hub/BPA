// ─── The months where the money runs out ─────────────────────────────────────
//
// `forecast.ts` answers "what does a month look like" and `goalPlan.ts` answers
// "when does this goal land". Neither answers the question you actually ask a
// plan: **which month do I run short, and what put me there.**
//
// It is almost entirely arithmetic that already exists. The forecast knows what
// a normal month leaves (`surplusAt`) and what leaves on its own date
// (`outflowAt`); `capacityFrom` knows what is in the accounts today. Carry that
// forward month by month against the cushion and the answer falls out.
//
// The one genuinely hard part is that three different things all want to charge
// the same month, and two of them are the same money:
//
//   the typical month   rent, groceries, fuel — a median of what was *paid*
//   dated budgets       school fees, a premium — charged on their own dates
//   pending entries     real rows in the ledger, dated ahead, not yet paid
//
// The first two already avoid each other: `buildForecast` pulls a dated budget's
// categories back out of the median by name. The third has never been spread
// across months, so it has never collided with anything. The moment it is, it
// collides with the median, and the result is silent — every month with a
// recurring bill in it simply reads worse than it is.
//
// ── What counts, and once ────────────────────────────────────────────────────
//
// **A budget-written entry is skipped.** `budgetEntries.ts` writes one for every
// repeating budget that carries a due day, and a repeating budget is by
// definition already inside the median. Its rule is the charge; the row is only
// there so a due date has something to tick off.
//
// **A hand-typed entry is charged, and takes back its own share.** Not its
// category's share — *its own*. That distinction is the whole reason this is
// done by payee rather than by category, and the case that forces it is two
// rents. One category, two landlords, both paid every month, both inside the
// median. Drop the category's share because one of them has a dated row and the
// other rent vanishes from the plan. Charge the row on top of the category's
// share and the first rent is paid twice. Matching the payee charges the row
// that exists and removes only what that payee usually costs, which leaves the
// second rent exactly where it was.
//
// A payee with no regular history — a laptop, a deposit, a one-off — has no
// share to take back, so it is simply charged. Which is right: it is not in the
// median either.

import type { Transaction } from './types'
import type { Capacity } from './goalPlan'
import type { Forecast } from './forecast'
import { toBase } from './fx'
import { settled, whenPaid } from './unpaid'
import { todayISO } from './dates'

const monthKey = (iso: string) => iso.slice(0, 7)

function addMonths(key: string, n: number): string {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7)) - 1 + n
  return `${y + Math.floor(m / 12)}-${String((m % 12 + 12) % 12 + 1).padStart(2, '0')}`
}

/** Where a figure on a month came from. The month card prints this beside every
 *  line, so a double count is a thing you can see rather than a thing you have
 *  to trust did not happen. */
export type ChargeSource = 'usual' | 'budget' | 'ledger'

export interface Charge {
  label: string
  /** Signed, in the base currency. Negative leaves. */
  amount: number
  source: ChargeSource
  /** Set for a `ledger` charge, so the card can open the entry it names. */
  txId?: string
  /** What this charge took back out of the typical month so the same money is
   *  not spent twice. Zero for a payee with no regular history. */
  replaces?: number
}

export type MonthState = 'ok' | 'cushion' | 'short'

export interface AheadMonth {
  /** 'YYYY-MM'. */
  month: string
  opening: number
  closing: number
  charges: Charge[]
  state: MonthState
  /** True when something landed *in* this month — a dated budget or a pending
   *  entry. False means the month is simply where the running total crossed the
   *  line, which is drift and takes a completely different fix. */
  landed: boolean
}

export interface MonthsAhead {
  months: AheadMonth[]
  /** The cushion the run was measured against. */
  buffer: number
  currency: string
  /** The first month that is not `ok`, and the worst month by closing balance.
   *  Null when the year holds. */
  firstBreach: AheadMonth | null
  worst: AheadMonth | null
  /** How much more the year needed for every month to clear the cushion. Zero
   *  when nothing breaches. */
  shortfall: number
  /** How many complete months the typical month was read from. Under three this
   *  is a guess rather than a reading, and the screen must say so rather than
   *  colouring anything. */
  readFrom: number
  /** Pending entries that could not be converted into the base currency, so
   *  they are in no month here. Named rather than dropped in silence. */
  unconvertible: number
  /** The first month past the loaded ledger, or null when the whole run is
   *  covered. From there on the months carry the model but no entries. */
  blindFrom: string | null
}

export interface MonthsAheadInput {
  capacity: Capacity
  forecast: Forecast
  transactions: Transaction[]
  today?: string
  /** Twelve by default. The medians come from a handful of live months, so a
   *  claim about month sixty is a shape, not a reading. */
  horizon?: number
  /** The last month whose ledger is actually in memory, 'YYYY-MM'.
   *
   *  One year is loaded at a time, so from September the back half of this run
   *  reaches into a year nobody has fetched. Those months still have a normal
   *  month and a dated budget in them, which is most of the picture — but a
   *  pending entry sitting in next January is not there to be counted, and a
   *  month that says "nothing lands here" because nothing was loaded is a lie
   *  told confidently. The run says where it stops being able to see instead. */
  knownThrough?: string
}

/**
 * What a payee usually costs in a month, from paid history only.
 *
 * Deliberately the same test `typicalMonth` uses to sort a category into
 * regular or lumpy: it counts only if it happened in *more* than half the live
 * months. A landlord paid twelve times out of twelve is regular and has a share
 * to take back; a garage visited twice is not, and takes back nothing.
 */
function regularByPayee(
  transactions: Transaction[],
  liveMonths: string[],
  base: string,
): Map<string, number> {
  if (liveMonths.length === 0) return new Map()
  const live = new Set(liveMonths)
  // payee → month → total spent
  const byPayee = new Map<string, Map<string, number>>()
  for (const tx of settled(transactions)) {
    if (tx.type !== 'expense') continue
    const key = monthKey(whenPaid(tx))
    if (!live.has(key)) continue
    const v = toBase(Math.abs(tx.amount), tx.currency, base)
    if (v === null) continue
    const name = normalisePayee(tx.payee)
    if (!name) continue
    const rows = byPayee.get(name) ?? new Map<string, number>()
    rows.set(key, (rows.get(key) ?? 0) + v)
    byPayee.set(name, rows)
  }
  const out = new Map<string, number>()
  for (const [name, rows] of byPayee) {
    if (rows.size * 2 <= liveMonths.length) continue      // not most months: lumpy
    const vals = liveMonths.map(k => rows.get(k) ?? 0).sort((a, b) => a - b)
    const mid = vals.length % 2
      ? vals[(vals.length - 1) / 2]
      : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
    if (mid > 0) out.set(name, mid)
  }
  return out
}

/** Case and spacing are not a different landlord. */
export function normalisePayee(p: string | undefined): string {
  return (p ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function monthsAhead(input: MonthsAheadInput): MonthsAhead {
  const today = input.today ?? todayISO()
  const horizon = input.horizon ?? 12
  const { capacity, forecast, transactions } = input
  const base = capacity.currency
  const start = monthKey(today)

  const liveMonths = capacity.detail.months.filter(m => m.used).map(m => m.key)
  const usualPayee = regularByPayee(transactions, liveMonths, base)

  // Pending entries, filed by month. A budget wrote some of them; those are
  // already inside the typical month and are not charged again here.
  const pendingByMonth = new Map<string, typeof capacity.detail.pending>()
  for (const p of capacity.detail.pending) {
    if (p.fromBudget) continue
    const rows = pendingByMonth.get(p.month) ?? []
    rows.push(p)
    pendingByMonth.set(p.month, rows)
  }

  let unconvertible = 0
  for (const tx of transactions) {
    if (tx.paidAt || tx.date <= today) continue
    if (toBase(Math.abs(tx.amount), tx.currency, base) === null) unconvertible++
  }

  const months: AheadMonth[] = []
  let opening = capacity.held

  for (let m = 1; m <= horizon; m++) {
    const key = addMonths(start, m)
    const charges: Charge[] = []

    // 1. A normal month, as the forecast reads it.
    const usual = forecast.surplusAt(m)
    charges.push({ label: 'A normal month', amount: usual, source: 'usual' })

    // 2. What leaves on a date of its own — dated budgets, and costs that are
    //    real but not monthly. The forecast already keeps these out of the
    //    median, so there is nothing to take back.
    const dated = forecast.outflowAt(m)
    if (dated > 0) charges.push({ label: 'Budgets with their own dates', amount: -dated, source: 'budget' })

    // 3. Rows already in the ledger for this month, each taking back only what
    //    its own payee usually costs.
    let givenBack = 0
    for (const p of pendingByMonth.get(key) ?? []) {
      const back = p.amount < 0 ? (usualPayee.get(normalisePayee(p.payee)) ?? 0) : 0
      givenBack += back
      charges.push({
        label: p.payee || 'An entry in your ledger',
        amount: p.amount,
        source: 'ledger',
        txId: p.id,
        replaces: back,
      })
    }

    const closing = opening + usual - dated
      + (pendingByMonth.get(key) ?? []).reduce((n, p) => n + p.amount, 0)
      + givenBack

    const state: MonthState = closing < 0 ? 'short'
      : closing < capacity.buffer ? 'cushion'
      : 'ok'

    months.push({
      month: key,
      opening,
      closing,
      charges,
      state,
      landed: dated > 0 || (pendingByMonth.get(key)?.some(p => p.amount < 0) ?? false),
    })
    opening = closing
  }

  const firstBreach = months.find(m => m.state !== 'ok') ?? null
  const worst = months.length
    ? months.reduce((a, b) => (b.closing < a.closing ? b : a))
    : null
  // What the year needed for every month to clear the cushion. The deepest
  // month sets it: fix that one and everything above it clears with it.
  const shortfall = worst && worst.closing < capacity.buffer
    ? capacity.buffer - worst.closing
    : 0

  const blindFrom = input.knownThrough
    ? months.find(m => m.month > input.knownThrough!)?.month ?? null
    : null

  return {
    months,
    blindFrom,
    buffer: capacity.buffer,
    currency: base,
    firstBreach,
    worst,
    shortfall,
    readFrom: capacity.months,
    unconvertible,
  }
}

// ─── What to do about a month that breaks ────────────────────────────────────
//
// The same refusal `goalAdvice.ts` makes: never "spend less". Every move below
// is arithmetic on figures already on the card, and each says what it costs the
// month it moves the money into. A move that only pushes the problem one month
// along is not offered.

export interface MonthMove {
  kind: 'shift' | 'find' | 'drift'
  text: string
  /** The entry to open, where the move is about one. */
  txId?: string
}

export function adviseMonth(ahead: MonthsAhead, month: AheadMonth): MonthMove[] {
  const moves: MonthMove[] = []
  const money = (n: number) => Math.round(Math.abs(n)).toLocaleString('en-GB')

  // Two different needs, and conflating them gives bad advice. A month below
  // zero has an urgent problem — it cannot pay — and moving one date often
  // solves exactly that while leaving it under the cushion, which is a real
  // improvement and worth offering. Measuring every month against the cushion
  // instead rejects that move as insufficient and says nothing useful.
  const urgent = Math.max(0, -month.closing)
  const comfortable = Math.max(0, ahead.buffer - month.closing)
  if (comfortable <= 0) return moves

  const idx = ahead.months.findIndex(m => m.month === month.month)
  const clears = urgent > 0 ? urgent : comfortable

  if (!month.landed) {
    moves.push({
      kind: 'drift',
      text: `Nothing lands in ${monthName(month.month)}. It is where the running total `
        + `crossed the line, so moving a date will not help — the year is `
        + `${money(comfortable)} short of your cushion at its deepest.`,
    })
    return moves
  }

  // Either neighbour can take a charge: earlier is paying it early, later is
  // asking whether it can wait. Both are named as what they are, and neither is
  // offered if it only breaks the other month instead.
  const prev = idx > 0 ? ahead.months[idx - 1] : null
  const next = idx < ahead.months.length - 1 ? ahead.months[idx + 1] : null
  const movable = month.charges
    .filter(c => c.source === 'ledger' && c.amount < 0)
    .sort((a, b) => a.amount - b.amount)

  outer:
  for (const c of movable) {
    if (-c.amount < clears) continue                 // would not clear it on its own
    for (const [side, m] of [['earlier', prev], ['later', next]] as const) {
      if (!m) continue
      const donorAfter = m.closing + c.amount
      if (donorAfter < 0) continue                   // it only moves the problem
      const after = month.closing - c.amount
      moves.push({
        kind: 'shift',
        txId: c.txId,
        text: side === 'earlier'
          ? `Paying ${c.label} in ${monthName(m.month)} instead leaves you ${money(donorAfter)} `
            + `then and ${money(after)} in ${monthName(month.month)}. `
            + `${donorAfter < ahead.buffer || after < ahead.buffer ? 'Both under your cushion, neither short.' : 'That clears both months.'}`
          : `If ${c.label} can wait until ${monthName(m.month)}, ${monthName(month.month)} ends on `
            + `${money(after)} and ${monthName(m.month)} on ${money(donorAfter)}. `
            + `${donorAfter < ahead.buffer || after < ahead.buffer ? 'Both under your cushion, neither short.' : 'That clears both months.'}`,
      })
      break outer
    }
  }

  moves.push({
    kind: 'find',
    text: urgent > 0
      ? `Or find ${money(urgent)} before ${monthName(month.month)} to cover it, `
        + `${money(comfortable)} to keep your cushion whole.`
      : `Or find ${money(comfortable)} before ${monthName(month.month)} — `
        + `${money(comfortable / Math.max(1, idx + 1))} a month from now.`,
  })
  return moves
}

export function monthName(key: string): string {
  const d = new Date(`${key}-01T12:00:00`)
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-GB', { month: 'long' })
}
