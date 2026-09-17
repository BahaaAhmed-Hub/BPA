// ─── The smart view's arithmetic ─────────────────────────────────────────────
//
//  Everything in here is decided from the thread itself — who sent each
//  message, who it was addressed to, and when. **No model call.** That matters
//  for more than speed: these are the facts the three sections are built on, so
//  they have to be the same on every device and the same on every run, and a
//  figure a model produced twice is two answers to one question.
//
//  Two things this deliberately does NOT do:
//  - **It never searches the sent folder.** A thread already contains your own
//    replies — every provider worth adapting returns them with it. Searching
//    Sent for the same thread would be a second request per thread to learn
//    what the first one already said.
//  - **It never decides what a message *means*.** Whether a deliverable is
//    owed, and what to say back, is the one part a model is actually needed
//    for, and it is asked separately, only about threads whose newest message
//    has not been read before.

import { classifyMail } from '@/lib/mailClasses'
import { canNeedAction, kindOf, type MailKind } from '@/lib/mailKinds'
import { isFreeMailDomain } from '@/lib/businessAccounts'
import { normaliseEmail } from '@/modules/calendar/NewEventPanel'
import { headerOf, type NeutralMessage, type NeutralThread } from '@/lib/mailProvider'

/** Where a thread lands, in the order you deal with them.
 *
 *  `action` used to carry two different things: a renewal waiting on your
 *  answer, and a sign-in alert you merely want to see. Both were "needs your
 *  attention", both got a Draft button, and offering to write a reply to a
 *  login notification is how a list teaches you to stop reading it. So the
 *  first group is split: what you owe somebody, and what you should know. */
export type SmartSection = 'action' | 'attention' | 'radar' | 'fyi'

/** Whether you have answered. */
export type ReplyState =
  /** You have sent something, and nothing has arrived since. */
  | 'replied'
  /** You replied, and then they wrote again — the ball is back. */
  | 'pending'
  /** You have never written in this thread. */
  | 'none'

export interface ThreadFacts {
  /** What the thread *is* — read here rather than by each caller, because it
   *  decides a fact on this object: a machine is never waiting on you. */
  kind: MailKind
  threadId: string
  accountEmail: string
  subject: string
  fromName: string
  fromEmail: string
  /** The newest message's id. The whole cache turns on this: same id, same
   *  answer, no model call and nothing refetched. */
  lastMessageId: string
  /** ms. The newest message in the thread, whoever sent it. */
  lastAt: number
  /** ms, or null where you have never written. */
  lastRepliedAt: number | null
  replyState: ReplyState
  /** You are on the To line, not merely copied. */
  addressedTo: boolean
  /** Your own name appears in the newest inbound message's text. */
  namedInBody: boolean
  /** The sender is on one of your own business domains. */
  internal: boolean
  /** Nobody has written since your reply, and it has been a while. */
  awaitingCustomer: boolean
  /** They are waiting on **you** — unanswered, over a day old, and actually
   *  addressed to you. Being copied on a thread nobody has answered does not
   *  make you the one holding it up. */
  bottleneck: boolean
  /** Unanswered and over a day old, whoever it is for. The model's `direct`
   *  can turn this into a bottleneck for a thread the headers alone would have
   *  called a copy. */
  staleInbound: boolean
  messageCount: number
  /** A line of the newest inbound message, for a row that has no brief yet. */
  snippet: string
}

/** How long a thread may sit after your reply before it stops being yours. */
export const AWAITING_DAYS = 5
const DAY = 24 * 60 * 60 * 1000

/** Every address that is *you*, lower-cased — every mailbox plus any alias. */
export function meSet(addresses: (string | undefined)[]): Set<string> {
  return new Set(addresses.map(a => normaliseEmail(a)).filter(Boolean))
}

/** Sent by one of your own addresses. */
function isMine(msg: NeutralMessage, me: Set<string>): boolean {
  return me.has(normaliseEmail(msg.from))
}

/** Your first name as it would be written to you. Used only for the
 *  "addressed by name" test, which is why a single token is enough. */
export function firstNameOf(displayName: string | undefined, email: string): string {
  const fromName = (displayName ?? '').trim().split(/\s+/)[0]
  if (fromName && fromName.length > 1 && /^[\p{L}]+$/u.test(fromName)) return fromName
  const local = normaliseEmail(email).split('@')[0] ?? ''
  const token = local.split(/[._-]+/)[0]
  return token.length > 1 ? token : ''
}

/**
 * Read one thread into the facts the sections are built from.
 *
 * `me` is every address of yours across every mailbox — a thread reaching two
 * of your accounts must not count your own reply from one as somebody else's
 * message to the other.
 */
export function readThread(
  thread: NeutralThread,
  accountEmail: string,
  me: Set<string>,
  myFirstName: string,
  now = Date.now(),
): ThreadFacts | null {
  // The provider hands them over oldest first; this does not re-sort, so an
  // adapter that gets it wrong is a bug in the adapter rather than a cost paid
  // on every thread.
  const msgs = thread.messages ?? []
  if (msgs.length === 0) return null

  const last = msgs[msgs.length - 1]
  const inbound = msgs.filter(m => !isMine(m, me))
  const mine = msgs.filter(m => isMine(m, me))
  // A thread of nothing but your own messages is something you sent, not
  // something waiting on you.
  const newestInbound = inbound[inbound.length - 1] ?? last

  const lastRepliedAt = mine.length ? mine[mine.length - 1].sentAt : null
  const lastAt = last.sentAt
  const lastInboundAt = newestInbound.sentAt

  const replyState: ReplyState =
    lastRepliedAt === null ? 'none'
    : lastInboundAt > lastRepliedAt ? 'pending'
    : 'replied'

  // To vs Cc, on the newest message that is not yours: being copied on a thread
  // you are also on the To line of does not demote it.
  const addressedTo = newestInbound.to.some(a => me.has(normaliseEmail(a)))

  const body = newestInbound.body
  const namedInBody = myFirstName.length > 1 &&
    new RegExp(`\\b${myFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body)

  const fromEmail = normaliseEmail(newestInbound.from)
  const domain = fromEmail.split('@')[1] ?? ''
  const subject = last.subject || '(no subject)'
  const kind = kindOf({
    newest: newestInbound, subject, fromEmail,
    // What tells a conversation from an announcement. Without these a first
    // message from `events@` reads the same as the fourth message of a thread
    // you are in the middle of.
    youWrote: mine.length > 0,
    namedInBody,
    messageCount: msgs.length,
  })
  // A sign-in alert, a status page and a meeting called off are never waiting
  // on you, however long they sit. Saying "waiting on you" over one is how the
  // flag stops meaning anything on the rows where it is true.
  const actionable = canNeedAction(kind)

  return {
    kind,
    threadId: thread.id,
    accountEmail,
    subject,
    fromName: newestInbound.fromName || fromEmail.split('@')[0] || 'Unknown',
    fromEmail,
    lastMessageId: last.id,
    lastAt,
    lastRepliedAt,
    replyState,
    addressedTo,
    namedInBody,
    internal: !!domain && !isFreeMailDomain(domain),
    // Your reply is the newest thing in it, and it has been sitting a while.
    awaitingCustomer: replyState === 'replied' &&
      lastRepliedAt !== null && now - lastRepliedAt >= AWAITING_DAYS * DAY,
    // Unanswered, and not since five minutes ago.
    staleInbound: replyState !== 'replied' && now - lastInboundAt >= DAY,
    // …and actually yours. A thread you were copied on and nobody has answered
    // is not one you are holding up, and saying so on every such row is how a
    // flag stops meaning anything.
    bottleneck: actionable && replyState !== 'replied' && now - lastInboundAt >= DAY
      && (addressedTo || namedInBody),
    messageCount: msgs.length,
    snippet: newestInbound.snippet,
  }
}

/**
 * Whether a thread is business mail at all — STEP 2, and the only filter that
 * runs before anything is stored.
 *
 * Two ways in, and nothing else: it arrived in a mailbox you marked as work, or
 * it came from somebody at a real organisation rather than a campaign. What is
 * thrown out is decided by `classifyMail`, which already knows a newsletter, a
 * calendar notification and an automated alert from a person writing to you —
 * from headers, with no model call and no second opinion.
 */
export function isBusinessThread(
  facts: ThreadFacts, newest: NeutralMessage, accountIsBusiness: boolean,
  kind: MailKind = 'reply',
): boolean {
  const h = newest.headers
  const cls = classifyMail({
    headers: h,
    fromEmail: facts.fromEmail,
    to: newest.to.join(', '),
    cc: newest.cc.join(', '),
    subject: facts.subject,
    // The snippet, not the whole body: `looksLikeBulk` reads it for an
    // unsubscribe line, and that lives in the part already handed over.
    body: newest.snippet,
    mailbox: facts.accountEmail,
    // `classifyMail` only calls something an invitation when it is told, and
    // nothing here was telling it — so calendar invitations were surviving
    // into the smart view, which is the one thing the brief names twice as
    // something to discard. The header is the same test the nightly run makes.
    isInvitation: /text\/calendar/i.test(headerOf(h, 'Content-Type')),
  })
  // **A campaign goes, and nothing else does.**
  //
  //  There used to be a second clause here: automated mail was discarded
  //  wherever the row had nothing but a Draft button to put under it. That was
  //  written when `kindOf` called everything it did not recognise a `reply`,
  //  so the clause was doing the work of telling an announcement from a
  //  conversation — badly. It threw away a support thread because the address
  //  said `support@`. `kindOf` decides that now, from the shape of the thread
  //  rather than from the spelling of one address, and anything it still calls
  //  a `reply` is a conversation or a message that names you. Keeping the
  //  clause as well meant two rules answering one question and disagreeing.
  void kind
  if (cls === 'newsletter') return false
  if (accountIsBusiness) return true
  // A personal mailbox still carries work: a named person on an organisation's
  // own domain counts, a free-mail address does not.
  return facts.internal
}

/** Which of the three sections a thread belongs in.
 *
 *  `direct` is the model's read of STEP 4's softer signals — a deliverable
 *  attributed to you, a teammate explicitly waiting. It is optional: with no
 *  model configured the deterministic signals still sort the list, they just
 *  sort it more bluntly. */
export function sectionFor(f: ThreadFacts, direct = false, kind: MailKind = 'reply'): SmartSection {
  // Answered, and nothing has come back. Rule: omit from the action list. That
  // includes a thread of nothing but your own messages — something you sent is
  // not something waiting on you, and it had been arriving in the action list
  // because a forward to yourself has no inbound message to read.
  if (f.replyState === 'replied') return 'fyi'

  const forYou = f.addressedTo || f.namedInBody || direct

  // Information is information whoever it was addressed to. A status page, a
  // device notice, somebody accepting an invitation: there is nothing to do
  // with any of them and nothing to acknowledge either, so putting them in
  // "worth knowing" beside the sign-in alerts made that group the place
  // everything automated ended up.
  if (kind === 'update') return 'fyi'

  // A sign-in alert or a meeting somebody called off: you want to see it and
  // there is nothing to answer. Addressed to you it is worth knowing;
  // otherwise it is information.
  if (!canNeedAction(kind)) return forYou ? 'attention' : 'fyi'

  // An invitation is an action wherever it was addressed — answering it is the
  // whole of what it wants, and it cannot be answered by being read.
  if (kind === 'invitation') return 'action'

  if (forYou) return 'action'
  // On the copy line with the ball in your court is something to watch, not
  // something to do.
  return 'radar'
}

/** Newest first inside a section, with the ones you are holding up first. */
export function orderThreads(a: ThreadFacts, b: ThreadFacts): number {
  if (a.bottleneck !== b.bottleneck) return a.bottleneck ? -1 : 1
  return b.lastAt - a.lastAt
}

export const WINDOW_DAYS = 30
export function windowStart(now = Date.now()): number {
  return now - WINDOW_DAYS * DAY
}
