/**
 * Shared calendar event fetching used by CalendarIntelligence and MorningBrief.
 * Reads cal-intel-cals-cache, respects visibility toggles, refreshes tokens.
 */
import {
  fetchCalendarEventsWithToken,
  refreshPrimaryToken,
  type GCalEvent,
} from './googleCalendar'
import { loadAccounts, silentRefreshAccountToken, loadHiddenAccounts } from './multiAccount'

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
    const accounts = loadAccounts()
    return cached.map(c => {
      const acct = accounts.find(a => a.email === c.accountEmail)
      const token = (acct && !acct.isPrimary) ? acct.providerToken : primaryToken
      return { ...c, accountToken: token, accountId: acct?.id }
    })
  } catch { return [] }
}

/**
 * Fetch all visible calendar events for a time range.
 * Respects cal-intel-hidden (per-calendar eye) and cal-intel-hidden-accounts.
 * Silently refreshes stale tokens. Falls back to primary 'primary' calendar
 * via withAuth if cache is empty or returns nothing.
 */
export async function fetchVisibleEvents(start: Date, end: Date): Promise<GCalEvent[]> {
  // Always refresh the primary token first
  await refreshPrimaryToken()

  const hiddenCals     = loadHiddenCals()
  const hiddenAccounts = loadHiddenAccounts()
  const allCals        = buildCalendarsFromCache()

  const visible = allCals.filter(
    c => !hiddenCals.has(c.id) && !hiddenAccounts.has(c.accountEmail)
  )

  if (visible.length === 0) {
    // No cache yet — fall back to primary calendar via withAuth
    const { fetchWeekEvents } = await import('./googleCalendar')
    const { events } = await fetchWeekEvents(start, end)
    return events
  }

  const tokenCache = new Map<string, string>() // accountId → refreshed token

  const results = await Promise.all(
    visible.map(async c => {
      let token = c.accountToken
      if (!token) return [] as GCalEvent[]

      if (c.accountId) {
        const cached = tokenCache.get(c.accountId)
        if (cached) token = cached
      }

      let events = await fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor)

      // Stale extra-account token — refresh once per account per fetch pass
      if (events.length === 0 && c.accountId && !tokenCache.has(c.accountId)) {
        const accounts = loadAccounts()
        const account  = accounts.find(a => a.id === c.accountId)
        if (account) {
          const fresh = await silentRefreshAccountToken(account)
          if (fresh) {
            tokenCache.set(c.accountId, fresh)
            events = await fetchCalendarEventsWithToken(fresh, c.id, start, end, c.backgroundColor)
          }
        }
      }

      return events
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
