/**
 * google-calendar-sync — Supabase Edge Function
 *
 * Fetches Google Calendar events and calendar list on behalf of the user.
 * All Google API calls happen here — tokens never leave the server.
 *
 * Actions (POST body: { action, ...payload }):
 *
 *   list_calendars  — Returns the user's full calendar list across all connected
 *                     accounts. Calls /users/me/calendarList for each account.
 *                     Response: { calendars: CalendarEntry[] }
 *
 *   list_events     — Returns events across specified calendars for a date range.
 *                     Body: { calendar_ids?: string[], time_min: string, time_max: string }
 *                     If calendar_ids omitted, fetches all calendars.
 *                     Response: { events: EventEntry[] }
 *
 * Rate limiting: 429 from Google → exponential backoff up to 3 retries (2s, 4s, 8s).
 *
 * Token refresh: Uses the google-oauth `refresh` action internally if an
 * access token is expired (checked via expires_at in google_account_tokens).
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountTokenRow {
  account_id:    string
  access_token:  string
  refresh_token: string
  expires_at:    string
}

interface GoogleAccount {
  id:         string
  email:      string
  name?:      string | null
  avatar_url?: string | null
  is_primary: boolean
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

/** Sleep for ms milliseconds. */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Fetch a URL with exponential backoff on 429/500 errors.
 * Max 3 retries with delays 2s, 4s, 8s.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let delay = 2000
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 429 && res.status !== 500) return res
    if (attempt === 3) return res
    console.warn(`[google-calendar-sync] ${res.status} — retrying in ${delay}ms (attempt ${attempt + 1})`)
    await sleep(delay)
    delay *= 2
  }
  // unreachable but satisfies TypeScript
  return fetch(url, init)
}

/**
 * Refreshes a Google access token using the stored refresh token.
 * Updates the token row in the DB. Returns the fresh token, or null on failure.
 */
async function refreshToken(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  row: AccountTokenRow,
): Promise<string | null> {
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
    console.warn('[google-calendar-sync] token refresh failed:', data.error)
    if (data.error === 'invalid_grant') {
      await adminClient
        .from('google_account_tokens')
        .update({ refresh_token: '', updated_at: new Date().toISOString() })
        .eq('account_id', row.account_id)
        .eq('user_id', userId)
    }
    return null
  }

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
  await adminClient
    .from('google_account_tokens')
    .update({ access_token: data.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('account_id', row.account_id)
    .eq('user_id', userId)

  return data.access_token
}

/**
 * Returns a valid access token for the given token row,
 * refreshing automatically if it's within 5 minutes of expiry.
 */
async function getValidToken(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  row: AccountTokenRow,
): Promise<string | null> {
  const expiresAt = new Date(row.expires_at).getTime()
  const now       = Date.now()
  const margin    = 5 * 60 * 1000 // 5 min

  if (now + margin < expiresAt) return row.access_token
  return refreshToken(adminClient, userId, row)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  // Auth
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return fail('Missing Authorization header', 401)

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await adminClient.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return fail('Invalid JWT', 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('Invalid JSON body', 400) }

  const action = body.action as string | undefined
  if (!action) return fail('Missing action')

  try {
    switch (action) {
      case 'list_calendars': return await handleListCalendars(adminClient, user.id)
      case 'list_events':    return await handleListEvents(adminClient, user.id, body)
      default:               return fail(`Unknown action: ${action}`)
    }
  } catch (e) {
    console.error('[google-calendar-sync] unexpected error:', e)
    return fail('Internal server error', 500)
  }
})

// ─── list_calendars ───────────────────────────────────────────────────────────

async function handleListCalendars(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
) {
  // Load all accounts + tokens for this user
  const { data: accounts, error: accErr } = await adminClient
    .from('google_accounts')
    .select('id, email, name, avatar_url, is_primary')
    .eq('user_id', userId)

  if (accErr) return fail('DB error', 500)
  if (!accounts?.length) return ok({ calendars: [] })

  const { data: tokens, error: tokErr } = await adminClient
    .from('google_account_tokens')
    .select('account_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)

  if (tokErr) return fail('DB error', 500)

  const tokenMap = new Map((tokens ?? []).map((t: AccountTokenRow) => [t.account_id, t]))

  const allCalendars: unknown[] = []
  const needsReconnect: string[] = []

  for (const account of accounts as GoogleAccount[]) {
    const tokenRow = tokenMap.get(account.id)
    if (!tokenRow) { needsReconnect.push(account.email); continue }

    const accessToken = await getValidToken(adminClient, userId, tokenRow)
    if (!accessToken) { needsReconnect.push(account.email); continue }

    const res = await fetchWithRetry(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!res.ok) {
      if (res.status === 401) needsReconnect.push(account.email)
      console.warn(`[google-calendar-sync] calendarList ${res.status} for ${account.email}`)
      continue
    }

    const data = await res.json() as { items?: unknown[] }
    for (const cal of data.items ?? []) {
      allCalendars.push({
        ...(cal as object),
        accountEmail:    account.email,
        accountId:       account.id,
        accountName:     account.name,
        accountAvatarUrl: account.avatar_url,
        isPrimaryAccount: account.is_primary,
      })
    }
  }

  return ok({ calendars: allCalendars, needsReconnect })
}

// ─── list_events ──────────────────────────────────────────────────────────────

interface ListEventsBody {
  time_min:     string
  time_max:     string
  calendar_ids?: string[]   // filter to specific calendar IDs; omit = all
}

async function handleListEvents(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const { time_min, time_max, calendar_ids } = body as ListEventsBody
  if (!time_min || !time_max) return fail('Missing time_min or time_max')

  // Load accounts + tokens
  const { data: accounts, error: accErr } = await adminClient
    .from('google_accounts')
    .select('id, email, name, avatar_url, is_primary')
    .eq('user_id', userId)

  if (accErr) return fail('DB error', 500)
  if (!accounts?.length) return ok({ events: [] })

  const { data: tokens, error: tokErr } = await adminClient
    .from('google_account_tokens')
    .select('account_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)

  if (tokErr) return fail('DB error', 500)

  const tokenMap = new Map((tokens ?? []).map((t: AccountTokenRow) => [t.account_id, t]))

  const allEvents: unknown[] = []
  const needsReconnect: string[] = []
  const calendarIdSet = calendar_ids ? new Set(calendar_ids) : null

  for (const account of accounts as GoogleAccount[]) {
    const tokenRow = tokenMap.get(account.id)
    if (!tokenRow) { needsReconnect.push(account.email); continue }

    const accessToken = await getValidToken(adminClient, userId, tokenRow)
    if (!accessToken) { needsReconnect.push(account.email); continue }

    // Determine which calendars to fetch for this account
    let calIds: string[]
    if (calendarIdSet) {
      // Only fetch specified calendars — we don't know which account owns which
      // calendar here, so fetch all specified IDs and let 404s filter naturally
      calIds = [...calendarIdSet]
    } else {
      // Fetch full calendar list first to know all calendar IDs
      const listRes = await fetchWithRetry(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!listRes.ok) {
        if (listRes.status === 401) needsReconnect.push(account.email)
        continue
      }
      const listData = await listRes.json() as { items?: Array<{ id: string }> }
      calIds = (listData.items ?? []).map(c => c.id)
    }

    // Fetch events for each calendar in parallel (max 6 concurrent)
    const chunks: string[][] = []
    for (let i = 0; i < calIds.length; i += 6) chunks.push(calIds.slice(i, i + 6))

    for (const chunk of chunks) {
      const results = await Promise.all(chunk.map(async (calId) => {
        const params = new URLSearchParams({
          timeMin:      time_min,
          timeMax:      time_max,
          singleEvents: 'true',
          orderBy:      'startTime',
          maxResults:   '2500',
        })
        const res = await fetchWithRetry(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        if (!res.ok) {
          console.warn(`[google-calendar-sync] events ${res.status} for ${calId}`)
          return []
        }
        const data = await res.json() as { items?: unknown[] }
        return (data.items ?? []).map(ev => ({
          ...(ev as object),
          calendarId:      calId,
          accountEmail:    account.email,
          accountId:       account.id,
          isPrimaryAccount: account.is_primary,
        }))
      }))

      for (const evList of results) allEvents.push(...evList)
    }
  }

  return ok({ events: allEvents, needsReconnect })
}
