// ─── The New Event composer ──────────────────────────────────────────────────
// A pre-answered form. Everything in it arrives with the answer already in it —
// the duration you usually give this kind of thing, the provider your tenant
// uses, the calendar the account writes to — so the work is editing rather
// than filling. The shell is a cream panel holding white cards, and the
// separation between them is that ground rather than a border.
//
// On the values: the spec is written in hexes, and every one of them is a
// Sunlit Bento token — #191712 is --sb-ink-1, #F7F4EA is --sb-page, #F5D14E is
// --sb-accent, and so on. They are written as the tokens here so the composer
// follows a theme like the rest of the app; the handful with no exact token
// (the inset #FAF8F2, the dashed #DED6C0, the rust #A8503A) are mixed from the
// tokens either side of them.
//
// The radii are tokens too. The spec's 28 / 22 / 14 are, as it happens, exactly
// Glass & Depth's --sb-r-frame / -card / -nav, so following the tokens leaves
// that theme drawn to the spec and gives the other three their own corners —
// Warm's 8/6, Evergreen's 16/10. A composer with one shape in all four themes
// was the one place the shape contract did not reach.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapPin, Video, X, Trash2, CheckCircle2, XCircle, RefreshCw, Paperclip,
  Upload, List, ChevronDown, ChevronRight, Plus, Bell, ExternalLink,
} from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { loadDynamicCompanies } from '@/types'
import { toRecurrence, presetRecur, type Recur } from './recurrence'

// ─── The palette, once ───────────────────────────────────────────────────────

export const C = {
  ink:      'var(--sb-ink-1)',
  onInk:    'var(--sb-ink-on-dark)',
  page:     'var(--sb-page)',
  card:     'var(--sb-card)',
  /** The inset field and the muted chip — #FAF8F2. */
  inset:    'color-mix(in srgb, var(--sb-field) 88%, var(--sb-card))',
  border:   'var(--sb-border)',
  dashed:   'color-mix(in srgb, var(--sb-border) 78%, var(--sb-ink-4))',
  hair:     'var(--sb-hairline)',
  text:     'var(--sb-ink-1)',
  second:   'var(--sb-ink-2)',
  third:    'var(--sb-ink-3)',
  faint:    'var(--sb-ink-4)',
  gold:     'var(--sb-accent)',
  goldInk:  'var(--sb-accent-deep)',
  goldSurf: 'var(--sb-accent-tint)',
  goodInk:  'var(--sb-positive-deep)',
  goodSurf: 'var(--sb-positive-tint)',
  bad:      'var(--sb-negative-deep)',
} as const

export const MONO: React.CSSProperties = {
  fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: C.third, textTransform: 'none',
}
/**
 * One section of a panel: a white card on the shell's cream ground. The
 * separation between sections is that ground rather than a rule — which is
 * what makes a panel of eight sections readable at a glance instead of a
 * single column of banded text.
 */
export const CARD: React.CSSProperties = {
  background: C.card, borderRadius: 'var(--sb-r-card)', padding: '14px 15px',
  display: 'flex', flexDirection: 'column', minWidth: 0,
}
/** The first card needs nothing of its own now; kept so callers need not change. */
export const sectionTop: React.CSSProperties = CARD

/** A section's name: the task panel's SECTION_LABEL, to the letter. */
export const LABEL: React.CSSProperties = {
  margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: C.third,
}
export const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' }

/** The square that opens a row — place, call. Lit when the row is open. */
export function GLYPH(on: boolean): React.CSSProperties {
  return {
    width: 'var(--sb-h-pill)', height: 'var(--sb-h-pill)', borderRadius: 'var(--sb-r-sm)',
    flexShrink: 0, cursor: 'pointer', padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: on ? C.ink : C.inset,
    border: on ? 'var(--sb-border-width) solid transparent' : `var(--sb-border-width) solid ${C.border}`,
    color: on ? C.onInk : C.third,
  }
}

/** A pill: 999px, and the two states everything in here uses. */
export function pill(on: boolean, h?: number): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 11px',
    height: h ?? ('var(--sb-h-pill)' as unknown as number),
    borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
    fontSize: 'var(--sb-t-body-s)', fontWeight: 600, whiteSpace: 'nowrap',
    background: on ? C.ink : C.inset,
    border: on ? 'var(--sb-border-width) solid transparent' : `var(--sb-border-width) solid ${C.border}`,
    color: on ? C.onInk : C.third,
  }
}
/** The task panel's ICON_BTN: 28px, no chrome until you reach for it. */
export const ROUND: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer', color: C.third,
}
/** The task panel's CELL, to the letter. */
export const FIELD: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, height: 'var(--sb-h-pill)', boxSizing: 'border-box',
  padding: '0 11px', borderRadius: 'var(--sb-r-sm)', background: 'var(--sb-field)',
  border: `var(--sb-border-width) solid ${C.border}`,
  color: C.text, fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit', minWidth: 0,
}
export const BARE: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
  color: C.text, fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)',
}

/**
 * The shell both event panels are drawn in.
 *
 * It is docked, not floating: a column beside the grid, exactly the way the
 * task detail panel sits beside the board — same width clamp and expanded
 * width, same max height, same card, border, radius and shadow. A modal over
 * the calendar hid the thing the panel is about, which is the one thing you
 * need to see while you edit an event.
 *
 * `panelRef` + the 400ms guard is what dismisses it. A touch screen replays a
 * tap as a synthetic mousedown a moment after pointerup, at coordinates that
 * are by definition outside a panel which did not exist when the finger went
 * down — so a handler on anything outside opens and closes it in one gesture.
 */
export const PANEL_W = 'clamp(320px, 34vw, 440px)'
export const PANEL_W_WIDE = 'min(560px, 62vw)'

export function ComposerShell({ panelRef, onClose, expanded, children }: {
  panelRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  expanded?: boolean
  children: React.ReactNode
}) {
  useEffect(() => {
    const openedAt = Date.now()
    const away = (e: Event) => {
      if (Date.now() - openedAt < 400) return
      const t = e.target as HTMLElement
      // A click on the grid picks another event or draws a new one; it should
      // not also have to close this first.
      if (t.closest('.event-card, .sb-compose')) return
      if (panelRef.current && !panelRef.current.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose, panelRef])

  return (
    <aside
      ref={panelRef}
      className="sb-compose"
      style={{
        width: expanded ? PANEL_W_WIDE : PANEL_W,
        flexShrink: 0, alignSelf: 'flex-start', minWidth: 0,
        // The row it sits in has a definite height, so this is the row's — a
        // fixed viewport offset put the footer four pixels below the fold,
        // because it did not know how tall the calendar's own header was.
        // Off the grid on one side and off the window on the other. Flush
        // against both edges a panel reads as part of the frame rather than
        // as a thing sitting on top of it.
        margin: '0 14px 14px 6px',
        maxHeight: 'calc(100% - 14px)', overflowY: 'auto', scrollbarWidth: 'thin',
        background: C.page, border: `var(--sb-border-width) solid ${C.border}`,
        borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-control)',
        display: 'flex', flexDirection: 'column', gap: 10, padding: 10,
      }}>
      {children}
    </aside>
  )
}

// ─── What the composer is given, and what it gives back ──────────────────────

export interface ComposerInvitee {
  email: string
  optional?: boolean
  /** Google's own: needsAction | accepted | declined | tentative. */
  responseStatus?: string
}

/** What a reply is called, and the colour it is said in. */
export function rsvpOf(status: string | undefined): { label: string; bg: string; ink: string } {
  switch (status) {
    case 'accepted':  return { label: 'Yes',      bg: C.goodSurf, ink: C.goodInk }
    case 'declined':  return { label: 'No',       bg: 'var(--sb-negative-tint)', ink: C.bad }
    case 'tentative': return { label: 'Maybe',    bg: C.inset,    ink: C.third }
    default:          return { label: 'Awaiting', bg: C.goldSurf, ink: C.goldInk }
  }
}

export interface ComposerResult {
  title: string
  calId: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  allDay: boolean
  location?: string
  description?: string
  invitees: ComposerInvitee[]
  addMeet: boolean
  recurrence?: string[]
  visibility?: 'default' | 'private' | 'public'
  /** Set on the event the moment it exists, without leaving the composer. */
  status?: 'done' | 'cancelled'
}

/** What Google is told about an event that already exists. */
export type EventPatch = Partial<{
  summary: string
  location: string
  description: string
  start: { date?: string; dateTime?: string; timeZone?: string }
  end: { date?: string; dateTime?: string; timeZone?: string }
  attendees: { email: string; optional?: boolean }[]
  recurrence: string[]
  visibility: 'default' | 'private' | 'public'
  reminders: { useDefault: boolean; overrides?: { method: string; minutes: number }[] }
}>

/** An event that exists, in the shape the panel's own controls speak. */
export interface ExistingEvent {
  id: string
  title: string
  calId: string
  startDate: string
  /** '' when it is an all-day event. */
  startTime: string
  endTime: string
  allDay: boolean
  timeZone?: string
  location: string
  meetLink: string
  notes: string
  invitees: ComposerInvitee[]
  repeat: Recur | null
  files: { name: string; size: number; kind: string }[]
  visibility: 'default' | 'private' | 'public'
  status: 'done' | 'cancelled' | null
  /** Where Google would open it. */
  htmlLink?: string
}

export interface ComposerCalendar {
  id: string
  summary: string
  summaryOverride?: string
  primary?: boolean
  accessRole?: string
  accountEmail?: string
}

/** What an alert can be set to. Google's own default is the first. */
const ALERTS: [('default' | 'none' | number), string][] = [
  ['default', "The calendar's default"], ['none', 'None'], [0, 'At the time'],
  [5, '5 minutes before'], [10, '10 minutes before'], [30, '30 minutes before'],
  [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'],
]
function describeAlertMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`
  return `${m} min before`
}

/** What each provider is called, and what the button can honestly promise.
 *  The app never asks which one you use: it is a fact about the account the
 *  calendar belongs to, settled when that account was connected. */
const PROVIDER = {
  google: { name: 'Google Meet', hint: 'Google mints the link on the event itself' },
  teams:  { name: 'Teams',       hint: 'Outlook mints the link when the invitation goes out' },
} as const

const KINDS = ['Working session', 'Meeting', 'Focus', 'Class'] as const
type Kind = typeof KINDS[number]

/** What was used last time, so the next one arrives already answered. */
const MEM_KEY = 'cal-compose-memory'
interface Memory { minutes?: number; venue?: string; kind?: Kind }
function loadMemory(): Memory {
  try { return JSON.parse(localStorage.getItem(MEM_KEY) ?? '{}') as Memory } catch { return {} }
}
function saveMemory(m: Memory): void {
  try { localStorage.setItem(MEM_KEY, JSON.stringify({ ...loadMemory(), ...m })) } catch { /* quota */ }
}

const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
function initialsOf(s: string): string {
  const name = s.includes('@') ? s.split('@')[0].replace(/[._-]+/g, ' ') : s
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

export function NewEventPanel({
  draft, existing, calendars, organiser, provider = 'google',
  clashes, onSave, onCancel, onPush, onDelete, onMoveCalendar, extra,
  alertMinutes, onAlert, onAddMeet,
}: {
  draft: { dateStr: string; startMin: number; endMin: number }
  /** The event this panel is about, when it already exists. Absent means the
   *  panel is composing a new one — the only difference between the two. */
  existing?: ExistingEvent
  calendars: ComposerCalendar[]
  /** Whose calendar this is — the organiser row, and the company in the header. */
  organiser: string | undefined
  /** The tenant's conferencing: Teams for a Microsoft account, Meet otherwise. */
  provider?: 'google' | 'teams'
  /** What else is on the day, overlapping this. */
  clashes?: { id: string; summary?: string; when: string }[]
  onSave: (data: ComposerResult) => void
  onCancel: () => void
  /** Edit mode only: every change writes straight through. */
  onPush?: (patch: EventPatch) => void
  onDelete?: () => void
  /** Resolves to null on success, or to why the move did not happen. */
  onMoveCalendar?: (calId: string) => Promise<string | null>
  /** Anything only the existing-event panel has — prep, "open in Google". */
  extra?: React.ReactNode
  /** Minutes before the event, `undefined` for the calendar's own default. */
  alertMinutes?: number
  onAlert?: (v: 'default' | 'none' | number) => void
  /** Mint a Meet link on an event that already exists. */
  onAddMeet?: () => void
}) {
  const writable = calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
  const memory = useMemo(loadMemory, [])
  const editing = !!existing

  // Everything arrives answered: for a new event the length you usually give
  // this kind of thing, for an existing one what the event actually says.
  const startMin = draft.startMin
  const endMin = memory.minutes && !editing ? startMin + memory.minutes : draft.endMin

  const [title, setTitle] = useState(existing?.title ?? '')
  const [calId, setCalId] = useState(existing?.calId ?? (writable.find(c => c.primary) ?? writable[0])?.id ?? '')
  const [startDate, setStartDate] = useState(existing?.startDate ?? draft.dateStr)
  const [startTime, setStartTime] = useState(existing?.startTime ?? pad(startMin))
  const [endTime, setEndTime] = useState(existing?.endTime ?? pad(endMin))
  const [allDay, setAllDay] = useState(existing?.allDay ?? false)

  /** Which of place or call the shared row is showing. */
  const [whereRow, setWhereRow] = useState<'place' | 'call' | null>(
    existing?.location ? 'place' : existing?.meetLink ? 'call' : null)
  const [location, setLocation] = useState(existing?.location ?? '')
  const [meetLink, setMeetLink] = useState(existing?.meetLink ?? '')
  const [addMeet, setAddMeet] = useState(false)

  const [repeat, setRepeat] = useState<Recur | null>(existing?.repeat ?? null)
  const [endsMode, setEndsMode] = useState<'never' | 'count' | 'until'>(
    existing?.repeat?.count ? 'count' : existing?.repeat?.until ? 'until' : 'never')
  const [count, setCount] = useState(existing?.repeat?.count ?? 8)
  const [until, setUntil] = useState(existing?.repeat?.until ?? '')

  const [people, setPeople] = useState<ComposerInvitee[]>(existing?.invitees ?? [])
  const [invitee, setInvitee] = useState('')
  const [inviteeError, setInviteeError] = useState<string | null>(null)
  const inviteeRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<{ name: string; size: number; kind: string }[]>(existing?.files ?? [])
  const [dropping, setDropping] = useState(false)

  const [extrasOpen, setExtrasOpen] = useState(false)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [visibility, setVisibility] = useState<'default' | 'private' | 'public'>(existing?.visibility ?? 'default')
  const [status, setStatus] = useState<'done' | 'cancelled' | null>(existing?.status ?? null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const ref = useRef<HTMLDivElement>(null)
  // Completed and Cancelled carry their words when the panel is wide enough
  // for them beside the calendar name, and fall back to their glyphs when it
  // is not. A clamp from 320 to 440 cannot be answered with one guess.
  const [roomy, setRoomy] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setRoomy(e.contentRect.width >= 400))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const titleRef = useRef<HTMLInputElement>(null)
  // An existing event is read far more often than it is retitled; stealing the
  // caret on open would put the cursor in the one field you rarely want.
  useEffect(() => { if (!editing) titleRef.current?.focus() }, [editing])

  // ── Write-through ──────────────────────────────────────────────────────────
  // In edit mode there is no Save: each control writes as it is used. Words are
  // held back until you stop typing, or every keystroke is a request.
  const push = (patch: EventPatch) => { if (editing) onPush?.(patch) }
  const wordTimer = useRef<number | undefined>(undefined)
  const pushWords = (patch: EventPatch) => {
    if (!editing) return
    window.clearTimeout(wordTimer.current)
    wordTimer.current = window.setTimeout(() => onPush?.(patch), 700)
  }
  useEffect(() => () => window.clearTimeout(wordTimer.current), [])

  /** The times as Google wants them, from whatever the three controls now say. */
  function timesPatch(d: string, from: string, to: string, whole: boolean): EventPatch {
    if (whole) return { start: { date: d }, end: { date: d } }
    const tz = existing?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const [y, mo, da] = d.split('-').map(Number)
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = to.split(':').map(Number)
    return {
      start: { dateTime: new Date(y, mo - 1, da, fh, fm).toISOString(), timeZone: tz },
      end:   { dateTime: new Date(y, mo - 1, da, th, tm).toISOString(), timeZone: tz },
    }
  }
  const pushTimes = (d: string, from: string, to: string, whole = allDay) =>
    push(timesPatch(d, from, to, whole))

  function pushRepeat(r: Recur | null, mode: typeof endsMode, n: number, u: string) {
    const rule = r ? { ...r, ...(mode === 'count' ? { count: n } : {}), ...(mode === 'until' && u ? { until: u } : {}) } : null
    push({ recurrence: rule ? toRecurrence(rule) : [] })
  }
  const pushPeople = (next: ComposerInvitee[]) =>
    push({ attendees: next.map(a => ({ email: a.email, ...(a.optional ? { optional: true } : {}) })) })

  const company = useMemo(() => {
    const cal = calendars.find(c => c.id === calId)
    const cos = loadDynamicCompanies()
    const byCal = cos.find(co => co.calendarId && co.calendarId === calId)
    const byDomain = organiser ? cos.find(co => co.emailDomain && organiser.endsWith(co.emailDomain)) : undefined
    return byCal?.name ?? byDomain?.name ?? cal?.summaryOverride ?? cal?.summary ?? 'Calendar'
  }, [calId, calendars, organiser])

  const minutes = Math.max(0, toMin(endTime) - toMin(startTime))
  const guests = people.filter(p => !p.optional).length

  const startDateObj = useMemo(() => new Date(`${startDate}T12:00:00`), [startDate])
  const weekday = startDateObj.toLocaleDateString('en-GB', { weekday: 'short' })

  function setPreset(p: 'never' | 'weekly' | 'biweekly' | 'monthly' | 'custom') {
    const next: Recur | null =
      p === 'never'  ? null :
      p === 'custom' ? { freq: 'WEEKLY', interval: 3 } :
      presetRecur(p === 'biweekly' ? 'biweekly' : p, startDateObj)
    setRepeat(next)
    // Ends is Custom's to set. Choosing a preset after it means the preset,
    // so the fields go and what they held goes with them — leaving a stale
    // "after 8 times" attached to a plain Monthly is a rule nobody asked for.
    if (p !== 'custom') {
      setEndsMode('never'); setUntil(''); setCount(8)
      pushRepeat(next, 'never', 8, '')
      return
    }
    pushRepeat(next, endsMode, count, until)
  }
  const preset: string = !repeat ? 'never'
    : repeat.freq === 'WEEKLY' && repeat.interval === 1 ? 'weekly'
    : repeat.freq === 'WEEKLY' && repeat.interval === 2 ? 'biweekly'
    : repeat.freq === 'MONTHLY' ? 'monthly' : 'custom'

  function addPerson(raw: string) {
    const email = raw.trim().toLowerCase().replace(/,$/, '')
    if (!email) { setInvitee(''); setInviteeError(null); return }
    // Silently dropping what you typed is the worst possible answer: it reads
    // exactly like the field being broken, which is what it was reported as.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteeError(`${email} is not an email address`)
      return
    }
    if (people.some(p => p.email === email)) {
      setInviteeError(`${email} is already invited`)
      return
    }
    const next = [...people, { email }]
    setPeople(next); pushPeople(next)
    setInvitee(''); setInviteeError(null)
  }

  function submit() {
    if (!title.trim()) return
    saveMemory({ minutes, venue: location.trim() || undefined })
    const rule: Recur | null = repeat
      ? { ...repeat, ...(endsMode === 'count' ? { count } : {}), ...(endsMode === 'until' && until ? { until } : {}) }
      : null
    onSave({
      title: title.trim(),
      calId,
      startDate, startTime: allDay ? '' : startTime,
      endDate: startDate, endTime: allDay ? '' : endTime,
      allDay,
      location: location.trim() || undefined,
      description: [notes.trim(), meetLink.trim()].filter(Boolean).join('\n\n') || undefined,
      invitees: people,
      addMeet,
      ...(rule ? { recurrence: toRecurrence(rule) } : {}),
      ...(visibility !== 'default' ? { visibility } : {}),
      ...(status ? { status } : {}),
    })
  }

  return (
    <ComposerShell panelRef={ref} onClose={onCancel}>

      {/* ── 1 · Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 12px 0', minWidth: 0 }}>
        {/* The chip names the calendar and, on an event that exists, changes
            it — the picker is an invisible select the size of the chip. */}
        <span style={{ position: 'relative', display: 'inline-flex', flex: 1, minWidth: 0 }}>
          <span
            title={editing ? 'Move this to another calendar' : 'Which calendar it goes on'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%',
              fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
              letterSpacing: '-.02em', color: C.text,
              cursor: 'pointer',
            }}>
            <span style={{
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{company}</span>
            <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
          </span>
          {(
            <select
              value={calId}
              onChange={async e => {
                const to = e.target.value
                setMoveError(null)
                // On an event that exists this is a move, and Google may
                // refuse it; on one being composed it just picks where it
                // lands, and nothing can fail.
                if (!onMoveCalendar) { setCalId(to); return }
                const why = await onMoveCalendar(to)
                if (why) setMoveError(why); else setCalId(to)
              }}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              {writable.map(c => (
                <option key={c.id} value={c.id}>
                  {(c.summaryOverride ?? c.summary)}{c.accountEmail ? ` · ${c.accountEmail}` : ''}
                </option>
              ))}
            </select>
          )}
        </span>

        {/* Set, these are solid — a tint on a 28px circle is not a state you
            can read at a glance, and knowing an event is cancelled is the
            whole reason to look at it. */}
        {([
          { id: 'done' as const,      label: 'Completed', Icon: CheckCircle2,
            fill: 'var(--sb-positive)', ink: 'var(--sb-positive-deep)',
            on: 'Not done after all', off: 'Mark it done' },
          { id: 'cancelled' as const, label: 'Cancelled', Icon: XCircle,
            fill: 'var(--sb-negative)', ink: C.bad,
            on: 'Back on', off: 'Mark it cancelled' },
        ]).map(({ id, label, Icon, fill, ink, on, off }) => {
          const set = status === id
          return (
            <button
              key={id}
              title={set ? on : off}
              aria-pressed={set}
              onClick={() => setStatus(s => s === id ? null : id)}
              style={roomy ? {
                display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
                height: 26, padding: '0 10px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
                background: set ? fill : C.card,
                border: `var(--sb-border-width) solid ${set ? fill : C.border}`,
                color: set ? 'var(--sb-ink-on-fill)' : ink,
                boxShadow: set ? '0 1px 3px color-mix(in srgb, var(--sb-ink-1) 22%, transparent)' : undefined,
              } : {
                ...ROUND,
                background: set ? fill : 'transparent',
                color: set ? 'var(--sb-ink-on-fill)' : C.third,
                boxShadow: set ? '0 1px 3px color-mix(in srgb, var(--sb-ink-1) 22%, transparent)' : undefined,
              }}>
              <Icon size={ICON.sm} strokeWidth={set ? STROKE.active : STROKE.rest} />
              {roomy && label}
            </button>
          )
        })}
        <button
          title={editing ? 'Delete this event' : 'Discard this event'}
          onClick={() => {
            if (!window.confirm(editing ? 'Delete this event?' : 'Discard this event?')) return
            if (editing) onDelete?.(); else onCancel()
          }}
          style={{ ...ROUND, color: C.bad }}><Trash2 size={ICON.sm} strokeWidth={STROKE.rest} /></button>
        <button title="Close" onClick={onCancel} style={ROUND}>
          <X size={ICON.sm} strokeWidth={STROKE.rest} />
        </button>
      </div>

      {/* ── 2 · What ───────────────────────────────────────────────────────── */}
      <div style={{ ...sectionTop, gap: 12 }}>
        <input
          ref={titleRef}
          value={title}
          onChange={e => { setTitle(e.target.value); pushWords({ summary: e.target.value }) }}
          onKeyDown={e => { if (e.key === 'Enter' && !editing) submit() }}
          placeholder="Event title"
          style={{
            width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: 0,
            fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
            letterSpacing: '-.03em', lineHeight: 1, color: C.text,
          }} />

        {/* Where it is: both glyphs and one field, on one line. Two fields
            cannot share a 400px row and stay usable, so the glyphs swap which
            one is showing — and a glyph is lit when its side has something in
            it, so you can see there is a place even while the link is open. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <button
            title={location ? `Where: ${location}` : 'Add a place'}
            onClick={() => setWhereRow(r => r === 'place' ? null : 'place')}
            style={GLYPH(whereRow === 'place' || !!location)}>
            <MapPin size={16} strokeWidth={1.8} />
          </button>
          <button
            title={meetLink ? 'The call link' : 'Add a call'}
            onClick={() => setWhereRow(r => r === 'call' ? null : 'call')}
            style={GLYPH(whereRow === 'call' || !!meetLink)}>
            <Video size={16} strokeWidth={1.8} />
          </button>

          {whereRow === 'place' ? (
            <label style={{ ...FIELD, flex: 1, minWidth: 0 }}>
              <input
                autoFocus
                value={location}
                onChange={e => { setLocation(e.target.value); pushWords({ location: e.target.value }) }}
                placeholder="Room, office or address" style={BARE} />
              {memory.venue && !location && (
                <button onClick={() => { setLocation(memory.venue!); push({ location: memory.venue! }) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                    fontSize: 'var(--sb-t-meta)', color: C.faint,
                  }}>{memory.venue}</button>
              )}
            </label>
          ) : whereRow === 'call' ? (
            meetLink ? (
              <label style={{ ...FIELD, flex: 1, minWidth: 0 }}>
                <input value={meetLink} onChange={e => setMeetLink(e.target.value)}
                  placeholder="Meeting link" style={BARE} />
                <a href={meetLink} target="_blank" rel="noopener noreferrer" title="Open the call"
                  style={{ display: 'inline-flex', flexShrink: 0, color: C.third }}>
                  <ExternalLink size={ICON.sm} strokeWidth={1.8} />
                </a>
              </label>
            ) : (
              <button
                // On an event that exists Google mints the link now; on one
                // being composed it is minted on create, because there is no
                // event to hang a conference on yet.
                onClick={() => { if (editing) onAddMeet?.(); else setAddMeet(v => !v) }}
                title={PROVIDER[provider].hint}
                style={{
                  ...FIELD, flex: 1, minWidth: 0, cursor: 'pointer', justifyContent: 'flex-start', fontWeight: 600,
                  background: addMeet && !editing ? C.ink : 'var(--sb-field)',
                  border: `var(--sb-border-width) solid ${addMeet && !editing ? 'transparent' : C.border}`,
                  color: addMeet && !editing ? C.onInk : C.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                {addMeet && !editing ? `${PROVIDER[provider].name} on create` : `Create a ${PROVIDER[provider].name} link`}
              </button>
            )
          ) : (
            <span style={{
              flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', color: location || meetLink ? C.third : C.faint,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {location || (meetLink ? PROVIDER[provider].name : 'Add a place or a call')}
            </span>
          )}
        </div>
      </div>

      {/* ── 3 · When ───────────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 12 }}>
        <span style={MONO}>When</span>

        {/* Date, from, to and All day on one line. All day does not remove the
            times — it dims them, so you can still see what they were and
            turning it back off does not feel like starting again. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <label style={{
            position: 'relative',
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 'var(--sb-h-pill)', padding: '0 9px',
            borderRadius: 'var(--sb-r-sm)', background: C.ink, color: C.onInk, cursor: 'pointer',
            fontSize: 'var(--sb-t-meta)', fontWeight: 600, ...NUM, flexShrink: 0,
          }}>
            {startDateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            <input type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); pushTimes(e.target.value, startTime, endTime) }}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
          </label>

          <span style={{
            display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0,
            opacity: allDay ? 0.4 : 1, pointerEvents: allDay ? 'none' : undefined,
            transition: 'opacity 120ms ease-out',
          }}>
            <label style={{ ...FIELD, flex: '1 1 0', minWidth: 0, padding: '0 4px' }}>
              <input type="time" value={startTime} disabled={allDay}
                onChange={e => {
                  const v = e.target.value, to = pad(toMin(v) + minutes)
                  setStartTime(v); setEndTime(to); pushTimes(startDate, v, to)
                }}
                style={{ ...BARE, ...NUM, fontSize: 'var(--sb-t-meta)' }} />
            </label>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: C.faint, flexShrink: 0 }}>–</span>
            <label style={{ ...FIELD, flex: '1 1 0', minWidth: 0, padding: '0 4px' }}>
              <input type="time" value={endTime} disabled={allDay}
                onChange={e => { setEndTime(e.target.value); pushTimes(startDate, startTime, e.target.value) }}
                style={{ ...BARE, ...NUM, fontSize: 'var(--sb-t-meta)' }} />
            </label>
          </span>

          <button
            title={allDay ? 'Give it a time' : 'Make it all day'}
            onClick={() => { const v = !allDay; setAllDay(v); pushTimes(startDate, startTime, endTime, v) }}
            style={{ ...pill(allDay), padding: '0 9px', fontSize: 'var(--sb-t-meta)' }}>All day</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* One line. Five presets as pills wrapped onto three rows in a
              400px column for a choice that is made once, if ever. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <RefreshCw size={ICON.sm} strokeWidth={1.8} color={C.third} style={{ flexShrink: 0 }} />
            <span style={{ ...LABEL, flexShrink: 0 }}>Repeats</span>
            <label style={{ ...FIELD, flex: 1, minWidth: 0, position: 'relative' }}>
              <span style={{
                flex: 1, minWidth: 0, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {preset === 'never' ? 'Never'
                  : preset === 'weekly' ? `Weekly on ${weekday}`
                  : preset === 'biweekly' ? 'Every 2 weeks'
                  : preset === 'monthly' ? 'Monthly' : 'Custom'}
              </span>
              <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
              <select
                value={preset}
                onChange={e => setPreset(e.target.value as Parameters<typeof setPreset>[0])}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
                <option value="never">Never</option>
                <option value="weekly">{`Weekly on ${weekday}`}</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom — every 3 weeks</option>
              </select>
            </label>
            {repeat && endsMode === 'count' && (
              <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: C.goldInk, ...NUM, flexShrink: 0 }}>×{count}</span>
            )}
          </div>

          {/* Alert belongs to When — it is a fact about the time, not a section
              of its own — and it is one line, like Repeats above it. Seven
              pills wrapped onto three rows for a value that is set once. */}
          {editing && onAlert && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Bell size={ICON.sm} strokeWidth={1.8} color={C.third} style={{ flexShrink: 0 }} />
              <span style={{ ...LABEL, flexShrink: 0 }}>Alert</span>
              <label style={{ ...FIELD, flex: 1, minWidth: 0, position: 'relative' }}>
                <span style={{
                  flex: 1, minWidth: 0, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {alertMinutes === undefined ? "The calendar's default"
                    : alertMinutes < 0 ? 'None'
                    : alertMinutes === 0 ? 'At the time'
                    : describeAlertMinutes(alertMinutes)}
                </span>
                <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
                <select
                  value={alertMinutes === undefined ? 'default' : alertMinutes < 0 ? 'none' : String(alertMinutes)}
                  onChange={e => onAlert(e.target.value === 'default' ? 'default'
                    : e.target.value === 'none' ? 'none' : Number(e.target.value))}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
                  {ALERTS.map(([v, label]) => (
                    <option key={String(v)} value={String(v)}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}


          {repeat && preset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: C.faint }}>Ends</span>
              <label style={{ ...FIELD, flex: '1 1 120px', minWidth: 0 }}>
                <input type="date" value={until}
                  onChange={e => {
                    const mode = e.target.value ? 'until' : 'never'
                    setUntil(e.target.value); setEndsMode(mode)
                    pushRepeat(repeat, mode, count, e.target.value)
                  }}
                  style={{ ...BARE, ...NUM, fontSize: 'var(--sb-t-meta)' }} />
                <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
              </label>
              {endsMode === 'count' ? (
                <span style={{ ...pill(true), background: C.ink, gap: 5 }}>
                  After
                  <input type="number" min={1} max={99} value={count}
                    onChange={e => {
                      const n = Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1))
                      setCount(n); pushRepeat(repeat, 'count', n, until)
                    }}
                    style={{ ...BARE, ...NUM, flex: 'none', width: 26, padding: 0, textAlign: 'center',
                      fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: C.onInk }} />
                  times
                </span>
              ) : (
                <button onClick={() => { setEndsMode('count'); setUntil(''); pushRepeat(repeat, 'count', count, '') }}
                  style={{ ...pill(false), background: C.card }}>
                  After {count} times
                </button>
              )}
              <button onClick={() => { setEndsMode('never'); setUntil(''); pushRepeat(repeat, 'never', count, '') }}
                style={{ ...pill(endsMode === 'never'), background: endsMode === 'never' ? C.ink : C.card }}>
                Never
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── What it runs into ──────────────────────────────────────────────── */}
      {editing && clashes && clashes.length > 0 && (
        <div style={{ ...CARD, gap: 6 }}>
          <span style={{ ...LABEL, color: C.bad }}>
            Runs into {clashes.length === 1 ? 'something else' : `${clashes.length} other things`}
          </span>
          {clashes.map(c => (
            <span key={c.id} style={{
              display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0,
              fontSize: 'var(--sb-t-meta)', color: C.third,
            }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.summary || 'Untitled'}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ ...NUM, color: C.faint, flexShrink: 0 }}>{c.when}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── 4 · Attendees ──────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={MONO}>Attendees</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--sb-t-meta)', color: C.faint }}>Tap ? to make someone optional</span>
        </div>

        {/* The organiser is you, and is not a guest you can remove. */}
        <PersonRow
          initials={initialsOf(organiser ?? 'me')}
          avatarBg={C.ink}
          avatarInk={C.onInk}
          name={organiser ?? 'You'}
          sub="Organiser"
          rsvp={{ label: 'Organiser', bg: C.inset, ink: C.third }}
        />

        {people.map((p, i) => (
          <PersonRow
            key={p.email}
            initials={initialsOf(p.email)}
            avatarBg={i % 2 === 0 ? C.gold : `color-mix(in srgb, ${C.gold} 28%, var(--sb-field))`}
            avatarInk={C.text}
            name={p.email.split('@')[0].replace(/[._-]+/g, ' ')}
            sub={p.email}
            optional={p.optional}
            rsvp={rsvpOf(p.responseStatus)}
            onToggleOptional={() => {
              const next = people.map(x => x.email === p.email ? { ...x, optional: !x.optional } : x)
              setPeople(next); pushPeople(next)
            }}
            onRemove={() => {
              const next = people.filter(x => x.email !== p.email)
              setPeople(next); pushPeople(next)
            }}
          />
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0', minWidth: 0 }}>
          <button
            title="Add an invitee"
            onClick={() => inviteeRef.current?.focus()}
            style={{
              width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: `1px dashed ${C.dashed}`, color: C.faint,
            }}><Plus size={ICON.sm} strokeWidth={1.8} /></button>
          <input
            ref={inviteeRef}
            value={invitee}
            onChange={e => { setInvitee(e.target.value); if (inviteeError) setInviteeError(null) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPerson(invitee) } }}
            onBlur={() => { if (invitee.trim()) addPerson(invitee) }}
            placeholder="name@company.com"
            style={{ ...BARE, fontSize: 'var(--sb-t-body-s)' }} />
        </div>
        {inviteeError && (
          <span style={{ fontSize: 'var(--sb-t-meta)', color: C.bad, paddingLeft: 39 }}>{inviteeError}</span>
        )}
      </div>

      {/* ── 5 · Attachments ────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={MONO}>Attachments</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...pill(false), cursor: 'default', opacity: 0.55 }} title="Attaching needs Drive access, which this build does not ask for">
            <Upload size={ICON.sm} strokeWidth={1.8} /> Upload
          </span>
        </div>

        {files.map(f => (
          <div key={f.name} style={{
            display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px',
            borderRadius: 'var(--sb-r-nav)', background: C.inset,
          }}>
            <span style={{
              width: 26, height: 26, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, background: C.card,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: C.bad,
            }}>{f.kind}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: C.faint, ...NUM }}>
                {(f.size / 1048576).toFixed(1)} MB · not attached yet
              </span>
            </span>
            <button onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))}
              style={{ width: 26, height: 26, borderRadius: 'var(--sb-r-pill)', border: 'none', background: 'none', color: C.faint, cursor: 'pointer', flexShrink: 0 }}>
              <X size={ICON.sm} strokeWidth={1.8} />
            </button>
          </div>
        ))}

        <div
          onDragOver={e => { e.preventDefault(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onDrop={e => {
            e.preventDefault(); setDropping(false)
            const dropped = [...e.dataTransfer.files].map(f => ({
              name: f.name, size: f.size, kind: (f.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase(),
            }))
            setFiles(prev => [...prev, ...dropped.filter(d => !prev.some(p => p.name === d.name))])
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 13, borderRadius: 'var(--sb-r-nav)',
            border: `1px dashed ${C.dashed}`,
            background: dropping ? C.inset : 'transparent',
            fontSize: 'var(--sb-t-meta)', color: C.third,
          }}>
          <Paperclip size={ICON.sm} strokeWidth={1.8} color={C.faint} />
          Drop files here, or attach from Drive
        </div>
      </div>

      {/* ── 6 · The rest, folded away ──────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 10 }}>
        <button
          onClick={() => {
            const open = !extrasOpen
            setExtrasOpen(open)
            // Opening a section to write in and leaving the caret where it was
            // means every use of it costs an extra click.
            if (open) window.setTimeout(() => notesRef.current?.focus(), 0)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <List size={ICON.md} strokeWidth={1.8} color={C.third} />
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: C.third }}>Notes, calendar, visibility</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--sb-t-meta)', color: C.faint }}>defaults are fine</span>
          {extrasOpen
            ? <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} />
            : <ChevronRight size={ICON.sm} strokeWidth={1.8} color={C.faint} />}
        </button>

        {extrasOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <textarea
              ref={notesRef}
              value={notes}
              onChange={e => { setNotes(e.target.value); pushWords({ description: e.target.value }) }}
              rows={3}
              placeholder="Anything worth remembering…"
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px',
                borderRadius: 'var(--sb-r-nav)', background: C.inset, border: `1px solid ${C.border}`,
                fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: C.text, outline: 'none', lineHeight: 1.55,
              }} />

            <label style={FIELD}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: C.faint, flexShrink: 0 }}>Calendar</span>
              <select value={calId} onChange={e => setCalId(e.target.value)}
                style={{ ...BARE, cursor: 'pointer', appearance: 'none' }}>
                {writable.map(c => (
                  <option key={c.id} value={c.id}>{c.summaryOverride ?? c.summary}</option>
                ))}
              </select>
              <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: C.faint }}>Visible as</span>
              {([['default', 'Calendar default'], ['private', 'Private'], ['public', 'Public']] as const).map(([id, label]) => (
                <button key={id} onClick={() => { setVisibility(id); push({ visibility: id }) }} style={pill(visibility === id)}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {extra && <div style={{ ...CARD, gap: 8 }}>{extra}</div>}

      {moveError && (
        <div style={{ ...CARD, gap: 0, fontSize: 'var(--sb-t-meta)', color: C.bad }}>{moveError}</div>
      )}

      {/* ── 7 · Footer ─────────────────────────────────────────────────────── */}
      {/* Sticky, because the panel scrolls: the one button that finishes the
          job must not be somewhere you have to go looking for. */}
      {/* Sticky, because the panel scrolls. The right inset keeps the buttons
          out of the corner the assistant's floating button occupies — it is
          fixed to the viewport and sits over whatever is under it, which was
          Cancel. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        position: 'sticky', bottom: -10, padding: '10px 56px 4px 6px', marginTop: -2,
        background: C.page,
      }}>
        {editing ? (
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', color: C.faint }}>
            Every change saves itself.
          </span>
        ) : (
        <button
          onClick={submit}
          disabled={!title.trim()}
          aria-disabled={!title.trim()}
          style={{
            flex: '1 1 0', minWidth: 0, height: 'var(--sb-h-nav)', borderRadius: 'var(--sb-r-pill)', border: 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            background: C.ink, color: C.onInk, cursor: title.trim() ? 'pointer' : 'default',
            fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
            opacity: title.trim() ? 1 : 0.45,
          }}>
          {guests > 0 ? `Create & invite ${guests}` : 'Create event'}
        </button>
        )}
        <button onClick={onCancel}
          style={{
            height: 'var(--sb-h-nav)', padding: '0 14px', flexShrink: 0, borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
            background: C.inset, border: `var(--sb-border-width) solid ${C.border}`, color: C.third,
            fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
          }}>{editing ? 'Close' : 'Cancel'}</button>
      </div>
    </ComposerShell>
  )
}

// ─── One person in the list ──────────────────────────────────────────────────

function PersonRow({
  initials, avatarBg, avatarInk, name, sub, optional, rsvp, onToggleOptional, onRemove,
}: {
  initials: string
  avatarBg: string
  avatarInk: string
  name: string
  sub: string
  optional?: boolean
  rsvp: { label: string; bg: string; ink: string }
  onToggleOptional?: () => void
  onRemove?: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0', minWidth: 0,
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: avatarBg, color: avatarInk, fontSize: 'var(--sb-t-meta)', fontWeight: 700,
      }}>{initials}</span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{
            fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: C.text, textTransform: 'capitalize',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</span>
          {optional && (
            <span style={{
              height: 19, padding: '0 7px', borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center',
              background: C.inset, border: `1px solid ${C.border}`, color: C.faint,
              fontSize: 'var(--sb-t-micro)', fontWeight: 600,
            }}>Optional</span>
          )}
        </span>
        <span style={{
          display: 'block', fontSize: 'var(--sb-t-meta)', color: C.faint, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</span>
      </span>

      <span style={{
        height: 26, padding: '0 10px', borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center',
        background: rsvp.bg, color: rsvp.ink, fontSize: 'var(--sb-t-meta)', fontWeight: 600,
      }}>{rsvp.label}</span>

      {onToggleOptional && (
        <button
          onClick={onToggleOptional}
          title={optional ? 'Required again' : 'Make optional'}
          style={{
            width: 26, height: 26, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: optional ? C.ink : C.card,
            border: optional ? '1px solid transparent' : `1px solid ${C.border}`,
            color: optional ? C.onInk : C.faint,
            fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
          }}>?</button>
      )}
      {onRemove && (
        <button onClick={onRemove} title="Take them off the invite"
          style={{
            width: 26, height: 26, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, cursor: 'pointer',
            background: 'none', border: 'none', color: C.faint,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={ICON.sm} strokeWidth={1.8} /></button>
      )}
    </div>
  )
}
