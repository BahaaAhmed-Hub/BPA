import type { CSSProperties } from 'react'
import type { Transaction } from './types'
import { NEGATIVE } from '../../lib/moneyColors'

// ─── Money that has not moved yet ────────────────────────────────────────────
// An entry has two dates: the day it belongs to and the day it was paid. With
// no payment date the money is still owed, whatever the entry's own date says
// — a bill logged for the 1st and left unpaid is not settled on the 2nd.
//
// One place decides how that reads, so the four feeds that list entries — the
// Today feed, the account feed on Balances, and the two drill-downs — cannot
// drift into marking it three different ways.

// The `paid_at` column arrives with migration 20260006. Until it runs the
// server cannot store a payment date at all: every row comes back without one
// and `saveTransaction` drops the column and retries, so nothing is ever
// written either. Reading that as "the whole ledger is unpaid" would be a
// confident claim about data nobody has — so where the column is missing,
// nothing is marked. The store says which it is on every load.
let columnExists = true

export function setPaidAtSupported(yes: boolean): void { columnExists = yes }
export function paidAtSupported(): boolean { return columnExists }

export function isUnpaid(tx: Pick<Transaction, 'paidAt'>): boolean {
  return columnExists && !tx.paidAt
}

/** What actually counts towards a figure: money that has moved.
 *
 *  An entry with no payment date is money still owed, so it has no business
 *  in a balance, a day's net, an envelope or a report — those say where things
 *  stand, and an unpaid bill has not happened yet. The entry is still listed
 *  in every feed, marked; it is only kept out of the arithmetic.
 *
 *  The one deliberate exception is the Financials "when it is due" view, whose
 *  whole purpose is to file an entry in the month it belongs to whether or not
 *  it has been paid. Its sibling view already leaves the unpaid out. */
export function settled<T extends Pick<Transaction, 'paidAt'>>(txs: T[]): T[] {
  return columnExists ? txs.filter(t => !!t.paidAt) : txs
}

/** The day an entry's money actually moved, for anything that files entries
 *  into a month.
 *
 *  A bill due on the 28th and paid on the 3rd belongs to the month it was paid
 *  in, not the one it was owed in — a budget is a record of spending, and the
 *  spending happened in March. Falls back to the entry's own date only where
 *  the server cannot hold a payment date at all, so nothing loses its month. */
export function whenPaid(tx: Pick<Transaction, 'date' | 'paidAt'>): string {
  return tx.paidAt ?? tx.date
}

/** Spread over a feed row's own style, after it: the border shorthand is what
 *  replaces the row's bottom hairline, so it has to be assigned last. */
export function unpaidRow(unpaid: boolean): CSSProperties {
  return unpaid ? {
    border: `1px dotted ${NEGATIVE}`,
    borderRadius: 10,
    paddingLeft: 10,
    paddingRight: 10,
    background: `${NEGATIVE}0A`,
  } : {}
}

export const UNPAID_TITLE = 'Not paid — no payment date on this entry'
