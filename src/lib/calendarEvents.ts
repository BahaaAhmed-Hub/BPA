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

export interface CachedCal {
  id: string
  summary?: string
  backgroundColor?: string
  accountEmail: string
  /** The account's own main calendar. Exactly one per account. */
  primary?: boolean
  /** `owner` | `writer` | `reader` | `freeBusyReader`. */
  accessRole?: string
}

// ─── Whose calendar is it ────────────────────────────────────────────────────
//
// `CalendarIntelligence` has always cached `primary` and `accessRole`; this
// file declared its own narrower `CachedCal` without them and threw both away,
// so everything downstream — the planner included — could not tell **your own
// main calendar from a colleague's**. The data was there; the reader dropped it.
//
// A person has one main calendar per account, and inside each account may be
// given other people's. Those are not yours and do not belong in "my
// calendars", however much access you were granted on them.

/**
 * Is this calendar mine?
 *
 * **`accessRole: 'owner'` is not a test for this.** Sharing a calendar with
 * *"Make changes and manage sharing"* grants `owner` on somebody else's
 * calendar, so the role says what you may do and nothing about whose it is.
 * The **id** is what separates them: a person's calendar is their address.
 *
 *  - `primary` → the main calendar of whichever account it came from. Mine.
 *  - an id that is a person's address → theirs, unless that address is one of
 *    my own accounts.
 *  - a generated `…@group.calendar.google.com` id → a secondary calendar, mine
 *    only if I own it.
 *
 * The one case Google cannot answer: a team calendar *I* created is `owner` on
 * a generated id, identical to a personal one — there is no creator field on a
 * calendar. It counts as mine, which is the better default, and hiding it
 * (`cal-intel-hidden`) is the way out for the few that should not be.
 */
export function isMyCalendar(cal: Pick<CachedCal, 'id' | 'primary' | 'accessRole'>, myAddresses: Set<string>): boolean {
  if (cal.primary) return true
  const id = (cal.id ?? '').toLowerCase()
  if (id.includes('@') && !id.endsWith('@group.calendar.google.com')) return myAddresses.has(id)
  return cal.accessRole === 'owner'
}

/** Every address that is mine: the one signed in, plus every connected account. */
export function myCalendarAddresses(signedInEmail?: string): Set<string> {
  const set = new Set<string>()
  if (signedInEmail) set.add(signedInEmail.toLowerCase())
  for (const a of loadAccounts()) if (a.email) set.add(a.email.toLowerCase())
  return set
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
export async function fetchVisibleEvents(
  start: Date,
  end: Date,
  opts: {
    /** Only the calendars that are mine — see `isMyCalendar`. */
    onlyMine?: boolean
    /** Who I am. Without it only the connected accounts are known. */
    signedInEmail?: string
  } = {},
): Promise<GCalEvent[]> {
  await refreshPrimaryToken()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  const accounts       = loadAccounts()
  const hiddenCals     = loadHiddenCals()
  const hiddenAccounts = loadHiddenAccounts()
  const cached         = loadCalIntelCache()

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

  const extraEmails = new Set(extraAccounts.map(a => a.email))

  const mine    = myCalendarAddresses(opts.signedInEmail)
  const visible = cached
    .filter(c => !hiddenCals.has(c.id))
    .filter(c => !opts.onlyMine || isMyCalendar(c, mine))

  if (!visible.length) {
    // **The fallback is already narrower than the filter.** `fetchWeekEvents`
    // asks for `primary` and nothing else — the signed-in account's own main
    // calendar, which is mine by definition — so it can never hand back a
    // colleague's. Refusing it under `onlyMine`, as this briefly did, left an
    // empty grid for anybody whose calendar cache has not been built yet:
    // the filter would have been the thing that emptied the day.
    const { events } = await fetchWeekEvents(start, end)
    return events
  }

  const results = await Promise.all(
    visible.map(c => {
      // Treat as extra account only if its email is explicitly one of the extra accounts
      if (c.accountEmail && extraEmails.has(c.accountEmail)) {
        if (hiddenAccounts.has(c.accountEmail)) return Promise.resolve([] as GCalEvent[])
        const token = extraTokens[c.accountEmail]
        if (!token) return Promise.resolve([] as GCalEvent[])
        const onAuthFail = () =>
          window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email: c.accountEmail } }))
        return fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor, onAuthFail)
      }
      // Primary account (email matches primary, is empty, or not in extra accounts)
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
