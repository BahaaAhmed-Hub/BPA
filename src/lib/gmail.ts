import { supabase } from './supabase'
import { getGoogleToken } from './tokenManager'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GmailHeader { name: string; value: string }

export interface GmailPart {
  mimeType: string
  /** Present on parts Gmail keeps out of the message body — attachments and
   *  the images a signature refers to. The bytes are fetched separately. */
  body: { data?: string; size: number; attachmentId?: string }
  filename?: string
  headers?: GmailHeader[]
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  internalDate: string
  payload: {
    headers: GmailHeader[]
    mimeType: string
    body: { data?: string; size: number }
    parts?: GmailPart[]
  }
}

export interface GmailThread {
  id: string
  messages: GmailMessage[]
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
//
// Mail is read and sent for **an account**, not for "the app". The one you
// signed in with keeps its token in the session; a connected account's token
// never reaches the browser as a stored value and is fetched on demand.

export interface MailAccount {
  email: string
  name?: string
  isPrimary: boolean
}

async function accessToken(account?: MailAccount): Promise<string> {
  if (account && !account.isPrimary) {
    const token = await getGoogleToken(account.email)
    if (!token) throw new Error(`${account.email} needs reconnecting before its mail can be read.`)
    return token
  }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.provider_token ?? localStorage.getItem('google_provider_token')
  if (!token) throw new Error('No Google access token — please sign in with Google.')
  return token
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function gFetch<T>(path: string, init?: RequestInit, account?: MailAccount): Promise<T> {
  const token = await accessToken(account)
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body?.error?.message ?? `Gmail ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function header(headers: GmailHeader[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export function decodeBase64(data?: string): string {
  if (!data) return ''
  try {
    return decodeURIComponent(
      escape(atob(data.replace(/-/g, '+').replace(/_/g, '/'))),
    )
  } catch {
    return ''
  }
}

function encodeBase64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Recursively extract raw HTML body from a MIME payload (null if not found). */
export function extractHtmlBody(msg: GmailMessage): string | null {
  function findByMime(parts: GmailPart[] | undefined, mime: string): string | null {
    if (!parts) return null
    for (const part of parts) {
      if (part.mimeType === mime && part.body.data) return decodeBase64(part.body.data)
      const nested = findByMime(part.parts, mime)
      if (nested) return nested
    }
    return null
  }
  if (msg.payload.mimeType === 'text/html' && msg.payload.body.data) {
    return decodeBase64(msg.payload.body.data)
  }
  return findByMime(msg.payload.parts, 'text/html')
}

/** Recursively extract plain-text body from a MIME payload, falling back to HTML. */
export function extractBody(msg: GmailMessage): string {
  function findByMime(parts: GmailPart[] | undefined, mime: string): string | null {
    if (!parts) return null
    for (const part of parts) {
      if (part.mimeType === mime && part.body.data) return decodeBase64(part.body.data)
      const nested = findByMime(part.parts, mime)
      if (nested) return nested
    }
    return null
  }

  if (msg.payload.mimeType === 'text/plain' && msg.payload.body.data) {
    const text = decodeBase64(msg.payload.body.data)
    if (!/please enable html/i.test(text)) return text
  }

  const plain = findByMime(msg.payload.parts, 'text/plain')
  if (plain && !/please enable html/i.test(plain)) return plain

  // Fall back to HTML — strip tags to get readable text
  if (msg.payload.mimeType === 'text/html' && msg.payload.body.data) {
    return stripHtml(decodeBase64(msg.payload.body.data))
  }
  const html = findByMime(msg.payload.parts, 'text/html')
  if (html) return stripHtml(html)

  return msg.snippet
}

// ─── Gmail API calls ──────────────────────────────────────────────────────────

/** Return unread thread IDs and an optional nextPageToken for pagination. */
export async function listUnreadThreadIds(
  max = 20, pageToken?: string, account?: MailAccount, query = 'is:unread in:inbox',
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const qs = `/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${max}${pageToken ? `&pageToken=${pageToken}` : ''}`
  const data = await gFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(qs, undefined, account)
  return { ids: (data.threads ?? []).map(t => t.id), nextPageToken: data.nextPageToken }
}

// ─── The folders ─────────────────────────────────────────────────────────────
//
// Gmail has no folders, it has labels and a search language — which is better,
// because "sent" and "unread" and "starred" are then the same kind of thing.
// These are the queries behind the names people actually use.

export type MailFolder = 'unread' | 'inbox' | 'sent' | 'drafts' | 'starred' | 'archive' | 'spam' | 'trash'

export const FOLDER_QUERY: Record<MailFolder, string> = {
  unread:  'is:unread in:inbox',
  inbox:   'in:inbox',
  sent:    'in:sent',
  drafts:  'in:drafts',
  starred: 'is:starred',
  archive: '-in:inbox -in:sent -in:drafts -in:trash -in:spam',
  spam:    'in:spam',
  trash:   'in:trash',
}

export const FOLDER_LABEL: Record<MailFolder, string> = {
  unread: 'Unread', inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts',
  starred: 'Starred', archive: 'Archived', spam: 'Spam', trash: 'Bin',
}

/** A sent message is one you wrote: what matters on the row is who it went to,
 *  not who it came from. */
export const FOLDER_SHOWS_RECIPIENT: Partial<Record<MailFolder, boolean>> = {
  sent: true, drafts: true,
}

/** Fetch a full thread (all messages). */
export async function getThread(threadId: string, account?: MailAccount): Promise<GmailThread> {
  return gFetch<GmailThread>(`/users/me/threads/${threadId}?format=full`, undefined, account)
}

/** One message in full — the payload the body and its pictures come out of. */
export async function getMessage(messageId: string, account?: MailAccount): Promise<GmailMessage> {
  return gFetch<GmailMessage>(`/users/me/messages/${messageId}?format=full`, undefined, account)
}

/** Mark a message as read (remove UNREAD label). Requires gmail.modify scope. */
export async function markAsRead(messageId: string, account?: MailAccount): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  }, account)
}

/** Archive a message (remove INBOX label). Requires gmail.modify scope. */
export async function archiveMessage(messageId: string, account?: MailAccount): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
  }, account)
}

/** Mark it unread again — the other half of the read gesture. A swipe that
 *  only ever works one way is a no-op half the time you reach for it. */
export async function markAsUnread(messageId: string, account?: MailAccount): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['UNREAD'] }),
  }, account)
}

/** Put an archived message back in the inbox — what undoing an archive means. */
export async function unarchiveMessage(messageId: string, account?: MailAccount): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['INBOX'] }),
  }, account)
}

/**
 * Move to the Bin.
 *
 * This is what "delete" means here, and deliberately so: `gmail.modify` cannot
 * erase a message outright — that needs the full `mail.google.com` scope — and
 * a gesture as cheap as a swipe should not be able to destroy mail anyway.
 * Gmail's own delete does exactly this, and the Bin keeps it for 30 days.
 */
export async function trashMessage(messageId: string, account?: MailAccount): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/trash`, { method: 'POST' }, account)
}

export async function untrashMessage(messageId: string, account?: MailAccount): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/untrash`, { method: 'POST' }, account)
}

// ─── Labels, and moving mail between them ────────────────────────────────────
//
// Gmail has no folders. A "move" is a label added and the inbox taken away —
// which is also why it is undoable by exactly reversing those two.

export interface GmailLabel {
  id: string
  name: string
  /** `user` for the ones a person made; `system` for INBOX, SPAM and the rest. */
  type?: string
}

/** The labels this mailbox can file something under, the person's own first. */
export async function listLabels(account?: MailAccount): Promise<GmailLabel[]> {
  const res = await gFetch<{ labels?: GmailLabel[] }>('/users/me/labels', undefined, account)
  return (res.labels ?? []).filter(l => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One request for a whole selection, rather than one per message.
 *
 * Gmail takes up to 1000 ids and answers 204 with no body, so this cannot go
 * through `gFetch` — that parses the response. A selection may span several
 * mailboxes; each account needs its own call, because the ids and the token
 * both belong to one.
 */
export async function batchModify(
  ids: string[],
  labels: { add?: string[]; remove?: string[] },
  account?: MailAccount,
): Promise<void> {
  if (ids.length === 0) return
  const token = await accessToken(account)
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, addLabelIds: labels.add ?? [], removeLabelIds: labels.remove ?? [] }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body?.error?.message ?? `Gmail ${res.status}`)
  }
}

// ─── Sending ──────────────────────────────────────────────────────────────────
//
// One function, because a reply, a reply to everyone, a forward and a new
// message differ only in what goes in the fields. What used to be here could
// send a plain-text line to one address and nothing else — no Cc, no Bcc, no
// attachment, no way to say which account it came from, and a subject that was
// mangled the moment it left ASCII.

export interface MailAttachment {
  name: string
  mime: string
  /** Base64, no line breaks — a FileReader data URL with the prefix removed. */
  data: string
}

export interface SendMailOptions {
  /** Whose mailbox it leaves from. Omitted means the account you signed in with. */
  account?: MailAccount
  to: string
  cc?: string
  bcc?: string
  subject: string
  /** The message as HTML. A plain-text alternative is derived from it. */
  html: string
  /** Keeps a reply in its conversation. */
  threadId?: string
  inReplyTo?: string
  references?: string
  attachments?: MailAttachment[]
}

/** A header value Google will read back the way it was typed, whatever alphabet
 *  it is in. Anything outside ASCII goes as RFC 2047, or "مرحبا" arrives as
 *  mojibake. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`
}

/** A display name plus address, with only the name encoded. */
function encodeAddressList(list: string): string {
  return list.split(',').map(part => {
    const t = part.trim()
    if (!t) return ''
    const m = t.match(/^(.*?)\s*<([^>]+)>$/)
    if (!m) return t
    const name = m[1].replace(/^"|"$/g, '')
    return name ? `${encodeHeader(name)} <${m[2]}>` : `<${m[2]}>`
  }).filter(Boolean).join(', ')
}

const b64Lines = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join('\r\n')

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const boundary = `bpa_${crypto.randomUUID().replace(/-/g, '')}`
  const files = opts.attachments ?? []
  const text = stripHtml(opts.html)

  const head = [
    `To: ${encodeAddressList(opts.to)}`,
    opts.cc  ? `Cc: ${encodeAddressList(opts.cc)}`   : '',
    opts.bcc ? `Bcc: ${encodeAddressList(opts.bcc)}` : '',
    `Subject: ${encodeHeader(opts.subject)}`,
    opts.inReplyTo  ? `In-Reply-To: ${opts.inReplyTo}` : '',
    opts.references ? `References: ${opts.references}` : (opts.inReplyTo ? `References: ${opts.inReplyTo}` : ''),
    'MIME-Version: 1.0',
  ].filter(Boolean)

  let rfc: string
  if (files.length === 0) {
    rfc = [
      ...head,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(btoa(unescape(encodeURIComponent(text)))),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(btoa(unescape(encodeURIComponent(opts.html)))),
      `--${boundary}--`,
    ].join('\r\n')
  } else {
    const parts = [
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(btoa(unescape(encodeURIComponent(opts.html)))),
    ]
    for (const f of files) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${f.mime}; name="${f.name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${f.name}"`,
        '',
        b64Lines(f.data),
      )
    }
    parts.push(`--${boundary}--`)
    rfc = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join('\r\n')
  }

  await gFetch('/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      raw: encodeBase64url(rfc),
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
    }),
  }, opts.account)
}

/** Send a new email. Kept for callers that only ever wanted the simple case. */
export async function composeEmail(opts: {
  to: string; subject: string; body: string; account?: MailAccount
}): Promise<void> {
  await sendMail({ ...opts, html: escapeHtml(opts.body).replace(/\n/g, '<br>') })
}

/** Send a reply into its own thread. */
export async function sendReply(opts: {
  to: string; subject: string; body: string; threadId: string
  inReplyTo?: string; account?: MailAccount
}): Promise<void> {
  await sendMail({
    account: opts.account,
    to: opts.to,
    subject: /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject}`,
    html: escapeHtml(opts.body).replace(/\n/g, '<br>'),
    threadId: opts.threadId,
    inReplyTo: opts.inReplyTo,
  })
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}


// ─── The images inside a message ─────────────────────────────────────────────
//
// A signature's logo is not in the HTML: the HTML says `src="cid:image001@…"`
// and the bytes are an attachment part carrying that Content-ID. Nothing in a
// browser resolves a cid — the frame showed a broken-image glyph and whatever
// the sender put in `alt`, which for a mail client that inlined a picture is a
// run of base64. So the parts are fetched and put back where they belong.

export interface InlinePart {
  /** The Content-ID with its angle brackets stripped. */
  cid: string
  attachmentId: string
  mimeType: string
  size: number
}

/** Every image part this message refers to by cid. No network. */
export function inlineParts(msg: GmailMessage): InlinePart[] {
  const found: InlinePart[] = []
  const walk = (parts: GmailPart[] | undefined) => {
    for (const part of parts ?? []) {
      const cidHeader = part.headers?.find(h => h.name.toLowerCase() === 'content-id')?.value
      const cid = cidHeader?.trim().replace(/^<|>$/g, '')
      if (cid && part.body.attachmentId && part.mimeType.startsWith('image/')) {
        found.push({ cid, attachmentId: part.body.attachmentId, mimeType: part.mimeType, size: part.body.size })
      }
      walk(part.parts)
    }
  }
  walk(msg.payload.parts)
  return found
}

/** The bytes of one attachment part, base64url as Gmail stores them. */
export async function fetchAttachment(
  messageId: string, attachmentId: string, account?: MailAccount,
): Promise<string | null> {
  try {
    const data = await gFetch<{ data?: string }>(
      `/users/me/messages/${messageId}/attachments/${attachmentId}`, undefined, account)
    return data.data ?? null
  } catch { return null }
}

/** Each cid image as a data URI. Skips anything too big to be a signature. */
export async function loadInlineImages(
  msg: GmailMessage, account?: MailAccount, limit = 8, maxBytes = 2_000_000,
): Promise<Record<string, string>> {
  const parts = inlineParts(msg).filter(p => p.size <= maxBytes).slice(0, limit)
  const out: Record<string, string> = {}
  await Promise.all(parts.map(async p => {
    const data = await fetchAttachment(msg.id, p.attachmentId, account)
    if (!data) return
    out[p.cid] = `data:${p.mimeType};base64,${data.replace(/-/g, '+').replace(/_/g, '/')}`
  }))
  return out
}

/** Put the images back, and take out what is left over. An `<img>` whose
 *  source never resolved draws a broken glyph and its own alt text, which is
 *  worse than the space it was in. */
export function applyInlineImages(html: string, images: Record<string, string>): string {
  const resolved = html.replace(
    /src\s*=\s*(["'])\s*cid:([^"']+)\1/gi,
    (whole, quote: string, cid: string) => {
      const uri = images[cid.trim()] ?? images[cid.trim().replace(/^<|>$/g, '')]
      return uri ? `src=${quote}${uri}${quote}` : whole
    })
  // Whatever is still a cid — an image too large to fetch, or one the account
  // can no longer read — goes, tag and all.
  return resolved.replace(/<img\b[^>]*src\s*=\s*["']?\s*cid:[^>]*>/gi, '')
}

/** A data URI split across lines by the sending client is not a URI any more.
 *  Whitespace inside one is never meaningful, so it comes out. */
export function tidyDataUris(html: string): string {
  return html.replace(/(["'])(data:[^"']*base64,)([^"']*)\1/gi,
    (_m, quote: string, head: string, payload: string) => `${quote}${head}${payload.replace(/\s+/g, '')}${quote}`)
}
