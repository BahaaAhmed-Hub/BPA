// ─── The day rail ────────────────────────────────────────────────────────────
// The right-hand column of the calendar panel: what today actually holds, one
// row per event, and the Professor's reading of it underneath.
//
// The grid answers "when". The rail answers "where does this stand" — whether
// each event is running, accepted, still waiting on you, or off — and that is
// the part that carries the product's voice. It never repeats the grid's job:
// no hour ticks, no columns, no drag targets.
//
// Colour policy here is P14's, without exception. The theme paints every
// surface and every glyph; an event's own calendar colour appears once, as a
// 3px rail down the left inner edge of its row, and nowhere else.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, Clock } from 'lucide-react'
import type { GCalEvent } from '@/lib/googleCalendar'
import * as professor from '@/lib/professor'
import { ICON, STROKE } from '@/lib/type'

const MONO    = 'var(--sb-font-mono)'
const DISPLAY = 'var(--sb-font-num)'

/** Uppercase mono, the panel's one label voice. `current` is the state the
 *  concept marks as active — gold ink, never the generic secondary grey. */
export function Label({ children, current, style }: {
  children: React.ReactNode
  current?: boolean
  style?: React.CSSProperties
}) {
  return (
    <span style={{
      fontFamily: MONO, fontSize: 10.5, fontWeight: 500, letterSpacing: '.14em',
      textTransform: 'uppercase', color: current ? 'var(--sb-accent-deep)' : 'var(--sb-ink-4)',
      ...style,
    }}>{children}</span>
  )
}

/** The brand mark: an ink disc carrying a cream P. It replaced a Lucide
 *  placeholder, which said "some app" where the product's own initial belongs. */
export function PMark({ size = 26 }: { size?: number }) {
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)',
      fontFamily: DISPLAY, fontWeight: 600, fontSize: Math.round(size * 0.5),
      lineHeight: 1, letterSpacing: '-0.02em',
    }}>P</span>
  )
}

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', borderRadius: 22, padding: '18px 20px',
  display: 'flex', flexDirection: 'column', minWidth: 0,
}

// ─── What a row's status is ──────────────────────────────────────────────────
// Two different things decide it. The app's own note (done / cancelled) wins,
// because it is the more recent human judgement; otherwise it is the reply you
// gave Google, and "running right now" beats both.

type RowState = 'live' | 'accepted' | 'awaiting' | 'declined' | 'done'

function startMs(e: GCalEvent): number {
  const s = e.start?.dateTime ?? e.start?.date
  return s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).getTime() : 0
}
function endMs(e: GCalEvent): number {
  const s = e.end?.dateTime ?? e.end?.date
  return s ? new Date(s.length === 10 ? `${s}T23:59:59` : s).getTime() : startMs(e)
}

function rowState(e: GCalEvent, own: 'done' | 'cancelled' | undefined, now: number): RowState {
  if (own === 'done') return 'done'
  if (own === 'cancelled') return 'declined'
  const me = (e.attendees ?? []).find(a => a.self)
  if (me?.responseStatus === 'declined') return 'declined'
  if (startMs(e) <= now && now < endMs(e)) return 'live'
  if (me?.responseStatus === 'accepted') return 'accepted'
  if (me && me.responseStatus !== 'accepted') return 'awaiting'
  return 'accepted'
}

function StatusDisc({ state }: { state: RowState }) {
  const box: React.CSSProperties = {
    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  if (state === 'live') return (
    <span style={{ ...box, background: 'var(--sb-accent-tint2)' }} title="Happening now">
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sb-cal-live)' }} />
    </span>
  )
  if (state === 'accepted') return (
    <span style={{ ...box, background: 'var(--sb-positive-tint)', color: 'var(--sb-positive-deep)' }} title="Accepted">
      <Check size={13} strokeWidth={STROKE.active} />
    </span>
  )
  if (state === 'awaiting') return (
    <span style={{ ...box, background: 'var(--sb-accent-tint2)', color: 'var(--sb-accent-deep)' }} title="Waiting on your answer">
      <Clock size={13} strokeWidth={STROKE.rest} />
    </span>
  )
  if (state === 'declined') return (
    <span style={{ ...box, background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-negative-deep)' }} title="Declined">
      <X size={13} strokeWidth={STROKE.active} />
    </span>
  )
  return (
    <span style={{ ...box, background: 'var(--sb-field)', color: 'var(--sb-ink-4)' }} title="Done">
      <Check size={13} strokeWidth={STROKE.active} />
    </span>
  )
}

function hhmm(e: GCalEvent): string {
  const s = e.start?.dateTime
  if (!s) return 'All day'
  const d = new Date(s)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The quiet second line: where it is, or who is in it. */
function subLine(e: GCalEvent): string {
  const guests = (e.attendees ?? []).filter(a => !a.self).length
  const meet = (e.conferenceData?.entryPoints ?? []).some(p => p.entryPointType === 'video')
  if (guests > 0) return `${guests} guest${guests === 1 ? '' : 's'}${meet ? ' · Google Meet' : ''}`
  return e.location ?? (meet ? 'Google Meet' : '')
}

export interface RailEvent {
  event: GCalEvent
  /** The calendar's colour. The only raw data colour the rail may draw. */
  tone?: string
  own?: 'done' | 'cancelled'
}

function EventRow({ row, first, now, onOpen }: {
  row: RailEvent
  first: boolean
  now: number
  onOpen: () => void
}) {
  const st = rowState(row.event, row.own, now)
  const off = st === 'declined'
  const sub = subLine(row.event)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="cal-ctl"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        // The rail is an inner edge, so the row carries its own left inset.
        padding: '11px 0 11px 11px', position: 'relative',
        border: 'none', borderTop: first ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
        background: 'transparent', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', borderRadius: 0,
      }}>
      {/* P14's identity rail: full row height, the source colour, and the only
          place on this card where a calendar's own hue is drawn. */}
      <span aria-hidden style={{
        position: 'absolute', left: 0, top: first ? 6 : 7, bottom: 6, width: 3,
        borderRadius: 999, background: row.tone ?? 'var(--sb-border)',
        opacity: off ? 0.4 : 1,
      }} />
      <StatusDisc state={st} />
      <span style={{
        width: 52, flexShrink: 0, textAlign: 'right',
        fontSize: 11.5, color: 'var(--sb-ink-2)', fontVariantNumeric: 'tabular-nums',
      }}>{hhmm(row.event)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 13.5, fontWeight: 600,
          color: off ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
          textDecoration: off ? 'line-through' : 'none', textDecorationThickness: 1.5,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.event.summary || '(no title)'}</span>
        {sub && (
          <span style={{
            display: 'block', fontSize: 11.5, color: 'var(--sb-ink-4)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sub}</span>
        )}
      </span>
    </button>
  )
}

/** Minutes two events share. Zero when they do not touch. */
function overlapMinutes(a: GCalEvent, b: GCalEvent): number {
  const s = Math.max(startMs(a), startMs(b))
  const e = Math.min(endMs(a), endMs(b))
  return e > s ? Math.round((e - s) / 60000) : 0
}

/** A clashing pair, drawn as one block so the two rows read as one problem. */
function Clash({ pair, mins, now, onOpen, onReschedule }: {
  pair: [RailEvent, RailEvent]
  mins: number
  now: number
  onOpen: (r: RailEvent) => void
  onReschedule: (r: RailEvent) => void
}) {
  const later = startMs(pair[0].event) >= startMs(pair[1].event) ? pair[0] : pair[1]
  const bothWant = pair.every(p => (p.event.attendees?.length ?? 0) > 0)
  return (
    <div style={{
      background: 'var(--sb-accent-tint2)', borderRadius: 14, padding: '9px 11px',
      display: 'flex', flexDirection: 'column', gap: 4, margin: '7px 0',
    }}>
      <span style={{
        alignSelf: 'flex-start', height: 19, display: 'inline-flex', alignItems: 'center',
        padding: '0 7px', borderRadius: 6, background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)',
        fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
      }}>Clash</span>
      {pair.map((r, i) => (
        <EventRow key={r.event.id} row={r} first={i === 0} now={now} onOpen={() => onOpen(r)} />
      ))}
      <span style={{ fontSize: 12.5, color: 'var(--sb-accent-deep)', fontVariantNumeric: 'tabular-nums' }}>
        {mins} min overlap{bothWant ? ' · both need you' : ''}
      </span>
      <button
        type="button"
        className="cal-ctl"
        onClick={() => onReschedule(later)}
        style={{
          alignSelf: 'flex-start', height: 30, padding: '0 12px', borderRadius: 999,
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
          color: 'var(--sb-ink-2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
          cursor: 'pointer', marginTop: 3,
        }}>Reschedule later one</button>
    </div>
  )
}

// ─── The Professor card ──────────────────────────────────────────────────────
// Advice about the day, never a summary of the screen. "You have four events"
// is something the person can already see; "move the 1:1 and you keep both" is
// not. The prompt says so explicitly, because a model handed a list of events
// will describe the list unless told what the reader already knows.

interface Advice { text: string; actions: string[] }

const SYSTEM = [
  'You are the Professor, the calendar assistant inside a personal operating system.',
  'You are given the events on one day. Reply with plain advice about that day, in at most',
  'three sentences, in the second person. Never summarise what is on screen — the reader can',
  'already see the list. Say what to do about it, and be specific about times and names.',
  'If two events overlap, say by how much and which one to move. If the day is quiet, say what',
  'it is good for. No greeting, no sign-off, no markdown, no bullet points.',
  'Then, on a final line beginning "ACTIONS:", give up to two short verb-first button labels',
  'separated by " | " (for example "Move the 1:1 | Leave it"). Omit that line if there is',
  'nothing to act on.',
].join(' ')

function parseAdvice(raw: string): Advice {
  const lines = raw.trim().split('\n')
  const i = lines.findIndex(l => l.trim().toUpperCase().startsWith('ACTIONS:'))
  if (i < 0) return { text: raw.trim(), actions: [] }
  const actions = lines[i].slice(lines[i].indexOf(':') + 1).split('|')
    .map(s => s.trim()).filter(Boolean).slice(0, 2)
  return { text: lines.slice(0, i).join('\n').trim(), actions }
}

function Skeleton() {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }} aria-hidden>
      {['100%', '92%', '64%'].map(w => (
        <span key={w} style={{ height: 11, width: w, borderRadius: 999, background: 'var(--sb-hairline)' }} />
      ))}
    </span>
  )
}

export function ProfessorCard({ rows, dayLabel }: { rows: RailEvent[]; dayLabel: string }) {
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // Keyed on the day and its events, so a re-render does not re-ask and a
  // changed day does.
  const asked = useRef<string>('')

  const key = useMemo(
    () => `${dayLabel}|${rows.map(r => `${r.event.id}:${r.event.start?.dateTime ?? ''}`).join(',')}`,
    [dayLabel, rows])

  useEffect(() => {
    if (asked.current === key) return
    asked.current = key
    setAdvice(null); setFailed(null)
    if (rows.length === 0) return
    setLoading(true)
    const lines = rows.map(r => {
      const s = r.event.start?.dateTime, e = r.event.end?.dateTime
      const t = s && e
        ? `${new Date(s).toTimeString().slice(0, 5)}–${new Date(e).toTimeString().slice(0, 5)}`
        : 'all day'
      const g = (r.event.attendees ?? []).filter(a => !a.self).length
      return `${t} ${r.event.summary || '(no title)'}${g ? ` (${g} guests)` : ''}`
    }).join('\n')
    let live = true
    professor.call(SYSTEM, `${dayLabel}\n${lines}`)
      .then(raw => { if (live) setAdvice(parseAdvice(raw)) })
      .catch((err: unknown) => { if (live) setFailed(err instanceof Error ? err.message : 'Could not reach the Professor') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [key, rows, dayLabel])

  const body = rows.length === 0
    ? 'Nothing on this day. Good day to write.'
    : advice?.text ?? failed ?? ''

  return (
    <div style={{ ...CARD, gap: 11 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <PMark size={26} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sb-ink-1)' }}>Professor</span>
        <span style={{ flex: 1 }} />
        <span style={{
          height: 19, display: 'inline-flex', alignItems: 'center', padding: '0 7px', borderRadius: 6,
          background: 'var(--sb-accent-tint2)', color: 'var(--sb-accent-deep)',
          fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
        }}>Beta</span>
      </span>

      {loading ? <Skeleton /> : (
        <span style={{
          fontSize: 15, lineHeight: 1.45, color: failed ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
          fontVariantNumeric: 'tabular-nums',
        }}>{body}</span>
      )}

      {!loading && (advice?.actions.length ?? 0) > 0 && (
        <span style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {advice!.actions.map((a, i) => (
            <button
              key={a}
              type="button"
              className={`cal-ctl${i === 0 ? ' cal-ctl-ink' : ''}`}
              // The advice is a reading, not a command: these say what the
              // Professor suggests, and the change is still yours to make in
              // the event itself.
              title="Open the events this is about"
              style={{
                height: 34, padding: '0 16px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                background: i === 0 ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                border: i === 0 ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
                color: i === 0 ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-2)',
              }}>{a}</button>
          ))}
        </span>
      )}
    </div>
  )
}

// ─── The rail ────────────────────────────────────────────────────────────────

export function CalendarRail({ rows, dayLabel, onOpen }: {
  rows: RailEvent[]
  /** "TUE 15 SEP" — the label row's own text, already in the reader's locale. */
  dayLabel: string
  onOpen: (e: GCalEvent) => void
}) {
  // One clock for the whole rail, ticked each minute, so every row agrees about
  // what is running and the live dot does not need a timer of its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => startMs(a.event) - startMs(b.event)),
    [rows])

  // Each event belongs to at most one clash block, so a three-way pile-up does
  // not draw the middle event twice.
  const { blocks } = useMemo(() => {
    const used = new Set<string>()
    const out: ({ kind: 'row'; row: RailEvent } | { kind: 'clash'; pair: [RailEvent, RailEvent]; mins: number })[] = []
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]
      if (used.has(a.event.id)) continue
      let paired = false
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]
        if (used.has(b.event.id)) continue
        const mins = overlapMinutes(a.event, b.event)
        // An all-day event overlaps everything; that is not a clash, it is a day.
        if (mins > 0 && a.event.start?.dateTime && b.event.start?.dateTime) {
          used.add(a.event.id); used.add(b.event.id)
          out.push({ kind: 'clash', pair: [a, b], mins })
          paired = true
          break
        }
      }
      if (!paired) { used.add(a.event.id); out.push({ kind: 'row', row: a }) }
    }
    return { blocks: out }
  }, [sorted])

  let plain = 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={CARD}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <Label current>{dayLabel}</Label>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: 'var(--sb-ink-4)', fontVariantNumeric: 'tabular-nums' }}>
            {sorted.length} event{sorted.length === 1 ? '' : 's'}
          </span>
        </span>

        {sorted.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--sb-ink-4)', padding: '11px 0' }}>
            Nothing on this day.
          </span>
        )}

        {blocks.map(b => b.kind === 'clash'
          ? <Clash
              key={b.pair[0].event.id}
              pair={b.pair}
              mins={b.mins}
              now={now}
              onOpen={r => onOpen(r.event)}
              onReschedule={r => onOpen(r.event)}
            />
          : <EventRow
              key={b.row.event.id}
              row={b.row}
              first={plain++ === 0}
              now={now}
              onOpen={() => onOpen(b.row.event)}
            />)}
      </div>

      <ProfessorCard rows={sorted} dayLabel={dayLabel} />
    </div>
  )
}

export { ICON as RAIL_ICON }
