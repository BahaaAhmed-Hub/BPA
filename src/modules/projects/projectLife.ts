import type { Habit, HabitLogs, HabitQuantityLogs } from '@/store/habitsStore'
import { dayProgress } from '@/lib/habitProgress'
import { sumInBase } from '@/modules/finance/fx'
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
