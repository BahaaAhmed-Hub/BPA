import type { Category, Transaction } from './types'
import { activeIn, type BudgetRule } from './modals/BudgetRuleModal'
import { baseCurrency } from './fx'
import { isoDate, shiftDaysISO } from './dates'

// ─── A budget with a day on it writes the entry, not a task ──────────────────
//
// A rent of 20,000 on the 5th is not a reminder to think about rent. It is
// 20,000 that will leave on the 5th — so it belongs in the ledger on that day,
// marked unpaid, where every screen already knows what to do with it: out of
// the balances and the totals until it is paid, dotted red in the feeds, and
// counted by the Financials "when it is due" view, which is exactly the view
// for money that is owed.
//
// The entry carries the `budget` tag, which is the whole flag: this was not
// typed, a budget made it. Ticking Paid on it is the ordinary gesture, and it
// stops being a plan and becomes a fact.

export const BUDGET_TAG = 'budget'

/** How far ahead to write them. Three months of standing bills is enough to
 *  plan against and few enough to scroll past. */
export const MONTHS_AHEAD = 3

export function isBudgetEntry(tx: Pick<Transaction, 'tags'>): boolean {
  return !!tx.tags?.includes(BUDGET_TAG)
}

/** The 31st of a 30-day month is the 30th, not the 1st of the next one. */
function onDay(year: number, monthIndex: number, day: number): string {
  const last = new Date(year, monthIndex + 1, 0).getDate()
  const d = Math.min(Math.max(1, day), last)
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const monthsPer: Record<string, number> = {
  monthly: 1, every_2_months: 2, quarterly: 3, yearly: 12,
}

/**
 *  Every date this rule owes an entry for, from today out to the horizon.
 *
 *  The interval is the rule's own: a quarterly budget lands four times a year,
 *  not twelve, and it keeps the phase its start month set — a quarterly rule
 *  starting in February is February, May, August, November, not January's
 *  quarters. Weekly is the odd one out: a day of the month means nothing to
 *  it, so it steps seven days at a time from the first one on or after today.
 */
export function occurrencesFor(
  rule: BudgetRule,
  now = new Date(),
  monthsAhead = MONTHS_AHEAD,
): string[] {
  if (rule.dueDay == null) return []
  const today = isoDate(now)
  const out: string[] = []

  if (rule.frequency === 'weekly') {
    let d = onDay(now.getFullYear(), now.getMonth(), rule.dueDay)
    while (d < today) d = shiftDaysISO(d, 7)
    const end = onDay(now.getFullYear(), now.getMonth() + monthsAhead, rule.dueDay)
    while (d <= end) { out.push(d); d = shiftDaysISO(d, 7) }
    return out
  }

  const step = monthsPer[rule.frequency] ?? 1
  // Which months the rule falls in, counted from its own start.
  const [sy, sm] = (rule.starts || today.slice(0, 7)).split('-').map(Number)
  const startIndex = sy * 12 + (sm - 1)
  for (let n = 0; n <= monthsAhead; n++) {
    const d = new Date(now.getFullYear(), now.getMonth() + n, 1)
    const index = d.getFullYear() * 12 + d.getMonth()
    if (index < startIndex) continue
    if ((index - startIndex) % step !== 0) continue
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!activeIn(rule, monthKey)) continue
    const date = onDay(d.getFullYear(), d.getMonth(), rule.dueDay)
    if (date < today) continue
    out.push(date)
  }
  return out
}

export interface EntryApi {
  add: (txs: Transaction[]) => void
  remove: (id: string) => void
}

/**
 *  Bring the ledger in line with the budgets that carry a day.
 *
 *  What stops a second copy is the ledger itself: an entry already filed
 *  against that category on that day is the entry, whoever wrote it. That is
 *  deliberate — record the rent by hand on the 5th and the budget does not add
 *  a second one beside it — and it needs no flag to survive a migration nobody
 *  has run.
 *
 *  Only dates inside the loaded year are written, because only that year is in
 *  hand to check against; the rest are written when the year turns.
 *
 *  A day taken off a budget, or a budget deleted, takes its unpaid future
 *  entries with it. Anything paid is a record of money that moved and stays.
 */
export function runBudgetEntries(
  categories: Category[],
  rules: Record<string, BudgetRule>,
  transactions: Transaction[],
  /** Used where a rule names no account of its own. */
  fallbackAccountId: string | undefined,
  year: number,
  api: EntryApi,
  now = new Date(),
): { made: number; dropped: number } {
  const today = isoDate(now)
  const base = baseCurrency()
  const wanted = new Set<string>()   // `${categoryId}|${date}`
  const fresh: Transaction[] = []
  const stamp = new Date().toISOString()

  const filed = new Set(
    transactions.filter(t => t.categoryId).map(t => `${t.categoryId}|${t.date}`))

  for (const [categoryId, rule] of Object.entries(rules)) {
    if (!rule || rule.dueDay == null || !(rule.amount > 0)) continue
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) continue
    // The money has to come from somewhere. A rule that names no account and
    // has nothing to fall back on writes nothing, rather than guessing.
    const accountId = rule.dueAccountId ?? fallbackAccountId
    if (!accountId) continue
    for (const date of occurrencesFor(rule, now)) {
      if (!date.startsWith(String(year))) continue
      const key = `${categoryId}|${date}`
      wanted.add(key)
      if (filed.has(key)) continue
      filed.add(key)
      fresh.push({
        id: crypto.randomUUID(),
        accountId,
        amount: rule.amount,
        currency: (rule.currency ?? base) as Transaction['currency'],
        type: cat.txType === 'income' ? 'income' : 'expense',
        payee: cat.name,
        categoryId,
        date,
        // No payment date is the point: it is owed, not spent.
        paidAt: undefined,
        isCleared: false,
        isRecurring: true,
        tags: [BUDGET_TAG],
        createdAt: stamp,
      })
    }
  }

  // What this made before and would not make now. Only its own — an entry
  // typed by hand is nobody's to remove — and only while it is still unpaid
  // and still ahead.
  let dropped = 0
  for (const tx of transactions) {
    if (!isBudgetEntry(tx) || !tx.categoryId) continue
    if (tx.paidAt) continue
    if (tx.date < today) continue
    if (wanted.has(`${tx.categoryId}|${tx.date}`)) continue
    api.remove(tx.id)
    dropped++
  }

  if (fresh.length > 0) api.add(fresh)
  return { made: fresh.length, dropped }
}
