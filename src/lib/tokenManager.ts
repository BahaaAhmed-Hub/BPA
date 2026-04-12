/**
 * tokenManager — server-backed Google token cache for extra accounts.
 *
 * Architecture:
 *   - In-memory cache (Map) — no localStorage, no stale-on-reload problem.
 *   - For extra (non-primary) accounts: calls the google-token-refresh Edge
 *     Function which exchanges the stored Google refresh token for a fresh
 *     access token. Tokens are cached for 55 min (conservative of Google's
 *     60-min TTL).
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string ?? ''
const TTL_MS       = 55 * 60 * 1000  // 55 min — refresh before Google's 60-min expiry
const BUFFER_MS    =  2 * 60 * 1000  // refetch when < 2 min remaining

interface CachedToken { token: string; expiresAt: number }

const cache   = new Map<string, CachedToken>()          // email → { token, expiresAt }
const inFlight = new Map<string, Promise<string | null>>() // email → pending refresh

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
    // Use getSession() for the access token but fall back to a fresh token if it
    // looks stale. getSession() reads local cache and can return an expired token;
    // if the Edge Function returns 401 we retry once with a force-refreshed session.
    let { data: { session } } = await supabase.auth.getSession()
    if (!session) return cache.get(email)?.token ?? null

    let res = await fetch(`${SUPABASE_URL}/functions/v1/google-token-refresh`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email }),
    })

    // If 401, the cached access_token is expired — force a session refresh and retry once
    if (res.status === 401) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed.session) {
        session = refreshed.session
        res = await fetch(`${SUPABASE_URL}/functions/v1/google-token-refresh`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ email }),
        })
      }
    }

    if (!res.ok) {
      console.warn('[tokenManager] Edge Function HTTP error:', res.status)
      return cache.get(email)?.token ?? null
    }

    const data = await res.json() as {
      access_token?: string
      expires_in?:   number
      error?:        string
    }

    if (data.error === 'reconnect_required') {
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
