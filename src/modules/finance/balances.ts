import type { Account, Transaction } from './types'

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

/** Where the money went for one account, in that account's own currency. No
 *  conversion happens here: a transaction against an account is in the
 *  account's currency, and mixing rates into this would hide the arithmetic. */
export function deltaFor(account: Account, tx: Transaction): number {
  // A transfer moves money: out of the account it is filed against, into the
  // account it names. Paying a card is the second half of that.
  if (tx.type === 'transfer') {
    if (tx.accountId === account.id)   return -Math.abs(tx.amount)
    if (tx.toAccountId === account.id) return  Math.abs(tx.amount)
    return 0
  }
  if (tx.accountId !== account.id) return 0
  if (tx.type === 'income')  return  Math.abs(tx.amount)
  if (tx.type === 'expense') return -Math.abs(tx.amount)
  // The asset/liability types are about what is owned or owed rather than what
  // is in the account, and are left out until they mean something here.
  return 0
}

export function liveBalance(account: Account, transactions: Transaction[]): number {
  let n = account.balance
  for (const tx of transactions) n += deltaFor(account, tx)
  return n
}

/** Every account's live balance in one pass, so a list of eight accounts does
 *  not walk the transactions eight times. */
export function liveBalances(accounts: Account[], transactions: Transaction[]): Map<string, number> {
  const out = new Map(accounts.map(a => [a.id, a.balance]))
  const byId = new Map(accounts.map(a => [a.id, a]))
  for (const tx of transactions) {
    if (tx.type === 'transfer') {
      if (tx.accountId && out.has(tx.accountId)) out.set(tx.accountId, out.get(tx.accountId)! - Math.abs(tx.amount))
      if (tx.toAccountId && out.has(tx.toAccountId)) out.set(tx.toAccountId, out.get(tx.toAccountId)! + Math.abs(tx.amount))
      continue
    }
    const a = tx.accountId ? byId.get(tx.accountId) : undefined
    if (!a) continue
    out.set(a.id, out.get(a.id)! + deltaFor(a, tx))
  }
  return out
}
