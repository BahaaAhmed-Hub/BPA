// ─── What came out of the meeting ────────────────────────────────────────────
//
// A meeting that is over leaves things behind: work somebody now owes, money
// spent, a habit that counted, a page read, the next meeting. Marking the block
// done recorded none of it — the hour greyed out and whatever was agreed in it
// stayed in your head until you remembered to type it somewhere else.
//
// This is one window with a box per kind. A box opens **in place** and shows
// what is already related to this meeting, with the tools to tick it, change
// it, or add something new — and nothing here opens another panel, because a
// panel would take the window, and with it the rest of what you were filing.
//
// Four rules hold this file together:
//
// **The event is already done when this opens.** It is not a gate. The project
// has made the other mistake once already — `DeliverablePrompt` stood between
// a tick and the task, and dismissing it left the task open with nothing on
// screen to say the gesture had been dropped. So the status is written first
// and this asks afterwards: closing it costs nothing, because there is nothing
// to lose.
//
// **Everything writes as you go.** There is no Save and no draft state of the
// window itself. Each action goes straight to its module the way an edit in the
// event panel does, and each one can be taken back on its own row. The old
// two-step — type lines, review them, save — held work in a form that vanished
// when it closed.
//
// **Every record keeps the thread back to this meeting** (`meetingOutcomes.ts`)
// — the ones made here and the old ones ticked or edited here. That list is
// what the meeting reads to say what it produced, and what a task reads to say
// where it came from.
//
// **A line is a task with no model involved.** Reading notes is an accelerator
// beside typing, which can fail without taking the form with it.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Check, CalendarPlus, CheckSquare, Link as LinkIcon, Pencil } from 'lucide-react'
import { Button } from '@/components/ui'
import { breakdownMeetingNotes, type ExtractedTask } from '@/lib/professor'
import { useTaskStore } from '@/store/taskStore'
import { notify } from '@/lib/undo'
import { placementForNew } from '@/modules/tasks/BrainDumpRail'
import { loadDynamicCompanies, getVisibleUsers, isOpenTask } from '@/types'
import type { DynamicCompany, Priority, Task } from '@/types'
import { ICON, STROKE } from '@/lib/type'
import { useInkOn } from '@/lib/ink'
import { cachedCalendar } from '@/lib/taskCalendar'
import { loadAccounts } from '@/lib/multiAccount'
import LinkPreviews from '../../components/LinkPreviews'
import {
  addOutcomeLink, removeOutcomeLink, linksForEvent, linksForRecord, subscribeOutcomeLinks,
} from '@/lib/meetingOutcomes'
import {
  OutcomeBox, EYEBROW, FIELD, chip, ymd, fromYmd, initialsOf,
  type OutcomeEvent, type OutcomeCalendarPort,
} from './outcome/shared'

import { ExpensesBox } from './outcome/ExpensesBox'
import { HabitsBox } from './outcome/HabitsBox'
import { BooksBox } from './outcome/BooksBox'
import { EventsBox } from './outcome/EventsBox'

export type { OutcomeEvent }

type Users = ReturnType<typeof getVisibleUsers>

/** Whose meeting this was. The inverse of `resolveTaskCalendar`'s company →
 *  calendar step, and the only honest one there is: a calendar nobody has
 *  claimed belongs to no company, and a guess here files a client's work under
 *  the wrong name. */
export function companyForCalendar(calendarId: string | undefined): DynamicCompany | undefined {
  if (!calendarId) return undefined
  const companies = loadDynamicCompanies().filter(c => !c.hidden)
  const claimed = companies.find(c => c.calendarId === calendarId)
  if (claimed) return claimed
  // Not claimed by calendar, but the calendar sits on an account that exactly
  // one company is bound to: the meeting is that company's. Two companies on one
  // account is a question the calendar cannot answer, so it stays unanswered.
  const email = cachedCalendar(calendarId)?.accountEmail.toLowerCase()
  const acct = email ? loadAccounts().find(a => !a.isPrimary && a.email?.toLowerCase() === email) : undefined
  const onAccount = acct ? companies.filter(c => c.accountId === acct.id) : []
  return onAccount.length === 1 ? onAccount[0] : undefined
}

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']

/** Whether a task is this company's. A company made since the four legacy tags
 *  is `companyId`; one of the legacy four is the `company` tag alone and has no
 *  `companyId` at all — the server stores both in the same column — so asking
 *  only the first would find nothing for Teradix, which is the one most people
 *  have. */
const belongsTo = (t: Task, co: DynamicCompany) => t.companyId === co.id || (!t.companyId && t.company === co.id)

/** Today, tomorrow and the next Monday — the three days a follow-up is usually
 *  wanted on. Anything else is the date field beside them. */
function dueChips(): { label: string; value: string }[] {
  const now = new Date()
  const tomorrow = new Date(now.getTime() + 86400000)
  const toMonday = ((8 - now.getDay()) % 7) || 7
  const monday = new Date(now.getTime() + toMonday * 86400000)
  return [
    { label: 'Today', value: ymd(now) },
    { label: 'Tomorrow', value: ymd(tomorrow) },
    { label: monday.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }), value: ymd(monday) },
  ]
}

function dueLabel(due: string | undefined): string {
  if (!due) return ''
  const today = ymd(new Date())
  if (due === today) return 'Today'
  if (due === ymd(new Date(Date.now() + 86400000))) return 'Tomorrow'
  return fromYmd(due).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** What a task made from this meeting carries. The meeting it came out of is a
 *  link and never `gcalEventId`: that field means "the event this task made",
 *  and writing it here would hand the task the meeting's hour — ticking one
 *  would then finish the other. */
function taskFor(event: OutcomeEvent, co: DynamicCompany | undefined, t: {
  title: string; due?: string; ownerId?: string; priority?: Priority | ''; box?: Task['quadrant']
}): Omit<Task, 'id' | 'createdAt'> {
  return {
    title: t.title.trim(),
    description: `From "${event.title}"${event.when ? ` · ${event.when}` : ''}`,
    // The app's own answer for a task made on purpose: no date is Do, a date is
    // Schedule. The same call the header's New task makes.
    quadrant: t.box ?? placementForNew({ dueDate: t.due || undefined, priority: t.priority || undefined }),
    company: (co?.id ?? 'personal') as Task['company'],
    ...(co?.id ? { companyId: co.id } : {}),
    // The meeting's own calendar, so the task is written to the same calendar
    // and account the meeting was on — not to whichever default applies. Only
    // when it can be written to: a task pointed at a read-only calendar would be
    // refused by Google the moment it was scheduled.
    ...(event.calendarId && cachedCalendar(event.calendarId)?.writable ? { calendarId: event.calendarId } : {}),
    status: 'open' as const,
    completed: false,
    ...(t.due ? { dueDate: t.due } : {}),
    ...(t.ownerId ? { owner: t.ownerId } : {}),
    ...(t.priority ? { priority: t.priority } : {}),
    ...(event.htmlLink ? { links: [event.htmlLink] } : {}),
  }
}

function TaskRow({ task, users, linkedHere, editing, madeHere, onTick, onEdit, onUndoMade, onTouch }: {
  task: Task
  users: Users
  linkedHere: boolean
  editing: boolean
  madeHere: boolean
  onTick: () => void
  onEdit: () => void
  onUndoMade: () => void
  /** A change made to this task in the window — it is part of the meeting now. */
  onTouch: () => void
}) {
  const updateTask = useTaskStore(s => s.updateTask)
  const done = task.completed || task.status === 'done'
  const owner = users.find(u => u.id === task.owner)
  const elsewhere = linksForRecord('task', task.id)[0]
  const meta = [dueLabel(task.dueDate), owner?.name, task.priority].filter(Boolean).join(' · ')

  const patch = (p: Partial<Task>) => { updateTask(task.id, p); onTouch() }

  return (
    <div
      data-outcome-task={task.id}
      data-done={done ? '1' : '0'}
      data-editing={editing ? '1' : '0'}
      style={{
        borderRadius: 'var(--sb-r-nav)', background: done ? 'var(--sb-positive-tint)' : 'var(--sb-card)',
        border: `var(--sb-border-width) solid ${editing ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
        padding: '0 12px', display: 'flex', flexDirection: 'column',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52 }}>
        <button
          onClick={onTick}
          role="checkbox"
          aria-checked={done}
          aria-label={`${done ? 'Reopen' : 'Mark done'}: ${task.title}`}
          style={{
            width: 24, height: 24, borderRadius: 7, flexShrink: 0, padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: done ? 'var(--sb-positive)' : 'transparent',
            border: done ? 'none' : '2px solid var(--sb-ink-3)',
            color: 'var(--sb-ink-on-fill)',
          }}>
          {done && <Check size={14} strokeWidth={3} />}
        </button>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body)', color: done ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)',
          fontWeight: editing ? 600 : 400, textDecoration: done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{task.title}</span>
        {done && linkedHere && (
          <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-positive-deep)' }}>Done · linked</span>
        )}
        {!done && meta && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{meta}</span>}
        {linkedHere ? (
          <span title="Linked to this meeting" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-meta)', fontWeight: 600,
            color: 'var(--sb-ink-1)', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-pill)', padding: '3px 9px',
          }}><LinkIcon size={12} />this meeting</span>
        ) : elsewhere ? (
          <span style={{
            fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', background: 'var(--sb-field)',
            borderRadius: 'var(--sb-r-pill)', padding: '3px 9px', maxWidth: 150, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>from {elsewhere.eventTitle}</span>
        ) : null}
        {madeHere && (
          <button onClick={onUndoMade} style={chip()}>Undo</button>
        )}
        {done && !madeHere && (
          <button onClick={onTick} style={chip()}>Undo</button>
        )}
        {!done && (
          <button onClick={onEdit} aria-label={`${editing ? 'Close' : 'Edit'} ${task.title}`} aria-expanded={editing}
            style={{ ...chip(editing), width: 36, padding: 0, justifyContent: 'center' }}>
            <Pencil size={ICON.sm} />
          </button>
        )}
      </div>

      {editing && !done && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0 12px' }}>
          <input
            aria-label="Task title"
            value={task.title}
            onChange={e => patch({ title: e.target.value })}
            style={{ ...FIELD, width: '100%', fontWeight: 600 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', width: 48 }}>Due</span>
            {dueChips().map(c => (
              <button key={c.value} onClick={() => patch({ dueDate: task.dueDate === c.value ? undefined : c.value })}
                aria-pressed={task.dueDate === c.value} style={chip(task.dueDate === c.value)}>{c.label}</button>
            ))}
            <input
              type="date" aria-label="Pick a due date"
              value={task.dueDate ?? ''}
              onChange={e => patch({ dueDate: e.target.value || undefined })}
              style={{ ...FIELD, height: 36, fontSize: 'var(--sb-t-meta)', borderRadius: 'var(--sb-r-pill)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', width: 48 }}>Owner</span>
            {users.slice(0, 5).map(u => (
              <button key={u.id} onClick={() => patch({ owner: task.owner === u.id ? undefined : u.id })}
                aria-pressed={task.owner === u.id} aria-label={u.name} style={{ ...chip(task.owner === u.id), paddingLeft: 6 }}>
                <span style={{
                  width: 24, height: 24, borderRadius: '50%', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)',
                }}>{initialsOf(u.name)}</span>{u.name.split(' ')[0]}
              </button>
            ))}
            {users.length === 0 && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>No one is set up on this company yet.</span>}
            <span style={{ width: 1, height: 22, background: 'var(--sb-border)', margin: '0 6px' }} />
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Priority</span>
            <span style={{ display: 'inline-flex', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-pill)', overflow: 'hidden' }}>
              {PRIORITIES.map(p => (
                <button key={p} onClick={() => patch({ priority: task.priority === p ? undefined : p })}
                  aria-pressed={task.priority === p}
                  style={{
                    height: 34, width: 42, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 'var(--sb-t-meta)', fontWeight: 600,
                    background: task.priority === p ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                    color: task.priority === p ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-2)',
                  }}>{p}</button>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function TasksBox({ event, co, users, open, onToggle, suggestions, onDismissSuggestion, onAddSuggestion, pasteOpen, notes, onNotes, onRead, busy, error }: {
  event: OutcomeEvent
  co: DynamicCompany | undefined
  users: Users
  open: boolean
  onToggle: () => void
  suggestions: ExtractedTask[]
  onDismissSuggestion: (i: number) => void
  onAddSuggestion: (i: number) => void
  pasteOpen: boolean
  notes: string
  onNotes: (v: string) => void
  onRead: () => void
  busy: boolean
  error: string | null
}) {
  const tasks = useTaskStore(s => s.tasks)
  const toggleComplete = useTaskStore(s => s.toggleComplete)
  const addTask = useTaskStore(s => s.addTask)
  const deleteTask = useTaskStore(s => s.deleteTask)

  // Re-read the thread when it changes, here or on another tab.
  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])

  const [editing, setEditing] = useState<string | null>(null)
  /** Tasks this window added — their Undo takes the task away rather than
   *  reopening it. Session-only: a record made last time is plain work now. */
  const [madeHere, setMadeHere] = useState<Set<string>>(new Set())

  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [ownerId, setOwnerId] = useState('')

  const linked = linksForEvent(event.id, 'task')
  const linkedIds = new Set(linked.map(l => l.recordId))
  const madeCount = linked.filter(l => l.role === 'made').length
  const touchedCount = linked.filter(l => l.role === 'touched').length

  // **One list, in an order that does not depend on what you just did.** Linked
  // rows used to be drawn first, in their own array — so ticking a task moved it
  // from one array to the other, React remounted it, and focus fell out of the
  // document: a keyboard user ticked a box and lost their place. Date order does
  // not change when a task is ticked, so the row stays where it is.
  const rows = useMemo(() => {
    const byDue = (a: Task, b: Task) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt)
    const here = tasks.filter(t => linkedIds.has(t.id))
    // What is open for the same company and not yet part of this meeting — the
    // work this meeting is most likely to have moved.
    const related = co
      ? tasks.filter(t => !linkedIds.has(t.id) && belongsTo(t, co) && isOpenTask(t)).sort(byDue).slice(0, 6)
      : []
    return [...here, ...related].sort(byDue)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, linked.map(l => l.recordId).join(',')])

  const link = (id: string, role: 'made' | 'touched') =>
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, eventDate: event.date, kind: 'task', recordId: id, role })

  function tick(t: Task) {
    const wasLinked = linkedIds.has(t.id)
    const wasDone = t.completed || t.status === 'done'
    toggleComplete(t.id)
    if (!wasDone) { if (!wasLinked) link(t.id, 'touched') }
    else {
      // Undoing a tick this window made also takes the link it made; an old
      // link (the task was made here) stays — the task still came from here.
      const l = linked.find(x => x.recordId === t.id)
      if (l?.role === 'touched') removeOutcomeLink(event.id, 'task', t.id)
    }
  }

  function add(fields: { title: string; due?: string; ownerId?: string; priority?: Priority | '' }) {
    if (!fields.title.trim()) return
    const id = addTask(taskFor(event, co, fields))
    link(id, 'made')
    setMadeHere(prev => new Set(prev).add(id))
  }

  function undoMade(t: Task) {
    deleteTask(t.id)
    removeOutcomeLink(event.id, 'task', t.id)
    setMadeHere(prev => { const n = new Set(prev); n.delete(t.id); return n })
    if (editing === t.id) setEditing(null)
  }

  const summary = [
    `${rows.length} related`,
    touchedCount ? `${touchedCount} ticked or edited` : '',
    madeCount ? `${madeCount} added here` : '',
  ].filter(Boolean).join(' · ')

  const rowProps = (t: Task) => ({
    task: t, users,
    linkedHere: linkedIds.has(t.id),
    editing: editing === t.id,
    madeHere: madeHere.has(t.id),
    onTick: () => tick(t),
    onEdit: () => setEditing(editing === t.id ? null : t.id),
    onUndoMade: () => undoMade(t),
    onTouch: () => { if (!linkedIds.has(t.id)) link(t.id, 'touched') },
  })

  return (
    <OutcomeBox
      id="tasks" icon={<CheckSquare size={ICON.lg} />} title="Tasks" summary={summary}
      open={open} onToggle={onToggle} tint="var(--sb-ink-1)">

      {pasteOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={EYEBROW}>Notes to read</p>
          <textarea
            value={notes}
            onChange={e => onNotes(e.target.value)}
            aria-label="Meeting notes to read"
            placeholder={'Paste the notes — action items are pulled out for you to add'}
            style={{ ...FIELD, height: 'auto', minHeight: 96, padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
          <LinkPreviews text={notes} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="secondary" onClick={onRead} disabled={busy || !notes.trim()}>
              <Sparkles size={ICON.sm} /> {busy ? 'Reading…' : 'Read these notes'}
            </Button>
            {error && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{error} You can still add tasks by hand below.</span>}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <p style={EYEBROW}>{co ? `Open for ${co.name}` : 'Linked to this meeting'}</p>
      )}
      {rows.map(t => <TaskRow key={t.id} {...rowProps(t)} />)}
      {rows.length === 0 && (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          Nothing open yet{co ? ` for ${co.name}` : ''}. Add what this meeting asked for below.
        </p>
      )}

      {suggestions.map((s, i) => (
        <div key={`${s.title}-${i}`} data-outcome-suggestion style={{
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '0 12px',
          border: 'var(--sb-border-width) dashed var(--sb-border-strong, var(--sb-border))',
          borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)',
        }}>
          <Sparkles size={ICON.md} color="var(--sb-ink-3)" />
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
            <b style={{ color: 'var(--sb-ink-1)' }}>From your notes:</b> {s.title}
          </span>
          <button onClick={() => onDismissSuggestion(i)} aria-label={`Dismiss: ${s.title}`}
            style={{ ...chip(), width: 36, padding: 0, justifyContent: 'center' }}><X size={ICON.sm} /></button>
          <button onClick={() => onAddSuggestion(i)} style={{ ...chip(), background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)', border: 'none', fontWeight: 700 }}>Add</button>
        </div>
      ))}

      {/* Quick add */}
      <form
        onSubmit={e => {
          e.preventDefault()
          add({ title, due, ownerId })
          setTitle(''); setDue(''); setOwnerId('')
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
        <input
          aria-label="Add a task from this meeting"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Add a task from this meeting…"
          style={{ ...FIELD, flex: '1 1 220px', height: 48, borderRadius: 'var(--sb-r-nav)' }} />
        <input
          type="date" aria-label="Due date for the new task"
          value={due} onChange={e => setDue(e.target.value)}
          style={{ ...FIELD, height: 48, width: 150, borderRadius: 'var(--sb-r-nav)' }} />
        <select
          aria-label="Owner of the new task"
          value={ownerId} onChange={e => setOwnerId(e.target.value)}
          style={{ ...FIELD, height: 48, width: 130, borderRadius: 'var(--sb-r-nav)' }}>
          <option value="">Owner</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button type="submit" disabled={!title.trim()} style={{
          height: 48, padding: '0 18px', borderRadius: 'var(--sb-r-nav)', border: 'none', fontFamily: 'inherit',
          fontSize: 'var(--sb-t-body-s)', fontWeight: 700, cursor: title.trim() ? 'pointer' : 'default',
          background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', opacity: title.trim() ? 1 : 0.45,
        }}>Add</button>
      </form>
    </OutcomeBox>
  )
}

// ─── The window ──────────────────────────────────────────────────────────────

export function MeetingOutcome({ event, onClose, onFollowUp, calendar }: {
  event: OutcomeEvent
  onClose: () => void
  /** What the window may ask of the calendar. Absent, the Events box is not drawn. */
  calendar?: OutcomeCalendarPort
  /** Hand the next meeting to the calendar's own composer. Absent, the action
   *  is not offered rather than drawn and dead. */
  onFollowUp?: (ev: OutcomeEvent) => void
}) {
  const addTask = useTaskStore(s => s.addTask)
  const ink = useInkOn()
  const co = useMemo(() => companyForCalendar(event.calendarId), [event.calendarId])
  const users = useMemo(() => {
    const all = getVisibleUsers()
    const mine = co ? all.filter(u => u.companyId === co.id) : []
    return mine.length ? mine : all
  }, [co])

  // Any number of boxes open at once, Tasks to begin with: filing a taxi and
  // ticking a habit are one errand, and an accordion that closed the first to
  // show the second would put away the thing being worked on.
  const [openBoxes, setOpenBoxes] = useState<Set<string>>(() => new Set(['tasks']))
  const isOpen = (id: string) => openBoxes.has(id)
  const toggleBox = (id: string) => setOpenBoxes(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const showBox = (id: string) => setOpenBoxes(prev => new Set(prev).add(id))

  // Reading notes: what the model finds is offered as dashed rows inside the
  // box it belongs to, never written until you say Add.
  const [notes, setNotes] = useState(event.notes ?? '')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<ExtractedTask[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])
  const linkedCount = linksForEvent(event.id).length

  async function readNotes() {
    if (!notes.trim()) { setPasteOpen(true); showBox('tasks'); return }
    setBusy(true); setError(null); showBox('tasks')
    try {
      const out = await breakdownMeetingNotes(notes, event.title, co ? [co] : loadDynamicCompanies())
      setSuggestions(out)
      if (!out.length) setError('No action items found in those notes.')
    } catch (e) {
      // Nothing is lost: the box still takes typing. An extractor that cannot be
      // reached is not a reason you cannot write down what was agreed.
      setError(e instanceof Error ? e.message : 'Could not read the notes.')
      setPasteOpen(true)
    } finally {
      setBusy(false)
    }
  }

  function addSuggestion(i: number) {
    const s = suggestions[i]
    if (!s) return
    const matched = s.ownerName ? users.find(u => u.name.toLowerCase().includes(s.ownerName!.toLowerCase())) : undefined
    const id = addTask(taskFor(event, co, {
      title: s.title, due: s.dueDate, ownerId: matched?.id,
      box: s.quadrant ?? undefined,
    }))
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, eventDate: event.date, kind: 'task', recordId: id, role: 'made' })
    setSuggestions(prev => prev.filter((_, j) => j !== i))
  }

  function dismiss() {
    if (linkedCount) notify(`${linkedCount} ${linkedCount === 1 ? 'thing' : 'things'} linked to "${event.title}"`)
    onClose()
  }

  function next() {
    onClose()
    onFollowUp?.(event)
  }

  // Escape belongs to the topmost thing on screen, and this is it. In
  // **capture**, so the calendar's own Escape — which closes the event panel
  // underneath — does not act on the same press: a capture listener on the
  // document runs before a bubble-phase one, and the press stops here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }) // every render: `dismiss` closes over the count as it is now

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
          width: 800, maxWidth: '100%', maxHeight: 'calc(92 * var(--vh))', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-frame, 28px)', boxShadow: 'var(--sb-shadow-menu)',
        }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '22px 26px 12px' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 'var(--sb-r-nav)', flexShrink: 0,
            background: 'var(--sb-positive-tint)',
            border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-positive) 20%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Check size={ICON.lg} color="var(--sb-positive)" strokeWidth={STROKE.active} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
              color: 'var(--sb-ink-1)', letterSpacing: '-0.03em',
            }}>What came out of it?</p>
            <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
              “{event.title}” is done{event.when ? ` · ${event.when}` : ''}{co ? ` · ${co.name}` : ''}
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Close"
            style={{
              width: 44, height: 44, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-2)',
            }}>
            <X size={ICON.md} />
          </button>
        </div>

        {/* The thread: said once, here, so it is never a surprise later. */}
        <div style={{
          margin: '0 26px 12px', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-nav)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)',
        }}>
          <LinkIcon size={ICON.md} color="var(--sb-ink-1)" />
          <span style={{ flex: 1 }}>
            Whatever you add or tick here stays <b>linked to this meeting</b>, and shows up on it later.
          </span>
          <span data-outcome-count style={{
            background: 'var(--sb-ink-1)', color: ink('var(--sb-ink-1)'), borderRadius: 'var(--sb-r-pill)',
            padding: '3px 10px', fontWeight: 700, fontSize: 'var(--sb-t-meta)',
          }}>{linkedCount} linked</span>
        </div>

        {/* ── Boxes ──────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 26px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <TasksBox
            event={event} co={co} users={users}
            open={isOpen('tasks')} onToggle={() => toggleBox('tasks')}
            suggestions={suggestions}
            onDismissSuggestion={i => setSuggestions(prev => prev.filter((_, j) => j !== i))}
            onAddSuggestion={addSuggestion}
            pasteOpen={pasteOpen} notes={notes} onNotes={setNotes}
            onRead={() => void readNotes()} busy={busy} error={error} />
          <ExpensesBox
            event={event} co={co}
            open={isOpen('expenses')} onToggle={() => toggleBox('expenses')} />
          <HabitsBox
            event={event}
            open={isOpen('habits')} onToggle={() => toggleBox('habits')} />
          <BooksBox
            event={event}
            open={isOpen('books')} onToggle={() => toggleBox('books')} />
          <EventsBox
            event={event} calendar={calendar}
            open={isOpen('events')} onToggle={() => toggleBox('events')}
            onFullForm={onFollowUp ? next : undefined} />
        </div>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px 18px', flexWrap: 'wrap',
          borderTop: 'var(--sb-border-width) solid var(--sb-border)',
        }}>
          <Button variant="secondary" onClick={() => void readNotes()} disabled={busy}
            title="Reads this meeting's notes, or the ones you paste, and offers the action items">
            <Sparkles size={ICON.sm} /> {busy ? 'Reading…' : 'Read my notes'}
          </Button>
          {/* The Events box schedules the next one in place; this stays only for a
              window that was given no calendar to ask, so the way to a next
              meeting is never lost. */}
          {onFollowUp && !calendar && (
            <Button variant="secondary" onClick={next} title="Opens the next meeting with the same people and calendar">
              <CalendarPlus size={ICON.sm} /> Next meeting
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Saved as you go</span>
          <Button variant="primary" onClick={dismiss}>
            {linkedCount ? `Done · ${linkedCount} linked` : 'Nothing came out of it'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Wraps marking an event done. Call `askAboutOutcome(ev)` right **after** the
 *  status is written — never instead of it — and render `outcomePrompt` in the
 *  same component. */
export function useMeetingOutcome(onFollowUp?: (ev: OutcomeEvent) => void, calendar?: OutcomeCalendarPort) {
  const [pending, setPending] = useState<OutcomeEvent | null>(null)

  const outcomePrompt = pending ? (
    <MeetingOutcome
      event={pending}
      onClose={() => setPending(null)}
      calendar={calendar}
      onFollowUp={onFollowUp ? ev => { setPending(null); onFollowUp(ev) } : undefined} />
  ) : null

  return { askAboutOutcome: (ev: OutcomeEvent) => setPending(ev), outcomePrompt }
}
