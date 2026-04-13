
import { useState, useCallback, useEffect } from 'react'
import { Mail, Zap, Clock, Copy, CheckCheck, RefreshCw, ArrowRight, WifiOff } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { triageEmail } from '@/lib/professor'
import type { EmailTriage, EmailData } from '@/lib/professor'
import { listUnreadThreadIds, getThread, extractBody, header } from '@/lib/gmail'
import { signInWithGoogle } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import type { DbUser } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Email {
  id: string
  threadId: string
  fromName: string
  fromEmail: string
  subject: string
  preview: string
  body: string
  receivedAt: string
  inReplyTo?: string
}

interface TriageState {
  result: EmailTriage | null
  loading: boolean
  error: string | null
  copied: boolean
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const CLASS_META = {
  decision: { label: 'Decision Needed', color: '#1E40AF', bg: 'rgba(30,64,175,0.1)' },
  fyi:      { label: 'FYI',             color: '#7F77DD', bg: 'rgba(127,119,221,0.1)' },
  waiting:  { label: 'Waiting',         color: '#888780', bg: 'rgba(136,135,128,0.1)' },
  delegate: { label: 'Delegate',        color: '#1D9E75', bg: 'rgba(29,158,117,0.1)'  },
} as const

const URGENCY_META = {
  high:   { label: 'High',   color: '#E05252' },
  medium: { label: 'Medium', color: '#1E40AF' },
  low:    { label: 'Low',    color: '#888780' },
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function InboxModule() {
  const user = useAuthStore(s => s.user)

  const [emails,     setEmails]     = useState<Email[]>([])
  const [loading,    setLoading]    = useState(true)
  const [noAuth,     setNoAuth]     = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [triageMap,  setTriageMap]  = useState<Record<string, TriageState>>({})

  const selectedEmail  = emails.find(e => e.id === selectedId) ?? null
  const selectedTriage = selectedId ? (triageMap[selectedId] ?? null) : null
  const triagedCount   = emails.filter(e => triageMap[e.id]?.result).length

  const loadEmails = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    setNoAuth(false)
    try {
      const threadIds = await listUnreadThreadIds(20)
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
          body:        extractBody(msg),
          receivedAt:  new Date(parseInt(msg.internalDate)).toISOString(),
          inReplyTo:   header(headers, 'message-id') || undefined,
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

  // ─── Render helpers ──────────────────────────────────────────────────────

  function renderLeft() {
    if (loading) {
      return (
        <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, overflow: 'hidden' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ padding: '16px 18px', borderBottom: i < 3 ? '1px solid var(--color-border, #252A3E)' : 'none' }}>
              <div style={{ height: 12, borderRadius: 6, background: 'linear-gradient(90deg, var(--color-border, #252A3E) 25%, var(--color-surface2, #4A3E28) 50%, var(--color-border, #252A3E) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s infinite', marginBottom: 8, width: '60%' }} />
              <div style={{ height: 10, borderRadius: 6, background: 'linear-gradient(90deg, var(--color-border, #252A3E) 25%, var(--color-surface2, #4A3E28) 50%, var(--color-border, #252A3E) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s infinite', width: '80%' }} />
            </div>
          ))}
        </div>
      )
    }

    if (noAuth || emails.length === 0) return null

    return (
      <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, overflow: 'hidden' }}>
        {emails.map((email, i) => {
          const isSelected = selectedId === email.id
          const triage     = triageMap[email.id]
          const classMeta  = triage?.result ? CLASS_META[triage.result.classification] : null
          return (
            <button
              key={email.id}
              onClick={() => setSelectedId(email.id)}
              style={{
                width: '100%', padding: '15px 18px', textAlign: 'left',
                background: isSelected ? 'rgba(30,64,175,0.06)' : 'transparent',
                border: 'none',
                borderBottom: i < emails.length - 1 ? '1px solid var(--color-border, #252A3E)' : 'none',
                borderLeft: isSelected ? '3px solid #1E40AF' : '3px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text, #E8EAF6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.fromName}
                    </span>
                    {classMeta && (
                      <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 3, flexShrink: 0, background: classMeta.bg, color: classMeta.color, fontWeight: 600 }}>
                        {classMeta.label}
                      </span>
                    )}
                    {triage?.loading && (
                      <RefreshCw size={10} color="#1E40AF" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    )}
                  </div>
                  <p style={{ margin: '0 0 3px', fontSize: 12.5, color: '#FFFFFF', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.subject}
                  </p>
                  <p style={{ margin: 0, fontSize: 11.5, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.preview}
                  </p>
                </div>
                <span style={{ fontSize: 10.5, color: '#FFFFFF', flexShrink: 0, paddingTop: 2 }}>
                  {fmtRelTime(email.receivedAt)}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  function renderRight() {
    if (noAuth) {
      return (
        <div style={{
          background: 'var(--color-surface, #161929)', border: '1px dashed var(--color-border, #252A3E)',
          borderRadius: 12, padding: '48px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          textAlign: 'center',
        }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(30,64,175,0.08)', border: '1px solid rgba(30,64,175,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <WifiOff size={22} color="#1E40AF" />
          </div>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif" }}>
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
              color: '#1E40AF', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <Mail size={14} /> Connect Google Account
          </button>
        </div>
      )
    }

    if (fetchError) {
      return (
        <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, padding: '32px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#FFFFFF' }}>{fetchError}</p>
          <button onClick={() => void loadEmails()} style={{ padding: '7px 18px', borderRadius: 8, background: '#1E40AF18', border: '1px solid #1E40AF30', color: '#1E40AF', fontSize: 12, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )
    }

    if (loading || !selectedEmail) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Email body */}
        <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, padding: '22px 24px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px' }}>
            {selectedEmail.subject}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 12.5, color: '#1E40AF', fontWeight: 500 }}>{selectedEmail.fromName}</span>
            <span style={{ fontSize: 12, color: '#FFFFFF' }}>{`<${selectedEmail.fromEmail}>`}</span>
            <span style={{ fontSize: 11, color: '#FFFFFF', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={10} />{fmtRelTime(selectedEmail.receivedAt)}
            </span>
          </div>
          <div style={{ height: 1, background: 'var(--color-border, #252A3E)', marginBottom: 16 }} />
          <p style={{ margin: 0, fontSize: 13.5, color: '#FFFFFF', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {selectedEmail.body}
          </p>
        </div>

        {/* Triage panel */}
        {selectedTriage?.loading ? (
          <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid rgba(30,64,175,0.2)', borderRadius: 12, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={15} color="#1E40AF" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, color: '#1E40AF' }}>The Professor is analyzing this email…</span>
          </div>

        ) : selectedTriage?.error ? (
          <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, padding: '20px 24px' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#FFFFFF' }}>{selectedTriage.error}</p>
            <button onClick={() => void handleTriage(selectedEmail)} style={{ padding: '7px 14px', borderRadius: 7, background: '#1E40AF18', border: '1px solid #1E40AF30', color: '#1E40AF', fontSize: 12, cursor: 'pointer' }}>
              Try again
            </button>
          </div>

        ) : selectedTriage?.result ? (
          <div style={{ background: 'rgba(30,64,175,0.05)', border: '1px solid rgba(30,64,175,0.2)', borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <div style={{ width: 24, height: 24, borderRadius: 5, background: 'rgba(30,64,175,0.15)', border: '1px solid rgba(30,64,175,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={12} color="#1E40AF" />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
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
              <div style={{ flex: 1, padding: '12px 14px', background: 'var(--color-bg, #0D0F1A)', border: `1px solid ${URGENCY_META[selectedTriage.result.urgency].color}30`, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Urgency</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: URGENCY_META[selectedTriage.result.urgency].color }}>
                  {URGENCY_META[selectedTriage.result.urgency].label}
                </div>
              </div>
              {selectedTriage.result.followUpDate && (
                <div style={{ flex: 1, padding: '12px 14px', background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Follow Up</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>{selectedTriage.result.followUpDate}</div>
                </div>
              )}
            </div>

            {selectedTriage.result.suggestedReply && (
              <div style={{ background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggested Reply</span>
                  <button
                    onClick={() => handleCopyReply(selectedEmail.id, selectedTriage.result!.suggestedReply)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 5, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: '#FFFFFF', fontSize: 11, cursor: 'pointer' }}
                  >
                    {selectedTriage.copied ? <><CheckCheck size={10} /><span>Copied</span></> : <><Copy size={10} /><span>Copy</span></>}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {selectedTriage.result.suggestedReply}
                </p>
              </div>
            )}
          </div>

        ) : (
          <div style={{ background: 'var(--color-surface, #161929)', border: '1px dashed var(--color-border, #252A3E)', borderRadius: 12, padding: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(30,64,175,0.08)', border: '1px solid rgba(30,64,175,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={18} color="#1E40AF" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: '0 0 5px', fontSize: 14, color: 'var(--color-text, #E8EAF6)', fontWeight: 500 }}>Let The Professor triage this</p>
              <p style={{ margin: 0, fontSize: 12.5, color: '#FFFFFF' }}>Get classification, urgency level, and a ready-to-send reply</p>
            </div>
            <button
              onClick={() => void handleTriage(selectedEmail)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)', color: '#1E40AF', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
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
      <TopBar title="Command Inbox" subtitle="Triage, delegate, act — zero inbox noise." />

      <style>{`
        @keyframes spin    { from { transform: rotate(0deg)  } to { transform: rotate(360deg) } }
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
      `}</style>

      <div style={{ padding: '24px 28px' }}>

        {/* Stats bar */}
        {!noAuth && (
          <div style={{ display: 'flex', gap: 20, marginBottom: 20, padding: '13px 20px', background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Mail size={14} color="#1E40AF" />
              <span style={{ fontSize: 13, color: 'var(--color-text, #E8EAF6)' }}>{loading ? '…' : emails.length} unread</span>
            </div>
            <div style={{ width: 1, height: 14, background: 'var(--color-border, #252A3E)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Zap size={14} color="#1D9E75" />
              <span style={{ fontSize: 13, color: 'var(--color-text, #E8EAF6)' }}>{triagedCount} triaged</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={() => void loadEmails()}
                disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: '#FFFFFF', fontSize: 12, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}
              >
                <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                Refresh
              </button>
              {selectedEmail && (
                <button
                  onClick={() => void handleTriage(selectedEmail)}
                  disabled={triageMap[selectedEmail.id]?.loading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)', color: '#1E40AF', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: triageMap[selectedEmail.id]?.loading ? 0.5 : 1 }}
                >
                  <Zap size={12} /> Triage with AI
                </button>
              )}
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
