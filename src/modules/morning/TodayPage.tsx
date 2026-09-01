// ─── Today ───────────────────────────────────────────────────────────────────
// The morning brief, laid out as the artboard: the written brief and the mail
// that needs you down the left; the day's plan, the open tasks and the habit
// grid down the right. Everything reads from the same stores the rest of the
// app writes to — nothing here is illustrative.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pencil, RefreshCw, ArrowRight, Zap, Archive, Plus,
  Clock, Check, Flame, Sun, Quote, CheckSquare, X,
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
import { listUnreadThreadIds, getThread, header, extractBody, extractHtmlBody, archiveMessage } from '@/lib/gmail'
import { TASK_TYPE_META, inferTaskType, isTaskHidden } from '@/types'
import { isMailHiddenByCompany } from '@/lib/companyVisibility'
import { TASK_TYPE_ICON } from '@/modules/tasks/taskVisuals'
import type { Task } from '@/types'

// ─── Tokens ──────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 16,
  boxShadow: '0 1px 3px rgba(25,23,18,0.05)', minWidth: 0,
}
const INK = '#191712'
const MUTED = '#6C6553'
const GHOST = '#9B9180'
const HAIR = '#F0EBDC'
const FIELD = '#FAF7EC'
const AMBER = '#F5D14E'

const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
  borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE',
  color: INK, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
}
const GHOST_BTN: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: GHOST, display: 'flex', alignItems: 'center',
}
const ICON_TILE: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: FIELD, border: '1px solid #E8E1CE', color: MUTED,
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
  meta?: string
  children?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
      padding: '14px 16px 12px', borderBottom: `1px solid ${HAIR}`,
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: INK, flexShrink: 0 }}>{title}</span>
      {meta && (
        <span style={{
          fontSize: 11.5, color: GHOST, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{meta}</span>
      )}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  )
}

function LinkOut({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      ...GHOST_BTN, gap: 5, color: MUTED, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0,
    }}>
      {label} <ArrowRight size={12} strokeWidth={2.2} />
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
  fromName: string
  fromEmail: string
  to: string
  subject: string
  snippet: string
  /** The message as it was sent, when it carried HTML. */
  html: string | null
  body: string
  receivedAt: string
  needsYou: boolean
  newsletter: boolean
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
           line-height:1.6; color:#191712; word-break:break-word; }
    img { max-width:100%; height:auto; }
    a { color:#2563EB; }
    pre, blockquote { white-space:pre-wrap; }
    blockquote { margin:0 0 0 12px; padding-left:10px; border-left:2px solid #E8E1CE; color:#6C6553; }
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
        background: 'rgba(25,23,18,0.28)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 20px 20px',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 40px 80px -30px rgba(25,23,18,.55)',
        }}>

        {/* Who, what, when */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 14px', borderBottom: `1px solid ${HAIR}` }}>
          <span style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#F1ECDE', color: MUTED, fontSize: 12.5, fontWeight: 700,
          }}>{initialsOf(row.fromName || row.fromEmail)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: 0, fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 600,
              letterSpacing: '-0.02em', color: INK, lineHeight: 1.25,
            }}>{row.subject}</h2>
            <p style={{ margin: '5px 0 0', fontSize: 12.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <strong style={{ fontWeight: 600, color: INK }}>{row.fromName || row.fromEmail}</strong>
              {row.fromName ? ` · ${row.fromEmail}` : ''}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: GHOST }}>
              {row.to ? `to ${row.to} · ` : ''}
              {new Date(row.receivedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          {row.needsYou && (
            <span style={{
              flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 6,
              background: 'rgba(245,209,78,0.28)', border: '1px solid rgba(245,209,78,0.7)',
              color: '#7A6412', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
              display: 'inline-flex', alignItems: 'center',
            }}>NEEDS YOU</span>
          )}
          <button onClick={onClose} title="Close"
            style={{ ...ICON_TILE, width: 28, height: 28, borderRadius: '50%', cursor: 'pointer' }}>
            <X size={14} />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: FIELD, borderTop: `1px solid ${HAIR}` }}>
          <span style={{ flex: 1, fontSize: 11.5, color: GHOST }}>Esc, or click away, to close</span>
          <button onClick={onAddTask} style={{ ...PILL, height: 32 }}>
            <Plus size={13} /> Add as task
          </button>
          <button onClick={onArchive} style={{ ...PILL, height: 32 }}>
            <Archive size={13} /> Archive
          </button>
        </div>
      </div>
    </div>
  )
}

function MailCard({ rows, loading, error, newsletters, onArchive, onArchiveAll, onOpenInbox, onAddTask, onOpen }: {
  rows: MailRow[]
  loading: boolean
  error: string | null
  newsletters: number
  onArchive: (row: MailRow) => void
  onArchiveAll: () => void
  onOpenInbox: () => void
  onAddTask: (row: MailRow) => void
  onOpen: (row: MailRow) => void
}) {
  const unread = rows.length + newsletters
  const needsYou = rows.filter(r => r.needsYou).length

  return (
    <div style={CARD}>
      <CardHead
        title="Mail"
        meta={loading ? 'reading your inbox…' : `${unread} unread · ${needsYou} need${needsYou === 1 ? 's' : ''} you`}>
        <LinkOut label="Inbox" onClick={onOpenInbox} />
      </CardHead>

      {error ? (
        <div style={{ padding: '18px 16px', fontSize: 12.5, color: GHOST }}>{error}</div>
      ) : loading ? (
        <div style={{ padding: '18px 16px', fontSize: 12.5, color: GHOST }}>Reading your inbox…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '18px 16px', fontSize: 12.5, color: GHOST }}>Nothing unread needs you.</div>
      ) : (
        <div>
          {rows.map(r => (
            <div
              key={r.id}
              onClick={e => { if (!(e.target as HTMLElement).closest('button')) onOpen(r) }}
              style={{ padding: '11px 16px', borderBottom: `1px solid ${HAIR}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{
                  ...ICON_TILE, width: 28, height: 28, fontSize: 10, fontWeight: 700, color: MUTED,
                }}>{initialsOf(r.fromName || r.fromEmail)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: INK, flexShrink: 0, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.fromName || r.fromEmail}
                </span>
                {r.needsYou && (
                  <span style={{
                    flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 5,
                    background: 'rgba(245,209,78,0.28)', border: '1px solid rgba(245,209,78,0.7)',
                    color: '#7A6412', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                    display: 'inline-flex', alignItems: 'center',
                  }}>NEEDS YOU</span>
                )}
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.subject}
                </span>
                <span style={{ fontSize: 11.5, color: GHOST, flexShrink: 0 }}>{relAge(r.receivedAt)}</span>
                <button onClick={() => onAddTask(r)} title="Add as a task"
                  style={{ ...ICON_TILE, width: 26, height: 26, cursor: 'pointer' }}>
                  <Plus size={13} strokeWidth={2} />
                </button>
                <button onClick={() => onArchive(r)} title="Archive"
                  style={{ ...ICON_TILE, width: 26, height: 26, cursor: 'pointer' }}>
                  <Archive size={13} strokeWidth={2} />
                </button>
              </div>
              {r.snippet && (
                <div style={{
                  marginTop: 7, marginLeft: 38, padding: '7px 10px', borderRadius: 8,
                  background: FIELD, border: `1px solid ${HAIR}`,
                  fontSize: 12, color: MUTED, lineHeight: 1.45,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{r.snippet}</div>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: GHOST }}>
              {newsletters > 0 ? `${newsletters} newsletter${newsletters === 1 ? '' : 's'} — nothing needs you.` : 'No newsletters waiting.'}
            </span>
            {newsletters > 0 && (
              <button onClick={onArchiveAll} style={{ ...PILL, height: 28 }}>
                <Archive size={12} /> Archive all
              </button>
            )}
          </div>
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

const HOUR_PX = 46
const SNAP_MIN = 15

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
  const topOf = (mins: number) => ((mins - fromHour * 60) / 60) * HOUR_PX

  function beginDrag(e: React.PointerEvent, b: Block) {
    if (b.kind !== 'proposed') return
    const lane = laneRef.current
    if (!lane) return
    const startMins = minutesOf(b.start)
    const length = Math.max(SNAP_MIN, minutesOf(b.end) - startMins)
    const pointerMins = ((e.clientY - lane.getBoundingClientRect().top) / HOUR_PX) * 60 + fromHour * 60
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
    const pointerMins = ((e.clientY - lane.getBoundingClientRect().top) / HOUR_PX) * 60 + fromHour * 60
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
        <span style={{ fontSize: 11.5, color: dirty ? '#B4523A' : GHOST, flexShrink: 0 }}>
          {dirty ? 'draft, not saved' : 'saved'}
        </span>
      </CardHead>

      {blocks.length === 0 ? (
        <p style={{ margin: 0, padding: '18px 16px', fontSize: 12.5, color: GHOST }}>
          Nothing booked and nothing proposed. Give a task a time and it lands here.
        </p>
      ) : (
        <div style={{ padding: '10px 16px 6px', maxHeight: 360, overflowY: 'auto', scrollbarWidth: 'thin' }}>
          <div
            ref={laneRef}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ position: 'relative', height: hours.length * HOUR_PX, minWidth: 0 }}>

            {/* Hour rules */}
            {hours.map(h => (
              <div key={h} style={{ position: 'absolute', top: topOf(h * 60), left: 0, right: 0, height: HOUR_PX }}>
                <span style={{
                  position: 'absolute', top: -6, left: 0, width: 40,
                  fontSize: 10, color: GHOST, fontVariantNumeric: 'tabular-nums',
                }}>{String(h).padStart(2, '0')}:00</span>
                <span style={{ position: 'absolute', top: 0, left: 44, right: 0, height: 1, background: HAIR }} />
              </div>
            ))}

            {/* Now */}
            {nowMins >= fromHour * 60 && nowMins <= toHour * 60 && (
              <div style={{ position: 'absolute', top: topOf(nowMins), left: 0, right: 0, pointerEvents: 'none', zIndex: 3 }}>
                <span style={{ position: 'absolute', top: -6, left: 0, fontSize: 10, fontWeight: 700, color: '#B4523A', fontVariantNumeric: 'tabular-nums' }}>
                  {hhmm(now)}
                </span>
                <span style={{ position: 'absolute', top: 0, left: 44, right: 0, height: 1, background: '#B4523A' }} />
                <span style={{ position: 'absolute', top: -2.5, left: 42, width: 6, height: 6, borderRadius: 999, background: '#B4523A' }} />
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
              return (
                <div
                  key={b.id}
                  onPointerDown={e => beginDrag(e, b)}
                  onClick={() => { if (!dragging) onOpenBlock(b) }}
                  title={canDrag ? 'Drag to another hour, or click to open' : 'Click to open in the calendar'}
                  style={{
                    position: 'absolute', left: 44, right: 0, zIndex: dragging ? 5 : 2,
                    top: topOf(startMins), height: Math.max(26, (length / 60) * HOUR_PX - 3),
                    display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
                    padding: '0 10px', borderRadius: 9, minWidth: 0,
                    background: status === 'cancelled' ? '#F1ECDE'
                      : b.kind === 'proposed' ? 'rgba(245,209,78,0.20)' : FIELD,
                    border: `1px solid ${b.kind === 'proposed' ? 'rgba(245,209,78,0.6)' : '#E8E1CE'}`,
                    borderLeft: `3px solid ${b.kind === 'proposed' ? AMBER : '#D8CFB8'}`,
                    boxShadow: dragging ? '0 10px 24px -10px rgba(25,23,18,.45)' : 'none',
                    opacity: past || status === 'cancelled' ? 0.6 : 1,
                    cursor: canDrag ? (dragging ? 'grabbing' : 'grab') : 'pointer',
                    touchAction: 'none', userSelect: 'none',
                  }}>
                  {b.kind === 'proposed'
                    ? <CheckSquare size={13} strokeWidth={1.9} style={{ flexShrink: 0, color: MUTED }} />
                    : <Clock size={13} strokeWidth={1.9} style={{ flexShrink: 0, color: MUTED }} />}
                  <span style={{
                    fontSize: 12.5, fontWeight: 600, color: INK, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: status === 'cancelled' ? 'line-through' : 'none',
                  }}>{b.title}</span>
                  <span style={{ fontSize: 11, color: GHOST, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMins(startMins)}–{fmtMins(startMins + length)}
                  </span>
                  <span style={{ flex: 1 }} />
                  {b.eventId && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); onSetStatus(b.eventId!, 'done') }}
                        onPointerDown={e => e.stopPropagation()}
                        title={status === 'done' ? 'Not done after all' : 'Mark done'}
                        style={{
                          ...ICON_TILE, width: 20, height: 20, borderRadius: 999, cursor: 'pointer', flexShrink: 0,
                          background: status === 'done' ? '#5F7038' : '#FFFFFF',
                          borderColor: status === 'done' ? '#5F7038' : '#E8E1CE',
                          color: status === 'done' ? '#FFFFFF' : MUTED,
                        }}>
                        <Check size={11} strokeWidth={2.6} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onSetStatus(b.eventId!, 'cancelled') }}
                        onPointerDown={e => e.stopPropagation()}
                        title={status === 'cancelled' ? 'Restore' : 'Mark cancelled'}
                        style={{
                          ...ICON_TILE, width: 20, height: 20, borderRadius: 999, cursor: 'pointer', flexShrink: 0,
                          background: status === 'cancelled' ? '#B4523A' : '#FFFFFF',
                          borderColor: status === 'cancelled' ? '#B4523A' : '#E8E1CE',
                          color: status === 'cancelled' ? '#FFFFFF' : MUTED,
                        }}>
                        <X size={11} strokeWidth={2.6} />
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: GHOST }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: AMBER }} /> Proposed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: GHOST }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#D8CFB8' }} /> Calendar
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onOpenCalendar} style={{ ...PILL, height: 28 }}>Open calendar</button>
        <button onClick={onAddBlock} style={{ ...PILL, height: 28 }}>
          <Plus size={12} /> Add block
        </button>
        <button
          onClick={onAccept}
          disabled={proposed === 0}
          style={{
            ...PILL, height: 28, background: proposed === 0 ? '#EDE7D9' : INK,
            border: 'none', color: proposed === 0 ? GHOST : '#FDF8E7', fontWeight: 600,
            cursor: proposed === 0 ? 'default' : 'pointer',
          }}>
          <Check size={12} strokeWidth={2.4} /> Accept plan
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
  const doneToday = habits.filter(h => (logs[h.id] ?? []).includes(today)).length
  const weekDone = habits.reduce((n, h) => n + week.filter(d => (logs[h.id] ?? []).includes(d)).length, 0)
  const weekPct = habits.length ? Math.round((weekDone / (habits.length * 7)) * 100) : 0
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color: '#B4523A', flexShrink: 0 }}>
            <Flame size={12} strokeWidth={2} /> {coldDays} days cold
          </span>
        )}
        <Sun size={13} strokeWidth={1.9} style={{ color: GHOST, flexShrink: 0 }} />
        <LinkOut label="Tracker" onClick={onOpenTracker} />
      </CardHead>

      {habits.length === 0 ? (
        <div style={{ padding: '18px 16px', fontSize: 12.5, color: GHOST }}>No habits yet.</div>
      ) : (
        <div style={{ padding: '10px 16px 14px' }}>
          {/* Column heads */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6 }}>
            <span style={{ width: 26, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }} />
            <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {week.map(d => (
                <span key={d} style={{ width: 15, textAlign: 'center', fontSize: 9, fontWeight: 700, color: GHOST }}>
                  {DAY_LETTERS[new Date(d + 'T12:00:00').getDay()]}
                </span>
              ))}
            </span>
            <span style={{ width: 168, textAlign: 'right', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.07em', color: GHOST, flexShrink: 0, whiteSpace: 'nowrap' }}>
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
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid ${HAIR}` }}>
                <span style={{ ...ICON_TILE, overflow: 'hidden', fontSize: 13 }}>
                  {h.image
                    ? <img src={h.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : h.emoji}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: GHOST }}>
                    {h.frequency}{hasGoal ? ` · ${h.goal} ${h.unit ?? ''}`.trimEnd() : ''}
                  </span>
                </span>

                <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {week.map(d => {
                    const on = hLogs.includes(d)
                    const isToday = d === today
                    return (
                      <span key={d} title={d} style={{
                        width: 15, height: 15, borderRadius: 4, boxSizing: 'border-box',
                        background: on ? INK : '#EDE7D9',
                        border: isToday ? `1.5px solid ${on ? INK : '#CFC6B0'}` : '1.5px solid transparent',
                      }} />
                    )
                  })}
                </span>

                <span style={{ width: 168, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: GHOST, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {isQty ? (hasGoal ? `${qty}/${h.goal}${h.unit ? ` ${h.unit}` : ''}` : `${qty}${h.unit ? ` ${h.unit}` : ''}`) : (done ? 'done' : '—')}
                  </span>
                  {isQty ? (
                    <>
                      <button onClick={() => onSetQty(h, Math.max(0, qty - 1))} disabled={qty === 0}
                        style={{ ...ICON_TILE, width: 22, height: 22, cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.4 : 1, fontSize: 13 }}>−</button>
                      <button onClick={() => onSetQty(h, qty + 1)}
                        style={{ ...ICON_TILE, width: 22, height: 22, cursor: 'pointer', background: INK, borderColor: INK, color: '#FDF8E7', fontSize: 13 }}>+</button>
                    </>
                  ) : (
                    <button onClick={() => onToggle(h.id)} title={done ? 'Undo' : 'Mark done'}
                      style={{
                        ...ICON_TILE, width: 22, height: 22, cursor: 'pointer',
                        background: done ? '#5F7038' : INK, borderColor: done ? '#5F7038' : INK, color: '#FDF8E7',
                      }}>
                      <Check size={12} strokeWidth={2.6} />
                    </button>
                  )}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, color: streak > 0 ? '#5F7038' : GHOST, width: 30, justifyContent: 'flex-end', flexShrink: 0 }}>
                    <Flame size={10} strokeWidth={2} /> {streak}d
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
  const [briefEdit, setBriefEdit] = useState<string | null>(null)
  const [briefSeed, setBriefSeed] = useState(0)

  const [mail, setMail] = useState<MailRow[]>([])
  const [newsletters, setNewsletters] = useState(0)
  const [mailLoading, setMailLoading] = useState(true)
  const [openMail, setOpenMail] = useState<MailRow | null>(null)
  const [mailError, setMailError] = useState<string | null>(null)

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
    try {
      const { ids } = await listUnreadThreadIds(14)
      const threads = await Promise.all(ids.map(id => getThread(id).catch(() => null)))
      const rows: MailRow[] = []
      let bulk = 0
      for (const th of threads) {
        const last = th?.messages?.at(-1)
        if (!th || !last) continue
        const headers = last.payload?.headers ?? []
        const from = header(headers, 'From')
        const name = from.replace(/<.*>/, '').replace(/"/g, '').trim()
        const email = from.match(/<(.+)>/)?.[1] ?? from
        // A newsletter tells you it is one: it carries an unsubscribe header
        const isBulk = !!header(headers, 'List-Unsubscribe')
        if (isBulk) { bulk++; continue }
        const to = header(headers, 'To').toLowerCase()
        // A hidden company's mail is hidden too, the same as its tasks and calendars
        if (isMailHiddenByCompany({ from, to, accountEmail: user?.email })) continue
        const me = (user?.email ?? '').toLowerCase()
        const plain = extractBody(last)
        rows.push({
          id: th.id,
          messageId: last.id,
          fromName: name || email,
          fromEmail: email,
          to: header(headers, 'To'),
          subject: header(headers, 'Subject') || '(no subject)',
          snippet: plain.replace(/\s+/g, ' ').trim().slice(0, 140),
          html: extractHtmlBody(last),
          body: plain,
          receivedAt: new Date(Number(last.internalDate ?? Date.now())).toISOString(),
          needsYou: !!me && to.includes(me),
          newsletter: false,
        })
      }
      rows.sort((a, b) => Number(b.needsYou) - Number(a.needsYou))
      setMail(rows.slice(0, 7))
      setNewsletters(bulk)
    } catch {
      setMailError('Mail is not connected — link Google in Settings to see what needs you.')
    } finally {
      setMailLoading(false)
    }
  }, [user?.email])

  useEffect(() => { void loadMail() }, [loadMail])

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
  const carriedCount = openTasks.filter(t => {
    const days = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000)
    return days >= 1 && !!t.plannedTime
  }).length

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
    const fromTasks: Block[] = openTasks
      .filter(t => !!t.plannedTime)
      .map(t => ({
        id: `task-${t.id}`,
        kind: 'proposed' as const,
        title: t.title,
        meta: TASK_TYPE_META[t.taskType ?? inferTaskType(t.title)].label.toLowerCase(),
        start: t.plannedTime!,
        end: addMinutes(t.plannedTime!, t.duration ?? 30),
        taskId: t.id,
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
    try { await archiveMessage(row.messageId) } catch { /* it stays archived here either way */ }
  }

  async function archiveNewsletters() {
    setNewsletters(0)
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
        padding: '14px 26px', borderBottom: '1px solid #E8E1CE', background: '#FCFAF4',
      }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: INK, flexShrink: 0 }}>Morning Brief</span>
        <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{dateLine}</span>
        <span style={{ ...PILL, cursor: 'default', height: 28 }}>
          <Clock size={12} /> {hhmm(clock)}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setBriefEdit(briefEdit === null ? brief.body : null)} style={PILL}>
          <Pencil size={12} /> {briefEdit === null ? 'Edit' : 'Done'}
        </button>
        <button onClick={() => { setBriefEdit(null); setBriefSeed(n => n + 1); void loadMail() }} style={PILL}>
          <RefreshCw size={12} /> Regenerate
        </button>
        <button
          onClick={() => setActiveModule('tasks')}
          style={{ ...PILL, background: AMBER, border: 'none', fontWeight: 600, boxShadow: '0 1px 3px rgba(25,23,18,0.14)' }}>
          <ArrowRight size={13} strokeWidth={2.2} /> Start the day
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
            <Quote size={16} strokeWidth={2} style={{ color: '#D8CFB8' }} />
            <h1 style={{
              margin: '8px 0 0', fontFamily: 'Outfit, sans-serif', fontSize: 26, fontWeight: 600,
              letterSpacing: '-0.03em', lineHeight: 1.2, color: INK,
            }}>{brief.headline}</h1>
            <p style={{ margin: '9px 0 0', fontSize: 12, color: GHOST }}>
              {tasks.filter(t => t.completed).length} closed all time · rank {rank.score} / 100 ·{' '}
              {events.filter(e => !!e.start.dateTime).length} meetings today
            </p>
            {briefEdit === null ? (
              <p style={{ margin: '14px 0 0', fontSize: 13.5, color: '#3D3926', lineHeight: 1.65 }}>{brief.body}</p>
            ) : (
              <textarea
                value={briefEdit}
                onChange={e => setBriefEdit(e.target.value)}
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box', marginTop: 14, resize: 'vertical',
                  background: FIELD, border: '1px solid #E8E1CE', borderRadius: 10, padding: '10px 12px',
                  fontSize: 13.5, color: INK, fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', textAlign: 'left',
                }} />
            )}
            {brief.callout && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, marginTop: 16,
                padding: '11px 13px', borderRadius: 10,
                background: 'rgba(245,209,78,0.14)', border: '1px solid rgba(245,209,78,0.5)',
              }}>
                <Zap size={14} strokeWidth={2} style={{ color: '#9A7B1F', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: '#3D3926' }}>{brief.callout}</span>
              </div>
            )}
          </div>

          <MailCard
            rows={mail}
            loading={mailLoading}
            error={mailError}
            newsletters={newsletters}
            onArchive={row => void archiveMail(row)}
            onArchiveAll={() => void archiveNewsletters()}
            onOpenInbox={() => setActiveModule('inbox')}
            onAddTask={mailToTask}
            onOpen={setOpenMail}
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
              <div style={{ padding: '18px 16px', fontSize: 12.5, color: GHOST }}>Nothing open. Enjoy it.</div>
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
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${HAIR}` }}>
                      <button
                        onClick={() => toggleComplete(t.id)}
                        title="Complete"
                        style={{
                          width: 17, height: 17, borderRadius: 5, boxSizing: 'border-box', flexShrink: 0, padding: 0,
                          border: '1.5px solid #CFC6B0', background: '#FFFFFF', cursor: 'pointer',
                        }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </span>
                      <span style={{ fontSize: 11.5, color: GHOST, flexShrink: 0 }}>{meta}</span>
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
