// ─── A budget keeps what it was ──────────────────────────────────────────────
//
// A rule held one of everything, so raising rent from 10,000 to 13,000 rewrote
// July as well: spending of 12,000 that was over its budget at the time read as
// comfortably inside it. A budget is a decision made on a date, and the months
// before that date were lived under the old one. The same is true of the other
// things a budget says — what it is counted in, how often it comes round, which
// of the four it belongs to, and the dates and amounts of a school fee that
// comes round every year.
//
// The rule's own fields are the base — what every month before the first change
// had — and `steps` records each change with the month it took effect, carrying
// only the fields that changed. Nothing is stored for a rule that has never
// changed, so every rule written before this reads exactly as it did.
//
// Pure, with no React, so it can be run directly: scripts/budget-steps.mjs.

/** The first month a change applies to, and the fields that are different from
 *  then on. A step written when only the amount could change is `{ from, amount }`
 *  and still reads the same. */
export interface RuleStep {
  from: string
  amount?: number
  currency?: string
  frequency?: string
  bucket?: string
  lines?: unknown[]
}

/** What this reads of a rule. A budget rule has far more, none of them here. */
export interface Stepped {
  amount: number
  steps?: RuleStep[]
  /** The month the rule first had anything in it. */
  born?: string
  lines?: unknown[]
}

/** The fields a change can carry. Due day and account are not here: they only
 *  decide the entries written from now on. */
export type Change = Partial<Omit<RuleStep, 'from'>>

export const monthKeyOf = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * The budget as it was in a month: the base with every change up to and
 * including that month laid over it. With no month it is **now** — "what is my
 * budget" has to mean something for the callers that never had a month in hand.
 */
export function ruleAt<T extends Stepped>(rule: T, monthKey?: string): T
export function ruleAt<T extends Stepped>(rule: T | undefined, monthKey?: string): T | undefined
export function ruleAt<T extends Stepped>(rule: T | undefined, monthKey: string = monthKeyOf()): T | undefined {
  if (!rule) return rule
  let out = rule
  for (const { from, ...change } of rule.steps ?? []) {
    if (from > monthKey) break
    out = { ...out, ...change } as T
  }
  return out
}

/** What the amount was in a month. */
export const amountFor = (rule: Stepped, monthKey?: string): number => ruleAt(rule, monthKey).amount

/**
 * The month an edit takes effect from: this month, or the month on screen if
 * that is later. Never earlier — looking back at July and typing a number must
 * not rewrite July. This is also the month the controls have to *show*, or an
 * edit made while looking at a past month is a field that refuses to change.
 */
export const editMonth = (onScreen: string, today: Date = new Date()): string => {
  const now = monthKeyOf(today)
  return onScreen > now ? onScreen : now
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Record a change. It applies from `editMonth` onward and every earlier month
 * keeps what it had.
 *
 * - **Nothing to protect yet.** A budget with nothing in it, or one that is
 *   still in the month it was made, is simply set: a first budget still reads
 *   as running every month, and a school fee built one instalment at a time
 *   leaves no ghost of the first one in the months before.
 * - A change made in the same month as the last one is **merged** into it. The
 *   fields save as they are typed — 1, 13, 130, 1,300, 13,000 must end as one
 *   change, a typo corrected within the month leaves no trace — and a currency
 *   changed this morning is not lost when the amount is changed this afternoon.
 * - A field that lands on what the month already had is not recorded.
 * - Changes **to the same fields** planned for later months are dropped: "from
 *   now on" covers them. Other fields' later changes stand.
 */
export function withChange<T extends Stepped>(
  rule: T, change: Change, onScreen: string, today: Date = new Date(),
): T {
  const steps = (rule.steps ?? []).filter(s => s && /^\d{4}-\d{2}$/.test(s.from))
  const from = editMonth(onScreen, today)
  const empty = !(rule.amount > 0) && !(rule.lines?.length)
  if (steps.length === 0 && (empty || rule.born === from)) {
    return { ...rule, ...change, steps: undefined, born: rule.born ?? from }
  }
  const touched = Object.keys(change)
  const before = steps.filter(s => s.from < from)
  const had = ruleAt({ ...rule, steps: before }, from) as unknown as Record<string, unknown>
  const here = steps.find(s => s.from === from)
  const merged: Record<string, unknown> = { ...here, ...change }
  delete merged.from
  const diff = Object.fromEntries(Object.entries(merged).filter(([k, v]) => !same(v, had[k])))
  const later = steps
    .filter(s => s.from > from)
    .map(s => Object.fromEntries(Object.entries(s).filter(([k]) => !touched.includes(k))) as unknown as RuleStep)
    .filter(s => Object.keys(s).length > 1)
  const next = [...before, ...(Object.keys(diff).length ? [{ from, ...diff } as RuleStep] : []), ...later]
  return { ...rule, steps: next.length ? next : undefined }
}

/** A new amount: the change most often made. */
export const withAmount = <T extends Stepped>(rule: T, amount: number, onScreen: string, today: Date = new Date()): T =>
  withChange(rule, { amount }, onScreen, today)
