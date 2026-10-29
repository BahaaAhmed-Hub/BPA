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
import { group } from './format'
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

export const isFxTag = (tag: string): boolean => TAG.test(tag)

/** The tags with this rate on them in place of any other. */
export const withRate = (tags: string[] | undefined, currency: string, rate: number, base = baseCurrency()): string[] =>
  [...(tags ?? []).filter(t => !t.startsWith('fx:')), `fx:${currency.toUpperCase()}/${base.toUpperCase()}=${rate}`]

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
  const tags = withRate(tx.tags, cur, rate, base)
  if (!opts.note) return { ...tx, tags }
  const day = (opts.now ?? new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const aside = `rate ${day}: 1 ${cur} = ${rate} ${base}`
  return { ...tx, tags, note: tx.note ? `${tx.note} ${aside}` : aside }
}

// ─── Unpaid money in the currency it is owed in ──────────────────────────────

const figure = (n: number): string => group(n, Number.isInteger(n) ? 0 : 2)

/**
 * What an unpaid foreign entry is, in words: its own currency, the rate it was
 * added at, what that comes to, and — where today's rate is different — what it
 * would come to if it were settled now. Null for an entry in the base currency,
 * and where there is no rate at all.
 */
export function unpaidRateNote(tx: Pick<Transaction, 'amount' | 'currency' | 'tags'>): string | null {
  const base = baseCurrency()
  const cur = (tx.currency || base).toUpperCase()
  if (cur === base.toUpperCase()) return null
  const n = Math.abs(tx.amount)
  const added = frozenRate(tx, base)
  const today = rateFor(cur, base)
  const rate = added ?? today
  if (rate === null) return null
  const head = `${cur} ${figure(n)} @ ${rate} = ${base} ${figure(n * rate)}`
  return added !== null && today !== null && today !== added ? `${head} · today ${today} = ${base} ${figure(n * today)}` : head
}

export interface Debt {
  currency: string
  count: number
  /** In that currency. */
  amount: number
  /** What it comes to at the rates the entries were added at. Null if any has none. */
  atAdded: number | null
  /** What it comes to at today's rate. Null where there is none. */
  atToday: number | null
  /** Today's rate, for the line that says it. */
  todayRate: number | null
}

/** What is owed, by foreign currency. The caller says which entries are debts
 *  (unpaid, spending, due by now); this only adds them up. */
export function debtsByCurrency(txs: Pick<Transaction, 'amount' | 'currency' | 'tags'>[]): Debt[] {
  const base = baseCurrency().toUpperCase()
  const by = new Map<string, Debt>()
  for (const tx of txs) {
    const cur = (tx.currency || base).toUpperCase()
    if (cur === base) continue
    const todayRate = rateFor(cur, base)
    const d = by.get(cur) ?? { currency: cur, count: 0, amount: 0, atAdded: 0, atToday: todayRate === null ? null : 0, todayRate }
    const n = Math.abs(tx.amount)
    const added = txIn(tx)
    d.count += 1
    d.amount += n
    d.atAdded = d.atAdded === null || added === null ? null : d.atAdded + added
    d.atToday = d.atToday === null || todayRate === null ? null : d.atToday + n * todayRate
    by.set(cur, d)
  }
  return [...by.values()]
}
