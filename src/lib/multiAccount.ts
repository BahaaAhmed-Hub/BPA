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

const TOKEN_TTL = 50 * 60 * 1000 // 50 min

/** Returns a fresh provider token for an additional account, refreshing via Supabase if stale. */
export async function getProviderTokenForAccount(account: ConnectedAccount): Promise<string> {
  const age = Date.now() - (account.providerTokenSavedAt ?? 0)
  if (age < TOKEN_TTL) return account.providerToken  // still fresh

  // Token is stale — refresh via stored Supabase session
  if (account.supabaseAccessToken && account.supabaseRefreshToken) {
    try {
      // Save current primary session so we can restore it
      const { data: { session: primary } } = await supabase.auth.getSession()

      // Temporarily set the additional account's session
      const { data: refreshed } = await supabase.auth.setSession({
        access_token:  account.supabaseAccessToken,
        refresh_token: account.supabaseRefreshToken,
      })

      const freshProviderToken = refreshed.session?.provider_token ?? ''

      // Restore original session
      if (primary) {
        await supabase.auth.setSession({
          access_token:  primary.access_token,
          refresh_token: primary.refresh_token,
        })
      }

      if (freshProviderToken) {
        // Persist the updated token + new session tokens
        const accounts = loadAccounts()
        saveAccounts(accounts.map(a => a.id === account.id ? {
          ...a,
          providerToken:        freshProviderToken,
          providerTokenSavedAt: Date.now(),
          supabaseAccessToken:  refreshed.session?.access_token ?? a.supabaseAccessToken,
          supabaseRefreshToken: refreshed.session?.refresh_token ?? a.supabaseRefreshToken,
        } : a))
        return freshProviderToken
      }
    } catch { /* fall through to cached token */ }
  }

  return account.providerToken  // best-effort: return stale token
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
  // Ensure primary token (from Supabase auth) is always included
  if (primary && !result.some(r => r.token === primary)) {
    result.unshift({ accountId: 'primary', email: '', token: primary })
  }
  return result
}
