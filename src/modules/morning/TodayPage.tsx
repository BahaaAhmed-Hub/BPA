// ─── Today ───────────────────────────────────────────────────────────────────
// The morning brief, laid out as the artboard: the written brief and the mail
// that needs you down the left; the day's plan, the open tasks and the habit
// grid down the right. Everything reads from the same stores the rest of the
// app writes to — nothing here is illustrative.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
 RefreshCw, ArrowRight, Zap, Archive, Plus,
  Clock, Check, Flame, Sun, Quote, CheckSquare, X, ChevronDown,
  CornerUpLeft, CalendarClock, Scale, Send, Sparkles, Loader2, Eye,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import {
  useHabitsStore, loadLogs, saveLogs, loadQuantityLogs, saveQuantityLogs, calcStreak,
  type HabitLogs, type Habit,
} from '@/store/habitsStore'
import { evaluateRank } from '@/lib/behavioralEngine'
import { fetchVisibleEvents } from '@/lib/calendarEvents'
import type { GCalEvent } from '@/lib/googleCalendar'
import type { EventStatus } from '@/lib/eventMetadata'
import { loadEventStatuses, toggleEventStatus } from '@/lib/eventStatus'
import { listUnreadThreadIds, getThread, header, extractBody, extractHtmlBody, archiveMessage, sendMail, escapeHtml } from '@/lib/gmail'
import type { GmailHeader, MailAccount } from '@/lib/gmail'
import { mailAccounts } from '@/modules/inbox/mailAccounts'
import { briefsFor, rememberDraft, forgetBrief, type InboxBrief, type MailAction } from '@/lib/mailBriefs'
import { extractInvite, respondToInvite, RSVP_LABEL, type Invite, type Rsvp } from '@/lib/invitations'
import { notify } from '@/lib/undo'
import { TASK_TYPE_META, inferTaskType, isTaskHidden, loadDynamicCompanies } from '@/types'
import { isMailHiddenByCompany } from '@/lib/companyVisibility'
import { TASK_TYPE_ICON } from '@/modules/tasks/taskVisuals'
import type { Task } from '@/types'
import type { DbUser, DbCompany } from '@/types/database'
import { ICON, STROKE } from '@/lib/type'
import { dayTotals, spanTotals } from '@/lib/habitProgress'

// ─── Tokens ──────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
  boxShadow: 'var(--sb-shadow-control)', minWidth: 0,
}
const INK = 'var(--sb-ink-1)'
const MUTED = 'var(--sb-ink-3)'
const GHOST = 'var(--sb-ink-4)'
const HAIR = 'var(--sb-hairline)'
const FIELD = 'var(--sb-field)'
const AMBER = 'var(--sb-accent)'

const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
  borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  color: INK, fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit', cursor: 'pointer',
}
const GHOST_BTN: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: GHOST, display: 'flex', alignItems: 'center',
}
const ICON_TILE: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: FIELD, border: 'var(--sb-border-width) solid var(--sb-border)', color: MUTED,
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function offsetDays(key: string, delta: number): string {
  const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + delta); return dayKey(d)
}
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function minutesOf(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function addMinutes(t: string, mins: number): string {
  const total = (minutesOf(t) + mins + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
function fmtMins(total: number): string {
  const m = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function fmtHours(mins: number): string {
  if (mins <= 0) return '0m'
  const h = Math.floor(mins / 60); const m = mins % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}
function relAge(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
function initialsOf(name: string): string {
  return name.split(/[\s@.]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

// ─── Section header shared by every card ─────────────────────────────────────

function CardHead({ title, meta, children }: {
  title: string
  meta?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
      padding: '14px 16px 12px', borderBottom: `var(--sb-border-width) solid ${HAIR}`,
    }}>
      <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 700, color: INK, flexShrink: 0 }}>{title}</span>
      {typeof meta === 'string' ? (
        <span style={{
          fontSize: 'var(--sb-t-meta)', color: GHOST, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{meta}</span>
      ) : meta}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  )
}

function LinkOut({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      ...GHOST_BTN, gap: 5, color: MUTED, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, fontFamily: 'inherit', flexShrink: 0,
    }}>
      {label} <ArrowRight size={ICON.sm} strokeWidth={STROKE.active} />
    </button>
  )
}

// ─── The written brief ───────────────────────────────────────────────────────

interface Brief { headline: string; body: string; callout: string | null }

/** Reads the day back from the user's own numbers. No invention: every clause
 *  here is a fact one of the stores already knows. */
function composeBrief(args: {
  tasks: Task[]
  events: GCalEvent[]
  habits: Habit[]
  logs: HabitLogs
  score: number
  today: string
}): Brief {
  const { tasks, events, habits, logs, score, today } = args
  const open = tasks.filter(t => !t.completed && t.status !== 'cancelled')
  const urgent = open.filter(t => t.urgent)
  const meetings = events.filter(e => !!e.start.dateTime)
  const weekAgo = offsetDays(today, -7)
  const closedThisWeek = tasks.filter(t => t.completed && t.completedAt && t.completedAt >= weekAgo).length

  const stale = open.filter(t => {
    const days = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000)
    return days >= 4
  })

  // How long since any habit was logged at all
  const allLogged = habits.flatMap(h => logs[h.id] ?? []).sort()
  const lastLog = allLogged.at(-1)
  const coldDays = lastLog
    ? Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(lastLog + 'T00:00:00').getTime()) / 86400000)
    : null

  const firstMeeting = meetings
    .map(e => new Date(e.start.dateTime!))
    .filter(d => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0]

  const headline =
    meetings.length === 0 ? 'Nothing is booked. That is the opportunity.'
    : urgent.length > 0 ? `${urgent.length} ${urgent.length === 1 ? 'task is' : 'tasks are'} on fire today.`
    : meetings.length >= 4 ? 'The calendar owns today. Protect what is left.'
    : 'A workable day. Spend it on the decisions.'

  const sentences: string[] = []
  if (closedThisWeek > 0) sentences.push(`You closed ${closedThisWeek} task${closedThisWeek === 1 ? '' : 's'} this week.`)
  if (stale.length > 0) {
    sentences.push(`${stale.length} ${stale.length === 1 ? 'task has' : 'tasks have'} sat for four days or more.`)
  }
  if (meetings.length === 0) sentences.push('The calendar is empty today — the whole day is yours to place.')
  else if (firstMeeting) sentences.push(`First meeting at ${hhmm(firstMeeting)}; ${meetings.length} in total.`)
  if (open.length > 0) sentences.push(`${open.length} task${open.length === 1 ? '' : 's'} still open.`)
  if (sentences.length === 0) sentences.push('Nothing open, nothing booked. Take the win, then pick the next thing.')

  const callout =
    coldDays != null && coldDays >= 2
      ? `Habits cold for ${coldDays} day${coldDays === 1 ? '' : 's'} — the one number holding your rank at ${score}.`
      : urgent.length > 0
      ? `${urgent.length} on fire. Clear ${urgent.length === 1 ? 'it' : 'them'} before anything else opens.`
      : null

  return { headline, body: sentences.join(' '), callout }
}

// ─── Mail ────────────────────────────────────────────────────────────────────

interface MailRow {
  id: string
  messageId: string
  /** The RFC Message-ID header — what a reply threads against. The Gmail id
   *  above is a different thing entirely and Google will not accept it here. */
  rfcMessageId: string
  references: string
  fromName: string
  fromEmail: string
  to: string
  cc: string
  subject: string
  snippet: string
  /** The message as it was sent, when it carried HTML. */
  html: string | null
  body: string
  receivedAt: string
  needsYou: boolean
  newsletter: boolean
  /** Which mailbox it arrived in. A merged list you cannot act on is a list
   *  you do not know where a reply would leave from. */
  account: MailAccount
  /** Set when the message is a calendar invitation, which is answered by
   *  RSVPing rather than by writing back. */
  invite: Invite | null
}

/** The message itself, in a window that closes when you click away from it. */
function MailPopup({ row, onClose, onArchive, onAddTask }: {
  row: MailRow
  onClose: () => void
  onArchive: () => void
  onAddTask: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The sender's HTML runs in a sandboxed frame — never in the app's document
  const doc = `<!DOCTYPE html><html><head><base target="_blank"><meta charset="utf-8"><style>
    body { margin:0; padding:4px 2px; font-family:-apple-system,system-ui,sans-serif; font-size:14px;
           line-height:1.6; color:var(--sb-ink-1); word-break:break-word; }
    img { max-width:100%; height:auto; }
    a { color:var(--sb-info); }
    pre, blockquote { white-space:pre-wrap; }
    blockquote { margin:0 0 0 12px; padding-left:10px; border-left:2px solid var(--sb-border); color:var(--sb-ink-3); }
  </style></head><body>${row.html ?? `<pre>${row.body.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>`}</body></html>`

  function fit() {
    const f = frameRef.current
    if (!f?.contentWindow) return
    try { f.style.height = `${Math.max(220, f.contentWindow.document.body.scrollHeight + 24)}px` } catch { /* cross-origin */ }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'color-mix(in srgb, var(--sb-ink-1) 28.0%, transparent)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 20px 20px',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)', overflow: 'hidden',
          boxShadow: 'var(--sb-shadow-frame)',
        }}>

        {/* Who, what, when */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 14px', borderBottom: `var(--sb-border-width) solid ${HAIR}` }}>
          <span style={{
            width: 38, height: 38, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sb-field)', color: MUTED, fontSize: 'var(--sb-t-body-s)', fontWeight: 700,
          }}>{initialsOf(row.fromName || row.fromEmail)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
              letterSpacing: '-0.02em', color: INK, lineHeight: 1.25,
            }}>{row.subject}</h2>
            <p style={{ margin: '5px 0 0', fontSize: 'var(--sb-t-body-s)', color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <strong style={{ fontWeight: 600, color: INK }}>{row.fromName || row.fromEmail}</strong>
              {row.fromName ? ` · ${row.fromEmail}` : ''}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: GHOST }}>
              {row.to ? `to ${row.to} · ` : ''}
              {new Date(row.receivedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          {row.needsYou && (
            <span style={{
              flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
              background: 'rgba(var(--sb-accent-rgb),0.28)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.7)',
              color: 'var(--sb-accent-deep)', fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.06em',
              display: 'inline-flex', alignItems: 'center',
            }}>NEEDS YOU</span>
          )}
          <button onClick={onClose} title="Close"
            style={{ ...ICON_TILE, width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', cursor: 'pointer' }}>
            <X size={ICON.sm} />
          </button>
        </div>

        {/* The message */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px' }}>
          <iframe
            ref={frameRef}
            srcDoc={doc}
            sandbox="allow-same-origin"
            onLoad={fit}
            title={row.subject}
            style={{ width: '100%', minHeight: 220, border: 'none', display: 'block' }}
          />
        </div>

        {/* What to do about it */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: FIELD, borderTop: `var(--sb-border-width) solid ${HAIR}` }}>
          <span style={{ flex: 1, fontSize: 'var(--sb-t-meta)', color: GHOST }}>Esc, or click away, to close</span>
          <button onClick={onAddTask} style={{ ...PILL, height: 32 }}>
            <Plus size={ICON.sm} /> Add as task
          </button>
          <button onClick={onArchive} style={{ ...PILL, height: 32 }}>
            <Archive size={ICON.sm} /> Archive
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * What an invitation offers instead of a draft.
 *
 * A calendar invitation is an RSVP. Replying in prose sends the organiser a
 * pleasant email and tells Google nothing — your name stays in the "Awaiting"
 * column and the event never shows as accepted on your own calendar. So the
 * three answers write the real `responseStatus`, and the fourth does both,
 * because a decline is the one that usually wants a sentence with it.
 */
function InviteActions({ invite, busy, answered, error, onRespond, onDeclineWithNote }: {
  invite: Invite
  busy: Rsvp | null
  answered: Rsvp | null
  error: string | null
  onRespond: (r: Rsvp) => void
  onDeclineWithNote: () => void
}) {
  const when = invite.startsAt
    ? new Date(invite.startsAt).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        ...(invite.startsAt.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    : ''

  const TONE: Record<Rsvp, { bg: string; ink: string }> = {
    accepted:  { bg: 'var(--sb-positive)', ink: 'var(--sb-ink-on-fill)' },
    tentative: { bg: 'var(--sb-warning)',  ink: 'var(--sb-ink-on-fill)' },
    declined:  { bg: 'var(--sb-negative)', ink: 'var(--sb-ink-on-fill)' },
  }

  return (
    <div style={{
      marginTop: 7, marginLeft: 38, padding: '9px 11px 10px', borderRadius: 'var(--sb-r-chip)',
      background: FIELD, border: `var(--sb-border-width) solid ${HAIR}`,
      display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <CalendarClock size={ICON.sm} strokeWidth={STROKE.active} color={MUTED} />
        <span style={{
          fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.08em',
          color: MUTED, textTransform: 'uppercase', flexShrink: 0,
        }}>{invite.cancelled ? 'Cancelled' : 'Invitation'}</span>
        {when && (
          <span style={{
            fontSize: 'var(--sb-t-meta)', color: GHOST, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>· {when}</span>
        )}
      </span>

      {invite.cancelled ? (
        <span style={{ fontSize: 'var(--sb-t-meta)', color: GHOST }}>
          The organiser called it off — there is nothing to answer.
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(['accepted', 'tentative', 'declined'] as Rsvp[]).map(r => {
            const on = answered === r
            return (
              <button
                key={r}
                disabled={!!busy}
                onClick={() => onRespond(r)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 11px',
                  borderRadius: 'var(--sb-r-pill)', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                  fontSize: 'var(--sb-t-meta)', fontWeight: 700, flexShrink: 0,
                  background: on ? TONE[r].bg : 'var(--sb-card)',
                  border: `var(--sb-border-width) solid ${on ? TONE[r].bg : 'var(--sb-border)'}`,
                  color: on ? TONE[r].ink : INK,
                  opacity: busy && busy !== r ? 0.5 : 1,
                }}>
                {busy === r ? <Loader2 size={ICON.sm} className="sb-spin" /> : on ? <Check size={ICON.sm} /> : null}
                {RSVP_LABEL[r]}
              </button>
            )
          })}
          <button
            disabled={!!busy}
            onClick={onDeclineWithNote}
            title="Decline, and write a line to the organiser"
            style={{
              ...GHOST_BTN, gap: 4, flexShrink: 0, fontFamily: 'inherit',
              fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: MUTED,
            }}>
            No, with a note <ArrowRight size={ICON.sm} />
          </button>
        </span>
      )}

      {error && (
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)', lineHeight: 1.45 }}>{error}</span>
      )}
      {answered && !error && (
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-positive-deep)' }}>
          {RSVP_LABEL[answered]} — the organiser has been told.
        </span>
      )}
    </div>
  )
}

/**
 * The drafted reply, opened to be read before it goes.
 *
 * Nothing is sent from the card itself. A draft written by a model is a
 * starting point and has to be looked at, so the only thing the card's draft
 * area does is open this — where the message it answers is one click away, the
 * text is editable, and the mailbox it leaves from is named.
 */
function DraftPopup({ row, brief, onClose, onSent, onRewrite, rewriting }: {
  row: MailRow
  brief: InboxBrief
  onClose: () => void
  onSent: () => void
  onRewrite: () => void
  rewriting: boolean
}) {
  const [text, setText] = useState(brief.draft)
  const [to, setTo] = useState(row.fromEmail)
  const [cc, setCc] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)

  // The draft is rewritten under an open popup when Rewrite is used.
  useEffect(() => { setText(brief.draft) }, [brief.draft])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  const subject = /^re:/i.test(row.subject) ? row.subject : `Re: ${row.subject}`

  async function send() {
    if (!text.trim() || sending) return
    setSending(true); setFailed(null)
    try {
      await sendMail({
        account: row.account,
        to,
        cc: cc.trim() || undefined,
        subject,
        html: text.trim().split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join(''),
        threadId: row.id,
        inReplyTo: row.rfcMessageId || undefined,
        references: [row.references, row.rfcMessageId].filter(Boolean).join(' ') || undefined,
      })
      rememberDraft(row.id, text.trim())
      notify(`Replied to ${row.fromName || row.fromEmail}`)
      onSent()
    } catch (e) {
      // The reply is still in the box. Losing what was written because Gmail
      // was busy would be the worst possible answer to a failed send.
      setFailed(e instanceof Error ? e.message : 'The reply could not be sent.')
      setSending(false)
    }
  }

  return (
    <div
      onClick={() => { if (!sending) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 320,
        background: 'color-mix(in srgb, var(--sb-ink-1) 32%, transparent)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '7vh 20px 20px', overflowY: 'auto',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column',
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-card)', overflow: 'hidden', boxShadow: 'var(--sb-shadow-frame)',
        }}>

        {/* Who it answers, and what they said */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 13px', borderBottom: `var(--sb-border-width) solid ${HAIR}` }}>
          <span style={{
            width: 34, height: 34, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sb-accent-tint)', color: 'var(--sb-accent-deep)', fontSize: 'var(--sb-t-meta)', fontWeight: 800,
          }}>{initialsOf(row.fromName || row.fromEmail)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
              letterSpacing: '-0.02em', color: INK, lineHeight: 1.25,
            }}>{subject}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-body-s)', color: MUTED }}>
              {brief.summary || `${row.fromName || row.fromEmail} · ${relAge(row.receivedAt)}`}
            </p>
          </div>
          <button onClick={onClose} title="Close" disabled={sending}
            style={{ ...ICON_TILE, width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', cursor: sending ? 'default' : 'pointer' }}>
            <X size={ICON.sm} />
          </button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Where it goes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 30, flexShrink: 0, fontSize: 'var(--sb-t-meta)', color: GHOST }}>To</span>
            <input value={to} onChange={e => setTo(e.target.value)} style={DRAFT_FIELD} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 30, flexShrink: 0, fontSize: 'var(--sb-t-meta)', color: GHOST }}>Cc</span>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder={row.cc || 'nobody'} style={DRAFT_FIELD} />
          </div>

          {/* The draft */}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={9}
            style={{
              ...DRAFT_FIELD, height: 'auto', padding: '11px 12px', lineHeight: 1.55, resize: 'vertical',
              fontSize: 'var(--sb-t-body-s)',
            }} />

          {/* What it is answering, if you want to check */}
          <button onClick={() => setShowOriginal(v => !v)} style={{
            ...GHOST_BTN, gap: 5, alignSelf: 'flex-start', color: GHOST, fontSize: 'var(--sb-t-meta)', fontFamily: 'inherit',
          }}>
            <ChevronDown size={ICON.sm} style={{ transform: showOriginal ? undefined : 'rotate(-90deg)', transition: 'transform .12s' }} />
            {showOriginal ? 'Hide what they wrote' : 'Read what they wrote'}
          </button>
          {showOriginal && (
            <pre style={{
              margin: 0, maxHeight: 200, overflowY: 'auto', padding: '10px 12px', borderRadius: 'var(--sb-r-chip)',
              background: FIELD, border: `var(--sb-border-width) solid ${HAIR}`, whiteSpace: 'pre-wrap',
              fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', color: MUTED, lineHeight: 1.5,
            }}>{row.body.trim().slice(0, 4000)}</pre>
          )}

          {failed && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{failed}</div>
          )}
        </div>

        {/* Send it, or send it back to be rewritten */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: FIELD, borderTop: `var(--sb-border-width) solid ${HAIR}` }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', color: GHOST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Leaves from {row.account.email}
          </span>
          <button onClick={onRewrite} disabled={rewriting || sending} style={{ ...PILL, height: 32, opacity: rewriting ? 0.6 : 1 }}>
            {rewriting
              ? <Loader2 size={ICON.sm} className="sb-spin" />
              : <Sparkles size={ICON.sm} />}
            {rewriting ? 'Rewriting…' : 'Rewrite'}
          </button>
          <button onClick={onClose} disabled={sending} style={{ ...PILL, height: 32 }}>Cancel</button>
          <button
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            style={{
              ...PILL, height: 32, border: 'none', fontWeight: 700,
              background: text.trim() ? INK : 'var(--sb-border)',
              color: text.trim() ? 'var(--sb-ink-on-dark)' : GHOST,
              cursor: text.trim() && !sending ? 'pointer' : 'default',
            }}>
            {sending ? <Loader2 size={ICON.sm} className="sb-spin" /> : <Send size={ICON.sm} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

const DRAFT_FIELD: React.CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: 'border-box', height: 34, padding: '0 11px',
  borderRadius: 'var(--sb-r-chip)', background: FIELD, border: `var(--sb-border-width) solid ${HAIR}`,
  color: INK, fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', outline: 'none',
}

/** Marketing and newsletters, recognised the several ways they announce
 *  themselves. A well-behaved sender sets List-Unsubscribe; plenty do not, so
 *  the sending address, the campaign headers the big platforms stamp on, and an
 *  unsubscribe line in the body all count too. */
const BULK_SENDERS = /^(no[-_.]?reply|donotreply|newsletter|news|mailer|mail|marketing|promo|promotions|offers|deals|campaign|updates|update|notification|notifications|info|hello|hi|team|support|community|digest|alerts?|store|shop|club|members?)[+@._-]/i

const ESP_DOMAINS = /(mailchimp|mcsv|mcdlv|sendgrid|sendinblue|brevo|exponea|klaviyo|hubspot|braze|exacttarget|salesforce|mailgun|sparkpost|iterable|customer\.io|sailthru|campaign-archive|cmail\d|createsend|constantcontact|omnisend|drip|activecampaign|convertkit|substack|beehiiv|mailerlite|amazonses|postmark|mandrill)/i

const BULK_SUBDOMAIN = /^(mail|email|e|em|mailer|mailing|news|newsletter|marketing|campaign|send|sender|smtp|notify|notifications|reply|links?|go|click|track|cta|mktg|crm|info)\./i

function looksLikeBulk(headers: GmailHeader[], email: string, body: string): boolean {
  const h = (n: string) => header(headers, n)

  // The headers a list or campaign is supposed to carry
  if (h('List-Unsubscribe') || h('List-Id') || h('List-Post') || h('List-Help')) return true
  if (/\b(bulk|list|junk|marketing)\b/i.test(h('Precedence'))) return true
  if (h('Feedback-ID') || h('X-Campaign-Id') || h('X-Campaignid') || h('X-Mailer-Campaign')) return true
  if (h('X-SES-Outgoing') || h('X-Mailgun-Sid') || h('X-SG-EID') || h('X-Report-Abuse')) return true
  const auto = h('Auto-Submitted')
  if (auto && auto.toLowerCase() !== 'no') return true
  if (/csa_complaint|bulk/i.test(h('X-Complaints-To') + h('X-Mailer'))) return true

  // What the address itself says
  const [local = '', domain = ''] = email.toLowerCase().split('@')
  if (BULK_SENDERS.test(`${local}@`)) return true
  if (ESP_DOMAINS.test(domain)) return true
  if (BULK_SUBDOMAIN.test(domain)) return true

  // And, failing all that, an unsubscribe line in the message
  return /unsubscribe|opt[- ]?out|manage (your )?(email )?preferences|view (this|it) in (your )?browser|إلغاء الاشتراك/i.test(body.slice(0, 4000))
}

/** What each action wants of you, and how it is drawn. */
const ACTION_META: Record<MailAction, { verb: string; Icon: typeof CornerUpLeft }> = {
  reply:    { verb: 'to answer',  Icon: CornerUpLeft },
  schedule: { verb: 'to book',    Icon: CalendarClock },
  decide:   { verb: 'to decide',  Icon: Scale },
  read:     { verb: 'to read',    Icon: Eye },
}

/**
 * The header count, split by what it asks of you.
 *
 * "9 unread · 2 needs you · 3 accounts" was three numbers of three different
 * kinds run together, and you had to read all of it to find the one that
 * mattered. This puts the mail that wants something from you on the left, in
 * accent, with what it wants; everything that is only information sits after
 * a rule in ghost ink; and the bar under the header is the proportion of the
 * two, so the shape of the morning is legible before any of it is read.
 */
/**
 * The header count, split by what each message asks of you — and clickable.
 *
 * "9 unread · 2 needs you · 3 accounts" was three numbers of three different
 * kinds run together, and you had to read all of it to find the one that
 * mattered. Three things make this different:
 *
 * - **The chips are the filter.** A count you cannot act on is decoration; a
 *   count that is also the control is worth the space. The lit chip is how you
 *   know something is hidden.
 * - **The second line says who and how long.** "Hasan waiting 1d" is the
 *   sentence that decides whether you open the card, and no count is.
 * - **The meter is the action share**, so a morning where everything wants you
 *   is nearly full and a quiet one is nearly empty — which is the honest
 *   reading of one actionable message in eight.
 */
function MailStats({ counts, boxes, bulk, thinking, classified, addressed, filter, onFilter }: {
  counts: Record<MailAction, number>
  boxes: number
  bulk: number
  thinking: boolean
  /** Whether anything has actually been read yet. Without it, "nothing wants
   *  an answer" is a claim about mail nobody has looked at. */
  classified: boolean
  addressed: number
  filter: MailAction | null
  onFilter: (a: MailAction | null) => void
}) {
  const acts = (['reply', 'schedule', 'decide'] as MailAction[])
    .filter(a => counts[a] > 0)
    .map(a => ({ a, n: counts[a], ...ACTION_META[a] }))
  const wants = acts.reduce((t, x) => t + x.n, 0)

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
      {!classified ? (
        // Nothing has been summarised, so the only thing that can honestly be
        // counted is who each message was addressed to.
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, height: 21, padding: '0 9px',
          borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
          background: addressed ? 'var(--sb-accent-tint)' : 'var(--sb-field)',
          color: addressed ? 'var(--sb-accent-deep)' : MUTED, fontSize: 'var(--sb-t-meta)',
        }}>
          <CornerUpLeft size={ICON.sm} strokeWidth={STROKE.active} />
          <strong style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{addressed}</strong> addressed to you
        </span>
      ) : wants > 0 ? (
        acts.map(({ a, n, verb, Icon }) => {
          const on = filter === a
          return (
            <button
              key={a}
              onClick={() => onFilter(on ? null : a)}
              title={on ? 'Show everything again' : `Show only what is ${verb}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 21, padding: '0 9px',
                borderRadius: 'var(--sb-r-pill)', flexShrink: 0, cursor: 'pointer', fontFamily: 'inherit',
                background: on ? 'var(--sb-accent-deep)' : 'var(--sb-accent-tint)',
                border: `var(--sb-border-width) solid ${on ? 'var(--sb-accent-deep)' : 'rgba(var(--sb-accent-rgb),0.55)'}`,
                color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-accent-deep)',
                fontSize: 'var(--sb-t-meta)',
              }}>
              <Icon size={ICON.sm} strokeWidth={STROKE.active} />
              <strong style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{n}</strong> {verb}
            </button>
          )
        })
      ) : (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, height: 21, padding: '0 9px',
          borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
          background: 'var(--sb-positive-tint)', color: 'var(--sb-positive-deep)', fontSize: 'var(--sb-t-meta)',
        }}>
          <Check size={ICON.sm} strokeWidth={STROKE.active} /> nothing wants an answer
        </span>
      )}
      {thinking && (
        <span style={{ fontSize: 'var(--sb-t-meta)', color: GHOST, flexShrink: 0 }}>reading them…</span>
      )}
      {boxes > 0 && bulk >= 0 && null}
    </span>
  )
}

/**
 * The line under the header: the one thing that decides whether you open the
 * card. A name and a wait beat any count — "7 to read" never got anybody to
 * act, and "Hasan waiting 1d" does.
 */
function MailWaiting({ oldest, idle, boxes, filtered, onClear }: {
  oldest: { who: string; age: string } | null
  idle: number
  boxes: number
  filtered: boolean
  onClear: () => void
}) {
  const rest = [
    idle > 0 ? `${idle} to read` : '',
    boxes > 1 ? `${boxes} mailboxes` : '',
  ].filter(Boolean).join(' · ')
  if (!oldest && !rest && !filtered) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 16px 7px',
      fontSize: 'var(--sb-t-meta)', color: GHOST, minWidth: 0,
    }}>
      {oldest && (
        <span style={{ color: MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <strong style={{ fontWeight: 700, color: INK }}>{oldest.who}</strong> waiting {oldest.age}
        </span>
      )}
      {oldest && rest && <span style={{ flexShrink: 0 }}>·</span>}
      {rest && <span style={{ flexShrink: 0 }}>{rest}</span>}
      <span style={{ flex: 1 }} />
      {filtered && (
        <button onClick={onClear} style={{
          ...GHOST_BTN, gap: 4, flexShrink: 0, fontFamily: 'inherit',
          fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-accent-deep)',
        }}>
          <X size={ICON.sm} /> showing one kind
        </button>
      )}
    </div>
  )
}

/** The proportion of the two, 3px tall, directly under the header. */
function MailMeter({ wants, idle }: { wants: number; idle: number }) {
  const total = wants + idle
  if (!total) return null
  return (
    <div style={{ display: 'flex', height: 3, background: 'var(--sb-field)' }}>
      <span style={{ width: `${(wants / total) * 100}%`, background: 'var(--sb-accent-deep)' }} />
      <span style={{ width: `${(idle / total) * 100}%`, background: 'var(--sb-border)' }} />
    </div>
  )
}

/** How many of each kind the card shows before it stops. */
const MAIL_SHOWN = 6

function MailCard({
  rows, loading, error, boxes, newsletters, briefs, briefing, briefNote,
  onArchive, onArchiveAll, onOpenInbox, onOpen, onOpenDraft,
  rsvpBusy, rsvpDone, rsvpError, onRespond,
}: {
  rows: MailRow[]
  loading: boolean
  error: string | null
  /** How many mailboxes were read, so the count and the empty state can say. */
  boxes: number
  newsletters: MailRow[]
  /** What each message is, and the answer to it — keyed by thread id. */
  briefs: Record<string, InboxBrief>
  briefing: boolean
  /** Why there are no summaries, when there are none. Said quietly. */
  briefNote: string | null
  onArchive: (row: MailRow) => void
  onArchiveAll: () => void
  onOpenInbox: () => void
  onOpen: (row: MailRow) => void
  onOpenDraft: (row: MailRow) => void
  /** RSVP state, keyed by thread id, and the one way to change it. */
  rsvpBusy: Record<string, Rsvp>
  rsvpDone: Record<string, Rsvp>
  rsvpError: Record<string, string>
  onRespond: (row: MailRow, r: Rsvp) => void
}) {
  const [showBulk, setShowBulk] = useState(false)
  const [filter, setFilter] = useState<MailAction | null>(null)

  // Counted by what each one wants, which is the thing the header says. A row
  // with no brief yet still counts — as reading, so the totals do not jump
  // about while the summaries land.
  const counts = useMemo(() => {
    const c: Record<MailAction, number> = { reply: 0, schedule: 0, decide: 0, read: 0 }
    for (const r of rows) c[r.invite ? 'schedule' : briefs[r.id]?.action ?? 'read'] += 1
    return c
  }, [rows, briefs])
  const wants = counts.reply + counts.schedule + counts.decide

  // What the card actually lists. A filter that survives its own chip
  // disappearing would leave you looking at nothing and no way back.
  const shown = useMemo(
    () => filter ? rows.filter(r => (r.invite ? 'schedule' : briefs[r.id]?.action) === filter) : rows,
    [rows, briefs, filter],
  )
  useEffect(() => { if (filter && counts[filter] === 0) setFilter(null) }, [filter, counts])

  /** Who has been waiting longest for an answer, and how long. */
  const oldest = useMemo(() => {
    const waiting = rows
      .filter(r => r.invite || (briefs[r.id]?.action && briefs[r.id]?.action !== 'read'))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]
      ?? rows.filter(r => r.needsYou).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]
    if (!waiting) return null
    return { who: (waiting.fromName || waiting.fromEmail).split(/[\s,]+/)[0], age: relAge(waiting.receivedAt) }
  }, [rows, briefs])

  return (
    <div style={CARD}>
      <CardHead
        title="Mail"
        meta={loading
          ? 'reading your inbox…'
          : <MailStats
              counts={counts} boxes={boxes} bulk={newsletters.length} thinking={briefing}
              classified={rows.some(r => briefs[r.id] || r.invite)}
              addressed={rows.filter(r => r.needsYou).length}
              filter={filter}
              onFilter={setFilter}
            />}>
        <LinkOut label="Inbox" onClick={onOpenInbox} />
      </CardHead>
      {!loading && !error && rows.length > 0 && (
        <>
          <MailMeter wants={wants} idle={counts.read + newsletters.length} />
          <MailWaiting
            oldest={oldest}
            idle={counts.read + newsletters.length}
            boxes={boxes}
            filtered={filter !== null}
            onClear={() => setFilter(null)}
          />
        </>
      )}
      {/* No summaries is usually no key, which is a setting rather than a
          fault — said once here, not repeated down every row. */}
      {briefNote && !loading && !error && rows.length > 0 && (
        <div style={{
          padding: '8px 16px', fontSize: 'var(--sb-t-meta)', color: GHOST,
          background: FIELD, borderBottom: `var(--sb-border-width) solid ${HAIR}`,
        }}>{briefNote}</div>
      )}

      {error ? (
        <div style={{ padding: '18px 16px', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>{error}</div>
      ) : loading ? (
        <div style={{ padding: '18px 16px', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>Reading your inbox…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '18px 16px', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>
          Nothing unread in {boxes === 1 ? 'your inbox' : `${boxes} inboxes`}. This card reads unread mail only —
          anything already opened is in Mail.
        </div>
      ) : (
        <div>
          {shown.map(r => (
            <div
              key={r.id}
              onClick={e => { if (!(e.target as HTMLElement).closest('button')) onOpen(r) }}
              style={{ padding: '11px 16px', borderBottom: `var(--sb-border-width) solid ${HAIR}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{
                  ...ICON_TILE, width: 28, height: 28, fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: MUTED,
                }}>{initialsOf(r.fromName || r.fromEmail)}</span>
                <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 700, color: INK, flexShrink: 0, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.fromName || r.fromEmail}
                </span>
                {r.needsYou && (
                  <span style={{
                    flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 'var(--sb-r-chip)',
                    background: 'rgba(var(--sb-accent-rgb),0.28)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.7)',
                    color: 'var(--sb-accent-deep)', fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.06em',
                    display: 'inline-flex', alignItems: 'center',
                  }}>NEEDS YOU</span>
                )}
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.subject}
                </span>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: GHOST, flexShrink: 0 }}>{relAge(r.receivedAt)}</span>
                <button onClick={() => onArchive(r)} title="Archive"
                  style={{ ...ICON_TILE, width: 26, height: 26, cursor: 'pointer' }}>
                  <Archive size={ICON.sm} strokeWidth={STROKE.rest} />
                </button>
              </div>

              {/* What it says — one line, in place of the first 140 characters
                  of it, which were a greeting and half a sentence. */}
              {(briefs[r.id]?.summary || briefing) && (
                <div style={{
                  marginTop: 5, marginLeft: 38, fontSize: 'var(--sb-t-body-s)', lineHeight: 1.45,
                  color: briefs[r.id] ? MUTED : GHOST,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {briefs[r.id]?.summary || 'Reading it…'}
                </div>
              )}

              {/* An invitation is answered, not replied to. */}
              {r.invite ? (
                <InviteActions
                  invite={r.invite}
                  busy={rsvpBusy[r.id] ?? null}
                  answered={rsvpDone[r.id] ?? null}
                  error={rsvpError[r.id] ?? null}
                  onRespond={rr => onRespond(r, rr)}
                  onDeclineWithNote={() => { onRespond(r, 'declined'); onOpenDraft(r) }}
                />
              ) : null}

              {/* And the answer to it, where it wants one. Clicking opens it to
                  be read; nothing is ever sent from the card. */}
              {!r.invite && briefs[r.id]?.draft && (
                <button
                  onClick={() => onOpenDraft(r)}
                  style={{
                    display: 'block', width: 'calc(100% - 38px)', textAlign: 'left', cursor: 'pointer',
                    marginTop: 7, marginLeft: 38, padding: '8px 11px 9px', borderRadius: 'var(--sb-r-chip)',
                    background: 'var(--sb-accent-tint)',
                    border: `var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.45)`,
                    fontFamily: 'inherit',
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Sparkles size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-accent-deep)" />
                    <span style={{
                      fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.08em',
                      color: 'var(--sb-accent-deep)', textTransform: 'uppercase',
                    }}>Reply drafted</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-accent-deep)' }}>
                      Review &amp; send →
                    </span>
                  </span>
                  <span style={{
                    display: 'block', fontSize: 'var(--sb-t-body-s)', color: INK, lineHeight: 1.45,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{briefs[r.id].draft.replace(/\s+/g, ' ').trim()}</span>
                </button>
              )}
            </div>
          ))}
          {/* Suggested archiving — every newsletter and campaign, named rather
              than counted, so you can see what you are about to sweep away. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
            <button
              onClick={() => setShowBulk(v => !v)}
              disabled={newsletters.length === 0}
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', padding: 0, textAlign: 'left',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: GHOST,
                cursor: newsletters.length ? 'pointer' : 'default',
              }}>
              {newsletters.length > 0 && (
                <ChevronDown size={ICON.sm} style={{ flexShrink: 0, transform: showBulk ? undefined : 'rotate(-90deg)', transition: 'transform .12s' }} />
              )}
              {newsletters.length > 0
                ? `${newsletters.length} newsletter${newsletters.length === 1 ? '' : 's'} and marketing — suggested for archiving`
                : 'No newsletters waiting.'}
            </button>
            {newsletters.length > 0 && (
              <button onClick={onArchiveAll} style={{ ...PILL, height: 28 }}>
                <Archive size={ICON.sm} /> Archive all
              </button>
            )}
          </div>
          {showBulk && newsletters.map(n => (
            <div
              key={n.id}
              onClick={e => { if (!(e.target as HTMLElement).closest('button')) onOpen(n) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                padding: '8px 16px 8px 34px', borderTop: `var(--sb-border-width) solid ${HAIR}`, cursor: 'pointer',
              }}>
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: MUTED, flexShrink: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.fromName || n.fromEmail}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: GHOST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.subject}
              </span>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: GHOST, flexShrink: 0 }}>{relAge(n.receivedAt)}</span>
              <button onClick={() => onArchive(n)} title="Archive"
                style={{ ...ICON_TILE, width: 24, height: 24, cursor: 'pointer' }}>
                <Archive size={ICON.sm} strokeWidth={STROKE.rest} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Block {
  id: string
  kind: 'calendar' | 'proposed'
  title: string
  meta: string
  start: string
  end: string
  /** Set on a proposed block: the task it schedules. */
  taskId?: string
  /** Set on a calendar block: the event it mirrors, and the day it sits on. */
  eventId?: string
  date?: string
}

// ─── Plan for today ──────────────────────────────────────────────────────────
// A real slice of the day rather than a stack: hours down the side, blocks
// where they actually sit. A proposed block can be dragged to another hour and
// the time it would take reads live while you move it.

const SNAP_MIN = 15
/** The plan draws its whole window at once, so the hour height is whatever
 *  makes the day fit rather than a fixed number you scroll through. */
const PLAN_H = 430
const HOUR_PX_MAX = 46
const HOUR_PX_MIN = 20

/** Side-by-side columns for anything happening at the same time, the way a
 *  calendar does it: overlapping blocks form a cluster, every block in the
 *  cluster is as wide as the cluster's busiest moment allows. */
interface Slot { col: number; cols: number; span: number }

function layoutBlocks(blocks: Block[]): Map<string, Slot> {
  const span = (b: Block) => {
    const s = minutesOf(b.start)
    return [s, Math.max(minutesOf(b.end), s + SNAP_MIN)] as const
  }
  const ordered = [...blocks].sort((a, b) => span(a)[0] - span(b)[0] || span(b)[1] - span(a)[1])
  const out = new Map<string, Slot>()

  let cluster: Block[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    const cols = colEnds.length
    for (const b of cluster) {
      const me = out.get(b.id)!
      const [s0, e0] = span(b)
      // Grow rightwards over any column with nothing in it at this time, so a
      // block is only as narrow as it has to be — the way a calendar does it.
      let width = 1
      for (let c = me.col + 1; c < cols; c++) {
        const blocked = cluster.some(o => {
          if (o.id === b.id) return false
          const oc = out.get(o.id)!.col
          if (oc !== c) return false
          const [s1, e1] = span(o)
          return s0 < e1 && e0 > s1
        })
        if (blocked) break
        width++
      }
      out.set(b.id, { ...me, cols, span: width })
    }
    cluster = []; colEnds = []; clusterEnd = -Infinity
  }

  for (const b of ordered) {
    const [start, end] = span(b)
    // A gap with nothing running closes the cluster and starts a fresh one.
    if (start >= clusterEnd) flush()
    let col = colEnds.findIndex(e => e <= start)
    if (col === -1) { col = colEnds.length; colEnds.push(end) } else { colEnds[col] = end }
    out.set(b.id, { col, cols: 1, span: 1 })
    cluster.push(b)
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return out
}

function PlanCard({
  blocks, freeMinutes, focusMinutes, dirty, statuses,
  onAccept, onAddBlock, onOpenCalendar, onMoveBlock, onOpenBlock, onSetStatus,
}: {
  blocks: Block[]
  freeMinutes: number
  focusMinutes: number
  dirty: boolean
  statuses: Record<string, EventStatus>
  onAccept: () => void
  onAddBlock: () => void
  onOpenCalendar: () => void
  onMoveBlock: (block: Block, startMinutes: number) => void
  onOpenBlock: (block: Block) => void
  onSetStatus: (eventId: string, status: EventStatus) => void
}) {
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const proposed = blocks.filter(b => b.kind === 'proposed').length

  // Drag state: which block, and where it currently sits
  const [drag, setDrag] = useState<{ id: string; start: number; length: number } | null>(null)
  const dragRef = useRef<{ id: string; grabOffset: number; length: number } | null>(null)
  const laneRef = useRef<HTMLDivElement>(null)

  // The window the plan draws: from the hour before the first thing to the hour
  // after the last, and always wide enough to hold now.
  const [fromHour, toHour] = (() => {
    const mins = blocks.flatMap(b => [minutesOf(b.start), minutesOf(b.end)])
    const lo = Math.min(nowMins, ...(mins.length ? mins : [nowMins]))
    const hi = Math.max(nowMins + 60, ...(mins.length ? mins : [nowMins + 60]))
    return [Math.max(0, Math.floor(lo / 60) - 1), Math.min(24, Math.ceil(hi / 60) + 1)]
  })()
  const hours = Array.from({ length: Math.max(1, toHour - fromHour) }, (_, i) => fromHour + i)
  // Squeeze the hours until the whole window fits, rather than hiding half of
  // the day behind a scrollbar.
  const hourPx = Math.max(HOUR_PX_MIN, Math.min(HOUR_PX_MAX, PLAN_H / hours.length))
  const topOf = (mins: number) => ((mins - fromHour * 60) / 60) * hourPx
  const slots = useMemo(() => layoutBlocks(blocks), [blocks])

  function beginDrag(e: React.PointerEvent, b: Block) {
    if (b.kind !== 'proposed') return
    const lane = laneRef.current
    if (!lane) return
    const startMins = minutesOf(b.start)
    const length = Math.max(SNAP_MIN, minutesOf(b.end) - startMins)
    const pointerMins = ((e.clientY - lane.getBoundingClientRect().top) / hourPx) * 60 + fromHour * 60
    dragRef.current = { id: b.id, grabOffset: pointerMins - startMins, length }
    setDrag({ id: b.id, start: startMins, length })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  /** Two things cannot be done at once, so a dragged block settles in the
   *  nearest gap rather than landing on top of what is already there. */
  function avoidOverlap(desired: number, length: number, selfId: string): number {
    const busy = blocks
      .filter(b => b.id !== selfId)
      .map(b => [minutesOf(b.start), Math.max(minutesOf(b.end), minutesOf(b.start) + SNAP_MIN)] as const)
      .sort((a, b) => a[0] - b[0])

    let start = desired
    for (let pass = 0; pass < busy.length + 1; pass++) {
      const clash = busy.find(([s0, e0]) => start < e0 && start + length > s0)
      if (!clash) return start
      const before = clash[0] - length
      const after = clash[1]
      // Whichever side of the clash the pointer was closer to
      const pick = Math.abs(desired - before) <= Math.abs(desired - after) ? before : after
      const next = Math.max(0, Math.min(24 * 60 - length, pick))
      if (next === start) return start
      start = next
    }
    return start
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current
    const lane = laneRef.current
    if (!d || !lane) return
    const pointerMins = ((e.clientY - lane.getBoundingClientRect().top) / hourPx) * 60 + fromHour * 60
    const raw = pointerMins - d.grabOffset
    const snapped = Math.max(0, Math.min(24 * 60 - d.length, Math.round(raw / SNAP_MIN) * SNAP_MIN))
    setDrag({ id: d.id, start: avoidOverlap(snapped, d.length, d.id), length: d.length })
  }

  function endDrag() {
    const d = dragRef.current
    if (d && drag) {
      const block = blocks.find(b => b.id === d.id)
      if (block && minutesOf(block.start) !== drag.start) onMoveBlock(block, drag.start)
    }
    dragRef.current = null
    setDrag(null)
  }

  return (
    <div style={CARD}>
      <CardHead
        title="Plan for today"
        meta={`${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${fmtHours(focusMinutes)} focus · ${fmtHours(freeMinutes)} free`}>
        <span style={{ fontSize: 'var(--sb-t-meta)', color: dirty ? 'var(--sb-negative)' : GHOST, flexShrink: 0 }}>
          {dirty ? 'draft, not saved' : 'saved'}
        </span>
      </CardHead>

      {blocks.length === 0 ? (
        <p style={{ margin: 0, padding: '18px 16px', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>
          Nothing booked and nothing proposed. Give a task a time and it lands here.
        </p>
      ) : (
        <div style={{ padding: '10px 16px 6px' }}>
          <div
            ref={laneRef}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ position: 'relative', height: hours.length * hourPx, minWidth: 0 }}>

            {/* Hour rules */}
            {hours.map(h => (
              <div key={h} style={{ position: 'absolute', top: topOf(h * 60), left: 0, right: 0, height: hourPx }}>
                <span style={{
                  position: 'absolute', top: -6, left: 0, width: 40,
                  fontSize: 'var(--sb-t-micro)', color: GHOST, fontVariantNumeric: 'tabular-nums',
                }}>{String(h).padStart(2, '0')}:00</span>
                <span style={{ position: 'absolute', top: 0, left: 44, right: 0, height: 1, background: HAIR }} />
              </div>
            ))}

            {/* Now */}
            {nowMins >= fromHour * 60 && nowMins <= toHour * 60 && (
              <div style={{ position: 'absolute', top: topOf(nowMins), left: 0, right: 0, pointerEvents: 'none', zIndex: 3 }}>
                <span style={{ position: 'absolute', top: -6, left: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: 'var(--sb-negative)', fontVariantNumeric: 'tabular-nums' }}>
                  {hhmm(now)}
                </span>
                <span style={{ position: 'absolute', top: 0, left: 44, right: 0, height: 1, background: 'var(--sb-negative)' }} />
                <span style={{ position: 'absolute', top: -2.5, left: 42, width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-negative)' }} />
              </div>
            )}

            {/* Blocks */}
            {blocks.map(b => {
              const dragging = !!drag && drag.id === b.id
              const startMins = dragging && drag ? drag.start : minutesOf(b.start)
              const length = dragging && drag ? drag.length : Math.max(SNAP_MIN, minutesOf(b.end) - startMins)
              const status = b.eventId ? statuses[b.eventId] : undefined
              const past = startMins + length < nowMins && !dragging
              const canDrag = b.kind === 'proposed'
              // Things happening at once sit beside each other, as they would
              // on a calendar, instead of one hiding the other.
              const slot = slots.get(b.id) ?? { col: 0, cols: 1, span: 1 }
              const colW = 100 / slot.cols
              const height = Math.max(24, (length / 60) * hourPx - 3)
              const narrow = slot.span < slot.cols
              const tall = height >= 44
              const tight = height < 34 || narrow
              return (
                <div
                  key={b.id}
                  onPointerDown={e => beginDrag(e, b)}
                  onClick={() => { if (!dragging) onOpenBlock(b) }}
                  title={`${b.title} · ${fmtMins(startMins)}–${fmtMins(startMins + length)}${canDrag ? ' · drag to another hour' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `calc(44px + (100% - 44px) * ${slot.col * colW / 100})`,
                    width: `calc((100% - 44px) * ${slot.span * colW / 100} - ${slot.span < slot.cols ? 3 : 0}px)`,
                    zIndex: dragging ? 5 : 2,
                    top: topOf(startMins), height,
                    display: 'flex', alignItems: tall ? 'flex-start' : 'center',
                    gap: tight ? 5 : 8, boxSizing: 'border-box',
                    padding: tall ? '6px 8px 0' : tight ? '0 7px' : '0 10px',
                    borderRadius: 'var(--sb-r-sm)', minWidth: 0, overflow: 'hidden',
                    background: status === 'cancelled' ? 'var(--sb-field)'
                      : b.kind === 'proposed' ? 'rgba(var(--sb-accent-rgb),0.20)' : FIELD,
                    border: `var(--sb-border-width) solid ${b.kind === 'proposed' ? 'rgba(var(--sb-accent-rgb),0.6)' : 'var(--sb-border)'}`,
                    borderLeft: `3px solid ${b.kind === 'proposed' ? AMBER : 'var(--sb-border)'}`,
                    boxShadow: dragging ? '0 10px 24px -10px color-mix(in srgb, var(--sb-ink-1) 45.0%, transparent)' : 'none',
                    opacity: past || status === 'cancelled' ? 0.6 : 1,
                    cursor: canDrag ? (dragging ? 'grabbing' : 'grab') : 'pointer',
                    touchAction: 'none', userSelect: 'none',
                  }}>
                  {b.kind === 'proposed'
                    ? <CheckSquare size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: MUTED, marginTop: tall ? 2 : 0 }} />
                    : <Clock size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: MUTED, marginTop: tall ? 2 : 0 }} />}
                  {/* Given the height, the title wraps instead of being cut off */}
                  <span style={{
                    fontSize: tight ? 11.5 : 12.5, fontWeight: 600, color: INK, minWidth: 0, flex: '0 1 auto',
                    overflow: 'hidden', lineHeight: 1.3,
                    ...(tall
                      ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }
                      : { textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }),
                    textDecoration: status === 'cancelled' ? 'line-through' : 'none',
                  }}>{b.title}</span>
                  {/* A narrow column has no room for the times as well */}
                  {!narrow && (
                    <span style={{
                      fontSize: 'var(--sb-t-meta)', color: GHOST, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                      marginTop: tall ? 1 : 0,
                    }}>
                      {fmtMins(startMins)}–{fmtMins(startMins + length)}
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0 }} />
                  {b.eventId && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); onSetStatus(b.eventId!, 'done') }}
                        onPointerDown={e => e.stopPropagation()}
                        title={status === 'done' ? 'Not done after all' : 'Mark done'}
                        style={{
                          ...ICON_TILE, width: 20, height: 20, borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', flexShrink: 0,
                          background: status === 'done' ? 'var(--sb-positive)' : 'var(--sb-card)',
                          borderColor: status === 'done' ? 'var(--sb-positive)' : 'var(--sb-border)',
                          color: status === 'done' ? 'var(--sb-ink-on-dark)' : MUTED,
                        }}>
                        <Check size={ICON.sm} strokeWidth={STROKE.active} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onSetStatus(b.eventId!, 'cancelled') }}
                        onPointerDown={e => e.stopPropagation()}
                        title={status === 'cancelled' ? 'Restore' : 'Mark cancelled'}
                        style={{
                          ...ICON_TILE, width: 20, height: 20, borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', flexShrink: 0,
                          background: status === 'cancelled' ? 'var(--sb-negative)' : 'var(--sb-card)',
                          borderColor: status === 'cancelled' ? 'var(--sb-negative)' : 'var(--sb-border)',
                          color: status === 'cancelled' ? 'var(--sb-ink-on-dark)' : MUTED,
                        }}>
                        <X size={ICON.sm} strokeWidth={STROKE.active} />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 14px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-meta)', color: GHOST }}>
          <span style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-chip)', background: AMBER }} /> Proposed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-meta)', color: GHOST }}>
          <span style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-border)' }} /> Calendar
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onOpenCalendar} style={{ ...PILL, height: 28 }}>Open calendar</button>
        <button onClick={onAddBlock} style={{ ...PILL, height: 28 }}>
          <Plus size={ICON.sm} /> Add block
        </button>
        <button
          onClick={onAccept}
          disabled={proposed === 0}
          style={{
            ...PILL, height: 28, background: proposed === 0 ? 'var(--sb-field)' : INK,
            border: 'none', color: proposed === 0 ? GHOST : 'var(--sb-ink-on-dark)', fontWeight: 600,
            cursor: proposed === 0 ? 'default' : 'pointer',
          }}>
          <Check size={ICON.sm} strokeWidth={STROKE.active} /> Accept plan
        </button>
      </div>
    </div>
  )
}

// ─── Habits strip ────────────────────────────────────────────────────────────

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function HabitsCard({ habits, logs, qtyLogs, today, onToggle, onSetQty, onOpenTracker }: {
  habits: Habit[]
  logs: HabitLogs
  qtyLogs: Record<string, Record<string, number>>
  today: string
  onToggle: (id: string) => void
  onSetQty: (h: Habit, v: number) => void
  onOpenTracker: () => void
}) {
  // The seven days ending today, so the last column is always now
  const week = Array.from({ length: 7 }, (_, i) => offsetDays(today, -(6 - i)))
  // Part-days count: a measurable habit half done is half a day done.
  const todayTotals = dayTotals(habits, today, logs, qtyLogs)
  const doneToday = todayTotals.done
  const weekPct = spanTotals(habits, week, logs, qtyLogs).pct
  const best = habits.length ? Math.max(...habits.map(h => calcStreak(logs[h.id] ?? []))) : 0

  const allLogged = habits.flatMap(h => logs[h.id] ?? []).sort()
  const lastLog = allLogged.at(-1)
  const coldDays = best === 0 && lastLog
    ? Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(lastLog + 'T00:00:00').getTime()) / 86400000)
    : 0

  return (
    <div style={CARD}>
      <CardHead
        title="Habits"
        meta={`${doneToday} of ${habits.length} today · ${weekPct}% this week · best streak ${best}d`}>
        {coldDays > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-negative)', flexShrink: 0 }}>
            <Flame size={ICON.sm} strokeWidth={STROKE.rest} /> {coldDays} days cold
          </span>
        )}
        <Sun size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: GHOST, flexShrink: 0 }} />
        <LinkOut label="Tracker" onClick={onOpenTracker} />
      </CardHead>

      {habits.length === 0 ? (
        <div style={{ padding: '18px 16px', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>No habits yet.</div>
      ) : (
        <div style={{ padding: '10px 16px 14px' }}>
          {/* Column heads */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6 }}>
            <span style={{ width: 26, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }} />
            <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {week.map(d => (
                <span key={d} style={{ width: 15, textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: GHOST }}>
                  {DAY_LETTERS[new Date(d + 'T12:00:00').getDay()]}
                </span>
              ))}
            </span>
            <span style={{ width: 168, textAlign: 'right', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.07em', color: GHOST, flexShrink: 0, whiteSpace: 'nowrap' }}>
              TODAY · QUICK LOG · STREAK
            </span>
          </div>

          {habits.map(h => {
            const hLogs = logs[h.id] ?? []
            const isQty = h.type === 'quantity'
            const hasGoal = isQty && !!h.goal && h.goal > 0
            const qty = isQty ? (qtyLogs[h.id]?.[today] ?? 0) : 0
            const done = hLogs.includes(today)
            const streak = calcStreak(hLogs)
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `var(--sb-border-width) solid ${HAIR}` }}>
                <span style={{ ...ICON_TILE, overflow: 'hidden', fontSize: 'var(--sb-t-body)' }}>
                  {h.image
                    ? <img src={h.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : h.emoji}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--sb-t-micro)', color: GHOST }}>
                    {h.frequency}{hasGoal ? ` · ${h.goal} ${h.unit ?? ''}`.trimEnd() : ''}
                  </span>
                </span>

                <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {week.map(d => {
                    const on = hLogs.includes(d)
                    const isToday = d === today
                    return (
                      <span key={d} title={d} style={{
                        width: 15, height: 15, borderRadius: 'var(--sb-r-chip)', boxSizing: 'border-box',
                        background: on ? INK : 'var(--sb-field)',
                        border: isToday ? `var(--sb-border-emphasis) solid ${on ? INK : 'var(--sb-border)'}` : 'var(--sb-border-emphasis) solid transparent',
                      }} />
                    )
                  })}
                </span>

                <span style={{ width: 168, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 'var(--sb-t-meta)', color: GHOST, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {isQty ? (hasGoal ? `${qty}/${h.goal}${h.unit ? ` ${h.unit}` : ''}` : `${qty}${h.unit ? ` ${h.unit}` : ''}`) : (done ? 'done' : '—')}
                  </span>
                  {isQty ? (
                    <>
                      <button onClick={() => onSetQty(h, Math.max(0, qty - 1))} disabled={qty === 0}
                        style={{ ...ICON_TILE, width: 22, height: 22, cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.4 : 1, fontSize: 'var(--sb-t-body)' }}>−</button>
                      <button onClick={() => onSetQty(h, qty + 1)}
                        style={{ ...ICON_TILE, width: 22, height: 22, cursor: 'pointer', background: INK, borderColor: INK, color: 'var(--sb-ink-on-dark)', fontSize: 'var(--sb-t-body)' }}>+</button>
                    </>
                  ) : (
                    <button onClick={() => onToggle(h.id)} title={done ? 'Undo' : 'Mark done'}
                      style={{
                        ...ICON_TILE, width: 22, height: 22, cursor: 'pointer',
                        background: done ? 'var(--sb-positive)' : INK, borderColor: done ? 'var(--sb-positive)' : INK, color: 'var(--sb-ink-on-dark)',
                      }}>
                      <Check size={ICON.sm} strokeWidth={STROKE.active} />
                    </button>
                  )}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 'var(--sb-t-meta)', color: streak > 0 ? 'var(--sb-positive)' : GHOST, width: 30, justifyContent: 'flex-end', flexShrink: 0 }}>
                    <Flame size={ICON.sm} strokeWidth={STROKE.rest} /> {streak}d
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function TodayPage() {
  const user = useAuthStore(s => s.user)
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const focusOn = useUIStore(s => s.focusOn)
  const allTasks = useTaskStore(s => s.tasks)
  const { toggleComplete, updateTask, addTask } = useTaskStore()
  const habitsAll = useHabitsStore(s => s.habits)

  const tasks = useMemo(() => allTasks.filter(t => !isTaskHidden(t)), [allTasks])
  const habits = useMemo(() => habitsAll.filter(h => h.isActive), [habitsAll])

  const [logs, setLogs] = useState(loadLogs)
  const [qtyLogs, setQtyLogs] = useState(loadQuantityLogs)
  const [events, setEvents] = useState<GCalEvent[]>([])
  const [clock, setClock] = useState(() => new Date())
  const [planAccepted, setPlanAccepted] = useState(false)
  const [eventStatuses, setEventStatuses] = useState(loadEventStatuses)
  const [briefSeed, setBriefSeed] = useState(0)

  const [mail, setMail] = useState<MailRow[]>([])
  const [newsletters, setNewsletters] = useState<MailRow[]>([])
  const [mailLoading, setMailLoading] = useState(true)
  const [openMail, setOpenMail] = useState<MailRow | null>(null)
  const [mailError, setMailError] = useState<string | null>(null)
  const [mailBoxCount, setMailBoxCount] = useState(1)
  /** What each unread message is, and the reply to it. Keyed by thread id. */
  const [briefs, setBriefs] = useState<Record<string, InboxBrief>>({})
  const [briefing, setBriefing] = useState(false)
  const [briefNote, setBriefNote] = useState<string | null>(null)
  const [draftFor, setDraftFor] = useState<MailRow | null>(null)
  /** Which invitation is being answered, and how each one was answered. */
  const [rsvpBusy, setRsvpBusy] = useState<Record<string, Rsvp>>({})
  const [rsvpDone, setRsvpDone] = useState<Record<string, Rsvp>>({})
  const [rsvpError, setRsvpError] = useState<Record<string, string>>({})

  const today = dayKey(clock)
  const writtenAt = useRef(new Date())

  // The calendar writes the same map, so pick its changes up
  useEffect(() => {
    const h = () => setEventStatuses(loadEventStatuses())
    window.addEventListener('professor:eventStatusesUpdated', h)
    return () => window.removeEventListener('professor:eventStatusesUpdated', h)
  }, [])

  // A live clock, to the minute — the NOW line and the header pill both read it
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Today's events, from every calendar the user has left visible
  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    void fetchVisibleEvents(start, end)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [])

  // Unread mail, split into what needs a person and what is a newsletter
  const loadMail = useCallback(async () => {
    setMailLoading(true); setMailError(null)
    // Every mailbox, not just the one you signed in with. This card read the
    // primary account only, so on a browser with two or three accounts
    // connected most of the mail that needs you was never on the page — and
    // the two business addresses are usually where all of it is.
    const boxes = mailAccounts(user?.email)
    setMailBoxCount(boxes.length)
    try {
      if (boxes.length === 0) {
        setMailError('Mail is not connected — link Google in Settings to see what needs you.')
        return
      }
      const failed: string[] = []
      const perBox = await Promise.all(boxes.map(async account => {
        try {
          const { ids } = await listUnreadThreadIds(14, undefined, account)
          const threads = await Promise.all(ids.map(id => getThread(id, account).catch(() => null)))
          return threads.map(th => ({ th, account }))
        } catch (e) {
          // One mailbox that will not open names itself; the rest still arrive.
          // Some of these errors already name the address — "x needs
          // reconnecting" — so it is not prefixed twice.
          const why = e instanceof Error ? e.message : 'could not be read'
          failed.push(why.includes(account.email) ? why : `${account.email}: ${why}`)
          return []
        }
      }))
      const rows: MailRow[] = []
      const bulk: MailRow[] = []
      for (const { th, account } of perBox.flat()) {
        const last = th?.messages?.at(-1)
        if (!th || !last) continue
        const headers = last.payload?.headers ?? []
        const from = header(headers, 'From')
        const name = from.replace(/<.*>/, '').replace(/"/g, '').trim()
        const email = from.match(/<(.+)>/)?.[1] ?? from
        const to = header(headers, 'To').toLowerCase()
        // A hidden company's mail is hidden too, the same as its tasks and calendars
        if (isMailHiddenByCompany({ from, to, accountEmail: account.email })) continue
        const me = account.email.toLowerCase()
        const plain = extractBody(last)
        // A campaign addressed to you personally is still a campaign, so bulk
        // mail never counts as needing you.
        const isBulk = looksLikeBulk(headers, email, plain)
        const row: MailRow = {
          id: th.id,
          messageId: last.id,
          rfcMessageId: header(headers, 'Message-ID') || header(headers, 'Message-Id'),
          references: header(headers, 'References'),
          fromName: name || email,
          fromEmail: email,
          to: header(headers, 'To'),
          cc: header(headers, 'Cc'),
          subject: header(headers, 'Subject') || '(no subject)',
          snippet: plain.replace(/\s+/g, ' ').trim().slice(0, 140),
          html: extractHtmlBody(last),
          body: plain,
          receivedAt: new Date(Number(last.internalDate ?? Date.now())).toISOString(),
          needsYou: !isBulk && !!me && to.includes(me),
          newsletter: isBulk,
          account,
          invite: extractInvite(last),
        }
        ;(isBulk ? bulk : rows).push(row)
      }
      rows.sort((a, b) => Number(b.needsYou) - Number(a.needsYou)
        || b.receivedAt.localeCompare(a.receivedAt))
      bulk.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      setMail(rows.slice(0, MAIL_SHOWN))
      setNewsletters(bulk.slice(0, MAIL_SHOWN))
      // Every mailbox failing is the "not connected" case; some of them
      // failing is worth naming, because the rest of the list is short by
      // exactly that much.
      if (failed.length === boxes.length) {
        setMailError(failed.join(' · '))
      } else if (failed.length > 0) {
        setMailError(`${failed.length} of ${boxes.length} mailboxes could not be read — ${failed.join(' · ')}`)
      }
    } catch (e) {
      // Say what actually went wrong. "Not connected" was the answer to every
      // failure, including an expired token and a Gmail quota.
      setMailError(e instanceof Error ? e.message : 'Mail could not be read.')
    } finally {
      setMailLoading(false)
    }
  }, [user?.email])

  useEffect(() => { void loadMail() }, [loadMail])

  // ── What the mail says, and the answer to it ───────────────────────────────
  // Off the render path entirely: the rows are already on screen when this
  // runs, and each row's summary appears as it lands. Cached briefs come back
  // first, so the second look at an inbox costs nothing.
  const briefContext = useCallback(() => ({
    user: {
      id: user?.id ?? 'me',
      email: user?.email ?? '',
      full_name: user?.name ?? null,
      avatar_url: null,
      active_framework: 'time_blocking',
      schedule_rules: {},
      created_at: new Date().toISOString(),
    } as DbUser,
    companies: loadDynamicCompanies().map(c => ({
      id: c.id, user_id: user?.id ?? 'me', name: c.name,
      color_tag: c.color ?? null, calendar_id: c.calendarId ?? null, is_active: true,
    })) as DbCompany[],
    me: user?.email ?? '',
  }), [user?.id, user?.email, user?.name])

  // One call per set of messages, however many times the effect fires. React's
  // StrictMode runs it twice in development and a re-render can run it again;
  // without this each of those is a second full call, because none of them has
  // finished writing the cache the next one would have read.
  const briefRun = useRef('')

  const runBriefs = useCallback(async (rows: MailRow[]) => {
    if (rows.length === 0) { setBriefs({}); briefRun.current = ''; return }
    const key = rows.map(r => r.messageId).sort().join(',')
    if (briefRun.current === key) return
    briefRun.current = key
    setBriefing(true)
    const { briefs: got, unavailable } = await briefsFor(
      rows.map(r => ({
        id: r.id, messageId: r.messageId, fromName: r.fromName, fromEmail: r.fromEmail,
        subject: r.subject, receivedAt: r.receivedAt, addressedToMe: r.needsYou, body: r.body,
      })),
      briefContext(),
      partial => setBriefs(prev => ({ ...prev, ...partial })),
    )
    setBriefs(prev => ({ ...prev, ...got }))
    setBriefNote(unavailable)
    setBriefing(false)
  }, [briefContext])

  useEffect(() => { void runBriefs(mail) }, [mail, runBriefs])

  /** Answer an invitation on the calendar it actually lives on. */
  const respondToInvitation = useCallback(async (row: MailRow, answer: Rsvp) => {
    if (!row.invite) return
    setRsvpBusy(p => ({ ...p, [row.id]: answer }))
    setRsvpError(p => { const n = { ...p }; delete n[row.id]; return n })
    const res = await respondToInvite(row.invite, row.account, answer)
    setRsvpBusy(p => { const n = { ...p }; delete n[row.id]; return n })
    if (res.ok) {
      setRsvpDone(p => ({ ...p, [row.id]: answer }))
      notify(`${RSVP_LABEL[answer]} to ${row.invite.summary}`)
    } else {
      // Never a bare failure: the reason is the whole value of the message.
      setRsvpError(p => ({ ...p, [row.id]: res.why ?? 'Google would not record the reply.' }))
    }
  }, [])

  /** Throw one brief away and write it again — the popup's Rewrite. */
  const rewriteDraft = useCallback(async (row: MailRow) => {
    forgetBrief(row.id)
    briefRun.current = ''   // asking again for this set is the whole point
    setBriefing(true)
    const { briefs: got, unavailable } = await briefsFor(
      [{
        id: row.id, messageId: row.messageId, fromName: row.fromName, fromEmail: row.fromEmail,
        subject: row.subject, receivedAt: row.receivedAt, addressedToMe: row.needsYou, body: row.body,
      }],
      briefContext(),
    )
    setBriefs(prev => ({ ...prev, ...got }))
    setBriefNote(unavailable)
    setBriefing(false)
  }, [briefContext])

  // ── Derived ────────────────────────────────────────────────────────────────

  const rank = useMemo(() => evaluateRank(tasks, habitsAll, logs), [tasks, habitsAll, logs])

  const brief = useMemo(
    () => composeBrief({ tasks, events, habits, logs, score: rank.score, today }),
    // briefSeed lets Regenerate re-read the stores even when nothing else changed
    [tasks, events, habits, logs, rank.score, today, briefSeed],
  )

  const openTasks = useMemo(
    () => tasks.filter(t => !t.completed && t.status !== 'cancelled' && t.status !== 'done'),
    [tasks],
  )
  const urgentCount = openTasks.filter(t => t.urgent).length
  // Carried over means its day has passed and it is still open. This counted
  // any task older than a day that had a time on it, so something planned for
  // next week was reported as carried over from the past.
  const carriedCount = openTasks.filter(t => !!t.dueDate && t.dueDate < dayKey(new Date())).length

  const blocks = useMemo<Block[]>(() => {
    const fromEvents: Block[] = events
      .filter(e => !!e.start.dateTime && !!e.end.dateTime)
      .map(e => {
        const s = new Date(e.start.dateTime!)
        const en = new Date(e.end.dateTime!)
        return {
          id: `ev-${e.id}`,
          kind: 'calendar' as const,
          title: e.summary ?? '(no title)',
          meta: e.location ? e.location.split(',')[0] : 'calendar',
          start: hhmm(s),
          end: hhmm(en),
          eventId: e.id,
          date: dayKey(s),
        }
      })
    // The events above are fetched for today alone. Tasks were not filtered by
    // date at all, so a task planned for 9am next Tuesday was drawn on today's
    // plan at 9am. A planned time with no date at all still means today.
    const today = dayKey(new Date())
    const fromTasks: Block[] = openTasks
      .filter(t => !!t.plannedTime && (!t.dueDate || t.dueDate === today))
      .map(t => ({
        id: `task-${t.id}`,
        kind: 'proposed' as const,
        title: t.title,
        meta: TASK_TYPE_META[t.taskType ?? inferTaskType(t.title)].label.toLowerCase(),
        start: t.plannedTime!,
        end: addMinutes(t.plannedTime!, t.duration ?? 30),
        taskId: t.id,
        date: t.dueDate ?? today,
      }))
    return [...fromEvents, ...fromTasks].sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
  }, [events, openTasks])

  const bookedMinutes = blocks.reduce((n, b) => n + Math.max(0, minutesOf(b.end) - minutesOf(b.start)), 0)
  const focusMinutes = blocks
    .filter(b => b.kind === 'proposed')
    .reduce((n, b) => n + Math.max(0, minutesOf(b.end) - minutesOf(b.start)), 0)
  const freeMinutes = Math.max(0, 16 * 60 - bookedMinutes)

  // ── Actions ────────────────────────────────────────────────────────────────

  function toggleHabit(id: string) {
    setLogs(prev => {
      const existing = prev[id] ?? []
      const updated = existing.includes(today) ? existing.filter(d => d !== today) : [...existing, today]
      const next = { ...prev, [id]: updated }
      saveLogs(next)
      return next
    })
  }

  function setHabitQty(h: Habit, value: number) {
    setQtyLogs(prev => {
      const next = { ...prev, [h.id]: { ...(prev[h.id] ?? {}), [today]: value } }
      saveQuantityLogs(next)
      return next
    })
    const goal = h.goal && h.goal > 0 ? h.goal : 1
    setLogs(prev => {
      const existing = prev[h.id] ?? []
      const met = value >= goal
      if (met === existing.includes(today)) return prev
      const updated = met ? [...existing, today] : existing.filter(d => d !== today)
      const next = { ...prev, [h.id]: updated }
      saveLogs(next)
      return next
    })
  }

  /** Dragging a proposed block re-times the task it stands for. */
  function moveBlock(block: Block, startMinutes: number) {
    if (block.kind !== 'proposed' || !block.taskId) return
    const length = Math.max(15, minutesOf(block.end) - minutesOf(block.start))
    updateTask(block.taskId, {
      plannedTime: fmtMins(startMinutes),
      duration: length,
      dueDate: today,
    })
    setPlanAccepted(false)
  }

  /** A block is a doorway back to whatever it came from. */
  function openBlock(block: Block) {
    if (block.eventId) focusOn({ module: 'calendar', id: block.eventId, date: block.date })
    else if (block.taskId) focusOn({ module: 'tasks', id: block.taskId })
  }

  /** Accepting the plan is not cosmetic: every proposed block keeps its time. */
  function acceptPlan() {
    for (const b of blocks) {
      if (b.kind !== 'proposed' || !b.taskId) continue
      updateTask(b.taskId, {
        plannedTime: b.start,
        duration: Math.max(0, minutesOf(b.end) - minutesOf(b.start)) || 30,
        dueDate: today,
      })
    }
    setPlanAccepted(true)
  }

  async function archiveMail(row: MailRow) {
    setMail(prev => prev.filter(r => r.id !== row.id))
    setNewsletters(prev => prev.filter(r => r.id !== row.id))
    try { await archiveMessage(row.messageId, row.account) } catch { /* it stays archived here either way */ }
  }

  /** Sweeping the newsletters away really archives them in Gmail — it used to
   *  only clear the count on this page. */
  async function archiveNewsletters() {
    const going = newsletters
    setNewsletters([])
    await Promise.all(going.map(r => archiveMessage(r.messageId, r.account).catch(() => null)))
  }

  function mailToTask(row: MailRow) {
    addTask({
      title: row.subject,
      quadrant: null,
      company: 'personal' as Task['company'],
      status: 'open',
      completed: false,
      capturedVia: 'mail',
    } as Omit<Task, 'id' | 'createdAt'>)
    setMail(prev => prev.filter(r => r.id !== row.id))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const dateLine = `Written ${hhmm(writtenAt.current)} · ${clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`

  return (
    <div style={{ padding: '0 0 40px' }}>

      {draftFor && briefs[draftFor.id] && (
        <DraftPopup
          row={draftFor}
          brief={briefs[draftFor.id]}
          rewriting={briefing}
          onRewrite={() => void rewriteDraft(draftFor)}
          onClose={() => setDraftFor(null)}
          onSent={() => {
            // Answered is dealt with: it leaves the card, and the brief goes
            // with it so a new message in the thread is read afresh.
            forgetBrief(draftFor.id)
            setMail(prev => prev.filter(m => m.id !== draftFor.id))
            setDraftFor(null)
          }}
        />
      )}

      {openMail && (
        <MailPopup
          row={openMail}
          onClose={() => setOpenMail(null)}
          onArchive={() => { void archiveMail(openMail); setOpenMail(null) }}
          onAddTask={() => { mailToTask(openMail); setOpenMail(null) }}
        />
      )}

      {/* ── Brief bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '14px 26px', borderBottom: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-header)',
      }}>
        <span style={{ fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: INK, flexShrink: 0 }}>Morning Brief</span>
        <span style={{ fontSize: 'var(--sb-t-body-s)', color: MUTED, flexShrink: 0 }}>{dateLine}</span>
        <span style={{ ...PILL, cursor: 'default', height: 28 }}>
          <Clock size={ICON.sm} /> {hhmm(clock)}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => { setBriefSeed(n => n + 1); void loadMail() }} style={PILL}>
          <RefreshCw size={ICON.sm} /> Regenerate
        </button>
        <button
          onClick={() => setActiveModule('tasks')}
          // A filled accent pill takes the ink the accent carries, which is
          // pale wherever the accent is darker than the ink midpoint.
          style={{ ...PILL, background: AMBER, color: 'var(--sb-accent-ink)', border: 'none', fontWeight: 600, boxShadow: 'var(--sb-shadow-control)' }}>
          <ArrowRight size={ICON.sm} strokeWidth={STROKE.active} /> Start the day
        </button>
      </div>

      {/* ── Two columns ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 16, padding: '16px 26px 0', alignItems: 'start',
      }}>

        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ ...CARD, padding: '22px 24px 24px' }}>
            <Quote size={ICON.md} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-border)' }} />
            <h1 style={{
              margin: '8px 0 0', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h1)', fontWeight: 600,
              letterSpacing: '-0.03em', lineHeight: 1.2, color: INK,
            }}>{brief.headline}</h1>
            <p style={{ margin: '9px 0 0', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>
              {tasks.filter(t => t.completed).length} closed all time · rank {rank.score} / 100 ·{' '}
              {events.filter(e => !!e.start.dateTime).length} meetings today
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)', lineHeight: 1.65 }}>{brief.body}</p>
            {brief.callout && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, marginTop: 16,
                padding: '11px 13px', borderRadius: 'var(--sb-r-nav)',
                background: 'rgba(var(--sb-accent-rgb),0.14)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.5)',
              }}>
                <Zap size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-warning)', flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>{brief.callout}</span>
              </div>
            )}
          </div>

          <MailCard
            rows={mail}
            loading={mailLoading}
            error={mailError}
            boxes={mailBoxCount}
            newsletters={newsletters}
            briefs={briefs}
            briefing={briefing}
            briefNote={briefNote}
            onArchive={row => void archiveMail(row)}
            onArchiveAll={() => void archiveNewsletters()}
            onOpenInbox={() => setActiveModule('inbox')}
            onOpen={setOpenMail}
            onOpenDraft={setDraftFor}
            rsvpBusy={rsvpBusy}
            rsvpDone={rsvpDone}
            rsvpError={rsvpError}
            onRespond={(row, r) => void respondToInvitation(row, r)}
          />
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <PlanCard
            blocks={blocks}
            freeMinutes={freeMinutes}
            focusMinutes={focusMinutes}
            dirty={!planAccepted}
            statuses={eventStatuses}
            onAccept={acceptPlan}
            onAddBlock={() => setActiveModule('calendar')}
            onOpenCalendar={() => setActiveModule('calendar')}
            onMoveBlock={moveBlock}
            onOpenBlock={openBlock}
            onSetStatus={(id, st) => setEventStatuses(toggleEventStatus(id, st))}
          />

          <div style={CARD}>
            <CardHead
              title="Tasks"
              meta={`${openTasks.length} open · ${urgentCount} urgent · ${carriedCount} carried over`}>
              <LinkOut label="Board" onClick={() => setActiveModule('tasks')} />
            </CardHead>
            {openTasks.length === 0 ? (
              <div style={{ padding: '18px 16px', fontSize: 'var(--sb-t-body-s)', color: GHOST }}>Nothing open. Enjoy it.</div>
            ) : (
              <div style={{ padding: '4px 16px 12px' }}>
                {openTasks.slice(0, 8).map(t => {
                  const type = t.taskType ?? inferTaskType(t.title)
                  const days = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000)
                  const meta = [
                    days > 0 ? `${days}d` : 'new',
                    t.plannedTime ?? (t.priority ?? undefined),
                  ].filter(Boolean).join(' · ')
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `var(--sb-border-width) solid ${HAIR}` }}>
                      <button
                        onClick={() => toggleComplete(t.id)}
                        title="Complete"
                        style={{
                          width: 17, height: 17, borderRadius: 'var(--sb-r-chip)', boxSizing: 'border-box', flexShrink: 0, padding: 0,
                          border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', cursor: 'pointer',
                        }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </span>
                      <span style={{ fontSize: 'var(--sb-t-meta)', color: GHOST, flexShrink: 0 }}>{meta}</span>
                      {(() => {
                        const TypeIcon = TASK_TYPE_ICON[type]
                        return (
                          <span title={TASK_TYPE_META[type].label} style={ICON_TILE}>
                            <TypeIcon size={13} strokeWidth={1.9} />
                          </span>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <HabitsCard
            habits={habits}
            logs={logs}
            qtyLogs={qtyLogs}
            today={today}
            onToggle={toggleHabit}
            onSetQty={setHabitQty}
            onOpenTracker={() => setActiveModule('habits')}
          />
        </div>
      </div>
    </div>
  )
}
