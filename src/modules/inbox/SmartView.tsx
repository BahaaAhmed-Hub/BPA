import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ListPlus, Check, PenSquare, ExternalLink, AlertTriangle, ChevronDown, ChevronRight, Archive, BellOff, Eye, X as XIcon, HelpCircle } from 'lucide-react'
import { Button, Card, Pill } from '@/components/ui'
import { ICON, STROKE } from '@/lib/type'
import type { MailAccount } from '@/lib/gmail'
import { accountLabel } from './mailAccounts'
import type { SmartThread, PassResult } from '@/lib/mailSmartSync'
import type { SmartSection } from '@/lib/mailSmart'
import { canNeedAction, type MailKind } from '@/lib/mailKinds'

// ─── The smart view ──────────────────────────────────────────────────────────
//
//  The normal view answers "what is in my mail". This one answers "what is
//  waiting on me", which is a different question and wants a different shape:
//  not a list of messages in the order they arrived, but three groups in the
//  order you should deal with them.
//
//  It writes plainly on purpose. A screen whose job is to say what you owe
//  people has no business being pleased with itself, so there is no "Great
//  work!" and no "You're all caught up 🎉" — an empty section says it is empty
//  and stops.

const SECTIONS: { id: SmartSection; title: string; dot: string; empty: string }[] = [
  { id: 'action', title: 'Requires your action', dot: 'var(--sb-negative)',
    empty: 'Nothing is waiting on you.' },
  // The half of "needs your attention" that wants nothing from you: a sign-in,
  // a status notice, a meeting called off. Worth seeing, never a task.
  { id: 'attention', title: 'Worth knowing', dot: 'var(--sb-accent-deep)',
    empty: 'Nothing to catch up on.' },
  { id: 'radar', title: 'On your radar', dot: 'var(--sb-warning)',
    empty: 'Nothing to watch.' },
  { id: 'fyi', title: 'Internal FYI', dot: 'var(--sb-info)',
    empty: 'Nothing here.' },
]

/** Which sections are folded away. Remembered, because the one you keep shut is
 *  shut for a reason and reopening it every visit is the app forgetting. */
const OPEN_KEY = 'mail-smart-open-sections'
function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    return raw ? JSON.parse(raw) as Record<string, boolean> : {}
  } catch { return {} }
}
function saveOpen(v: Record<string, boolean>): void {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)) } catch { /* quota */ }
}

const EYEBROW: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}

function when(ms: number): string {
  const d = new Date(ms)
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** The reply state as a word and a mark. Colour is never the only signal. */
function ReplyChip({ t }: { t: SmartThread }) {
  const [mark, word, ink] =
    t.replyState === 'replied' ? ['✅', 'Replied', 'var(--sb-positive)'] :
    t.replyState === 'pending' ? ['⏳', 'Pending', 'var(--sb-warning)'] :
    ['🔴', 'No reply', 'var(--sb-negative)']
  return (
    <span title={
      t.replyState === 'replied' ? 'You wrote the most recent message in this thread.'
      : t.replyState === 'pending' ? 'You replied, and they have written since.'
      : 'You have not written in this thread.'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
        fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: ink,
      }}>
      <span aria-hidden>{mark}</span>{word}
    </span>
  )
}

/** An invitation says what it is and when, not whether you have written back. */
function InviteChip() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-accent-deep)',
    }}>
      <span aria-hidden>📅</span>Invitation
    </span>
  )
}

/** What a machine's notice is, in place of a reply state it has no use for.
 *  The row still says something on that line — an empty slot where every other
 *  row carries a word reads as a row that failed to load. */
function KindChip({ kind }: { kind: MailKind }) {
  const [mark, word] =
    kind === 'security'  ? ['🔐', 'Sign-in notice'] :
    kind === 'cancelled' ? ['🚫', 'Called off'] :
    ['📣', 'Information']
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)',
    }}>
      <span aria-hidden>{mark}</span>{word}
    </span>
  )
}

export function SmartView({
  result, loading, accounts, onRefresh, onOpen, onDraft, onTask, onHandled,
  onArchive, onIgnore, onAcknowledge, onRsvp,
}: {
  result: PassResult | null
  loading: boolean
  accounts: MailAccount[]
  onRefresh: (full: boolean) => void
  /** Show the thread in the normal view. */
  onOpen: (t: SmartThread) => void
  /** Open the real composer, seeded with the drafted reply. */
  onDraft: (t: SmartThread) => void
  /** One task, or a batch of them in one undo entry. */
  onTask: (ts: SmartThread[]) => void
  onHandled: (ts: SmartThread[], handled: boolean) => void
  /** Out of the inbox in Gmail, and out of this list. */
  onArchive: (ts: SmartThread[]) => void
  /** Not this thread, ever — a new message on it does not bring it back. */
  onIgnore: (ts: SmartThread[]) => void
  /** Seen. For the kinds that are never actions. */
  onAcknowledge: (ts: SmartThread[]) => void
  /** Yes / Maybe / No, through the app's own RSVP. */
  onRsvp: (t: SmartThread, answer: 'accepted' | 'tentative' | 'declined') => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen)
  const isOpen = (id: string) => open[id] !== false        // open unless folded
  const toggleOpen = (id: string) => setOpen(o => {
    const next = { ...o, [id]: !isOpen(id) }
    saveOpen(next); return next
  })
  const key = (t: SmartThread) => `${t.accountEmail}|${t.threadId}`

  const threads = useMemo(() => result?.threads ?? [], [result])
  // A thread dealt with here leaves the list it was in — that is the whole
  // point of marking it — but it is not thrown away: it joins the FYI section,
  // where it can still be found.
  const grouped = useMemo(() => {
    const g: Record<SmartSection, SmartThread[]> = { action: [], attention: [], radar: [], fyi: [] }
    for (const t of threads) g[t.handled ? 'fyi' : t.section].push(t)
    return g
  }, [threads])

  // A selection that outlives the rows it pointed at is a bulk action aimed at
  // nothing. Anything no longer on screen drops out of it.
  useEffect(() => {
    setPicked(prev => {
      const live = new Set(threads.map(key))
      const next = new Set([...prev].filter(k => live.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [threads])

  const pickedIn = (list: SmartThread[]) => list.filter(t => picked.has(key(t)))
  const toggle = (t: SmartThread) => setPicked(p => {
    const n = new Set(p); const k = key(t)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })
  const setAll = (list: SmartThread[], on: boolean) => setPicked(p => {
    const n = new Set(p)
    for (const t of list) { if (on) n.add(key(t)); else n.delete(key(t)) }
    return n
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── What the last pass did. A line, not a spinner: the interesting
             thing is how much of this was already known. ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 14px', borderRadius: 'var(--sb-r-nav)',
        background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
      }}>
        <span style={EYEBROW}>Last 30 days</span>
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          {loading ? 'Reading…'
            : result
              // All four, or the line counts three sections on a screen that
              // draws four and the missing one reads as rows that went astray.
              ? `${grouped.action.length} requiring you · ${grouped.attention.length} worth knowing`
                + ` · ${grouped.radar.length} on your radar · ${grouped.fyi.length} for information`
              : 'Not read yet.'}
        </span>
        {result && !loading && (
          <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
            {result.analysed === 0
              ? 'nothing new since the last look'
              : `${result.analysed} new or changed`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => onRefresh(false)} disabled={loading}>
          <RefreshCw size={ICON.sm} strokeWidth={STROKE.rest}
            style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Check now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onRefresh(true)} disabled={loading}
          title="Ignore what is already known and read the whole 30 days again">
          Re-read all
        </Button>
      </div>

      {result?.failed?.map(f => (
        <div key={f.email} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px',
          borderRadius: 'var(--sb-r-nav)', fontSize: 'var(--sb-t-meta)',
          color: 'var(--sb-negative)', background: 'var(--sb-negative-tint)',
        }}>
          <AlertTriangle size={ICON.sm} strokeWidth={STROKE.active} />
          {f.email} could not be read — {f.reason}
        </div>
      ))}

      {/* Said once, under the header — not down every row. */}
      {result?.aiError && (
        <div style={{
          padding: '9px 13px', borderRadius: 'var(--sb-r-nav)', fontSize: 'var(--sb-t-meta)',
          color: 'var(--sb-ink-3)', background: 'var(--sb-field)',
        }}>
          Sorted by who it is addressed to and whether you have replied. The one-line
          summaries and drafts are missing: {result.aiError}
        </div>
      )}

      {SECTIONS.map(s => {
        const list = grouped[s.id]
        const sel = pickedIn(list)
        const compact = s.id === 'fyi'
        const shown = isOpen(s.id)
        return (
          <Card key={s.id} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '13px 16px',
              borderBottom: shown && list.length ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
            }}>
              {/* The whole header folds the section. A count on a shut section
                  is the point of shutting it — you can see there are four
                  without reading four rows. */}
              <button
                onClick={() => toggleOpen(s.id)}
                aria-expanded={shown}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left', color: 'inherit',
                }}>
                {shown
                  ? <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />
                  : <ChevronRight size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />}
                <span aria-hidden style={{
                  width: 8, height: 8, borderRadius: '50%', background: s.dot, flexShrink: 0,
                }} />
                <span style={{
                  fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)',
                  fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
                }}>{s.title}</span>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                  {list.length || ''}
                </span>
              </button>
              {shown && !compact && list.length > 0 && (
                <Pill on={sel.length === list.length && list.length > 0}
                  onClick={() => setAll(list, sel.length !== list.length)}>
                  {sel.length === list.length ? 'Clear' : 'Select all'}
                </Pill>
              )}
            </div>

            {/* The bulk bar appears only when there is a selection to act on. */}
            {shown && sel.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '9px 16px', background: 'var(--sb-accent-tint)',
                borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
              }}>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', fontWeight: 600 }}>
                  {sel.length} selected
                </span>
                <span style={{ flex: 1 }} />
                <Button size="sm" onClick={() => { onTask(sel); setPicked(new Set()) }}>
                  <ListPlus size={ICON.sm} strokeWidth={STROKE.rest} />
                  {s.id === 'action' ? `Make ${sel.length} task${sel.length === 1 ? '' : 's'}`
                    : `Follow up on ${sel.length}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { onHandled(sel, true); setPicked(new Set()) }}>
                  <Check size={ICON.sm} strokeWidth={STROKE.active} /> Mark done
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { onArchive(sel); setPicked(new Set()) }}
                  title="Out of the inbox in Gmail, and out of this list">
                  <Archive size={ICON.sm} strokeWidth={STROKE.rest} /> Archive
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { onIgnore(sel); setPicked(new Set()) }}
                  title="Never show these again, even when somebody writes back">
                  <BellOff size={ICON.sm} strokeWidth={STROKE.rest} /> Ignore
                </Button>
              </div>
            )}

            {!shown ? null : list.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                {loading ? 'Reading…' : s.empty}
              </div>
            ) : compact ? (
              // FYI is a list, not a set of cards: subject and one line, nothing
              // to act on, so nothing that looks actionable.
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {list.map(t => (
                  <button key={key(t)} onClick={() => onOpen(t)}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 10, textAlign: 'left',
                      padding: '8px 16px', background: 'transparent', border: 'none',
                      borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
                      cursor: 'pointer', fontFamily: 'inherit', width: '100%',
                    }}>
                    <span style={{
                      fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '42%',
                    }}>{t.subject}</span>
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{t.awaitingCustomer ? 'Awaiting customer — no follow-up needed' : (t.need || t.fromName)}</span>
                    <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', flexShrink: 0 }}>
                      {when(t.lastAt)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {list.map(t => (
                  <Row key={key(t)} t={t} picked={picked.has(key(t))} onToggle={() => toggle(t)}
                    manyAccounts={accounts.length > 1}
                    section={s.id}
                    onOpen={() => onOpen(t)} onDraft={() => onDraft(t)}
                    onTask={() => onTask([t])} onDone={() => onHandled([t], true)}
                    onArchive={() => onArchive([t])} onIgnore={() => onIgnore([t])}
                    onAcknowledge={() => onAcknowledge([t])}
                    onRsvp={a => onRsvp(t, a)} />
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function Row({
  t, picked, onToggle, manyAccounts, section,
  onOpen, onDraft, onTask, onDone, onArchive, onIgnore, onAcknowledge, onRsvp,
}: {
  t: SmartThread
  picked: boolean
  onToggle: () => void
  manyAccounts: boolean
  section: SmartSection
  onOpen: () => void
  onDraft: () => void
  onTask: () => void
  onDone: () => void
  onArchive: () => void
  onIgnore: () => void
  onAcknowledge: () => void
  onRsvp: (a: 'accepted' | 'tentative' | 'declined') => void
}) {
  // Whether words back are the thing this thread wants. Everything a row does
  // differently for a machine's notice hangs off this one question.
  const answerable = canNeedAction(t.kind)
  return (
    <div style={{
      // `flex-start`, not the default stretch: a stretched checkbox centres its
      // own glyph against the whole row and drifts away from the title it
      // selects.
      display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 16px',
      borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
      // Being the one holding a thread up is the single most useful thing this
      // screen can tell you, so it is marked on the row rather than sorted for
      // silently.
      background: t.bottleneck ? 'var(--sb-negative-tint)' : 'transparent',
    }}>
      <input type="checkbox" checked={picked} onChange={onToggle}
        aria-label={`Select "${t.subject}"`}
        style={{ marginTop: 3, flexShrink: 0, accentColor: 'var(--sb-ink-1)', cursor: 'pointer' }} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <button onClick={onOpen} title="Open the thread"
            style={{
              padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
              letterSpacing: '-0.015em', color: 'var(--sb-ink-1)', textAlign: 'left',
              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{t.subject}</button>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{t.fromName}</span>
          <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>{when(t.lastAt)}</span>
          {manyAccounts && (
            <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
              {accountLabel(t.accountEmail)}
            </span>
          )}
          {t.bottleneck && (
            <span title="They are waiting on you, and have been since before today."
              style={{
                fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--sb-negative)',
              }}>Waiting on you</span>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
          {t.awaitingCustomer
            ? 'Awaiting customer — no follow-up needed.'
            : t.need || 'No summary — the model was not asked or did not answer.'}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 1 }}>
          {/* An invitation has no reply state worth showing — it has an answer,
              and the answer is the three buttons. Nor has a machine's notice:
              "No reply" under a sign-in alert is true, and reads as a reproach
              about a message nobody is waiting on. */}
          {t.kind === 'invitation' ? <InviteChip />
            : answerable ? <ReplyChip t={t} /> : <KindChip kind={t.kind} />}
          <span style={{ flex: 1 }} />

          {/* ── What this kind actually wants ───────────────────────────────
              An invitation is answered by RSVPing; answering in prose sends the
              organiser a pleasant note and tells their calendar nothing, which
              is a mistake this app already made once. A sign-in notice is
              answered by having seen it. Only a person writing to you wants
              words back. */}
          {t.kind === 'invitation' && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Button size="sm" onClick={() => onRsvp('accepted')}>
                <Check size={ICON.sm} strokeWidth={STROKE.active} /> Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRsvp('tentative')} title="Maybe">
                <HelpCircle size={ICON.sm} strokeWidth={STROKE.rest} /> Maybe
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRsvp('declined')} title="No">
                <XIcon size={ICON.sm} strokeWidth={STROKE.rest} /> No
              </Button>
            </span>
          )}

          {/* Acknowledging keeps the thread and marks it. A sign-in alert you
              want gone is archived or ignored like anything else — taking it
              out of the list for having been read would mean the only record
              that you looked is that it is no longer there. */}
          {!answerable && (t.acknowledged ? (
            <span title="You have marked this one seen."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-positive)',
              }}>
              <Eye size={ICON.sm} strokeWidth={STROKE.rest} aria-hidden /> Seen
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={onAcknowledge}
              title="Mark it seen. It stays in the list, marked — archive or ignore it to send it away.">
              <Eye size={ICON.sm} strokeWidth={STROKE.rest} /> Acknowledge
            </Button>
          ))}

          {t.kind === 'reply' && section === 'action' && t.draft && (
            <Button size="sm" onClick={onDraft}>
              <PenSquare size={ICON.sm} strokeWidth={STROKE.rest} /> Review the reply
            </Button>
          )}

          {/* "Follow up" on a status page is an offer to chase a machine. A
              cancellation and an invitation can still become a task — there is
              a meeting behind each — but a notice has nothing to follow. */}
          {(answerable || t.kind === 'cancelled') && (
            <Button size="sm" variant="ghost" onClick={onTask}>
              <ListPlus size={ICON.sm} strokeWidth={STROKE.rest} />
              {section === 'action' ? 'Make a task' : 'Follow up'}
            </Button>
          )}

          <Button size="sm" variant="ghost" iconOnly onClick={onArchive} title="Archive it">
            <Archive size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onIgnore}
            title="Ignore this thread — it does not come back">
            <BellOff size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onDone} title="Done for now">
            <Check size={ICON.sm} strokeWidth={STROKE.active} />
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onOpen} title="Open in the mail list">
            <ExternalLink size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
        </div>
      </div>
    </div>
  )
}
