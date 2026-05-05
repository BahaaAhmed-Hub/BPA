import { supabase } from './supabase'

const PENDING_ADD_ACCOUNT_KEY = 'professor-pending-add-account'

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.readonly',
      ].join(' '),
      redirectTo: window.location.origin + import.meta.env.BASE_URL,
      queryParams: {
        access_type: 'offline',  // ensures Google issues a refresh token to Supabase
        prompt: 'consent',       // force consent so refresh token is always granted
      },
    },
  })
  if (error) throw error
  return data
}

/**
 * Connect an additional Google account without replacing the current session.
 * Saves the current session tokens, then triggers OAuth. On return, App.tsx
 * detects the pending flag, stores the new token as an additional account,
 * and restores the original session.
 */
/**
 * emailHint: pass an existing account email to force reconnect for that specific
 * account (uses login_hint so Google pre-selects it). Omit for a new account.
 */
export async function connectAdditionalGoogleAccount(emailHint?: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    localStorage.setItem(PENDING_ADD_ACCOUNT_KEY, JSON.stringify({
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
    }))
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.readonly',
      ].join(' '),
      redirectTo: window.location.origin + import.meta.env.BASE_URL,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent select_account',
        ...(emailHint ? { login_hint: emailHint } : {}),
      },
    },
  })
  if (error) {
    localStorage.removeItem(PENDING_ADD_ACCOUNT_KEY)
    throw error
  }
  return data
}

export function getPendingAddAccount(): { access_token: string; refresh_token: string } | null {
  try {
    const raw = localStorage.getItem(PENDING_ADD_ACCOUNT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function clearPendingAddAccount() {
  localStorage.removeItem(PENDING_ADD_ACCOUNT_KEY)
}

/**
 * Removes a connected Google account from the server.
 * Deletes the google_accounts row (tokens cascade via FK).
 * Returns true on success, false on failure.
 */
export async function disconnectGoogleAccount(accountId: string): Promise<boolean> {
  const { error } = await supabase.functions.invoke('google-oauth', {
    body: { action: 'delete', account_id: accountId },
  })
  if (error) {
    console.warn('[disconnectGoogleAccount] error:', error)
    return false
  }
  return true
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}
