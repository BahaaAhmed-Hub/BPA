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
  supabaseAccessToken?: string    // kept for backwards compat, no longer used for refresh
  supabaseRefreshToken?: string
  scopes: string[]
  connectedAt: string
  isPrimary: boolean
}

const ACCOUNTS_KEY = 'professor-connected-accounts'
const TOKEN_TTL = 50 * 60 * 1000 // 50 min (Google access tokens last ~60 min)

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
 * Returns the stored provider token for an additional account if it is still
 * within its ~50-minute TTL, or null if it has expired.
 *
 * NOTE: Supabase's client SDK cannot reliably refresh the Google provider_token
 * for secondary OAuth accounts — calling refreshSession() while swapping sessions
 * risks overwriting valid tokens with stale ones from the wrong account.
 * The only reliable token is the one captured directly at OAuth connect time.
 * When null is returned, the UI should prompt the user to reconnect that account.
 */
export async function getProviderTokenForAccount(account: ConnectedAccount): Promise<string | null> {
  const age = Date.now() - (account.providerTokenSavedAt ?? 0)
  if (age < TOKEN_TTL) return account.providerToken
  // Token is expired and cannot be safely refreshed client-side — needs reconnect
  return null
}

/** Sign out of Supabase (used only to clear the primary session). */
export async function signOutPrimary(): Promise<void> {
  await supabase.auth.signOut()
}
