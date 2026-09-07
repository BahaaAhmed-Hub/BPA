import { supabase } from './supabase'
import { getGoogleToken } from './tokenManager'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GmailHeader { name: string; value: string }

export interface GmailPart {
  mimeType: string
  body: { data?: string; size: number }
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
