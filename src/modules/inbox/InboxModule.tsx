
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Mail, Zap, Clock, Copy, CheckCheck, RefreshCw, ArrowRight, WifiOff, ListPlus, Plus, Archive, Search, X as XIcon, PenSquare } from 'lucide-react'
import { triageEmail } from '@/lib/professor'
import type { EmailTriage, EmailData } from '@/lib/professor'
import { listUnreadThreadIds, getThread, extractBody, extractHtmlBody, header, markAsRead, archiveMessage, sendReply, composeEmail } from '@/lib/gmail'
import { signInWithGoogle } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { DbUser } from '@/types/database'
import { loadDynamicCompanies } from '@/types'

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

function avatarColor(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function SenderAvatar({ name, email }: { name: string; email: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const bg = avatarColor(email)
  return (
    <div style={{ width: 34, height: 34, borderRadius: '50%', background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>
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

function EmailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)

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
</head><body>${html}</body></html>`

  function onLoad() {
    const iframe = ref.current
    if (!iframe?.contentWindow) return
    try {
      const h = iframe.contentWindow.document.body.scrollHeight
      iframe.style.height = `${Math.max(200, h + 24)}px`
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
  const [replyText,  setReplyText]  = useState<Record<string, string>>({})
  const [sending,    setSending]    = useState<string | null>(null)
  const [sentIds,    setSentIds]    = useState<Set<string>>(new Set())
  const [expandedThread, setExpandedThread] = useState<string | null>(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [nextPageToken,  setNextPageToken]  = useState<string | undefined>(undefined)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [composing,      setComposing]      = useState(false)
  const [composeTo,      setComposeTo]      = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody,    setComposeBody]    = useState('')
  const [composeSending, setComposeSending] = useState(false)
  const [composeSent,    setComposeSent]    = useState(false)
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set())
  const [batchArchiving, setBatchArchiving] = useState(false)

  // ── Bulk task state ──────────────────────────────────────────────────────────
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

  // Domains belonging to hidden companies — emails from these are filtered out
  const hiddenDomains = useMemo(() => new Set(
    loadDynamicCompanies()
      .filter(c => c.hidden && c.emailDomain)
      .map(c => c.emailDomain!.toLowerCase().replace(/^@/, ''))
  ), [emails])

  const visibleEmails = useMemo(() =>
    emails.filter(e => {
      const domain = e.fromEmail.split('@')[1]?.toLowerCase()
      return !domain || !hiddenDomains.has(domain)
    })
  , [emails, hiddenDomains])

  const filteredEmails = searchQuery.trim()
    ? visibleEmails.filter(e => {
        const q = searchQuery.toLowerCase()
        return e.fromName.toLowerCase().includes(q) || e.fromEmail.toLowerCase().includes(q) ||
               e.subject.toLowerCase().includes(q)  || e.preview.toLowerCase().includes(q)
      })
    : visibleEmails

  const selectedEmail  = emails.find(e => e.id === selectedId) ?? null
  const selectedTriage = selectedId ? (triageMap[selectedId] ?? null) : null
  const triagedCount   = emails.filter(e => triageMap[e.id]?.result).length

  const loadEmails = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    setNoAuth(false)
    try {
      const { ids: threadIds, nextPageToken: npt } = await listUnreadThreadIds(20)
      setNextPageToken(npt)
      const threads   = await Promise.all(threadIds.map(id => getThread(id)))
      const parsed: Email[] = threads.map(thread => {
        const msg     = thread.messages[thread.messages.length - 1]
        const headers = msg.payload.headers
        const from    = header(headers, 'from')
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</)
        return {
          id:          msg.id,
          threadId:    thread.id,
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
      })
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
  }, [])

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

  const handleArchive = useCallback(async (email: Email) => {
    setArchiving(email.id)
    try {
      await archiveMessage(email.id)
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
      await sendReply({ to: email.fromEmail, subject: email.subject, body, threadId: email.threadId, inReplyTo: email.inReplyTo })
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
      const { ids, nextPageToken: npt } = await listUnreadThreadIds(20, nextPageToken)
      setNextPageToken(npt)
      const threads = await Promise.all(ids.map(id => getThread(id)))
      const parsed: Email[] = threads.map(thread => {
        const msg = thread.messages[thread.messages.length - 1]
        const headers = msg.payload.headers
        const from = header(headers, 'from')
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</)
        return {
          id: msg.id, threadId: thread.id,
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
  }, [nextPageToken, loadingMore])

  async function handleBatchArchive() {
    if (!selectedIds.size || batchArchiving) return
    setBatchArchiving(true)
    try {
      await Promise.all([...selectedIds].map(id => archiveMessage(id).catch(() => {})))
      setEmails(prev => {
        const next = prev.filter(e => !selectedIds.has(e.id))
        setSelectedId(next.length > 0 ? next[0].id : null)
        return next
      })
      setSelectedIds(new Set())
    } finally { setBatchArchiving(false) }
  }

  async function handleComposeSend() {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return
    setComposeSending(true)
    try {
      await composeEmail({ to: composeTo.trim(), subject: composeSubject.trim(), body: composeBody.trim() })
      setComposeSent(true)
      setTimeout(() => { setComposing(false); setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeSent(false) }, 1500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send.')
    } finally { setComposeSending(false) }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────

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

    if (noAuth || emails.length === 0) return null

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
                  void markAsRead(email.id).catch(() => { /* offline */ })
                }
              }}
              style={{
                width: '100%', padding: '12px 16px', textAlign: 'left',
                background: isSelected ? 'rgba(30,64,175,0.06)' : 'transparent',
                border: 'none',
                borderBottom: i < emails.length - 1 ? '1px solid #E8E1CE' : 'none',
                borderLeft: isSelected ? '3px solid #1E40AF' : '3px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}
                  onClick={ev => { ev.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); n.has(email.id) ? n.delete(email.id) : n.add(email.id); return n }) }}>
                  {selectedIds.has(email.id)
                    ? <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#7F77DD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckCheck size={16} color="#fff" /></div>
                    : <SenderAvatar name={email.fromName} email={email.fromEmail} />
                  }
                  {!isRead && !selectedIds.has(email.id) && <div style={{ position: 'absolute', top: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: '#7F77DD', border: '2px solid #FFFFFF' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: isRead ? 400 : 700, color: isRead ? 'var(--color-text-dim, #94A3B8)' : '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  <p style={{ margin: '0 0 3px', fontSize: 12.5, color: isRead ? 'var(--color-text-dim, #94A3B8)' : '#191712', fontWeight: isRead ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.subject}
                  </p>
                  <p style={{ margin: 0, fontSize: 11.5, color: '#6C6553', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.preview}
                  </p>
                </div>
                <span style={{ fontSize: 10.5, color: '#6C6553', flexShrink: 0, paddingTop: 2 }}>
                  {fmtRelTime(email.receivedAt)}
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
            <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF', lineHeight: 1.6, maxWidth: 320 }}>
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
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#FFFFFF' }}>{fetchError}</p>
          <button onClick={() => void loadEmails()} style={{ padding: '7px 18px', borderRadius: 8, background: 'var(--sb-accent-tint)', border: '1px solid #1E40AF30', color: '#7F77DD', fontSize: 12, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )
    }

    if (loading || !selectedEmail) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Email body */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, padding: '22px 24px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#191712', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px' }}>
            {selectedEmail.subject}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: '#7F77DD', fontWeight: 600 }}>{selectedEmail.fromName}</span>
              <span style={{ fontSize: 12, color: '#6C6553' }}>{`<${selectedEmail.fromEmail}>`}</span>
              <span style={{ fontSize: 11, color: '#6C6553', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <Clock size={10} />{fmtRelTime(selectedEmail.receivedAt)}
              </span>
              <button
                onClick={() => void handleArchive(selectedEmail)}
                disabled={archiving === selectedEmail.id}
                title="Archive"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #E8E1CE', color: 'var(--color-text-dim, #94A3B8)', fontSize: 11.5, cursor: 'pointer', opacity: archiving === selectedEmail.id ? 0.5 : 1 }}
              >
                <Archive size={12} /> Archive
              </button>
            </div>
            {selectedEmail.to && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6C6553', minWidth: 18 }}>To</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-dim, #94A3B8)', wordBreak: 'break-word' }}>{selectedEmail.to}</span>
              </div>
            )}
            {selectedEmail.cc && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6C6553', minWidth: 18 }}>CC</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-dim, #94A3B8)', wordBreak: 'break-word' }}>{selectedEmail.cc}</span>
              </div>
            )}
          </div>
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
                        ? <EmailBodyFrame html={m.htmlBody} />
                        : <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim, #94A3B8)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ height: 1, background: '#E8E1CE', marginBottom: 16 }} />
          {selectedEmail.htmlBody ? (
            <EmailBodyFrame html={selectedEmail.htmlBody} />
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
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#FFFFFF' }}>{selectedTriage.error}</p>
            <button onClick={() => void handleTriage(selectedEmail)} style={{ padding: '7px 14px', borderRadius: 7, background: 'var(--sb-accent-tint)', border: '1px solid #1E40AF30', color: '#7F77DD', fontSize: 12, cursor: 'pointer' }}>
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
                <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Classification</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: CLASS_META[selectedTriage.result.classification].color }}>
                  {CLASS_META[selectedTriage.result.classification].label}
                </div>
              </div>
              <div style={{ flex: 1, padding: '12px 14px', background: '#F7F4EA', border: `1px solid ${URGENCY_META[selectedTriage.result.urgency].color}30`, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Urgency</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: URGENCY_META[selectedTriage.result.urgency].color }}>
                  {URGENCY_META[selectedTriage.result.urgency].label}
                </div>
              </div>
              {selectedTriage.result.followUpDate && (
                <div style={{ flex: 1, padding: '12px 14px', background: '#F7F4EA', border: '1px solid #E8E1CE', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Follow Up</div>
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
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Reply to {selectedEmail.fromName}
                    </span>
                    <button
                      onClick={() => handleCopyReply(selectedEmail.id, draft)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 5, background: 'transparent', border: '1px solid #E8E1CE', color: 'var(--color-text-dim, #94A3B8)', fontSize: 11, cursor: 'pointer' }}
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
              <p style={{ margin: 0, fontSize: 12.5, color: '#FFFFFF' }}>Get classification, urgency level, and a ready-to-send reply</p>
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
              <span style={{ fontSize: 13, color: '#191712' }}>{loading ? '…' : emails.length} unread</span>
            </div>
            <div style={{ width: 1, height: 14, background: '#E8E1CE' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Zap size={14} color="#1D9E75" />
              <span style={{ fontSize: 13, color: '#191712' }}>{triagedCount} triaged</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={() => setComposing(o => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, background: composing ? 'rgba(30,64,175,0.12)' : 'transparent', border: `1px solid ${composing ? 'rgba(30,64,175,0.3)' : '#E8E1CE'}`, color: composing ? '#7F77DD' : '#6C6553', fontSize: 12, cursor: 'pointer' }}
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
        {composing && (
          <div style={{ marginBottom: 12, padding: '16px 20px', background: '#FFFFFF', border: '1px solid rgba(30,64,175,0.25)', borderRadius: 10 }}>
            <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#7F77DD', textTransform: 'uppercase', letterSpacing: '0.6px' }}>New Message</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="To"
                style={{ padding: '8px 12px', borderRadius: 7, background: '#F7F4EA', border: '1px solid #E8E1CE', color: '#191712', fontSize: 13, outline: 'none' }} />
              <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject"
                style={{ padding: '8px 12px', borderRadius: 7, background: '#F7F4EA', border: '1px solid #E8E1CE', color: '#191712', fontSize: 13, outline: 'none' }} />
              <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} placeholder="Write your message…" rows={6}
                style={{ padding: '10px 12px', borderRadius: 7, resize: 'vertical', background: '#F7F4EA', border: '1px solid #E8E1CE', color: '#191712', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', outline: 'none' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setComposing(false)} style={{ padding: '7px 14px', borderRadius: 7, background: 'transparent', border: '1px solid #E8E1CE', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={() => void handleComposeSend()}
                  disabled={!composeTo.trim() || !composeSubject.trim() || !composeBody.trim() || composeSending}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 18px', borderRadius: 7, background: composeSent ? 'rgba(29,158,117,0.12)' : 'rgba(30,64,175,0.12)', border: `1px solid ${composeSent ? 'rgba(29,158,117,0.3)' : 'rgba(30,64,175,0.25)'}`, color: composeSent ? '#1D9E75' : '#7F77DD', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: composeSending ? 0.5 : 1 }}
                >
                  {composeSent ? <><CheckCheck size={12} /> Sent!</> : composeSending ? <><RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : <><ArrowRight size={11} /> Send</>}
                </button>
              </div>
            </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: emails.length > 0 ? '360px 1fr' : '1fr', gap: 16 }}>
            {renderLeft()}
            {renderRight()}
          </div>
        )}
      </div>
    </div>
  )
}
