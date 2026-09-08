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

import { fetchAttachment, type GmailMessage, type GmailPart, type MailAccount } from '@/lib/gmail'
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
    // base64url, and Gmail leaves the padding off — atob wants it back.
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
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
/** Anything that could be a calendar, however the sender labelled it. */
function isCalendarPart(p: GmailPart): boolean {
  const t = (p.mimeType ?? '').toLowerCase()
  return t.includes('calendar') || t.includes('/ics') || /\.ics$/i.test(p.filename ?? '')
}

/**
 * Google's own subject prefixes. Used only to tell "this is not an invitation"
 * from "this is one and something went wrong reading it" — never to build an
 * Invite, since a subject carries no UID and there is nothing to answer with.
 */
export function looksLikeInvitation(subject: string): boolean {
  return /^\s*(invitation|updated invitation|invitation with note|cancelled event|canceled event|accepted|declined|tentatively accepted|注意)\s*:/i.test(subject)
}

export type InviteRead =
  | { kind: 'invite'; invite: Invite }
  | { kind: 'not-one' }
  /** It is one, and this is as far as we got. Said on the row rather than hidden. */
  | { kind: 'unreadable'; why: string }

/**
 * Read the invitation out of a thread.
 *
 * Every message, newest first — a thread whose latest message is a reply still
 * carries the invitation further up, and reading only the last one missed it.
 */
export async function readInvite(
  msgs: GmailMessage[], subject: string, account?: MailAccount,
): Promise<InviteRead> {
  for (const msg of [...msgs].reverse()) {
    // Prefer a part we already have the bytes for; an externalised one costs a
    // request, and Gmail externalises whichever copy it likes.
    const cals = [...parts(msg.payload)].filter(isCalendarPart)
    const ordered = [...cals.filter(p => p.body?.data), ...cals.filter(p => !p.body?.data)]

    for (const cal of ordered) {
      let raw = cal.body?.data
      if (!raw && cal.body?.attachmentId) {
        raw = (await fetchAttachment(msg.id, cal.body.attachmentId, account)) ?? undefined
      }
      if (!raw) continue
      const ics = decode(raw)
      if (!ics) continue

      const body = unfold(ics)
      // METHOD is a property of the calendar and also a parameter on the part's
      // own content type; senders set one or the other, and Gmail strips the
      // parameters off mimeType, so the body is usually the only one left.
      const inType = /method=([a-z]+)/i.exec(cal.mimeType ?? '')?.[1] ?? ''
      const method = (prop(body, 'METHOD') || inType).toUpperCase()
      // A REPLY is somebody answering an invitation *you* sent; there is
      // nothing for you to answer there.
      if (method === 'REPLY' || method === 'COUNTER' || method === 'REFRESH') return { kind: 'not-one' }

      const uid = prop(body, 'UID')
      if (!uid) continue

      // No METHOD at all still leaves a VEVENT with a UID, which is enough to
      // answer — some senders omit it, and refusing them helps nobody.
      const cancelled = method === 'CANCEL' || /^STATUS:CANCELLED$/im.test(body)
      return {
        kind: 'invite',
        invite: {
          uid,
          summary: prop(body, 'SUMMARY') || '(no title)',
          startsAt: icsDate(prop(body, 'DTSTART')),
          endsAt: icsDate(prop(body, 'DTEND')),
          organizer: prop(body, 'ORGANIZER').replace(/^mailto:/i, ''),
          cancelled,
        },
      }
    }

    if (cals.length > 0) {
      return { kind: 'unreadable', why: 'Its calendar attachment could not be read.' }
    }
  }

  // Google's subject prefix says it is one even when no part came back — which
  // is worth saying, because a silent fallback to a drafted reply is what sent
  // us round this loop in the first place.
  return looksLikeInvitation(subject)
    ? { kind: 'unreadable', why: 'No calendar attachment came back with this message.' }
    : { kind: 'not-one' }
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

// ─── Remembering what you answered ───────────────────────────────────────────
//
// The reply lives on Google, and asking it costs a request per invitation on
// every load. What the row needs is only "did I answer this, and how", so the
// answer is kept here against the event's UID — which is stable across every
// copy of the invitation and every refresh.

const ANSWERS_KEY = 'cal-invite-answers'
const ANSWER_TTL = 30 * 24 * 60 * 60 * 1000

type Answers = Record<string, { response: Rsvp; at: number }>

function loadAnswers(): Answers {
  try {
    const raw = localStorage.getItem(ANSWERS_KEY)
    const all = raw ? JSON.parse(raw) as Answers : {}
    const cut = Date.now() - ANSWER_TTL
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v?.at > cut))
  } catch { return {} }
}

/** What you answered this invitation, if you have. */
export function answerFor(uid: string): Rsvp | null {
  return loadAnswers()[uid]?.response ?? null
}

export function rememberAnswer(uid: string, response: Rsvp): void {
  try {
    localStorage.setItem(ANSWERS_KEY, JSON.stringify({
      ...loadAnswers(), [uid]: { response, at: Date.now() },
    }))
  } catch { /* quota */ }
}

/** How each answer reads on a button, and to a screen reader. */
export const RSVP_LABEL: Record<Rsvp, string> = {
  accepted: 'Yes',
  tentative: 'Maybe',
  declined: 'No',
}
