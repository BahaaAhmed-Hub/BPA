/**
 * google-calendar-write — Supabase Edge Function
 *
 * Performs write operations against the Google Calendar API on behalf of the user.
 * Tokens are read from google_account_tokens (service_role, never exposed to browser).
 *
 * Actions (POST body: { action, account_id, calendar_id, ...payload }):
 *
 *   create_event   — Creates a new event. Body: { calendar_id, account_id, event: {...} }
 *   update_event   — Patches an existing event. Body: { calendar_id, account_id, event_id, patch: {...} }
 *   delete_event   — Deletes an event. Body: { calendar_id, account_id, event_id }
 *   add_meet       — Adds Google Meet to an existing event (PATCH conferenceDataVersion=1).
 *                    Body: { calendar_id, account_id, event_id }
 *
 * Required secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status: 200,
  })
}
function fail(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let delay = 2000
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 429 && res.status !== 500) return res
    if (attempt === 3) return res
    await sleep(delay)
    delay *= 2
  }
  return fetch(url, init)
}

// ─── Token resolution ─────────────────────────────────────────────────────────

interface TokenRow {
  account_id:    string
  access_token:  string
  refresh_token: string
  expires_at:    string
}

async function resolveToken(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  accountId: string,
): Promise<string | null> {
  const { data: row, error } = await adminClient
    .from('google_account_tokens')
    .select('account_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle() as { data: TokenRow | null; error: unknown }

  if (error || !row) return null

  const expiresAt = new Date(row.expires_at).getTime()
  const margin    = 5 * 60 * 1000

  if (Date.now() + margin < expiresAt) return row.access_token

  // Refresh
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  })
  const data = await res.json() as { access_token?: string; expires_in?: number; error?: string }

  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      await adminClient
        .from('google_account_tokens')
        .update({ refresh_token: '', updated_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('user_id', userId)
    }
    return null
  }

  const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
  await adminClient
    .from('google_account_tokens')
    .update({ access_token: data.access_token, expires_at: newExpiry, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('user_id', userId)

  return data.access_token
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return fail('Missing Authorization header', 401)

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await adminClient.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return fail('Invalid JWT', 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('Invalid JSON body', 400) }

  const action     = body.action      as string | undefined
  const accountId  = body.account_id  as string | undefined
  const calendarId = body.calendar_id as string | undefined

  if (!action)     return fail('Missing action')
  if (!accountId)  return fail('Missing account_id')
  if (!calendarId) return fail('Missing calendar_id')

  // Verify account belongs to user
  const { data: acct } = await adminClient
    .from('google_accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!acct) return fail('Account not found or not owned by user', 403)

  const token = await resolveToken(adminClient, user.id, accountId)
  if (!token) return ok({ error: 'reconnect_required' })

  try {
    switch (action) {
      case 'create_event': return await handleCreate(token, calendarId, body)
      case 'update_event': return await handleUpdate(token, calendarId, body)
      case 'delete_event': return await handleDelete(token, calendarId, body)
      case 'add_meet':     return await handleAddMeet(token, calendarId, body)
      default:             return fail(`Unknown action: ${action}`)
    }
  } catch (e) {
    console.error('[google-calendar-write] unexpected error:', e)
    return fail('Internal server error', 500)
  }
})

// ─── Action handlers ──────────────────────────────────────────────────────────

async function handleCreate(token: string, calendarId: string, body: Record<string, unknown>) {
  const event = body.event as object | undefined
  if (!event) return fail('Missing event')

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  const res = await fetchWithRetry(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(event),
  })

  const data = await res.json()
  if (!res.ok) return fail(data?.error?.message ?? 'Google API error', res.status)
  return ok({ event: data })
}

async function handleUpdate(token: string, calendarId: string, body: Record<string, unknown>) {
  const eventId = body.event_id as string | undefined
  const patch   = body.patch    as object | undefined
  if (!eventId) return fail('Missing event_id')
  if (!patch)   return fail('Missing patch')

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  const res = await fetchWithRetry(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(patch),
  })

  const data = await res.json()
  if (!res.ok) return fail(data?.error?.message ?? 'Google API error', res.status)
  return ok({ event: data })
}

async function handleDelete(token: string, calendarId: string, body: Record<string, unknown>) {
  const eventId = body.event_id as string | undefined
  if (!eventId) return fail('Missing event_id')

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  const res = await fetchWithRetry(url, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 204 || res.status === 200) return ok({ deleted: true })
  if (res.status === 404) return ok({ deleted: true }) // Already gone — treat as success
  const data = await res.json().catch(() => ({}))
  return fail(data?.error?.message ?? 'Google API error', res.status)
}

async function handleAddMeet(token: string, calendarId: string, body: Record<string, unknown>) {
  const eventId = body.event_id as string | undefined
  if (!eventId) return fail('Missing event_id')

  const requestId = crypto.randomUUID()
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`

  const res = await fetchWithRetry(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) return fail(data?.error?.message ?? 'Google API error', res.status)
  return ok({ event: data })
}
