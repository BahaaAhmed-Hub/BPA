// ─── What came out of the meeting ────────────────────────────────────────────
//
// A meeting that is over leaves two things behind: work somebody now owes, and
// often the next meeting. Marking the block done recorded neither — the hour
// greyed out and whatever was agreed in it stayed in your head until you
// remembered to type it somewhere else.
//
// Three rules hold this file together:
//
// **The event is already done when this opens.** It is not a gate. The project
// has made the other mistake once already — `DeliverablePrompt` stood between
// a tick and the task, and dismissing it left the task open with nothing on
// screen to say the gesture had been dropped ("I marked it completed and it
// appears as incomplete"). So the status is written first and this asks
// afterwards: closing it costs the outputs you had not typed yet and nothing
// else.
//
// **A line is a task, with no model involved.** The one popup that already
// asked this question — `MeetingFollowUpPopup`, for a *task* of a meeting kind
// — could only reach its editable rows through `breakdownMeetingNotes`. With
// no AI key, or a refused request, there was no way to write down a single
// follow-up: the extractor was the only door to the form. Here the lines you
// type *are* the tasks, and pulling them out of prose is an accelerator beside
// that, which can fail without taking the form with it.
//
// **The next meeting is one of the actions, not a separate errand.** It hands
// back to the calendar's own composer, seeded with this meeting's people and
// calendar — a second event form would be a second answer to a question
// `NewEventPanel` already answers.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Plus, Trash2, Check, ChevronDown, ChevronUp, CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui'
import { breakdownMeetingNotes } from '@/lib/professor'
import { useTaskStore } from '@/store/taskStore'
import { notify } from '@/lib/undo'
import { placementForNew } from '@/modules/tasks/BrainDumpRail'
import { loadDynamicCompanies, getVisibleUsers } from '@/types'
import type { DynamicCompany, Priority, Quadrant, Task } from '@/types'
import { ICON, STROKE } from '@/lib/type'
import { alpha } from '@/lib/alpha'

/** The meeting this is about. Only what the question needs. */
export interface OutcomeEvent {
  id: string
  title: string
  /** "Tue 7 Oct · 14:00 – 15:00", for the header. */
  when?: string
  calendarId?: string
  htmlLink?: string
}

type Users = ReturnType<typeof getVisibleUsers>

/** Whose meeting this was. The inverse of `resolveTaskCalendar`'s company →
 *  calendar step, and the only honest one there is: a calendar nobody has
 *  claimed belongs to no company, and a guess here files a client's work under
 *  the wrong name. */
export function companyForCalendar(calendarId: string | undefined): DynamicCompany | undefined {
  if (!calendarId) return undefined
  return loadDynamicCompanies().find(c => !c.hidden && c.calendarId === calendarId)
}

/** One line of the outputs, with the settings that belong to it. The key is a
 *  uuid rather than the index, so a row's settings follow it when a line above
 *  is removed. */
interface Line {
  key: string
  title: string
  /** `auto` is nobody having said — the app's own answer for a task made on
   *  purpose, which moves as the line's date and priority are filled in. A
   *  pill shows whichever box that resolves to, so it is never a mystery, and
   *  touching one makes the choice yours. */
  box: Quadrant | null | 'auto'
  due: string
  ownerId: string
  priority: Priority | ''
}

/** The box a line goes in. `placementForNew` is the app's own answer — the
 *  same one the header's New task and a card typed into a column get — rather
 *  than a flat Schedule for everything, which would file a P0 due tomorrow
 *  beside a thought somebody had. */
function resolveBox(l: Line): Quadrant | null {
  if (l.box !== 'auto') return l.box
  return placementForNew({ dueDate: l.due || undefined, priority: l.priority || undefined })
}

/** What one line of typing becomes: a bullet, a number or a checkbox in front
 *  of it is how people write notes, and none of it belongs in a task title. */
export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^\s*(?:[-*•–—]|\d+[.)]|\[\s?[xX]?\s?\])\s*/, '').trim())
    .filter(Boolean)
}

function blank(title: string): Line {
  return { key: crypto.randomUUID(), title, box: 'auto', due: '', ownerId: '', priority: '' }
}

const Q_OPTIONS: { value: Quadrant | null; label: string; color: string }[] = [
  { value: 'do',        label: 'Do',        color: 'var(--sb-negative)' },
  { value: 'schedule',  label: 'Schedule',  color: 'var(--sb-info)' },
  { value: 'delegate',  label: 'Delegate',  color: 'var(--sb-positive)' },
  { value: 'eliminate', label: 'Eliminate', color: 'var(--sb-ink-4)' },
  { value: null,        label: 'Inbox',     color: 'var(--sb-info)' },
]

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']

const FIELD: React.CSSProperties = {
  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-sm)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)',
  padding: '6px 9px', outline: 'none', fontFamily: 'inherit',
}

const LABEL: React.CSSProperties = {
  display: 'block', marginBottom: 4,
  fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
}

const EYEBROW: React.CSSProperties = {
  margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em',
  color: 'var(--sb-ink-3)', textTransform: 'uppercase',
}

// ─── One output, and its settings ────────────────────────────────────────────

function LineRow({ line, index, expanded, users, onToggle, onChange, onRemove }: {
  line: Line
  index: number
  expanded: boolean
  users: Users
  onToggle: () => void
  onChange: (patch: Partial<Line>) => void
  onRemove: () => void
}) {
  const owner = line.ownerId ? users.find(u => u.id === line.ownerId) : undefined
  const chosen = resolveBox(line)
  const box = Q_OPTIONS.find(o => o.value === chosen)
  const multi = users.some(u => u.companyId !== users[0]?.companyId)

  return (
    <div style={{
      borderRadius: 'var(--sb-r-nav)',
      border: `var(--sb-border-width) solid ${expanded ? 'var(--sb-ink-3)' : 'var(--sb-border)'}`,
      background: expanded ? 'var(--sb-field)' : 'var(--sb-card)',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px' }}>
        <span style={{
          width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
          background: 'var(--sb-field)', fontSize: 'var(--sb-t-micro)', fontWeight: 700,
          color: 'var(--sb-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{index + 1}</span>

        <input
          value={line.title}
          onChange={e => onChange({ title: e.target.value })}
          aria-label={`What ${index + 1} is`}
          placeholder="What has to happen"
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', fontWeight: 500,
          }} />

        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          {box && (
            <span style={{
              fontSize: 'var(--sb-t-micro)', padding: '1px 7px', borderRadius: 'var(--sb-r-chip)',
              fontWeight: 600, background: alpha(box.color, 9.4), color: box.color,
            }}>{box.label}</span>
          )}
          {line.priority && (
            <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', fontWeight: 700 }}>{line.priority}</span>
          )}
          {line.due && (
            <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
              {new Date(line.due + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {owner && (
            <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-positive)', fontWeight: 500 }}>
              → {owner.name.split(' ')[0]}
            </span>
          )}
        </div>

        <button
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide the settings for line ${index + 1}` : `Settings for line ${index + 1}`}
          title={expanded ? 'Hide the settings' : 'Box, date, owner, priority'}
          style={{
            width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', flexShrink: 0, padding: 0,
          }}>
          {expanded ? <ChevronUp size={ICON.sm} /> : <ChevronDown size={ICON.sm} />}
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '0 11px 11px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={LABEL}>
              Eisenhower box{line.box === 'auto' ? ' · from the date and priority until you pick one' : ''}
            </span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {Q_OPTIONS.map(opt => {
                const active = chosen === opt.value
                return (
                  <button
                    key={String(opt.value)}
                    onClick={() => onChange({ box: opt.value })}
                    aria-pressed={active}
                    style={{
                      padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)',
                      fontWeight: active ? 700 : 500, cursor: 'pointer',
                      background: active ? alpha(opt.color, 13.3) : 'transparent',
                      border: `var(--sb-border-width) solid ${active ? opt.color : 'var(--sb-border)'}`,
                      color: active ? opt.color : 'var(--sb-ink-3)', fontFamily: 'inherit',
                    }}>{opt.label}</button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
            <label>
              <span style={LABEL}>Due</span>
              <input type="date" value={line.due} onChange={e => onChange({ due: e.target.value })}
                style={{ ...FIELD, width: '100%', boxSizing: 'border-box' }} />
            </label>
            <label>
              <span style={LABEL}>Priority</span>
              <select value={line.priority} onChange={e => onChange({ priority: e.target.value as Priority | '' })}
                style={{ ...FIELD, width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}>
                <option value="">— none —</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              <span style={LABEL}>Owner</span>
              <select value={line.ownerId} onChange={e => onChange({ ownerId: e.target.value })}
                style={{ ...FIELD, width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}>
                <option value="">— unassigned —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}{multi ? ` · ${u.companyName}` : ''}</option>
                ))}
              </select>
            </label>
          </div>

          <button
            onClick={onRemove}
            aria-label={`Remove "${line.title.trim() || `line ${index + 1}`}"`}
            style={{
              alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)',
              borderRadius: 'var(--sb-r-chip)', padding: '4px 10px', color: 'var(--sb-ink-3)',
              fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <Trash2 size={ICON.sm} /> Remove
          </button>
        </div>
      )}
    </div>
  )
}

// ─── The prompt ──────────────────────────────────────────────────────────────

export function MeetingOutcome({ event, onClose, onFollowUp }: {
  event: OutcomeEvent
  onClose: () => void
  /** Hand the next meeting to the calendar's own composer. Absent, the action
   *  is not offered rather than drawn and dead. */
  onFollowUp?: (ev: OutcomeEvent) => void
}) {
  const addTasksBatch = useTaskStore(s => s.addTasksBatch)
  const co = useMemo(() => companyForCalendar(event.calendarId), [event.calendarId])
  const users = useMemo(() => {
    const all = getVisibleUsers()
    const mine = co ? all.filter(u => u.companyId === co.id) : []
    return mine.length ? mine : all
  }, [co])

  const [text, setText] = useState('')
  const [lines, setLines] = useState<Line[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typed = linesOf(text)
  /** What would be written if it were saved right now, from whichever phase. */
  const ready = (lines ?? typed.map(blank)).filter(l => l.title.trim())

  function review(from?: Line[]) {
    setLines(from ?? typed.map(blank))
    setExpanded(null)
  }

  async function extract() {
    if (!text.trim()) return
    setBusy(true); setError(null)
    try {
      const out = await breakdownMeetingNotes(text, event.title, co ? [co] : loadDynamicCompanies())
      // The model's own guesses, each still a line you can change. A name it
      // names is matched to a person; one it invents matches nobody and the
      // row simply stays unassigned.
      review(out.map(t => {
        const matched = t.ownerName
          ? users.find(u => u.name.toLowerCase().includes(t.ownerName!.toLowerCase()))
          : undefined
        return {
          ...blank(t.title),
          box: t.quadrant ? (t.quadrant as Quadrant) : 'auto',
          due: t.dueDate ?? '',
          ownerId: matched?.id ?? '',
        }
      }))
    } catch (e) {
      // The lines are still in the box. An extractor that cannot be reached is
      // not a reason you cannot write down what was agreed.
      setError(e instanceof Error ? e.message : 'Could not read the notes.')
    } finally {
      setBusy(false)
    }
  }

  /** Writes whatever is there, from either phase, and says what it did. */
  function commit(): number {
    if (!ready.length) return 0
    addTasksBatch(ready.map(l => {
      return {
        title: l.title.trim(),
        description: `From "${event.title}"${event.when ? ` · ${event.when}` : ''}`,
        // The box the person picked, or the app's own answer for a task made
        // on purpose — the pill they were looking at said which.
        quadrant: resolveBox(l),
        company: (co?.id ?? 'personal') as Task['company'],
        ...(co?.id ? { companyId: co.id } : {}),
        status: 'open' as const,
        completed: false,
        ...(l.due ? { dueDate: l.due } : {}),
        ...(l.ownerId ? { owner: l.ownerId } : {}),
        ...(l.priority ? { priority: l.priority } : {}),
        // The meeting it came out of, which is a link and never `gcalEventId`:
        // that field means "the event this task made", and writing it here
        // would hand this task the meeting's hour — ticking one would finish
        // the other.
        ...(event.htmlLink ? { links: [event.htmlLink] } : {}),
      }
    }))
    notify(`${ready.length} ${ready.length === 1 ? 'task' : 'tasks'} from "${event.title}"`)
    return ready.length
  }

  function save() { commit(); onClose() }

  function next() {
    commit()
    onClose()
    onFollowUp?.(event)
  }

  function dismiss() {
    if (ready.length) notify(`Left ${ready.length} ${ready.length === 1 ? 'line' : 'lines'} unsaved`)
    onClose()
  }

  const reviewing = lines !== null

  // Escape and ⌘↵ belong to the topmost thing on screen, and this is it. In
  // **capture**, so the calendar's own Escape — which closes the event panel
  // underneath — does not act on the same press: a capture listener on the
  // document runs before a bubble-phase one, and the press stops here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); e.stopPropagation()
        if (reviewing) save(); else if (typed.length) review()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }) // every render: `dismiss`/`save` close over the lines as they are now

  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) dismiss() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'var(--sb-scrim)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
      <div
        className="sb-meeting-outcome"
        role="dialog"
        aria-modal="true"
        aria-label={`What came out of ${event.title}`}
        style={{
          width: 560, maxWidth: '100%', maxHeight: '86vh', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-menu)',
        }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 11, padding: '16px 18px 14px',
          borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
        }}>
          <div style={{
            width: 'var(--sb-h-pill)', height: 'var(--sb-h-pill)', borderRadius: 'var(--sb-r-nav)', flexShrink: 0,
            background: 'var(--sb-positive-tint)',
            border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-positive) 20%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Check size={ICON.md} color="var(--sb-positive)" strokeWidth={STROKE.active} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
              color: 'var(--sb-ink-1)', letterSpacing: '-0.02em',
            }}>What came out of it?</p>
            <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
              “{event.title}” is done{event.when ? ` · ${event.when}` : ''}
              {co ? ` · ${co.name}` : ''}
            </p>
          </div>
          <button
            onClick={dismiss}
            title="Nothing to record"
            aria-label="Close without recording anything"
            style={{
              width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
            }}>
            <X size={ICON.sm} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px 18px' }}>
          {!reviewing ? (
            <>
              <p style={EYEBROW}>Outputs</p>
              <p style={{ margin: '7px 0 8px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
                One line, one task. Each gets its own box, date, owner and priority on the next step.
              </p>
              <textarea
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                aria-label="The outputs of the meeting, one per line"
                placeholder={'Send Ali the API proposal\nBook the Q3 metrics deep dive\nJohn to update the deck'}
                style={{
                  width: '100%', minHeight: 132, resize: 'vertical', boxSizing: 'border-box',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  borderRadius: 'var(--sb-r-sm)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)',
                  padding: '9px 11px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.55,
                }} />
              <p style={{ margin: '6px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                {typed.length === 0
                  ? '⌘↵ to review · pasted notes can be read for you below'
                  : `${typed.length} ${typed.length === 1 ? 'line' : 'lines'} · ⌘↵ to review them`}
              </p>
              {error && (
                <p style={{
                  margin: '9px 0 0', padding: '8px 11px', borderRadius: 'var(--sb-r-sm)',
                  background: 'var(--sb-negative-tint)',
                  border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 25%, transparent)',
                  color: 'var(--sb-negative-deep)', fontSize: 'var(--sb-t-meta)', lineHeight: 1.45,
                }}>
                  {error} Your lines are still here — Review them keeps every one.
                </p>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                <p style={EYEBROW}>{ready.length} {ready.length === 1 ? 'task' : 'tasks'}</p>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => { setLines(null); setError(null) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', textDecoration: 'underline', fontFamily: 'inherit',
                  }}>← Back to the lines</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(lines ?? []).map((l, i) => (
                  <LineRow
                    key={l.key}
                    line={l} index={i} users={users}
                    expanded={expanded === l.key}
                    onToggle={() => setExpanded(expanded === l.key ? null : l.key)}
                    onChange={patch => setLines(prev => (prev ?? []).map(x => x.key === l.key ? { ...x, ...patch } : x))}
                    onRemove={() => {
                      setLines(prev => (prev ?? []).filter(x => x.key !== l.key))
                      if (expanded === l.key) setExpanded(null)
                    }} />
                ))}
                <button
                  onClick={() => {
                    const add = blank('')
                    setLines(prev => [...(prev ?? []), add])
                    setExpanded(add.key)
                  }}
                  style={{
                    alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                    fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', fontFamily: 'inherit',
                  }}>
                  <Plus size={ICON.sm} /> One more
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px',
          borderTop: 'var(--sb-border-width) solid var(--sb-border)', flexWrap: 'wrap',
        }}>
          <button
            onClick={dismiss}
            style={{
              height: 'var(--sb-h-pill)', padding: '0 14px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit',
            }}>
            {ready.length ? 'Discard them' : 'Nothing came out of it'}
          </button>
          <span style={{ flex: 1 }} />

          {onFollowUp && (
            <Button
              variant="secondary"
              onClick={next}
              title={ready.length
                ? 'Saves these, then opens the next meeting with the same people'
                : 'Opens the next meeting with the same people and calendar'}>
              <CalendarPlus size={ICON.sm} /> Next meeting
            </Button>
          )}

          {!reviewing && (
            <Button
              variant="secondary"
              onClick={() => void extract()}
              disabled={busy || !text.trim()}
              title="Reads pasted notes and fills the lines in — your typing is kept either way">
              <Sparkles size={ICON.sm} /> {busy ? 'Reading…' : 'Read my notes'}
            </Button>
          )}

          {reviewing ? (
            <Button variant="primary" onClick={save} disabled={!ready.length}>
              <Check size={ICON.sm} strokeWidth={STROKE.active} />
              Save {ready.length || ''} {ready.length === 1 ? 'task' : 'tasks'}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => review()} disabled={!typed.length}>
              Review {typed.length || ''} {typed.length === 1 ? 'task' : 'tasks'}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Wraps marking an event done. Call `askAboutOutcome(ev)` right **after** the
 *  status is written — never instead of it — and render `outcomePrompt` in the
 *  same component. */
export function useMeetingOutcome(onFollowUp?: (ev: OutcomeEvent) => void) {
  const [pending, setPending] = useState<OutcomeEvent | null>(null)

  const outcomePrompt = pending ? (
    <MeetingOutcome
      event={pending}
      onClose={() => setPending(null)}
      onFollowUp={onFollowUp ? ev => { setPending(null); onFollowUp(ev) } : undefined} />
  ) : null

  return { askAboutOutcome: (ev: OutcomeEvent) => setPending(ev), outcomePrompt }
}
