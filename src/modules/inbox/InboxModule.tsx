
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Mail, Zap, Clock, Copy, CheckCheck, RefreshCw, ArrowRight, WifiOff, ListPlus, Plus, Archive, Search, X as XIcon, PenSquare, Reply, ReplyAll, Forward, ChevronDown, ChevronRight, Inbox, Send, FileEdit, Star, MailOpen, Sparkles } from 'lucide-react'

/** One glyph each, so the rail still says what it is when it is folded up. */
const FOLDER_ICON: Record<MailFolder, typeof Mail> = {
  unread: MailOpen, inbox: Inbox, sent: Send, drafts: FileEdit,
  starred: Star, archive: Archive, spam: Mail, trash: Mail,
}
import { triageEmail, call as askModel } from '@/lib/professor'
import type { EmailTriage, EmailData } from '@/lib/professor'
import { listUnreadThreadIds, getThread, getMessage, loadInlineImages, applyInlineImages, tidyDataUris, extractBody, extractHtmlBody, header, markAsRead, archiveMessage, sendReply, escapeHtml, FOLDER_QUERY, FOLDER_LABEL, FOLDER_SHOWS_RECIPIENT, type MailAccount, type MailFolder } from '@/lib/gmail'
import { mailAccounts, loadMailView, saveMailView, accountsFor, accountLabel, type MailView } from './mailAccounts'
import { Composer, type ComposeSeed, type ComposeMode } from './Composer'
import { signInWithGoogle } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { DbUser } from '@/types/database'
import { isMailHiddenByCompany } from '@/lib/companyVisibility'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailMessage {
  id: string
  fromName: string
  fromEmail: string
  body: string
  htmlBody?: string
  receivedAt: string
}

interface Email {
  id: string
  threadId: string
  /** Which mailbox this arrived in — the one it is archived in, and the one a
   *  reply leaves from. With several accounts open at once, nothing else can
   *  answer either question. */
  account: MailAccount
  fromName: string
  fromEmail: string
  to: string
  cc?: string
  subject: string
  preview: string
  body: string
  htmlBody?: string
  receivedAt: string
  inReplyTo?: string
  threadMessages: EmailMessage[]
}

/** Every action on an open message is the same shape: a round icon at the top
 *  right, beside the subject. Words in pills across the card was a row of
 *  buttons wider than most of the messages under it. */
const ICON_ACTION: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553',
  cursor: 'pointer', padding: 0,
}

interface TriageState {
  result: EmailTriage | null
  loading: boolean
  error: string | null
  copied: boolean
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const CLASS_META = {
  decision: { label: 'Decision Needed', color: '#7F77DD', bg: 'rgba(30,64,175,0.1)' },
  fyi:      { label: 'FYI',             color: '#7F77DD', bg: 'rgba(127,119,221,0.1)' },
  waiting:  { label: 'Waiting',         color: '#888780', bg: 'rgba(136,135,128,0.1)' },
  delegate: { label: 'Delegate',        color: '#1D9E75', bg: 'rgba(29,158,117,0.1)'  },
} as const

const URGENCY_META = {
  high:   { label: 'High',   color: '#E05252' },
  medium: { label: 'Medium', color: '#7F77DD' },
  low:    { label: 'Low',    color: '#888780' },
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#7F77DD','#7F77DD','#1D9E75','#E05252','#E0944A','#7C3AED','#0891B2','#059669']

/** A stable colour per mailbox. Merged, the list is several inboxes at once and
 *  the address alone is a line of grey text you have to read; a bar down the
 *  edge of the row is something you can see without reading. */
const ACCOUNT_COLORS = ['#2E3FBF', '#0C8140', '#C0761E', '#8B2FBF', '#C62828', '#3B7A8A']
function accountColor(email: string): string {
  let n = 0
  for (let i = 0; i < email.length; i++) n = (n * 31 + email.charCodeAt(i)) >>> 0
  return ACCOUNT_COLORS[n % ACCOUNT_COLORS.length]
}

function avatarColor(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function SenderAvatar({ name, email, size = 34 }: { name: string; email: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const bg = avatarColor(email)
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size < 30 ? 10 : 12, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>
      {initials}
    </div>
  )
}

function fmtRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function buildMockUser(user: { id: string; email: string; name?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo',
    email: user?.email ?? '',
    full_name: user?.name ?? null,
    avatar_url: null,
    active_framework: 'time_blocking',
    schedule_rules: {},
    created_at: new Date().toISOString(),
  }
}

// ─── HTML email renderer ──────────────────────────────────────────────────────

function EmailBodyFrame({ html, messageId, account }: {
  html: string
  /** With these two the frame can fetch the pictures the HTML refers to by
   *  cid — a signature's logo is an attachment, not part of the body. */
  messageId?: string
  account?: MailAccount
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [images, setImages] = useState<Record<string, string> | null>(null)

  // Asked for only when the message is actually on screen: a list of forty
  // would otherwise fetch four signatures apiece before you read one.
  useEffect(() => {
    if (!messageId || !/src\s*=\s*["']?\s*cid:/i.test(html)) { setImages(null); return }
    let live = true
    void (async () => {
      const msg = await getMessage(messageId, account).catch(() => null)
      if (!live || !msg) { if (live) setImages({}); return }
      const found = await loadInlineImages(msg, account)
      if (live) setImages(found)
    })()
    return () => { live = false }
  }, [messageId, account, html])

  // Until the pictures arrive the cid images are left alone — dropping them
  // first would make the body jump as each one landed.
  const body = images ? applyInlineImages(tidyDataUris(html), images) : tidyDataUris(html)

  // Inject base tag so relative links open in new tab, and a minimal reset
  const doc = `<!DOCTYPE html><html><head>
<base target="_blank">
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 12px 4px; font-family: -apple-system, sans-serif; font-size: 14px; line-height: 1.6; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #1E40AF; }
  pre, blockquote { white-space: pre-wrap; }
</style>
</head><body>${body}</body></html>`

  function onLoad() {
    const iframe = ref.current
    if (!iframe?.contentWindow) return
    try {
      const doc = iframe.contentWindow.document
      // A picture that will not load shows a broken glyph and its own alt text,
      // which in a mail client's signature is a run of base64. Nothing is
      // better than that.
      const hideBroken = () => {
        for (const img of Array.from(doc.images)) {
          if (img.complete && img.naturalWidth === 0) { img.alt = ''; img.style.display = 'none' }
        }
        iframe.style.height = `${Math.max(200, doc.body.scrollHeight + 24)}px`
      }
      for (const img of Array.from(doc.images)) {
        img.addEventListener('error', hideBroken)
        img.addEventListener('load', hideBroken)
      }
      hideBroken()
    } catch { /* cross-origin fallback */ }
  }

  return (
    <iframe
      ref={ref}
      srcDoc={doc}
      sandbox="allow-same-origin"
      onLoad={onLoad}
      title="Email body"
      style={{ width: '100%', minHeight: 200, border: 'none', borderRadius: 4, display: 'block' }}
    />
  )
}

// ─── Component ────────────────────────────────────────────────────────────────


/** Everyone on a message except you: the sender, plus whoever else was on it.
 *  Reply-all that quietly writes to yourself is worse than no reply-all. */
function replyAllTo(email: Email, mineAll: MailAccount[]): { to: string; cc: string } {
  // Every address that is yours, not just the mailbox it landed in: two of your
  // own accounts on one thread is common, and writing to the other one is still
  // writing to yourself.
  const mine = [email.account.email, ...mineAll.map(a => a.email)].map(e => e.toLowerCase())
  const addresses = (list: string) => list.split(',').map(a => a.trim()).filter(Boolean)
  const isMine = (a: string) => mine.some(m => a.toLowerCase().includes(m))
  const others = [...addresses(email.to), ...addresses(email.cc ?? '')]
    .filter(a => !isMine(a) && !a.toLowerCase().includes(email.fromEmail.toLowerCase()))
  return { to: email.fromEmail, cc: [...new Set(others)].join(', ') }
}

/** The original, as it will sit under the reply. */
function quoteOf(email: Email): string {
  const when = new Date(email.receivedAt).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const head = `On ${when}, ${escapeHtml(email.fromName)} &lt;${escapeHtml(email.fromEmail)}&gt; wrote:`
  const body = email.htmlBody ?? `<div>${escapeHtml(email.body).replace(/\n/g, '<br>')}</div>`
  return `<div style="font-size:12px;color:#6C6553;margin-bottom:8px">${head}</div>${body}`
}

function composeSeed(email: Email, mode: ComposeMode, accounts: MailAccount[]): ComposeSeed {
  const subject = email.subject.replace(/^((re|fwd?):\s*)+/i, '')
  if (mode === 'forward') {
    return {
      mode, account: email.account, to: '', subject: `Fwd: ${subject}`,
      quoted: quoteOf(email),
    }
  }
  const { to, cc } = mode === 'replyAll'
    ? replyAllTo(email, accounts)
    : { to: email.fromEmail, cc: '' }
  return {
    mode, account: email.account, to, cc: cc || undefined,
    subject: `Re: ${subject}`,
    quoted: quoteOf(email),
    threadId: email.threadId,
    inReplyTo: email.inReplyTo,
  }
}

export function InboxModule() {
  const user         = useAuthStore(s => s.user)
  const addTasksBatch = useTaskStore(s => s.addTasksBatch)

  const [emails,     setEmails]     = useState<Email[]>([])
  const [loading,    setLoading]    = useState(true)
  const [noAuth,     setNoAuth]     = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [triageMap,  setTriageMap]  = useState<Record<string, TriageState>>({})
  const [readIds,    setReadIds]    = useState<Set<string>>(new Set())
  const [archiving,  setArchiving]  = useState<string | null>(null)
  const [drafting,   setDrafting]   = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [replyText,  setReplyText]  = useState<Record<string, string>>({})
  const [sending,    setSending]    = useState<string | null>(null)
  const [sentIds,    setSentIds]    = useState<Set<string>>(new Set())
  const [expandedThread, setExpandedThread] = useState<string | null>(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [nextPageToken,  setNextPageToken]  = useState<string | undefined>(undefined)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set())
  const [batchArchiving, setBatchArchiving] = useState(false)

  // ── Bulk task state ──────────────────────────────────────────────────────────
  // Which mailbox, or all of them at once.
  const [view, setView] = useState<MailView>(loadMailView)
  // Which folder. Unread-in-inbox is what this module was, and stays the
  // default — it is the question the page exists to answer — but the rest of
  // the mailbox was simply unreachable.
  const [railOpen, setRailOpen] = useState(() => {
    try { return localStorage.getItem('mail-rail-open') !== 'false' } catch { return true }
  })
  const [folder, setFolder] = useState<MailFolder>(() => {
    try { return (localStorage.getItem('mail-folder') as MailFolder) || 'unread' } catch { return 'unread' }
  })
  const [compose, setCompose] = useState<ComposeSeed | null>(null)
  const [bulkOpen,   setBulkOpen]   = useState(false)
  const [bulkText,   setBulkText]   = useState('')
  const [bulkDone,   setBulkDone]   = useState(false)
  const bulkRef = useRef<HTMLTextAreaElement>(null)

  const bulkLines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)

  function handleBulkAdd() {
    if (!bulkLines.length) return
    addTasksBatch(bulkLines.map(title => ({
      title,
      quadrant: null,
      company:  'personal',
      status:   'open',
      completed: false,
    })))
    setBulkText('')
    setBulkDone(true)
    setTimeout(() => { setBulkDone(false); setBulkOpen(false) }, 1400)
  }

  // A hidden company's mail is hidden, matched the same way everywhere else
  const visibleEmails = useMemo(() =>
    emails.filter(e => !isMailHiddenByCompany({ from: e.fromEmail, to: e.to, accountEmail: user?.email }))
  , [emails, user?.email])

  const filteredEmails = searchQuery.trim()
    ? visibleEmails.filter(e => {
        const q = searchQuery.toLowerCase()
        return e.fromName.toLowerCase().includes(q) || e.fromEmail.toLowerCase().includes(q) ||
               e.subject.toLowerCase().includes(q)  || e.preview.toLowerCase().includes(q)
      })
    : visibleEmails

  const selectedEmail  = visibleEmails.find(e => e.id === selectedId) ?? null
  const selectedTriage = selectedId ? (triageMap[selectedId] ?? null) : null
  const triagedCount   = visibleEmails.filter(e => triageMap[e.id]?.result).length

  const accounts = useMemo(() => mailAccounts(user?.email), [user?.email])
  const viewed   = useMemo(() => accountsFor(view, accounts), [view, accounts])

  const loadEmails = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    setNoAuth(false)
    try {
      const boxes = accountsFor(view, mailAccounts(user?.email))
      if (boxes.length === 0) { setNoAuth(true); setEmails([]); return }
      // Every mailbox at once, and one that will not open does not take the
      // others down with it — it says which, and the rest still arrive.
      const perBox = await Promise.all(boxes.map(async account => {
        try {
          const { ids, nextPageToken } = await listUnreadThreadIds(20, undefined, account, FOLDER_QUERY[folder])
          const threads = await Promise.all(ids.map(id => getThread(id, account)))
          return { account, threads, nextPageToken, error: null as string | null }
        } catch (e) {
          return { account, threads: [], nextPageToken: undefined, error: e instanceof Error ? e.message : 'failed' }
        }
      }))
      const failures = perBox.filter(b => b.error)
      if (failures.length === boxes.length) throw new Error(failures[0].error ?? 'Failed to load emails.')
      if (failures.length > 0) {
        setFetchError(failures.map(f => `${f.account.email}: ${f.error}`).join(' · '))
      }
      setNextPageToken(perBox.find(b => b.nextPageToken)?.nextPageToken)
      const parsed: Email[] = perBox.flatMap(({ account, threads }) => threads.map(thread => {
        const msg     = thread.messages[thread.messages.length - 1]
        const headers = msg.payload.headers
        // In Sent and Drafts the interesting party is the recipient — a list of
        // your own name is not a mailbox view.
        const from    = FOLDER_SHOWS_RECIPIENT[folder]
          ? (header(headers, 'to') || header(headers, 'from'))
          : header(headers, 'from')
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</)
        return {
          id:          msg.id,
          threadId:    thread.id,
          account,
          fromName:    nameMatch ? nameMatch[1].trim() : from.split('@')[0],
          fromEmail:   from.match(/<(.+)>/)?.[1] ?? from,
          subject:     header(headers, 'subject') || '(no subject)',
          preview:     msg.snippet,
          to:          header(headers, 'to') || '',
          cc:          header(headers, 'cc') || undefined,
          body:        extractBody(msg),
          htmlBody:    extractHtmlBody(msg) ?? undefined,
          receivedAt:  new Date(parseInt(msg.internalDate)).toISOString(),
          inReplyTo:   header(headers, 'message-id') || undefined,
          threadMessages: thread.messages.slice(0, -1).map(m => {
            const mh = m.payload.headers
            const mFrom = header(mh, 'from')
            const mName = mFrom.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? mFrom.split('@')[0]
            return {
              id: m.id, fromName: mName, fromEmail: mFrom.match(/<(.+)>/)?.[1] ?? mFrom,
              body: extractBody(m), htmlBody: extractHtmlBody(m) ?? undefined,
              receivedAt: new Date(parseInt(m.internalDate)).toISOString(),
            }
          }),
        }
      }))
      // Newest first, whichever mailbox it came from — a merged inbox sorted by
      // account would be two inboxes drawn on top of each other.
      parsed.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      setEmails(parsed)
      if (parsed.length > 0) setSelectedId(parsed[0].id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load emails.'
      if (msg.includes('No Google access token') || msg.includes('sign in')) {
        setNoAuth(true)
      } else {
        setFetchError(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [view, folder, user?.email])

  useEffect(() => { void loadEmails() }, [loadEmails])

  const handleTriage = useCallback(async (email: Email) => {
    setTriageMap(prev => ({
      ...prev,
      [email.id]: { result: null, loading: true, error: null, copied: false },
    }))
    try {
      const dbUser = buildMockUser(user)
      const emailData: EmailData = {
        user: dbUser,
        companies: [],
        subject:   email.subject,
        fromEmail: email.fromEmail,
        body:      email.body,
        receivedAt: email.receivedAt,
      }
      const result = await triageEmail(emailData)
      setTriageMap(prev => ({
        ...prev,
        [email.id]: { result, loading: false, error: null, copied: false },
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Triage failed.'
      setTriageMap(prev => ({
        ...prev,
        [email.id]: { result: null, loading: false, error: msg, copied: false },
      }))
    }
  }, [user])

  const handleCopyReply = (emailId: string, reply: string) => {
    void navigator.clipboard.writeText(reply).then(() => {
      setTriageMap(prev => ({ ...prev, [emailId]: { ...prev[emailId], copied: true } }))
      setTimeout(() => {
        setTriageMap(prev => ({ ...prev, [emailId]: { ...prev[emailId], copied: false } }))
      }, 2000)
    })
  }

  // ── A reply, already written ────────────────────────────────────────────────
  // The Professor reads the message that is open — the whole thread where there
  // is one — and writes the reply you would have had to start from a blank
  // line. It lands in the composer as a draft: the address, the subject and the
  // quote are the ordinary reply's, and nothing is sent.
  const draftWithAI = useCallback(async (email: Email) => {
    setDrafting(email.id); setDraftError(null)
    try {
      const thread = [...email.threadMessages]
        .map(m => `${m.fromName} <${m.fromEmail}>:\n${m.body}`)
        .concat(`${email.fromName} <${email.fromEmail}>:\n${email.body}`)
        .join('\n\n---\n\n')
        .slice(0, 6000)
      const written = await askModel(
        'You are drafting a reply on behalf of the account holder. Write only the reply body — '
        + 'no subject line, no "Subject:", no greeting placeholders like [Name], no sign-off block. '
        + 'Match the tone of the message you are answering, keep it short, and answer what was actually asked. '
        + 'Plain sentences and paragraphs, no markdown.',
        `Reply to this message${email.subject ? ` (subject: ${email.subject})` : ''}:\n\n${thread}`,
      )
      const html = escapeHtml(written.trim())
        .split(/\n{2,}/).map(p => `<div>${p.replace(/\n/g, '<br>')}</div>`).join('<div><br></div>')
      setCompose({ ...composeSeed(email, 'reply', accounts), draft: html })
    } catch (e) {
      // A missing key must not blank the message you were reading: the error
      // belongs beside the button that caused it.
      setDraftError(e instanceof Error ? e.message : 'The Professor could not write that draft.')
    } finally { setDrafting(null) }
  }, [accounts])

  const handleArchive = useCallback(async (email: Email) => {
    setArchiving(email.id)
    try {
      await archiveMessage(email.id, email.account)
      setEmails(prev => {
        const next = prev.filter(e => e.id !== email.id)
        setSelectedId(next.length > 0 ? next[0].id : null)
        return next
      })
    } catch { /* offline — leave in list */ }
    finally { setArchiving(null) }
  }, [])

  const handleSendReply = useCallback(async (email: Email) => {
    const body = replyText[email.id]?.trim()
    if (!body) return
    setSending(email.id)
    try {
      await sendReply({ to: email.fromEmail, subject: email.subject, body, threadId: email.threadId, inReplyTo: email.inReplyTo, account: email.account })
      setSentIds(prev => new Set([...prev, email.id]))
      setReplyText(prev => ({ ...prev, [email.id]: '' }))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send reply.')
    } finally { setSending(null) }
  }, [replyText])


  const handleLoadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return
    setLoadingMore(true)
    try {
      // A page token belongs to one mailbox; when several are open, more
      // arrives from the one that had more to give.
      const box = viewed.length === 1 ? viewed[0] : (emails[emails.length - 1]?.account ?? viewed[0])
      const { ids, nextPageToken: npt } = await listUnreadThreadIds(20, nextPageToken, box, FOLDER_QUERY[folder])
      setNextPageToken(npt)
      const threads = await Promise.all(ids.map(id => getThread(id, box)))
      const parsed: Email[] = threads.map(thread => {
        const msg = thread.messages[thread.messages.length - 1]
        const headers = msg.payload.headers
        const from = header(headers, 'from')
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</)
        return {
          id: msg.id, threadId: thread.id, account: box,
          fromName:  nameMatch ? nameMatch[1].trim() : from.split('@')[0],
          fromEmail: from.match(/<(.+)>/)?.[1] ?? from,
          to: header(headers, 'to') || '', cc: header(headers, 'cc') || undefined,
          subject:   header(headers, 'subject') || '(no subject)',
          preview:   msg.snippet,
          body: extractBody(msg), htmlBody: extractHtmlBody(msg) ?? undefined,
          receivedAt: new Date(parseInt(msg.internalDate)).toISOString(),
          inReplyTo:  header(headers, 'message-id') || undefined,
          threadMessages: thread.messages.slice(0, -1).map(m => {
            const mh = m.payload.headers
            const mFrom = header(mh, 'from')
            const mName = mFrom.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? mFrom.split('@')[0]
            return { id: m.id, fromName: mName, fromEmail: mFrom.match(/<(.+)>/)?.[1] ?? mFrom, body: extractBody(m), htmlBody: extractHtmlBody(m) ?? undefined, receivedAt: new Date(parseInt(m.internalDate)).toISOString() }
          }),
        }
      })
      setEmails(prev => [...prev, ...parsed])
    } catch { /* offline */ }
    finally { setLoadingMore(false) }
  }, [nextPageToken, loadingMore, viewed, emails, folder])

  async function handleBatchArchive() {
    if (!selectedIds.size || batchArchiving) return
    setBatchArchiving(true)
    try {
      // Each one goes back to the mailbox it came from.
      const boxOf = new Map(emails.map(e => [e.id, e.account]))
      await Promise.all([...selectedIds].map(id => archiveMessage(id, boxOf.get(id)).catch(() => {})))
      setEmails(prev => {
        const next = prev.filter(e => !selectedIds.has(e.id))
        setSelectedId(next.length > 0 ? next[0].id : null)
        return next
      })
      setSelectedIds(new Set())
    } finally { setBatchArchiving(false) }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────


  /** The folders, as a list down the left rather than a row of pills: it is a
   *  place you go, and a place is a menu item. It folds away to its icons on a
   *  narrow screen, or when you would rather have the width. */
  function renderFolders() {
    const ORDER: MailFolder[] = ['unread', 'inbox', 'sent', 'drafts', 'starred', 'archive']
    return (
      <nav style={{
        background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12,
        padding: 6, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <button
          onClick={() => { const v = !railOpen; setRailOpen(v); try { localStorage.setItem('mail-rail-open', String(v)) } catch { /* quota */ } }}
          title={railOpen ? 'Collapse' : 'Expand'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px',
            borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#9B9180', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
          {railOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {railOpen && 'Folders'}
        </button>
        {ORDER.map(f => {
          const on = folder === f
          const Icon = FOLDER_ICON[f]
          return (
            <button key={f}
              onClick={() => {
                setFolder(f); setSelectedId(null)
                try { localStorage.setItem('mail-folder', f) } catch { /* quota */ }
              }}
              title={FOLDER_LABEL[f]}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                height: 32, padding: railOpen ? '0 10px' : 0,
                justifyContent: railOpen ? 'flex-start' : 'center',
                borderRadius: 8, cursor: 'pointer', border: 'none',
                background: on ? '#191712' : 'transparent',
                color: on ? '#FDF8E7' : '#6C6553',
                fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 500,
                whiteSpace: 'nowrap',
              }}>
              <Icon size={14} strokeWidth={1.9} style={{ flexShrink: 0 }} />
              {railOpen && FOLDER_LABEL[f]}
            </button>
          )
        })}
      </nav>
    )
  }

  function renderLeft() {
    if (loading) {
      return (
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, overflow: 'hidden' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ padding: '16px 18px', borderBottom: i < 3 ? '1px solid #E8E1CE' : 'none' }}>
              <div style={{ height: 12, borderRadius: 6, background: 'linear-gradient(90deg, #E8E1CE 25%, var(--sb-accent-border) 50%, #E8E1CE 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s infinite', marginBottom: 8, width: '60%' }} />
              <div style={{ height: 10, borderRadius: 6, background: 'linear-gradient(90deg, #E8E1CE 25%, var(--sb-accent-border) 50%, #E8E1CE 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s infinite', width: '80%' }} />
            </div>
          ))}
        </div>
      )
    }

    if (noAuth || visibleEmails.length === 0) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6C6553', pointerEvents: 'none' }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search emails…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px 8px 30px', borderRadius: 8, background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712', fontSize: 12.5, outline: 'none' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 2, display: 'flex' }}>
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* Batch action bar */}
        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(30,64,175,0.08)', border: '1px solid rgba(30,64,175,0.2)', borderRadius: 8 }}>
            <span style={{ fontSize: 12, color: '#7F77DD', fontWeight: 500, flex: 1 }}>{selectedIds.size} selected</span>
            <button onClick={() => void handleBatchArchive()} disabled={batchArchiving}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(30,64,175,0.3)', color: '#7F77DD', fontSize: 12, cursor: 'pointer', opacity: batchArchiving ? 0.5 : 1 }}>
              <Archive size={11} /> Archive all
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 2, display: 'flex' }}>
              <XIcon size={13} />
            </button>
          </div>
        )}

        <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, overflow: 'hidden' }}>
        {filteredEmails.length === 0 && searchQuery ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#6C6553', fontSize: 12.5 }}>
            No emails match "{searchQuery}"
          </div>
        ) : filteredEmails.map((email, i) => {
          // Several mailboxes on screen at once is the case the colour is for.
          const multi = view === 'all' && accounts.length > 1
          const isSelected = selectedId === email.id
          const isRead     = readIds.has(email.id)
          const triage     = triageMap[email.id]
          const classMeta  = triage?.result ? CLASS_META[triage.result.classification] : null
          return (
            <button
              key={email.id}
              onClick={() => {
                setSelectedId(email.id)
                if (!readIds.has(email.id)) {
                  setReadIds(prev => new Set([...prev, email.id]))
                  void markAsRead(email.id, email.account).catch(() => { /* offline */ })
                }
              }}
              style={{
                width: '100%', padding: '7px 11px', textAlign: 'left',
                background: isSelected ? 'rgba(30,64,175,0.06)' : 'transparent',
                border: 'none',
                borderBottom: i < visibleEmails.length - 1 ? '1px solid #F0EBDC' : 'none',
                // The bar is the mailbox when several are merged, and the
                // selection when only one is on screen.
                borderLeft: `3px solid ${
                  isSelected ? '#1E40AF'
                  : multi ? accountColor(email.account.email)
                  : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}
                  onClick={ev => { ev.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); n.has(email.id) ? n.delete(email.id) : n.add(email.id); return n }) }}>
                  {selectedIds.has(email.id)
                    ? <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#7F77DD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckCheck size={13} color="#fff" /></div>
                    : <SenderAvatar name={email.fromName} email={email.fromEmail} size={26} />
                  }
                  {!isRead && !selectedIds.has(email.id) && <div style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: '#7F77DD', border: '2px solid #FFFFFF' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: isRead ? 400 : 700, color: isRead ? '#6C6553' : '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }}>
                      {email.fromName}
                    </span>
                    {classMeta && (
                      <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 3, flexShrink: 0, background: classMeta.bg, color: classMeta.color, fontWeight: 600 }}>
                        {classMeta.label}
                      </span>
                    )}
                    {triage?.loading && (
                      <RefreshCw size={10} color="#7F77DD" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: isRead ? '#6C6553' : '#191712', fontWeight: isRead ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
                    {email.subject}
                    <span style={{ fontWeight: 400, color: '#9B9180' }}> — {email.preview}</span>
                  </p>
                </div>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
                  {/* Which mailbox, when more than one is on screen — in that
                      mailbox's own colour, so the bar down the edge and the
                      address say the same thing. */}
                  {multi && (
                    <span title={email.account.email} style={{
                      fontSize: 9, fontWeight: 600, color: accountColor(email.account.email),
                      maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{accountLabel(email.account.email, email.account.isPrimary)}</span>
                  )}
                  <span style={{ fontSize: 10, color: '#9B9180' }}>
                  {fmtRelTime(email.receivedAt)}
                  </span>
                </span>
              </div>
            </button>
          )
        })}
        </div>

        {nextPageToken && (
          <button
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            style={{ width: '100%', padding: '9px', borderRadius: 8, background: 'transparent', border: '1px dashed #E8E1CE', color: '#6C6553', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: loadingMore ? 0.5 : 1 }}
          >
            <RefreshCw size={12} style={{ animation: loadingMore ? 'spin 1s linear infinite' : 'none' }} />
            {loadingMore ? 'Loading…' : 'Load more emails'}
          </button>
        )}
      </div>
    )
  }

  function renderRight() {
    if (noAuth) {
      return (
        <div style={{
          background: '#FFFFFF', border: '1px dashed #E8E1CE',
          borderRadius: 12, padding: '48px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          textAlign: 'center',
        }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(30,64,175,0.08)', border: '1px solid rgba(30,64,175,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <WifiOff size={22} color="#7F77DD" />
          </div>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#191712', fontFamily: "'Cabinet Grotesk', sans-serif" }}>
              Connect Gmail
            </p>
            <p style={{ margin: 0, fontSize: 13, color: '#6C6553', lineHeight: 1.6, maxWidth: 320 }}>
              Sign in with Google to load your real unread emails and triage them with AI.
            </p>
          </div>
          <button
            onClick={() => void signInWithGoogle()}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 22px', borderRadius: 8,
              background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)',
              color: '#7F77DD', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <Mail size={14} /> Connect Google Account
          </button>
        </div>
      )
    }

    if (fetchError) {
      return (
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, padding: '32px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#191712' }}>{fetchError}</p>
          <button onClick={() => void loadEmails()} style={{ padding: '7px 18px', borderRadius: 8, background: 'rgba(var(--sb-accent-rgb),0.12)', border: '1px solid #1E40AF30', color: '#7F77DD', fontSize: 12, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )
    }

    if (loading || !selectedEmail) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Email body */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, padding: '18px 22px' }}>
          {/* Subject on the left, everything you can do to the message on the
              right — as icons, the way the task panel does it. Four words in
              four pills was a row of buttons the width of the card. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
            <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 18, fontWeight: 700, color: '#191712', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px', lineHeight: 1.25 }}>
              {selectedEmail.subject}
            </p>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {([
                { mode: 'reply'    as ComposeMode, label: 'Reply',      Icon: Reply },
                { mode: 'replyAll' as ComposeMode, label: 'Reply all',  Icon: ReplyAll },
                { mode: 'forward'  as ComposeMode, label: 'Forward',    Icon: Forward },
              ]).map(({ mode, label, Icon }) => {
                const on = compose?.mode === mode && compose.threadId === selectedEmail.threadId
                return (
                  <button key={mode}
                    onClick={() => setCompose(on ? null : composeSeed(selectedEmail, mode, accounts))}
                    title={label} aria-label={label} aria-pressed={on}
                    style={{
                      ...ICON_ACTION,
                      background: on ? '#191712' : 'transparent',
                      border: `1px solid ${on ? '#191712' : '#E8E1CE'}`,
                      color: on ? '#FDF8E7' : '#6C6553',
                    }}>
                    <Icon size={14} />
                  </button>
                )
              })}
              {/* A reply the Professor has already written — you open the
                  composer on a draft rather than on a blank line. It is a
                  draft, not a send: nothing leaves until you press Send. */}
              <button
                onClick={() => void draftWithAI(selectedEmail)}
                disabled={drafting === selectedEmail.id}
                title={drafting === selectedEmail.id ? 'Writing a draft…' : 'Draft a reply with AI'}
                aria-label="Draft a reply with AI"
                style={{
                  ...ICON_ACTION,
                  background: drafting === selectedEmail.id ? 'var(--sb-accent)' : 'transparent',
                  border: `1px solid ${drafting === selectedEmail.id ? 'var(--sb-accent)' : '#E8E1CE'}`,
                  color: drafting === selectedEmail.id ? '#191712' : '#6C6553',
                }}>
                <Sparkles size={14} />
              </button>
              <button
                onClick={() => void handleArchive(selectedEmail)}
                disabled={archiving === selectedEmail.id}
                title="Archive" aria-label="Archive"
                style={{ ...ICON_ACTION, opacity: archiving === selectedEmail.id ? 0.5 : 1 }}>
                <Archive size={14} />
              </button>
            </div>
          </div>
          {draftError && (
            <p style={{
              margin: '0 0 8px', fontSize: 11.5, lineHeight: 1.5, color: '#C62828',
              background: 'rgba(198,40,40,0.06)', border: '1px solid rgba(198,40,40,0.25)',
              borderRadius: 8, padding: '7px 10px',
            }}>{draftError}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: '#7F77DD', fontWeight: 600 }}>{selectedEmail.fromName}</span>
              <span style={{ fontSize: 12, color: '#6C6553' }}>{`<${selectedEmail.fromEmail}>`}</span>
              <span style={{ fontSize: 11, color: '#6C6553', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <Clock size={10} />{fmtRelTime(selectedEmail.receivedAt)}
              </span>
              {accounts.length > 1 && (
                <span title={`In ${selectedEmail.account.email}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
                    borderRadius: 999, background: '#FAF7EC', border: '1px solid #E8E1CE',
                    fontSize: 10.5, color: '#6C6553', flexShrink: 0,
                  }}>{accountLabel(selectedEmail.account.email, selectedEmail.account.isPrimary)}</span>
              )}

            </div>
            {selectedEmail.to && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', lineHeight: 1.35 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6C6553', minWidth: 18 }}>To</span>
                <span style={{ fontSize: 11.5, color: '#6C6553', wordBreak: 'break-word' }}>{selectedEmail.to}</span>
              </div>
            )}
            {selectedEmail.cc && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6C6553', minWidth: 18 }}>CC</span>
                <span style={{ fontSize: 11.5, color: '#6C6553', wordBreak: 'break-word' }}>{selectedEmail.cc}</span>
              </div>
            )}
          </div>

          {compose && compose.mode !== 'new' && (
            <div style={{ marginBottom: 14 }}>
              <Composer
                seed={compose}
                accounts={accounts}
                onClose={() => setCompose(null)}
                onSent={() => { setCompose(null); setSentIds(prev => new Set(prev).add(selectedEmail.id)) }}
              />
            </div>
          )}

          {/* Thread history — older messages */}
          {selectedEmail.threadMessages.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={() => setExpandedThread(v => v === selectedEmail.id ? null : selectedEmail.id)}
                style={{ fontSize: 11.5, color: '#6C6553', background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {expandedThread === selectedEmail.id ? '▲' : '▼'} {selectedEmail.threadMessages.length} earlier message{selectedEmail.threadMessages.length > 1 ? 's' : ''} in thread
              </button>
              {expandedThread === selectedEmail.id && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedEmail.threadMessages.map(m => (
                    <div key={m.id} style={{ borderLeft: '3px solid #E8E1CE', paddingLeft: 14 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#7F77DD' }}>{m.fromName}</span>
                        <span style={{ fontSize: 11, color: '#6C6553' }}>{fmtRelTime(m.receivedAt)}</span>
                      </div>
                      {m.htmlBody
                        ? <EmailBodyFrame html={m.htmlBody} messageId={m.id} account={selectedEmail.account} />
                        : <p style={{ margin: 0, fontSize: 12.5, color: '#6C6553', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ height: 1, background: '#E8E1CE', marginBottom: 16 }} />
          {selectedEmail.htmlBody ? (
            <EmailBodyFrame html={selectedEmail.htmlBody} messageId={selectedEmail.id} account={selectedEmail.account} />
          ) : (
            <p style={{ margin: 0, fontSize: 13.5, color: '#191712', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {selectedEmail.body}
            </p>
          )}
        </div>

        {/* Triage panel */}
        {selectedTriage?.loading ? (
          <div style={{ background: '#FFFFFF', border: '1px solid rgba(30,64,175,0.2)', borderRadius: 12, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={15} color="#7F77DD" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, color: '#7F77DD' }}>The Professor is analyzing this email…</span>
          </div>

        ) : selectedTriage?.error ? (
          <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, padding: '20px 24px' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#191712' }}>{selectedTriage.error}</p>
            <button onClick={() => void handleTriage(selectedEmail)} style={{ padding: '7px 14px', borderRadius: 7, background: 'rgba(var(--sb-accent-rgb),0.12)', border: '1px solid #1E40AF30', color: '#7F77DD', fontSize: 12, cursor: 'pointer' }}>
              Try again
            </button>
          </div>

        ) : selectedTriage?.result ? (
          <div style={{ background: 'rgba(30,64,175,0.05)', border: '1px solid rgba(30,64,175,0.2)', borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <div style={{ width: 24, height: 24, borderRadius: 5, background: 'rgba(30,64,175,0.15)', border: '1px solid rgba(30,64,175,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={12} color="#7F77DD" />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#7F77DD', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                The Professor's Triage
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
              <div style={{ flex: 1, padding: '12px 14px', background: CLASS_META[selectedTriage.result.classification].bg, border: `1px solid ${CLASS_META[selectedTriage.result.classification].color}30`, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#9B9180', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Classification</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: CLASS_META[selectedTriage.result.classification].color }}>
                  {CLASS_META[selectedTriage.result.classification].label}
                </div>
              </div>
              <div style={{ flex: 1, padding: '12px 14px', background: '#F7F4EA', border: `1px solid ${URGENCY_META[selectedTriage.result.urgency].color}30`, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#9B9180', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Urgency</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: URGENCY_META[selectedTriage.result.urgency].color }}>
                  {URGENCY_META[selectedTriage.result.urgency].label}
                </div>
              </div>
              {selectedTriage.result.followUpDate && (
                <div style={{ flex: 1, padding: '12px 14px', background: '#F7F4EA', border: '1px solid #E8E1CE', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#9B9180', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Follow Up</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#191712' }}>{selectedTriage.result.followUpDate}</div>
                </div>
              )}
            </div>

            {selectedTriage.result.suggestedReply && (() => {
              const draft = replyText[selectedEmail.id] ?? selectedTriage.result.suggestedReply
              const isSent = sentIds.has(selectedEmail.id)
              return (
                <div style={{ background: '#F7F4EA', border: '1px solid #E8E1CE', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Reply to {selectedEmail.fromName}
                    </span>
                    <button
                      onClick={() => handleCopyReply(selectedEmail.id, draft)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 5, background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 11, cursor: 'pointer' }}
                    >
                      {selectedTriage.copied ? <><CheckCheck size={10} /><span>Copied</span></> : <><Copy size={10} /><span>Copy</span></>}
                    </button>
                  </div>
                  <textarea
                    value={draft}
                    onChange={e => setReplyText(prev => ({ ...prev, [selectedEmail.id]: e.target.value }))}
                    rows={6}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 6, resize: 'vertical', background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712', fontSize: 13, lineHeight: 1.65, fontFamily: 'inherit', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    {isSent ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#1D9E75', fontWeight: 500 }}>
                        <CheckCheck size={13} /> Sent!
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleSendReply(selectedEmail)}
                        disabled={!draft.trim() || sending === selectedEmail.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 18px', borderRadius: 7, background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)', color: '#7F77DD', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: sending === selectedEmail.id ? 0.5 : 1 }}
                      >
                        {sending === selectedEmail.id
                          ? <><RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                          : <><ArrowRight size={11} /> Send Reply</>}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>

        ) : (
          <div style={{ background: '#FFFFFF', border: '1px dashed #E8E1CE', borderRadius: 12, padding: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(30,64,175,0.08)', border: '1px solid rgba(30,64,175,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={18} color="#7F77DD" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: '0 0 5px', fontSize: 14, color: '#191712', fontWeight: 500 }}>Let The Professor triage this</p>
              <p style={{ margin: 0, fontSize: 12.5, color: '#6C6553' }}>Get classification, urgency level, and a ready-to-send reply</p>
            </div>
            <button
              onClick={() => void handleTriage(selectedEmail)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)', color: '#7F77DD', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              <Zap size={13} /> Triage with AI <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <div>

      <style>{`
        @keyframes spin    { from { transform: rotate(0deg)  } to { transform: rotate(360deg) } }
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
      `}</style>

      <div style={{ padding: '24px 28px' }}>

        {/* Stats bar */}
        {!noAuth && (
          <div style={{ display: 'flex', gap: 20, marginBottom: bulkOpen ? 10 : 20, padding: '13px 20px', background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Mail size={14} color="#7F77DD" />
              <span style={{ fontSize: 13, color: '#191712' }}>{loading ? '…' : visibleEmails.length} unread</span>
            </div>
            <div style={{ width: 1, height: 14, background: '#E8E1CE' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Zap size={14} color="#1D9E75" />
              <span style={{ fontSize: 13, color: '#191712' }}>{triagedCount} triaged</span>
            </div>
            {accounts.length > 1 && (
              <>
                <div style={{ width: 1, height: 14, background: '#E8E1CE' }} />
                {/* All of them, or one. A merged inbox is the useful default —
                    the question "what is waiting for me" does not stop at an
                    account boundary — but answering it must not hide which
                    mailbox a message is in. */}
                <div role="group" aria-label="Which mailbox"
                  style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
                  {[{ id: 'all', label: 'All' }, ...accounts.map(a => ({ id: a.email, label: accountLabel(a.email, a.isPrimary) }))].map(opt => {
                    const on = view === opt.id
                    return (
                      <button key={opt.id}
                        onClick={() => { setView(opt.id); saveMailView(opt.id); setSelectedId(null) }}
                        title={opt.id === 'all' ? 'Every account at once' : opt.id}
                        style={{
                          height: 24, padding: '0 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 11.5, fontWeight: on ? 600 : 500,
                          background: on ? '#FFFFFF' : 'transparent', color: on ? '#191712' : '#6C6553',
                          boxShadow: on ? '0 1px 3px rgba(25,23,18,0.16)' : 'none',
                          maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  const box = viewed[0] ?? accounts[0]
                  if (box) setCompose({ mode: 'new', account: box, to: '', subject: '' })
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, background: compose?.mode === 'new' ? 'rgba(30,64,175,0.12)' : 'transparent', border: `1px solid ${compose?.mode === 'new' ? 'rgba(30,64,175,0.3)' : '#E8E1CE'}`, color: compose?.mode === 'new' ? '#7F77DD' : '#6C6553', fontSize: 12, cursor: 'pointer' }}
              >
                <PenSquare size={12} /> Compose
              </button>
              <button
                onClick={() => { setBulkOpen(o => !o); setBulkText(''); setBulkDone(false); setTimeout(() => bulkRef.current?.focus(), 50) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, background: bulkOpen ? 'rgba(29,158,117,0.12)' : 'transparent', border: `1px solid ${bulkOpen ? 'rgba(29,158,117,0.3)' : '#E8E1CE'}`, color: bulkOpen ? '#1D9E75' : '#6C6553', fontSize: 12, cursor: 'pointer' }}
              >
                <ListPlus size={12} /> Bulk add tasks
              </button>
              <button
                onClick={() => void loadEmails()}
                disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 12, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}
              >
                <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                Refresh
              </button>
              {selectedEmail && (
                <button
                  onClick={() => void handleTriage(selectedEmail)}
                  disabled={triageMap[selectedEmail.id]?.loading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)', color: '#7F77DD', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: triageMap[selectedEmail.id]?.loading ? 0.5 : 1 }}
                >
                  <Zap size={12} /> Triage with AI
                </button>
              )}
            </div>
          </div>
        )}

        {/* Compose panel */}
        {/* A new message uses the same panel as a reply, because it is the
            same act with fewer fields filled in. */}
        {compose?.mode === 'new' && (
          <div style={{ marginBottom: 12 }}>
            <Composer
              seed={compose}
              accounts={accounts}
              onClose={() => setCompose(null)}
              onSent={() => setCompose(null)}
            />
          </div>
        )}

        {/* Bulk task input panel */}
        {bulkOpen && (
          <div style={{ marginBottom: 20, padding: '16px 20px', background: '#FFFFFF', border: '1px solid rgba(29,158,117,0.25)', borderRadius: 10 }}>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#6C6553' }}>
              Paste or type tasks — one per line. All land in your task inbox.
            </p>
            <textarea
              ref={bulkRef}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleBulkAdd() }}
              placeholder={'Follow up with John\nReview Q2 report\nSchedule team sync'}
              rows={5}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 8, resize: 'vertical',
                background: '#F7F4EA', border: '1px solid #E8E1CE',
                color: '#191712', fontSize: 13, lineHeight: 1.6,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: '#6C6553' }}>
                {bulkLines.length > 0 ? `${bulkLines.length} task${bulkLines.length > 1 ? 's' : ''} ready` : 'Paste or type tasks above'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setBulkOpen(false); setBulkText('') }}
                  style={{ padding: '7px 14px', borderRadius: 7, background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 12, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkAdd}
                  disabled={bulkLines.length === 0 || bulkDone}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, background: bulkDone ? 'rgba(29,158,117,0.15)' : 'rgba(29,158,117,0.12)', border: `1px solid ${bulkDone ? 'rgba(29,158,117,0.5)' : 'rgba(29,158,117,0.3)'}`, color: '#1D9E75', fontSize: 12, fontWeight: 500, cursor: bulkLines.length === 0 ? 'default' : 'pointer', opacity: bulkLines.length === 0 ? 0.4 : 1, transition: 'all 0.15s' }}
                >
                  {bulkDone
                    ? <><CheckCheck size={12} /> Added!</>
                    : <><Plus size={12} /> Add {bulkLines.length > 0 ? `${bulkLines.length} ` : ''}task{bulkLines.length !== 1 ? 's' : ''}</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main grid — only show two-column layout when we have emails */}
        {noAuth || fetchError ? (
          <div style={{ maxWidth: 520, margin: '40px auto' }}>{renderRight()}</div>
        ) : (
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: `${railOpen ? 156 : 46}px ${visibleEmails.length > 0 ? '360px ' : ''}1fr`,
          }}>
            {renderFolders()}
            {renderLeft()}
            {renderRight()}
          </div>
        )}
      </div>
    </div>
  )
}
