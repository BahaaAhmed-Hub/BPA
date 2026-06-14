/**
 * Shared calendar event fetching used by MorningBrief and DayPlanner.
 * Reads cal-intel-cals-cache, respects visibility toggles, and uses
 * tokenManager for extra-account tokens so they never expire silently.
 */
import {
  fetchCalendarEventsWithToken,
  refreshPrimaryToken,
  fetchWeekEvents,
  type GCalEvent,
} from './googleCalendar'
import { loadAccounts, loadHiddenAccounts } from './multiAccount'
import { getGoogleToken, seedToken } from './tokenManager'

interface CachedCal {
  id: string
  summary?: string
  backgroundColor?: string
  accountEmail: string
}

function loadHiddenCals(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('cal-intel-hidden') ?? '[]') as string[]) }
  catch { return new Set() }
}

function loadCalIntelCache(): CachedCal[] {
  try {
    const raw = localStorage.getItem('cal-intel-cals-cache')
    return raw ? (JSON.parse(raw) as CachedCal[]) : []
  } catch { return [] }
}

/**
 * Fetch all visible calendar events for a date range using the same
 * multi-account approach as Cal Intel: fresh tokens per account via
 * tokenManager/Edge Function, hidden cal/account filters respected.
 */
export async function fetchVisibleEvents(start: Date, end: Date): Promise<GCalEvent[]> {
  await refreshPrimaryToken()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  const accounts       = loadAccounts()
  const hiddenCals     = loadHiddenCals()
  const hiddenAccounts = loadHiddenAccounts()
  const cached         = loadCalIntelCache()

  const primaryEmail = accounts.find(a => a.isPrimary)?.email ?? ''

  // Seed tokenManager for extra accounts that still have a fresh stored token
  const now = Date.now()
  for (const a of accounts) {
    if (a.isPrimary || !a.providerToken || !a.providerTokenSavedAt) continue
    if (now - a.providerTokenSavedAt < 50 * 60 * 1000) seedToken(a.email, a.providerToken)
  }

  // Pre-fetch fresh tokens for all extra accounts in parallel
  const extraAccounts = accounts.filter(a => !a.isPrimary)
  const tokenEntries = await Promise.all(
    extraAccounts.map(async a => [a.email, await getGoogleToken(a.email)] as const)
  )
  const extraTokens = Object.fromEntries(tokenEntries.filter(([, t]) => !!t))

  const visible = cached.filter(c => !hiddenCals.has(c.id))

  if (!visible.length) {
    const { events } = await fetchWeekEvents(start, end)
    return events
  }

  const results = await Promise.all(
    visible.map(c => {
      if (c.accountEmail !== primaryEmail) {
        // Extra account — use fresh token from tokenManager
        if (hiddenAccounts.has(c.accountEmail)) return Promise.resolve([] as GCalEvent[])
        const token = extraTokens[c.accountEmail]
        if (!token) return Promise.resolve([] as GCalEvent[])
        const onAuthFail = () =>
          window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email: c.accountEmail } }))
        return fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor, onAuthFail)
      }
      // Primary account
      if (!primaryToken) return Promise.resolve([] as GCalEvent[])
      return fetchCalendarEventsWithToken(primaryToken, c.id, start, end, c.backgroundColor)
    })
  )

  const flat = results.flat()
  if (!flat.length) {
    const { events } = await fetchWeekEvents(start, end)
    return events
  }
  return flat
}
