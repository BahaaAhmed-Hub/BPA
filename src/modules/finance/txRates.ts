// ─── An entry keeps the exchange rate of the day it was added ────────────────
//
// `fx.ts` holds one rate per currency, so changing USD from 48 to 50 re-priced
// every USD entry already in the ledger: last July's rent, paid at 48, read as
// 50 in every total. A flow of money is a past event; what it was worth then is
// not a thing a later rate gets to revise.
//
// The rate rides on the entry as a tag — `fx:USD/EGP=48.5` — the way a budget
// entry carries its `budget` tag: it travels with the row, needs no column and
// no sync key, and goes when the entry does. An entry with no such tag
// (anything older than this, or a currency nobody had a rate for) converts at
// the current rate, exactly as before.
//
// Balances are not flows. A USD account or card is worth what a dollar costs
// *now*, so those keep converting by `toBase`, and only entries come here.

import { baseCurrency, convert, rateFor } from './fx'
import type { Transaction } from './types'

type Rated = Pick<Transaction, 'currency' | 'tags'>

const TAG = /^fx:([A-Z]{3})\/([A-Z]{3})=([\d.]+)$/

/** The rate stamped on an entry, when it was stamped in this currency against
 *  this base. A tag for another base means nothing and is ignored. */
export function frozenRate(tx: Rated, base = baseCurrency()): number | null {
  const cur = (tx.currency || base).toUpperCase()
  for (const t of tx.tags ?? []) {
    const m = TAG.exec(t)
    if (m && m[1] === cur && m[2] === base.toUpperCase()) return Number(m[3])
  }
  return null
}

/** An amount of this entry's, in `to` (the base by default). Null when it
 *  cannot be known, as `convert` and `toBase` say. */
export function txConvert(tx: Rated, amount: number, to = baseCurrency()): number | null {
  const base = baseCurrency()
  const rate = frozenRate(tx, base)
  if (rate === null) return convert(amount, tx.currency, to)
  const inBase = amount * rate
  if (to.toUpperCase() === base.toUpperCase()) return inBase
  const target = rateFor(to, base)
  return target ? inBase / target : null
}

/** The size of an entry, in `to`. The thing every total adds up. */
export const txIn = (tx: Pick<Transaction, 'amount' | 'currency' | 'tags'>, to = baseCurrency()): number | null =>
  txConvert(tx, Math.abs(tx.amount), to)

/**
 * The entry with today's rate on it, if it is in a foreign currency and has
 * none. `note` also writes the rate into the description, for whoever reads
 * the entry later (the feeds put a note in brackets themselves) — done for entries being added, not for old ones being
 * frozen, whose notes are theirs.
 */
export function stamped<T extends Transaction>(tx: T, opts: { note?: boolean; now?: Date } = {}): T {
  const base = baseCurrency().toUpperCase()
  const cur = (tx.currency || base).toUpperCase()
  if (cur === base || frozenRate(tx, base) !== null) return tx
  const rate = rateFor(cur, base)
  if (rate === null) return tx
  const tags = [...(tx.tags ?? []).filter(t => !t.startsWith('fx:')), `fx:${cur}/${base}=${rate}`]
  if (!opts.note) return { ...tx, tags }
  const day = (opts.now ?? new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const aside = `rate ${day}: 1 ${cur} = ${rate} ${base}`
  return { ...tx, tags, note: tx.note ? `${tx.note} ${aside}` : aside }
}
