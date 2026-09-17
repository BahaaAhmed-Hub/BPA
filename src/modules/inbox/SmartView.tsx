import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ListPlus, Check, PenSquare, ExternalLink, AlertTriangle, Archive, BellOff, Eye, EyeOff, X as XIcon, HelpCircle, Send, Trash2, LogIn } from 'lucide-react'
import { Button, Card, Pill } from '@/components/ui'
import { ICON, STROKE } from '@/lib/type'
import type { MailAccount } from '@/lib/gmail'
import { accountLabel } from './mailAccounts'
import type { SmartThread, PassResult } from '@/lib/mailSmartSync'
import type { SmartSection } from '@/lib/mailSmart'
import { canNeedAction, type MailKind } from '@/lib/mailKinds'
import { tagOfMail } from '@/lib/mailCompany'
import { isBusinessAccount } from '@/lib/businessAccounts'

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

/** The four, and **what each one actually means** — because "Worth knowing"
 *  and "On your radar" are not self-explanatory names and there was nowhere on
 *  the screen that said which was which. The blurb is on the pill's tooltip and
 *  again above the list you are reading, so the answer is where the question
 *  is. */
const SECTIONS: { id: SmartSection; title: string; dot: string; blurb: string; empty: string }[] = [
  { id: 'action', title: 'Requires your action', dot: 'var(--sb-negative)',
    blurb: 'Addressed to you, unanswered — plus every invitation.',
    empty: 'Nothing is waiting on you.' },
  // The half of "needs your attention" that wants nothing from you: a sign-in,
  // a meeting called off. Worth seeing, never a task.
  { id: 'attention', title: 'Worth knowing', dot: 'var(--sb-accent-deep)',
    blurb: 'Sign-ins and cancellations addressed to you. Nothing to answer.',
    empty: 'Nothing to catch up on.' },
  { id: 'radar', title: 'On your radar', dot: 'var(--sb-warning)',
    blurb: 'A person writing, unanswered — but you were only copied in.',
    empty: 'Nothing to watch.' },
  { id: 'fyi', title: 'Internal FYI', dot: 'var(--sb-info)',
    blurb: 'Answered, automated, or dealt with. Nothing wants anything.',
    empty: 'Nothing here.' },
]

const META: Record<SmartSection, typeof SECTIONS[number]> =
  Object.fromEntries(SECTIONS.map(s => [s.id, s])) as Record<SmartSection, typeof SECTIONS[number]>

/** Which view you had open, remembered — the one you work in is the one you
 *  want to land in. */
type SmartViewId = SmartSection | 'all'
const VIEW_KEY = 'mail-smart-view'

/** The number beside a view's name. Tabular figures so the rail does not
 *  jiggle as counts change, and **printed even when it is 0** — a blank reads
 *  as "not known" where a nought reads as "none", and the whole point of a
 *  count on a shut group is telling those apart. */
function Count({ n, on }: { n: number; on: boolean }) {
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums',
      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
      opacity: on ? 0.7 : 1,
    }}>{n}</span>
  )
}

/** The group a row is in, on the row, for the All view. Colour is never the
 *  only signal — the name is in the tooltip, and the pill above says the same
 *  thing in the same colour. */
function SectionDot({ id }: { id: SmartSection }) {
  return (
    <span title={META[id].title} aria-label={META[id].title} style={{
      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
      background: META[id].dot, alignSelf: 'center',
    }} />
  )
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

/** Whether a mailbox failed because its permission is gone, which is the one
 *  failure a person can actually do something about. Matched on Google's own
 *  words as well as on our error's name, because a failure raised deeper than
 *  `accessToken` — inside a batch, inside the edge function — arrives as prose. */
function isAuthReason(reason: string): boolean {
  return /needs signing in|invalid authentication|invalid credentials|access token|unauthenticated|401/i.test(reason)
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
  result, loading, accounts, openThreadId, onRefresh, onReconnect, onOpen, onDraft, onSendDraft,
  onDiscardDraft, onTask, onHandled, onArchive, onIgnore, onDismiss, onAcknowledge, onRsvp,
}: {
  result: PassResult | null
  loading: boolean
  accounts: MailAccount[]
  /** The thread open in the reader beside this list, so its row can say so. */
  openThreadId: string | null
  onRefresh: (full: boolean) => void
  /** Start the Google sign-in again, for a mailbox whose permission ran out. */
  onReconnect: () => void
  /** Show the thread in the normal view. */
  onOpen: (t: SmartThread) => void
  /** Open the real composer, seeded with the drafted reply. */
  onDraft: (t: SmartThread) => void
  onSendDraft: (t: SmartThread) => void
  onDiscardDraft: (t: SmartThread) => void
  /** One task, or a batch of them in one undo entry. */
  onTask: (ts: SmartThread[]) => void
  onHandled: (ts: SmartThread[], handled: boolean) => void
  /** Out of the inbox in Gmail, and out of this list. */
  onArchive: (ts: SmartThread[]) => void
  /** Not this thread, ever — a new message on it does not bring it back. */
  onIgnore: (ts: SmartThread[]) => void
  onDismiss: (ts: SmartThread[]) => void
  /** Seen. For the kinds that are never actions. */
  onAcknowledge: (ts: SmartThread[]) => void
  /** Yes / Maybe / No, through the app's own RSVP. */
  onRsvp: (t: SmartThread, answer: 'accepted' | 'tentative' | 'declined') => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [view, setView] = useState<SmartViewId>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as SmartViewId) || 'action' } catch { return 'action' }
  })
  const choose = (v: SmartViewId) => {
    setView(v)
    // A selection made in one view is aimed at rows the next one does not show.
    setPicked(new Set())
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* quota */ }
  }
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

  // What this view is showing. `all` keeps the order the pass gave it — what
  // you are holding up first, then newest — so a row does not move because you
  // changed which view you were reading it in.
  // Unanswered, over a day old, and actually addressed to you.
  const holdingUp = useMemo(() => threads.filter(t => t.bottleneck && !t.handled).length, [threads])
  const here = view === 'all' ? META.action : META[view]
  const shown = view === 'all' ? threads : grouped[view]
  const sel = pickedIn(shown)

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
          {/* The rail below counts each group, so repeating those here was the
              same four numbers twice. This says the thing none of them does:
              **how many people are actually waiting on you**, which is the
              question the whole screen exists to answer. */}
          {loading ? 'Reading…'
            : !result ? 'Not read yet.'
            : holdingUp > 0
              ? `${holdingUp} ${holdingUp === 1 ? 'person is' : 'people are'} waiting on you`
              : threads.length > 0 ? 'Nobody is waiting on you.'
              : 'Nothing in the last thirty days.'}
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
          <AlertTriangle size={ICON.sm} strokeWidth={STROKE.active} style={{ flexShrink: 0 }} />
          {/* ── Say what to do, not what Google said ────────────────────────
              "Request had invalid authentication credentials. Expected OAuth 2
              access token, login cookie or other valid authentication
              credential. See developers.google.com/…/devconsole-project" is
              addressed to whoever wrote the app, and it appeared over the
              reader with no way forward. There is exactly one thing that fixes
              it, so the banner is that thing. */}
          {isAuthReason(f.reason) ? (
            <>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>{f.email}</b> needs signing in to Google again —
                its permission has run out.
              </span>
              <Button size="sm" onClick={onReconnect} title={f.reason}>
                <LogIn size={ICON.sm} strokeWidth={STROKE.rest} /> Sign in again
              </Button>
            </>
          ) : (
            <span>{f.email} could not be read — {f.reason}</span>
          )}
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

      {/* ── The views ────────────────────────────────────────────────────
          Four sections stacked down the page meant scrolling past the three
          you were not working on to reach the one you were, and folding them
          away only traded that for four headers and a memory of which you had
          shut. They are **views** now — one at a time, chosen from a rail, in
          the app's own filter component, the same one the ordinary mail list
          filters by class with.

          **All** is a real answer rather than a fallback: it is the whole of
          the last thirty days in one list, in the order the sections would
          have put it — what you are holding up first, then newest — so a row
          keeps its place whichever view you came from. */}
      <div className="mail-filter-rail">
        <Pill on={view === 'all'} onClick={() => choose('all')}
          title="Everything, in the order it matters">
          All <Count n={threads.length} on={view === 'all'} />
        </Pill>
        {SECTIONS.map(s => (
          <Pill key={s.id} on={view === s.id} onClick={() => choose(s.id)}
            title={grouped[s.id].length === 0 ? s.empty : s.blurb}>
            <span aria-hidden style={{
              width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0,
            }} />
            {s.title} <Count n={grouped[s.id].length} on={view === s.id} />
          </Pill>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
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
              {view === 'action' ? `Make ${sel.length} task${sel.length === 1 ? '' : 's'}`
                : `Follow up on ${sel.length}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { onHandled(sel, true); setPicked(new Set()) }}>
              <Check size={ICON.sm} strokeWidth={STROKE.active} /> Mark done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { onArchive(sel); setPicked(new Set()) }}
              title="Out of the inbox in Gmail, and out of this list">
              <Archive size={ICON.sm} strokeWidth={STROKE.rest} /> Archive
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { onDismiss(sel); setPicked(new Set()) }}
              title="Take these out of the list — a new message on any of them brings it back">
              <EyeOff size={ICON.sm} strokeWidth={STROKE.rest} /> Dismiss
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { onIgnore(sel); setPicked(new Set()) }}
              title="Mute these threads — new messages on them never come back either">
              <BellOff size={ICON.sm} strokeWidth={STROKE.rest} /> Mute
            </Button>
          </div>
        )}

        {shown.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 16px',
            borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
          }}>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', flex: 1, minWidth: 0 }}>
              {view === 'all' ? 'Everything, what you are holding up first' : here.blurb}
            </span>
            <Pill on={sel.length === shown.length}
              onClick={() => setAll(shown, sel.length !== shown.length)}>
              {sel.length === shown.length ? 'Clear' : 'Select all'}
            </Pill>
          </div>
        )}

        {shown.length === 0 ? (
          <div style={{ padding: '22px 16px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            {loading ? 'Reading…' : view === 'all' ? 'No mail in the last thirty days.' : here.empty}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {shown.map(t => {
              // A row's shape belongs to the row, not to the view it is being
              // read in: something with nothing to act on is one line whether
              // you are looking at FYI or at everything at once.
              const where = t.handled ? 'fyi' : t.section
              return where === 'fyi' ? (
                <button key={key(t)} onClick={() => onOpen(t)}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 10, textAlign: 'left',
                    padding: '8px 16px', background: 'transparent', border: 'none',
                    borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
                    cursor: 'pointer', fontFamily: 'inherit', width: '100%',
                  }}>
                  {view === 'all' && <SectionDot id={where} />}
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
              ) : (
                <Row key={key(t)} t={t} picked={picked.has(key(t))} onToggle={() => toggle(t)}
                  manyAccounts={accounts.length > 1}
                  open={t.threadId === openThreadId}
                  section={where}
                  // Which group it is in, but only where that is not already
                  // the answer to the question you asked by picking a view.
                  showSection={view === 'all'}
                  onOpen={() => onOpen(t)} onDraft={() => onDraft(t)}
                  onSendDraft={() => onSendDraft(t)}
                  onDiscardDraft={() => onDiscardDraft(t)}
                  onTask={() => onTask([t])} onDone={() => onHandled([t], true)}
                  onArchive={() => onArchive([t])} onIgnore={() => onIgnore([t])}
                  onDismiss={() => onDismiss([t])}
                  onAcknowledge={() => onAcknowledge([t])}
                  onRsvp={a => onRsvp(t, a)} />
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function Row({
  t, picked, onToggle, manyAccounts, section, open, showSection,
  onOpen, onDraft, onSendDraft, onDiscardDraft, onTask, onDone, onArchive, onIgnore,
  onDismiss, onAcknowledge, onRsvp,
}: {
  t: SmartThread
  picked: boolean
  onToggle: () => void
  manyAccounts: boolean
  section: SmartSection
  /** Being read in the panel beside the list. */
  open: boolean
  /** Draw which group it is in. Only in the All view — anywhere else you have
   *  just asked the question by picking the view. */
  showSection: boolean
  onOpen: () => void
  onDraft: () => void
  /** Send what is written, as it is written. The only thing here that sends. */
  onSendDraft: () => void
  onDiscardDraft: () => void
  onTask: () => void
  onDone: () => void
  onArchive: () => void
  /** Mute the thread for good. */
  onIgnore: () => void
  /** This message only — the thread comes back when somebody writes again. */
  onDismiss: () => void
  onAcknowledge: () => void
  onRsvp: (a: 'accepted' | 'tentative' | 'declined') => void
}) {
  // Whether words back are the thing this thread wants. Everything a row does
  // differently for a machine's notice hangs off this one question.
  const answerable = canNeedAction(t.kind)
  // A stored row carries the sender and the mailbox, which is enough: the
  // company is resolved from those the same way the flat list resolves it.
  const company = useMemo(
    () => tagOfMail({ fromEmail: t.fromEmail, accountEmail: t.accountEmail },
                    isBusinessAccount(t.accountEmail)),
    [t.fromEmail, t.accountEmail])
  // The mailbox, but only where it is not the same word as the chip. With the
  // company resolved from the mailbox itself the two are usually identical, and
  // "DX Technologies  DX Technologies" on one line reads as a bug.
  // A drafted answer is only ever shown where one is actually wanted: a person
  // writing to you, in the section that means you owe them words.
  const draftShown = answerable && t.kind === 'reply' && section === 'action'
    && !!t.draft?.trim() && !t.acted
  const boxLabel = useMemo(() => {
    if (!manyAccounts) return ''
    const label = accountLabel(t.accountEmail)
    return label === company?.label ? '' : label
  }, [manyAccounts, t.accountEmail, company?.label])
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
      // Which row the panel is showing. It beats the bottleneck tint: where
      // you are is the more urgent thing to know than that somebody is waiting.
      background: open ? 'var(--sb-accent-tint)'
        : t.bottleneck ? 'var(--sb-negative-tint)' : 'transparent',
      boxShadow: open ? 'inset 3px 0 0 var(--sb-accent)' : undefined,
    }}>
      <input type="checkbox" checked={picked} onChange={onToggle}
        aria-label={`Select "${t.subject}"`}
        style={{ marginTop: 3, flexShrink: 0, accentColor: 'var(--sb-ink-1)', cursor: 'pointer' }} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* ── The title line ───────────────────────────────────────────────
            Subject alone on the left, company alone on the right. It used to
            be one wrapping row of subject, sender, date, company and the
            waiting flag, so the chip landed at a different x on every row and
            the column read as five things that had drifted. A label you scan
            down has to be in the same place on each line, which means it is
            pinned to an edge rather than pushed along by whatever precedes it. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {showSection && <SectionDot id={section} />}
          <button onClick={onOpen} title="Open the thread"
            style={{
              flex: 1, minWidth: 0,
              padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
              letterSpacing: '-0.015em', color: 'var(--sb-ink-1)', textAlign: 'left',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{t.subject}</button>
          {company && (
            <span title={`${company.label}${boxLabel ? ` · ${boxLabel}` : ''}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              fontSize: 'var(--sb-t-micro)', fontWeight: 600, padding: '1px 8px',
              borderRadius: 'var(--sb-r-chip)', color: 'var(--sb-ink-2)',
              background: company.isCompany
                ? `color-mix(in srgb, ${company.color} 16%, transparent)`
                : 'var(--sb-field)',
              maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <span aria-hidden style={{
                width: 6, height: 6, borderRadius: '50%', background: company.color, flexShrink: 0,
              }} />
              {company.label}
            </span>
          )}
        </div>

        {/* Who and when, and whether they are waiting. The mailbox is named
            here **only when it says something the chip does not** — with the
            company resolved from that same mailbox the two were the identical
            word twice on one line, which is how a row starts looking like a
            mistake. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{t.fromName}</span>
          <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>{when(t.lastAt)}</span>
          {boxLabel && (
            <span title={t.accountEmail} style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
              {boxLabel}
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

        {/* ── The reply, written and not sent ──────────────────────────────
            It used to be behind a button called "Review the reply", which
            meant a drafted answer was invisible until you asked for it — so
            the one thing the pass produced that saves any time was the one
            thing you could not see. Two lines of it sit here, in the mail's
            own area, with the whole of it a click away and **Send** the only
            thing that ever sends. */}
        {draftShown && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '9px 11px', borderRadius: 'var(--sb-r-nav)',
            background: 'var(--sb-field)',
            border: 'var(--sb-border-width) solid var(--sb-hairline)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--sb-ink-3)',
              }}>Draft reply · not sent</span>
              <span style={{ flex: 1 }} />
              <Button size="sm" onClick={onSendDraft} title={`Send this to ${t.fromName}`}>
                <Send size={ICON.sm} strokeWidth={STROKE.rest} /> Send
              </Button>
              <Button size="sm" variant="ghost" onClick={onDraft} title="Open it in the composer">
                <PenSquare size={ICON.sm} strokeWidth={STROKE.rest} /> Edit
              </Button>
              <Button size="sm" variant="ghost" iconOnly onClick={onDiscardDraft} title="Discard this draft">
                <Trash2 size={ICON.sm} strokeWidth={STROKE.rest} />
              </Button>
            </div>
            {/* Two lines, clamped. Enough to know whether it is worth sending,
                never so much that the row stops being a row. */}
            <button onClick={onDraft} title="Open it in the composer"
              style={{
                textAlign: 'left', padding: 0, border: 'none', background: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>{t.draft}</button>
          </div>
        )}

        {/* An action is over once it has been taken. Leaving Make a task lit
            beside a task that now exists invites a second one, and says
            nothing about the first. */}
        {t.acted ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, marginTop: 1,
            fontSize: 'var(--sb-t-meta)', color: 'var(--sb-positive)', fontWeight: 600,
          }}>
            <Check size={ICON.sm} strokeWidth={STROKE.active} aria-hidden />
            <span style={{ color: 'var(--sb-ink-2)', fontWeight: 500 }}>{t.acted}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" iconOnly onClick={onOpen} title="Open the thread">
              <ExternalLink size={ICON.sm} strokeWidth={STROKE.rest} />
            </Button>
          </div>
        ) : (
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
          {/* ── Two different promises, so two controls ──────────────────
              One bell said "ignore", and what it meant was *never show this
              thread again, whatever anybody writes in it* — much the larger of
              the two decisions, and the only one on offer, so the smaller one
              (this message is dealt with, but keep listening) had to be made
              with the tick and hoped for.

              **Dismiss** takes this message out of the list; a new one on the
              same thread brings it back. **Mute** is the thread, for good. */}
          <Button size="sm" variant="ghost" iconOnly onClick={onDismiss}
            title="Not this message — it leaves the list, and a new message on the thread brings it back">
            <EyeOff size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onIgnore}
            title="Mute the whole thread — new messages on it never come back either">
            <BellOff size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onDone}
            title="Done — marks the thread read in Gmail and takes it out of this list. It stays in your inbox.">
            <Check size={ICON.sm} strokeWidth={STROKE.active} />
          </Button>
          <Button size="sm" variant="ghost" iconOnly onClick={onOpen} title="Read it">
            <ExternalLink size={ICON.sm} strokeWidth={STROKE.rest} />
          </Button>
        </div>
        )}
      </div>
    </div>
  )
}
