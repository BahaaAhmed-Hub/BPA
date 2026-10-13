// ─── The smart view's rules, for the server ──────────────────────────────────
//
//  Deno cannot import the app's bundle, so these rules exist twice: here, and
//  in `src/lib/mailSmart.ts`. Two copies of one rule is exactly how a nightly
//  run and a browser come to disagree about which section a thread is in — so
//  they are not left to good intentions. `scripts/mail-rules-agree.mjs` runs
//  the same fixtures through both and fails if any answer differs.
//
//  Everything here is pure: no Deno APIs, no network, no imports. That is what
//  lets the test load it at all.

// ─── The neutral shapes, kept in step with src/lib/mailProvider.ts ───────────
//
//  Deno cannot import from the app's bundle, so these are restated rather than
//  shared. They are restated *exactly*, and the reason the provider split
//  exists at all is so that a second mail system means one more adapter here
//  and one more in the browser, not a second way of thinking about a thread.

/** The two clocks the rules use. Here rather than in the function, because a
 *  rule and the number it compares against are one thing. */
import { kindOf, canNeedAction, KIND_NEED, type MailKind } from './mailKinds.ts'
import { classifyMail, type MailClass } from './mailClasses.ts'
// Re-exported so the function imports the rules from one place.
export { canNeedAction, KIND_NEED }
export type { MailKind }

export const DAY = 86_400_000
export const AWAITING_DAYS = 5

export interface MailHeader { name: string; value: string }
export interface NeutralMessage {
  id: string; sentAt: number; from: string; fromName: string
  to: string[]; cc: string[]; subject: string; snippet: string
  body: string; headers: MailHeader[]
}
export interface NeutralThread { id: string; messages: NeutralMessage[] }

export function parseAddressList(v: string | undefined): string[] {
  if (!v) return []
  const out: string[] = []
  const re = /<([^>]+)>|([^\s,;<>]+@[^\s,;<>]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(v))) {
    const a = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (a) out.push(a)
  }
  return out
}
export function displayName(v: string | undefined): string {
  if (!v) return ''
  const n = v.replace(/<[^>]*>/, '').replace(/["']/g, '').trim()
  return n || (parseAddressList(v)[0] ?? '').split('@')[0] || ''
}
export function headerOf(hs: MailHeader[], name: string): string {
  const want = name.toLowerCase()
  return hs.find(h => h.name.toLowerCase() === want)?.value ?? ''
}

// ─── The rules, identical to src/lib/mailSmart.ts ────────────────────────────

export const FREE_MAIL = new Set([
  'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com',
  'icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com','mail.com',
  'yandex.com','zoho.com',
])

/** A campaign: something sent to a list, whatever its subject line says. It is
 *  discarded outright — there is no version of a marketing send that the smart
 *  view has an answer for.
 *
 *  **It used to be a regex of its own, and that is what drifted.** The test
 *  was a sender's local part (`team@`, `support@`, `info@`…) plus the list
 *  headers, and it answered *kept or not* on its own. But a local part says
 *  only that a message is **bulk**; whether bulk is a newsletter or a
 *  transactional notice is `classifyMail`'s question, and the browser has
 *  always asked it that way. So this is now the one classifier's answer —
 *  broader where it should be (an ESP domain, a `mail.` subdomain, an
 *  unsubscribe line in the body) and narrower where it must be (a receipt or a
 *  ticket from `support@` is a notification, not a campaign). */
export function looksCampaign(m: NeutralMessage): boolean {
  return classOf(m, '') === 'newsletter'
}

/** One call, shaped for a `NeutralMessage`. `mailbox` only separates
 *  needs-you / copied / other, all of which are decided *below* the bulk
 *  branch — so the two classes this file reads are the same with or without
 *  it, and `looksCampaign` can pass none. */
function classOf(m: NeutralMessage, mailbox: string): MailClass {
  return classifyMail({
    headers: m.headers,
    fromEmail: m.from,
    fromName: m.fromName,
    to: m.to.join(', '),
    cc: m.cc.join(', '),
    subject: m.subject,
    // The snippet, not the whole body: the marketing test reads it for an
    // unsubscribe line, and that lives in the part already handed over.
    body: m.snippet,
    mailbox,
    isInvitation: /text\/calendar/i.test(headerOf(m.headers, 'Content-Type')),
  })
}

/** Machine-sent rather than written by a person. Not the same question as
 *  "throw it away": a sign-in alert, a status page and a meeting called off are
 *  all automated and all worth seeing. What decides is whether the row has
 *  something to offer for it — `canNeedAction(kind)` — so this answers only
 *  what it is, and `keepThread` below answers whether it stays. */
export function looksAutomated(m: NeutralMessage): boolean {
  const hs = m.headers
  const has = (n: string) => !!headerOf(hs, n)
  if (looksCampaign(m)) return true
  if (has('Auto-Submitted') && !/^no$/i.test(headerOf(hs, 'Auto-Submitted'))) return true
  if (/^(no-?reply|do-?not-?reply|notifications?|mailer|bounce|postmaster)@/i.test(m.from)) return true
  // Not calendar mail: an invitation is the one automated message that wants
  // something back, and a cancellation is one you want to see. `kindOf` tells
  // those apart and the row answers each properly, so discarding them here
  // would throw away the only automated mail worth keeping.
  return false
}

/** The one filter, stated once — and it is now **the same two sentences** the
 *  browser's `isBusinessThread` makes, rather than a second rule guessing from
 *  the sender's address:
 *
 *  - a **newsletter** goes, whatever its subject line says;
 *  - a **notification** goes only where the thread's kind leaves the row
 *    nothing to offer — a build failure nobody is waiting on goes, an
 *    invitation, a sign-in alert, a cancellation and a ticket you are in the
 *    middle of all stay.
 *
 *  `scripts/mail-rules-agree.mjs` fails if the two stop agreeing, and it is
 *  what caught the previous answer: a support thread and a `team@` message
 *  that named you were kept by the app and discarded here.
 *
 *  The account-is-work half of the browser's rule stays with the browser:
 *  `index.ts` asks it separately (`accountIsBusiness || f.internal`), which is
 *  also the generous side — a row stored and then filtered on display is a
 *  recoverable mistake, a row never stored is not. */
export function keepThread(m: NeutralMessage, kind: MailKind, mailbox = ''): boolean {
  const cls = classOf(m, mailbox)
  if (cls === 'newsletter') return false
  if (cls === 'notification' && !canNeedAction(kind)) return false
  return true
}

export interface Facts {
  kind: MailKind
  threadId: string; lastMessageId: string; lastAt: number
  subject: string; fromName: string; fromEmail: string
  replyState: 'replied' | 'pending' | 'none'
  addressedTo: boolean; namedInBody: boolean
  bottleneck: boolean; awaitingCustomer: boolean
  section: 'action' | 'attention' | 'radar' | 'fyi'
  internal: boolean
}

export function readThread(t: NeutralThread, me: Set<string>, firstName: string, now: number): Facts | null {
  const msgs = [...t.messages].sort((a, b) => a.sentAt - b.sentAt)
  if (!msgs.length) return null
  const isMine = (m: NeutralMessage) => me.has(m.from.toLowerCase())
  const last = msgs[msgs.length - 1]
  const inbound = msgs.filter(m => !isMine(m))
  const mine = msgs.filter(isMine)
  const newest = inbound[inbound.length - 1] ?? last

  const lastReplied = mine.length ? mine[mine.length - 1].sentAt : null
  const replyState = lastReplied === null ? 'none'
    : newest.sentAt > lastReplied ? 'pending' : 'replied'

  const addressedTo = newest.to.some(a => me.has(a.toLowerCase()))
  const namedInBody = firstName.length > 1 &&
    new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(newest.body)

  const fromEmail = newest.from.toLowerCase()
  const domain = fromEmail.split('@')[1] ?? ''
  const kind = kindOf({
    newest, subject: last.subject || '', fromEmail,
    youWrote: mine.length > 0, namedInBody, messageCount: msgs.length,
  })
  // A machine is never waiting on you, however long its notice sits.
  const bottleneck = canNeedAction(kind) &&
    replyState !== 'replied' && now - newest.sentAt >= DAY && (addressedTo || namedInBody)
  const awaitingCustomer = replyState === 'replied' && lastReplied !== null &&
    now - lastReplied >= AWAITING_DAYS * DAY

  const forYou = addressedTo || namedInBody

  const section: Facts['section'] =
    // Something you sent, or answered and heard nothing back about, is not
    // waiting on you.
    replyState === 'replied' ? 'fyi'
    // An invitation is an action wherever it was addressed — answering it is
    // the whole of what it wants, and it cannot be answered by being read.
    : kind === 'invitation' ? 'action'
    // Information is information whoever it was addressed to.
    : kind === 'update' ? 'fyi'
    // A sign-in, or a meeting called off: worth seeing, never a task.
    : !canNeedAction(kind) ? (forYou ? 'attention' : 'fyi')
    : forYou ? 'action'
    : 'radar'

  return {
    kind,
    threadId: t.id, lastMessageId: last.id, lastAt: last.sentAt,
    subject: last.subject || '(no subject)',
    fromName: newest.fromName || fromEmail.split('@')[0] || 'Unknown',
    fromEmail, replyState, addressedTo, namedInBody,
    bottleneck, awaitingCustomer, section,
    internal: !!domain && !FREE_MAIL.has(domain),
  }
}


export const WINDOW_DAYS = 30
