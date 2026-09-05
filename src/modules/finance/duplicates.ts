import type { Transaction } from './types'

// ─── Entries that look like they were put in twice ───────────────────────────
// Nothing here deletes or merges anything. Two identical payments on the same
// day are usually a slip and occasionally real — a second tank of petrol, a
// bill paid in two halves — so the job is to point at them and let the person
// who made them decide.

export type DuplicateScope = 'day' | 'month'

/** Payee text is typed by hand and arrives spelt five ways. */
function normalise(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** What makes two entries "the same entry": the same money, out of the same
 *  pocket, to the same place, filed the same way. Date is deliberately not in
 *  here — it is what separates a duplicate from a repeat. */
function fingerprint(tx: Transaction): string {
  return [
    tx.type,
    Math.abs(tx.amount).toFixed(2),
    tx.currency,
    tx.accountId ?? '',
    tx.categoryId ?? '',
    normalise(tx.payee),
  ].join('|')
}

/**
 * Which entries look duplicated, and how closely.
 *
 * `day` — two or more identical entries on one date. Almost always a slip.
 * `month` — identical entries on different days of the same month. Might be a
 *   twice-monthly payment, might be the same bill entered from two places, so
 *   it is flagged more quietly.
 *
 * An entry the same in a *different* month is a recurring payment, not a
 * duplicate, and is never flagged — otherwise rent would light up every month
 * of the year.
 */
export function findDuplicates(transactions: Transaction[]): Map<string, DuplicateScope> {
  const byPrint = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    if (!(Math.abs(tx.amount) > 0)) continue
    const k = fingerprint(tx)
    const list = byPrint.get(k)
    if (list) list.push(tx)
    else byPrint.set(k, [tx])
  }

  const flags = new Map<string, DuplicateScope>()
  for (const group of byPrint.values()) {
    if (group.length < 2) continue

    const byDay = new Map<string, Transaction[]>()
    const byMonth = new Map<string, Transaction[]>()
    for (const tx of group) {
      const day = tx.date
      const month = tx.date.slice(0, 7)
      byDay.set(day, [...(byDay.get(day) ?? []), tx])
      byMonth.set(month, [...(byMonth.get(month) ?? []), tx])
    }

    for (const sameDay of byDay.values()) {
      if (sameDay.length > 1) for (const tx of sameDay) flags.set(tx.id, 'day')
    }
    for (const sameMonth of byMonth.values()) {
      if (sameMonth.length < 2) continue
      // Anything already called out as a same-day pair keeps the stronger flag.
      for (const tx of sameMonth) if (!flags.has(tx.id)) flags.set(tx.id, 'month')
    }
  }
  return flags
}

export function duplicateNote(scope: DuplicateScope): string {
  return scope === 'day'
    ? 'Looks like a duplicate — an identical entry is filed on this same day'
    : 'Possible duplicate — an identical entry is filed elsewhere in this month'
}
