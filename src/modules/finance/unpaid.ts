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
