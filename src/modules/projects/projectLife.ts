import type { Habit, HabitLogs, HabitQuantityLogs } from '@/store/habitsStore'
import { dayProgress } from '@/lib/habitProgress'
import { convert, sumInBase } from '@/modules/finance/fx'
import { isUnpaid } from '@/modules/finance/unpaid'
import type { Transaction } from '@/modules/finance/types'
import type { EntryMeta, ProjectLink } from './types'

// ─── Money, habits and books as a project sees them ──────────────────────────
// Pure functions, so the figures can be checked without a screen.

export const entryMeta = (t: Pick<Transaction, 'payee' | 'amount' | 'currency' | 'date' | 'paidAt' | 'type'>): EntryMeta => ({
  payee: t.payee, amount: t.amount, currency: t.currency, date: t.date, ...(t.paidAt ? { paidAt: t.paidAt } : {}), type: t.type,
})

export const sameEntryMeta = (a: unknown, b: EntryMeta): boolean => {
  const m = a as Partial<EntryMeta> | undefined
  return !!m && m.payee === b.payee && m.amount === b.amount && m.currency === b.currency
    && m.date === b.date && (m.paidAt ?? '') === (b.paidAt ?? '') && m.type === b.type
}

export interface MoneyTotals {
  /** Settled expenses, in the base currency. */
  spent: number
  /** Settled income, in the base currency. */
  received: number
  /** Expenses not paid yet: how many, and what they come to in base. */
  owed: { count: number; total: number }
  /** Currencies with no rate, which are left out of the figures above rather than guessed. */
  unconverted: string[]
}

/** What the project's linked entries come to. Money that has not moved is not
 *  spent — the ledger's own rule (`isUnpaid`) — so it is reported as owed and
 *  kept out of what has been spent. A transfer or an asset movement is neither
 *  spending nor income and is not counted. */
export function moneyTotals(entries: { meta: EntryMeta }[]): MoneyTotals {
  const metas = entries.map(e => e.meta)
  const settledOnly = (type: string) => metas.filter(m => m.type === type && !isUnpaid(m))
  const spent = sumInBase(settledOnly('expense'))
  const received = sumInBase(settledOnly('income'))
  const owed = sumInBase(metas.filter(m => m.type === 'expense' && isUnpaid(m)))
  return {
    spent: spent.total, received: received.total,
    owed: { count: metas.filter(m => m.type === 'expense' && isUnpaid(m)).length, total: owed.total },
    unconverted: [...new Set([...spent.unconverted, ...received.unconverted, ...owed.unconverted])],
  }
}

export type BudgetStatus =
  /** The budget is in a currency with no rate to the base: it cannot be compared, and is not guessed. */
  | { kind: 'unrated'; currency: string }
  | {
      kind: 'ok'
      /** The budget, in the base currency. */
      budget: number
      spent: number
      left: number
      over: boolean
      /** 0..1 of the budget spent, clamped; a zero budget with any spend is full. */
      fraction: number
      /** What would be left once the unpaid bills are paid. */
      afterOwed: number
      /** Some linked currency has no rate, so spent may be understated. */
      partial: boolean
    }

/** A budget set against what the project has spent. Spent is the ledger's own: settled expenses only, so
 *  money that has not moved is not counted — it is shown as `afterOwed`. A currency nobody has a rate for
 *  is never invented: the budget's own, `unrated`; a linked entry's, `partial`. */
export function budgetStatus(budget: { amount: number; currency: string }, totals: MoneyTotals, base: string): BudgetStatus {
  const inBase = convert(budget.amount, budget.currency, base)
  if (inBase === null) return { kind: 'unrated', currency: budget.currency.toUpperCase() }
  const left = inBase - totals.spent
  return {
    kind: 'ok', budget: inBase, spent: totals.spent, left, over: left < 0,
    fraction: inBase > 0 ? Math.min(totals.spent / inBase, 1) : totals.spent > 0 ? 1 : 0,
    afterOwed: left - totals.owed.total, partial: totals.unconverted.length > 0,
  }
}

export const entryLinks = (projectId: string, links: ProjectLink[]) =>
  links.filter(l => l.projectId === projectId && l.kind === 'entry')

/** The seven days ending today, oldest first, each as 0..1 of that day's habit. */
export function habitWeek(habit: Habit, logs: HabitLogs, qty: HabitQuantityLogs, today: string) {
  const out: { date: string; p: number }[] = []
  const end = new Date(today + 'T12:00:00')
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end); d.setDate(d.getDate() - i)
    const date = d.toLocaleDateString('en-CA')
    out.push({ date, p: dayProgress(habit, date, logs, qty) })
  }
  return out
}
