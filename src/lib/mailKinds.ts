// ─── What kind of thing is this thread ───────────────────────────────────────
//
//  "Needs your attention" was doing too much work. A renewal waiting on your
//  answer, a meeting invitation, a sign-in alert and a cloud status update all
//  arrived in the same list with the same three buttons under them — and only
//  one of those four wants a reply. Offering to draft one for a login
//  notification is how a list teaches you to stop reading it.
//
//  So each thread carries a kind, and the kind decides what the row offers:
//
//    invitation  → Yes / Maybe / No. Answering in prose tells Google nothing,
//                  which is a mistake this app already learnt once.
//    cancelled   → it was called off. Nothing to answer; acknowledge it.
//    security    → a sign-in or a code. Kept, because you want to see it, but
//                  it is never an action — you acknowledge and move on.
//    update      → a status page, a deploy, a cloud notice. Information.
//    reply       → an actual person writing to you. This one gets the draft.
//
//  Everything here is decided from headers and the subject line. No model call,
//  so a row knows what it is the instant it is drawn.

import { headerOf, type NeutralMessage } from '@/lib/mailProvider'

export type MailKind = 'invitation' | 'cancelled' | 'security' | 'update' | 'reply'

/** Google's own subject prefixes, and the ones other calendars use. */
const INVITE_SUBJECT = /^\s*(invitation|updated invitation|invited you|invite)\s*[:,]/i
//  `[Cancelled] …` and `Postponed: …` count: plenty of organisers rename the
//  event and send an update rather than cancelling, and the row that offers
//  Yes / Maybe / No for a meeting its own subject says is off is the row that
//  taught this app the lesson once already.
const OFF = '(?:cancell?ed|canceled|postponed)'
const CANCEL_SUBJECT = new RegExp(`^\\s*(?:[[(]\\s*${OFF}\\s*[\\])]|${OFF}\\s*[-–—:,])`, 'i')
/** A reply to an invitation — somebody answering yours. Not an invitation. */
const RSVP_SUBJECT  = /^\s*(accepted|declined|tentative|maybe)\s*[:,]/i

function calendarMethod(m: NeutralMessage): string {
  // The method rides on the part's content type as a parameter. Providers
  // differ on whether they keep it, so the absence of one is not evidence.
  const ct = headerOf(m.headers, 'Content-Type')
  return (/method\s*=\s*"?([a-z]+)"?/i.exec(ct)?.[1] ?? '').toUpperCase()
}

function hasCalendarPart(m: NeutralMessage): boolean {
  return /text\/calendar/i.test(headerOf(m.headers, 'Content-Type'))
}

/** A sign-in, a code, a password change — the things you want to see and can
 *  do nothing about except notice. Matched on the sender and the subject
 *  together where possible: "security" in a subject from a colleague is a
 *  conversation, not an alert. */
const SECURITY_SUBJECT =
  /\b(sign[- ]?in|signin|log[- ]?in|login|security alert|new device|verification code|verify your|one[- ]time (code|password)|2fa|two[- ]factor|password (was )?(changed|reset)|suspicious|unusual activity)\b/i
const SECURITY_SENDER =
  /^(no-?reply|do-?not-?reply|security|account|accounts|alerts?|notifications?|auth|identity)@/i

/** Automated but informational: a build, a deploy, a status page, a usage
 *  report, a receipt. Not marketing — `classifyMail` already removes that —
 *  and not something anybody is waiting on you for. */
const UPDATE_SUBJECT =
  /\b(status update|incident|maintenance|scheduled maintenance|deploy(ed|ment)?|build (passed|failed|succeeded)|backup|usage report|weekly (summary|report|digest)|invoice|receipt|payment (received|confirmation)|your .* is ready|has been (updated|completed))\b/i

export interface KindInput {
  /** The newest message that is not yours. */
  newest: NeutralMessage
  subject: string
  fromEmail: string
  /** Set where the caller has already read the calendar part properly — the
   *  header alone cannot always tell a request from a cancellation. */
  calendarMethod?: string
  /** The event's own title says it is off, which plenty of organisers do
   *  instead of cancelling. */
  titleCancelled?: boolean
}

export function kindOf(input: KindInput): MailKind {
  const { newest, subject, fromEmail } = input
  const method = (input.calendarMethod ?? calendarMethod(newest)).toUpperCase()
  const cal = hasCalendarPart(newest)

  // ── Anything to do with a calendar, in the order the answers differ ───────
  if (method === 'CANCEL' || input.titleCancelled || CANCEL_SUBJECT.test(subject)) {
    if (cal || CANCEL_SUBJECT.test(subject) || input.titleCancelled) return 'cancelled'
  }
  // Somebody answering an invitation *you* sent is news, not a thing to RSVP to.
  if (method === 'REPLY' || RSVP_SUBJECT.test(subject)) return 'update'
  if (method === 'REQUEST' || (cal && !method) || INVITE_SUBJECT.test(subject)) return 'invitation'

  // ── The rest ─────────────────────────────────────────────────────────────
  const automated = SECURITY_SENDER.test(fromEmail)
  if (SECURITY_SUBJECT.test(subject) && (automated || /@(google|microsoft|apple|github|slack|atlassian|okta)\./i.test(fromEmail))) {
    return 'security'
  }
  if (automated && (UPDATE_SUBJECT.test(subject) || SECURITY_SUBJECT.test(subject))) return 'update'
  if (UPDATE_SUBJECT.test(subject) && automated) return 'update'

  return 'reply'
}

/** What the row says it wants, for a thread with no model sentence yet. */
export const KIND_NEED: Record<MailKind, string> = {
  invitation: 'Answer the invitation',
  cancelled:  'Called off — nothing to answer',
  security:   'A sign-in or security notice',
  update:     'Information only',
  reply:      '',
}

/** Whether a kind can ever be something you owe an answer to. A sign-in alert
 *  in the action list is the list being wrong, however it was addressed. */
export function canNeedAction(kind: MailKind): boolean {
  return kind === 'reply' || kind === 'invitation'
}
