// ─── What kind of thing is this message ──────────────────────────────────────
//
// One inbox holds six different jobs and they are not interchangeable: a bill
// receipt, a newsletter, a meeting invitation and a colleague waiting on an
// answer all arrive in the same list and each wants something different done
// with it — or nothing at all.
//
// The classes below are chosen so that **every one of them implies a different
// action**. A split that does not change what you would do with the mail is a
// split that only costs you a decision, so "important / not important" is not
// here: it is a judgement, not a kind.
//
// Everything is decided from what the message itself carries — headers, the
// address it came from, who it was addressed to. No model call, so the tabs are
// there the instant the mail is, and they are the same on every device.

import { header, type GmailHeader } from '@/lib/gmail'

export type MailClass =
  /** Addressed to you by a person, and answerable. */
  | 'needs-you'
  /** A calendar invitation. Answered by RSVPing, never by writing back. */
  | 'invitation'
  /** You are on the copy line. Worth reading, not yours to answer. */
  | 'copied'
  /** A campaign or a list. The action is to stop receiving it. */
  | 'newsletter'
  /** Automated but transactional — a receipt, an alert, a build that failed.
   *  Not marketing, and not something you reply to either. */
  | 'notification'
  /** Everything the rules will not commit on. Never empty by design. */
  | 'other'

export interface ClassMeta {
  label: string
  /** What the tab says when it holds nothing, so an empty tab still teaches. */
  empty: string
  /** The one thing most of this class wants. Shown as the bulk action. */
  bulk: 'archive' | 'read' | 'draft' | 'none'
  bulkLabel: string
}

export const CLASSES: MailClass[] = [
  'needs-you', 'invitation', 'copied', 'notification', 'newsletter', 'other',
]

export const CLASS_INFO: Record<MailClass, ClassMeta> = {
  'needs-you':   { label: 'Needs you',    empty: 'Nothing is waiting on an answer from you.', bulk: 'draft',   bulkLabel: 'Draft replies' },
  'invitation':  { label: 'Invitations',  empty: 'No meeting invitations this week.',         bulk: 'none',    bulkLabel: '' },
  'copied':      { label: 'Copied in',    empty: 'You have not been copied on anything.',     bulk: 'read',    bulkLabel: 'Mark all read' },
  'notification':{ label: 'Notifications',empty: 'No receipts or alerts.',                    bulk: 'archive', bulkLabel: 'Archive all' },
  'newsletter':  { label: 'Newsletters',  empty: 'No campaigns waiting.',                     bulk: 'archive', bulkLabel: 'Archive all' },
  'other':       { label: 'Everything else', empty: 'Nothing left over.',                     bulk: 'none',    bulkLabel: '' },
}

// ─── The rules ───────────────────────────────────────────────────────────────

/** Marketing and newsletters, recognised the several ways they announce
 *  themselves. A well-behaved sender sets List-Unsubscribe; plenty do not, so
 *  the sending address, the campaign headers the big platforms stamp on, and an
 *  unsubscribe line in the body all count too. */
const BULK_SENDERS = /^(no[-_.]?reply|donotreply|newsletter|news|mailer|mail|marketing|promo|promotions|offers|deals|campaign|updates|update|notification|notifications|info|hello|hi|team|support|community|digest|alerts?|store|shop|club|members?)[+@._-]/i

const ESP_DOMAINS = /(mailchimp|mcsv|mcdlv|sendgrid|sendinblue|brevo|exponea|klaviyo|hubspot|braze|exacttarget|salesforce|mailgun|sparkpost|iterable|customer\.io|sailthru|campaign-archive|cmail\d|createsend|constantcontact|omnisend|drip|activecampaign|convertkit|substack|beehiiv|mailerlite|amazonses|postmark|mandrill)/i

const BULK_SUBDOMAIN = /^(mail|email|e|em|mailer|mailing|news|newsletter|marketing|campaign|send|sender|smtp|notify|notifications|reply|links?|go|click|track|cta|mktg|crm|info)\./i

/** What a campaign says and a receipt does not. */
const MARKETING_WORDS = /unsubscribe|opt[- ]?out|manage (your )?(email )?preferences|view (this|it) in (your )?browser|إلغاء الاشتراك/i

/** What a receipt, an alert or a build says. Transactional, not a campaign — it
 *  is automated, so there is nobody to reply to, but archiving the lot of them
 *  unread is not right either. */
const TRANSACTIONAL = /\b(receipt|invoice|payment|paid|order|shipped|delivery|statement|verification|verify|confirm(ation)?|password|sign[- ]?in|security alert|two[- ]?factor|otp|booking|reservation|itinerary|ticket|build|deploy(ment)?|pipeline|failed|succeeded|alert|incident|backup|renewal|expiring|expired)\b/i

export interface Classifiable {
  headers: GmailHeader[]
  fromEmail: string
  /** The `To` header, lower-cased. */
  to: string
  cc?: string
  subject: string
  /** As much of the body as is cheap to look at. */
  body: string
  /** The mailbox it arrived in. */
  mailbox: string
  /** Set when the message carries a calendar invitation. */
  isInvitation?: boolean
}

export function looksLikeBulk(headers: GmailHeader[], email: string, body: string): boolean {
  const h = (n: string) => header(headers, n)

  // The headers a list or campaign is supposed to carry
  if (h('List-Unsubscribe') || h('List-Id') || h('List-Post') || h('List-Help')) return true
  if (/\b(bulk|list|junk|marketing)\b/i.test(h('Precedence'))) return true
  if (h('Feedback-ID') || h('X-Campaign-Id') || h('X-Campaignid') || h('X-Mailer-Campaign')) return true
  if (h('X-SES-Outgoing') || h('X-Mailgun-Sid') || h('X-SG-EID') || h('X-Report-Abuse')) return true
  const auto = h('Auto-Submitted')
  if (auto && auto.toLowerCase() !== 'no') return true
  if (/csa_complaint|bulk/i.test(h('X-Complaints-To') + h('X-Mailer'))) return true

  // What the address itself says
  const [local = '', domain = ''] = email.toLowerCase().split('@')
  if (BULK_SENDERS.test(`${local}@`)) return true
  if (ESP_DOMAINS.test(domain)) return true
  if (BULK_SUBDOMAIN.test(domain)) return true

  // And, failing all that, an unsubscribe line in the message
  return MARKETING_WORDS.test(body.slice(0, 4000))
}

/** Where a sender offers a one-click way off the list. */
export function unsubscribeLink(headers: GmailHeader[]): string | null {
  const raw = header(headers, 'List-Unsubscribe')
  if (!raw) return null
  // The header is a list of <…> forms; an https one is the only kind we can open.
  const url = /<(https?:\/\/[^>]+)>/i.exec(raw)?.[1]
  return url ?? null
}

/**
 * The class of one message.
 *
 * Order matters, and it is the order of how strongly each signal binds: an
 * invitation is an invitation whoever sent it, a campaign is a campaign even
 * when it greets you by name, and being addressed only beats being copied.
 */
export function classifyMail(m: Classifiable): MailClass {
  if (m.isInvitation) return 'invitation'

  const bulk = looksLikeBulk(m.headers, m.fromEmail, m.body)
  if (bulk) {
    // A campaign asks you to buy or to read; a receipt tells you something
    // happened. Both are automated, and only one is worth sweeping unread.
    const marketing = MARKETING_WORDS.test(m.body.slice(0, 4000))
      || !!header(m.headers, 'List-Unsubscribe')
    const transactional = TRANSACTIONAL.test(`${m.subject} ${m.body.slice(0, 600)}`)
    if (transactional && !marketing) return 'notification'
    return marketing ? 'newsletter' : 'notification'
  }

  const me = m.mailbox.toLowerCase()
  if (me && m.to.toLowerCase().includes(me)) return 'needs-you'
  if (me && (m.cc ?? '').toLowerCase().includes(me)) return 'copied'

  // Addressed to a list or an alias this mailbox receives: neither addressed
  // nor copied, and not a campaign. It is somebody's mail, just not pointedly
  // yours.
  return 'other'
}

/** How many of each, for the tabs. Always every class, so a tab that empties
 *  does not disappear and move the ones beside it. */
export function countByClass<T>(items: T[], of: (t: T) => MailClass): Record<MailClass, number> {
  const out = Object.fromEntries(CLASSES.map(c => [c, 0])) as Record<MailClass, number>
  for (const i of items) out[of(i)] += 1
  return out
}
