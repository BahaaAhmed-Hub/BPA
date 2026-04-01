/**
 * Multi-account Google OAuth support.
 * Additional accounts are stored in localStorage (tokens only, not full sessions).
 */

import { supabase } from './supabase'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL  as string ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? ''

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
 * by calling the GoTrue /token endpoint directly — NO session swap, so
 * onAuthStateChange in App.tsx is never triggered and the primary session is
 * never touched.
 *
 * Returns the fresh provider_token on success, or null if the Supabase
 * refresh_token has expired (~30-day TTL).
 */
export async function silentRefreshAccountToken(account: ConnectedAccount): Promise<string | null> {
  if (!account.supabaseRefreshToken || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null

  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: account.supabaseRefreshToken }),
      }
    )

    if (!res.ok) return null

    const data = await res.json() as {
      provider_token?: string
      access_token?: string
      refresh_token?: string
    }

    const newProviderToken = data.provider_token ?? null
    if (!newProviderToken) return null

    // Persist fresh tokens back — no session swap, no auth events
    const accounts = loadAccounts()
    saveAccounts(accounts.map(a => a.id === account.id ? {
      ...a,
      providerToken:        newProviderToken,
      providerTokenSavedAt: Date.now(),
      supabaseAccessToken:  data.access_token  ?? a.supabaseAccessToken,
      supabaseRefreshToken: data.refresh_token ?? a.supabaseRefreshToken,
    } : a))

    return newProviderToken
  } catch {
    return null
  }
}

/** Sign out of Supabase (used only to clear the primary session). */
export async function signOutPrimary(): Promise<void> {
  await supabase.auth.signOut()
}
