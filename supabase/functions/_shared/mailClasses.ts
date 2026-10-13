// ─── What kind of thing is this message — the nightly run's copy ─────────────
//
// `src/lib/mailClasses.ts` is the original and this is its twin, because Deno
// cannot import the app's bundle. Only the classification is here: the tab
// metadata (`CLASSES`, `CLASS_INFO`, `countByClass`) and `unsubscribeLink` are
// about a screen, and there is no screen on this side.
//
// **It is here because the nightly run had its own answer to this question and
// the two drifted.** `mailRules.looksCampaign` was a regex over the sender's
// local part — `team@`, `support@`, `info@` among them — and it decided, on
// its own, whether a thread was *kept at all*. The browser asks something
// narrower and in two steps: a **newsletter** goes, and a **notification**
// goes only where the thread's kind gives the row nothing to offer. So a
// support ticket you were in the middle of, and a message from `team@` that
// addressed you by name, were kept by the app at 9am and discarded by the
// nightly pass at 3am — one thread, two answers, and nothing on screen to say
// which had run. `scripts/mail-rules-agree.mjs` is what reported it.
//
// Everything is decided from what the message itself carries — headers, the
// address it came from, who it was addressed to. No model call.

// `mailRules.ts` imports this file back. The cycle is safe and deliberate:
// both sides use the other only through hoisted `function` declarations, at
// call time rather than at module init — and one `headerOf` is better than a
// second copy of a three-line lookup.
import { headerOf, type MailHeader } from './mailRules.ts'

export type MailClass =
  | 'needs-you'
  | 'invitation'
  | 'copied'
  | 'notification'
  | 'newsletter'
  | 'other'

/** A bulk-sender local part — the address itself says "I am a list". Note this
 *  only makes a message *bulk*; `classifyMail` then decides whether that is a
 *  newsletter or a transactional notification, and `keepThread` reads the
 *  difference. A local part alone has never been grounds for throwing a thread
 *  away. */
const BULK_SENDERS = /^(no[-_.]?reply|donotreply|newsletter|news|mailer|mail|marketing|promo|promotions|offers|deals|campaign|updates|update|notification|notifications|info|hello|hi|team|support|community|digest|alerts?|store|shop|club|members?|stories|edition|picks|roundup|briefing|highlights?|editorial|curator?|weekly|daily|trending|featured|selected|curated|topstories|top|share)[+@._-]/i

/** Words in a FROM display name that say "service digest", not "person".
 *  Names like "Flipboard 10 For Today", "GitHub Digest", "Morning Brew". */
const NEWSLETTER_FROM_NAME =
  /\b(digest|newsletter|weekly|daily|roundup|edition|briefing|summary|stories|highlights|curated|updates?|for today|this week|for you|morning|evening|news|trending|top \d+|alert|recap)\b/i

const ESP_DOMAINS = /(mailchimp|mcsv|mcdlv|sendgrid|sendinblue|brevo|exponea|klaviyo|hubspot|braze|exacttarget|salesforce|mailgun|sparkpost|iterable|customer\.io|sailthru|campaign-archive|cmail\d|createsend|constantcontact|omnisend|drip|activecampaign|convertkit|substack|beehiiv|mailerlite|amazonses|postmark|mandrill)/i

const BULK_SUBDOMAIN = /^(mail|email|e|em|mailer|mailing|news|newsletter|marketing|campaign|send|sender|smtp|notify|notifications|reply|links?|go|click|track|cta|mktg|crm|info)\./i

/** What a campaign says and a receipt does not. */
const MARKETING_WORDS = /unsubscribe|opt[- ]?out|manage (your )?(email )?preferences|view (this|it) in (your )?browser|إلغاء الاشتراك/i

/** What a receipt, an alert or a build says. Transactional, not a campaign — it
 *  is automated, so there is nobody to reply to, but archiving the lot of them
 *  unread is not right either. */
const TRANSACTIONAL = /\b(receipt|invoice|payment|paid|order|shipped|delivery|statement|verification|verify|confirm(ation)?|password|sign[- ]?in|security alert|two[- ]?factor|otp|booking|reservation|itinerary|ticket|build|deploy(ment)?|pipeline|failed|succeeded|alert|incident|backup|renewal|expiring|expired)\b/i

export interface Classifiable {
  headers: MailHeader[]
  fromEmail: string
  /** The display name from the From header, e.g. "Flipboard 10 For Today". */
  fromName?: string
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

export function looksLikeBulk(
  headers: MailHeader[], email: string, body: string, fromName?: string,
): boolean {
  const h = (n: string) => headerOf(headers, n)

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

  // A FROM display name like "Flipboard 10 For Today" or "Morning Brew" is a
  // service digest, not a person writing to you, even when the address looks
  // neutral. Checked before the body so a truncated snippet cannot hide it.
  if (fromName && NEWSLETTER_FROM_NAME.test(fromName)) return true

  // And, failing all that, an unsubscribe line in the message
  return MARKETING_WORDS.test(body.slice(0, 4000))
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

  const bulk = looksLikeBulk(m.headers, m.fromEmail, m.body, m.fromName)
  if (bulk) {
    // A receipt, an alert or a build is transactional — automated, but something
    // worth reading before archiving. Everything else bulk — a digest, a
    // campaign, a curated list — is a newsletter. A snippet that says nothing
    // either way is digest content, not a receipt.
    const marketing = MARKETING_WORDS.test(m.body.slice(0, 4000))
      || !!headerOf(m.headers, 'List-Unsubscribe')
    const transactional = TRANSACTIONAL.test(`${m.subject} ${m.body.slice(0, 600)}`)
    if (transactional && !marketing) return 'notification'
    return 'newsletter'
  }

  const me = m.mailbox.toLowerCase()
  if (me && m.to.toLowerCase().includes(me)) return 'needs-you'
  if (me && (m.cc ?? '').toLowerCase().includes(me)) return 'copied'

  // Addressed to a list or an alias this mailbox receives: neither addressed
  // nor copied, and not a campaign. It is somebody's mail, just not pointedly
  // yours.
  return 'other'
}
