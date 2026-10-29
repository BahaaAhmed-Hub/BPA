import type { Account, Currency, Transaction } from './types'
import { txIn, txConvert } from './txRates'
import { DEFAULT_LOAN_EMOJI } from '@/lib/glyphs'

// ─── Money borrowed is cash in and debt out, and neither is income ───────────
//
// Borrowing 10,000 puts 10,000 in an account you can spend from, and puts a
// debt of 10,000 on a ledger you will have to clear. Net worth does not move.
// Filed as income it would inflate every "earned this month", the savings rate
// and the forecast, and repaying it would then read as a loss that was never a
// gain.
//
// So a loan is an **account** (`accountType: 'loan'`, one per lender, below
// zero while it is owed), and borrowing is a **transfer** out of it into the
// account the money landed in. Nothing here adds a transaction type: every
// total in the module already reads `income` and `expense` only, so a transfer
// is correct everywhere by construction — and `debtGoals` already makes a goal
// for any account in the red.

/** The lender's account — what is owed to one person or one bank. */
export const isLoan = (a?: { accountType?: string } | null): boolean => a?.accountType === 'loan'

/** Accounts you can spend from or be paid into. A loan is neither: nothing is
 *  bought with it and no salary lands on it, so it must not appear in the
 *  picker for an expense or for income. It *does* appear in a transfer — that
 *  is how it is borrowed from and paid back. */
export const spendingAccounts = <T extends { accountType?: string }>(accounts: T[]): T[] =>
  accounts.filter(a => !isLoan(a))

/** Below this a balance prints as zero, so the debt reads as settled. The
 *  figure `debtGoals` uses for the same question — two screens must not
 *  disagree about whether something is owed. */
export const SETTLED_BELOW = 0.5
export const isSettled = (balance: number): boolean => Math.abs(balance) < SETTLED_BELOW

/** The lender called this, however it was typed. */
export function findLender<T extends Pick<Account, 'accountType' | 'name'>>(accounts: T[], name: string): T | undefined {
  const want = name.trim().toLowerCase()
  if (!want) return undefined
  return accounts.find(a => isLoan(a) && a.name.trim().toLowerCase() === want)
}

/** A new lender's account. It opens at nothing: the debt is the borrowing
 *  entry that follows, so that deleting the entry deletes the debt with it. */
export function newLender(name: string, currency: Currency, sortOrder = 0): Account {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    bank: '',
    accountType: 'loan',
    currency,
    balance: 0,
    emoji: DEFAULT_LOAN_EMOJI,
    // The default of a colour the person can change in the account window — the
    // same default every account is made with — not text on a ground.
    color: 'var(--sb-ink-4)', // ui-guard: ink-ok
    sortOrder,
  }
}

/** Money drawn from a loan into somewhere you can spend it. */
export function isBorrowing(tx: Pick<Transaction, 'type' | 'accountId' | 'toAccountId'>, accounts: Pick<Account, 'id' | 'accountType'>[]): boolean {
  if (tx.type !== 'transfer' || !tx.toAccountId) return false
  const from = accounts.find(a => a.id === tx.accountId)
  const to   = accounts.find(a => a.id === tx.toAccountId)
  return isLoan(from) && !!to && !isLoan(to)
}

/** Money paid into a loan from somewhere you hold it. */
export function isRepayment(tx: Pick<Transaction, 'type' | 'accountId' | 'toAccountId'>, accounts: Pick<Account, 'id' | 'accountType'>[]): boolean {
  if (tx.type !== 'transfer' || !tx.toAccountId) return false
  const from = accounts.find(a => a.id === tx.accountId)
  const to   = accounts.find(a => a.id === tx.toAccountId)
  return isLoan(to) && !!from && !isLoan(from)
}

/** Whether an entry is money out of (or into) an envelope of this kind.
 *
 *  An envelope holds what has come out of it, and an entry says so with its
 *  type matching the category's. A repayment is the exception that is not one:
 *  paying a lender back is a **transfer** — it moves money into a debt rather
 *  than spending it, so no report counts it as an expense — but it is filed
 *  under the loan's budget category, and that envelope has to hold it or its
 *  "spent" would never move. A transfer carries a category nowhere else (the
 *  entry form drops it), so a transfer with one is exactly this. Only the
 *  budget envelopes ask this question; everything that totals spending still
 *  reads `type === 'expense'`. */
export const spendsEnvelope = (
  tx: Pick<Transaction, 'type' | 'categoryId'>,
  wanted: 'income' | 'expense',
): boolean => tx.type === wanted || (wanted === 'expense' && tx.type === 'transfer' && !!tx.categoryId)

/** How much was borrowed in these entries, in `base`. The cash-flow views show
 *  it beside "In" and never inside it: it came in, and it is not income. An
 *  entry in a currency with no rate is left out rather than added at face
 *  value, as everywhere. */
export function borrowedIn(
  txs: Transaction[],
  accounts: Pick<Account, 'id' | 'accountType'>[],
  base?: string,
): number {
  let n = 0
  for (const t of txs) {
    if (!isBorrowing(t, accounts)) continue
    n += txIn(t, base) ?? 0
  }
  return n
}

/** What each end of a borrowing comes to, in that account's own currency.
 *
 *  An entry is kept in the currency it was typed in, and each account takes it
 *  in its own: 500 USD borrowed into an EGP account is 500 USD more owed on the
 *  loan and the rate's worth of pounds more in the account. `null` is "no rate
 *  for one of the two currencies" — nothing is guessed, so the form can say so
 *  rather than file an entry one end of which is silently missing. */
export function borrowingEnds(
  amount: number,
  currency: Currency,
  loan: Pick<Account, 'currency'>,
  into: Pick<Account, 'currency'>,
  /** The entry's tags, which may carry the rate it is at (`fx:USD/EGP=50`). With
   *  none the rate is today's, which is what the store will stamp on it. */
  tags?: string[],
): { owed: number | null; arrives: number | null } {
  const tx = { currency, tags }
  return {
    owed:    txConvert(tx, amount, loan.currency),
    arrives: txConvert(tx, amount, into.currency),
  }
}
