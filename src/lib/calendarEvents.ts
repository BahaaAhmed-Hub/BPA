/**
 * Shared calendar event fetching used by MorningBrief and DayPlanner.
 * Reads cal-intel-cals-cache, respects visibility toggles, and uses
 * tokenManager for extra-account tokens so they never expire silently.
 */
import {
  fetchCalendarEventsWithToken,
  refreshPrimaryToken,
  type GCalEvent,
} from './googleCalendar'
import { loadHiddenAccounts } from './multiAccount'
import { getGoogleToken, seedToken } from './tokenManager'

interface CachedCal {
  id: string
  summary?: string
  backgroundColor?: string
  accountEmail: string
}

interface CalWithToken extends CachedCal {
  accountToken: string
  accountId?: string
}

function loadHiddenCals(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('cal-intel-hidden') ?? '[]') as string[]) }
  catch { return new Set() }
}

function buildCalendarsFromCache(): CalWithToken[] {
  try {
    const raw = localStorage.getItem('cal-intel-cals-cache')
    if (!raw) return []
    const cached = JSON.parse(raw) as CachedCal[]
    const primaryToken = localStorage.getItem('google_provider_token') ?? ''
    // Parse accounts only for seeding tokenManager — tokens for events come from
    // getGoogleToken() which uses the Edge Function for extra accounts.
    const accounts: Array<{
      email: string; providerToken?: string; providerTokenSavedAt?: number; isPrimary?: boolean; id?: string
    }> = (() => {
      try { return JSON.parse(localStorage.getItem('professor-connected-accounts') ?? '[]') } catch { return [] }
    })()
    return cached.map(c => {
      // Only match non-primary accounts — primary cals must NOT get an accountId
      // or fetchVisibleEvents will route them through the Edge Function path instead of GoTrue.
      const acct = accounts.find(a => a.email === c.accountEmail && !a.isPrimary)
      const token = acct ? (acct.providerToken ?? '') : primaryToken
      return { ...c, accountToken: token, accountId: acct?.id }
    })
  } catch { return [] }
}

/**
 * Fetch all visible calendar events for a time range.
 * Respects cal-intel-hidden (per-calendar eye) and cal-intel-hidden-accounts.
 * Uses tokenManager for extra accounts — no more silent 60-min expiry.
 * Falls back to primary 'primary' calendar via withAuth if cache is empty.
 */
export async function fetchVisibleEvents(start: Date, end: Date): Promise<GCalEvent[]> {
  // Refresh primary token (GoTrue path — reliable for primary account)
  await refreshPrimaryToken()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  const hiddenCals     = loadHiddenCals()
  const hiddenAccounts = loadHiddenAccounts()
  const allCals        = buildCalendarsFromCache()

  // hiddenAccounts applies only to extra accounts (accountId set) — primary is never hidden
  const visible = allCals.filter(
    c => !hiddenCals.has(c.id) && (!c.accountId || !hiddenAccounts.has(c.accountEmail))
  )

  if (visible.length === 0) {
    const { fetchWeekEvents } = await import('./googleCalendar')
    const { events } = await fetchWeekEvents(start, end)
    return events
  }

  // Seed tokenManager from localStorage for extra accounts that are still fresh
  const accounts: Array<{
    email: string; providerToken?: string; providerTokenSavedAt?: number; isPrimary?: boolean
  }> = (() => {
    try { return JSON.parse(localStorage.getItem('professor-connected-accounts') ?? '[]') } catch { return [] }
  })()
  const now = Date.now()
  for (const a of accounts) {
    if (a.isPrimary || !a.providerToken || !a.providerTokenSavedAt) continue
    if (now - a.providerTokenSavedAt < 50 * 60 * 1000) {
      seedToken(a.email, a.providerToken)
    }
  }

  const results = await Promise.all(
    visible.map(async c => {
      if (c.accountId) {
        // Extra account — dispatch reconnect if the token silently fails (401/403)
        const email = c.accountEmail
        const onAuthFail = () =>
          window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email } }))
        const token = await getGoogleToken(email)
        if (!token) return [] as GCalEvent[]
        return fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor, onAuthFail)
      }
      // Primary account — GoTrue path
      const token = primaryToken || c.accountToken
      if (!token) return [] as GCalEvent[]
      return fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor)
    })
  )

  const flat = results.flat()

  // If cache existed but all fetches returned empty, fall back to primary via withAuth
  if (flat.length === 0) {
    const { fetchWeekEvents } = await import('./googleCalendar')
    const { events } = await fetchWeekEvents(start, end)
    return events
  }

  return flat
}
