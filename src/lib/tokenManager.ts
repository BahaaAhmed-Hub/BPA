/**
 * tokenManager — server-backed Google token cache for extra accounts.
 *
 * Architecture:
 *   - In-memory cache (Map) — no localStorage, no stale-on-reload problem.
 *   - For extra (non-primary) accounts: calls the google-oauth Edge Function
 *     (action: 'refresh') which exchanges the stored Google refresh token for
 *     a fresh access token. Tokens are cached for 55 min (conservative of
 *     Google's 60-min TTL).
 *   - Concurrent calls for the same email are deduplicated: one in-flight
 *     Promise is shared so we never call the Edge Function twice simultaneously.
 *   - Primary account tokens are NOT managed here — they go through the
 *     existing refreshPrimaryToken() path in googleCalendar.ts.
 *
 * Usage:
 *   import { getGoogleToken, seedToken, clearAllTokens } from '@/lib/tokenManager'
 *
 *   const token = await getGoogleToken('work@example.com')
 *   if (!token) // 'cal:reconnect-required' event was dispatched — show badge
 */

import { supabase } from './supabase'

const TTL_MS    = 55 * 60 * 1000  // 55 min — refresh before Google's 60-min expiry
const BUFFER_MS =  2 * 60 * 1000  // refetch when < 2 min remaining

interface CachedToken { token: string; expiresAt: number }

const cache    = new Map<string, CachedToken>()             // email → { token, expiresAt }
const inFlight = new Map<string, Promise<string | null>>()  // email → pending Edge Fn call

// Single shared promise for Supabase session refresh — prevents concurrent
// refreshSession() calls from consuming the refresh token multiple times
let sessionRefreshInFlight: Promise<string | null> | null = null

async function getFreshAccessToken(): Promise<string | null> {
  if (sessionRefreshInFlight) return sessionRefreshInFlight
  sessionRefreshInFlight = supabase.auth.refreshSession()
    .then(({ data }) => data.session?.access_token ?? null)
    .finally(() => { sessionRefreshInFlight = null })
  return sessionRefreshInFlight
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Seed a known-good token (e.g. from the OAuth callback session).
 * Avoids an Edge Function round-trip for freshly connected accounts.
 */
export function seedToken(email: string, token: string, expiresInMs = TTL_MS): void {
  if (token) cache.set(email, { token, expiresAt: Date.now() + expiresInMs })
}

/**
 * Seed all extra accounts whose stored token is still within its TTL.
 * Call this once on app start to warm the cache without hitting the Edge Function.
 */
export function seedFromLocalStorage(): void {
  try {
    const raw = localStorage.getItem('professor-connected-accounts')
    if (!raw) return
    const accounts = JSON.parse(raw) as Array<{
      email: string
      providerToken?: string
      providerTokenSavedAt?: number
      isPrimary?: boolean
    }>
    const now = Date.now()
    for (const a of accounts) {
      if (a.isPrimary || !a.providerToken || !a.providerTokenSavedAt) continue
      const age = now - a.providerTokenSavedAt
      if (age < TTL_MS) {
        cache.set(a.email, { token: a.providerToken, expiresAt: a.providerTokenSavedAt + TTL_MS })
      }
    }
  } catch { /* ignore */ }
}

/** Clear all cached tokens (call on sign-out). */
export function clearAllTokens(): void {
  cache.clear()
  inFlight.clear()
}

/**
 * Returns a valid Google access token for the given extra-account email.
 * Hits the Edge Function only when the cached token is missing or near expiry.
 * Returns null and dispatches 'cal:reconnect-required' if the account needs
 * to go through OAuth again.
 */
export async function getGoogleToken(email: string): Promise<string | null> {
  const cached = cache.get(email)
  if (cached && cached.expiresAt > Date.now() + BUFFER_MS) return cached.token

  // Deduplicate: re-use an already-in-flight request for this email
  const existing = inFlight.get(email)
  if (existing) return existing

  const promise = callEdgeFunction(email)
  inFlight.set(email, promise)
  promise.finally(() => inFlight.delete(email))
  return promise
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function callEdgeFunction(email: string): Promise<string | null> {
  try {
    // supabase.functions.invoke automatically attaches the current JWT.
    // If the session looks stale, we refresh it first (deduplicated).
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return cache.get(email)?.token ?? null

    // Ensure the JWT is fresh before calling the edge function
    const supabaseToken = session.expires_at && session.expires_at * 1000 < Date.now() + 60_000
      ? (await getFreshAccessToken()) ?? session.access_token
      : session.access_token

    // Temporarily set the session so supabase.functions.invoke uses the right token.
    // We call the function directly via fetch to control the auth header precisely.
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string ?? ''
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${supabaseToken}`,
        'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? '',
      },
      body: JSON.stringify({ action: 'refresh', email }),
    })

    if (!res.ok) {
      console.warn('[tokenManager] google-oauth HTTP error:', res.status)
      return cache.get(email)?.token ?? null
    }

    const data = await res.json() as {
      access_token?: string
      expires_in?:   number
      error?:        string
    }

    if (data.error === 'reconnect_required') {
      // Try bootstrap before showing the reconnect badge
      const accounts = (() => {
        try { return JSON.parse(localStorage.getItem('professor-connected-accounts') ?? '[]') as Array<{ email: string; supabaseRefreshToken?: string }> }
        catch { return [] }
      })()
      const acct = accounts.find(a => a.email === email)
      if (acct?.supabaseRefreshToken) {
        const bootstrapped = await getGoogleTokenViaSupabaseRefresh(email, acct.supabaseRefreshToken)
        if (bootstrapped) return bootstrapped
      }
      // All fallbacks exhausted — show the badge
      window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email } }))
      cache.delete(email)
      return null
    }

    if (data.access_token) {
      const expiresInMs = ((data.expires_in ?? 3600) * 1000) - BUFFER_MS
      seedToken(email, data.access_token, expiresInMs)
      return data.access_token
    }

    return cache.get(email)?.token ?? null
  } catch (e) {
    console.warn('[tokenManager] Edge Function call failed:', e)
    return cache.get(email)?.token ?? null
  }
}

// ─── Bootstrap fallback ───────────────────────────────────────────────────────

/**
 * When the Edge Function has no stored Google refresh token for an extra account
 * (because save_account was never called or failed), this function asks the Edge
 * Function to try exchanging the account's STORED Supabase refresh token with GoTrue.
 * GoTrue often returns provider_token (Google access token) and provider_refresh_token
 * in the refresh response, which lets the server bootstrap the google_account_tokens row.
 *
 * On success, seeds the token in the in-memory cache and returns it.
 * On failure (GoTrue doesn't return provider_token), returns null.
 */
export async function getGoogleTokenViaSupabaseRefresh(
  email: string,
  supabaseRefreshToken: string,
): Promise<string | null> {
  if (!supabaseRefreshToken) return null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null

    const supabaseToken = session.expires_at && session.expires_at * 1000 < Date.now() + 60_000
      ? (await getFreshAccessToken()) ?? session.access_token
      : session.access_token

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string ?? ''
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${supabaseToken}`,
        'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? '',
      },
      body: JSON.stringify({ action: 'refresh', email, supabase_refresh_token: supabaseRefreshToken }),
    })

    if (!res.ok) return null

    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string }
    if (data.error || !data.access_token) return null

    const expiresInMs = ((data.expires_in ?? 3600) * 1000) - BUFFER_MS
    seedToken(email, data.access_token, expiresInMs)
    return data.access_token
  } catch (e) {
    console.warn('[tokenManager] getGoogleTokenViaSupabaseRefresh failed:', e)
    return null
  }
}
