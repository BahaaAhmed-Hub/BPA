// ─── A mailbox, without saying whose ─────────────────────────────────────────
//
//  The smart view was written against Gmail's own shapes, which meant its
//  arithmetic — who a thread is addressed to, whether you have answered, how
//  long it has sat — could only ever run on Gmail. None of that reasoning is
//  Gmail's: it is true of any mailbox. Only *fetching* is provider-specific.
//
//  So the engine works on the shapes below and a provider supplies them. To
//  add Outlook, Fastmail or plain IMAP, write one adapter; nothing in
//  `mailSmart.ts`, the sections, the rules or the view changes.
//
//  `headers` is deliberately part of the neutral shape rather than a Gmail
//  detail: they are RFC 5322, not Google's, and every provider worth adapting
//  exposes them — Microsoft Graph as `internetMessageHeaders`, IMAP as the
//  message itself. They are what tells a newsletter from a person, so a shape
//  that dropped them would force every adapter to re-invent that.

export interface MailHeader { name: string; value: string }

export interface NeutralMessage {
  id: string
  /** ms since the epoch. Providers hand this over in four different formats;
   *  converting once, in the adapter, is the point of this type. */
  sentAt: number
  from: string
  fromName: string
  to: string[]
  cc: string[]
  subject: string
  snippet: string
  body: string
  headers: MailHeader[]
}

export interface NeutralThread {
  id: string
  /** Oldest first. The adapter sorts, so the engine never has to wonder. */
  messages: NeutralMessage[]
}

export interface MailboxRef {
  /** The address, which is also how the store keys everything. */
  email: string
  isPrimary?: boolean
}

export interface MailProvider {
  /** `gmail`, `graph`, `imap` — stored with nothing, used in messages. */
  readonly id: string
  /** Thread ids with activity at or after `sinceMs`, newest first, capped. */
  listThreadsSince(box: MailboxRef, sinceMs: number, limit: number): Promise<string[]>
  getThread(box: MailboxRef, threadId: string): Promise<NeutralThread>
}

// ─── Reading addresses ───────────────────────────────────────────────────────
//
//  `"Ahmed, Bahaa" <b@x.y>, c@d.e` is one display name containing a comma and
//  two addresses. Splitting on commas gets that wrong, so the angle-bracket
//  form is matched first and a bare address only where there is no bracket.

export function parseAddressList(value: string | undefined): string[] {
  if (!value) return []
  const out: string[] = []
  const re = /<([^>]+)>|([^\s,;<>]+@[^\s,;<>]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const a = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (a) out.push(a)
  }
  return out
}

export function parseDisplayName(value: string | undefined): string {
  if (!value) return ''
  const name = value.replace(/<[^>]*>/, '').replace(/["']/g, '').trim()
  if (name) return name
  return (parseAddressList(value)[0] ?? '').split('@')[0] ?? ''
}

export function headerOf(headers: MailHeader[], name: string): string {
  const want = name.toLowerCase()
  return headers.find(h => h.name.toLowerCase() === want)?.value ?? ''
}
