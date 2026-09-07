// ─── The Repeat sheet ────────────────────────────────────────────────────────
// Shaped after the iOS Calendar's, because that is the one everybody already
// knows: six ready answers with a tick against the one in force, and Custom
// behind them holding frequency, interval, which days, which dates, which
// months, and when the whole thing stops.
//
// A ready answer applies the moment it is tapped and closes the sheet. Custom
// is a second pane — the same popover, not a second popover — and applies on
// Done, because a half-built custom rule is not a rule anybody meant.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  PRESETS, RRULE_DAYS, DAY_INITIAL, DAY_LONG, MONTH_SHORT, SET_POS,
  presetOf, presetRecur, summarise,
  type Recur, type Freq, type RDay,
} from './recurrence'

const CARD: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 95,
  background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
  boxShadow: 'var(--sb-shadow-frame)',
  padding: 6, maxHeight: 'min(62vh, 460px)', overflowY: 'auto', scrollbarWidth: 'thin',
}
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 38,
  padding: '0 11px', borderRadius: 'var(--sb-r-sm)', border: 'none', background: 'transparent',
  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-label)', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
}
const GROUP_LABEL: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-4)',
  textTransform: 'uppercase', padding: '10px 11px 5px',
}
const HAIRLINE: React.CSSProperties = { height: 1, background: 'var(--sb-hairline)', margin: '6px 4px' }

/** One pill in a segmented row — the same shape the settings pages use. */
function Seg<T extends string | number>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: '#F5F1E6', borderRadius: 'var(--sb-r-sm)', padding: 3 }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={String(o.value)} onClick={() => onChange(o.value)} style={{
            flex: 1, height: 28, borderRadius: 'var(--sb-r-chip)', border: 'none', cursor: 'pointer',
            background: on ? 'var(--sb-card)' : 'transparent',
            boxShadow: on ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
            color: on ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 600 : 500,
            fontFamily: 'inherit', whiteSpace: 'nowrap', padding: '0 8px',
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}

/** A cell in the day / date / month grids: on is ink, off is the field colour. */
function Cell({ on, label, onClick, wide }: { on: boolean; label: string; onClick: () => void; wide?: boolean }) {
  return (
    <button onClick={onClick} style={{
      height: 30, minWidth: 0, width: '100%', borderRadius: wide ? 8 : '50%',
      border: `1px solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
      background: on ? 'var(--sb-ink-1)' : 'var(--sb-field)', color: on ? 'var(--sb-card)' : 'var(--sb-ink-3)',
      fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 700 : 500, fontFamily: 'inherit', cursor: 'pointer', padding: 0,
    }}>{label}</button>
  )
}

const selectStyle: React.CSSProperties = {
  height: 32, borderRadius: 'var(--sb-r-chip)', border: '1px solid var(--sb-border)', background: 'var(--sb-field)',
  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit', padding: '0 8px', cursor: 'pointer',
}

export function RepeatPicker({ value, start, onApply, onClose }: {
  value: Recur | null
  /** The first occurrence — it decides what "Every Week" and "Every Month" mean. */
  start: Date
  onApply: (r: Recur | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState<'list' | 'custom'>(() => presetOf(value, start) === 'custom' ? 'custom' : 'list')
  const [draft, setDraft] = useState<Recur>(() => value ?? presetRecur('weekly', start)!)
  const preset = presetOf(value, start)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', fn)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fn); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const unit = draft.freq === 'DAILY' ? 'day' : draft.freq === 'WEEKLY' ? 'week' : draft.freq === 'MONTHLY' ? 'month' : 'year'

  function setFreq(freq: Freq) {
    // Each frequency keeps only what it can mean, and starts from the event's
    // own day — a monthly rule carrying last week's BYDAY says nothing.
    if (freq === 'WEEKLY') setDraft({ freq, interval: draft.interval, byDay: [RRULE_DAYS[start.getDay()]], until: draft.until })
    else if (freq === 'MONTHLY') setDraft({ freq, interval: draft.interval, monthDays: [start.getDate()], until: draft.until })
    else if (freq === 'YEARLY') setDraft({ freq, interval: draft.interval, byMonth: [start.getMonth() + 1], until: draft.until })
    else setDraft({ freq, interval: draft.interval, until: draft.until })
  }

  function toggleDay(d: RDay) {
    const has = draft.byDay?.includes(d)
    const next = has ? (draft.byDay ?? []).filter(x => x !== d) : [...(draft.byDay ?? []), d]
    // A weekly rule with no day at all repeats on nothing.
    if (draft.freq === 'WEEKLY' && next.length === 0) return
    setDraft({ ...draft, byDay: next.sort((a, b) => RRULE_DAYS.indexOf(a) - RRULE_DAYS.indexOf(b)) })
  }

  function toggleDate(n: number) {
    const has = draft.monthDays?.includes(n)
    const next = has ? (draft.monthDays ?? []).filter(x => x !== n) : [...(draft.monthDays ?? []), n]
    if (next.length === 0) return
    setDraft({ ...draft, monthDays: next.sort((a, b) => a - b), setPos: undefined, byDay: undefined })
  }

  function toggleMonth(m: number) {
    const has = draft.byMonth?.includes(m)
    const next = has ? (draft.byMonth ?? []).filter(x => x !== m) : [...(draft.byMonth ?? []), m]
    if (next.length === 0) return
    setDraft({ ...draft, byMonth: next.sort((a, b) => a - b) })
  }

  const monthlyMode: 'each' | 'onthe' = draft.setPos !== undefined ? 'onthe' : 'each'

  return (
    <div ref={ref} onMouseDown={e => e.stopPropagation()} style={CARD}>
      {pane === 'list' ? (
        <>
          {PRESETS.map(p => (
            <button key={p.value} style={ROW}
              onClick={() => { onApply(p.value === 'never' ? null : presetRecur(p.value, start)); onClose() }}>
              <span style={{ flex: 1 }}>{p.label}</span>
              {preset === p.value && <Check size={15} strokeWidth={2.6} color="var(--sb-ink-1)" />}
            </button>
          ))}
          <div style={HAIRLINE} />
          <button style={ROW} onClick={() => setPane('custom')}>
            <span style={{ flex: 1 }}>Custom</span>
            {preset === 'custom' && <Check size={15} strokeWidth={2.6} color="var(--sb-ink-1)" />}
            <ChevronRight size={15} color="var(--sb-ink-4)" />
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 6px' }}>
            <button onClick={() => setPane('list')} title="Back"
              style={{ ...ROW, width: 'auto', height: 28, padding: '0 6px', gap: 4, color: 'var(--sb-ink-3)' }}>
              <ChevronLeft size={15} /> Repeat
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => { onApply(draft); onClose() }} style={{
              height: 28, padding: '0 14px', borderRadius: 'var(--sb-r-pill)', border: 'none', cursor: 'pointer',
              background: 'var(--sb-ink-1)', color: 'var(--sb-card)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, fontFamily: 'inherit',
            }}>Done</button>
          </div>

          <div style={GROUP_LABEL}>Frequency</div>
          <div style={{ padding: '0 6px' }}>
            <Seg<Freq>
              value={draft.freq}
              options={[
                { value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly' },
                { value: 'MONTHLY', label: 'Monthly' }, { value: 'YEARLY', label: 'Yearly' },
              ]}
              onChange={setFreq} />
          </div>

          <div style={GROUP_LABEL}>Every</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}>
            <button onClick={() => setDraft({ ...draft, interval: Math.max(1, draft.interval - 1) })}
              style={{ ...selectStyle, width: 32, textAlign: 'center', fontSize: 'var(--sb-t-h3)', lineHeight: '28px', padding: 0 }}>−</button>
            <span style={{ minWidth: 108, textAlign: 'center', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>
              {draft.interval === 1 ? `Every ${unit}` : `${draft.interval} ${unit}s`}
            </span>
            <button onClick={() => setDraft({ ...draft, interval: Math.min(99, draft.interval + 1) })}
              style={{ ...selectStyle, width: 32, textAlign: 'center', fontSize: 'var(--sb-t-h3)', lineHeight: '28px', padding: 0 }}>+</button>
          </div>

          {draft.freq === 'WEEKLY' && (
            <>
              <div style={GROUP_LABEL}>On these days</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, padding: '0 8px' }}>
                {RRULE_DAYS.map((d, i) => (
                  <Cell key={d} on={!!draft.byDay?.includes(d)} label={DAY_INITIAL[i]} onClick={() => toggleDay(d)} />
                ))}
              </div>
            </>
          )}

          {(draft.freq === 'MONTHLY' || draft.freq === 'YEARLY') && (
            <>
              {draft.freq === 'YEARLY' && (
                <>
                  <div style={GROUP_LABEL}>In these months</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, padding: '0 8px' }}>
                    {MONTH_SHORT.map((m, i) => (
                      <Cell key={m} wide on={!!draft.byMonth?.includes(i + 1)} label={m} onClick={() => toggleMonth(i + 1)} />
                    ))}
                  </div>
                </>
              )}

              <div style={GROUP_LABEL}>{draft.freq === 'MONTHLY' ? 'On' : 'And on'}</div>
              <div style={{ padding: '0 6px' }}>
                <Seg<'each' | 'onthe'>
                  value={monthlyMode}
                  options={draft.freq === 'MONTHLY'
                    ? [{ value: 'each', label: 'Each' }, { value: 'onthe', label: 'On the' }]
                    : [{ value: 'each', label: 'The same date' }, { value: 'onthe', label: 'On the' }]}
                  onChange={mode => setDraft(mode === 'onthe'
                    ? { ...draft, setPos: 1, byDay: [RRULE_DAYS[start.getDay()]], monthDays: undefined }
                    : { ...draft, setPos: undefined, byDay: undefined, monthDays: draft.freq === 'MONTHLY' ? [start.getDate()] : undefined })} />
              </div>

              {monthlyMode === 'each' && draft.freq === 'MONTHLY' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, padding: '8px 8px 0' }}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(n => (
                    <Cell key={n} on={!!draft.monthDays?.includes(n)} label={String(n)} onClick={() => toggleDate(n)} />
                  ))}
                </div>
              )}

              {monthlyMode === 'onthe' && (
                <div style={{ display: 'flex', gap: 6, padding: '8px 8px 0' }}>
                  <select value={String(draft.setPos ?? 1)} style={{ ...selectStyle, flex: 1 }}
                    onChange={e => setDraft({ ...draft, setPos: Number(e.target.value) })}>
                    {SET_POS.map(p => <option key={p.value} value={p.value}>{p.label.charAt(0).toUpperCase() + p.label.slice(1)}</option>)}
                  </select>
                  <select value={draft.byDay?.[0] ?? RRULE_DAYS[start.getDay()]} style={{ ...selectStyle, flex: 1.4 }}
                    onChange={e => setDraft({ ...draft, byDay: [e.target.value as RDay] })}>
                    {RRULE_DAYS.map((d, i) => <option key={d} value={d}>{DAY_LONG[i]}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          <div style={GROUP_LABEL}>End repeat</div>
          <div style={{ padding: '0 6px' }}>
            <Seg<'never' | 'on'>
              value={draft.until ? 'on' : 'never'}
              options={[{ value: 'never', label: 'Never' }, { value: 'on', label: 'On a date' }]}
              onChange={mode => {
                if (mode === 'never') { setDraft({ ...draft, until: undefined }); return }
                const d = new Date(start); d.setFullYear(d.getFullYear() + 1)
                setDraft({ ...draft, until: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
              }} />
          </div>
          {draft.until && (
            <div style={{ padding: '8px 8px 0' }}>
              <input type="date" value={draft.until} onChange={e => setDraft({ ...draft, until: e.target.value || undefined })}
                style={{ ...selectStyle, width: '100%', boxSizing: 'border-box' }} />
            </div>
          )}

          <p style={{ margin: '12px 10px 6px', fontSize: 'var(--sb-t-meta)', lineHeight: 1.45, color: 'var(--sb-ink-3)' }}>
            {summarise(draft, start)}
          </p>
        </>
      )}
    </div>
  )
}
