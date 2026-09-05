import type { Account, Transaction } from './types'
import { convert } from './fx'

// ─── What an account actually holds ──────────────────────────────────────────
// The balance on an account row is where it started, not where it is. Nothing
// ever added a transaction to it, so every account read as its opening figure
// for ever — usually zero — while the entries piled up beside it.
//
// A live balance is that opening figure plus everything filed against the
// account. The sign convention is the one the screen already assumes: a
// positive balance is money held, a negative one is money owed, so spending on
// a credit card takes it further below zero and paying the card off brings it
// back towards zero.

/** Where the money went for one account, in that account's own currency.
 *
 *  An entry carries its own currency and keeps it — 250 USD is filed, shown and
 *  edited as 250 USD. It is only converted at the point of being added to
 *  something denominated in another currency, which is here and in the totals.
 *  Adding the bare number moved a card 250 EGP for a 250 USD charge.
 *
 *  Null where there is no rate to convert by: the entry stays as it is and the
 *  balance says so rather than absorbing a wrong number. */
export function deltaFor(account: Account, tx: Transaction): number | null {
  const into = (amount: number) => convert(amount, tx.currency, account.currency)

  // A transfer moves money: out of the account it is filed against, into the
  // account it names. Paying a card is the second half of that. Each end is
  // expressed in its own account's currency, so moving USD onto an EGP card
  // takes dollars off one and puts pounds on the other.
  if (tx.type === 'transfer') {
    if (tx.accountId === account.id) {
      const v = into(Math.abs(tx.amount))
      return v === null ? null : -v
    }
    if (tx.toAccountId === account.id) return into(Math.abs(tx.amount))
    return 0
  }
  if (tx.accountId !== account.id) return 0
  if (tx.type === 'income')  return into(Math.abs(tx.amount))
  if (tx.type === 'expense') {
    const v = into(Math.abs(tx.amount))
    return v === null ? null : -v
  }
  // The asset/liability types are about what is owned or owed rather than what
  // is in the account, and are left out until they mean something here.
  return 0
}

export function liveBalance(account: Account, transactions: Transaction[]): number {
  let n = account.balance
  for (const tx of transactions) n += deltaFor(account, tx) ?? 0
  return n
}

/** Every account's live balance in one pass, so a list of eight accounts does
 *  not walk the transactions eight times. `unconverted` names the currencies an
 *  account holds entries in that nothing could convert, so a balance that is
 *  quietly short can say why. */
export function liveBalances(
  accounts: Account[],
  transactions: Transaction[],
): { balances: Map<string, number>; unconverted: Map<string, Set<string>> } {
  const balances = new Map(accounts.map(a => [a.id, a.balance]))
  const unconverted = new Map<string, Set<string>>()
  const byId = new Map(accounts.map(a => [a.id, a]))

  const apply = (a: Account, tx: Transaction) => {
    const d = deltaFor(a, tx)
    if (d === null) {
      const set = unconverted.get(a.id) ?? new Set<string>()
      set.add((tx.currency || '').toUpperCase())
      unconverted.set(a.id, set)
      return
    }
    balances.set(a.id, balances.get(a.id)! + d)
  }

  for (const tx of transactions) {
    if (tx.type === 'transfer') {
      const from = tx.accountId ? byId.get(tx.accountId) : undefined
      const to   = tx.toAccountId ? byId.get(tx.toAccountId) : undefined
      if (from) apply(from, tx)
      if (to)   apply(to, tx)
      continue
    }
    const a = tx.accountId ? byId.get(tx.accountId) : undefined
    if (a) apply(a, tx)
  }
  return { balances, unconverted }
}
