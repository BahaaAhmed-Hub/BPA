import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ListPlus, Check, PenSquare, ExternalLink, AlertTriangle } from 'lucide-react'
import { Button, Card, Pill } from '@/components/ui'
import { ICON, STROKE } from '@/lib/type'
import type { MailAccount } from '@/lib/gmail'
import { accountLabel } from './mailAccounts'
import type { SmartThread, PassResult } from '@/lib/mailSmartSync'
import type { SmartSection } from '@/lib/mailSmart'

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

const SECTIONS: { id: SmartSection; title: string; dot: string; blurb: string; empty: string }[] = [
  { id: 'action', title: 'Requires your action', dot: 'var(--sb-negative)',
    blurb: 'Addressed to you, and unanswered.',
    empty: 'Nothing is waiting on you.' },
  { id: 'radar', title: 'On your radar', dot: 'var(--sb-warning)',
    blurb: 'You are copied in. Worth knowing, not yours to answer.',
    empty: 'Nothing to watch.' },
  { id: 'fyi', title: 'Internal FYI', dot: 'var(--sb-info)',
    blurb: 'Answered, or informational. No action.',
    empty: 'Nothing here.' },
]

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

export function SmartView({
  result, loading, accounts, onRefresh, onOpen, onDraft, onTask, onHandled,
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
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const key = (t: SmartThread) => `${t.accountEmail}|${t.threadId}`

  const threads = useMemo(() => result?.threads ?? [], [result])
  // A thread dealt with here leaves the list it was in — that is the whole
  // point of marking it — but it is not thrown away: it joins the FYI section,
  // where it can still be found.
  const grouped = useMemo(() => {
    const g: Record<SmartSection, SmartThread[]> = { action: [], radar: [], fyi: [] }
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
              ? `${grouped.action.length} requiring you · ${grouped.radar.length} on your radar · ${grouped.fyi.length} for information`
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
        return (
          <Card key={s.id} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '13px 16px',
              borderBottom: list.length ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
            }}>
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
              <span style={{ flex: 1 }} />
              {!compact && list.length > 0 && (
                <Pill on={sel.length === list.length && list.length > 0}
                  onClick={() => setAll(list, sel.length !== list.length)}>
                  {sel.length === list.length ? 'Clear' : 'Select all'}
                </Pill>
              )}
            </div>

            {/* The bulk bar appears only when there is a selection to act on. */}
            {sel.length > 0 && (
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
              </div>
            )}

            {list.length === 0 ? (
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
                    onTask={() => onTask([t])} onDone={() => onHandled([t], true)} />
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function Row({ t, picked, onToggle, manyAccounts, section, onOpen, onDraft, onTask, onDone }: {
  t: SmartThread
  picked: boolean
  onToggle: () => void
  manyAccounts: boolean
  section: SmartSection
  onOpen: () => void
  onDraft: () => void
  onTask: () => void
  onDone: () => void
}) {
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
          <ReplyChip t={t} />
          <span style={{ flex: 1 }} />
          {/* A drafted reply is offered where one was written. It opens the
              ordinary composer — editable, with every draft action the mail
              client already has. Nothing here sends. */}
          {section === 'action' && t.draft && (
            <Button size="sm" onClick={onDraft}>
              <PenSquare size={ICON.sm} strokeWidth={STROKE.rest} /> Review the reply
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onTask}>
            <ListPlus size={ICON.sm} strokeWidth={STROKE.rest} />
            {section === 'action' ? 'Make a task' : 'Follow up'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone} title="Take it out of this list">
            <Check size={ICON.sm} strokeWidth={STROKE.active} /> Done
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onOpen} title="Open in the mail list">
            <ExternalLink size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
        </div>
      </div>
    </div>
  )
}
