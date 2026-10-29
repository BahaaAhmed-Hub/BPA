import type { Account, Category, Transaction } from './types'
import type { Capacity } from './goalPlan'
import { WINDOW_MONTHS, typicalMonth, DEBT_PREFIX } from './goalPlan'
import { occurrencesFor } from './budgetEntries'
import { liveBalances } from './balances'
import { isLoan, SETTLED_BELOW, dueThisMonth } from './loans'
import { planFromRule } from './loanPlan'
import { scheduleOf, type BudgetRule } from './modals/BudgetRuleModal'
import { toBase, baseCurrency } from './fx'
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
  | 'income' | 'spend' | 'bonus' | 'lumpy' | 'budgets' | 'loans' | 'committed' | 'buffer' | 'cash' | 'inflation'

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
  /** What the lumpy-cost rule puts back on its own dates over the next twelve
   *  months. Separate from `datedYearly`, which is budgets you wrote — these
   *  are costs read out of the ledger — but both leave on a date rather than
   *  being spread, so a screen reporting one has to report the other. */
  lumpyYearly: number
  /** Every month's dated total, so a screen can draw them. */
  dated: number[]
  /** What each loan's payment plan asks in month `m`, by the goal that repays it
   *  (`debt:<loan id>`), in the base currency. The goal planner takes these
   *  first. Month 0 is nothing — see `outflowAt`. */
  fixed: Map<string, (m: number) => number>
  /** All of them added: the cash leaving into lenders in month `m`. Kept apart
   *  from `outflowAt`, which the goal planner subtracts from the pot — the
   *  planner takes the instalments as the goals' own funding, and counting
   *  them in both would charge each twice. The cash projection adds this. */
  loansAt: (m: number) => number
  /** What the plans ask over the next twelve months. */
  loansYearly: number
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

  // One reading of a normal month, shared with `capacityFrom`. Two medians of
  // the same ledger disagreeing is two answers to one question, and the screen
  // showing the working then explains a figure nothing else uses.
  const norm = typicalMonth(input.transactions, base, today)
  const inc = norm.inBy
  const incs = norm.live.map(k => norm.inBy.get(k) ?? 0)
  const outs = norm.live.map(k => norm.outBy.get(k) ?? 0)
  const meanIn = incs.length ? incs.reduce((a, b) => a + b, 0) / incs.length : 0

  // A category charged on its own dates below must come out of the monthly
  // figure, or the same money is spent twice: once smeared across the year and
  // once on the day it actually leaves. This is what the old `already` set was
  // reaching for — it counted the collisions and then wrote a sentence about
  // them without ever subtracting one.
  const datedCats = new Set<string>()
  for (const [categoryId, rule] of Object.entries(input.budgets)) {
    if (rule && scheduleOf(rule) !== 'repeat') datedCats.add(categoryId)
  }
  let pulledIn = 0
  let pulledOut = 0
  const pulled: string[] = []
  for (const r of norm.regular) {
    if (!datedCats.has(r.categoryId)) continue
    if (r.kind === 'income') pulledIn += r.monthly
    else pulledOut += r.monthly
    pulled.push(input.categories.find(c => c.id === r.categoryId)?.name ?? 'a category')
  }
  const medIn = Math.max(0, norm.monthlyIn - pulledIn)
  const medOut = Math.max(0, norm.monthlyOut - pulledOut)

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
    for (const { date, amount, currency } of occurrencesFor(rule, now, months)) {
      const m = monthsFrom(monthKey(today), monthKey(date))
      if (m < 0 || m > months) continue
      const v = toBase(amount, currency ?? base, base)
      if (v === null) continue
      dated[m] += sign * v
      if (m < 12) datedYearly += v
    }
  }

  // ── loan payment plans ────────────────────────────────────────────────────
  // A plan is the loan's budget rule (loanPlan.ts) and its instalments are
  // transfers into a debt, which the normal month never sees — so a repeating
  // rule that the dated loop above skips as "already in the median" is, for a
  // loan, in nothing at all. They are charged here, on their own dates, and no
  // more than is owed: 3,000 left on a plan of 2,000 is 2,000 and then 1,000.
  const owedBy = liveBalances(input.accounts, input.transactions).balances
  const loanMonths = new Map<string, number[]>()      // loan id → base amount in each month
  let loansYearly = 0
  for (const a of input.accounts) {
    if (!isLoan(a)) continue
    const rule = input.budgets[a.id]
    if (!rule || planFromRule(rule) === null) continue
    // What is left to schedule: the balance, less what is already filed to go in
    // this month — month 0 is not in the schedule (it is committed), and the
    // goal asks for the balance less the same figure (`debtGoals`).
    let left = Math.max(0, -(owedBy.get(a.id) ?? a.balance) - dueThisMonth(a, input.transactions, today))
    if (!(left > SETTLED_BELOW)) continue
    const cur = rule.currency ?? a.currency
    const at = new Array<number>(months + 1).fill(0)
    for (const { date, amount } of occurrencesFor(rule, now, months)) {
      const m = monthsFrom(monthKey(today), monthKey(date))
      if (m < 1 || m > months) continue
      const take = Math.min(amount, left)
      if (!(take > SETTLED_BELOW)) break
      left -= take
      const v = toBase(take, cur, base)
      if (v === null) continue
      at[m] += v
      if (m >= 1 && m <= 12) loansYearly += v
    }
    loanMonths.set(a.id, at)
  }

  // ── costs that are real, but not monthly ──────────────────────────────────
  // School fees, an annual premium, a service every spring. They are out of
  // the normal month by construction now — a category that happens in three
  // months of six has no honest monthly figure — so if nothing charged them
  // they would simply have stopped existing, and the plan would be richer than
  // the ledger. Each is put back on the month of the year it actually landed
  // on, at the amount it actually was.
  const lumpCats = norm.lumpy.filter(l => !datedCats.has(l.categoryId))
  const lump = new Array<number>(months + 1).fill(0)
  const thisYear = Number(monthKey(today).slice(0, 4))
  for (const l of lumpCats) {
    const sign = l.kind === 'income' ? 1 : -1
    for (const at of l.at) {
      const mo = at.month.slice(5, 7)
      for (let y = 0; y <= Math.ceil(months / 12) + 1; y++) {
        const m = monthsFrom(monthKey(today), `${thisYear + y}-${mo}`)
        if (m < 1 || m > months) continue
        lump[m] += sign * at.amount
      }
    }
  }
  const lumpYearly = lump.slice(1, 13).reduce((a, b) => a + Math.abs(b), 0)
  const lumpNames = lumpCats.map(l => input.categories.find(c => c.id === l.categoryId)?.name ?? 'unfiled')

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
      id: 'lumpy', source: 'ledger', unit: `${base} a year, on the months it landed on`,
      on: !isOff('lumpy') && lumpCats.length > 0,
      value: mine('lumpy') ?? (lumpYearly > 0 ? lumpYearly : null),
      yours: mine('lumpy') != null,
      dormant: lumpCats.length > 0 ? undefined : 'every category you spend on turns up in most months, so there is nothing lumpy to separate',
      title: 'A cost that does not happen most months is not part of a normal month',
      when: 'Fires for every category that turned up in half the months read or fewer.',
      why: [
        lumpCats.length > 0
          ? `${lumpCats.length} of them: ${lumpNames.slice(0, 4).join(', ')}${lumpNames.length > 4 ? `, and ${lumpNames.length - 4} more` : ''}.`
          : 'Nothing in the window behaves this way.',
        `Left in the monthly figure they would land as roughly ${money(lumpYearly / 12, base)} a month — a figure that leaves the account on no day of the year, and that moves every time the six-month window slides by one.`,
        `Charged instead on the months they were actually paid, repeated each year: ${money(lumpYearly, base)} across the next twelve months.`,
        `Read from ${norm.live.length} month${norm.live.length === 1 ? '' : 's'}, so only those months of the year carry one. Giving the cost a budget with dates is how the rest of the year gets charged.`,
      ],
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
        pulled.length > 0
          ? `${pulled.join(', ')} also turned up in most of the months a normal month was read from, so ${money(pulledIn + pulledOut, base)} a month is taken back out of it — charged here, on the dates, and nowhere else.`
          : 'None of these is in the normal month as well, so nothing is counted twice.',
      ],
    },
    {
      id: 'loans', source: 'budget', unit: `${base} a year, paid first`, on: !isOff('loans'),
      value: mine('loans') ?? (loansYearly > 0 ? loansYearly : null),
      yours: mine('loans') != null,
      dormant: loansYearly > 0 ? undefined : 'no loan has a payment plan with something still owed',
      title: "A loan's payment plan is paid first, on its dates",
      when: 'Fires for every loan with a payment plan and a debt still to clear.',
      why: [
        `${money(loansYearly, base)} falls due in the next twelve months, across ${loanMonths.size} loan${loanMonths.size === 1 ? '' : 's'}.`,
        'Each instalment is taken off the month before any goal is funded, whichever way the goals are divided — a plan is a promise, not a wish to be ranked.',
        'A loan with a plan is not also funded from the monthly surplus, so the same debt is never paid twice. Spare cash today can still finish it early.',
        'Switched off, the plans are ignored and the loan is funded like any other debt.',
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
      // The number of months is a setting somebody chose, so say that number.
      // It used to be re-derived as buffer ÷ this file's own median, which is
      // not the median the buffer was built from once a rule corrects the
      // spending — and one month came back as 0.9649122807017544.
      value: mine('buffer') ?? capacity.detail.bufferMonths,
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
  const lumpyOn = rules.find(r => r.id === 'lumpy')?.on ?? false
  // A figure typed over ours is a year's worth, so it is scaled onto the same
  // months rather than replacing the shape of them.
  const lumpScale = mine('lumpy') != null && lumpYearly > 0 ? mine('lumpy')! / lumpYearly : 1
  const lumpAt = (m: number) => (lumpyOn ? (lump[m] ?? 0) * lumpScale : 0)

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

  // A figure typed over ours is a year's worth, scaled onto the same months.
  const loansOn = rules.find(r => r.id === 'loans')?.on ?? false
  const loanScale = mine('loans') != null && loansYearly > 0 ? mine('loans')! / loansYearly : 1
  const loanAt = (id: string, m: number) => (loansOn && m >= 1 ? (loanMonths.get(id)?.[m] ?? 0) * loanScale : 0)
  const fixed = new Map<string, (m: number) => number>()
  if (loansOn) for (const id of loanMonths.keys()) fixed.set(`${DEBT_PREFIX}${id}`, (m: number) => loanAt(id, m))
  const loansAt = (m: number) => { let n = 0; for (const id of loanMonths.keys()) n += loanAt(id, m); return n }

  const surplusAt = (m: number) => {
    const bonus = bonusOn && ((thisMonthIdx + m) % 12) === bonusIdx ? val('bonus') : 0
    return income - spend * Math.pow(growth, m) + bonus + ownAt(m)
  }
  const outflowAt = (m: number) => {
    // Month 0 is deliberately nothing. An instalment dated later *this* month
    // is already an unpaid entry in the ledger, which is what `committed` is,
    // and which the spare cash the plan starts from has already had taken off
    // it. Taking it a second time here would charge it twice. `dated[0]` is
    // still filled in, because a screen drawing the year should show it.
    if (m === 0) return 0
    return Math.max(0, -(budgetsOn ? dated[m] ?? 0 : 0)) + Math.max(0, -lumpAt(m))
  }
  const inflowAt  = (m: number) =>
    (budgetsOn ? Math.max(0, dated[m] ?? 0) : 0) + (m === 0 ? 0 : Math.max(0, lumpAt(m)))

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
    fixed,
    loansAt,
    loansYearly: loansOn ? loansYearly * loanScale : 0,
    flatSurplus,
    datedYearly,
    lumpyYearly: lumpyOn ? lumpYearly * lumpScale : 0,
    capacity: {
      ...capacity,
      held, buffer, committed, free,
      monthlyIn: income,
      monthlyOut: spend,
      surplus: income - spend,
      // The rules can move the cushion and can fold the assets into what is
      // held, so the breakdown has to be told — otherwise a tooltip explains a
      // figure with the terms of the one before it.
      detail: {
        ...capacity.detail,
        bufferMonths,
        assetsCounted: !(rules.find(r => r.id === 'cash')?.on ?? true),
      },
    },
  }
}
