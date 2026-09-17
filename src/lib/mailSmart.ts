// ─── The smart view's arithmetic ─────────────────────────────────────────────
//
//  Everything in here is decided from the thread itself — who sent each
//  message, who it was addressed to, and when. **No model call.** That matters
//  for more than speed: these are the facts the three sections are built on, so
//  they have to be the same on every device and the same on every run, and a
//  figure a model produced twice is two answers to one question.
//
//  Two things this deliberately does NOT do:
//  - **It never searches the sent folder.** A Gmail thread already contains
//    your own replies; `getThread` returns all of them. Searching Sent for the
//    same thread would be a second request per thread to learn what the first
//    one already said.
//  - **It never decides what a message *means*.** Whether a deliverable is
//    owed, and what to say back, is the one part a model is actually needed
//    for, and it is asked separately, only about threads whose newest message
//    has not been read before.

import { header, extractBody, type GmailMessage, type GmailThread } from '@/lib/gmail'
import { classifyMail } from '@/lib/mailClasses'
import { isFreeMailDomain } from '@/lib/businessAccounts'
import { normaliseEmail } from '@/modules/calendar/NewEventPanel'

/** Where a thread lands. The three the brief asks for, in priority order. */
export type SmartSection = 'action' | 'radar' | 'fyi'

/** Whether you have answered. */
export type ReplyState =
  /** You have sent something, and nothing has arrived since. */
  | 'replied'
  /** You replied, and then they wrote again — the ball is back. */
  | 'pending'
  /** You have never written in this thread. */
  | 'none'

export interface ThreadFacts {
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

function addressesIn(value: string): string[] {
  // "A B <a@b.c>, d@e.f" → both addresses. A display name may itself contain a
  // comma ("Ahmed, Bahaa <b@x.y>"), so the split is on the angle-bracket form
  // first and only falls back to commas for a bare list.
  const out: string[] = []
  const re = /<([^>]+)>|([^\s,;<>]+@[^\s,;<>]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) out.push(normaliseEmail(m[1] ?? m[2]))
  return out.filter(Boolean)
}

export function fromAddress(msg: GmailMessage): string {
  return addressesIn(header(msg.payload.headers, 'From'))[0] ?? ''
}

export function fromDisplayName(msg: GmailMessage): string {
  const raw = header(msg.payload.headers, 'From')
  const name = raw.replace(/<[^>]*>/, '').replace(/["']/g, '').trim()
  return name || fromAddress(msg).split('@')[0] || 'Unknown'
}

/** Sent by one of your own addresses. */
function isMine(msg: GmailMessage, me: Set<string>): boolean {
  return me.has(fromAddress(msg))
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
  thread: GmailThread,
  accountEmail: string,
  me: Set<string>,
  myFirstName: string,
  now = Date.now(),
): ThreadFacts | null {
  const msgs = [...(thread.messages ?? [])].sort(
    (a, b) => Number(a.internalDate) - Number(b.internalDate))
  if (msgs.length === 0) return null

  const last = msgs[msgs.length - 1]
  const inbound = msgs.filter(m => !isMine(m, me))
  const mine = msgs.filter(m => isMine(m, me))
  // A thread of nothing but your own messages is something you sent, not
  // something waiting on you.
  const newestInbound = inbound[inbound.length - 1] ?? last

  const lastRepliedAt = mine.length ? Number(mine[mine.length - 1].internalDate) : null
  const lastAt = Number(last.internalDate)
  const lastInboundAt = Number(newestInbound.internalDate)

  const replyState: ReplyState =
    lastRepliedAt === null ? 'none'
    : lastInboundAt > lastRepliedAt ? 'pending'
    : 'replied'

  // To vs Cc, on the newest message that is not yours: being copied on a thread
  // you are also on the To line of does not demote it.
  const to = addressesIn(header(newestInbound.payload.headers, 'To'))
  const addressedTo = to.some(a => me.has(a))

  const body = extractBody(newestInbound)
  const namedInBody = myFirstName.length > 1 &&
    new RegExp(`\\b${myFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body)

  const fromEmail = fromAddress(newestInbound)
  const domain = fromEmail.split('@')[1] ?? ''

  return {
    threadId: thread.id,
    accountEmail,
    subject: header(last.payload.headers, 'Subject') || '(no subject)',
    fromName: fromDisplayName(newestInbound),
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
    bottleneck: replyState !== 'replied' && now - lastInboundAt >= DAY
      && (addressedTo || namedInBody),
    messageCount: msgs.length,
    snippet: newestInbound.snippet ?? '',
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
  facts: ThreadFacts, newest: GmailMessage, accountIsBusiness: boolean,
): boolean {
  const h = newest.payload.headers
  const kind = classifyMail({
    headers: h,
    fromEmail: facts.fromEmail,
    to: header(h, 'To').toLowerCase(),
    cc: header(h, 'Cc').toLowerCase(),
    subject: facts.subject,
    // The snippet, not the whole body: `looksLikeBulk` reads it for an
    // unsubscribe line, and that lives in the part Gmail already handed over.
    body: newest.snippet ?? '',
    mailbox: facts.accountEmail,
  })
  if (kind === 'newsletter' || kind === 'notification' || kind === 'invitation') return false
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
export function sectionFor(f: ThreadFacts, direct = false): SmartSection {
  // Answered, and nothing has come back. Rule: omit from the action list.
  if (f.replyState === 'replied') return f.awaitingCustomer ? 'fyi' : 'fyi'
  const wantsYou = f.addressedTo || f.namedInBody || direct
  if (wantsYou) return 'action'
  // On the copy line with the ball in your court is something to watch, not
  // something to do.
  return f.replyState === 'none' || f.replyState === 'pending' ? 'radar' : 'fyi'
}

/** Newest first inside a section, with the ones you are holding up first. */
export function orderThreads(a: ThreadFacts, b: ThreadFacts): number {
  if (a.bottleneck !== b.bottleneck) return a.bottleneck ? -1 : 1
  return b.lastAt - a.lastAt
}

/** The Gmail search for one pass. `since` is the watermark — the first run
 *  reaches back 30 days, every run after it only asks for what has arrived
 *  since the last one, which is the whole reason reopening the tab is cheap. */
export function searchQuery(sinceMs: number): string {
  // Gmail's `after:` takes whole seconds and is exclusive of nothing, so a
  // second of overlap is deliberate: a message landing in the same second as
  // the watermark must not fall between two runs.
  const after = Math.floor(Math.max(0, sinceMs - 1000) / 1000)
  return `after:${after} -in:chats -in:spam -in:trash`
}

export const WINDOW_DAYS = 30
export function windowStart(now = Date.now()): number {
  return now - WINDOW_DAYS * DAY
}
