
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { AVATAR_COLORS, ACCOUNT_COLORS } from '@/lib/palettes'
import { Mail, Zap, Clock, Copy, CheckCheck, RefreshCw, ArrowRight, WifiOff, ListPlus, Plus, Archive, Search, X as XIcon, PenSquare, Reply, ReplyAll, Forward, ChevronDown, ChevronRight, Inbox, FolderInput, Send, FileEdit, Star, MailOpen, Sparkles, AlertTriangle, GitBranch, Info, UserPlus, Minus, Check, Trash2 } from 'lucide-react'

/** One glyph each, so the rail still says what it is when it is folded up. */
const FOLDER_ICON: Record<MailFolder, typeof Mail> = {
  unread: MailOpen, inbox: Inbox, sent: Send, drafts: FileEdit,
  starred: Star, archive: Archive, spam: Mail, trash: Mail,
}
import { triageEmail, briefInbox, call as askModel } from '@/lib/professor'
import { notify, pushUndo } from '@/lib/undo'
import { inkOn } from '@/lib/ink'
import type { EmailTriage, EmailData } from '@/lib/professor'
import { classifyMail, unsubscribeLink, CLASSES, CLASS_INFO, countByClass, type MailClass } from '@/lib/mailClasses'
import { looksLikeInvitation } from '@/lib/invitations'
import { listUnreadThreadIds, getThread, getMessage, loadInlineImages, applyInlineImages, tidyDataUris, extractBody, extractHtmlBody, header, markAsRead, markAsUnread, archiveMessage, unarchiveMessage, trashMessage, untrashMessage, listLabels, batchModify, sendReply, escapeHtml, FOLDER_QUERY, FOLDER_LABEL, FOLDER_SHOWS_RECIPIENT, type MailAccount, type MailFolder, type GmailHeader, type GmailLabel } from '@/lib/gmail'
import { cachedDraft } from '@/lib/mailBriefs'
import { mailAccounts, loadMailView, saveMailView, accountsFor, accountLabel, type MailView } from './mailAccounts'
import { Composer, type ComposeSeed, type ComposeMode } from './Composer'
import { SwipeRow } from './SwipeRow'
import { signInWithGoogle } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { DbUser } from '@/types/database'
import { isMailHiddenByCompany } from '@/lib/companyVisibility'
import { ICON, STROKE } from '@/lib/type'
import { alpha } from '@/lib/alpha'
import { Segmented } from '@/components/ui'

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
  /** Kept, not discarded: the class of a message is decided from its headers,
   *  and re-fetching them to ask would be a request per row. */
  headers: GmailHeader[]
}

/** Every action on an open message is the same shape: a round icon at the top
 *  right, beside the subject. Words in pills across the card was a row of
 *  buttons wider than most of the messages under it. */
/** A classification tab. Lit is ink, because it is a filter and you have to be
 *  able to see at a glance that something is being hidden. */
function classTab(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
    borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
    fontSize: 'var(--sb-t-meta)', fontWeight: 600, whiteSpace: 'nowrap',
    background: on ? 'var(--sb-ink-1)' : 'var(--sb-card)',
    border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
    color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
  }
}

const ICON_ACTION: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
  cursor: 'pointer', padding: 0,
}

interface TriageState {
  result: EmailTriage | null
  loading: boolean
  error: string | null
  copied: boolean
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

// A colour is not a signal on its own — somebody who cannot separate these
// hues, or is reading this in a bad light, gets the word and the glyph. The
// hues themselves were 3.3-3.4:1 as text, which is under AA at this size, so
// each one is darkened to the point where the label can be read.
const CLASS_META = {
  decision: { label: 'Decision Needed', color: 'var(--sb-info)',           bg: 'color-mix(in srgb, var(--sb-info) 10.0%, transparent)', Icon: GitBranch },
  fyi:      { label: 'FYI',             color: 'var(--sb-info)',           bg: 'color-mix(in srgb, var(--sb-info) 10.0%, transparent)', Icon: Info },
  waiting:  { label: 'Waiting',         color: 'var(--sb-ink-3)',   bg: 'var(--sb-field)',       Icon: Clock },
  delegate: { label: 'Delegate',        color: 'var(--sb-positive)',           bg: 'color-mix(in srgb, var(--sb-positive) 10.0%, transparent)',  Icon: UserPlus },
} as const

const URGENCY_META = {
  high:   { label: 'High',   color: 'var(--sb-negative)', Icon: AlertTriangle },
  medium: { label: 'Medium', color: 'var(--sb-info)',            Icon: ArrowRight },
  low:    { label: 'Low',    color: 'var(--sb-ink-3)',    Icon: Minus },
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────


/** A stable colour per mailbox. Merged, the list is several inboxes at once and
 *  the address alone is a line of grey text you have to read; a bar down the
 *  edge of the row is something you can see without reading. */

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
  // A fixed hex out of `palettes.ts`, so the ink is worked out from the swatch
  // rather than from the theme: `--sb-ink-on-fill` is white in three of the
  // four themes, and white reads at 3.68 on this palette's cyan.
  return (
    <div style={{ width: size, height: size, borderRadius: 'var(--sb-r-pill)', background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size < 30 ? 10 : 12, fontWeight: 700, color: inkOn(bg), letterSpacing: '0.02em' }}>
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
  a { color: var(--sb-info); }
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
      style={{ width: '100%', minHeight: 200, border: 'none', borderRadius: 'var(--sb-r-chip)', display: 'block' }}
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
  return `<div style="font-size:12px;color:var(--sb-ink-3);margin-bottom:8px">${head}</div>${body}`
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

/**
 * Group rows by the mailbox they came from.
 *
 * Every Gmail call carries one account's token and one account's ids, so an
 * action over a merged inbox is one request per mailbox, not one big one.
 */
function byAccount(rows: Email[]): [MailAccount, Email[]][] {
  const groups = new Map<string, { acct: MailAccount; rows: Email[] }>()
  for (const r of rows) {
    const key = r.account.email
    const g = groups.get(key) ?? { acct: r.account, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.values()].map(g => [g.acct, g.rows])
}

/** Every control on the selection bar is the same pill. */
const barBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', height: 28,
  borderRadius: 'var(--sb-r-chip)', background: 'transparent', fontFamily: 'inherit',
  border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 30.0%, transparent)',
  color: 'var(--sb-info)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, cursor: 'pointer',
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
  /** Which row is swiped open. One at a time, or a tap belongs to nobody. */
  const [swipedId,   setSwipedId]   = useState<string | null>(null)
  /** Where a selection can be filed. Loaded once the mailboxes are known. */
  const [labels,     setLabels]     = useState<GmailLabel[]>([])
  const [moveOpen,   setMoveOpen]   = useState(false)
  // A menu held open by a full-page backdrop takes every click on the page
  // with it, so there has to be a way out that is not a click.
  useEffect(() => {
    if (!moveOpen) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoveOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [moveOpen])
  /** The last row clicked, so shift-click can take the run between them. */
  const lastPicked = useRef<string | null>(null)
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
  /** Which kind of mail is on screen. `null` is all of it. */
  const [mailClass, setMailClass] = useState<MailClass | null>(null)
  const [bulkBusy, setBulkBusy] = useState<string | null>(null)
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

  // ── What kind of thing each message is ─────────────────────────────────────
  // Decided from the headers the row already carries, so the tabs are there the
  // instant the mail is — no model call, and the same answer on every device.
  const classOf = useMemo(() => {
    const m = new Map<string, MailClass>()
    for (const e of visibleEmails) {
      m.set(e.id, classifyMail({
        headers: e.headers,
        fromEmail: e.fromEmail,
        to: e.to,
        cc: e.cc,
        subject: e.subject,
        body: e.body || e.preview,
        mailbox: e.account.email,
        isInvitation: looksLikeInvitation(e.subject)
          || e.headers.some(h => /^content-type$/i.test(h.name) && /calendar/i.test(h.value)),
      }))
    }
    return m
  }, [visibleEmails])

  const classCounts = useMemo(
    () => countByClass(visibleEmails, e => classOf.get(e.id) ?? 'other'),
    [visibleEmails, classOf])

  const searchedEmails = searchQuery.trim()
    ? visibleEmails.filter(e => {
        const q = searchQuery.toLowerCase()
        return e.fromName.toLowerCase().includes(q) || e.fromEmail.toLowerCase().includes(q) ||
               e.subject.toLowerCase().includes(q)  || e.preview.toLowerCase().includes(q)
      })
    : visibleEmails

  const filteredEmails = mailClass
    ? searchedEmails.filter(e => classOf.get(e.id) === mailClass)
    : searchedEmails

  /** The messages a bulk action would act on: what the chosen tab holds. */
  const inClass = useMemo(
    () => mailClass ? visibleEmails.filter(e => classOf.get(e.id) === mailClass) : [],
    [mailClass, visibleEmails, classOf])

  const selectedEmail  = visibleEmails.find(e => e.id === selectedId) ?? null
  const selectedTriage = selectedId ? (triageMap[selectedId] ?? null) : null
  const triagedCount   = visibleEmails.filter(e => triageMap[e.id]?.result).length

  const accounts = useMemo(() => mailAccounts(user?.email), [user?.email])
  const viewed   = useMemo(() => accountsFor(view, accounts), [view, accounts])

  // Where mail can be filed. Only the labels a person made themselves — the
  // system ones are the folders in the rail, and offering INBOX as somewhere to
  // move to would be offering to move a message to where it already is.
  // A label belongs to one mailbox, so only labels the whole visible set shares
  // are offered; anything else could move half a selection and fail the rest.
  useEffect(() => {
    let live = true
    void (async () => {
      const lists = await Promise.all(viewed.map(a => listLabels(a).catch(() => null)))
      if (!live) return
      const got = lists.filter((l): l is GmailLabel[] => l !== null)
      if (got.length === 0) { setLabels([]); return }
      const shared = got[0].filter(l => got.every(list => list.some(x => x.name === l.name)))
      setLabels(shared)
    })()
    return () => { live = false }
  }, [viewed])

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
          headers,
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
      // A reply the automation drafted in the background is already written;
      // it opens in the box under the mail rather than being asked for again.
      setReplyText(prev => {
        const next = { ...prev }
        for (const e of parsed) if (!next[e.id]) { const d = cachedDraft(e.threadId, e.id); if (d) next[e.id] = d }
        return next
      })
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


  // ─── What a whole class wants done with it ─────────────────────────────────
  //
  // The action is the class: a newsletter is archived, a notification is read,
  // a message addressed to you gets an answer written. Nothing here ever sends
  // anything — drafting fills the box under each message and stops.
  const runBulk = useCallback(async (klass: MailClass) => {
    const rows = visibleEmails.filter(e => classOf.get(e.id) === klass)
    if (rows.length === 0 || bulkBusy) return
    const what = CLASS_INFO[klass].bulk

    if (what === 'archive') {
      setBulkBusy(`Archiving ${rows.length}…`)
      try {
        await Promise.all(rows.map(e => archiveMessage(e.id, e.account).catch(() => {})))
        const gone = new Set(rows.map(e => e.id))
        setEmails(prev => prev.filter(e => !gone.has(e.id)))
        setSelectedId(prev => (prev && gone.has(prev) ? null : prev))
        notify(`${rows.length} archived`)
      } finally { setBulkBusy(null) }
      return
    }

    if (what === 'read') {
      setBulkBusy(`Marking ${rows.length}…`)
      try {
        await Promise.all(rows.map(e => markAsRead(e.id, e.account).catch(() => {})))
        setReadIds(prev => new Set([...prev, ...rows.map(e => e.id)]))
        notify(`${rows.length} marked read`)
      } finally { setBulkBusy(null) }
      return
    }

    if (what === 'draft') {
      // One call for the lot, the way the Today card does it: the model reads
      // them together and answers each, which is one round trip rather than N.
      const todo = rows.filter(e => !replyText[e.id]?.trim()).slice(0, 8)
      if (todo.length === 0) { notify('Every one of these already has a draft'); return }
      setBulkBusy(`Writing ${todo.length}…`)
      try {
        const written = await briefInbox({
          user: buildMockUser(user),
          companies: [],
          me: user?.email ?? '',
          messages: todo.map(e => ({
            id: e.id,
            fromName: e.fromName,
            fromEmail: e.fromEmail,
            subject: e.subject,
            receivedAt: e.receivedAt,
            addressedToMe: true,
            body: e.body || e.preview,
          })),
        })
        const drafts = Object.fromEntries(
          written.filter(b => b.draft.trim()).map(b => [b.id, b.draft]))
        setReplyText(prev => ({ ...prev, ...drafts }))
        const n = Object.keys(drafts).length
        notify(n ? `${n} ${n === 1 ? 'reply' : 'replies'} drafted — nothing sent` : 'None of these needed an answer')
      } catch (err) {
        notify(err instanceof Error ? err.message : 'The replies could not be written.')
      } finally { setBulkBusy(null) }
    }
  }, [visibleEmails, classOf, bulkBusy, replyText, user])

  /** One reply, for the message in front of you. */
  const draftOne = useCallback(async (email: Email) => {
    if (bulkBusy) return
    setBulkBusy('Writing…')
    try {
      const [b] = await briefInbox({
        user: buildMockUser(user),
        companies: [],
        me: user?.email ?? '',
        messages: [{
          id: email.id, fromName: email.fromName, fromEmail: email.fromEmail,
          subject: email.subject, receivedAt: email.receivedAt,
          addressedToMe: true, body: email.body || email.preview,
        }],
      })
      if (b?.draft.trim()) setReplyText(prev => ({ ...prev, [email.id]: b.draft }))
      else notify('This one does not look like it needs an answer')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The reply could not be written.')
    } finally { setBulkBusy(null) }
  }, [bulkBusy, user])

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
          headers,
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
      // A reply the automation drafted in the background is already written;
      // it opens in the box under the mail rather than being asked for again.
      setReplyText(prev => {
        const next = { ...prev }
        for (const e of parsed) if (!next[e.id]) { const d = cachedDraft(e.threadId, e.id); if (d) next[e.id] = d }
        return next
      })
    } catch { /* offline */ }
    finally { setLoadingMore(false) }
  }, [nextPageToken, loadingMore, viewed, emails, folder])

  // ─── Acting on mail, one row or a selection ────────────────────────────────
  //
  // Every one of these is undoable, because the two ways in are a swipe and a
  // click on a bar — both cheap enough to do by accident that a mistake has to
  // cost nothing. Gmail is the source of truth, so an undo puts the labels back
  // rather than restoring a snapshot; the row returns to the list at the same
  // time, or the screen would disagree with the mailbox.

  /** Take rows off the list, remembering where each sat so undo can replace it. */
  const removeRows = useCallback((ids: Set<string>) => {
    setEmails(prev => {
      const next = prev.filter(e => !ids.has(e.id))
      setSelectedId(cur => (cur && ids.has(cur) ? (next[0]?.id ?? null) : cur))
      return next
    })
  }, [])

  const restoreRows = useCallback((rows: Email[]) => {
    setEmails(prev => {
      const have = new Set(prev.map(e => e.id))
      const back = rows.filter(r => !have.has(r.id))
      if (back.length === 0) return prev
      // Newest first is the list's own order; putting them back by date keeps
      // a restored row where it was rather than at the top.
      return [...prev, ...back].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    })
  }, [])

  /** One phrase for "these messages", so every bar and every undo reads alike. */
  const many = (n: number) => (n === 1 ? 'message' : `${n} messages`)

  const toggleRead = useCallback(async (email: Email) => {
    const wasRead = readIds.has(email.id)
    setReadIds(prev => {
      const n = new Set(prev)
      wasRead ? n.delete(email.id) : n.add(email.id)
      return n
    })
    try {
      await (wasRead ? markAsUnread(email.id, email.account) : markAsRead(email.id, email.account))
      notify(wasRead ? 'Marked unread' : 'Marked read')
    } catch {
      // Put the dot back rather than claim something that did not happen.
      setReadIds(prev => {
        const n = new Set(prev)
        wasRead ? n.add(email.id) : n.delete(email.id)
        return n
      })
      notify('Gmail would not change that one')
    }
  }, [readIds])

  const archiveRows = useCallback(async (rows: Email[]) => {
    if (rows.length === 0) return
    const ids = new Set(rows.map(r => r.id))
    pushUndo(`Archived ${many(rows.length)}`, async () => {
      await Promise.all(rows.map(r => unarchiveMessage(r.id, r.account).catch(() => {})))
      restoreRows(rows)
    })
    removeRows(ids)
    try {
      await Promise.all(byAccount(rows).map(([acct, group]) =>
        batchModify(group.map(r => r.id), { remove: ['INBOX'] }, acct)))
      notify(`Archived ${many(rows.length)}`)
    } catch (err) {
      restoreRows(rows)
      notify(err instanceof Error ? err.message : 'Gmail would not archive those')
    }
  }, [removeRows, restoreRows])

  const trashRows = useCallback(async (rows: Email[]) => {
    if (rows.length === 0) return
    const ids = new Set(rows.map(r => r.id))
    pushUndo(`Binned ${many(rows.length)}`, async () => {
      await Promise.all(rows.map(r => untrashMessage(r.id, r.account).catch(() => {})))
      restoreRows(rows)
    })
    removeRows(ids)
    try {
      // No batch endpoint bins mail, so this is one call each — and `trash` is
      // the documented way in, rather than adding the label by hand.
      await Promise.all(rows.map(r => trashMessage(r.id, r.account)))
      notify(`${rows.length === 1 ? 'Moved' : 'Moved ' + rows.length} to the Bin — recoverable for 30 days`)
    } catch (err) {
      restoreRows(rows)
      notify(err instanceof Error ? err.message : 'Gmail would not bin those')
    }
  }, [removeRows, restoreRows])

  const readRows = useCallback(async (rows: Email[], read: boolean) => {
    if (rows.length === 0) return
    const ids = rows.map(r => r.id)
    const changed = rows.filter(r => readIds.has(r.id) !== read)
    if (changed.length === 0) { notify(`Already ${read ? 'read' : 'unread'}`); return }
    pushUndo(`Marked ${many(changed.length)} ${read ? 'read' : 'unread'}`, async () => {
      await Promise.all(byAccount(changed).map(([acct, g]) =>
        batchModify(g.map(r => r.id), read ? { add: ['UNREAD'] } : { remove: ['UNREAD'] }, acct)))
      setReadIds(prev => {
        const n = new Set(prev)
        for (const r of changed) read ? n.delete(r.id) : n.add(r.id)
        return n
      })
    })
    setReadIds(prev => {
      const n = new Set(prev)
      for (const id of ids) read ? n.add(id) : n.delete(id)
      return n
    })
    try {
      await Promise.all(byAccount(rows).map(([acct, g]) =>
        batchModify(g.map(r => r.id), read ? { remove: ['UNREAD'] } : { add: ['UNREAD'] }, acct)))
      notify(`Marked ${many(changed.length)} ${read ? 'read' : 'unread'}`)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gmail would not change those')
    }
  }, [readIds])

  const moveRows = useCallback(async (rows: Email[], label: GmailLabel) => {
    if (rows.length === 0) return
    const ids = new Set(rows.map(r => r.id))
    pushUndo(`Moved ${many(rows.length)} to ${label.name}`, async () => {
      await Promise.all(byAccount(rows).map(([acct, g]) =>
        batchModify(g.map(r => r.id), { add: ['INBOX'], remove: [label.id] }, acct).catch(() => {})))
      restoreRows(rows)
    })
    removeRows(ids)
    try {
      // A label belongs to one mailbox, so a selection spanning several can
      // only be moved where the label exists. The picker only offers labels
      // from the mailboxes in the selection, so this is the leftover case.
      await Promise.all(byAccount(rows).map(([acct, g]) =>
        batchModify(g.map(r => r.id), { add: [label.id], remove: ['INBOX'] }, acct)))
      notify(`Moved ${many(rows.length)} to ${label.name}`)
    } catch (err) {
      restoreRows(rows)
      notify(err instanceof Error ? err.message : `Gmail would not move those to ${label.name}`)
    }
  }, [removeRows, restoreRows])

  /** The rows the action bar acts on, in the order they are on screen. */
  const chosen = useCallback(
    () => filteredEmails.filter(e => selectedIds.has(e.id)),
    [filteredEmails, selectedIds])

  const afterBatch = useCallback(async (run: () => Promise<void>) => {
    if (batchArchiving) return
    setBatchArchiving(true)
    try { await run(); setSelectedIds(new Set()) } finally { setBatchArchiving(false) }
  }, [batchArchiving])

  // ─── Render helpers ──────────────────────────────────────────────────────


  /** The folders, as a list down the left rather than a row of pills: it is a
   *  place you go, and a place is a menu item. It folds away to its icons on a
   *  narrow screen, or when you would rather have the width. */
  function renderFolders() {
    const ORDER: MailFolder[] = ['unread', 'inbox', 'sent', 'drafts', 'starred', 'archive']
    return (
      <nav style={{
        background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
        padding: 6, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <button
          onClick={() => { const v = !railOpen; setRailOpen(v); try { localStorage.setItem('mail-rail-open', String(v)) } catch { /* quota */ } }}
          title={railOpen ? 'Collapse' : 'Expand'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px',
            borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--sb-ink-4)', fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
          {railOpen ? <ChevronDown size={ICON.sm} /> : <ChevronRight size={ICON.sm} />}
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
                borderRadius: 'var(--sb-r-chip)', cursor: 'pointer', border: 'none',
                background: on ? 'var(--sb-ink-1)' : 'transparent',
                color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 600 : 500,
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
        <div style={{ background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', overflow: 'hidden' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ padding: '16px 18px', borderBottom: i < 3 ? 'var(--sb-border-width) solid var(--sb-border)' : 'none' }}>
              <div style={{ height: 12, borderRadius: 'var(--sb-r-chip)', background: 'linear-gradient(90deg, var(--sb-border) 25%, var(--sb-accent-border) 50%, var(--sb-border) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s infinite', marginBottom: 8, width: '60%' }} />
              <div style={{ height: 10, borderRadius: 'var(--sb-r-chip)', background: 'linear-gradient(90deg, var(--sb-border) 25%, var(--sb-accent-border) 50%, var(--sb-border) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s infinite', width: '80%' }} />
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
          <Search size={ICON.sm} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sb-ink-3)', pointerEvents: 'none' }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search emails…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px 8px 30px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', outline: 'none' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 2, display: 'flex' }}>
              <XIcon size={ICON.sm} />
            </button>
          )}
        </div>

        {/* ── What kind of mail this week held ─────────────────────────────
            Every class implies a different action — that is what makes it a
            class rather than a label. The tabs themselves do nothing but
            narrow the list; the actions are the row under them. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <button
            onClick={() => setMailClass(null)}
            style={classTab(mailClass === null)}>
            All <span style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>{visibleEmails.length}</span>
          </button>
          {CLASSES.map(c => (
            <button
              key={c}
              onClick={() => setMailClass(mailClass === c ? null : c)}
              title={classCounts[c] === 0 ? CLASS_INFO[c].empty : undefined}
              style={{ ...classTab(mailClass === c), opacity: classCounts[c] === 0 ? 0.45 : 1 }}>
              {CLASS_INFO[c].label}{' '}
              <span style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>{classCounts[c]}</span>
            </button>
          ))}
        </div>

        {/* ── What to do with the class in front of you ────────────────────── */}
        {mailClass && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '7px 11px', borderRadius: 'var(--sb-r-chip)',
            background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
          }}>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', flex: 1, minWidth: 0 }}>
              {inClass.length === 0
                ? CLASS_INFO[mailClass].empty
                : `${inClass.length} ${CLASS_INFO[mailClass].label.toLowerCase()}`}
            </span>

            {inClass.length > 0 && CLASS_INFO[mailClass].bulk !== 'none' && (
              <button
                onClick={() => void runBulk(mailClass)}
                disabled={!!bulkBusy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 11px',
                  borderRadius: 'var(--sb-r-pill)', cursor: bulkBusy ? 'default' : 'pointer',
                  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
                  fontFamily: 'inherit', opacity: bulkBusy ? 0.55 : 1,
                }}>
                {CLASS_INFO[mailClass].bulk === 'archive' ? <Archive size={ICON.sm} />
                  : CLASS_INFO[mailClass].bulk === 'read' ? <Check size={ICON.sm} />
                  : <Sparkles size={ICON.sm} />}
                {bulkBusy ?? CLASS_INFO[mailClass].bulkLabel}
              </button>
            )}

            {/* Only where the sender offers a way off the list. */}
            {mailClass === 'newsletter' && inClass.some(e => unsubscribeLink(e.headers)) && (
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                {inClass.filter(e => unsubscribeLink(e.headers)).length} offer an unsubscribe link
              </span>
            )}
          </div>
        )}

        {/* ── What to do with a selection ──────────────────────────────────
            The same four things the swipe offers one row at a time, plus the
            move a swipe has no room for. Every one is undoable. */}
        {selectedIds.size > 0 && (() => {
          const picked = chosen()
          const allRead   = picked.every(e => readIds.has(e.id))
          const everyOne  = picked.length === filteredEmails.length && filteredEmails.length > 0
          const act = (run: () => Promise<void>) => () => void afterBatch(run)
          return (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 12px', background: 'color-mix(in srgb, var(--sb-info) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 20.0%, transparent)', borderRadius: 'var(--sb-r-chip)' }}>
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-info)', fontWeight: 600 }}>
                {selectedIds.size} selected
              </span>

              {/* Selecting a whole class or search is the point of having one. */}
              <button
                onClick={() => setSelectedIds(everyOne ? new Set() : new Set(filteredEmails.map(e => e.id)))}
                style={{ ...barBtn, borderColor: 'transparent', color: 'var(--sb-info)' }}>
                {everyOne ? 'Select none' : `Select all ${filteredEmails.length}`}
              </button>

              {/* Read is a toggle: a selection that is already read wants the
                  other direction, and two buttons for one state is one too many. */}
              <button onClick={act(() => readRows(picked, !allRead))} disabled={batchArchiving} style={barBtn}>
                {allRead ? <Mail size={ICON.sm} /> : <MailOpen size={ICON.sm} />}
                {allRead ? 'Mark unread' : 'Mark read'}
              </button>

              <div style={{ position: 'relative' }}>
                <button onClick={() => setMoveOpen(o => !o)} disabled={batchArchiving || labels.length === 0}
                  title={labels.length === 0 ? 'This mailbox has no labels of its own to file mail under' : 'File it under a label'}
                  style={{ ...barBtn, opacity: labels.length === 0 ? 0.45 : 1 }}>
                  <FolderInput size={ICON.sm} /> Move
                </button>
                {moveOpen && labels.length > 0 && (
                  <>
                    <div onClick={() => setMoveOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41, minWidth: 190,
                      maxHeight: 260, overflowY: 'auto', background: 'var(--sb-overlay)',
                      border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
                      boxShadow: 'var(--sb-shadow-panel, 0 8px 24px rgba(25,23,18,.14))', padding: 5,
                    }}>
                      {labels.map(l => (
                        <button key={l.id}
                          onClick={() => { setMoveOpen(false); void afterBatch(() => moveRows(picked, l)) }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
                            borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'none',
                            color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}>{l.name}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <button onClick={act(() => archiveRows(picked))} disabled={batchArchiving} style={barBtn}>
                <Archive size={ICON.sm} /> Archive
              </button>

              <button onClick={act(() => trashRows(picked))} disabled={batchArchiving}
                title="Moves them to the Bin, where Gmail keeps them for 30 days"
                style={{ ...barBtn, color: 'var(--sb-negative)', borderColor: 'color-mix(in srgb, var(--sb-negative) 34%, transparent)' }}>
                <Trash2 size={ICON.sm} /> Delete
              </button>

              <button onClick={() => setSelectedIds(new Set())} title="Clear the selection"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 2, display: 'flex' }}>
                <XIcon size={ICON.sm} />
              </button>
            </div>
          )
        })()}

        <div style={{ background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', overflow: 'hidden' }}>
        {/* An emptied list has to say so. Archiving or binning a whole
            selection is one gesture away, and a card of nothing reads as the
            mail having failed to load rather than as a finished inbox. */}
        {filteredEmails.length === 0 ? (
          <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>
            {searchQuery ? `No emails match "${searchQuery}"`
              : mailClass ? CLASS_INFO[mailClass].empty
              : folder === 'unread' ? 'Nothing unread. That is the whole inbox dealt with.'
              : `Nothing in ${FOLDER_LABEL[folder ?? 'inbox'].toLowerCase()}.`}
          </div>
        ) : filteredEmails.map((email, i) => {
          // Several mailboxes on screen at once is the case the colour is for.
          const multi = view === 'all' && accounts.length > 1
          const isSelected = selectedId === email.id
          const isRead     = readIds.has(email.id)
          const triage     = triageMap[email.id]
          const classMeta  = triage?.result ? CLASS_META[triage.result.classification] : null
          return (
            <SwipeRow
              key={email.id}
              id={email.id}
              isRead={isRead}
              openId={swipedId}
              setOpenId={setSwipedId}
              // Nothing in the Bin is worth binning again, and archiving from
              // there means nothing either.
              disabled={folder === 'trash'}
              onRead={() => void toggleRead(email)}
              onArchive={() => void archiveRows([email])}
              onDelete={() => void trashRows([email])}
            >
            <button
              onClick={() => {
                setSelectedId(email.id)
                lastPicked.current = email.id
                if (!readIds.has(email.id)) {
                  setReadIds(prev => new Set([...prev, email.id]))
                  void markAsRead(email.id, email.account).catch(() => { /* offline */ })
                }
              }}
              style={{
                width: '100%', padding: '7px 11px', textAlign: 'left',
                background: isSelected ? 'color-mix(in srgb, var(--sb-info) 6.0%, transparent)' : 'transparent',
                border: 'none',
                borderBottom: i < visibleEmails.length - 1 ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
                // The bar is the mailbox when several are merged, and the
                // selection when only one is on screen.
                borderLeft: `3px solid ${
                  isSelected ? 'var(--sb-info)'
                  : multi ? accountColor(email.account.email)
                  : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}
                  title={selectedIds.has(email.id) ? 'Deselect — shift-click for a run' : 'Select — shift-click for a run'}
                  onClick={ev => {
                    ev.stopPropagation()
                    // Shift takes everything between the last one picked and
                    // this one. Picking fifty messages one at a time is not
                    // selecting, it is clicking fifty times.
                    const anchor = lastPicked.current
                    const run = (() => {
                      if (!ev.shiftKey || !anchor || anchor === email.id) return [email.id]
                      const ids = filteredEmails.map(e => e.id)
                      const a = ids.indexOf(anchor), b = ids.indexOf(email.id)
                      if (a < 0 || b < 0) return [email.id]
                      return ids.slice(Math.min(a, b), Math.max(a, b) + 1)
                    })()
                    setSelectedIds(prev => {
                      const n = new Set(prev)
                      // The row you clicked decides for the whole run, so a
                      // shift-click can clear a stretch as well as take one.
                      const adding = !n.has(email.id)
                      for (const id of run) adding ? n.add(id) : n.delete(id)
                      return n
                    })
                    lastPicked.current = email.id
                  }}>
                  {selectedIds.has(email.id)
                    ? <div style={{ width: 26, height: 26, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckCheck size={ICON.sm} color="var(--sb-ink-on-fill)" /></div>
                    : <SenderAvatar name={email.fromName} email={email.fromEmail} size={26} />
                  }
                  {!isRead && !selectedIds.has(email.id) && <div style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-info)', border: 'var(--sb-border-emphasis) solid var(--sb-card)' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                    <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: isRead ? 400 : 700, color: isRead ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }}>
                      {email.fromName}
                    </span>
                    {classMeta && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--sb-t-micro)', padding: '1px 6px', borderRadius: 'var(--sb-r-chip)', flexShrink: 0, background: classMeta.bg, color: classMeta.color, fontWeight: 600 }}>
                        <classMeta.Icon size={10} strokeWidth={STROKE.active} />
                        {classMeta.label}
                      </span>
                    )}
                    {/* A bulk draft writes into eight messages at once; without
                        this the only way to know which got one is to open each. */}
                    {replyText[email.id]?.trim() && !sentIds.has(email.id) && (
                      <span title="A reply is drafted and waiting — nothing has been sent" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--sb-t-micro)', padding: '1px 6px', borderRadius: 'var(--sb-r-chip)', flexShrink: 0, background: 'rgba(var(--sb-accent-rgb),0.16)', color: 'var(--sb-ink-2)', fontWeight: 600 }}>
                        <FileEdit size={10} strokeWidth={STROKE.active} />
                        Draft
                      </span>
                    )}
                    {triage?.loading && (
                      <RefreshCw size={ICON.sm} color="var(--sb-info)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: isRead ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)', fontWeight: isRead ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
                    {email.subject}
                    <span style={{ fontWeight: 400, color: 'var(--sb-ink-4)' }}> — {email.preview}</span>
                  </p>
                </div>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
                  {/* Which mailbox, when more than one is on screen — in that
                      mailbox's own colour, so the bar down the edge and the
                      address say the same thing. */}
                  {multi && (
                    <span title={email.account.email} style={{
                      fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: accountColor(email.account.email),
                      maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{accountLabel(email.account.email, email.account.isPrimary)}</span>
                  )}
                  <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                  {fmtRelTime(email.receivedAt)}
                  </span>
                </span>
              </div>
            </button>
            </SwipeRow>
          )
        })}
        </div>

        {nextPageToken && (
          <button
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            style={{ width: '100%', padding: '9px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: '1px dashed var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: loadingMore ? 0.5 : 1 }}
          >
            <RefreshCw size={ICON.sm} style={{ animation: loadingMore ? 'spin 1s linear infinite' : 'none' }} />
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
          background: 'var(--sb-card)', border: '1px dashed var(--sb-border)',
          borderRadius: 'var(--sb-r-nav)', padding: '48px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          textAlign: 'center',
        }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--sb-r-nav)', background: 'color-mix(in srgb, var(--sb-info) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 15.0%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <WifiOff size={ICON.lg} color="var(--sb-info)" />
          </div>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-1)', fontFamily: 'var(--sb-font-num)' }}>
              Connect Gmail
            </p>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-3)', lineHeight: 1.6, maxWidth: 320 }}>
              Sign in with Google to load your real unread emails and triage them with AI.
            </p>
          </div>
          <button
            onClick={() => void signInWithGoogle()}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 22px', borderRadius: 'var(--sb-r-chip)',
              background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 25.0%, transparent)',
              color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', fontWeight: 500, cursor: 'pointer',
            }}
          >
            <Mail size={ICON.sm} /> Connect Google Account
          </button>
        </div>
      )
    }

    if (fetchError) {
      return (
        <div style={{ background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '32px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{fetchError}</p>
          <button onClick={() => void loadEmails()} style={{ padding: '7px 18px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 18.8%, transparent)', color: 'var(--sb-info)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )
    }

    if (loading || !selectedEmail) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Email body */}
        <div style={{ background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '18px 22px' }}>
          {/* Subject on the left, everything you can do to the message on the
              right — as icons, the way the task panel does it. Four words in
              four pills was a row of buttons the width of the card. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
            <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 'var(--sb-t-h2)', fontWeight: 700, color: 'var(--sb-ink-1)', fontFamily: 'var(--sb-font-num)', letterSpacing: '-0.3px', lineHeight: 1.25 }}>
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
                      background: on ? 'var(--sb-ink-1)' : 'transparent',
                      border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
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
                  border: `var(--sb-border-width) solid ${drafting === selectedEmail.id ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                  color: drafting === selectedEmail.id ? 'var(--sb-accent-ink)' : 'var(--sb-ink-3)',
                }}>
                <Sparkles size={ICON.sm} />
              </button>
              <button
                onClick={() => void handleArchive(selectedEmail)}
                disabled={archiving === selectedEmail.id}
                title="Archive" aria-label="Archive"
                style={{ ...ICON_ACTION, opacity: archiving === selectedEmail.id ? 0.5 : 1 }}>
                <Archive size={ICON.sm} />
              </button>
            </div>
          </div>
          {draftError && (
            <p style={{
              margin: '0 0 8px', fontSize: 'var(--sb-t-meta)', lineHeight: 1.5, color: 'var(--sb-negative)',
              background: 'color-mix(in srgb, var(--sb-negative) 6.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 25.0%, transparent)',
              borderRadius: 'var(--sb-r-chip)', padding: '7px 10px',
            }}>{draftError}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-info)', fontWeight: 600 }}>{selectedEmail.fromName}</span>
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{`<${selectedEmail.fromEmail}>`}</span>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <Clock size={ICON.sm} />{fmtRelTime(selectedEmail.receivedAt)}
              </span>
              {accounts.length > 1 && (
                <span title={`In ${selectedEmail.account.email}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
                    borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                    fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', flexShrink: 0,
                  }}>{accountLabel(selectedEmail.account.email, selectedEmail.account.isPrimary)}</span>
              )}

            </div>
            {selectedEmail.to && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', lineHeight: 1.35 }}>
                <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)', minWidth: 18 }}>To</span>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', wordBreak: 'break-word' }}>{selectedEmail.to}</span>
              </div>
            )}
            {selectedEmail.cc && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)', minWidth: 18 }}>CC</span>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', wordBreak: 'break-word' }}>{selectedEmail.cc}</span>
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
                style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {expandedThread === selectedEmail.id ? '▲' : '▼'} {selectedEmail.threadMessages.length} earlier message{selectedEmail.threadMessages.length > 1 ? 's' : ''} in thread
              </button>
              {expandedThread === selectedEmail.id && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedEmail.threadMessages.map(m => (
                    <div key={m.id} style={{ borderLeft: '3px solid var(--sb-border)', paddingLeft: 14 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-info)' }}>{m.fromName}</span>
                        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{fmtRelTime(m.receivedAt)}</span>
                      </div>
                      {m.htmlBody
                        ? <EmailBodyFrame html={m.htmlBody} messageId={m.id} account={selectedEmail.account} />
                        : <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ height: 1, background: 'var(--sb-border)', marginBottom: 16 }} />
          {selectedEmail.htmlBody ? (
            <EmailBodyFrame html={selectedEmail.htmlBody} messageId={selectedEmail.id} account={selectedEmail.account} />
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {selectedEmail.body}
            </p>
          )}
        </div>

        {/* Triage panel */}
        {/* ── The drafted reply, under the mail it answers ──────────────────
            It appears the moment one is written — by the class action above or
            by this message's own Draft button — and it is never sent by
            anything but the Send here. Clicking the text opens the full
            compose window, which is where a reply that needs more than a
            paragraph gets written. */}
        {!selectedTriage?.result && replyText[selectedEmail.id]?.trim()
          && compose?.threadId !== selectedEmail.threadId && (
          <div style={{
            background: 'var(--sb-accent-tint)',
            border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.45)',
            borderRadius: 'var(--sb-r-nav)', padding: '12px 14px 13px',
            display: 'flex', flexDirection: 'column', gap: 9,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Sparkles size={ICON.sm} color="var(--sb-accent-deep)" />
              <span style={{
                fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.08em',
                color: 'var(--sb-accent-deep)', textTransform: 'uppercase',
              }}>Draft reply · not sent</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-accent-deep)' }}>
                Click it to write in full
              </span>
            </div>

            <textarea
              value={replyText[selectedEmail.id] ?? ''}
              onChange={e => setReplyText(prev => ({ ...prev, [selectedEmail.id]: e.target.value }))}
              onClick={() => setCompose({
                ...composeSeed(selectedEmail, 'reply', accounts),
                // The draft opens the full window with what is already written
                // in it, so clicking through never costs you the paragraph.
                // The margin is inline because the editor is a contenteditable
                // with its own reset — a bare <p> arrives with none and the
                // draft's paragraphs collapse into one block on the way over.
                draft: (replyText[selectedEmail.id] ?? '').split(/\n{2,}/)
                  .map(par => `<p style="margin:0 0 1em">${escapeHtml(par).replace(/\n/g, '<br>')}</p>`).join(''),
              })}
              // A draft that clips its own sign-off reads as unfinished. It
              // grows to what was written, up to the point where the mail
              // above it would be pushed off the screen.
              rows={Math.min(16, Math.max(5, (replyText[selectedEmail.id] ?? '').split('\n').length + 1))}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', resize: 'vertical',
                borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-card)',
                border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
                fontSize: 'var(--sb-t-body-s)', lineHeight: 1.6, fontFamily: 'inherit', outline: 'none',
                cursor: 'text',
              }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', flex: 1, minWidth: 0 }}>
                Leaves from {selectedEmail.account.email}
              </span>
              <button
                onClick={() => setReplyText(prev => { const n = { ...prev }; delete n[selectedEmail.id]; return n })}
                title="Throw this draft away"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 11px',
                  borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
                  background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)',
                  color: 'var(--sb-negative-deep)', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
                }}>
                <Trash2 size={ICON.sm} /> Delete
              </button>
              <button
                onClick={() => void handleSendReply(selectedEmail)}
                disabled={sending === selectedEmail.id || sentIds.has(selectedEmail.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 13px',
                  borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
                  background: 'var(--sb-ink-1)', border: 'none', color: 'var(--sb-ink-on-dark)',
                  fontSize: 'var(--sb-t-meta)', fontWeight: 700,
                  opacity: sending === selectedEmail.id ? 0.55 : 1,
                }}>
                {sentIds.has(selectedEmail.id) ? <><CheckCheck size={ICON.sm} /> Sent</>
                  : sending === selectedEmail.id ? <><RefreshCw size={ICON.sm} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                  : <><ArrowRight size={ICON.sm} /> Send</>}
              </button>
            </div>
          </div>
        )}

        {/* Where a message addressed to you has no draft yet. */}
        {!selectedTriage?.result && !replyText[selectedEmail.id]?.trim()
          && classOf.get(selectedEmail.id) === 'needs-you' && !sentIds.has(selectedEmail.id) && (
          <button
            onClick={() => void draftOne(selectedEmail)}
            disabled={!!bulkBusy}
            style={{
              alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 13px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, fontFamily: 'inherit',
              opacity: bulkBusy ? 0.55 : 1,
            }}>
            <Sparkles size={ICON.sm} /> {bulkBusy ?? 'Draft a reply'}
          </button>
        )}

        {selectedTriage?.loading ? (
          <div style={{ background: 'var(--sb-card)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 20.0%, transparent)', borderRadius: 'var(--sb-r-nav)', padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={ICON.md} color="var(--sb-info)" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-info)' }}>The Professor is analyzing this email…</span>
          </div>

        ) : selectedTriage?.error ? (
          <div style={{ background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '20px 24px' }}>
            <p style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{selectedTriage.error}</p>
            <button onClick={() => void handleTriage(selectedEmail)} style={{ padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 18.8%, transparent)', color: 'var(--sb-info)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer' }}>
              Try again
            </button>
          </div>

        ) : selectedTriage?.result ? (
          <div style={{ background: 'color-mix(in srgb, var(--sb-info) 5.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 20.0%, transparent)', borderRadius: 'var(--sb-r-nav)', padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <div style={{ width: 24, height: 24, borderRadius: 'var(--sb-r-chip)', background: 'color-mix(in srgb, var(--sb-info) 15.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 30.0%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={ICON.sm} color="var(--sb-info)" />
              </div>
              <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-info)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                The Professor's Triage
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
              <div style={{ flex: 1, padding: '12px 14px', background: CLASS_META[selectedTriage.result.classification].bg, border: `var(--sb-border-width) solid ${alpha(CLASS_META[selectedTriage.result.classification].color, 18.8)}`, borderRadius: 'var(--sb-r-chip)' }}>
                <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Classification</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: CLASS_META[selectedTriage.result.classification].color }}>
                  {(() => { const C = CLASS_META[selectedTriage.result.classification].Icon; return <C size={ICON.sm} strokeWidth={STROKE.active} /> })()}
                  {CLASS_META[selectedTriage.result.classification].label}
                </div>
              </div>
              <div style={{ flex: 1, padding: '12px 14px', background: 'var(--sb-page)', border: `var(--sb-border-width) solid ${alpha(URGENCY_META[selectedTriage.result.urgency].color, 18.8)}`, borderRadius: 'var(--sb-r-chip)' }}>
                <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Urgency</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: URGENCY_META[selectedTriage.result.urgency].color }}>
                  {(() => { const U = URGENCY_META[selectedTriage.result.urgency].Icon; return <U size={ICON.sm} strokeWidth={STROKE.active} /> })()}
                  {URGENCY_META[selectedTriage.result.urgency].label}
                </div>
              </div>
              {selectedTriage.result.followUpDate && (
                <div style={{ flex: 1, padding: '12px 14px', background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)' }}>
                  <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Follow Up</div>
                  <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{selectedTriage.result.followUpDate}</div>
                </div>
              )}
            </div>

            {selectedTriage.result.suggestedReply && (() => {
              const draft = replyText[selectedEmail.id] ?? selectedTriage.result.suggestedReply
              const isSent = sentIds.has(selectedEmail.id)
              return (
                <div style={{ background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Reply to {selectedEmail.fromName}
                    </span>
                    <button
                      onClick={() => handleCopyReply(selectedEmail.id, draft)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer' }}
                    >
                      {selectedTriage.copied ? <><CheckCheck size={ICON.sm} /><span>Copied</span></> : <><Copy size={ICON.sm} /><span>Copy</span></>}
                    </button>
                  </div>
                  <textarea
                    value={draft}
                    onChange={e => setReplyText(prev => ({ ...prev, [selectedEmail.id]: e.target.value }))}
                    rows={6}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 'var(--sb-r-chip)', resize: 'vertical', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', lineHeight: 1.65, fontFamily: 'inherit', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    {isSent ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-positive)', fontWeight: 500 }}>
                        <CheckCheck size={ICON.sm} /> Sent!
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleSendReply(selectedEmail)}
                        disabled={!draft.trim() || sending === selectedEmail.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 18px', borderRadius: 'var(--sb-r-chip)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 25.0%, transparent)', color: 'var(--sb-info)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', opacity: sending === selectedEmail.id ? 0.5 : 1 }}
                      >
                        {sending === selectedEmail.id
                          ? <><RefreshCw size={ICON.sm} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                          : <><ArrowRight size={ICON.sm} /> Send Reply</>}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>

        // A draft on screen already is the "ready-to-send reply" this card
        // offers, so offering it again under the draft is one screen arguing
        // with itself. Deleting the draft brings the card back.
        ) : replyText[selectedEmail.id]?.trim() ? null : (
          <div style={{ background: 'var(--sb-card)', border: '1px dashed var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 'var(--sb-r-nav)', background: 'color-mix(in srgb, var(--sb-info) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 15.0%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={ICON.lg} color="var(--sb-info)" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: '0 0 5px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontWeight: 500 }}>Let The Professor triage this</p>
              <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Get classification, urgency level, and a ready-to-send reply</p>
            </div>
            <button
              onClick={() => void handleTriage(selectedEmail)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 'var(--sb-r-chip)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 25.0%, transparent)', color: 'var(--sb-info)', fontSize: 'var(--sb-t-body)', fontWeight: 500, cursor: 'pointer' }}
            >
              <Zap size={ICON.sm} /> Triage with AI <ArrowRight size={ICON.sm} />
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
          <div style={{ display: 'flex', gap: 20, marginBottom: bulkOpen ? 10 : 20, padding: '13px 20px', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Mail size={ICON.sm} color="var(--sb-info)" />
              <span style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{loading ? '…' : visibleEmails.length} unread</span>
            </div>
            <div style={{ width: 1, height: 14, background: 'var(--sb-border)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Zap size={ICON.sm} color="var(--sb-positive)" />
              <span style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{triagedCount} triaged</span>
            </div>
            {accounts.length > 1 && (
              <>
                <div style={{ width: 1, height: 14, background: 'var(--sb-border)' }} />
                {/* All of them, or one. A merged inbox is the useful default —
                    the question "what is waiting for me" does not stop at an
                    account boundary — but answering it must not hide which
                    mailbox a message is in. */}
                <div role="group" aria-label="Which mailbox"
                  style={{ display: 'contents' }}>
                  <Segmented
                    size="sm"
                    aria-label="Which mailbox"
                    value={view}
                    onChange={v => { setView(v); saveMailView(v); setSelectedId(null) }}
                    options={[
                      { value: 'all', label: 'All', title: 'Every account at once' },
                      ...accounts.map(a => ({ value: a.email, label: accountLabel(a.email, a.isPrimary), title: a.email })),
                    ]}
                  />
                </div>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  const box = viewed[0] ?? accounts[0]
                  if (box) setCompose({ mode: 'new', account: box, to: '', subject: '' })
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)', background: compose?.mode === 'new' ? 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)' : 'transparent', border: `var(--sb-border-width) solid ${compose?.mode === 'new' ? 'color-mix(in srgb, var(--sb-info) 30.0%, transparent)' : 'var(--sb-border)'}`, color: compose?.mode === 'new' ? 'var(--sb-info)' : 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer' }}
              >
                <PenSquare size={ICON.sm} /> Compose
              </button>
              <button
                onClick={() => { setBulkOpen(o => !o); setBulkText(''); setBulkDone(false); setTimeout(() => bulkRef.current?.focus(), 50) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)', background: bulkOpen ? 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)' : 'transparent', border: `var(--sb-border-width) solid ${bulkOpen ? 'color-mix(in srgb, var(--sb-positive) 30.0%, transparent)' : 'var(--sb-border)'}`, color: bulkOpen ? 'var(--sb-positive)' : 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer' }}
              >
                <ListPlus size={ICON.sm} /> Bulk add tasks
              </button>
              <button
                onClick={() => void loadEmails()}
                disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}
              >
                <RefreshCw size={ICON.sm} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                Refresh
              </button>
              {selectedEmail && (
                <button
                  onClick={() => void handleTriage(selectedEmail)}
                  disabled={triageMap[selectedEmail.id]?.loading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 25.0%, transparent)', color: 'var(--sb-info)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', opacity: triageMap[selectedEmail.id]?.loading ? 0.5 : 1 }}
                >
                  <Zap size={ICON.sm} /> Triage with AI
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
          <div style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-positive) 25.0%, transparent)', borderRadius: 'var(--sb-r-nav)' }}>
            <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
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
                padding: '10px 12px', borderRadius: 'var(--sb-r-chip)', resize: 'vertical',
                background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', lineHeight: 1.6,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                {bulkLines.length > 0 ? `${bulkLines.length} task${bulkLines.length > 1 ? 's' : ''} ready` : 'Paste or type tasks above'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setBulkOpen(false); setBulkText('') }}
                  style={{ padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkAdd}
                  disabled={bulkLines.length === 0 || bulkDone}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 'var(--sb-r-chip)', background: bulkDone ? 'color-mix(in srgb, var(--sb-positive) 15.0%, transparent)' : 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)', border: `var(--sb-border-width) solid ${bulkDone ? 'color-mix(in srgb, var(--sb-positive) 50.0%, transparent)' : 'color-mix(in srgb, var(--sb-positive) 30.0%, transparent)'}`, color: 'var(--sb-positive)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: bulkLines.length === 0 ? 'default' : 'pointer', opacity: bulkLines.length === 0 ? 0.4 : 1, transition: 'all 0.15s' }}
                >
                  {bulkDone
                    ? <><CheckCheck size={ICON.sm} /> Added!</>
                    : <><Plus size={ICON.sm} /> Add {bulkLines.length > 0 ? `${bulkLines.length} ` : ''}task{bulkLines.length !== 1 ? 's' : ''}</>
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
