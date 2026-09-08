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
import { createPortal } from 'react-dom'
import {
  MapPin, Video, X, Trash2, CheckCircle2, XCircle, RefreshCw, Paperclip,
  Upload, List, ChevronDown, ChevronRight, Plus,
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
  fontFamily: 'var(--sb-font-mono)', fontSize: 10.5, letterSpacing: '.14em',
  textTransform: 'uppercase', color: C.faint, fontWeight: 500,
}
export const CARD: React.CSSProperties = {
  background: C.card, borderRadius: 'var(--sb-r-card)', padding: '18px 20px',
  display: 'flex', flexDirection: 'column',
}
export const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' }

/** A pill: 999px, and the two states everything in here uses. */
export function pill(on: boolean, h = 32): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7, height: h, padding: '0 13px',
    borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
    fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
    background: on ? C.ink : C.inset,
    border: on ? '1px solid transparent' : `1px solid ${C.border}`,
    color: on ? C.onInk : C.third,
  }
}
export const ROUND: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: C.card, border: `1px solid ${C.border}`, cursor: 'pointer',
}
export const FIELD: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, height: 44, boxSizing: 'border-box',
  padding: '0 13px', borderRadius: 'var(--sb-r-nav)', background: C.inset, border: `1px solid ${C.border}`,
  color: C.text, fontSize: 13.5, fontFamily: 'inherit', minWidth: 0,
}
export const BARE: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
  color: C.text, fontFamily: 'inherit', fontSize: 13.5,
}

/**
 * The cream shell, and the backdrop it sits on.
 *
 * Both event panels are this: the composer before the event exists, the detail
 * panel after. Centred over the grid and portalled to the body — 680px beside
 * the grid left the thing you were looking at with nowhere to be, and the
 * calendar module's own `overflow` clipped a backdrop rendered in place.
 *
 * The backdrop deliberately has no dismiss handler of its own. A touch screen
 * replays a tap as a synthetic mousedown a moment after pointerup, at the same
 * coordinates — which are, by definition, outside a panel that did not exist
 * when the finger went down. `panelRef` + the 400ms guard below is the one
 * place that decides, so the panel cannot be opened and closed by one tap.
 */
export function ComposerShell({ panelRef, onClose, children }: {
  panelRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const openedAt = Date.now()
    const away = (e: Event) => {
      if (Date.now() - openedAt < 400) return
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
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

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000, display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center',
      padding: '5vh 20px 40px', overflowY: 'auto',
      background: 'color-mix(in srgb, var(--sb-ink-1) 34%, transparent)',
    }}>
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        className="sb-compose"
        style={{
          width: '100%', maxWidth: 680, alignSelf: 'flex-start',
          background: C.page, borderRadius: 'var(--sb-r-frame)', padding: '24px 22px 22px',
          display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden',
          boxShadow: '0 30px 80px -30px color-mix(in srgb, var(--sb-ink-1) 50%, transparent)',
        }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ─── What the composer is given, and what it gives back ──────────────────────

export interface ComposerInvitee { email: string; optional?: boolean }

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

export interface ComposerCalendar {
  id: string
  summary: string
  summaryOverride?: string
  primary?: boolean
  accessRole?: string
  accountEmail?: string
}

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
function niceTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`
}
function niceDuration(mins: number): string {
  if (mins <= 0) return 'no length'
  const h = Math.floor(mins / 60), m = mins % 60
  if (!h) return `${m} minutes`
  const hs = h === 1 ? '1 hour' : `${h} hours`
  return m ? `${hs} ${m}m` : hs
}
function initialsOf(s: string): string {
  const name = s.includes('@') ? s.split('@')[0].replace(/[._-]+/g, ' ') : s
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

export function NewEventPanel({
  draft, calendars, organiser, provider = 'google', onSave, onCancel,
}: {
  draft: { dateStr: string; startMin: number; endMin: number }
  calendars: ComposerCalendar[]
  /** Whose calendar this is — the organiser row, and the company in the header. */
  organiser: string | undefined
  /** The tenant's conferencing: Teams for a Microsoft account, Meet otherwise. */
  provider?: 'google' | 'teams'
  onSave: (data: ComposerResult) => void
  onCancel: () => void
}) {
  const writable = calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
  const memory = useMemo(loadMemory, [])

  // Everything arrives answered: the length you usually give this, the
  // calendar the account writes to, the provider the tenant uses.
  const drafted = Math.max(15, draft.endMin - draft.startMin)
  const startMin = draft.startMin
  const endMin = memory.minutes ? startMin + memory.minutes : draft.endMin

  const [title, setTitle] = useState('')
  const [calId, setCalId] = useState((writable.find(c => c.primary) ?? writable[0])?.id ?? '')
  const [startDate, setStartDate] = useState(draft.dateStr)
  const [startTime, setStartTime] = useState(pad(startMin))
  const [endTime, setEndTime] = useState(pad(endMin))
  const [allDay, setAllDay] = useState(false)
  const [kind, setKind] = useState<Kind>(memory.kind ?? 'Meeting')

  const [placeOpen, setPlaceOpen] = useState(false)
  const [onlineOpen, setOnlineOpen] = useState(false)
  const [location, setLocation] = useState('')
  const [meetLink, setMeetLink] = useState('')
  const [addMeet, setAddMeet] = useState(false)
  const [conf, setConf] = useState<'google' | 'teams'>(provider)

  const [repeat, setRepeat] = useState<Recur | null>(null)
  const [endsMode, setEndsMode] = useState<'never' | 'count' | 'until'>('never')
  const [count, setCount] = useState(8)
  const [until, setUntil] = useState('')

  const [people, setPeople] = useState<ComposerInvitee[]>([])
  const [invitee, setInvitee] = useState('')

  const [files, setFiles] = useState<{ name: string; size: number; kind: string }[]>([])
  const [dropping, setDropping] = useState(false)

  const [extrasOpen, setExtrasOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [visibility, setVisibility] = useState<'default' | 'private' | 'public'>('default')
  const [status, setStatus] = useState<'done' | 'cancelled' | null>(null)

  const ref = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  const company = useMemo(() => {
    const cal = calendars.find(c => c.id === calId)
    const cos = loadDynamicCompanies()
    const byCal = cos.find(co => co.calendarId && co.calendarId === calId)
    const byDomain = organiser ? cos.find(co => co.emailDomain && organiser.endsWith(co.emailDomain)) : undefined
    return byCal?.name ?? byDomain?.name ?? cal?.summaryOverride ?? cal?.summary ?? 'Calendar'
  }, [calId, calendars, organiser])

  const minutes = Math.max(0, toMin(endTime) - toMin(startTime))
  const usual = memory.minutes !== undefined && memory.minutes === minutes
  const guests = people.filter(p => !p.optional).length

  const startDateObj = useMemo(() => new Date(`${startDate}T12:00:00`), [startDate])
  const weekday = startDateObj.toLocaleDateString('en-GB', { weekday: 'short' })

  function setPreset(p: 'never' | 'weekly' | 'biweekly' | 'monthly' | 'custom') {
    if (p === 'never') { setRepeat(null); return }
    if (p === 'custom') { setRepeat({ freq: 'WEEKLY', interval: 3 }); return }
    setRepeat(presetRecur(p === 'biweekly' ? 'biweekly' : p, startDateObj))
  }
  const preset: string = !repeat ? 'never'
    : repeat.freq === 'WEEKLY' && repeat.interval === 1 ? 'weekly'
    : repeat.freq === 'WEEKLY' && repeat.interval === 2 ? 'biweekly'
    : repeat.freq === 'MONTHLY' ? 'monthly' : 'custom'

  function addPerson(raw: string) {
    const email = raw.trim().toLowerCase().replace(/,$/, '')
    if (email && email.includes('@') && !people.some(p => p.email === email)) {
      setPeople(prev => [...prev, { email }])
    }
    setInvitee('')
  }

  function submit() {
    if (!title.trim()) return
    saveMemory({ minutes, venue: location.trim() || undefined, kind })
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 4px', flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--sb-font-num)', fontSize: 15.5, fontWeight: 600,
          letterSpacing: '-.03em', color: C.text, flex: 1, minWidth: 0,
        }}>{company}</span>

        <button onClick={() => setStatus(s => s === 'done' ? null : 'done')}
          style={{ ...pill(false), height: 32, background: status === 'done' ? C.goodSurf : C.card, color: C.goodInk }}>
          <CheckCircle2 size={ICON.sm} strokeWidth={STROKE.rest} /> Completed
        </button>
        <button onClick={() => setStatus(s => s === 'cancelled' ? null : 'cancelled')}
          style={{ ...pill(false), height: 32, background: status === 'cancelled' ? C.goodSurf : C.card, color: C.bad }}>
          <XCircle size={ICON.sm} strokeWidth={STROKE.rest} /> Cancelled
        </button>

        <span style={{ width: 1, height: 22, background: `color-mix(in srgb, ${C.border} 88%, var(--sb-ink-4))`, flexShrink: 0 }} />

        <button
          title="Discard this event"
          onClick={() => { if (window.confirm('Discard this event?')) onCancel() }}
          style={{ ...ROUND, color: C.bad }}><Trash2 size={ICON.sm} strokeWidth={STROKE.rest} /></button>
        <button title="Close" onClick={onCancel} style={{ ...ROUND, color: C.third }}>
          <X size={ICON.sm} strokeWidth={STROKE.rest} />
        </button>
      </div>

      {/* ── 2 · What ───────────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 13 }}>
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Event title"
          style={{
            width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: 0,
            fontFamily: 'var(--sb-font-num)', fontSize: 27, fontWeight: 600,
            letterSpacing: '-.03em', lineHeight: 1, color: C.text,
          }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {([
            { on: placeOpen, set: setPlaceOpen, Icon: MapPin, title: 'Add a place' },
            { on: onlineOpen, set: setOnlineOpen, Icon: Video, title: 'Add a call' },
          ]).map(({ on, set, Icon, title: t }) => (
            <button key={t} title={t} onClick={() => set(v => !v)}
              style={{
                width: 38, height: 38, borderRadius: 'var(--sb-r-sm)', flexShrink: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: on ? C.ink : C.inset,
                border: on ? '1px solid transparent' : `1px solid ${C.border}`,
                color: on ? C.onInk : C.third,
              }}>
              <Icon size={17} strokeWidth={1.8} />
            </button>
          ))}
          {!placeOpen && !onlineOpen && (
            <span style={{ fontSize: 12.5, color: C.faint }}>Tap to add a place or a call</span>
          )}
        </div>

        {(placeOpen || onlineOpen) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {placeOpen && (
              <label style={FIELD}>
                <MapPin size={ICON.md} strokeWidth={1.8} color={C.third} style={{ flexShrink: 0 }} />
                <input value={location} onChange={e => setLocation(e.target.value)}
                  placeholder="Add a place" style={BARE} />
                {memory.venue && !location && (
                  <button onClick={() => setLocation(memory.venue!)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, color: C.faint, flexShrink: 0 }}>
                    Recent: {memory.venue}
                  </button>
                )}
              </label>
            )}

            {onlineOpen && (
              <>
                <label style={FIELD}>
                  <Video size={ICON.md} strokeWidth={1.8} color={C.third} style={{ flexShrink: 0 }} />
                  <input value={meetLink} onChange={e => setMeetLink(e.target.value)}
                    placeholder="Paste a meeting link" style={BARE} />
                  <button
                    onClick={() => setAddMeet(v => !v)}
                    title={conf === 'teams'
                      ? 'A Teams link is made by Outlook when the invitation goes out'
                      : 'Google makes the link when the event is created'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 11px',
                      borderRadius: 'var(--sb-r-sm)', border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: addMeet ? C.ink : C.card,
                      color: addMeet ? C.onInk : C.text,
                      fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                    }}>
                    {conf === 'teams' ? 'Create Teams link' : 'Create Google Meet'}
                    <ChevronDown size={ICON.sm} strokeWidth={1.8} />
                  </button>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, color: C.faint }}>Your workspace provider</span>
                  {([['google', 'Google Meet'], ['teams', 'Microsoft Teams']] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setConf(id)}
                      style={{ ...pill(false, 30), background: conf === id ? C.inset : C.card }}>
                      {conf === id && <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: C.ink }} />}
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {KINDS.map(k => (
            <button key={k} onClick={() => setKind(k)} style={pill(kind === k)}>
              {kind === k && <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: C.gold }} />}
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* ── 3 · When ───────────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={MONO}>WHEN</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.goldInk, ...NUM }}>
            {allDay
              ? 'All day'
              : `${niceTime(startTime)} – ${niceTime(endTime)} · ${niceDuration(minutes)}`}
            {allDay ? '' : usual ? ' · your usual for this' : minutes === drafted ? ' · as drawn' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 14px',
            borderRadius: 'var(--sb-r-nav)', background: C.ink, color: C.onInk, cursor: 'pointer',
            fontSize: 15, fontWeight: 600, ...NUM, flexShrink: 0,
          }}>
            {startDateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ width: 0, opacity: 0, position: 'absolute', pointerEvents: 'none' }} />
            <ChevronDown size={ICON.sm} strokeWidth={1.8} />
          </label>

          {!allDay && (
            <>
              <label style={{ ...FIELD, width: 134, padding: '0 10px', flexShrink: 0 }}>
                <input type="time" value={startTime}
                  onChange={e => { const v = e.target.value; setStartTime(v); setEndTime(pad(toMin(v) + minutes)) }}
                  style={{ ...BARE, ...NUM }} />
              </label>
              <span style={{ fontSize: 12.5, color: C.faint }}>to</span>
              <label style={{ ...FIELD, width: 134, padding: '0 10px', flexShrink: 0 }}>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  style={{ ...BARE, ...NUM }} />
              </label>
            </>
          )}
          <button onClick={() => setAllDay(v => !v)} style={pill(allDay, 34)}>All day</button>
        </div>

        <div style={{ height: 1, background: C.hair }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <RefreshCw size={ICON.sm} strokeWidth={1.8} color={C.third} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>Repeats</span>
            <span style={{ flex: 1 }} />
            {repeat && endsMode === 'count' && (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.goldInk, ...NUM }}>{count} occurrences</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {([
              ['never', 'Never'],
              ['weekly', `Weekly on ${weekday}`],
              ['biweekly', 'Every 2 weeks'],
              ['monthly', 'Monthly'],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setPreset(id)} style={pill(preset === id, 34)}>{label}</button>
            ))}
            <button onClick={() => setPreset('custom')}
              style={{ ...pill(preset === 'custom', 34), border: `1px dashed ${C.dashed}` }}>Custom…</button>
          </div>

          {repeat && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: C.faint }}>Ends</span>
              <label style={{ ...FIELD, height: 38, width: 168, flexShrink: 0 }}>
                <input type="date" value={until}
                  onChange={e => { setUntil(e.target.value); setEndsMode(e.target.value ? 'until' : 'never') }}
                  style={{ ...BARE, ...NUM, fontSize: 12.5 }} />
                <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
              </label>
              {endsMode === 'count' ? (
                <span style={{ ...pill(true, 30), background: C.ink, gap: 5 }}>
                  After
                  <input type="number" min={1} max={99} value={count}
                    onChange={e => setCount(Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
                    style={{ ...BARE, ...NUM, flex: 'none', width: 26, padding: 0, textAlign: 'center',
                      fontSize: 12.5, fontWeight: 600, color: C.onInk }} />
                  times
                </span>
              ) : (
                <button onClick={() => { setEndsMode('count'); setUntil('') }}
                  style={{ ...pill(false, 30), background: C.card }}>
                  After {count} times
                </button>
              )}
              <button onClick={() => { setEndsMode('never'); setUntil('') }}
                style={{ ...pill(endsMode === 'never', 30), background: endsMode === 'never' ? C.ink : C.card }}>
                Never
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 4 · Attendees ──────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={MONO}>ATTENDEES</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: C.faint }}>Tap ? to make someone optional</span>
        </div>

        {/* The organiser is you, and is not a guest you can remove. */}
        <PersonRow
          first
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
            first={false}
            initials={initialsOf(p.email)}
            avatarBg={i % 2 === 0 ? C.gold : `color-mix(in srgb, ${C.gold} 28%, var(--sb-field))`}
            avatarInk={C.text}
            name={p.email.split('@')[0].replace(/[._-]+/g, ' ')}
            sub={p.email}
            optional={p.optional}
            rsvp={{ label: 'Awaiting', bg: C.goldSurf, ink: C.goldInk }}
            onToggleOptional={() => setPeople(prev => prev.map(x =>
              x.email === p.email ? { ...x, optional: !x.optional } : x))}
            onRemove={() => setPeople(prev => prev.filter(x => x.email !== p.email))}
          />
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0', borderTop: `1px solid ${C.hair}` }}>
          <span style={{
            width: 34, height: 34, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px dashed ${C.dashed}`, color: C.faint,
          }}><Plus size={ICON.sm} strokeWidth={1.8} /></span>
          <input
            value={invitee}
            onChange={e => setInvitee(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPerson(invitee) } }}
            onBlur={() => invitee && addPerson(invitee)}
            placeholder="name@company.com"
            style={{ ...BARE, fontSize: 13 }} />
        </div>
      </div>

      {/* ── 5 · Attachments ────────────────────────────────────────────────── */}
      <div style={{ ...CARD, gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={MONO}>ATTACHMENTS</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...pill(false, 30), cursor: 'default', opacity: 0.55 }} title="Attaching needs Drive access, which this build does not ask for">
            <Upload size={ICON.sm} strokeWidth={1.8} /> Upload
          </span>
        </div>

        {files.map(f => (
          <div key={f.name} style={{
            display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px',
            borderRadius: 'var(--sb-r-nav)', background: C.inset,
          }}>
            <span style={{
              width: 30, height: 30, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, background: C.card,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--sb-font-mono)', fontSize: 9, fontWeight: 700, color: C.bad,
            }}>{f.kind}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: C.faint, ...NUM }}>
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
            fontSize: 12.5, color: C.third,
          }}>
          <Paperclip size={ICON.sm} strokeWidth={1.8} color={C.faint} />
          Drop files here, or attach from Drive
        </div>
      </div>

      {/* ── 6 · The rest, folded away ──────────────────────────────────────── */}
      <div style={{ background: C.card, borderRadius: 'var(--sb-r-card)', padding: extrasOpen ? '14px 18px 16px' : '14px 18px' }}>
        <button
          onClick={() => setExtrasOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <List size={ICON.md} strokeWidth={1.8} color={C.third} />
          <span style={{ fontSize: 13.5, color: C.third }}>Notes, calendar, visibility</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: C.faint }}>defaults are fine</span>
          {extrasOpen
            ? <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} />
            : <ChevronRight size={ICON.sm} strokeWidth={1.8} color={C.faint} />}
        </button>

        {extrasOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything worth remembering…"
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px',
                borderRadius: 'var(--sb-r-nav)', background: C.inset, border: `1px solid ${C.border}`,
                fontFamily: 'inherit', fontSize: 13.5, color: C.text, outline: 'none', lineHeight: 1.55,
              }} />

            <label style={FIELD}>
              <span style={{ fontSize: 12.5, color: C.faint, flexShrink: 0 }}>Calendar</span>
              <select value={calId} onChange={e => setCalId(e.target.value)}
                style={{ ...BARE, cursor: 'pointer', appearance: 'none' }}>
                {writable.map(c => (
                  <option key={c.id} value={c.id}>{c.summaryOverride ?? c.summary}</option>
                ))}
              </select>
              <ChevronDown size={ICON.sm} strokeWidth={1.8} color={C.faint} style={{ flexShrink: 0 }} />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: C.faint }}>Visible as</span>
              {([['default', 'Calendar default'], ['private', 'Private'], ['public', 'Public']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setVisibility(id)} style={pill(visibility === id, 30)}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 7 · Footer ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={submit}
          disabled={!title.trim()}
          aria-disabled={!title.trim()}
          style={{
            flex: 1, height: 52, borderRadius: 'var(--sb-r-pill)', border: 'none',
            background: C.ink, color: C.onInk, cursor: title.trim() ? 'pointer' : 'default',
            fontFamily: 'inherit', fontSize: 15, fontWeight: 600,
            opacity: title.trim() ? 1 : 0.45,
          }}>
          {guests > 0 ? `Create & invite ${guests}` : 'Create event'}
        </button>
        <button onClick={onCancel}
          style={{
            height: 52, padding: '0 22px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
            background: C.card, border: `1px solid ${C.border}`, color: C.third,
            fontFamily: 'inherit', fontSize: 14,
          }}>Cancel</button>
      </div>
    </ComposerShell>
  )
}

// ─── One person in the list ──────────────────────────────────────────────────

function PersonRow({
  first, initials, avatarBg, avatarInk, name, sub, optional, rsvp, onToggleOptional, onRemove,
}: {
  first: boolean
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
      display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0', minWidth: 0,
      ...(first ? null : { borderTop: `1px solid ${C.hair}` }),
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: avatarBg, color: avatarInk, fontSize: 11.5, fontWeight: 700,
      }}>{initials}</span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{
            fontSize: 13.5, fontWeight: 600, color: C.text, textTransform: 'capitalize',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</span>
          {optional && (
            <span style={{
              height: 19, padding: '0 7px', borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center',
              background: C.inset, border: `1px solid ${C.border}`, color: C.faint,
              fontSize: 10.5, fontWeight: 600,
            }}>Optional</span>
          )}
        </span>
        <span style={{
          display: 'block', fontSize: 11.5, color: C.faint, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</span>
      </span>

      <span style={{
        height: 26, padding: '0 10px', borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center',
        background: rsvp.bg, color: rsvp.ink, fontSize: 11.5, fontWeight: 600,
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
            fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
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
