
import { useState, useCallback } from 'react'
import { Mail, Zap, Clock, Copy, CheckCheck, RefreshCw, ArrowRight } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { triageEmail } from '@/lib/professor'
import type { EmailTriage, EmailData } from '@/lib/professor'
import { useAuthStore } from '@/store/authStore'
import type { DbUser, DbCompany } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockEmail {
  id: string
  fromName: string
  fromEmail: string
  subject: string
  preview: string
  body: string
  receivedAt: string
}

interface TriageState {
  result: EmailTriage | null
  loading: boolean
  error: string | null
  copied: boolean
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_COMPANIES: DbCompany[] = [
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: '#C49A3C', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: '#1D9E75', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: '#888780', calendar_id: null, is_active: true },
]

const DEMO_EMAILS: MockEmail[] = [
  {
    id: 'e1',
    fromName: 'Sarah Chen',
    fromEmail: 'sarah.chen@acmecorp.com',
    subject: 'Urgent: Contract approval needed by EOD',
    preview: 'The legal team has flagged two clauses that need your sign-off before we can proceed...',
    body: `Hi,

The legal team has flagged two clauses in the Acme consulting agreement that need your direct approval before we can proceed with the partnership.

Clause 7.3 (Liability Cap): The current limit of $500K may be insufficient given the project scope. Legal recommends raising it to $1.2M.

Clause 12.1 (IP Assignment): The broad language could inadvertently transfer pre-existing IP. Legal recommends adding a carve-out.

We need your sign-off by end of day today so we can send the final version to Acme by tomorrow morning. Can you approve or should we schedule a 15-minute call?

Best,
Sarah Chen
Legal Operations`,
    receivedAt: new Date(Date.now() - 45 * 60000).toISOString(),
  },
  {
    id: 'e2',
    fromName: 'Marcus Webb',
    fromEmail: 'marcus@dxtechnologies.io',
    subject: 'Q2 Product Roadmap — your input needed',
    preview: "Attached is the draft Q2 roadmap. We'd love your strategic perspective before the board...",
    body: `Hi,

Attached is the draft Q2 product roadmap for DX Technologies. Before we present this to the board next week, we'd love your strategic input on two areas:

1. AI feature prioritization — should we accelerate the ML pipeline or focus on UX improvements first?
2. Resource allocation — we're debating whether to hire 2 more engineers or contract out the infrastructure work.

Your perspective would be invaluable given your experience scaling similar products. Can you review and share thoughts by Thursday?

Thanks,
Marcus Webb
VP of Product`,
    receivedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'e3',
    fromName: 'Teradix Finance',
    fromEmail: 'finance@teradix.com',
    subject: 'March expense reports ready for approval',
    preview: 'Team expense reports for March are ready. Total: $24,750. Deadline for approval is...',
    body: `Dear Executive Team,

March expense reports are ready for your approval in the finance portal.

Summary:
- Engineering team: $12,400 (conferences, equipment)
- Sales team: $8,200 (client entertainment, travel)
- Marketing: $4,150 (campaigns, tools)
- Total: $24,750

Please approve or flag any items by March 25th to ensure timely processing. Reports requiring >$5K approval are highlighted in red.

Finance Team
Teradix`,
    receivedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
  {
    id: 'e4',
    fromName: 'Lena Kovač',
    fromEmail: 'lena.kovac@ventures.vc',
    subject: 'Introduction: Series B opportunity',
    preview: 'I hope this finds you well. A portfolio company of ours is raising their Series B and...',
    body: `Hi,

I hope this finds you well. A portfolio company of ours — QuantumLeap AI — is raising their Series B ($15M) and given your expertise in AI infrastructure, I thought there might be a natural fit.

They've built impressive traction: $2.4M ARR, 340% YoY growth, major Fortune 500 pilots ongoing.

Would you be open to a 30-minute intro call with the founders next week? Happy to share the deck in advance.

Best,
Lena Kovač
General Partner, Cascade Ventures`,
    receivedAt: new Date(Date.now() - 8 * 3600000).toISOString(),
  },
  {
    id: 'e5',
    fromName: 'AWS Partnership',
    fromEmail: 'partnerships@aws.amazon.com',
    subject: 'Your AWS credits renewal — action required',
    preview: 'Your AWS Activate credits are expiring on April 1st. To renew your $10,000 credit...',
    body: `Hello,

Your AWS Activate credits ($10,000) are set to expire on April 1st, 2026.

To renew, please complete the usage report at the link below and submit your renewal application. The process takes approximately 2 weeks to process.

Note: Unused credits do not roll over. Your current balance is $3,240.

Action required by: March 28th, 2026.

AWS Partnership Team`,
    receivedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
]

// ─── Meta ─────────────────────────────────────────────────────────────────────

const CLASS_META = {
  decision: { label: 'Decision Needed', color: '#C49A3C', bg: 'rgba(196,154,60,0.1)' },
  fyi:      { label: 'FYI',             color: '#7F77DD', bg: 'rgba(127,119,221,0.1)' },
  waiting:  { label: 'Waiting',         color: '#888780', bg: 'rgba(136,135,128,0.1)' },
  delegate: { label: 'Delegate',        color: '#1D9E75', bg: 'rgba(29,158,117,0.1)'  },
} as const

const URGENCY_META = {
  high:   { label: 'High',   color: '#E05252' },
  medium: { label: 'Medium', color: '#C49A3C' },
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
    email: user?.email ?? 'bahaa@example.com',
    full_name: user?.name ?? 'Bahaa Ahmed',
    avatar_url: null,
    active_framework: 'time_blocking',
    schedule_rules: { focus_hours: '09:00–12:00', buffer_minutes: 15 },
    created_at: new Date().toISOString(),
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InboxModule() {
  const user = useAuthStore(s => s.user)
  const [selectedId, setSelectedId] = useState<string>(DEMO_EMAILS[0].id)
  const [triageMap, setTriageMap] = useState<Record<string, TriageState>>({})

  const selectedEmail = DEMO_EMAILS.find(e => e.id === selectedId)!
  const selectedTriage = triageMap[selectedId] ?? null
  const triagedCount = DEMO_EMAILS.filter(e => triageMap[e.id]?.result).length

  const handleTriage = useCallback(async (email: MockEmail) => {
    setTriageMap(prev => ({
      ...prev,
      [email.id]: { result: null, loading: true, error: null, copied: false },
    }))
    try {
      const dbUser = buildMockUser(user)
      const emailData: EmailData = {
        user: dbUser,
        companies: MOCK_COMPANIES,
        subject: email.subject,
        fromEmail: email.fromEmail,
        body: email.body,
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

  return (
    <div>
      <TopBar title="Command Inbox" subtitle="Triage, delegate, act — zero inbox noise." />

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

      <div style={{ padding: '24px 28px' }}>

        {/* Stats bar */}
        <div style={{
          display: 'flex', gap: 20, marginBottom: 20,
          padding: '13px 20px',
          background: '#2A2218', border: '1px solid #3A3020', borderRadius: 10,
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Mail size={14} color="#C49A3C" />
            <span style={{ fontSize: 13, color: '#F0E8D8' }}>{DEMO_EMAILS.length} emails</span>
          </div>
          <div style={{ width: 1, height: 14, background: '#3A3020' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Zap size={14} color="#1D9E75" />
            <span style={{ fontSize: 13, color: '#F0E8D8' }}>{triagedCount} triaged</span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={() => void handleTriage(selectedEmail)}
              disabled={selectedTriage?.loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 7,
                background: 'rgba(196,154,60,0.12)', border: '1px solid rgba(196,154,60,0.25)',
                color: '#C49A3C', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                opacity: selectedTriage?.loading ? 0.5 : 1,
              }}
            >
              <Zap size={12} />
              Triage selected with AI
            </button>
          </div>
        </div>

        {/* Main grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>

          {/* ─── Email List ───────────────────────────────────────────────── */}
          <div style={{ background: '#2A2218', border: '1px solid #3A3020', borderRadius: 12, overflow: 'hidden' }}>
            {DEMO_EMAILS.map((email, i) => {
              const isSelected = selectedId === email.id
              const triage = triageMap[email.id]
              const classMeta = triage?.result ? CLASS_META[triage.result.classification] : null
              return (
                <button
                  key={email.id}
                  onClick={() => setSelectedId(email.id)}
                  style={{
                    width: '100%', padding: '15px 18px', textAlign: 'left',
                    background: isSelected ? 'rgba(196,154,60,0.06)' : 'transparent',
                    border: 'none',
                    borderBottom: i < DEMO_EMAILS.length - 1 ? '1px solid #3A3020' : 'none',
                    borderLeft: isSelected ? '3px solid #C49A3C' : '3px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#F0E8D8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {email.fromName}
                        </span>
                        {classMeta && (
                          <span style={{
                            fontSize: 9.5, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                            background: classMeta.bg, color: classMeta.color, fontWeight: 600,
                          }}>
                            {classMeta.label}
                          </span>
                        )}
                        {triage?.loading && (
                          <RefreshCw size={10} color="#C49A3C" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                        )}
                      </div>
                      <p style={{ margin: '0 0 3px', fontSize: 12.5, color: '#C8BAA0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email.subject}
                      </p>
                      <p style={{ margin: 0, fontSize: 11.5, color: '#8A7A60', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email.preview}
                      </p>
                    </div>
                    <span style={{ fontSize: 10.5, color: '#8A7A60', flexShrink: 0, paddingTop: 2 }}>
                      {fmtRelTime(email.receivedAt)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* ─── Right Panel ──────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Email body */}
            <div style={{ background: '#2A2218', border: '1px solid #3A3020', borderRadius: 12, padding: '22px 24px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#F0E8D8', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px' }}>
                {selectedEmail.subject}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 12.5, color: '#C49A3C', fontWeight: 500 }}>{selectedEmail.fromName}</span>
                <span style={{ fontSize: 12, color: '#8A7A60' }}>{`<${selectedEmail.fromEmail}>`}</span>
                <span style={{ fontSize: 11, color: '#8A7A60', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={10} />{fmtRelTime(selectedEmail.receivedAt)}
                </span>
              </div>
              <div style={{ height: 1, background: '#3A3020', marginBottom: 16 }} />
              <p style={{ margin: 0, fontSize: 13.5, color: '#C8BAA0', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {selectedEmail.body}
              </p>
            </div>

            {/* Triage panel */}
            {selectedTriage?.loading ? (
              <div style={{
                background: '#2A2218', border: '1px solid rgba(196,154,60,0.2)',
                borderRadius: 12, padding: '22px 24px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <RefreshCw size={15} color="#C49A3C" style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, color: '#C49A3C' }}>The Professor is analyzing this email…</span>
              </div>

            ) : selectedTriage?.error ? (
              <div style={{ background: '#2A2218', border: '1px solid #3A3020', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: '#8A7A60' }}>{selectedTriage.error}</p>
                <button
                  onClick={() => void handleTriage(selectedEmail)}
                  style={{ padding: '7px 14px', borderRadius: 7, background: '#C49A3C18', border: '1px solid #C49A3C30', color: '#C49A3C', fontSize: 12, cursor: 'pointer' }}
                >
                  Try again
                </button>
              </div>

            ) : selectedTriage?.result ? (
              <div style={{
                background: 'rgba(196,154,60,0.05)', border: '1px solid rgba(196,154,60,0.2)',
                borderRadius: 12, padding: '22px 24px',
              }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 5,
                    background: 'rgba(196,154,60,0.15)', border: '1px solid rgba(196,154,60,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Zap size={12} color="#C49A3C" />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#C49A3C', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                    The Professor's Triage
                  </span>
                </div>

                {/* Badges */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                  <div style={{
                    flex: 1, padding: '12px 14px',
                    background: CLASS_META[selectedTriage.result.classification].bg,
                    border: `1px solid ${CLASS_META[selectedTriage.result.classification].color}30`,
                    borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 10, color: '#8A7A60', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Classification</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: CLASS_META[selectedTriage.result.classification].color }}>
                      {CLASS_META[selectedTriage.result.classification].label}
                    </div>
                  </div>
                  <div style={{
                    flex: 1, padding: '12px 14px',
                    background: '#1C1814',
                    border: `1px solid ${URGENCY_META[selectedTriage.result.urgency].color}30`,
                    borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 10, color: '#8A7A60', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Urgency</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: URGENCY_META[selectedTriage.result.urgency].color }}>
                      {URGENCY_META[selectedTriage.result.urgency].label}
                    </div>
                  </div>
                  {selectedTriage.result.followUpDate && (
                    <div style={{ flex: 1, padding: '12px 14px', background: '#1C1814', border: '1px solid #3A3020', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: '#8A7A60', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Follow Up</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#F0E8D8' }}>
                        {selectedTriage.result.followUpDate}
                      </div>
                    </div>
                  )}
                </div>

                {/* Suggested reply */}
                {selectedTriage.result.suggestedReply && (
                  <div style={{ background: '#1C1814', border: '1px solid #3A3020', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#8A7A60', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Suggested Reply
                      </span>
                      <button
                        onClick={() => handleCopyReply(selectedEmail.id, selectedTriage.result!.suggestedReply)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '4px 9px', borderRadius: 5,
                          background: 'transparent', border: '1px solid #3A3020',
                          color: '#8A7A60', fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        {selectedTriage.copied
                          ? <><CheckCheck size={10} /><span>Copied</span></>
                          : <><Copy size={10} /><span>Copy</span></>}
                      </button>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: '#C8BAA0', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                      {selectedTriage.result.suggestedReply}
                    </p>
                  </div>
                )}
              </div>

            ) : (
              // Empty state — invite to triage
              <div style={{
                background: '#2A2218', border: '1px dashed #3A3020',
                borderRadius: 12, padding: '36px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: 'rgba(196,154,60,0.08)', border: '1px solid rgba(196,154,60,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Zap size={18} color="#C49A3C" />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: '0 0 5px', fontSize: 14, color: '#F0E8D8', fontWeight: 500 }}>
                    Let The Professor triage this
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: '#8A7A60' }}>
                    Get classification, urgency level, and a ready-to-send reply
                  </p>
                </div>
                <button
                  onClick={() => void handleTriage(selectedEmail)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '9px 20px', borderRadius: 8,
                    background: 'rgba(196,154,60,0.12)', border: '1px solid rgba(196,154,60,0.25)',
                    color: '#C49A3C', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  <Zap size={13} />
                  Triage with AI
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
