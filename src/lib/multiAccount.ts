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

const CAL_INTEL_CACHE_KEY = 'cal-intel-cals-cache'

export function removeAccount(id: string): void {
  const all     = loadAccounts()
  const removed = all.find(a => a.id === id)
  saveAccounts(all.filter(a => a.id !== id))

  // Clean this account's calendars from the CalendarIntelligence cache so they
  // don't reappear on the next page load.
  if (removed) {
    try {
      const raw = localStorage.getItem(CAL_INTEL_CACHE_KEY)
      if (raw) {
        const cals = JSON.parse(raw) as Array<{ accountEmail: string }>
        localStorage.setItem(CAL_INTEL_CACHE_KEY, JSON.stringify(
          cals.filter(c => c.accountEmail !== removed.email)
        ))
      }
    } catch { /* ignore */ }

    // Also remove any hidden-account entry for this email
    try {
      const hiddenRaw = localStorage.getItem('cal-intel-hidden-accounts')
      if (hiddenRaw) {
        const hidden = new Set(JSON.parse(hiddenRaw) as string[])
        hidden.delete(removed.email)
        localStorage.setItem('cal-intel-hidden-accounts', JSON.stringify([...hidden]))
      }
    } catch { /* ignore */ }
  }
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
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: account.supabaseRefreshToken }),
      }
    )

    if (!res.ok) return null

    const data = await res.json() as {
      provider_token?: string
      access_token?: string
      refresh_token?: string
    }

    // ALWAYS save the rotated Supabase tokens — even if provider_token is absent.
    // If we don't save the new refresh_token here, Supabase invalidates the old one
    // and every subsequent call fails with 400 (token already used/rotated).
    const accounts = loadAccounts()
    saveAccounts(accounts.map(a => a.id === account.id ? {
      ...a,
      supabaseAccessToken:  data.access_token  ?? a.supabaseAccessToken,
      supabaseRefreshToken: data.refresh_token ?? a.supabaseRefreshToken,
      // Only update Google token if Supabase returned one
      ...(data.provider_token ? {
        providerToken:        data.provider_token,
        providerTokenSavedAt: Date.now(),
      } : {}),
    } : a))

    return data.provider_token ?? null
  } catch {
    return null
  }
}

// ─── Account visibility (hide entire account from the calendar) ───────────────
const HIDDEN_ACCOUNTS_KEY = 'cal-intel-hidden-accounts'

export function loadHiddenAccounts(): Set<string> {
  try { const r = localStorage.getItem(HIDDEN_ACCOUNTS_KEY); return r ? new Set(JSON.parse(r) as string[]) : new Set() } catch { return new Set() }
}
export function saveHiddenAccounts(s: Set<string>): void {
  localStorage.setItem(HIDDEN_ACCOUNTS_KEY, JSON.stringify([...s]))
}

/** Sign out of Supabase (used only to clear the primary session). */
export async function signOutPrimary(): Promise<void> {
  await supabase.auth.signOut()
}

// ─── Server-backed account list ───────────────────────────────────────────────

export interface ServerAccount {
  id:         string
  email:      string
  name?:      string | null
  avatarUrl?: string | null
  isPrimary:  boolean
  connectedAt: string
}

/**
 * Loads connected Google accounts from the google_accounts DB table.
 * Returns null on error (caller should fall back to localStorage).
 * No tokens are returned — metadata only (email, name, avatar, isPrimary).
 */
export async function loadAccountsFromServer(): Promise<ServerAccount[] | null> {
  const { data, error } = await supabase
    .from('google_accounts')
    .select('id, email, name, avatar_url, is_primary, connected_at')
    .order('is_primary', { ascending: false })
    .order('connected_at', { ascending: true })

  if (error) {
    console.warn('[multiAccount] loadAccountsFromServer error:', error)
    return null
  }

  return (data ?? []).map(row => ({
    id:          row.id as string,
    email:       row.email as string,
    name:        row.name as string | null,
    avatarUrl:   row.avatar_url as string | null,
    isPrimary:   row.is_primary as boolean,
    connectedAt: row.connected_at as string,
  }))
}
