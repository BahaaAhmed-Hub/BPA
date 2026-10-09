// ─── The page a stranger opens ──────────────────────────────────────────────
//
// Rendered *above* the sign-in gate in App, and before anything else runs: no
// hydrate, no entitlements, no store. An anonymous visitor firing a dozen
// RLS-denied reads is the failure the entitlements work documented one layer
// up, and here it would be a dozen reads on behalf of somebody who has no
// account at all. Everything this page knows comes from the `book-me`
// function.
//
// Two rules it exists to keep:
//
// - **Times are shown on the visitor's clock.** A slot is an instant; which
//   reading of it you see depends on where you are, and getting that wrong
//   books a 9am Cairo call at 9am Berlin.
// - **"Nothing free" and "we could not look" are different sentences.** A
//   refused token must never render as an empty month, which would tell
//   somebody you have no time at all for the next thirty days.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Globe, Loader2, MapPin, Video, X } from 'lucide-react'
import { zoneOffset } from '@/lib/zones'
import { ICON, STROKE } from '@/lib/type'
import {
  book, cancelBooking, loadPublicProfile, loadSlots, lookUpBooking, manageUrl,
  type BookingRequest, type ManageView, type PublicPlan, type PublicProfile, type SlotAnswer,
} from '@/lib/booking'

// ─── Clocks ──────────────────────────────────────────────────────────────────

const viewerZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** Every zone this browser knows, so the picker is not a hard-coded three —
 *  the mistake the shopping currency list made. Falls back to what is in play. */
function allZones(extra: string[]): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
  try {
    const list = sv ? sv('timeZone') : []
    if (list.length) return [...new Set([...extra, ...list])]
  } catch { /* older engine */ }
  return [...new Set(extra)]
}

/** How far `tz` is from UTC, in whole minutes. `zoneOffset` measures against an
 *  instant that carries milliseconds while the parts it reads stop at seconds,
 *  so the raw figure is a hair off a whole minute — harmless in arithmetic and
 *  a lie on screen ("GMT+01:59.99695"). */
function offsetMinutes(at: number, tz: string): number {
  return Math.round(zoneOffset(at, tz) / 60000)
}

/** The wall clock an instant reads as, in `tz`. */
function readingOf(iso: string, tz: string): { date: string; hh: number; mm: number } {
  const at = Date.parse(iso)
  const w = new Date(at + offsetMinutes(at, tz) * 60000)
  return { date: w.toISOString().slice(0, 10), hh: w.getUTCHours(), mm: w.getUTCMinutes() }
}

function clockOf(iso: string, tz: string): string {
  const at = Date.parse(iso)
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at)
  } catch {
    const r = readingOf(iso, tz)
    return `${String(r.hh).padStart(2, '0')}:${String(r.mm).padStart(2, '0')}`
  }
}

function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })
}

function zoneLabel(tz: string): string {
  const mins = offsetMinutes(Date.now(), tz)
  const sign = mins < 0 ? '−' : '+'
  const a = Math.abs(mins)
  return `${tz.replace(/_/g, ' ')} (GMT${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')})`
}

// ─── Small pieces of the page ───────────────────────────────────────────────

const PAGE: React.CSSProperties = {
  minHeight: '100vh', background: 'var(--sb-page)', color: 'var(--sb-ink-1)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: '32px 16px 56px', boxSizing: 'border-box',
}
const CARD: React.CSSProperties = {
  width: '100%', background: 'var(--sb-card)', boxSizing: 'border-box',
  border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
  boxShadow: 'var(--sb-shadow-control)', padding: '20px 22px',
}
const FIELD: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 42, padding: '0 12px',
  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-sm)', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)',
  fontFamily: 'inherit', outline: 'none',
}
const EYEBROW: React.CSSProperties = {
  margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em',
  color: 'var(--sb-ink-3)', textTransform: 'uppercase',
}
const H1: React.CSSProperties = {
  margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 28, fontWeight: 600,
  letterSpacing: '-0.03em', color: 'var(--sb-ink-1)',
}

function Waiting({ what }: { what: string }) {
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
      <Loader2 size={ICON.sm} style={{ animation: 'spin 1s linear infinite' }} /> {what}
    </p>
  )
}

function Trouble({ title, detail }: { title: string; detail?: string }) {
  return (
    <div style={{ ...CARD, borderColor: 'color-mix(in srgb, var(--sb-negative) 30%, transparent)', background: 'var(--sb-negative-tint)' }}>
      <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-negative-deep)' }}>{title}</p>
      {detail && <p style={{ margin: '5px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>{detail}</p>}
    </div>
  )
}

function LocationLine({ mode }: { mode: PublicPlan['location_mode'] }) {
  if (mode === 'none') return null
  const [Icon, text] = mode === 'meet' ? [Video, 'A video call — the link comes with the invitation']
    : mode === 'phone' ? [MapPin, 'A phone call']
    : [MapPin, 'In person']
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
      <Icon size={ICON.sm} /> {text}
    </span>
  )
}

// ─── The month ───────────────────────────────────────────────────────────────

/** A month of days, with the ones that have something to offer lit. The grid
 *  is built on the **visitor's** clock, because "Tuesday" has to mean the
 *  Tuesday in their own calendar. */
function MonthPicker({ byDay, month, onMonth, chosen, onChoose, canGoBack, canGoOn }: {
  byDay: Map<string, string[]>
  month: string                 // YYYY-MM
  onMonth: (m: string) => void
  chosen: string | null
  onChoose: (d: string) => void
  canGoBack: boolean
  canGoOn: boolean
}) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  // Monday-first, the way the rest of the app reads a week.
  const lead = (first.getUTCDay() + 6) % 7
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ]
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const step = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1))
    onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <p style={{ margin: 0, flex: 1, fontSize: 'var(--sb-t-body)', fontWeight: 600 }}>{label}</p>
        <button onClick={() => step(-1)} disabled={!canGoBack} aria-label="The month before"
          style={{ ...ROUNDBTN, opacity: canGoBack ? 1 : 0.35 }}><ChevronLeft size={ICON.sm} /></button>
        <button onClick={() => step(1)} disabled={!canGoOn} aria-label="The month after"
          style={{ ...ROUNDBTN, opacity: canGoOn ? 1 : 0.35 }}><ChevronRight size={ICON.sm} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} style={{ textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: 'var(--sb-ink-4)' }}>{d}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`x${i}`} />
          const has = (byDay.get(date) ?? []).length
          const on = chosen === date
          return (
            <button
              key={date}
              onClick={() => has && onChoose(date)}
              disabled={!has}
              aria-label={`${longDate(date)}${has ? ` — ${has} times` : ' — nothing free'}`}
              aria-pressed={on}
              style={{
                height: 38, borderRadius: 'var(--sb-r-sm)', cursor: has ? 'pointer' : 'default',
                fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 700 : 500,
                background: on ? 'var(--sb-ink-1)' : has ? 'var(--sb-field)' : 'transparent',
                color: on ? 'var(--sb-ink-on-dark)' : has ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : has ? 'var(--sb-border)' : 'transparent'}`,
              }}>
              {Number(date.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const ROUNDBTN: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', padding: 0, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
}

// ─── Managing one you already have ──────────────────────────────────────────

function ManageFace({ token }: { token: string }) {
  const [view, setView] = useState<ManageView | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tz = useMemo(viewerZone, [])

  useEffect(() => {
    void lookUpBooking(token).then(r => r.ok ? setView(r.value) : setWhy(r.why))
  }, [token])

  if (why) return <div style={{ ...PAGE }}><div style={{ maxWidth: 440, width: '100%' }}>
    <Trouble title="That booking is not here" detail="The link may have been used already, or it belongs to a booking that was removed." />
  </div></div>

  return (
    <div style={PAGE}>
      <div style={{ maxWidth: 440, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!view ? <Waiting what="Looking it up…" /> : (
          <div style={CARD}>
            <p style={EYEBROW}>Your booking</p>
            <p style={{ ...H1, marginTop: 8 }}>{view.title}</p>
            <p style={{ margin: '8px 0 0', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)' }}>
              {longDate(readingOf(view.start, tz).date)} · {clockOf(view.start, tz)} – {clockOf(view.end, tz)}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
              with {view.name} · {zoneLabel(tz)}
            </p>
            {view.status === 'cancelled' ? (
              <p style={{ margin: '16px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative-deep)', fontWeight: 600 }}>
                This one is cancelled.
              </p>
            ) : (
              <>
                {view.status === 'pending' && (
                  <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                    Waiting to be accepted.
                  </p>
                )}
                <button
                  onClick={async () => {
                    setBusy(true)
                    const r = await cancelBooking(token)
                    setBusy(false)
                    if (r.ok) setView({ ...view, status: 'cancelled' })
                    else setWhy(r.why === 'calendar_refused' ? 'calendar' : r.why)
                  }}
                  disabled={busy}
                  style={{
                    marginTop: 18, height: 42, padding: '0 16px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
                    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 40%, transparent)',
                    color: 'var(--sb-negative-deep)', fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', fontWeight: 600,
                  }}>
                  {busy ? 'Cancelling…' : 'Cancel this booking'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── The page ────────────────────────────────────────────────────────────────

export function PublicBooking({ handle, plan: wanted, manage }: BookingRequest) {
  if (manage) return <ManageFace token={manage} />
  return <BookFace handle={handle} wanted={wanted} />
}

function BookFace({ handle, wanted }: { handle: string; wanted?: string }) {
  const [prof, setProf] = useState<PublicProfile | null>(null)
  const [gone, setGone] = useState(false)
  const [chosenPlan, setChosenPlan] = useState<string | null>(wanted ?? null)
  const [answer, setAnswer] = useState<SlotAnswer | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tz, setTz] = useState(viewerZone)
  const [day, setDay] = useState<string | null>(null)
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [slot, setSlot] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  // **Two different failures, and they used to share one variable.** "The page
  // could not read the diary" replaces the picker; "that time has just gone"
  // must leave it standing — otherwise the one message that asks you to pick
  // again takes away the thing you would pick from.
  const [loadWhy, setLoadWhy] = useState<string | null>(null)
  const [bookWhy, setBookWhy] = useState<string | null>(null)
  const [done, setDone] = useState<{ start: string; status: string; token: string; title: string } | null>(null)
  const asked = useRef('')

  useEffect(() => {
    void loadPublicProfile(handle).then(r => r.ok ? setProf(r.value) : setGone(true))
  }, [handle])

  // The slots for whichever plan is open. Keyed so React's double mount in
  // development asks once, the way the mail briefs are guarded.
  useEffect(() => {
    if (!chosenPlan || !prof) return
    const key = `${handle}|${chosenPlan}`
    if (asked.current === key) return
    asked.current = key
    setLoading(true); setUnreadable(false)
    void loadSlots(handle, chosenPlan).then(r => {
      setLoading(false)
      if (r.ok) { setAnswer(r.value); return }
      if (r.unreadable) setUnreadable(true)
      else setLoadWhy(r.why)
    })
  }, [chosenPlan, prof, handle])

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of answer?.slots ?? []) {
      const d = readingOf(s, tz).date
      m.set(d, [...(m.get(d) ?? []), s])
    }
    return m
  }, [answer, tz])

  // Open on the first day that has anything rather than on a blank month.
  useEffect(() => {
    if (day || !byDay.size) return
    const first = [...byDay.keys()].sort()[0]
    setDay(first); setMonth(first.slice(0, 7))
  }, [byDay, day])

  const zones = useMemo(() => allZones([tz, answer?.timezone ?? prof?.timezone ?? 'UTC']), [tz, answer, prof])
  const planNow = prof?.plans.find(p => p.slug === chosenPlan)

  if (gone) return <div style={PAGE}><div style={{ maxWidth: 440, width: '100%' }}>
    <Trouble title="There is no booking page here" detail="Check the link you were sent — it may have been turned off." />
  </div></div>

  if (done) {
    return (
      <div style={PAGE}>
        <div style={{ maxWidth: 480, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-positive-tint)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={20} color="var(--sb-positive)" strokeWidth={STROKE.active} />
            </span>
            <p style={H1}>{done.status === 'pending' ? 'Asked for' : 'Booked'}</p>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>
              {done.title} · {longDate(readingOf(done.start, tz).date)} at {clockOf(done.start, tz)}
              <br />
              <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>{zoneLabel(tz)}</span>
            </p>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
              {done.status === 'pending'
                ? `${prof?.name ?? 'They'} will confirm it. You will get a calendar invitation when they do.`
                : 'A calendar invitation is on its way to your inbox.'}
            </p>
            <a href={manageUrl(done.token)} style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-info)' }}>
              Change or cancel this booking
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={PAGE}>
      <div style={{ maxWidth: 820, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Who ──────────────────────────────────────────────────────────── */}
        <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={EYEBROW}>Book a time with</p>
          <p style={H1}>{prof?.name ?? handle}</p>
          {prof?.blurb && <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>{prof.blurb}</p>}
        </div>

        {!prof ? <Waiting what="Opening the page…" /> : !chosenPlan ? (
          /* ── Which call ─────────────────────────────────────────────────── */
          prof.plans.length === 0 ? (
            <div style={CARD}>
              <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
                Nothing can be booked here just now.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {prof.plans.map(p => (
                <button key={p.slug} onClick={() => { setChosenPlan(p.slug); setDay(null) }}
                  style={{ ...CARD, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7, fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>{p.title}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                    <Clock size={ICON.sm} /> {p.duration_minutes} minutes
                  </span>
                  {p.blurb && <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.45 }}>{p.blurb}</span>}
                  <LocationLine mode={p.location_mode} />
                </button>
              ))}
            </div>
          )
        ) : (
          /* ── When ───────────────────────────────────────────────────────── */
          <>
            <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-h3)', fontWeight: 700 }}>{answer?.title ?? planNow?.title ?? 'A call'}</p>
                <p style={{ margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={ICON.sm} /> {answer?.duration ?? planNow?.duration_minutes} minutes
                  </span>
                  <LocationLine mode={answer?.location_mode ?? planNow?.location_mode ?? 'none'} />
                </p>
              </div>
              {prof.plans.length > 1 && (
                <button onClick={() => { setChosenPlan(null); setAnswer(null); setDay(null); setSlot(null); setBookWhy(null); asked.current = '' }}
                  style={{ ...ROUNDBTN, width: 'auto', padding: '0 12px', borderRadius: 'var(--sb-r-pill)', fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit', gap: 6 }}>
                  <X size={ICON.sm} /> Another kind
                </button>
              )}
            </div>

            {unreadable ? (
              <Trouble
                title="The diary cannot be read just now"
                detail="This is on our side, not yours — the calendar it reads is temporarily unreachable, so we would rather say so than show you an empty month. Please try again shortly." />
            ) : loadWhy ? (
              <Trouble title="Something went wrong opening this page" detail={loadWhy} />
            ) : loading ? <Waiting what="Looking at the diary…" /> : (
              <>
              {/* A booking that did not go through is said here, above the
                  times, because picking another one is the next thing you do. */}
              {bookWhy && (
                <div style={{ marginBottom: 12 }}>
                  <Trouble
                    title={bookWhy === 'slot_gone' ? 'That time has just been taken' : 'It did not go through'}
                    detail={bookWhy === 'slot_gone'
                      ? 'Somebody booked it a moment before you. The times below have been refreshed — pick another.'
                      : bookWhy} />
                </div>
              )}
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(260px, 1fr) minmax(220px, 300px)', alignItems: 'start' }}
                className="booking-when">
                {/* The month */}
                <div style={CARD}>
                  <MonthPicker
                    byDay={byDay}
                    month={month}
                    onMonth={setMonth}
                    chosen={day}
                    onChoose={d => { setDay(d); setSlot(null) }}
                    canGoBack={month > (answer?.from ?? '').slice(0, 7)}
                    canGoOn={month < (answer?.to ?? '').slice(0, 7)} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14 }}>
                    <Globe size={ICON.sm} color="var(--sb-ink-3)" />
                    <select value={tz} onChange={e => { setTz(e.target.value); setDay(null); setSlot(null) }}
                      aria-label="Show these times in"
                      style={{ ...FIELD, height: 34, fontSize: 'var(--sb-t-body-s)', cursor: 'pointer' }}>
                      {zones.map(z => <option key={z} value={z}>{zoneLabel(z)}</option>)}
                    </select>
                  </label>
                  {byDay.size === 0 && (
                    <p style={{ margin: '12px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
                      No times are open in the next {Math.max(1, Math.round((Date.parse(answer?.to ?? '') - Date.parse(answer?.from ?? '')) / 86400000) || 30)} days.
                    </p>
                  )}
                </div>

                {/* The day */}
                <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={EYEBROW}>{day ? longDate(day) : 'Pick a day'}</p>
                  {day && (byDay.get(day) ?? []).map(s => (
                    <button key={s} onClick={() => setSlot(s)} aria-pressed={slot === s}
                      style={{
                        height: 42, borderRadius: 'var(--sb-r-sm)', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 'var(--sb-t-body)', fontWeight: 600,
                        background: slot === s ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                        color: slot === s ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-1)',
                        border: `var(--sb-border-width) solid ${slot === s ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                      }}>
                      {clockOf(s, tz)}
                    </button>
                  ))}
                  {!day && <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Days with something free are the ones you can press.</p>}
                </div>
              </div>
              </>
            )}

            {/* ── Who is coming ───────────────────────────────────────────── */}
            {slot && (
              <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={EYEBROW}>Your details</p>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)' }}>
                  {longDate(readingOf(slot, tz).date)} at <strong>{clockOf(slot, tz)}</strong>
                  <span style={{ color: 'var(--sb-ink-3)' }}> · {zoneLabel(tz)}</span>
                </p>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name" style={FIELD} />
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email" aria-label="Your email" type="email" style={FIELD} />
                <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What is it about? (optional)" aria-label="What is it about"
                  style={{ ...FIELD, height: 'auto', minHeight: 76, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }} />
                <button
                  onClick={async () => {
                    setBookWhy(null); setSending(true)
                    const r = await book({ handle, plan: chosenPlan!, start: slot, name, email, note })
                    setSending(false)
                    if (r.ok) {
                      setDone({ start: r.value.start, status: r.value.status, token: r.value.manage_token, title: r.value.title })
                      return
                    }
                    setBookWhy(r.why)
                    if (r.slots) { setAnswer(a => a ? { ...a, slots: r.slots! } : a); setSlot(null) }
                  }}
                  disabled={sending || !name.trim() || !email.trim()}
                  style={{
                    height: 46, borderRadius: 'var(--sb-r-sm)', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 'var(--sb-t-body)', fontWeight: 700,
                    background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', border: 'none',
                    opacity: sending || !name.trim() || !email.trim() ? 0.5 : 1,
                  }}>
                  {sending ? 'Booking…' : answer?.requires_approval ? 'Ask for this time' : 'Book it'}
                </button>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                  {answer?.requires_approval
                    ? 'It is not booked until it is accepted — you will hear either way.'
                    : 'You will get a calendar invitation, and a link to cancel or move it.'}
                </p>
              </div>
            )}
          </>
        )}

        <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', textAlign: 'center' }}>
          Times shown in {zoneLabel(tz)}
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 720px) {
          .booking-when { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
