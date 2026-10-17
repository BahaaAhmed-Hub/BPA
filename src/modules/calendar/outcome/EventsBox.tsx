// ─── Events, from the meeting ────────────────────────────────────────────────
//
// What a meeting most often leaves behind is another meeting. This box
// schedules it without leaving the window, moves the next one in the series,
// and takes back what it made.
//
// Rules, in the order they cost something:
//
// **Writing an event is Google's, and the calendar owns how.** A connected
// account's token is never in the browser — its writes go through an edge
// function — and the primary account uses its own. The box never builds a
// request: it asks the calendar's port, which uses the calendar's own paths. So
// a rule added there cannot be missed here.
//
// **Inviting someone is the one thing here that leaves the building.** Guests
// are emailed by Google the moment an event with them is written, and there is
// no taking an email back. So the guests are a row of switches that begin
// **off**, the form says what scheduling will do, and nothing is invited by
// default — an event with nobody on it is the safe answer to "schedule another".
//
// **Google has no undelete — and this is not about undoing a deletion.** Undo on
// an event made here *deletes* it, which is a real DELETE and, for an event with
// guests, a cancellation they receive. That is why the row says what it will do.
// Undo on a **moved** event puts the old time back with a second PATCH.
//
// **A failure says why, and writes nothing.** A refused create leaves no row, no
// link and no count — the thread must not claim an event that does not exist.
//
// **Only what is on screen is claimed.** The next occurrence of a series is
// offered when it is already loaded; the box does not go and ask Google for the
// rest of the series, and says "in view" rather than "next".

import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Link as LinkIcon, Pencil } from 'lucide-react'
import { ICON } from '@/lib/type'
import {
  addOutcomeLink, removeOutcomeLink, linksForEvent, subscribeOutcomeLinks,
} from '@/lib/meetingOutcomes'
import {
  OutcomeBox, EYEBROW, FIELD, chip, ymd, fromYmd, pad,
  type OutcomeEvent, type OutcomeCalendarPort, type OutcomeEventRef,
} from './shared'

const TINT = 'var(--sb-accent-deep)'

const addDays = (date: string, n: number) => ymd(new Date(fromYmd(date).getTime() + n * 86400000))
const dayLabel = (d: string) => fromYmd(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0) }
const hm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`

interface Before { title: string; date: string; startTime: string; endTime: string }

function EventRow({ ev, label, linkedHere, madeHere, moved, editing, onEdit, onPatch, onUndoMade, onUndoMove }: {
  ev: OutcomeEventRef
  /** What the row is: the next one in the series, or one made here. */
  label: string
  linkedHere: boolean
  madeHere: boolean
  moved: boolean
  editing: boolean
  onEdit: () => void
  onPatch: (p: { title?: string; date?: string; startTime?: string; endTime?: string }) => void
  onUndoMade: () => void
  onUndoMove: () => void
}) {
  const [title, setTitle] = useState(ev.title)
  useEffect(() => setTitle(ev.title), [ev.title])

  return (
    <div data-outcome-event={ev.id} data-editing={editing ? '1' : '0'} style={{
      borderRadius: 'var(--sb-r-nav)', padding: '0 12px', display: 'flex', flexDirection: 'column',
      background: madeHere ? 'var(--sb-positive-tint)' : 'var(--sb-card)',
      border: `var(--sb-border-width) solid ${editing ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.title || '(No title)'} <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontWeight: 500 }}>· {label}</span>
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: madeHere ? 'var(--sb-positive-deep)' : 'var(--sb-ink-3)' }}>
            {dayLabel(ev.date)}{ev.allDay ? ' · all day' : ` · ${ev.startTime} – ${ev.endTime}`}
            {ev.guests.length ? ` · ${ev.guests.length} invited` : ''}
          </div>
        </div>
        {linkedHere && (
          <span title="Linked to this meeting" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-micro)', fontWeight: 600,
            color: 'var(--sb-ink-1)', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-pill)', padding: '3px 9px', whiteSpace: 'nowrap',
          }}><LinkIcon size={12} />this meeting</span>
        )}
        {madeHere && (
          <button onClick={onUndoMade} style={chip()}
            title={ev.guests.length ? 'Deletes it from Google — the people invited are told it is cancelled' : 'Deletes it from Google'}>
            Undo
          </button>
        )}
        {moved && !madeHere && <button onClick={onUndoMove} style={chip()}>Undo move</button>}
        {!ev.allDay && (
          <button onClick={onEdit} aria-label={`${editing ? 'Close' : madeHere ? 'Edit' : 'Move'} ${ev.title || 'event'}`} aria-expanded={editing}
            style={madeHere ? { ...chip(editing), width: 36, padding: 0, justifyContent: 'center' } : chip(editing)}>
            {madeHere ? <Pencil size={ICON.sm} /> : 'Move'}
          </button>
        )}
      </div>

      {editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '2px 0 12px' }}>
          <input aria-label="Event title" value={title} onChange={e => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== ev.title) onPatch({ title: title.trim() }) }}
            style={{ ...FIELD, flex: '1 1 200px', height: 40 }} />
          <input type="date" aria-label="Event date" value={ev.date} onChange={e => e.target.value && onPatch({ date: e.target.value })}
            style={{ ...FIELD, height: 40, width: 150 }} />
          <input type="time" aria-label="Starts" value={ev.startTime} onChange={e => e.target.value && onPatch({ startTime: e.target.value })}
            style={{ ...FIELD, height: 40, width: 110 }} />
          <span style={{ color: 'var(--sb-ink-3)' }}>–</span>
          <input type="time" aria-label="Ends" value={ev.endTime} onChange={e => e.target.value && onPatch({ endTime: e.target.value })}
            style={{ ...FIELD, height: 40, width: 110 }} />
        </div>
      )}
    </div>
  )
}

export function EventsBox({ event, calendar, open, onToggle, onFullForm }: {
  event: OutcomeEvent
  /** Absent, the box is not drawn rather than drawn and dead. */
  calendar?: OutcomeCalendarPort
  open: boolean
  onToggle: () => void
  /** The calendar's own composer, for what the quick form does not do — a Meet
   *  link, a repeat. Opening it closes this window, so it is offered, not pushed. */
  onFullForm?: () => void
}) {
  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])

  const src = calendar?.find(event.id) ?? null
  const target = calendar && src ? calendar.target(src.calendarId) : null

  const linked = linksForEvent(event.id, 'event')
  const linkedIds = new Set(linked.map(l => l.recordId))
  const madeCount = linked.filter(l => l.role === 'made').length

  const [madeHere, setMadeHere] = useState<Set<string>>(new Set())
  const [before, setBefore] = useState<Record<string, Before>>({})
  const [editing, setEditing] = useState<string | null>(null)

  // ── The quick form: pre-answered, so the work is editing ──
  const today = ymd(new Date())
  const duration = src && !src.allDay && src.startTime && src.endTime ? Math.max(15, minutes(src.endTime) - minutes(src.startTime)) : 60
  const weekPlus = src ? addDays(src.date, 7) : addDays(today, 7)
  const sameStart = src && !src.allDay && src.startTime ? src.startTime : '10:00'
  const [title, setTitle] = useState(() => /^follow[- ]?up/i.test(event.title) ? event.title : `Follow-up: ${event.title}`)
  const [when, setWhen] = useState<'week' | 'tomorrow' | 'custom'>('week')
  const [custom, setCustom] = useState({ date: weekPlus, start: sameStart })
  const [invite, setInvite] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = when === 'week' ? { date: weekPlus, start: sameStart }
    : when === 'tomorrow' ? { date: addDays(today, 1), start: '10:00' }
    : custom
  const endTime = hm(minutes(chosen.start) + duration)

  // One list, in an order that does not depend on what was just done.
  const rows = useMemo(() => {
    if (!calendar) return [] as { ev: OutcomeEventRef; label: string }[]
    const here = linked.map(l => calendar.find(l.recordId)).filter(Boolean) as OutcomeEventRef[]
    const later = calendar.later(event.id).filter(e => !linkedIds.has(e.id))
    const all = [...here.map(ev => ({ ev, label: 'scheduled here' })), ...later.map(ev => ({ ev, label: 'in view, same series' }))]
    return all.sort((a, b) => (a.ev.date + a.ev.startTime).localeCompare(b.ev.date + b.ev.startTime) || a.ev.id.localeCompare(b.ev.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar, src?.id, linked.map(l => l.recordId).join(','), calendar?.later(event.id).map(e => e.id + e.date + e.startTime).join(',')])

  if (!calendar) return null

  const link = (id: string, role: 'made' | 'touched') =>
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, kind: 'event', recordId: id, role })

  async function schedule() {
    if (!calendar || !src || !title.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await calendar.create({
        title: title.trim(), date: chosen.date, startTime: chosen.start, endTime,
        invitees: [...invite], ...(src.location ? { location: src.location } : {}),
      }, src.calendarId)
      if (!r.ok) { setError(r.error); return }
      link(r.event.id, 'made')
      setMadeHere(prev => new Set(prev).add(r.event.id))
      setInvite(new Set())
    } finally { setBusy(false) }
  }

  async function patch(ev: OutcomeEventRef, p: { title?: string; date?: string; startTime?: string; endTime?: string }) {
    if (!calendar) return
    const wasMine = madeHere.has(ev.id)
    // Remembered as it was, once, so Undo puts back the first state.
    if (!wasMine) setBefore(b => b[ev.id] ? b : { ...b, [ev.id]: { title: ev.title, date: ev.date, startTime: ev.startTime, endTime: ev.endTime } })
    const r = await calendar.patch(ev.id, p)
    if (!r.ok) { setError(r.error); if (!wasMine) setBefore(b => { const n = { ...b }; delete n[ev.id]; return n }); return }
    setError(null)
    if (!wasMine && !linkedIds.has(ev.id)) link(ev.id, 'touched')
  }

  async function undoMove(ev: OutcomeEventRef) {
    const was = before[ev.id]
    if (!calendar || !was) return
    const r = await calendar.patch(ev.id, was)
    if (!r.ok) { setError(r.error); return }
    setBefore(b => { const n = { ...b }; delete n[ev.id]; return n })
    const l = linked.find(x => x.recordId === ev.id)
    if (l?.role === 'touched') removeOutcomeLink(event.id, 'event', ev.id)
    setEditing(null)
  }

  async function undoMade(ev: OutcomeEventRef) {
    if (!calendar) return
    // Google has no undelete, so this is a real delete: say if it failed rather
    // than dropping the row for an event that is still on the calendar.
    const ok = await calendar.remove(ev.id)
    if (!ok) { setError('Google would not delete it — it is still on your calendar.'); return }
    removeOutcomeLink(event.id, 'event', ev.id)
    setMadeHere(prev => { const n = new Set(prev); n.delete(ev.id); return n })
    if (editing === ev.id) setEditing(null)
  }

  const summary = !src ? 'This meeting is not on screen'
    : madeCount ? `${madeCount} scheduled here` : rows.length ? `${rows.length} in view` : 'Nothing scheduled yet'

  return (
    <OutcomeBox id="events" icon={<CalendarPlus size={ICON.lg} />} title="Events" summary={summary} open={open} onToggle={onToggle} tint={TINT}>
      {rows.length > 0 && <p style={EYEBROW}>This meeting and its series</p>}
      {rows.map(({ ev, label }) => (
        <EventRow
          key={ev.id} ev={ev} label={label}
          linkedHere={linkedIds.has(ev.id)} madeHere={madeHere.has(ev.id)} moved={!!before[ev.id]} editing={editing === ev.id}
          onEdit={() => setEditing(editing === ev.id ? null : ev.id)}
          onPatch={p => void patch(ev, p)}
          onUndoMade={() => void undoMade(ev)} onUndoMove={() => void undoMove(ev)} />
      ))}

      {!src ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          This meeting is not on the week in view, so there is nothing to base a follow-up on. Open its week and try again.
        </p>
      ) : !target ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          There is no calendar here that you can write to, so nothing can be scheduled from this window.
        </p>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void schedule() }} style={{
          display: 'flex', flexDirection: 'column', gap: 10, padding: 12, marginTop: 2,
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
        }}>
          <input aria-label="Title of the next meeting" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Schedule another — title" style={{ ...FIELD, height: 44, background: 'var(--sb-card)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" aria-pressed={when === 'week'} onClick={() => setWhen('week')} style={chip(when === 'week')}>In 1 week · same time</button>
            <button type="button" aria-pressed={when === 'tomorrow'} onClick={() => setWhen('tomorrow')} style={chip(when === 'tomorrow')}>Tomorrow 10:00</button>
            <button type="button" aria-pressed={when === 'custom'} onClick={() => setWhen('custom')} style={chip(when === 'custom', when !== 'custom')}>Pick date and time…</button>
            <span data-outcome-when style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', fontWeight: 600, marginLeft: 4 }}>
              {dayLabel(chosen.date)} · {chosen.start} – {endTime}
            </span>
          </div>
          {when === 'custom' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" aria-label="Date of the next meeting" value={custom.date}
                onChange={e => e.target.value && setCustom(c => ({ ...c, date: e.target.value }))} style={{ ...FIELD, height: 40, width: 150, background: 'var(--sb-card)' }} />
              <input type="time" aria-label="Start of the next meeting" value={custom.start}
                onChange={e => e.target.value && setCustom(c => ({ ...c, start: e.target.value }))} style={{ ...FIELD, height: 40, width: 110, background: 'var(--sb-card)' }} />
            </div>
          )}
          {src.guests.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Invite</span>
              {src.guests.map(g => {
                const on = invite.has(g.email)
                const first = (g.name ?? g.email.split('@')[0]!).split(/[\s.]/)[0]!
                return (
                  <button type="button" key={g.email} aria-pressed={on} aria-label={`Invite ${g.name ?? g.email}`}
                    onClick={() => setInvite(prev => { const n = new Set(prev); if (n.has(g.email)) n.delete(g.email); else n.add(g.email); return n })}
                    style={chip(on)}>{first}</button>
                )
              })}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
              On <b style={{ color: 'var(--sb-ink-2)' }}>{target.name}</b>.{' '}
              {invite.size ? `Google will email ${invite.size} ${invite.size === 1 ? 'person' : 'people'} the invitation.` : 'No one is invited unless you switch them on.'}
            </span>
            <button type="submit" disabled={busy || !title.trim()} style={{
              height: 40, padding: '0 18px', borderRadius: 'var(--sb-r-sm)', border: 'none', fontFamily: 'inherit',
              fontSize: 'var(--sb-t-body-s)', fontWeight: 700, cursor: busy ? 'default' : 'pointer',
              background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', opacity: busy || !title.trim() ? 0.45 : 1,
            }}>{busy ? 'Scheduling…' : 'Schedule'}</button>
          </div>
        </form>
      )}
      {error && <span role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{error}</span>}
      {onFullForm && (
        <button onClick={onFullForm} style={{ ...chip(false, true), alignSelf: 'flex-start' }}>
          Need a Meet link or a repeat? Open the full form
        </button>
      )}
    </OutcomeBox>
  )
}
