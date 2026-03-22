import { supabase } from './supabase'

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

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.provider_token ?? localStorage.getItem('google_provider_token')
  if (!token) throw new Error('No Google access token — please sign in with Google.')
  return token
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function gFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken()
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

/** Return the IDs of up to `max` unread threads. */
export async function listUnreadThreadIds(max = 20): Promise<string[]> {
  const data = await gFetch<{ threads?: { id: string }[] }>(
    `/users/me/threads?q=is:unread in:inbox&maxResults=${max}`,
  )
  return (data.threads ?? []).map(t => t.id)
}

/** Fetch a full thread (all messages). */
export async function getThread(threadId: string): Promise<GmailThread> {
  return gFetch<GmailThread>(`/users/me/threads/${threadId}?format=full`)
}

/** Archive a message (remove INBOX label). Requires gmail.modify scope. */
export async function archiveMessage(messageId: string): Promise<void> {
  await gFetch(`/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
  })
}

/** Send a reply. Requires gmail.send scope. */
export async function sendReply(opts: {
  to: string
  subject: string
  body: string
  threadId: string
  inReplyTo?: string
}): Promise<void> {
  const subj = opts.subject.replace(/^(re:\s*)+/i, '')
  const rfc = [
    `To: ${opts.to}`,
    `Subject: Re: ${subj}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : '',
    opts.inReplyTo ? `References: ${opts.inReplyTo}` : '',
    '',
    opts.body,
  ].filter((l, i) => l !== '' || i >= 6).join('\r\n')

  await gFetch('/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: encodeBase64url(rfc), threadId: opts.threadId }),
  })
}
