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

/** A campaign, a receipt or an automated alert — anything that is not a person
 *  writing to you. Header-led, the same tests the browser makes. */
export function looksAutomated(m: NeutralMessage): boolean {
  const hs = m.headers
  const has = (n: string) => !!headerOf(hs, n)
  if (has('List-Unsubscribe') || has('List-Id') || has('List-Post')) return true
  if (/bulk|list|junk/i.test(headerOf(hs, 'Precedence'))) return true
  if (has('Auto-Submitted') && !/^no$/i.test(headerOf(hs, 'Auto-Submitted'))) return true
  if (has('X-Campaign-Id') || has('X-Mailer-Campaign') || has('X-Feedback-Id')) return true
  if (/^(no-?reply|do-?not-?reply|notifications?|mailer|bounce|postmaster)@/i.test(m.from)) return true
  if (/text\/calendar/i.test(headerOf(hs, 'Content-Type'))) return true
  return false
}

export interface Facts {
  threadId: string; lastMessageId: string; lastAt: number
  subject: string; fromName: string; fromEmail: string
  replyState: 'replied' | 'pending' | 'none'
  addressedTo: boolean; namedInBody: boolean
  bottleneck: boolean; awaitingCustomer: boolean
  section: 'action' | 'radar' | 'fyi'
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
  const bottleneck = replyState !== 'replied' && now - newest.sentAt >= DAY && (addressedTo || namedInBody)
  const awaitingCustomer = replyState === 'replied' && lastReplied !== null &&
    now - lastReplied >= AWAITING_DAYS * DAY

  const section: Facts['section'] =
    replyState === 'replied' ? 'fyi'
    : (addressedTo || namedInBody) ? 'action'
    : 'radar'

  return {
    threadId: t.id, lastMessageId: last.id, lastAt: last.sentAt,
    subject: last.subject || '(no subject)',
    fromName: newest.fromName || fromEmail.split('@')[0] || 'Unknown',
    fromEmail, replyState, addressedTo, namedInBody,
    bottleneck, awaitingCustomer, section,
    internal: !!domain && !FREE_MAIL.has(domain),
  }
}


export const WINDOW_DAYS = 30
