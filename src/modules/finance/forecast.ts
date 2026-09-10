import type { Account, Category, Transaction } from './types'
import type { Capacity } from './goalPlan'
import { WINDOW_MONTHS } from './goalPlan'
import { occurrencesFor, isBudgetEntry } from './budgetEntries'
import { scheduleOf, type BudgetRule } from './modals/BudgetRuleModal'
import { toBase, baseCurrency } from './fx'
import { whenPaid, settled } from './unpaid'
import { todayISO } from './dates'

// ─── What next year actually looks like ──────────────────────────────────────
//
//  `capacityFrom` answers what a *normal* month leaves over, out of the last
//  six. That is the right answer to the question it asks, and the wrong one to
//  plan a goal with, because next year is not six flat copies of a normal
//  month: school fees land on four dates, a bonus arrives in March, an
//  insurance premium once a year. A plan built on the flat figure says the
//  laptop arrives in May and then quietly fails to buy it.
//
//  This turns the ledger and the budgets into a **month-by-month** picture, and
//  it does it as a set of rules you can see and switch off, because every one
//  of them is a judgement about the future and none of them should be silent.
//
//  Three hard rules hold the file together:
//
//  1. **Nothing is invented.** Every figure traces to the ledger, to a budget
//     you wrote, or to a rate you gave. A rule that cannot find its figure goes
//     *dormant* and names what it is missing — it never guesses one.
//  2. **A rule is a switch, and the switch means something.** Off, its effect
//     is gone from every date on the screen. That is the whole reason to show
//     the working rather than a single number.
//  3. **Your figure beats ours.** A corrected value is kept and marked, and
//     nothing later overwrites it.

export type RuleId =
  | 'income' | 'spend' | 'bonus' | 'budgets' | 'committed' | 'buffer' | 'cash' | 'inflation'

export type Source = 'ledger' | 'budget' | 'setting' | 'published'

export interface Rule {
  id: RuleId
  /** What it does, as a sentence. */
  title: string
  /** When it fires. */
  when: string
  /** The figure it uses. `null` where it has none and is dormant. */
  value: number | null
  unit: string
  source: Source
  /** The working, one line each. */
  why: string[]
  /** What it would take to make this one speak, where it cannot. */
  dormant?: string
  /** Whether it is being applied. */
  on: boolean
  /** True when `value` is one you typed rather than one we read. */
  yours: boolean
}

/** What the person has decided about the rules. */
export interface ForecastState {
  /** Rules switched off by hand. */
  off: RuleId[]
  /** Figures corrected by hand. */
  values: Partial<Record<RuleId, number>>
  own: OwnRule[]
}

/** A fact about the future that no ledger can hold: a raise, a car being sold,
 *  a loan that starts in March. */
export interface OwnRule {
  id: string
  what: string
  kind: 'income' | 'expense'
  amount: number
  /** `every` from that month on, `once` in it, `year` in that month each year. */
  when: 'every' | 'once' | 'year'
  /** 'YYYY-MM'. */
  month: string
  on: boolean
}

export const FORECAST_KEY = 'finance-forecast'

export const emptyState = (): ForecastState => ({ off: [], values: {}, own: [] })

export function loadForecast(): ForecastState {
  try {
    const raw = JSON.parse(localStorage.getItem(FORECAST_KEY) ?? 'null') as ForecastState | null
    if (!raw) return emptyState()
    return { off: raw.off ?? [], values: raw.values ?? {}, own: raw.own ?? [] }
  } catch { return emptyState() }
}

export const FORECAST_EVENT = 'finance:forecastChanged'

export function saveForecast(next: ForecastState): void {
  try { localStorage.setItem(FORECAST_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  window.dispatchEvent(new Event(FORECAST_EVENT))
}

// ─── Reading the ledger ──────────────────────────────────────────────────────

const monthKey = (iso: string) => iso.slice(0, 7)

/** Month index from today: 0 is this month, 1 is next. */
export function monthsFrom(today: string, month: string): number {
  const [ty, tm] = today.split('-').map(Number)
  const [my, mm] = month.split('-').map(Number)
  return (my - ty) * 12 + (mm - tm)
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Each month's income and expense, from what has actually been paid. */
function byMonth(txs: Transaction[], base: string, months: number, today: string) {
  const first = addMonths(monthKey(today), -months)
  const inc = new Map<string, number>()
  const out = new Map<string, number>()
  for (const tx of settled(txs)) {
    const key = monthKey(whenPaid(tx))
    if (key < first || key > monthKey(today)) continue
    const v = toBase(Math.abs(tx.amount), tx.currency, base)
    if (v === null) continue
    const into = tx.type === 'income' ? inc : tx.type === 'expense' ? out : null
    if (!into) continue
    into.set(key, (into.get(key) ?? 0) + v)
  }
  return { inc, out }
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

const money = (v: number, cur: string) => `${cur} ${Math.round(v).toLocaleString('en-US')}`

export interface ForecastInput {
  accounts: Account[]
  transactions: Transaction[]
  categories: Category[]
  budgets: Record<string, BudgetRule>
  capacity: Capacity
  state: ForecastState
  /** Yearly rate, as a percentage. `null` where nobody has given one — the
   *  inflation rule is then dormant rather than assuming a figure. */
  inflation?: number | null
  today?: string
  /** How far the plan has to reach. Ten years, like the goal horizon. */
  months?: number
}

export interface Forecast {
  rules: Rule[]
  /** What month `m` leaves over, before dated bills. */
  surplusAt: (m: number) => number
  /** What leaves in month `m` on a date of its own. */
  outflowAt: (m: number) => number
  /** The capacity the plan should actually run on, with the applied rules in it. */
  capacity: Capacity
  /** A normal month, before and after the dated bills are counted. */
  flatSurplus: number
  datedYearly: number
  /** Every month's dated total, so a screen can draw them. */
  dated: number[]
}

/**
 *  Build the rules, and the month-by-month picture the applied ones produce.
 */
export function buildForecast(input: ForecastInput): Forecast {
  const today = input.today ?? todayISO()
  const months = input.months ?? 120
  const base = input.capacity.currency || baseCurrency()
  const { capacity, state } = input
  const isOff = (id: RuleId) => state.off.includes(id)
  const mine = (id: RuleId) => state.values[id]

  const { inc, out } = byMonth(input.transactions, base, WINDOW_MONTHS, today)
  const incs = [...inc.values()]
  const outs = [...out.values()]
  const medIn = median(incs)
  const medOut = median(outs)
  const meanIn = incs.length ? incs.reduce((a, b) => a + b, 0) / incs.length : 0

  // ── the bonus: one month more than double the rest ────────────────────────
  let bonusMonth: string | null = null
  let bonusAmount = 0
  for (const [key, v] of inc) {
    if (medIn > 0 && v > medIn * 2 && v - medIn > bonusAmount) { bonusMonth = key; bonusAmount = v - medIn }
  }

  // ── the dated bills, month by month ───────────────────────────────────────
  const now = new Date(today + 'T12:00:00')
  const dated = new Array<number>(months + 1).fill(0)
  let datedYearly = 0
  for (const [categoryId, rule] of Object.entries(input.budgets)) {
    if (!rule) continue
    const kind = scheduleOf(rule)
    if (kind === 'repeat') continue          // a monthly rule is already in the median
    const cat = input.categories.find(c => c.id === categoryId)
    if (!cat) continue
    const sign = cat.txType === 'income' ? 1 : -1
    for (const { date, amount } of occurrencesFor(rule, now, months)) {
      const m = monthsFrom(monthKey(today), monthKey(date))
      if (m < 0 || m > months) continue
      const v = toBase(amount, rule.currency ?? base, base)
      if (v === null) continue
      dated[m] += sign * v
      if (m < 12) datedYearly += v
    }
  }

  // Money the median already carries: an instalment paid inside the window is
  // in `medOut` as well as in the schedule above, and counting it twice is how
  // a plan invents a bill nobody has.
  const already = new Set<string>()
  for (const tx of settled(input.transactions)) {
    if (!isBudgetEntry(tx) || !tx.categoryId) continue
    const key = monthKey(whenPaid(tx))
    if (key > monthKey(today) || key < addMonths(monthKey(today), -WINDOW_MONTHS)) continue
    already.add(tx.categoryId)
  }

  const flatSurplus = medIn - medOut

  const rules: Rule[] = [
    {
      id: 'income', source: 'ledger', unit: `${base} a month`, on: !isOff('income'),
      value: mine('income') ?? (incs.length ? medIn : null),
      yours: mine('income') != null,
      dormant: incs.length ? undefined : 'no income has been paid in the last six months',
      title: 'A normal month of income is the middle month, not the average',
      when: `Fires once ${WINDOW_MONTHS} months of paid income are in the ledger.`,
      why: [
        `${incs.length} month${incs.length === 1 ? '' : 's'} read, from money that actually moved.`,
        `Middle month: ${money(medIn, base)}. Average of the same months: ${money(meanIn, base)}.`,
        meanIn > medIn
          ? `The gap is one unusual month. An average turns it into ${money(meanIn - medIn, base)} a month you do not have, every month, for ever.`
          : 'Median and average agree here, so nothing unusual is in the window.',
      ],
    },
    {
      id: 'spend', source: 'ledger', unit: `${base} a month`, on: !isOff('spend'),
      value: mine('spend') ?? (outs.length ? medOut : null),
      yours: mine('spend') != null,
      dormant: outs.length ? undefined : 'no spending has been paid in the last six months',
      title: 'A normal month of spending is the middle month too',
      when: 'Fires once six months of paid expenses are in the ledger.',
      why: [
        `${outs.length} month${outs.length === 1 ? '' : 's'} read: middle month ${money(medOut, base)}.`,
        `So a normal month leaves ${money(flatSurplus, base)}.`,
        'Months with nothing in them are dropped, or a ledger that starts halfway through the window halves its own answer.',
      ],
    },
    {
      id: 'bonus', source: 'ledger', unit: `${base}, once a year`, on: !isOff('bonus') && bonusMonth != null,
      value: mine('bonus') ?? (bonusMonth ? bonusAmount : null),
      yours: mine('bonus') != null,
      dormant: bonusMonth ? undefined : 'no month of income stands out from the rest',
      title: bonusMonth
        ? `The ${new Date(bonusMonth + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long' })} bonus is counted once a year, on its own month`
        : 'A bonus is counted once a year, not spread across it',
      when: 'Fires when one month of income is more than double the middle month.',
      why: bonusMonth ? [
        `${bonusMonth} brought ${money(inc.get(bonusMonth) ?? 0, base)} against a normal ${money(medIn, base)}.`,
        `The difference, ${money(bonusAmount, base)}, is left out of the monthly figure and added back each year in that month.`,
        'One year is one sighting. Switched off, it is dropped entirely — the safest reading, and the slowest plan.',
      ] : ['Nothing in the window stands out far enough to be one.'],
    },
    {
      id: 'budgets', source: 'budget', unit: `${base} a year, on their own dates`, on: !isOff('budgets'),
      value: mine('budgets') ?? (datedYearly > 0 ? datedYearly : null),
      yours: mine('budgets') != null,
      dormant: datedYearly > 0 ? undefined : 'no budget carries dates of its own yet',
      title: 'Budgets with dates land on those dates, not as a monthly average',
      when: 'Fires for every budget whose shape is once, or a set of dates.',
      why: [
        `${money(datedYearly, base)} falls in the next twelve months, across ${dated.slice(0, 12).filter(v => v !== 0).length} of them.`,
        `Spread flat that would be ${money(datedYearly / 12, base)} a month — a figure that leaves the account on no day of the year.`,
        already.size > 0
          ? `${already.size} of these already appear in the six months the median read, so that much is not counted twice.`
          : 'None of them fall inside the six months the median read, so none is counted twice.',
      ],
    },
    {
      id: 'committed', source: 'ledger', unit: `${base} already owed`, on: !isOff('committed'),
      value: mine('committed') ?? (capacity.committed > 0 ? capacity.committed : null),
      yours: mine('committed') != null,
      dormant: capacity.committed > 0 ? undefined : 'nothing dated ahead is unpaid',
      title: 'An entry dated ahead and unpaid is money already spoken for',
      when: 'Fires for every entry with no payment date and a date still to come.',
      why: [
        `${money(capacity.committed, base)} is dated ahead and has not been paid.`,
        'It is out of every balance already — that is what unpaid means here — and out of the spare cash a goal may start from.',
        'Counting it as spare would fund a goal with money that has an owner.',
      ],
    },
    {
      id: 'buffer', source: 'setting', unit: 'months held back', on: !isOff('buffer'),
      value: mine('buffer') ?? (capacity.months > 0 && medOut > 0 ? capacity.buffer / medOut : null),
      yours: mine('buffer') != null,
      title: 'Keep some months back before anything is called spare',
      when: 'Fires always. The number is yours, on this screen.',
      why: [
        `${money(capacity.buffer, base)} held out of the plan.`,
        'This is the single biggest lever on every date here, which is why it is a rule you can see rather than a constant somebody chose.',
      ],
    },
    {
      id: 'cash', source: 'ledger', unit: `${base} not counted`, on: !isOff('cash'),
      value: mine('cash') ?? (capacity.assets > 0 ? capacity.assets : null),
      yours: mine('cash') != null,
      dormant: capacity.assets > 0 ? undefined : 'no account is filed as an asset',
      title: 'Only cash is spare — gold, a flat, an investment is not',
      when: 'Fires for every account filed as an asset rather than a payment account or a wallet.',
      why: [
        `${money(capacity.assets, base)} is held in assets and never spent by the plan.`,
        `Spare cash without it: ${money(capacity.held, base)}.`,
        'Counting what you own rather than what you can spend reports every goal as reachable today, and stops being a plan.',
      ],
    },
    {
      id: 'inflation', source: 'published', unit: '% a year',
      on: !isOff('inflation') && input.inflation != null && !isOff('inflation'),
      value: mine('inflation') ?? input.inflation ?? null,
      yours: mine('inflation') != null,
      dormant: input.inflation == null && mine('inflation') == null
        ? 'no rate has been given — put one in Settings → Finance → Forecast, with its source'
        : undefined,
      title: 'Carry spending forward on a published inflation rate',
      when: 'Fires when the plan runs past twelve months, and only if you switch it on.',
      why: [
        'Only spending is carried. Income is not — a raise is a thing that happens to you, not a rate, and assuming one is how a plan flatters itself.',
        'This is a forecast about the country rather than a reading of your ledger, so it is off until you give a rate and say where it came from.',
      ],
    },
  ]

  // ── what the applied rules add up to ──────────────────────────────────────
  const val = (id: RuleId) => {
    const r = rules.find(x => x.id === id)
    return r && r.on && r.value != null ? r.value : 0
  }
  const income = val('income')
  const spend = val('spend')
  const infl = val('inflation')
  const growth = infl > 0 ? Math.pow(1 + infl / 100, 1 / 12) : 1
  const bonusOn = rules.find(r => r.id === 'bonus')?.on && bonusMonth != null
  const bonusIdx = bonusMonth ? Number(bonusMonth.slice(5, 7)) - 1 : -1
  const thisMonthIdx = Number(monthKey(today).slice(5, 7)) - 1
  const budgetsOn = rules.find(r => r.id === 'budgets')?.on ?? false

  const ownAt = (m: number) => {
    let n = 0
    for (const o of state.own) {
      if (!o.on) continue
      const start = monthsFrom(monthKey(today), o.month)
      const hit = o.when === 'every' ? m >= start
        : o.when === 'once' ? m === start
        : m >= start && (m - start) % 12 === 0
      if (hit) n += (o.kind === 'income' ? 1 : -1) * o.amount
    }
    return n
  }

  const surplusAt = (m: number) => {
    const bonus = bonusOn && ((thisMonthIdx + m) % 12) === bonusIdx ? val('bonus') : 0
    return income - spend * Math.pow(growth, m) + bonus + ownAt(m)
  }
  const outflowAt = (m: number) => {
    if (!budgetsOn) return 0
    // Month 0 is deliberately nothing. An instalment dated later *this* month
    // is already an unpaid entry in the ledger, which is what `committed` is,
    // and which the spare cash the plan starts from has already had taken off
    // it. Taking it a second time here would charge it twice. `dated[0]` is
    // still filled in, because a screen drawing the year should show it.
    if (m === 0) return 0
    return Math.max(0, -(dated[m] ?? 0))
  }
  const inflowAt  = (m: number) => (budgetsOn ? Math.max(0, dated[m] ?? 0) : 0)

  // The capacity the plan runs on. Only the pieces a rule can switch are
  // changed; the rest is the ledger's own reading.
  const bufferMonths = rules.find(r => r.id === 'buffer')?.on ? (val('buffer') || 0) : 0
  const held = capacity.held + (rules.find(r => r.id === 'cash')?.on ? 0 : capacity.assets)
  const buffer = bufferMonths * spend
  const committed = val('committed')
  const free = Math.max(0, held - buffer - capacity.earmarked - committed)

  return {
    rules,
    surplusAt: (m: number) => surplusAt(m) + inflowAt(m),
    outflowAt,
    dated,
    flatSurplus,
    datedYearly,
    capacity: {
      ...capacity,
      held, buffer, committed, free,
      monthlyIn: income,
      monthlyOut: spend,
      surplus: income - spend,
    },
  }
}
