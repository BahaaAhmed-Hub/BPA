// ─── A budget keeps the amount it had ────────────────────────────────────────
//
// A rule held one `amount`, so raising rent from 10,000 to 13,000 rewrote July
// as well: spending of 12,000 that was over its budget at the time read as
// comfortably inside it. A budget is a decision made on a date, and the months
// before that date were lived under the old one.
//
// `rule.amount` stays the base — what every month before the first change
// had — and `steps` records each change with the month it took effect. Nothing
// is stored for a rule that has never changed, so every rule written before
// this reads exactly as it did.
//
// Pure, with no React, so it can be run directly: scripts/budget-steps.mjs.

export interface AmountStep {
  /** The first month the amount applies to, 'YYYY-MM'. */
  from: string
  amount: number
}

/** The two fields this reads. A budget rule has far more, none of them here. */
export interface Stepped {
  amount: number
  steps?: AmountStep[]
}

export const monthKeyOf = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * What the budget was in a month. The last change at or before it, or the base
 * where there has been none. With no month it is **now** — "what is my budget"
 * has to mean something for the callers that never had a month in hand.
 */
export function amountFor(rule: Stepped, monthKey: string = monthKeyOf()): number {
  let amount = rule.amount
  for (const s of rule.steps ?? []) {
    if (s.from <= monthKey) amount = s.amount
    else break
  }
  return amount
}

/**
 * The month an edit takes effect from: this month, or the month on screen if
 * that is later. Never earlier — looking back at July and typing a number must
 * not rewrite July. This is also the month the amount field has to *show*, or
 * an edit made while looking at a past month is a field that refuses to change.
 */
export const editMonth = (onScreen: string, today: Date = new Date()): string => {
  const now = monthKeyOf(today)
  return onScreen > now ? onScreen : now
}

/**
 * Record a new amount. It applies from `editMonth` onward and every earlier
 * month keeps what it had.
 *
 * - A budget that never had an amount has no past to protect, so it is simply
 *   set — a first budget still reads as running every month, as it always did.
 * - A change made in the same month as the last one **replaces** it. The field
 *   saves on every keystroke, so 1, 13, 130, 1,300, 13,000 must end as one
 *   change and not five, and a typo corrected within the month leaves no trace.
 * - Changes planned for later months are dropped: "from now on" is every month
 *   after this one too.
 * - A change that lands on what the month already had is not recorded.
 */
export function withAmount<T extends Stepped>(
  rule: T, amount: number, onScreen: string, today: Date = new Date(),
): T {
  const steps = (rule.steps ?? []).filter(s => s && /^\d{4}-\d{2}$/.test(s.from))
  if (!(rule.amount > 0) && steps.length === 0) {
    return { ...rule, amount, steps: undefined }
  }
  const from = editMonth(onScreen, today)
  const before = steps.filter(s => s.from < from)
  const had = amountFor({ amount: rule.amount, steps: before }, from)
  const next = amount === had ? before : [...before, { from, amount }]
  return { ...rule, steps: next.length ? next : undefined }
}
