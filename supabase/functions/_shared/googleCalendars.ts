// ─── Every calendar you actually have, not just the one you signed in with ───
//
//  Both bots asked `google_accounts` for `is_primary = true` and then read
//  `calendars/primary/events`. That is two narrowings stacked: the account you
//  signed in with, and *its own default calendar*. A company calendar — Teradix,
//  DX — lives on a connected account, so neither bot could ever see one. Nor
//  could they see a second calendar on the primary account.
//
//  This is the one place that answers "which calendars are mine", for the
//  Telegram bot and for Siri alike, and it answers it the way the app does:
//  every connected account, every calendar on it, minus the ones you have
//  hidden in `google_calendar_settings`.
//
//  Two rules it keeps:
//  - **One account failing is not all of them failing.** A connected account
//    whose refresh token has expired is skipped and *named*, and the rest still
//    answer. Returning nothing because the third account is stale would read as
//    an empty diary.
//  - **An event id is only unique within its calendar.** Reads hand back
//    `eventId::calendarId` so an edit knows where to go; a bare id is still
//    accepted and looked up across the calendars, because a model repeating an
//    id back is not a reliable narrow channel.

export interface GAccount {
  id: string
  email: string
  isPrimary: boolean
}

export interface GCalendar {
  accountId: string
  accountEmail: string
  calendarId: string
  /** What to call it on screen — your rename, else Google's summary. */
  name: string
  /** Google's own "this is the account's default calendar". */
  primary: boolean
  writable: boolean
}

export interface GEvent {
  /** `eventId::calendarId` — what a later edit needs. */
  ref: string
  id: string
  calendarId: string
  calendarName: string
  accountEmail: string
  summary: string
  start: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
}

interface SbLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        eq(col: string, val: unknown): { maybeSingle(): Promise<{ data: unknown }> }
        in(col: string, vals: unknown[]): Promise<{ data: unknown }>
        maybeSingle(): Promise<{ data: unknown }>
        then: Promise<{ data: unknown }>['then']
      }
    }
  }
}

const CAL_API = 'https://www.googleapis.com/calendar/v3'

/** At most this many calendars are read for one question. A diary spread over
 *  more than this is a different feature, not a chat reply. */
const MAX_CALENDARS = 12

export class CalendarHub {
  #sb: SbLike
  #userId: string
  #clientId: string
  #clientSecret: string
  #tokens = new Map<string, string | null>()
  #accounts: GAccount[] | null = null
  #calendars: GCalendar[] | null = null
  /** Accounts that could not be refreshed, by address — said out loud rather
   *  than silently narrowing the answer. */
  readonly unreachable: string[] = []

  constructor(sb: unknown, userId: string, clientId: string, clientSecret: string) {
    this.#sb = sb as SbLike
    this.#userId = userId
    this.#clientId = clientId
    this.#clientSecret = clientSecret
  }

  get configured(): boolean { return !!this.#clientId && !!this.#clientSecret }

  async accounts(): Promise<GAccount[]> {
    if (this.#accounts) return this.#accounts
    // deno-lint-ignore no-explicit-any
    const { data } = await (this.#sb as any)
      .from('google_accounts').select('id, email, is_primary')
      .eq('user_id', this.#userId)
    const rows = (data ?? []) as { id: string; email: string; is_primary: boolean }[]
    // The signed-in account first — it is the one a bare "my calendar" means.
    this.#accounts = rows
      .map(r => ({ id: r.id, email: r.email, isPrimary: !!r.is_primary }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    return this.#accounts
  }

  async token(accountId: string): Promise<string | null> {
    if (this.#tokens.has(accountId)) return this.#tokens.get(accountId)!
    let token: string | null = null
    try {
      // deno-lint-ignore no-explicit-any
      const { data } = await (this.#sb as any)
        .from('google_account_tokens').select('refresh_token')
        .eq('account_id', accountId).maybeSingle()
      const refresh = (data as { refresh_token?: string } | null)?.refresh_token
      if (refresh) {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.#clientId,
            client_secret: this.#clientSecret,
            refresh_token: refresh,
          }),
        })
        const td = await res.json() as { access_token?: string }
        token = td.access_token ?? null
      }
    } catch { token = null }
    this.#tokens.set(accountId, token)
    return token
  }

  /** Every calendar on every account, minus the ones hidden in Settings. */
  async calendars(): Promise<GCalendar[]> {
    if (this.#calendars) return this.#calendars

    const accounts = await this.accounts()
    const hidden = new Set<string>()
    const renamed = new Map<string, string>()
    try {
      // deno-lint-ignore no-explicit-any
      const { data } = await (this.#sb as any)
        .from('google_calendar_settings').select('calendar_id, is_visible, display_name')
        .eq('user_id', this.#userId)
      for (const r of (data ?? []) as { calendar_id: string; is_visible: boolean; display_name: string | null }[]) {
        if (r.is_visible === false) hidden.add(r.calendar_id)
        if (r.display_name) renamed.set(r.calendar_id, r.display_name)
      }
    } catch { /* no settings table is not a reason to show nothing */ }

    const out: GCalendar[] = []
    for (const acc of accounts) {
      const token = await this.token(acc.id)
      if (!token) { this.unreachable.push(acc.email); continue }
      try {
        const res = await fetch(
          `${CAL_API}/users/me/calendarList?minAccessRole=reader&maxResults=50`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) { this.unreachable.push(acc.email); continue }
        const body = await res.json() as {
          items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[]
        }
        for (const c of body.items ?? []) {
          if (hidden.has(c.id)) continue
          // 'reader' and 'freeBusyReader' are calendars other people shared with
          // you as read-only. Skip them.
          if (c.accessRole !== 'owner' && c.accessRole !== 'writer') continue
          // A calendar whose id looks like someone else's email address is their
          // calendar, shared with you — Google Workspace lets colleagues share
          // with 'writer' access too, so accessRole alone is not enough.
          // Safe keeps: the account's own primary (c.primary === true), calendars
          // you created (id ends with calendar.google.com), or the account's own
          // email as the id (the primary calendar's canonical form).
          // Never skip the primary flag even if the email comparison fails.
          const id = c.id.toLowerCase()
          const isOtherPersonsCalendar =
            !c.primary &&
            id.includes('@') &&
            !id.endsWith('calendar.google.com') &&
            id !== acc.email.toLowerCase()
          if (isOtherPersonsCalendar) continue
          out.push({
            accountId: acc.id,
            accountEmail: acc.email,
            calendarId: c.id,
            name: renamed.get(c.id) ?? c.summaryOverride ?? c.summary ?? c.id,
            primary: !!c.primary,
            writable: c.accessRole === 'owner' || c.accessRole === 'writer',
          })
        }
      } catch { this.unreachable.push(acc.email) }
    }
    this.#calendars = out.slice(0, MAX_CALENDARS)
    return this.#calendars
  }

  /** Events across every visible calendar, merged and in time order. */
  async events(opts: { timeMin: string; timeMax: string; perCalendar?: number }): Promise<GEvent[]> {
    const cals = await this.calendars()
    const per = opts.perCalendar ?? 20

    const batches = await Promise.all(cals.map(async cal => {
      const token = await this.token(cal.accountId)
      if (!token) return [] as GEvent[]
      try {
        const res = await fetch(
          `${CAL_API}/calendars/${encodeURIComponent(cal.calendarId)}/events?` +
          new URLSearchParams({
            timeMin: opts.timeMin, timeMax: opts.timeMax,
            singleEvents: 'true', orderBy: 'startTime', maxResults: String(per),
          }),
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return [] as GEvent[]
        const body = await res.json() as {
          items?: {
            id?: string; summary?: string; location?: string; status?: string
            start?: { dateTime?: string; date?: string }
            end?: { dateTime?: string; date?: string }
          }[]
        }
        return (body.items ?? [])
          .filter(e => e.id && e.status !== 'cancelled')
          .map(e => ({
            ref: `${e.id}::${cal.calendarId}`,
            id: e.id!,
            calendarId: cal.calendarId,
            calendarName: cal.name,
            accountEmail: cal.accountEmail,
            summary: e.summary ?? 'Untitled',
            start: e.start ?? {},
            end: e.end,
            location: e.location,
          }))
      } catch { return [] as GEvent[] }
    }))

    const all = batches.flat()
    all.sort((a, b) => startKey(a.start).localeCompare(startKey(b.start)))
    return all
  }

  /**
   * Resolve a reference an edit was handed back.
   *
   * `eventId::calendarId` is exact. A bare id is searched for across the
   * calendars, because what comes back through a model is not a channel to
   * trust with an exact string.
   */
  async locate(ref: string): Promise<{ calendar: GCalendar; token: string; eventId: string } | null> {
    const cals = await this.calendars()
    const [rawId, rawCal] = ref.includes('::') ? ref.split('::') : [ref, '']
    const eventId = rawId.trim()
    if (!eventId) return null

    const ordered = rawCal
      ? [...cals.filter(c => c.calendarId === rawCal), ...cals.filter(c => c.calendarId !== rawCal)]
      : [...cals].sort((a, b) => Number(b.primary) - Number(a.primary))

    for (const cal of ordered) {
      const token = await this.token(cal.accountId)
      if (!token) continue
      const res = await fetch(
        `${CAL_API}/calendars/${encodeURIComponent(cal.calendarId)}/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) return { calendar: cal, token, eventId }
    }
    return null
  }

  /** The calendar a new event should land on. A name is matched loosely —
   *  "teradix" finds "Teradix Ltd" — because that is how people say it. */
  async pickWritable(name?: string): Promise<GCalendar | null> {
    const cals = (await this.calendars()).filter(c => c.writable)
    if (!cals.length) return null
    if (name?.trim()) {
      const q = name.trim().toLowerCase()
      const hit =
        cals.find(c => c.name.toLowerCase() === q) ??
        cals.find(c => c.name.toLowerCase().includes(q)) ??
        cals.find(c => c.accountEmail.toLowerCase().includes(q))
      if (hit) return hit
    }
    return cals.find(c => c.primary) ?? cals[0]
  }
}

function startKey(s: { dateTime?: string; date?: string }): string {
  return s.dateTime ?? (s.date ? `${s.date}T00:00` : '9999')
}

const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** The event's own wall clock, read straight off the ISO string — converting
 *  through `Date` would re-read it in the server's zone, which is never yours. */
export function formatWhen(start: { dateTime?: string; date?: string }): string {
  if (start.dateTime) {
    const m = start.dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    if (!m) return start.dateTime
    const [, yr, mo, dy, hh, mm] = m
    const dow = DAYS[new Date(Date.UTC(+yr, +mo - 1, +dy)).getUTCDay()]
    return `${dow} ${+dy} ${MONTHS[+mo - 1]}, ${hh}:${mm}`
  }
  if (start.date) {
    const [yr, mo, dy] = start.date.split('-')
    const dow = DAYS[new Date(Date.UTC(+yr, +mo - 1, +dy)).getUTCDay()]
    return `${dow} ${+dy} ${MONTHS[+mo - 1]} · all day`
  }
  return ''
}

/** One event as a line. The calendar is named only when there is more than one
 *  in play — on a single-calendar account it is the same word on every row. */
export function eventLine(e: GEvent, showCalendar: boolean): string {
  const where = showCalendar ? ` · ${e.calendarName}` : ''
  const loc = e.location ? ` @ ${e.location}` : ''
  return `[id:${e.ref}] ${e.summary} — ${formatWhen(e.start)}${where}${loc}`
}
