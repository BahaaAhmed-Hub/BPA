import { useEffect, useMemo, useState } from 'react'
import {
  clock, currentPrayer, hasBegun, maskHas, maskToggle, PRAYERS, PRAYER_LABEL, prayerTimes, type PrayerId, type PrayerTimes,
} from '@/lib/prayer'
import { askLocation, loadPrayerState, PRAYER_EVENT, readDay, writeDay, type PrayerState } from '@/lib/prayerState'

const minutesNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

/** The prayer habit's day: which of the five are done, when each begins, and what a tap does. One
 *  hook behind every place the habit is drawn (the table row, the wall card, the fill card), so the
 *  three cannot disagree about what is open. */
export function usePrayerDay(day: string, today: string): {
  state: PrayerState; mask: number; times: PrayerTimes | null; open: PrayerId | null
  locked: (p: PrayerId) => boolean; tap: (p: PrayerId) => void; needsPlace: boolean
} {
  const [state, setState] = useState(loadPrayerState)
  const [now, setNow] = useState(minutesNow)
  useEffect(() => {
    const h = () => { setState(loadPrayerState()); setNow(minutesNow()) }
    const names = [PRAYER_EVENT, 'professor:habitLogsUpdated', 'professor:prefsRestored']
    names.forEach(n => window.addEventListener(n, h))
    const t = setInterval(() => setNow(minutesNow()), 30000)
    return () => { names.forEach(n => window.removeEventListener(n, h)); clearInterval(t) }
  }, [])
  const times = useMemo(
    () => state.place ? prayerTimes(day, state.place, state.method, state.school) : null,
    [day, state.place, state.method, state.school],
  )
  const mask = readDay(state, day)
  const locked = (p: PrayerId) => !!times && !hasBegun(p, day, today, now, times)
  return {
    state, mask, times,
    open: day === today && times ? currentPrayer(times, now) : null,
    locked,
    tap: p => { if (locked(p)) return; writeDay(day, maskToggle(mask, p)); setState(loadPrayerState()) },
    needsPlace: !state.place,
  }
}

/** The five prayers as five buttons, each its own state — done, open now, open, or not yet begun.
 *  `names` spells them out (the table row has the room); `letters` is for a card, where the full name
 *  and time are in the tooltip and the accessible name. Before a place is known there are no times, so
 *  the strip is a single prompt. */
export function PrayerPills({ day, today, layout, tone = 'dark' }: {
  day: string; today: string; layout: 'names' | 'letters'; tone?: 'light' | 'dark'
}) {
  const d = usePrayerDay(day, today)
  const light = tone === 'light'
  if (d.needsPlace) {
    return (
      <button type="button" data-prayer-place onClick={e => { e.stopPropagation(); void askLocation() }}
        style={{
          height: 28, padding: '0 10px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 'var(--sb-t-meta)', fontWeight: 600, whiteSpace: 'nowrap',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
        }}>
        Use my location for the times
      </button>
    )
  }
  return (
    <span role="group" aria-label="The five prayers" data-prayer-pills style={{ display: 'flex', gap: layout === 'names' ? 5 : 3, minWidth: 0, width: layout === 'names' ? undefined : '100%' }}>
      {PRAYERS.map(p => {
        const got = maskHas(d.mask, p)
        const locked = d.locked(p)
        const current = d.open === p && !got
        const time = d.times ? clock(d.times[p]) : ''
        return (
          <button key={p} type="button" data-prayer={p}
            data-state={got ? 'done' : locked ? 'locked' : current ? 'current' : 'open'}
            aria-pressed={got} aria-disabled={locked} aria-label={`${PRAYER_LABEL[p]} ${time}`.trim()}
            title={locked ? `${PRAYER_LABEL[p]} · opens at ${time}` : `${PRAYER_LABEL[p]} · ${time}${got ? ' · done — tap to undo' : ''}`}
            onClick={e => { e.stopPropagation(); d.tap(p) }}
            style={{
              flex: layout === 'names' ? '0 0 auto' : '1 1 0', minWidth: 0, height: 28, boxSizing: 'border-box',
              padding: layout === 'names' ? '0 10px' : 0, borderRadius: 'var(--sb-r-pill)', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--sb-t-meta)', fontWeight: 700, whiteSpace: 'nowrap',
              cursor: locked ? 'default' : 'pointer',
              background: got ? 'var(--sb-accent)' : 'var(--sb-field)',
              color: got ? 'var(--sb-accent-ink)' : locked ? 'var(--sb-ink-4)' : light ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-1)', // ui-guard: ink-ok — a prayer that has not begun is a disabled control
              border: current ? '2px solid var(--sb-accent-deep)' : `var(--sb-border-width) ${locked ? 'dashed' : 'solid'} var(--sb-border)`,
            }}>
            {layout === 'names' ? PRAYER_LABEL[p] : PRAYER_LABEL[p][0]}
          </button>
        )
      })}
    </span>
  )
}
