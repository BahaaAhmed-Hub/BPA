import type { Account } from './types'

// ─── Card limits, kept locally until the column exists ───────────────────────
// credit_limit arrives with migration 20260008. Until that has been run,
// saveAccount drops the column and retries so the account still saves — but the
// limit then vanishes on the next load from the server, which looks like the
// app forgetting what it was told. Remembering it here as well means it
// survives either way, and the column takes over the moment it exists.

const KEY = 'finance-credit-limits'

function load(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && isFinite(v) && v > 0) out[k] = v
    }
    return out
  } catch { return {} }
}

export function rememberLimit(accountId: string, limit: number | undefined): void {
  const all = load()
  if (limit && limit > 0) all[accountId] = limit
  else delete all[accountId]
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* quota */ }
}

/** The server's figure wins where it has one; this fills the gap where it does not. */
export function withLocalLimits(accounts: Account[]): Account[] {
  const all = load()
  return accounts.map(a => (a.creditLimit ?? 0) > 0 || !all[a.id] ? a : { ...a, creditLimit: all[a.id] })
}
