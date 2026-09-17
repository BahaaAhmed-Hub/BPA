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
 *  view has an answer for. */
export function looksCampaign(m: NeutralMessage): boolean {
  const hs = m.headers
  const has = (n: string) => !!headerOf(hs, n)
  if (has('List-Unsubscribe') || has('List-Id') || has('List-Post')) return true
  if (/bulk|list|junk/i.test(headerOf(hs, 'Precedence'))) return true
  if (has('X-Campaign-Id') || has('X-Mailer-Campaign') || has('X-Feedback-Id')) return true
  return false
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

/** The one filter, stated once. A campaign goes; other automated mail goes only
 *  nothing else does — `kindOf` tells an announcement from a conversation from
 *  the shape of the thread, so a second rule here guessing from the sender's
 *  address was two rules answering one question. This is the same sentence
 *  `isBusinessThread` makes in the browser, and `scripts/mail-rules-agree.mjs`
 *  fails if the two stop agreeing. */
export function keepThread(m: NeutralMessage, _kind: MailKind): boolean {
  return !looksCampaign(m)
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
