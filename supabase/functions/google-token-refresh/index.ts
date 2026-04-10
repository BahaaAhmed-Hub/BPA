/**
 * google-token-refresh — Supabase Edge Function
 *
 * Exchanges a stored Google OAuth refresh token for a fresh access token.
 * This is the server-side half of the Cal Intel token management revamp:
 * the client never holds Google refresh tokens; this function holds them
 * in the connected_google_accounts table and exchanges them on demand.
 *
 * Required Supabase secrets (set via `supabase secrets set`):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *
 * Auto-injected by Supabase:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID         = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET     = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // ── 1. Validate caller via Supabase JWT ───────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return err('Missing Authorization header', 401)

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: { user }, error: authErr } =
      await adminClient.auth.getUser(authHeader.slice(7))

    if (authErr || !user) return err('Invalid JWT', 401)

    // ── 2. Parse request body ─────────────────────────────────────────────────
    let body: { email?: string }
    try { body = await req.json() } catch { return err('Invalid JSON body', 400) }

    const { email } = body
    if (!email) return err('Missing email', 400)

    // ── 3. Look up the stored Google refresh token ────────────────────────────
    const { data: account, error: dbErr } = await adminClient
      .from('connected_google_accounts')
      .select('google_refresh_token')
      .eq('user_id', user.id)
      .eq('email', email)
      .maybeSingle()

    if (dbErr) return err('DB error', 500)

    if (!account?.google_refresh_token) {
      // Account not in DB yet or refresh token was never saved (pre-revamp account).
      // Signal the client to reconnect so the refresh token gets stored this time.
      return ok({ error: 'reconnect_required' })
    }

    // ── 4. Validate secrets are configured ────────────────────────────────────
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error('[google-token-refresh] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
      return err('Server misconfiguration — contact admin', 500)
    }

    // ── 5. Exchange refresh token for a fresh Google access token ─────────────
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: account.google_refresh_token,
      }),
    })

    const tokenData = await tokenRes.json() as {
      access_token?: string
      expires_in?:   number
      error?:        string
      error_description?: string
    }

    // invalid_grant = refresh token revoked or expired → user must reconnect
    if (!tokenRes.ok || !tokenData.access_token) {
      const isRevoked = tokenData.error === 'invalid_grant'
      console.warn('[google-token-refresh] token exchange failed:', tokenData.error)

      if (isRevoked) {
        // Clean up the stale row so reconnect stores a fresh one
        await adminClient
          .from('connected_google_accounts')
          .update({ google_refresh_token: null })
          .eq('user_id', user.id)
          .eq('email', email)
      }

      return ok({ error: 'reconnect_required' })
    }

    // ── 6. Return the fresh access token ─────────────────────────────────────
    return ok({
      access_token: tokenData.access_token,
      expires_in:   tokenData.expires_in ?? 3600,
    })

  } catch (e) {
    console.error('[google-token-refresh] unexpected error:', e)
    return err('Internal server error', 500)
  }
})

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status: 200,
  })
}
function err(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}
