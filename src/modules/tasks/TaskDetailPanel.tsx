// ─── 9D task detail panel ────────────────────────────────────────────────────
// A docked right-hand panel, not a centred modal: company pill and controls on
// top, then the title, one row of pickers, the attribute chips, subtasks,
// notes, attachments and the activity log, over a Cancel / Save footer.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Maximize2, ChevronDown, ChevronRight,
  Plus, Link2, Folder, FileText, Image as ImageIcon, CalendarDays, BarChart3, History, Trash2, Check, User, Paperclip,
  ExternalLink, Ban,
} from 'lucide-react'
import type { Task, TaskType, Priority, ChecklistStep, TaskAttachment, TaskActivity } from '@/types'
import { PRIORITY_META, TASK_TYPE_META, getVisibleUsers, loadVisibleCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import { TASK_TYPE_ORDER, initials, resolveTaskVisuals, formatScheduleLabel } from './taskVisuals'
import { scheduleTaskToCalendar } from '@/lib/aiScheduler'
import { resolveTaskCalendar, verifyTaskEvent } from '@/lib/taskCalendar'
import { SchedulePopover } from './SchedulePopover'
import { ICON, STROKE } from '@/lib/type'

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']

// ─── Where a task stands ─────────────────────────────────────────────────────
//
// Two different things are called "status" here and the panel has to show both
// as one control, because to the person reading it there is only one question.
//
//   * **Done / cancelled / open** is the task's own state. It is what a tick
//     sets, what hides it from the board, and what stops it counting.
//   * **The column** is one of your own statuses from Settings — Decide, Today,
//     This week — and it is where the task sits while it is open.
//
// A finished task that gets picked up again has to be able to go back to a
// column, and choosing one is exactly that gesture: it is open again, in that
// column, and its completion date is gone. Nothing else in the app could say
// so — the tick could only toggle, and the board hides what is finished, so a
// task marked done by accident had nowhere to be put back to.
//
// The three states are prefixed so they cannot collide with a status of your
// own called "done".
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function relativeStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const ICON_BTN: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 0,
}

/** One attribute cell: same height and shape in every state, icon then value. */
const CELL: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  height: 34, padding: '0 11px', borderRadius: 'var(--sb-r-sm)', minWidth: 0,
  background: 'var(--sb-field)', border: '1px solid var(--sb-border)',
  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
}

const CELL_VALUE: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/** The native control that actually drives a cell, laid invisibly over it. */
const CELL_INPUT: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0,
}

const SECTION_LABEL: React.CSSProperties = {
  margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)',
}

/** Month grid + start/end, as the artboard's date popover. */

/** Each kind of entry gets its own glyph, so files and links stand out from
 *  the ordinary field edits around them. */
function ActivityIcon({ type }: { type: TaskActivity['type'] }) {
  if (type === 'attachment_added' || type === 'attachment_removed') return <Paperclip size={ICON.sm} />
  if (type === 'link_added' || type === 'link_removed') return <Link2 size={ICON.sm} />
  return <History size={ICON.sm} />
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function TaskDetailPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, deleteTask, activities } = useTaskStore()
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [fullLog, setFullLog] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [activityOpen, setActivityOpen] = useState(true)
  const [dropping, setDropping] = useState(false)
  const [newStep, setNewStep] = useState('')
  const dateRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!datePickerOpen) return
    const h = (e: MouseEvent) => { if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDatePickerOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [datePickerOpen])

  const v = resolveTaskVisuals(task)
  const { TypeIcon } = v
  const companies = loadVisibleCompanies()
  const allUsers = getVisibleUsers()
  const users = task.companyId ? allUsers.filter(u => u.companyId === task.companyId) : allUsers
  const owner = task.owner ? allUsers.find(u => u.id === task.owner) : undefined

  // Your columns, from Settings. Read on every render so renaming one in
  // another tab shows here without a reload.
  const focusOn = useUIStore(s => s.focusOn)
  const finished  = task.completed || task.status === 'done'
  const cancelled = task.status === 'cancelled'

  // ─── Is it actually on the calendar? ───────────────────────────────────────
  //
  // A date on a task is not an event in Google. The board pushes one for a task
  // it puts in Schedule, and that is the only thing that ever did — so a dated
  // task sitting in Do had nothing on the calendar and no way to say so. This
  // row answers the question on the task itself and puts it there on request,
  // whichever quadrant it is in.
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  // Whether the event the task remembers is actually there. A task keeps an
  // id and nothing else, so "on your calendar" was a claim about a string:
  // delete the event in Google, or write it to a calendar you do not display,
  // and the task went on saying it for good. This asks Google.
  const [eventState, setEventState] = useState<'checking' | 'there' | 'gone' | 'unknown'>('unknown')
  const [eventWhen, setEventWhen] = useState<string | null>(null)
  // Which calendar it is aimed at, named on the row. A task carrying a company
  // goes to that company's calendar on that company's account — and when that
  // account has to be reconnected, the failure has to say so rather than the
  // row quietly reading "not on your calendar" forever.
  const calTarget = resolveTaskCalendar(task)
  const calWhere = calTarget.companyName ?? (calTarget.source === 'task' ? 'the chosen calendar' : 'your calendar')

  useEffect(() => {
    let alive = true
    setEventWhen(null)
    if (!task.gcalEventId) { setEventState('unknown'); return }
    setEventState('checking')
    void verifyTaskEvent(task).then(res => {
      if (!alive) return
      setEventState(res.found ? 'there' : 'gone')
      setEventWhen(res.when)
    })
    return () => { alive = false }
  }, [task.id, task.gcalEventId])

  /** Forget the dead id and make it again — the only repair there is. */
  async function remakeEvent() {
    if (pushing) return
    setPushing(true); setPushError(null)
    try {
      const res = await scheduleTaskToCalendar({ ...task, gcalEventId: undefined })
      if (res.success && res.gcalEventId) {
        patch({ gcalEventId: res.gcalEventId })
        setEventState('there')
      } else setPushError(res.error ?? 'Google would not take it.')
    } catch { setPushError('Google would not take it.') }
    finally { setPushing(false) }
  }

  async function pushToCalendar() {
    if (!task.dueDate || pushing) return
    setPushing(true); setPushError(null)
    try {
      const res = await scheduleTaskToCalendar(task)
      if (res.success && res.gcalEventId) patch({ gcalEventId: res.gcalEventId })
      else setPushError(res.error ?? 'Google would not take it.')
    } catch {
      setPushError('Google would not take it.')
    } finally { setPushing(false) }
  }

  function setTaskStatus(value: string) {
    if (value === '__done') {
      patch({ status: 'done', completed: true, completedAt: task.completedAt ?? todayKey() })
    } else if (value === '__cancelled') {
      patch({ status: 'cancelled', completed: false, completedAt: undefined })
    } else if (value === '__open') {
      patch({ status: 'open', completed: false, completedAt: undefined })
    } else {
      // Putting a finished task in a column is how it comes back to life.
      patch({ boardStatus: value, status: 'open', completed: false, completedAt: undefined })
    }
  }

  const checklist = task.checklist ?? []
  const attachments = task.attachments ?? []

  const taskActs = useMemo(
    () => activities.filter(a => a.taskId === task.id).slice().reverse(),
    [activities, task.id],
  )
  const shownActs = fullLog ? taskActs : taskActs.slice(0, 7)

  /** Every edit writes straight to the store, and the panel reads back from it,
   *  so the card behind the panel shows the same thing without a second copy of
   *  the task drifting out of date. */
  function patch(p: Partial<Task>) {
    updateTask(task.id, p)
  }

  function addStep() {
    const text = newStep.trim()
    if (!text) return
    patch({ checklist: [...checklist, { id: crypto.randomUUID(), text, done: false }] })
    setNewStep('')
  }

  function toggleStep(id: string) {
    patch({ checklist: checklist.map(s => (s.id === id ? { ...s, done: !s.done } : s)) })
  }

  function acceptFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const added: TaskAttachment[] = Array.from(files).map(f => ({
      id: crypto.randomUUID(), name: f.name, size: f.size,
      source: 'added here', addedAt: new Date().toISOString(),
    }))
    patch({ attachments: [...attachments, ...added] })
  }

  const linkCount = task.links?.length ?? 0

  // Empty is just the affordance; set spells out the date, the time and how long.
  const scheduleLabel = formatScheduleLabel(task, { long: true }) ?? 'Add a date'

  return (
    <aside style={{
      width: expanded ? 'min(560px, 62vw)' : 'clamp(300px, 32vw, 400px)', flexShrink: 0, alignSelf: 'flex-start',
      maxHeight: 'calc(100vh - 212px)',
      background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
      display: 'flex', flexDirection: 'column', minWidth: 0,
      boxShadow: 'var(--sb-shadow-control)',
    }}>
      {/* ── Top row: company pill + controls ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 0' }}>
        {/* The picker is an invisible select laid over the pill, so it has to be
            the size of the pill. Stretched across the header's spare width it
            was a company picker over the whole top of the panel: a click on the
            empty space beside the label opened it. The outer span takes the
            space and keeps the icons hard right; the inner one hugs the pill. */}
        <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex' }}>
        <span style={{ position: 'relative', display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 12px',
            borderRadius: 'var(--sb-r-pill)', border: `1px solid ${v.companyColor}`, color: v.companyColor,
            fontSize: 'var(--sb-t-body-s)', fontWeight: 600, maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{v.companyName || 'No company'}</span>
          <select
            value={task.companyId ?? ''}
            onChange={e => {
              const co = companies.find(c => c.id === e.target.value)
              patch({ companyId: co?.id, company: (co?.id ?? task.company) as Task['company'], owner: undefined })
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}
          >
            <option value="">No company</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </span>
        </span>

        {/* Finishing something is one gesture, and so is deciding it is not
            finished after all. The cell below says where the task stands; this
            is the button you reach for without reading it. */}
        {/* Where the task stands, as two switches rather than a row of
            buttons in the body: done, or not doing it. Open is neither of them
            being on, which is what "open" means. Its board column is the
            board's business — you move it by dragging it there. */}
        <button
          title={finished ? 'Not done after all — reopen it' : 'Mark it done'}
          aria-pressed={finished}
          onClick={() => setTaskStatus(finished ? '__open' : '__done')}
          style={{
            ...ICON_BTN,
            background: finished ? 'var(--sb-positive)' : 'transparent',
            border: `1px solid ${finished ? 'var(--sb-positive)' : 'var(--sb-border)'}`,
            color: finished ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
          }}>
          <Check size={ICON.md} />
        </button>
        <button
          title={cancelled ? 'Put it back — it is on again' : 'Not doing it'}
          aria-pressed={cancelled}
          onClick={() => setTaskStatus(cancelled ? '__open' : '__cancelled')}
          style={{
            ...ICON_BTN,
            background: cancelled ? 'var(--sb-ink-3)' : 'transparent',
            border: `1px solid ${cancelled ? 'var(--sb-ink-3)' : 'var(--sb-border)'}`,
            color: cancelled ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
          }}>
          <Ban size={ICON.sm} />
        </button>
        <button title={expanded ? 'Narrow the panel' : 'Widen the panel'} onClick={() => setExpanded(x => !x)} style={ICON_BTN}><Maximize2 size={ICON.sm} /></button>
        <button title="Delete task" onClick={() => { deleteTask(task.id); onClose() }} style={ICON_BTN}>
          <Trash2 size={ICON.md} />
        </button>
        <button title="Close" onClick={onClose} style={ICON_BTN}><X size={ICON.md} /></button>
      </div>

      {/* ── Scrolling body ───────────────────────────────────────────────── */}
      <div
        onDragOver={e => { e.preventDefault(); setDropping(true) }}
        onDragLeave={() => setDropping(false)}
        onDrop={e => { e.preventDefault(); setDropping(false); acceptFiles(e.dataTransfer.files) }}
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 14px 0',
          outline: dropping ? '2px dashed var(--sb-accent)' : 'none', outlineOffset: -6,
        }}>
        {/* Title. A task with no name yet gets the cursor: it was made a
            moment ago for the express purpose of being named. */}
        <textarea
          ref={el => { if (el && !task.title && document.activeElement !== el) el.focus() }}
          value={task.title}
          onChange={e => patch({ title: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          rows={2}
          placeholder="What is it?"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
            background: 'var(--sb-field)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
            padding: '12px 14px', outline: 'none', fontFamily: 'var(--sb-font-num)',
            fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', lineHeight: 1.25,
          }}
        />

        {/* Attributes — one aligned grid instead of a ragged chip row. Every
            cell is the same shape and reads icon-then-value, left aligned, so
            nothing shifts when a value is set or cleared. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8, marginTop: 12,
        }}>
          {/* Schedule — the widest value, so it takes the full row */}
          <div ref={dateRef} style={{ gridColumn: '1 / -1', position: 'relative' }}>
            <button onClick={() => setDatePickerOpen(o => !o)} style={{ ...CELL, width: '100%' }}>
              <CalendarDays size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: task.dueDate ? 'var(--sb-positive)' : 'var(--sb-ink-4)' }} />
              <span style={{ ...CELL_VALUE, color: task.dueDate ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
                {scheduleLabel}
              </span>
              <ChevronDown size={ICON.sm} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />
            </button>
            {datePickerOpen && (
              <SchedulePopover
                date={task.dueDate} start={task.plannedTime} duration={task.duration}
                onApply={patch}
                onClose={() => setDatePickerOpen(false)}
              />
            )}
          </div>

          {/* On the calendar, or not — and the way to put it there */}
          {task.dueDate && (
            task.gcalEventId ? (
              eventState === 'gone' ? (
                // The id is dead: deleted in Google, or on a calendar this
                // account can no longer read. Saying "on your calendar" here is
                // the bug you spent an afternoon on.
                <button
                  onClick={() => void remakeEvent()}
                  disabled={pushing}
                  title="The event this task made is not in Google any more"
                  style={{ ...CELL, gridColumn: '1 / -1', width: '100%', borderColor: 'color-mix(in srgb, var(--sb-negative) 24%, transparent)', background: 'var(--sb-negative-tint)' }}>
                  <CalendarDays size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-negative)' }} />
                  <span style={{ ...CELL_VALUE, color: 'var(--sb-negative)' }}>
                    {pushing ? 'Putting it back…' : pushError ?? 'Not in Google any more — put it back'}
                  </span>
                </button>
              ) : (
              <button
                onClick={() => focusOn({ module: 'calendar', id: task.gcalEventId!, date: (eventWhen ?? task.dueDate)?.slice(0, 10) })}
                title={eventWhen ? `Blocked ${new Date(eventWhen).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Open the day it is blocked on'}
                style={{ ...CELL, gridColumn: '1 / -1', width: '100%' }}>
                <CalendarDays size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: eventState === 'checking' ? 'var(--sb-ink-4)' : 'var(--sb-positive)' }} />
                <span style={{ ...CELL_VALUE, color: 'var(--sb-ink-3)' }}>
                  {eventState === 'checking' ? 'Checking the calendar…' : (
                    <>On {calTarget.companyName ? `${calTarget.companyName}'s calendar` : 'your calendar'}
                    {eventWhen
                      ? ` · ${new Date(eventWhen).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                      : task.plannedTime ? ` · ${task.plannedTime}` : ''}</>
                  )}
                </span>
                <ExternalLink size={ICON.sm} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />
              </button>
              )
            ) : (
              <button
                onClick={() => void pushToCalendar()}
                disabled={pushing}
                title="Create the Google Calendar event for this task"
                style={{ ...CELL, gridColumn: '1 / -1', width: '100%' }}>
                <CalendarDays size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />
                <span style={{ ...CELL_VALUE, color: pushError ? 'var(--sb-negative)' : 'var(--sb-ink-3)' }}>
                  {pushing ? 'Adding it…' : pushError ?? `Not on the calendar — add it to ${calWhere}`}
                </span>
              </button>
            )
          )}

          {/* Type */}
          <label style={{ ...CELL, position: 'relative' }}>
            <TypeIcon size={14} strokeWidth={1.9} style={{ flexShrink: 0, color: 'var(--sb-ink-3)' }} />
            <span style={{ ...CELL_VALUE, color: 'var(--sb-ink-1)' }}>{v.typeLabel}</span>
            <select value={v.type} onChange={e => patch({ taskType: e.target.value as TaskType })} style={CELL_INPUT}>
              {TASK_TYPE_ORDER.map(t => <option key={t} value={t}>{TASK_TYPE_META[t].label}</option>)}
            </select>
          </label>

          {/* Priority */}
          <label style={{ ...CELL, position: 'relative' }}>
            <BarChart3 size={ICON.sm} strokeWidth={STROKE.rest} style={{
              flexShrink: 0, color: task.priority ? PRIORITY_META[task.priority].color : 'var(--sb-ink-4)',
            }} />
            <span style={{ ...CELL_VALUE, color: task.priority ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
              {task.priority ?? 'No priority'}
            </span>
            <select
              value={task.priority ?? ''}
              onChange={e => patch({ priority: (e.target.value || undefined) as Priority | undefined })}
              style={CELL_INPUT}>
              <option value="">No priority</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          {/* Owner */}
          <label style={{ ...CELL, gridColumn: '1 / -1', position: 'relative' }}>
            <span style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, boxSizing: 'border-box',
              background: owner ? 'var(--sb-ink-1)' : 'var(--sb-field)',
              border: owner ? 'none' : '1px solid var(--sb-border)',
              color: owner ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--sb-t-micro)', fontWeight: 700,
            }}>{owner ? initials(owner.name) : <User size={ICON.sm} strokeWidth={STROKE.rest} />}</span>
            <span style={{ ...CELL_VALUE, color: owner ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
              {owner ? owner.name : 'Unassigned'}
            </span>
            <select value={task.owner ?? ''} onChange={e => patch({ owner: e.target.value || undefined })} style={CELL_INPUT}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>

          {/* Links */}
          <button
            onClick={() => {
              const url = window.prompt('Paste a link (thread, doc, page)')?.trim()
              if (url) patch({ links: [...(task.links ?? []), url] })
            }}
            style={CELL}>
            <Link2 size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: linkCount ? 'var(--sb-ink-3)' : 'var(--sb-ink-4)' }} />
            <span style={{ ...CELL_VALUE, color: linkCount ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
              {linkCount ? `${linkCount} link${linkCount === 1 ? '' : 's'}` : 'Add a link'}
            </span>
          </button>

          {/* Files */}
          <button onClick={() => fileRef.current?.click()} style={CELL}>
            <Folder size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: attachments.length ? 'var(--sb-ink-3)' : 'var(--sb-ink-4)' }} />
            <span style={{ ...CELL_VALUE, color: attachments.length ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
              {attachments.length ? `${attachments.length} file${attachments.length === 1 ? '' : 's'}` : 'Add a file'}
            </span>
          </button>
        </div>

        {/* Subtasks */}
        <div style={{ marginTop: 18 }}>
          <p style={SECTION_LABEL}>Subtasks</p>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {checklist.map((s: ChecklistStep) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
                <button onClick={() => toggleStep(s.id)} style={{
                  width: 15, height: 15, borderRadius: 'var(--sb-r-chip)', boxSizing: 'border-box', flexShrink: 0, padding: 0,
                  border: s.done ? 'var(--sb-border-emphasis) solid var(--sb-ink-1)' : 'var(--sb-border-emphasis) solid var(--sb-border)',
                  background: s.done ? 'var(--sb-ink-1)' : 'var(--sb-card)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{s.done && <Check size={ICON.sm} color="var(--sb-ink-on-dark)" strokeWidth={STROKE.active} />}</button>
                <span style={{
                  flex: 1, fontSize: 'var(--sb-t-body-s)', color: s.done ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
                  textDecoration: s.done ? 'line-through' : 'none',
                }}>{s.text}</span>
                <button onClick={() => patch({ checklist: checklist.filter(x => x.id !== s.id) })}
                  title="Remove subtask" style={{ ...ICON_BTN, width: 20, height: 20, color: 'var(--sb-ink-4)' }}>
                  <X size={ICON.sm} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
              <Plus size={ICON.sm} color="var(--sb-ink-4)" style={{ flexShrink: 0 }} />
              <input
                value={newStep}
                onChange={e => setNewStep(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addStep() }}
                onBlur={addStep}
                placeholder="Add a subtask"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', padding: 0,
                }}
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginTop: 18 }}>
          <p style={SECTION_LABEL}>Notes</p>
          <textarea
            value={task.description ?? ''}
            onChange={e => patch({ description: e.target.value })}
            rows={3}
            placeholder="Anything worth remembering…"
            style={{
              width: '100%', boxSizing: 'border-box', marginTop: 8, resize: 'vertical',
              background: 'var(--sb-field)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              padding: '10px 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
        </div>

        {/* Attachments — only when the task actually has some */}
        {(attachments.length > 0 || linkCount > 0) && (
          <div style={{ marginTop: 18 }}>
            <p style={SECTION_LABEL}>Attachments · {attachments.length + linkCount}</p>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(task.links ?? []).map((url, i) => (
                <div key={`${url}-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '9px 11px',
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, background: 'var(--sb-field)',
                    border: '1px solid var(--sb-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-ink-3)',
                  }}><Link2 size={ICON.sm} /></span>
                  <a href={url} target="_blank" rel="noreferrer" style={{
                    flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-info)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{url}</a>
                  <button onClick={() => patch({ links: (task.links ?? []).filter((_, j) => j !== i) })}
                    title="Remove link" style={{ ...ICON_BTN, width: 22, height: 22, color: 'var(--sb-ink-4)' }}>
                    <X size={ICON.sm} />
                  </button>
                </div>
              ))}
              {attachments.map(f => {
                const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)
                return (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '9px 11px',
                  }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, background: 'var(--sb-field)',
                      border: '1px solid var(--sb-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-ink-3)',
                    }}>{isImage ? <ImageIcon size={ICON.sm} /> : <FileText size={ICON.sm} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                      <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                        {formatBytes(f.size)}{f.source ? ` · ${f.source}` : ''}
                      </p>
                    </div>
                    <button onClick={() => patch({ attachments: attachments.filter(x => x.id !== f.id) })}
                      title="Remove attachment" style={{ ...ICON_BTN, width: 22, height: 22, color: 'var(--sb-ink-4)' }}>
                      <Trash2 size={ICON.sm} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" multiple onChange={e => acceptFiles(e.target.files)} style={{ display: 'none' }} />

        {/* Activity */}
        <div style={{ marginTop: 18, paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setActivityOpen(o => !o)}
              title={activityOpen ? 'Collapse activity' : 'Expand activity'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: 'inherit', textAlign: 'left',
              }}>
              {activityOpen
                ? <ChevronDown size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-ink-4)" />
                : <ChevronRight size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-ink-4)" />}
              <span style={SECTION_LABEL}>Activity</span>
            </button>
            {activityOpen && taskActs.length > 7 && (
              <button onClick={() => setFullLog(f => !f)} style={{
                display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
                cursor: 'pointer', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)', fontFamily: 'inherit', padding: 0,
              }}>
                <History size={ICON.sm} /> {fullLog ? 'Recent only' : 'Full log'}
              </button>
            )}
          </div>
          <div style={{ marginTop: 10, display: activityOpen ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>
            {shownActs.length === 0 && (
              <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>Nothing yet.</p>
            )}
            {shownActs.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, marginTop: 1,
                  background: 'var(--sb-field)', border: '1px solid var(--sb-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-ink-4)',
                }}>
                  <ActivityIcon type={a.type} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', lineHeight: 1.35 }}>{a.description}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>{relativeStamp(a.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderTop: '1px solid var(--sb-hairline)', padding: '10px 14px',
      }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>Every change saves itself</span>
      </div>
    </aside>
  )
}
