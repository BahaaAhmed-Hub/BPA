/**
 * Multi-account Google OAuth support.
 * Additional accounts are stored in localStorage (tokens only, not full sessions).
 */

import { supabase } from './supabase'

export interface ConnectedAccount {
  id: string
  email: string
  name: string
  avatarUrl?: string
  providerToken: string
  providerTokenSavedAt?: number   // ms timestamp when providerToken was stored
  supabaseAccessToken?: string    // for refreshing providerToken later
  supabaseRefreshToken?: string
  scopes: string[]
  connectedAt: string
  isPrimary: boolean
}

const ACCOUNTS_KEY = 'professor-connected-accounts'
const TOKEN_TTL = 50 * 60 * 1000 // 50 min

export function loadAccounts(): ConnectedAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    return raw ? (JSON.parse(raw) as ConnectedAccount[]) : []
  } catch { return [] }
}

export function saveAccounts(accounts: ConnectedAccount[]): void {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)) } catch { /* quota */ }
}

export function addAccount(account: Omit<ConnectedAccount, 'id' | 'connectedAt'>): ConnectedAccount {
  const accounts = loadAccounts()
  const existing = accounts.find(a => a.email === account.email)
  const now = Date.now()
  if (existing) {
    const updated = {
      ...existing,
      providerToken:        account.providerToken,
      providerTokenSavedAt: now,
      supabaseAccessToken:  account.supabaseAccessToken ?? existing.supabaseAccessToken,
      supabaseRefreshToken: account.supabaseRefreshToken ?? existing.supabaseRefreshToken,
      name: account.name,
    }
    saveAccounts(accounts.map(a => a.email === account.email ? updated : a))
    return updated
  }
  const newAccount: ConnectedAccount = {
    ...account,
    providerTokenSavedAt: now,
    id: crypto.randomUUID(),
    connectedAt: new Date().toISOString(),
  }
  saveAccounts([...accounts, newAccount])
  return newAccount
}

export function removeAccount(id: string): void {
  const accounts = loadAccounts().filter(a => a.id !== id)
  saveAccounts(accounts)
}

export function getPrimaryToken(): string {
  return localStorage.getItem('google_provider_token') ?? ''
}

export function getAllTokens(): { accountId: string; email: string; token: string }[] {
  const primary  = getPrimaryToken()
  const accounts = loadAccounts()
  const result   = accounts.map(a => ({ accountId: a.id, email: a.email, token: a.providerToken }))
  if (primary && !result.some(r => r.token === primary)) {
    result.unshift({ accountId: 'primary', email: '', token: primary })
  }
  return result
}

/**
 * Returns a fresh provider token for an additional account, refreshing via
 * stored Supabase session if stale.
 *
 * Returns null when the token is expired AND cannot be auto-refreshed
 * (account was connected before session tokens were stored). In that case
 * the UI should prompt the user to reconnect that specific account.
 */
export async function getProviderTokenForAccount(account: ConnectedAccount): Promise<string | null> {
  const age = Date.now() - (account.providerTokenSavedAt ?? 0)
  if (age < TOKEN_TTL) return account.providerToken

  if (account.supabaseAccessToken && account.supabaseRefreshToken) {
    try {
      const { data: { session: primary } } = await supabase.auth.getSession()

      // Switch to the additional account's Supabase session
      await supabase.auth.setSession({
        access_token:  account.supabaseAccessToken,
        refresh_token: account.supabaseRefreshToken,
      })

      // Force a full token refresh — this makes Supabase use its stored
      // Google refresh token to get a brand-new Google provider_token
      const { data: refreshed } = await supabase.auth.refreshSession()
      const freshToken = refreshed.session?.provider_token ?? ''

      // Restore the primary session
      if (primary) {
        await supabase.auth.setSession({
          access_token:  primary.access_token,
          refresh_token: primary.refresh_token,
        })
      }

      if (freshToken) {
        const accounts = loadAccounts()
        saveAccounts(accounts.map(a => a.id === account.id ? {
          ...a,
          providerToken:        freshToken,
          providerTokenSavedAt: Date.now(),
          supabaseAccessToken:  refreshed.session?.access_token ?? a.supabaseAccessToken,
          supabaseRefreshToken: refreshed.session?.refresh_token ?? a.supabaseRefreshToken,
        } : a))
        return freshToken
      }
    } catch { /* fall through */ }
  }

  // Token is expired and we have no way to refresh it — signal needs-reconnect
  return null
}
