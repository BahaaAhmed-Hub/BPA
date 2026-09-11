import type { Category, Transaction } from './types'
import type { Capacity, GoalPlan, Policy, ScheduleOptions } from './goalPlan'
import { typicalMonth, isDebtGoal, scheduleGoals, byRank, commitOf, monthsUntil } from './goalPlan'
import { bucketOf, type Bucket, type BudgetRule } from './modals/BudgetRuleModal'
import { todayISO } from './dates'

// ─── "Never" is not an answer ────────────────────────────────────────────────
//
//  The plan could already say a goal lands in March 2031, or that nothing ever
//  reaches it. Both are true readings and neither is any use: a plan that tells
//  you the answer is no, and stops, has handed the whole problem back.
//
//  Every one of these moves is arithmetic on figures already on the screen —
//  what a goal still needs, what it is getting, what each category actually
//  costs a month. Nothing here is advice about your life; it is the same
//  subtraction done from the other end. Two rules:
//
//  1. **Name the category, or say nothing.** "Spend less" is not a move. "Dining
//     out is 4,200 a month; a third of it is 1,400, which is the gap" is one.
//     Every cut comes out of `typicalMonth`, so it is a figure the ledger can be
//     held to.
//  2. **Never propose what cannot be measured.** There is no "get a raise" that
//     is not just the gap restated, so the earn move says the gap as a share of
//     what you actually earn and leaves the how to you.

export type MoveKind = 'commit' | 'cut' | 'earn' | 'lump' | 'wait' | 'rank' | 'target' | 'cushion'

export interface Move {
  kind: MoveKind
  /** The move, as a short line. */
  title: string
  /** The working. */
  detail: string
  /** What it is worth a month, where that is the unit. */
  monthly?: number
  /** What it is worth once, where that is. */
  once?: number
}

export interface CutOption {
  categoryId: string
  name: string
  /** What it costs a month now. */
  monthly: number
  /** What this category gives to the combination below — the whole of it
   *  until the gap is covered, then part of one, then nothing. */
  take: number
  /** `take` as a share of `monthly`, 0..1. Over 1 where the category is too
   *  small to close the gap on its own. */
  share: number
  bucket: Bucket | null
}

export type Reason = 'fine' | 'queued' | 'late' | 'never'

export interface Advice {
  goalId: string
  reason: Reason
  /** Still to find after what today's cash puts in. */
  need: number
  /** Months until the deadline, null where there is none. */
  by: number | null
  /** What the plan puts in each month once this one starts being funded. */
  have: number
  /** What it has to be, a month, to make the deadline — or to land at all. */
  want: number
  /** `want − have`. The number every move below is measured against. */
  gap: number
  /** One sum today that would finish it instead of the months. */
  lumpGap: number
  moves: Move[]
  cuts: CutOption[]
  currency: string
}

/** Where a cut is least painful first. A budget you filed as guilt-free is what
 *  the bucket is *for*; one you filed as fixed is rent, and suggesting it be
 *  cut is not a suggestion. Savings and investments sit in between, because
 *  moving money from one of those into a goal is not a cut at all — it is the
 *  same money, differently aimed. */
const ORDER: Record<string, number> = { guiltfree: 0, unfiled: 1, savings: 2, investment: 3, fixed: 4 }

const HORIZON = 120

export interface AdviceInput {
  plan: GoalPlan
  plans: GoalPlan[]
  capacity: Capacity
  transactions: Transaction[]
  categories: Category[]
  budgets: Record<string, BudgetRule>
  policy: Policy | ScheduleOptions
  today?: string
}

/** What it would take — for one goal, in figures from this ledger. */
export function adviseGoal(input: AdviceInput): Advice {
  const { plan, plans, capacity, transactions, categories, budgets } = input
  const today = input.today ?? todayISO()
  const base = capacity.currency
  const g = plan.goal

  const need = Math.max(0, plan.remaining - plan.lump)
  // The same count the verdict above it uses, or the two sentences disagree
  // about the same goal on the same screen.
  const by = g.deadline ? monthsUntil(g.deadline, today) : null
  const have = plan.monthly
  // With a date it is the date that sets the bar. Without one, the bar is
  // simply landing at all inside the horizon the plan runs to.
  const want = by ? need / by : need / HORIZON
  const gap = Math.max(0, want - have)

  const reason: Reason =
    plan.eta === null ? 'never'
    : plan.onTime === false ? 'late'
    : have <= 0 && plan.startsIn !== null && plan.startsIn > 0 ? 'queued'
    : 'fine'

  // ── what a month actually costs, category by category ─────────────────────
  const norm = typicalMonth(transactions, base, today)
  const nameOf = (id: string) => categories.find(c => c.id === id)?.name ?? 'Unfiled'
  const cuts: CutOption[] = norm.regular
    .filter(r => r.kind === 'expense' && r.monthly > 0)
    .map(r => {
      const rule = budgets[r.categoryId]
      return {
        categoryId: r.categoryId,
        name: nameOf(r.categoryId),
        monthly: r.monthly,
        take: 0,
        share: gap / r.monthly,
        bucket: rule ? bucketOf(rule) : null,
      }
    })
    .sort((a, b) => {
      const ba = ORDER[a.bucket ?? 'unfiled'] ?? 1
      const bb = ORDER[b.bucket ?? 'unfiled'] ?? 1
      if (ba !== bb) return ba - bb
      // Within a bucket, the one that closes the gap with the smallest bite.
      return a.share - b.share
    })
  // `take` is what each one gives to *this* combination, not what it could
  // give on its own. A column of "not enough" against every row is true of
  // each and useless about all of them: the question is where the gap comes
  // from, and the answer is a set, filled least-painful first.
  let left = gap
  for (const c of cuts) {
    c.take = Math.min(c.monthly, Math.max(0, left))
    left -= c.take
  }

  const moves: Move[] = []
  // The zero-cost move goes first when there is one. A screen that opens with
  // "cut your groceries" about a date you could simply move is arguing.
  if (reason === 'late' && plan.eta) {
    moves.push({
      kind: 'wait',
      title: `Give it until ${monthName(plan.eta)}`,
      detail: `Nothing else changes: at ${round(have)} a month it lands then. It is worth saying before any of the others, because it is the only one that costs nothing.`,
    })
  }

  // In the mode where you set the figure, the figure is the first answer. The
  // others are about finding money; this one is about a number you typed.
  const pol = typeof input.policy === 'string' ? input.policy : input.policy.policy
  if (gap > 0 && pol === 'commit') {
    const has = commitOf(g, base)
    // `want` is the whole figure, not `has + gap`: `gap` is measured against
    // what the goal is actually *getting*, which is not what you committed
    // when the month has not got it to give.
    const asks = by ? 'what the date asks for' : 'what it takes to land inside ten years'
    moves.push({
      kind: 'commit',
      title: has > 0 ? `Put in ${round(want)} a month instead of ${round(has)}` : `Commit ${round(want)} a month to it`,
      monthly: gap,
      detail: has > 0
        ? `You set this one at ${round(has)}, and it is getting ${round(have)}. ${round(want)} is ${asks}.${
            have < has ? ' Raising it is not enough on its own while the month does not bring that much — the moves below are where it would come from.' : ''}`
        : `Nothing is committed to this yet, so it is only getting what the committed goals leave behind. ${round(want)} a month is ${asks}.`,
    })
  }

  const cuttable = cuts.reduce((n, c) => n + c.monthly, 0)
  if (gap > 0) {
    const taken = cuts.filter(c => c.take > 0)
    moves.push({
      kind: 'cut',
      title: gap > cuttable ? `Cutting alone cannot reach it` : `Free up ${round(gap)} a month`,
      monthly: Math.min(gap, cuttable),
      detail: cuts.length === 0
        ? 'Nothing in the last six months is regular enough to cut against. Give the spending categories budgets and this can name them.'
        : gap > cuttable
          // Saying "cut something" about a gap larger than everything you spend
          // is not a plan, it is a shrug. The figure is the answer.
          ? `Everything you spend regularly comes to ${round(cuttable)} a month, and the gap is ${round(gap)}. Stopping all of it would still not be enough, so this one is about the date, the target, or what comes in.`
        : taken.length === 1
          // One sentence, describing the same set the rows below show. Two
          // descriptions of one combination — "a third of Rent" over a list
          // that starts with Dining out — is how a screen loses its reader.
          ? `${taken[0].name} costs ${round(taken[0].monthly)} a month, and ${pct(taken[0].take / taken[0].monthly)} of it is the gap.`
          : `It comes out of ${combine(cuts)}.`,
    })

    if (capacity.monthlyIn > 0) {
      const more = gap / capacity.monthlyIn
      moves.push({
        kind: 'earn',
        title: `${moves.length > 1 ? 'Or bring' : 'Bring'} in ${round(gap)} a month more`,
        monthly: gap,
        detail: `You bring in ${round(capacity.monthlyIn)} a month, so this is ${raw(more)} more.${
          more > 1 ? ' More than doubling it is a different kind of decision from trimming a category, which is why it is said plainly rather than buried in a percentage.' : ' It does the same work as the cut above, and it is the only one of the two that does not come out of something else.'}`,
      })
    }
  }

  // ── a sum today instead of the months ─────────────────────────────────────
  const lumpGap = by ? Math.max(0, need - have * by) : need
  if (lumpGap > 0 && gap > 0) {
    moves.push({
      kind: 'lump',
      title: `Or find ${round(lumpGap)} once`,
      once: lumpGap,
      detail: by
        ? `The months bring ${round(have * by)} of the ${round(need)} by ${monthName(g.deadline!.slice(0, 7))}. One payment covers the rest and nothing else has to change.`
        : `Put this in and it is done, with no month of the plan touched.`,
    })
  }

  // ── the cushion ───────────────────────────────────────────────────────────
  if (gap > 0 && capacity.buffer > 0 && capacity.monthlyOut > 0) {
    const oneMonth = Math.min(capacity.buffer, capacity.monthlyOut)
    moves.push({
      kind: 'cushion',
      title: `Or hold one month less back`,
      once: oneMonth,
      detail: `The cushion keeps ${round(capacity.buffer)} out of the plan. One month of it is ${round(oneMonth)}, available today — once, not every month, and it is the money that covers a bad month.`,
    })
  }

  // ── the queue ─────────────────────────────────────────────────────────────
  const ahead = aheadOf(plans, g.id).filter(p => !isDone(p))
  if (pol !== 'commit' && (reason === 'queued' || reason === 'late' || reason === 'never') && ahead.length > 0) {
    const taking = ahead.reduce((n, p) => n + p.monthly, 0)
    const first = ahead[0]
    moves.push({
      kind: 'rank',
      title: `Or move it above ${first.goal.name}`,
      monthly: taking,
      detail: ahead.length === 1
        ? `${first.goal.name} is taking ${round(first.monthly)} a month and finishes first. Drag this one above it and that money comes here instead.`
        : `${ahead.length} goals are ahead of it, taking ${round(taking)} a month between them. Drag this one up and it is paid out of that.`,
    })
  }

  // ── the date, and the target ──────────────────────────────────────────────
  if (by && have > 0 && !isDebtGoal(g)) {
    const reach = plan.lump + have * by
    if (reach > 0 && reach < plan.remaining) {
      moves.push({
        kind: 'target',
        title: `Or aim at ${round(reach)} instead`,
        once: reach,
        detail: `That is what this goal actually reaches by ${monthName(g.deadline!.slice(0, 7))} with nothing else moved. A target you will hit beats one you will not.`,
      })
    }
  }

  return { goalId: g.id, reason, need, by, have, want, gap, lumpGap, moves, cuts, currency: base }
}

/** What the whole ranking would look like if the gap were closed — so a screen
 *  can say "and these four land sooner too" rather than only naming one. */
export function ifFound(
  monthly: number,
  goals: GoalPlan[],
  capacity: Capacity,
  policy: Policy | ScheduleOptions,
  today = todayISO(),
): Map<string, string> {
  const opts: ScheduleOptions = typeof policy === 'string' ? { policy } : { ...policy }
  const lifted: Capacity = { ...capacity, monthlyOut: Math.max(0, capacity.monthlyOut - monthly), surplus: capacity.surplus + monthly }
  const base = opts.surplusAt
  if (base) opts.surplusAt = (m: number) => base(m) + monthly
  const s = scheduleGoals(goals.map(p => p.goal), lifted, opts, today)
  return s.landsIn
}

// ─── small helpers ───────────────────────────────────────────────────────────

const isDone = (p: GoalPlan) => p.remaining - p.lump <= 0

function aheadOf(plans: GoalPlan[], id: string): GoalPlan[] {
  const ordered = byRank(plans.map(p => p.goal))
  const i = ordered.findIndex(g => g.id === id)
  if (i <= 0) return []
  const ids = new Set(ordered.slice(0, i).map(g => g.id))
  return plans.filter(p => ids.has(p.goal.id))
}

const round = (n: number) => Math.round(n).toLocaleString('en-US')
/** 'YYYY-MM' the way every other figure on the screen says it. */
const monthName = (key: string) =>
  new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
const pct = (x: number) => `${Math.round(Math.min(1, Math.max(0, x)) * 100)}%`
/** Unclamped. A gap can honestly be larger than the whole of what it is a
 *  share of, and clamping at 100% reports "you would have to earn twice as
 *  much again" as if it were "you would have to earn all of it again". */
const raw = (x: number) => `${Math.round(x * 100)}%`

/** The actual combination, in the order a cut is least painful: whole
 *  categories until one is only partly needed. "Cut several" is not a move. */
function combine(cuts: CutOption[]): string {
  return cuts
    .filter(c => c.take > 0)
    .map(c => (c.take >= c.monthly ? `${c.name} in full (${round(c.monthly)})` : `${round(c.take)} of ${c.name}`))
    .join(', ')
}
