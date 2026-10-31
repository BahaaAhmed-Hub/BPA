import { useEffect, useMemo, useState } from 'react'
import { Check, Lock } from 'lucide-react'
import {
  clock, currentPrayer, hasBegun, maskCount, maskHas, maskToggle, PRAYERS, PRAYER_LABEL, prayerTimes,
  type PrayerId,
} from '@/lib/prayer'
import { askLocation, loadPrayerState, PRAYER_EVENT, readDay, writeDay } from '@/lib/prayerState'
import { ICON } from '@/lib/type'
import { useHabitsStore } from '@/store/habitsStore'

const minutesNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

/** "in 1h 12m" / "in 25m" — how long until a time later today. */
function until(min: number, now: number): string {
  const d = Math.max(0, min - now)
  return d >= 60 ? `in ${Math.floor(d / 60)}h ${d % 60 ? `${d % 60}m` : ''}`.trim() : `in ${d}m`
}

/** The five prayers of one day, each at its own time — not a counter. A prayer opens when its time
 *  begins and stays open for the rest of the day, so a missed one can still be marked; the day after
 *  today is closed. Replaces the Prayers habit's row in the three views (the habit still counts in
 *  every total). Shown only where the person has turned prayer times on. */
export function PrayerCard({ day, today }: { day: string; today: string }) {
  const [state, setState] = useState(loadPrayerState)
  const [now, setNow] = useState(minutesNow)
  const habit = useHabitsStore(s => s.habits.find(h => h.id === state.habitId))

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
  if (!state.enabled || !habit) return null

  const mask = readDay(state, day)
  const done = maskCount(mask)
  const open = times ? currentPrayer(times, now) : null
  const isToday = day === today
  const next = isToday && times ? PRAYERS.find(p => times[p] !== null && (times[p] as number) > now) : undefined

  const tap = (p: PrayerId) => {
    if (times && !hasBegun(p, day, today, now, times)) return
    writeDay(day, maskToggle(mask, p))
    setState(loadPrayerState())
  }

  return (
    <div data-prayer-card style={{
      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
      boxShadow: 'var(--sb-shadow-control)', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span aria-hidden style={{
          width: 40, height: 40, borderRadius: 'var(--sb-r-nav)', flexShrink: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          background: habit.image ? `center / cover no-repeat url(${habit.image})` : 'var(--sb-accent-tint)',
        }}>{habit.image ? null : habit.emoji}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>
            {habit.name}
          </span>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {!state.place
              ? <>Times need a place. <button type="button" onClick={() => void askLocation()} style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: 'var(--sb-ink-1)', textDecoration: 'underline' }}>Use my location</button> or choose a city in Settings → Habits.</>
              : next && times ? `Next: ${PRAYER_LABEL[next]} at ${clock(times[next])} · ${until(times[next] as number, now)}`
              : isToday ? 'Every prayer today has begun' : state.place.label ?? ''}
          </span>
        </span>
        <span data-prayer-count style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, color: 'var(--sb-ink-1)', flexShrink: 0 }}>
          {done}<span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', fontWeight: 500 }}> of 5</span>
        </span>
      </div>

      <div role="group" aria-label="The five prayers" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
        {PRAYERS.map(p => {
          const got = maskHas(mask, p)
          const locked = !!times && !hasBegun(p, day, today, now, times)
          const current = isToday && open === p && !got
          return (
            <button key={p} type="button" data-prayer={p} data-state={got ? 'done' : locked ? 'locked' : current ? 'current' : 'open'}
              aria-pressed={got} aria-disabled={locked}
              title={locked && times ? `Opens at ${clock(times[p])}` : got ? 'Done — tap to undo' : 'Mark as prayed'}
              onClick={() => tap(p)}
              style={{
                minHeight: 76, padding: '10px 4px', borderRadius: 'var(--sb-r-nav)', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                cursor: locked ? 'default' : 'pointer',
                background: got ? 'var(--sb-accent)' : 'var(--sb-field)',
                color: got ? 'var(--sb-accent-ink)' : locked ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
                border: current ? '2px solid var(--sb-accent-deep)' : 'var(--sb-border-width) solid var(--sb-border)',
              }}>
              <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600 }}>{PRAYER_LABEL[p]}</span>
              <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-meta)', color: got ? 'var(--sb-accent-ink)' : locked ? 'var(--sb-ink-4)' : 'var(--sb-ink-3)' }}>
                {times ? clock(times[p]) : ' '}
              </span>
              {got ? <Check size={ICON.sm} strokeWidth={2.4} /> : locked ? <Lock size={ICON.sm} /> : <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid var(--sb-ink-4)' }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
