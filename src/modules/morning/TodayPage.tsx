// ─── Today ───────────────────────────────────────────────────────────────────
// The morning brief, laid out as the artboard: the written brief and the mail
// that needs you down the left; the day's plan, the open tasks and the habit
// grid down the right. Everything reads from the same stores the rest of the
// app writes to — nothing here is illustrative.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pencil, RefreshCw, ArrowRight, Zap, Archive, Plus,
  Clock, Check, Flame, Sun, Quote, CheckSquare,
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
import { listUnreadThreadIds, getThread, header, extractBody, archiveMessage } from '@/lib/gmail'
import { TASK_TYPE_META, inferTaskType, isTaskHidden } from '@/types'
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
  subject: string
  snippet: string
  receivedAt: string
  needsYou: boolean
  newsletter: boolean
}

function MailCard({ rows, loading, error, newsletters, onArchive, onArchiveAll, onOpenInbox, onAddTask }: {
  rows: MailRow[]
  loading: boolean
  error: string | null
  newsletters: number
  onArchive: (row: MailRow) => void
  onArchiveAll: () => void
  onOpenInbox: () => void
  onAddTask: (row: MailRow) => void
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
            <div key={r.id} style={{ padding: '11px 16px', borderBottom: `1px solid ${HAIR}` }}>
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

// ─── Plan for today ──────────────────────────────────────────────────────────

interface Block {
  id: string
  kind: 'calendar' | 'proposed'
  title: string
  meta: string
  start: string
  end: string
  taskId?: string
}

function PlanCard({ blocks, freeMinutes, focusMinutes, dirty, onAccept, onAddBlock, onOpenCalendar }: {
  blocks: Block[]
  freeMinutes: number
  focusMinutes: number
  dirty: boolean
  onAccept: () => void
  onAddBlock: () => void
  onOpenCalendar: () => void
}) {
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const proposed = blocks.filter(b => b.kind === 'proposed').length

  return (
    <div style={CARD}>
      <CardHead
        title="Plan for today"
        meta={`${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${fmtHours(focusMinutes)} focus · ${fmtHours(freeMinutes)} free`}>
        <span style={{ fontSize: 11.5, color: dirty ? '#B4523A' : GHOST, flexShrink: 0 }}>
          {dirty ? 'draft, not saved' : 'saved'}
        </span>
      </CardHead>

      <div style={{ padding: '12px 16px 14px' }}>
        {/* Now line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B4523A', width: 42, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {hhmm(now)}
          </span>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: '#B4523A', flexShrink: 0 }} />
          <span style={{ flex: 1, height: 1, background: 'rgba(180,82,58,0.5)' }} />
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.12em', color: '#B4523A', flexShrink: 0 }}>NOW</span>
        </div>

        {blocks.length === 0 ? (
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: GHOST }}>
            Nothing booked and nothing proposed. Give a task a time and it lands here.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {blocks.map(b => {
              const past = minutesOf(b.end) < nowMins
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'stretch', gap: 9, minWidth: 0, opacity: past ? 0.55 : 1 }}>
                  <span style={{ width: 42, flexShrink: 0, paddingTop: 7, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: INK }}>{b.start}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: GHOST }}>{b.end}</span>
                  </span>
                  <span style={{ width: 2, borderRadius: 2, background: b.kind === 'proposed' ? AMBER : '#E0D9C6', flexShrink: 0 }} />
                  <div style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 11px', borderRadius: 10,
                    background: b.kind === 'proposed' ? 'rgba(245,209,78,0.16)' : FIELD,
                    border: `1px solid ${b.kind === 'proposed' ? 'rgba(245,209,78,0.55)' : '#E8E1CE'}`,
                  }}>
                    {b.kind === 'proposed'
                      ? <CheckSquare size={13} strokeWidth={1.9} style={{ flexShrink: 0, color: MUTED }} />
                      : <Clock size={13} strokeWidth={1.9} style={{ flexShrink: 0, color: MUTED }} />}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.title}
                    </span>
                    <span style={{ fontSize: 11.5, color: GHOST, flexShrink: 0 }}>{b.meta}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 14px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: GHOST }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: AMBER }} /> Proposed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: GHOST }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#E0D9C6' }} /> Calendar
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
  const [briefEdit, setBriefEdit] = useState<string | null>(null)
  const [briefSeed, setBriefSeed] = useState(0)

  const [mail, setMail] = useState<MailRow[]>([])
  const [newsletters, setNewsletters] = useState(0)
  const [mailLoading, setMailLoading] = useState(true)
  const [mailError, setMailError] = useState<string | null>(null)

  const today = dayKey(clock)
  const writtenAt = useRef(new Date())

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
        const me = (user?.email ?? '').toLowerCase()
        rows.push({
          id: th.id,
          messageId: last.id,
          fromName: name || email,
          fromEmail: email,
          subject: header(headers, 'Subject') || '(no subject)',
          snippet: extractBody(last).replace(/\s+/g, ' ').trim().slice(0, 140),
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
          />
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <PlanCard
            blocks={blocks}
            freeMinutes={freeMinutes}
            focusMinutes={focusMinutes}
            dirty={!planAccepted}
            onAccept={acceptPlan}
            onAddBlock={() => setActiveModule('calendar')}
            onOpenCalendar={() => setActiveModule('calendar')}
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
