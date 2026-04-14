/**
 * google-oauth — Supabase Edge Function
 *
 * Manages Google account metadata and tokens server-side so that
 * access/refresh tokens NEVER reach the browser.
 *
 * Actions (POST body: { action, ...payload }):
 *
 *   save_primary   — Called immediately after a primary Google SSO sign-in.
 *                    Upserts google_accounts row + google_account_tokens row
 *                    using the provider_token / provider_refresh_token that
 *                    Supabase injects into the session.
 *
 *   save_account   — Called after connecting an additional Google account.
 *                    Same upsert pattern, marks is_primary = false.
 *
 *   delete         — Removes a google_accounts row (tokens cascade via FK).
 *                    Requires { account_id } in body.
 *
 *   refresh        — Returns a fresh Google access token for a given account.
 *                    Calls Google's token endpoint using the stored refresh token.
 *                    Returns { access_token, expires_in } or { error: 'reconnect_required' }.
 *
 * Required Supabase secrets:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *
 * Auto-injected by Supabase:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID          = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET      = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return err('Method not allowed', 405)

  // ── 1. Authenticate caller ────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return err('Missing Authorization header', 401)

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } =
    await adminClient.auth.getUser(authHeader.slice(7))

  if (authErr || !user) return err('Invalid JWT', 401)

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err('Invalid JSON body', 400) }

  const action = body.action as string | undefined
  if (!action) return err('Missing action', 400)

  // ── 3. Dispatch ───────────────────────────────────────────────────────────
  try {
    switch (action) {
      case 'save_primary':  return await handleSave(adminClient, user.id, body, true)
      case 'save_account':  return await handleSave(adminClient, user.id, body, false)
      case 'delete':        return await handleDelete(adminClient, user.id, body)
      case 'refresh':       return await handleRefresh(adminClient, user.id, body)
      default:              return err(`Unknown action: ${action}`, 400)
    }
  } catch (e) {
    console.error('[google-oauth] unexpected error:', e)
    return err('Internal server error', 500)
  }
})

// ─── Bootstrap helper ─────────────────────────────────────────────────────────

/**
 * Exchanges a stored Supabase refresh_token (from the extra account's local
 * session) with GoTrue.  GoTrue's refresh response includes provider_token and
 * provider_refresh_token when the original session was created via Google OAuth.
 * If we get them, we save them to google_account_tokens so future refreshes
 * work via the normal Google path.
 */
async function tryBootstrapFromSupabaseToken(
  adminClient: ReturnType<typeof createClient>,
  userId:               string,
  email:                string,
  supabaseRefreshToken: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey },
      body:    JSON.stringify({ refresh_token: supabaseRefreshToken }),
    })

    if (!res.ok) return null

    const data = await res.json() as {
      provider_token?:         string
      provider_refresh_token?: string
      access_token?:           string
      refresh_token?:          string
    }

    if (!data.provider_token) return null

    // Persist to DB so future refreshes use the normal Google-token path.
    if (data.provider_refresh_token && email) {
      const expiresAt = new Date(Date.now() + 3500 * 1000).toISOString()
      const { data: acc } = await adminClient
        .from('google_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('email', email)
        .maybeSingle()

      if (acc) {
        await adminClient
          .from('google_account_tokens')
          .upsert(
            {
              user_id:       userId,
              account_id:    acc.id,
              access_token:  data.provider_token,
              refresh_token: data.provider_refresh_token,
              expires_at:    expiresAt,
              scopes:        [],
              updated_at:    new Date().toISOString(),
            },
            { onConflict: 'account_id', ignoreDuplicates: false },
          )
        console.log('[google-oauth] bootstrapped Google tokens from Supabase refresh for', email)
      }
    }

    return { access_token: data.provider_token, expires_in: 3600 }
  } catch (e) {
    console.warn('[google-oauth] tryBootstrapFromSupabaseToken failed:', e)
    return null
  }
}

// ─── Action handlers ──────────────────────────────────────────────────────────

interface SaveBody {
  email:          string
  name?:          string
  avatar_url?:    string
  access_token:   string
  refresh_token?: string   // optional — omit when only access_token is available
  expires_at?:    string   // ISO timestamp
  scopes?:        string[]
}

async function handleSave(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  isPrimary: boolean,
) {
  const {
    email, name, avatar_url,
    access_token, refresh_token, expires_at, scopes,
  } = body as SaveBody

  if (!email)        return err('Missing email')
  if (!access_token) return err('Missing access_token')

  // Upsert google_accounts (metadata only, safe to expose via RLS)
  const { data: account, error: accErr } = await adminClient
    .from('google_accounts')
    .upsert(
      {
        user_id:    userId,
        email,
        name:       name ?? null,
        avatar_url: avatar_url ?? null,
        is_primary: isPrimary,
      },
      { onConflict: 'user_id,email', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (accErr || !account) {
    console.error('[google-oauth] save google_accounts:', accErr)
    return err('Failed to save account metadata', 500)
  }

  // Upsert google_account_tokens only when we have a refresh_token.
  // Without it, the token row is useless (can't refresh later), but the
  // google_accounts metadata row is still valuable for UI display and as
  // an anchor for the tryBootstrapFromSupabaseToken path in handleRefresh.
  if (refresh_token && expires_at) {
    const { error: tokErr } = await adminClient
      .from('google_account_tokens')
      .upsert(
        {
          user_id:       userId,
          account_id:    account.id,
          access_token,
          refresh_token,
          expires_at,
          scopes:        scopes ?? [],
          updated_at:    new Date().toISOString(),
        },
        { onConflict: 'account_id', ignoreDuplicates: false }
      )

    if (tokErr) {
      console.error('[google-oauth] save google_account_tokens:', tokErr)
      // Non-fatal — metadata row was saved successfully; tokens can be bootstrapped later.
    }
  }

  return ok({ account_id: account.id, email, is_primary: isPrimary })
}

async function handleDelete(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const account_id = body.account_id as string | undefined
  if (!account_id) return err('Missing account_id')

  // Verify ownership before deletion
  const { data: account, error: fetchErr } = await adminClient
    .from('google_accounts')
    .select('id')
    .eq('id', account_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (fetchErr) return err('DB error', 500)
  if (!account)  return err('Account not found or not owned by user', 404)

  // Tokens cascade-delete via FK on google_account_tokens.account_id
  const { error: delErr } = await adminClient
    .from('google_accounts')
    .delete()
    .eq('id', account_id)
    .eq('user_id', userId)

  if (delErr) {
    console.error('[google-oauth] delete:', delErr)
    return err('Failed to delete account', 500)
  }

  return ok({ deleted: true, account_id })
}

async function handleRefresh(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const account_id           = body.account_id             as string | undefined
  const email                = body.email                  as string | undefined
  const supabaseRefreshToken = body.supabase_refresh_token as string | undefined

  if (!account_id && !email) return err('Missing account_id or email')

  // Look up tokens (service_role bypasses the NO-SELECT RLS)
  let query = adminClient
    .from('google_account_tokens')
    .select('refresh_token, account_id')
    .eq('user_id', userId)

  let resolvedEmail = email ?? ''

  if (account_id) {
    query = query.eq('account_id', account_id)
  } else {
    // Resolve account_id via email
    const { data: acc } = await adminClient
      .from('google_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('email', email!)
      .maybeSingle()
    if (!acc) {
      // No google_accounts row — try bootstrapping via stored Supabase refresh token
      if (supabaseRefreshToken) {
        const bootstrapped = await tryBootstrapFromSupabaseToken(
          adminClient, userId, resolvedEmail, supabaseRefreshToken,
        )
        if (bootstrapped) return ok(bootstrapped)
      }
      return ok({ error: 'reconnect_required' })
    }
    query = query.eq('account_id', acc.id)
  }

  const { data: tokenRow, error: dbErr } = await query.maybeSingle()

  if (dbErr) return err('DB error', 500)
  if (!tokenRow?.refresh_token) {
    // Row exists but no refresh token — try bootstrapping via stored Supabase refresh token
    if (supabaseRefreshToken) {
      const bootstrapped = await tryBootstrapFromSupabaseToken(
        adminClient, userId, resolvedEmail, supabaseRefreshToken,
      )
      if (bootstrapped) return ok(bootstrapped)
    }
    return ok({ error: 'reconnect_required' })
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('[google-oauth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
    return err('Server misconfiguration', 500)
  }

  // Exchange refresh token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
    }),
  })

  const tokenData = await tokenRes.json() as {
    access_token?: string
    expires_in?:   number
    error?:        string
  }

  if (!tokenRes.ok || !tokenData.access_token) {
    console.warn('[google-oauth] token refresh failed:', tokenData.error)

    if (tokenData.error === 'invalid_grant') {
      // Clear the stale refresh token — user must reconnect
      await adminClient
        .from('google_account_tokens')
        .update({ refresh_token: '' })
        .eq('account_id', tokenRow.account_id)
        .eq('user_id', userId)
    }

    return ok({ error: 'reconnect_required' })
  }

  // Persist the fresh access token + updated expiry
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString()
  await adminClient
    .from('google_account_tokens')
    .update({ access_token: tokenData.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('account_id', tokenRow.account_id)
    .eq('user_id', userId)

  return ok({
    access_token: tokenData.access_token,
    expires_in:   tokenData.expires_in ?? 3600,
  })
}
