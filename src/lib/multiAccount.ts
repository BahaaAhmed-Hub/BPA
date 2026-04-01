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
 */
export async function getProviderTokenForAccount(account: ConnectedAccount): Promise<string | null> {
  const age = Date.now() - (account.providerTokenSavedAt ?? 0)
  if (age < TOKEN_TTL) return account.providerToken
  return null
}

/**
 * Silently refreshes the Google provider_token for an extra (non-primary) account
 * by temporarily swapping the Supabase session to that account, calling
 * refreshSession(), extracting the new provider_token, then immediately restoring
 * the primary session.
 *
 * Returns the fresh provider_token on success, or null if refresh fails
 * (e.g. the Supabase refresh_token has also expired — ~30 day TTL).
 */
export async function silentRefreshAccountToken(account: ConnectedAccount): Promise<string | null> {
  if (!account.supabaseRefreshToken) return null

  // Snapshot current primary session so we can restore it
  let primaryAccessToken: string | null = null
  let primaryRefreshToken: string | null = null
  try {
    const { data } = await supabase.auth.getSession()
    primaryAccessToken  = data.session?.access_token  ?? null
    primaryRefreshToken = data.session?.refresh_token ?? null
  } catch { /* proceed anyway */ }

  try {
    // Swap to the extra account's saved Supabase session
    await supabase.auth.setSession({
      access_token:  account.supabaseAccessToken  ?? '',
      refresh_token: account.supabaseRefreshToken ?? '',
    })

    // Refresh — Supabase will issue new Supabase JWT + fresh Google provider_token
    const { data: refreshed, error } = await supabase.auth.refreshSession()
    if (error || !refreshed.session?.provider_token) return null

    const newProviderToken     = refreshed.session.provider_token
    const newSupabaseAccess    = refreshed.session.access_token
    const newSupabaseRefresh   = refreshed.session.refresh_token ?? account.supabaseRefreshToken

    // Persist the fresh tokens back into the stored account
    const accounts = loadAccounts()
    saveAccounts(accounts.map(a => a.id === account.id ? {
      ...a,
      providerToken:        newProviderToken,
      providerTokenSavedAt: Date.now(),
      supabaseAccessToken:  newSupabaseAccess,
      supabaseRefreshToken: newSupabaseRefresh,
    } : a))

    return newProviderToken
  } catch {
    return null
  } finally {
    // Always restore the primary session, even if refresh failed
    if (primaryAccessToken && primaryRefreshToken) {
      try {
        await supabase.auth.setSession({
          access_token:  primaryAccessToken,
          refresh_token: primaryRefreshToken,
        })
      } catch { /* best effort */ }
    }
  }
}

/** Sign out of Supabase (used only to clear the primary session). */
export async function signOutPrimary(): Promise<void> {
  await supabase.auth.signOut()
}
