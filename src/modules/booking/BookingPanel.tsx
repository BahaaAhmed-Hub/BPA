// ─── The owner's side of the booking page ───────────────────────────────────
//
// Three questions, in the order you meet them: who the page is, what can be
// booked on it, and what has been. The hours themselves are not here — they
// are drawn on the week beside this panel, because the only way to be sure you
// are not offering an hour you have already given away is to see the week it
// sits in.
//
// The shell is the calendar composer's (`ComposerShell`): a cream panel
// holding white cards, docked in the same column as the event panel and the
// rail, so the week stays visible while you work. Not a modal — a modal over
// the grid hides the one thing you need.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, Copy, ExternalLink, Link2, Loader2, Plus, Trash2, X,
} from 'lucide-react'
import { ComposerShell, type ComposerCalendar } from '@/modules/calendar/NewEventPanel'
import { notify } from '@/lib/undo'
import { ICON, STROKE } from '@/lib/type'
import {
  bookingUrl, decideBooking, deletePlan, loadBookings, loadBookingProfile, loadPlans,
  manageUrl, savePlan, saveBookingProfile, slugify, suggestHandle,
  type BookingProfileRow, type BookingRow, type PlanRow,
} from '@/lib/booking'

// ─── Shared looks ────────────────────────────────────────────────────────────

const WHITE: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', padding: '13px 14px',
  display: 'flex', flexDirection: 'column', gap: 9,
}
const EYEBROW: React.CSSProperties = {
  margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em',
  color: 'var(--sb-ink-3)', textTransform: 'uppercase',
}
const IN: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 'var(--sb-h-pill)', padding: '0 10px',
  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-sm)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)',
  fontFamily: 'inherit', outline: 'none',
}
const LBL: React.CSSProperties = {
  display: 'block', marginBottom: 3, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
}
const GHOST: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, height: 'var(--sb-h-pill)',
  padding: '0 10px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  color: 'var(--sb-ink-3)', fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
}
const INK: React.CSSProperties = {
  ...GHOST, background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', border: 'none',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span style={LBL}>{label}</span>{children}</label>
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{
        width: 40, height: 23, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 2, cursor: 'pointer',
        background: on ? 'var(--sb-positive)' : 'var(--sb-field)',
        border: `var(--sb-border-width) solid ${on ? 'var(--sb-positive)' : 'var(--sb-border)'}`,
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
      }}>
      <span style={{ width: 17, height: 17, borderRadius: 'var(--sb-r-pill)', background: on ? 'var(--sb-ink-on-fill)' : 'var(--sb-ink-4)' }} />
    </button>
  )
}

function copy(text: string, said: string) {
  navigator.clipboard.writeText(text).then(() => notify(said)).catch(() => notify('Could not reach the clipboard'))
}

const MINUTES = [10, 15, 20, 30, 45, 60, 90, 120]

// ─── A plan ──────────────────────────────────────────────────────────────────

function PlanCard({ plan, handle, calendars, onSave, onDelete }: {
  plan: PlanRow
  handle: string | null
  calendars: ComposerCalendar[]
  onSave: (p: PlanRow) => Promise<string | null>
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(!plan.id)
  const [d, setD] = useState<PlanRow>(plan)
  const [saving, setSaving] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  useEffect(() => setD(plan), [plan])

  const set = (patch: Partial<PlanRow>) => setD(p => ({ ...p, ...patch }))
  const writable = calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')

  async function save() {
    setSaving(true); setWhy(null)
    const slug = d.slug.trim() || slugify(d.title)
    const err = await onSave({ ...d, slug, title: d.title.trim() || 'A call' })
    setSaving(false)
    if (err) { setWhy(err); return }
    setOpen(false)
  }

  return (
    <div style={{ ...WHITE, gap: open ? 11 : 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          <span style={{ display: 'block', fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.title || 'Untitled call'}
          </span>
          <span style={{ display: 'block', marginTop: 2, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {d.duration_minutes} min{d.requires_approval ? ' · you approve' : ''}{d.active ? '' : ' · off'}
          </span>
        </button>
        {handle && d.id && (
          <button onClick={() => copy(bookingUrl(handle, d.slug), 'Link copied')} style={{ ...GHOST, width: 30, padding: 0, justifyContent: 'center' }}
            title={bookingUrl(handle, d.slug)} aria-label={`Copy the link to ${d.title}`}>
            <Link2 size={ICON.sm} />
          </button>
        )}
        <Switch on={d.active} label={`${d.title} can be booked`}
          onChange={v => { set({ active: v }); void onSave({ ...d, active: v }) }} />
      </div>

      {open && (
        <>
          <Row label="What it is called"><input value={d.title} onChange={e => set({ title: e.target.value })} style={IN} /></Row>
          <Row label="A line about it, for whoever is booking">
            <input value={d.blurb ?? ''} onChange={e => set({ blurb: e.target.value })} style={IN} />
          </Row>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Row label="How long">
              <select value={d.duration_minutes} onChange={e => set({ duration_minutes: Number(e.target.value) })} style={{ ...IN, cursor: 'pointer' }}>
                {MINUTES.map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </Row>
            <Row label="Start every">
              <select value={d.slot_step_minutes} onChange={e => set({ slot_step_minutes: Number(e.target.value) })} style={{ ...IN, cursor: 'pointer' }}>
                {MINUTES.map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </Row>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Row label="Gap before">
              <select value={d.buffer_before} onChange={e => set({ buffer_before: Number(e.target.value) })} style={{ ...IN, cursor: 'pointer' }}>
                {[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m ? `${m} min` : 'none'}</option>)}
              </select>
            </Row>
            <Row label="Gap after">
              <select value={d.buffer_after} onChange={e => set({ buffer_after: Number(e.target.value) })} style={{ ...IN, cursor: 'pointer' }}>
                {[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m ? `${m} min` : 'none'}</option>)}
              </select>
            </Row>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Row label="Least notice">
              <select value={d.min_notice_minutes} onChange={e => set({ min_notice_minutes: Number(e.target.value) })} style={{ ...IN, cursor: 'pointer' }}>
                {[0, 60, 120, 240, 720, 1440, 2880].map(m => (
                  <option key={m} value={m}>{m === 0 ? 'any time' : m < 1440 ? `${m / 60} h` : `${m / 1440} day${m > 1440 ? 's' : ''}`}</option>
                ))}
              </select>
            </Row>
            <Row label="How far ahead">
              <select value={d.horizon_days} onChange={e => set({ horizon_days: Number(e.target.value) })} style={{ ...IN, cursor: 'pointer' }}>
                {[7, 14, 30, 60, 90].map(x => <option key={x} value={x}>{x} days</option>)}
              </select>
            </Row>
          </div>

          <Row label="Most in one day">
            <select value={d.max_per_day ?? ''} onChange={e => set({ max_per_day: e.target.value ? Number(e.target.value) : null })} style={{ ...IN, cursor: 'pointer' }}>
              <option value="">no limit</option>
              {[1, 2, 3, 4, 5, 6, 8].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </Row>

          <Row label="Where its bookings go">
            <select value={d.target_calendar_id ?? ''} onChange={e => set({ target_calendar_id: e.target.value || null })} style={{ ...IN, cursor: 'pointer' }}>
              <option value="">my main calendar</option>
              {writable.map(c => (
                <option key={c.id} value={c.id}>
                  {(c.summaryOverride ?? c.summary)}{c.accountEmail ? ` · ${c.accountEmail}` : ''}
                </option>
              ))}
            </select>
          </Row>

          <Row label="What counts as busy">
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {calendars.map(c => {
                const on = (d.busy_calendar_ids ?? []).includes(c.id)
                return (
                  <button key={c.id} aria-pressed={on}
                    onClick={() => set({
                      busy_calendar_ids: on
                        ? d.busy_calendar_ids.filter(x => x !== c.id)
                        : [...(d.busy_calendar_ids ?? []), c.id],
                    })}
                    style={{
                      ...GHOST, height: 26, fontSize: 'var(--sb-t-meta)', fontWeight: on ? 700 : 500,
                      background: on ? 'var(--sb-positive-tint)' : 'var(--sb-card)',
                      borderColor: on ? 'color-mix(in srgb, var(--sb-positive) 45%, transparent)' : 'var(--sb-border)',
                      color: on ? 'var(--sb-positive-deep)' : 'var(--sb-ink-3)',
                    }}>
                    {(c.summaryOverride ?? c.summary).slice(0, 22)}
                  </button>
                )
              })}
            </span>
          </Row>
          <p style={{ margin: '-4px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', lineHeight: 1.45 }}>
            {(d.busy_calendar_ids ?? []).length
              ? 'Only these are read when working out what is free.'
              : 'Nothing picked, so your main calendar on each account is read — which is the right answer for most people.'}
          </p>

          <Row label="How you meet">
            <select value={d.location_mode} onChange={e => set({ location_mode: e.target.value as PlanRow['location_mode'] })} style={{ ...IN, cursor: 'pointer' }}>
              <option value="meet">A Meet link, minted per booking</option>
              <option value="place">Somewhere in particular</option>
              <option value="phone">A phone call</option>
              <option value="none">Say nothing</option>
            </select>
          </Row>
          {(d.location_mode === 'place' || d.location_mode === 'phone') && (
            <Row label={d.location_mode === 'place' ? 'Where' : 'Which number'}>
              <input value={d.location_text ?? ''} onChange={e => set({ location_text: e.target.value })} style={IN} />
            </Row>
          )}

          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ flex: 1, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>I accept each one myself</span>
            <Switch on={d.requires_approval} label="You approve each booking" onChange={v => set({ requires_approval: v })} />
          </span>

          <Row label="The end of its link">
            <input value={d.slug} onChange={e => set({ slug: slugify(e.target.value) })} placeholder={slugify(d.title)} style={IN} />
          </Row>

          {why && <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{why}</p>}

          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => onDelete(d.id)} style={{ ...GHOST, color: 'var(--sb-negative-deep)' }} aria-label={`Delete ${d.title}`}>
              <Trash2 size={ICON.sm} /> Delete
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setOpen(false)} style={GHOST}>Close</button>
            <button onClick={() => void save()} disabled={saving} style={INK}>
              {saving ? <Loader2 size={ICON.sm} /> : <Check size={ICON.sm} strokeWidth={STROKE.active} />} Save
            </button>
          </span>
        </>
      )}
    </div>
  )
}

// ─── The panel ───────────────────────────────────────────────────────────────

export function BookingPanel({ userId, userName, calendars, windowCount, openHours, onOpenHours, onClose }: {
  userId: string
  userName?: string
  calendars: ComposerCalendar[]
  /** How many hours have been opened — nothing can be booked without any. */
  windowCount: number
  openHours: boolean
  onOpenHours: (on: boolean) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [prof, setProf] = useState<BookingProfileRow | null>(null)
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [booked, setBooked] = useState<BookingRow[] | null>(null)
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [blurb, setBlurb] = useState('')
  const [why, setWhy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const tz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
  }, [])

  useEffect(() => {
    void (async () => {
      const p = await loadBookingProfile()
      setProf(p)
      setHandle(p?.handle ?? suggestHandle(userName ?? 'me'))
      setName(p?.display_name ?? userName ?? '')
      setBlurb(p?.blurb ?? '')
      setPlans(await loadPlans())
      setBooked(await loadBookings())
    })()
  }, [userName])

  async function savePage(patch: Partial<BookingProfileRow> = {}) {
    setSaving(true); setWhy(null)
    const row = {
      user_id: userId,
      handle: (patch.handle ?? handle).trim().toLowerCase(),
      display_name: patch.display_name ?? name.trim() ?? null,
      blurb: patch.blurb ?? blurb.trim() ?? null,
      timezone: patch.timezone ?? prof?.timezone ?? tz,
      active: patch.active ?? prof?.active ?? true,
    }
    const err = await saveBookingProfile(row)
    setSaving(false)
    if (err) { setWhy(err); return }
    setProf(row as BookingProfileRow)
    notify('Your booking page is saved')
  }

  const live = prof?.handle && prof.active
  const pending = (booked ?? []).filter(b => b.status === 'pending')
  const upcoming = (booked ?? []).filter(b => b.status === 'confirmed')
  const planTitle = (id: string) => plans?.find(p => p.id === id)?.title ?? 'A call'

  const when = (b: BookingRow) => {
    const at = Date.parse(b.start_at)
    return new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <ComposerShell panelRef={panelRef} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <p style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>
          Let people book me
        </p>
        <button onClick={onClose} style={{ ...GHOST, width: 30, padding: 0, justifyContent: 'center' }} aria-label="Close" title="Close">
          <X size={ICON.sm} />
        </button>
      </div>

      {/* ── Your page ──────────────────────────────────────────────────────── */}
      <div style={WHITE}>
        <p style={EYEBROW}>Your page</p>
        <Row label="Its address">
          <span style={{ display: 'flex', gap: 6 }}>
            <input value={handle} onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="your-name" style={IN} aria-label="The handle your booking page lives at" />
            <button onClick={() => void savePage()} disabled={saving || !handle.trim()} style={INK}>Save</button>
          </span>
        </Row>
        <Row label="The name on it"><input value={name} onChange={e => setName(e.target.value)} style={IN} /></Row>
        <Row label="A line about you"><input value={blurb} onChange={e => setBlurb(e.target.value)} style={IN} /></Row>
        {why && <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{why}</p>}
        {prof?.handle && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <button onClick={() => copy(bookingUrl(prof.handle), 'Your booking link is copied')} style={GHOST}>
              <Copy size={ICON.sm} /> Copy my link
            </button>
            <a href={bookingUrl(prof.handle)} target="_blank" rel="noopener noreferrer" style={{ ...GHOST, textDecoration: 'none' }}>
              <ExternalLink size={ICON.sm} /> See it
            </a>
            <span style={{ flex: 1 }} />
            <Switch on={!!prof.active} label="The page is live"
              onChange={v => void savePage({ active: v })} />
          </span>
        )}
        {!live && (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', lineHeight: 1.45 }}>
            Nothing is reachable until the page has an address and is switched on.
          </p>
        )}
      </div>

      {/* ── The hours ──────────────────────────────────────────────────────── */}
      <div style={{ ...WHITE, background: windowCount ? 'var(--sb-card)' : 'var(--sb-accent-tint)' }}>
        <p style={EYEBROW}>Open hours</p>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.45 }}>
          {windowCount
            ? `${windowCount} ${windowCount === 1 ? 'window' : 'windows'} open. Nothing is offered outside them, and never an hour that is already taken.`
            : 'Nothing is open yet, so nobody can book anything. Mark the hours on the week — drag across a morning the way you would draw an event.'}
        </p>
        <button onClick={() => onOpenHours(!openHours)} style={openHours ? INK : GHOST} aria-pressed={openHours}>
          {openHours ? <><Check size={ICON.sm} strokeWidth={STROKE.active} /> Marking hours — done</> : <><Plus size={ICON.sm} /> Mark hours on the week</>}
        </button>
      </div>

      {/* ── The calls ──────────────────────────────────────────────────────── */}
      <div style={{ ...WHITE, gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <p style={{ ...EYEBROW, flex: 1 }}>What can be booked</p>
          <button
            onClick={() => setPlans(p => [...(p ?? []), {
              id: '', user_id: userId, slug: '', title: '', blurb: null,
              duration_minutes: 30, slot_step_minutes: 30, buffer_before: 0, buffer_after: 0,
              min_notice_minutes: 240, horizon_days: 30, max_per_day: null, narrow: null,
              target_calendar_id: null, target_account_id: null, busy_calendar_ids: [],
              location_mode: 'meet', location_text: null, requires_approval: false,
              active: true, sort_order: (p?.length ?? 0),
            }])}
            style={GHOST}><Plus size={ICON.sm} /> Add one</button>
        </span>
        {plans === null ? (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Fetching them…</p>
        ) : plans.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
            No calls yet. One is enough to start — "Intro call, 30 minutes".
          </p>
        ) : plans.map((p, i) => (
          <PlanCard
            key={p.id || `new-${i}`}
            plan={p}
            handle={prof?.handle ?? null}
            calendars={calendars}
            onSave={async next => {
              const err = await savePlan({ ...next, user_id: userId, id: next.id || undefined })
              if (!err) { setPlans(await loadPlans()); notify(`"${next.title}" saved`) }
              return err
            }}
            onDelete={async id => {
              if (!id) { setPlans(ps => (ps ?? []).filter((_, j) => j !== i)); return }
              if (!confirm('Delete this call? Anything already booked on it goes too.')) return
              if (await deletePlan(id)) { setPlans(await loadPlans()); notify('Deleted') }
            }} />
        ))}
      </div>

      {/* ── What came in ───────────────────────────────────────────────────── */}
      <div style={{ ...WHITE, gap: 9 }}>
        <p style={EYEBROW}>What is booked</p>

        {pending.map(b => (
          <div key={b.id} style={{
            display: 'flex', flexDirection: 'column', gap: 7, padding: '9px 10px',
            borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-accent-tint)',
            border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-accent) 40%, transparent)',
          }}>
            <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>
              {b.invitee_name} · {planTitle(b.plan_id)}
            </span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)' }}>{when(b)} · waiting for you</span>
            {b.invitee_note && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>{b.invitee_note}</span>}
            <span style={{ display: 'flex', gap: 7 }}>
              <button onClick={async () => {
                const r = await decideBooking(b.id, 'accept')
                notify(r.ok ? `Accepted — ${b.invitee_name} has the invitation` : 'Could not accept it')
                setBooked(await loadBookings())
              }} style={INK}><Check size={ICON.sm} strokeWidth={STROKE.active} /> Accept</button>
              <button onClick={async () => {
                const r = await decideBooking(b.id, 'decline')
                notify(r.ok ? 'Declined' : 'Could not decline it')
                setBooked(await loadBookings())
              }} style={GHOST}>Decline</button>
            </span>
          </div>
        ))}

        {booked === null ? (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Fetching them…</p>
        ) : upcoming.length === 0 && pending.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Nothing booked yet.</p>
        ) : upcoming.map(b => (
          <span key={b.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--sb-t-body-s)' }}>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.invitee_name} · {planTitle(b.plan_id)}
            </span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', flexShrink: 0 }}>{when(b)}</span>
            <button onClick={() => copy(manageUrl(b.manage_token), 'Their cancel link is copied')}
              style={{ ...GHOST, width: 26, height: 26, padding: 0, justifyContent: 'center' }}
              aria-label={`Copy the link ${b.invitee_name} uses to change this`} title="Their own link to move or cancel it">
              <Link2 size={ICON.sm} />
            </button>
          </span>
        ))}
      </div>
    </ComposerShell>
  )
}
