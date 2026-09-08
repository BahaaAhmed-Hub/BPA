// ─── A calendar invitation is an RSVP, not a message to reply to ─────────────
//
// A Google Calendar invitation arrives as an ordinary email carrying a
// `text/calendar` part with `METHOD:REQUEST` in it. Answering it in prose sends
// the organiser a nice email and tells Google nothing: your name stays in the
// "Awaiting" column, the organiser's headcount is wrong, and the event never
// appears as accepted on your own calendar.
//
// The answer has to go through the Calendar API. The ICS carries a `UID`, which
// is the one identifier shared between the invitation and your own copy of the
// event, so `events.list?iCalUID=` finds it and the attendee row that is `self`
// gets its `responseStatus` set.
//
// Two things this deliberately does not do:
// - **It does not send an iMIP reply.** Google emails the organiser itself when
//   the responseStatus changes, and a second reply from us would be a duplicate
//   with worse headers.
// - **It does not create the event.** If Google has not put the invitation on
//   any of your calendars there is nothing to patch, and the caller says so
//   rather than inventing a copy that the organiser's event does not know about.

import { header, type GmailMessage, type GmailPart, type MailAccount } from '@/lib/gmail'
import {
  findEventByICalUid, patchCalendarEventWithToken, listCalendarsWithToken,
  type GCalEvent,
} from '@/lib/googleCalendar'
import { getGoogleToken } from '@/lib/tokenManager'
import { supabase } from '@/lib/supabase'

export type Rsvp = 'accepted' | 'tentative' | 'declined'

export interface Invite {
  /** The identifier the invitation and your own copy of the event share. */
  uid: string
  summary: string
  /** ISO, or '' for an all-day invitation with only a date. */
  startsAt: string
  endsAt: string
  organizer: string
  /** Where you stand right now, if the message says. */
  responseStatus?: string
  /** A cancellation is not something to RSVP to. */
  cancelled: boolean
}

// ─── Reading the ICS ─────────────────────────────────────────────────────────

/** Every part of a message, depth first — an invitation is usually nested. */
function* parts(p: GmailPart | undefined): Generator<GmailPart> {
  if (!p) return
  yield p
  for (const child of p.parts ?? []) yield* parts(child)
}

function decode(data: string): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  } catch { return '' }
}

/** ICS folds long lines by starting the continuation with a space or a tab. */
function unfold(ics: string): string {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
}

/** The value of a property, ignoring whatever parameters it carries. */
function prop(ics: string, name: string): string {
  const m = new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'im').exec(ics)
  return m ? m[1].trim() : ''
}

/** `20260908T120000Z`, `20260908T120000` or `20260908` → ISO, or ''. */
function icsDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw.trim())
  if (!m) return ''
  const [, y, mo, d, h, mi, sec, z] = m
  if (!h) return `${y}-${mo}-${d}`
  return z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)).toISOString()
    : new Date(+y, +mo - 1, +d, +h, +mi, +sec).toISOString()
}

/**
 * The invitation in a message, or null if it is not one.
 *
 * Only REQUEST and CANCEL are invitations. A REPLY is somebody answering an
 * invitation *you* sent — there is nothing for you to RSVP to there, and
 * offering the buttons would be offering to answer your own meeting.
 */
export function extractInvite(msg: GmailMessage): Invite | null {
  let ics = ''
  for (const p of parts(msg.payload)) {
    const isCal = p.mimeType?.startsWith('text/calendar')
      || /\.ics$/i.test(p.filename ?? '')
    if (isCal && p.body?.data) { ics = decode(p.body.data); break }
  }
  if (!ics) return null

  const body = unfold(ics)
  const method = (prop(body, 'METHOD') || header(msg.payload?.headers ?? [], 'X-Google-Calendar-Method')).toUpperCase()
  if (method !== 'REQUEST' && method !== 'CANCEL') return null

  const uid = prop(body, 'UID')
  if (!uid) return null

  return {
    uid,
    summary: prop(body, 'SUMMARY') || '(no title)',
    startsAt: icsDate(prop(body, 'DTSTART')),
    endsAt: icsDate(prop(body, 'DTEND')),
    organizer: prop(body, 'ORGANIZER').replace(/^mailto:/i, ''),
    cancelled: method === 'CANCEL' || /^STATUS:CANCELLED$/im.test(body),
  }
}

// ─── Answering it ────────────────────────────────────────────────────────────

async function tokenFor(account: MailAccount): Promise<string> {
  if (!account.isPrimary) {
    const t = await getGoogleToken(account.email)
    if (!t) throw new Error(`${account.email} needs reconnecting before its calendar can be used.`)
    return t
  }
  const { data } = await supabase.auth.getSession()
  const t = data.session?.provider_token ?? localStorage.getItem('google_provider_token')
  if (!t) throw new Error('Google is not connected.')
  return t
}

export interface RsvpResult {
  ok: boolean
  /** What to say when it did not work. Never a bare "failed". */
  why?: string
}

/**
 * Set your reply on your own copy of the event.
 *
 * The invitation may have landed on any of the account's calendars — Google
 * puts it on whichever one the address is subscribed as — so this asks the
 * primary first and then the rest, rather than assuming.
 */
export async function respondToInvite(
  invite: Invite, account: MailAccount, response: Rsvp,
): Promise<RsvpResult> {
  let token: string
  try { token = await tokenFor(account) } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : 'Google is not connected.' }
  }

  // Which calendars to look on: the primary, then anything writable.
  let calendarIds = ['primary']
  try {
    const { calendars } = await listCalendarsWithToken(token)
    calendarIds = [
      'primary',
      ...calendars
        .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
        .map(c => c.id)
        .filter(id => id !== 'primary'),
    ]
  } catch { /* the primary alone is the usual case anyway */ }

  let found: { calendarId: string; event: GCalEvent } | null = null
  for (const calendarId of calendarIds) {
    const event = await findEventByICalUid(token, calendarId, invite.uid)
    if (event) { found = { calendarId, event }; break }
  }
  if (!found) {
    return {
      ok: false,
      why: 'This invitation is not on any of your calendars yet, so there is no reply to set. Open it in Google Calendar and answer there.',
    }
  }

  const me = account.email.toLowerCase()
  const attendees = (found.event.attendees ?? []).map(a =>
    a.self || a.email.toLowerCase() === me ? { ...a, responseStatus: response } : a)

  if (!attendees.some(a => a.responseStatus === response && (a.self || a.email.toLowerCase() === me))) {
    return { ok: false, why: `${account.email} is not on the invitation's guest list.` }
  }

  const res = await patchCalendarEventWithToken(token, found.calendarId, found.event.id, { attendees })
  if (!res.ok) return { ok: false, why: res.error ?? 'Google would not record the reply.' }
  return { ok: true }
}

/** How each answer reads on a button, and to a screen reader. */
export const RSVP_LABEL: Record<Rsvp, string> = {
  accepted: 'Yes',
  tentative: 'Maybe',
  declined: 'No',
}
