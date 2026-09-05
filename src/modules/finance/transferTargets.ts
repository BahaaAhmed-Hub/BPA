// ─── Where a transfer lands, kept locally until the column exists ────────────
// to_account_id arrives with migration 20260007. Until that has been run,
// saveTransaction drops the column and retries so the entry still saves — but
// the row comes back without a destination, and a transfer with nowhere to land
// takes money out of one account and puts it nowhere. On screen that is a
// payment that moves the card until the next reload and then stops.
//
// Holding the destination here as well means the payment survives either way,
// and the column takes over the moment it exists.

import type { Transaction } from './types'

const KEY = 'finance-transfer-targets'

function load(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch { return {} }
}

function save(all: Record<string, string>): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* quota */ }
}

export function rememberTarget(txId: string, toAccountId: string | undefined): void {
  const all = load()
  if (toAccountId) all[txId] = toAccountId
  else delete all[txId]
  save(all)
}

export function forgetTarget(txId: string): void {
  const all = load()
  if (!(txId in all)) return
  delete all[txId]
  save(all)
}

/** The server's destination wins where it has one; this fills the gap. */
export function withLocalTargets(transactions: Transaction[]): Transaction[] {
  const all = load()
  return transactions.map(t => t.toAccountId || !all[t.id] ? t : { ...t, toAccountId: all[t.id] })
}
