// ─── Scheduling popover ──────────────────────────────────────────────────────
// Wherever a calendar icon appears — the detail panel, a board card, a list row
// — clicking it opens this: a month grid and two time pickers of our own. The
// native <input type="time"> handed the browser's spinner wheel to the user,
// which looks nothing like the rest of the app.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { T, ICON, STROKE } from '@/lib/type'
import { useSlotConflicts } from '@/lib/slotConflicts'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = (h * 60 + m + mins + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** "09:30" → "9:30 am" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

const SLOTS: string[] = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)

const FIELD: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 32, padding: '0 10px',
  background: 'var(--sb-field)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)',
  ...T.meta, color: 'var(--sb-ink-1)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', textAlign: 'left',
}

/** A time in quarter-hours, or anything you type. */
export function TimeSelect({ value, onChange, label, size = 'compact' }: {
  value: string
  onChange: (v: string) => void
  /** Omit to render the control on its own, with no caption above it. */
  label?: string
  /** "large" is the event panel's sand time pill; "compact" is everywhere else. */
  size?: 'compact' | 'large'
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Open on the current time, not at midnight
  useEffect(() => {
    if (!open || !listRef.current) return
    const idx = Math.max(0, Math.round(toMinutes(value) / 15) - 2)
    listRef.current.scrollTop = idx * 28
  }, [open, value])

  function commitTyped() {
    const m = typed.trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/i)
    if (!m) return
    let h = Number(m[1])
    const min = Number(m[2] ?? 0)
    const mer = m[3]?.toLowerCase()
    if (mer === 'pm' && h < 12) h += 12
    if (mer === 'am' && h === 12) h = 0
    if (h > 23 || min > 59) return
    onChange(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
    setTyped('')
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
      {label && <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 4 }}>{label}</span>}
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        ...FIELD, borderColor: open ? 'var(--sb-border)' : 'var(--sb-border)',
        ...(size === 'large' ? {
          height: 48, borderRadius: 'var(--sb-r-nav)', ...T.body,
          border: '1px solid transparent', justifyContent: 'center',
        } : null),
      }}>{formatTime(value)}</button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 90, width: '100%', minWidth: 124,
          background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: 6,
          boxShadow: 'var(--sb-shadow-frame)',
        }}>
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTyped() } }}
            placeholder="type e.g. 9:45"
            style={{
              width: '100%', boxSizing: 'border-box', height: 28, padding: '0 8px', marginBottom: 5,
              background: 'var(--sb-field)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)',
              ...T.meta, color: 'var(--sb-ink-1)', outline: 'none', textAlign: 'left',
            }} />
          <div ref={listRef} style={{ maxHeight: 196, overflowY: 'auto', scrollbarWidth: 'thin' }}>
            {SLOTS.map(t => {
              const on = t === value
              return (
                <button key={t} type="button" onClick={() => { onChange(t); setOpen(false) }} style={{
                  width: '100%', height: 28, padding: '0 8px', border: 'none', borderRadius: 'var(--sb-r-chip)',
                  background: on ? 'var(--sb-ink-1)' : 'transparent', color: on ? 'var(--sb-card)' : 'var(--sb-ink-1)',
                  ...T.meta, fontWeight: on ? 600 : 500, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  {formatTime(t)}
                  {on && <Check size={ICON.sm} strokeWidth={STROKE.active} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function SchedulePopover({ date, start, duration, onApply, onClose, align = 'left', ignoreEventId }: {
  date?: string
  start?: string
  duration?: number
  onApply: (patch: { dueDate?: string; plannedTime?: string; duration?: number }) => void
  onClose: () => void
  /** A card near the right edge opens its popover leftwards. */
  align?: 'left' | 'right'
  /** The event being rescheduled, so it does not count as clashing with itself. */
  ignoreEventId?: string
}) {
  const initial = date ? new Date(date + 'T00:00:00') : new Date()
  const [view, setView] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1))
  const [picked, setPicked] = useState<string | undefined>(date)
  const [from, setFrom] = useState(start ?? '09:00')
  const [to, setTo] = useState(addMinutes(start ?? '09:00', duration ?? 30))
  // End follows the start by whatever gap is currently showing — 30 minutes to
  // begin with, or whatever the user last set the end to.
  const gapRef = useRef(duration ?? 30)

  function changeStart(v: string) {
    setFrom(v)
    setTo(addMinutes(v, gapRef.current))
  }

  function changeEnd(v: string) {
    setTo(v)
    const gap = toMinutes(v) - toMinutes(from)
    if (gap > 0) gapRef.current = gap
  }

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const lead = (first.getDay() + 6) % 7   // Monday-first, like the artboard
    const startCell = new Date(first)
    startCell.setDate(first.getDate() - lead)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(startCell)
      d.setDate(startCell.getDate() + i)
      return d
    })
  }, [view])

  const minutes = Math.max(0, toMinutes(to) - toMinutes(from))
  const { conflicts, checking } = useSlotConflicts(picked, from, to, ignoreEventId)
  const navBtn: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', border: 'none', background: 'transparent',
    color: 'var(--sb-ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', zIndex: 80, width: 292,
        ...(align === 'right' ? { right: 0 } : { left: 0 }),
        background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-card)', padding: 14,
        boxShadow: 'var(--sb-shadow-frame)', textAlign: 'left',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ flex: 1, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
          {view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1))} style={navBtn}>
          <ChevronLeft size={ICON.sm} />
        </button>
        <button type="button" onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1))} style={navBtn}>
          <ChevronRight size={ICON.sm} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} style={{ textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-4)', padding: '2px 0 4px' }}>{w}</span>
        ))}
        {cells.map(d => {
          const iso = toISODate(d)
          const outside = d.getMonth() !== view.getMonth()
          const on = iso === picked
          return (
            <button key={iso} type="button" onClick={() => setPicked(iso)} style={{
              height: 28, borderRadius: 'var(--sb-r-chip)', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: on ? 'var(--sb-ink-1)' : 'transparent',
              color: on ? 'var(--sb-card)' : outside ? 'var(--sb-border)' : 'var(--sb-ink-1)',
              fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 700 : 500,
            }}>{d.getDate()}</button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <TimeSelect label="Start" value={from} onChange={changeStart} />
        <TimeSelect label="End" value={to} onChange={changeEnd} />
      </div>

      {/* What is already in that slot, answered as the time moves rather than
          after the booking is made. */}
      {picked && (
        checking && conflicts === null ? (
          <p style={{ ...T.meta, margin: '9px 0 0', color: 'var(--sb-ink-4)' }}>Checking that time…</p>
        ) : conflicts === null ? null
        : conflicts.length === 0 ? (
          <p style={{ ...T.meta, margin: '9px 0 0', color: 'var(--sb-positive)' }}>
            Nothing else booked then.
          </p>
        ) : (
          <div style={{
            marginTop: 9, padding: '8px 10px', borderRadius: 'var(--sb-r-sm)',
            background: 'rgba(var(--sb-accent-rgb),0.22)', border: '1px solid rgba(var(--sb-accent-rgb),0.7)',
          }}>
            <p style={{ ...T.meta, margin: 0, fontWeight: 600, color: 'var(--sb-ink-2)' }}>
              {conflicts.length === 1 ? 'Clashes with' : `Clashes with ${conflicts.length} events`}
            </p>
            {conflicts.slice(0, 3).map(c => (
              <p key={c.id} style={{
                ...T.meta, margin: '3px 0 0', color: 'var(--sb-ink-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.title} · {formatTime(c.from)} – {formatTime(c.to)}
              </p>
            ))}
            {conflicts.length > 3 && (
              <p style={{ ...T.meta, margin: '3px 0 0', color: 'var(--sb-ink-3)' }}>
                and {conflicts.length - 3} more
              </p>
            )}
          </div>
        )
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={{ flex: 1, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
          {minutes > 0 ? `${minutes}m block at ${formatTime(from)}` : 'End must follow start'}
        </span>
        {(date || start) && (
          <button
            type="button"
            onClick={() => { onApply({ dueDate: undefined, plannedTime: undefined, duration: undefined }); onClose() }}
            style={{
              height: 30, padding: '0 12px', borderRadius: 'var(--sb-r-chip)', border: '1px solid var(--sb-border)', cursor: 'pointer',
              background: 'transparent', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, fontFamily: 'inherit',
            }}>Clear</button>
        )}
        <Button variant="primary" type="button" onClick={() => { onApply({ dueDate: picked, plannedTime: from, duration: minutes || undefined }); onClose() }}>Set block</Button>
      </div>
    </div>
  )
}
