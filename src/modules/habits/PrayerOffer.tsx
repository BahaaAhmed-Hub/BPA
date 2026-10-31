import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { askLocation, enablePrayers, loadPrayerState, PRAYER_EVENT, prayerLikeHabits } from '@/lib/prayerState'
import { DEFAULT_PRAYER_EMOJI } from '@/lib/glyphs'
import { useHabitsStore } from '@/store/habitsStore'

const KEY = 'professor-prayer-offer-dismissed'
const seen = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

/** The way in, on the Habits page itself: until prayer times are switched on there is no card to
 *  see, and a Settings switch is easy to never find. Names the habit the person already keeps, if
 *  there is one, and offers to make it the five daily prayers; otherwise offers the built-in one.
 *  "Not now" is remembered on this device; Settings → Habits → Prayer times is always there. */
export function PrayerOffer() {
  const [state, setState] = useState(loadPrayerState)
  const [gone, setGone] = useState(seen)
  const habits = useHabitsStore(s => s.habits)
  useEffect(() => {
    const h = () => setState(loadPrayerState())
    window.addEventListener(PRAYER_EVENT, h); window.addEventListener('professor:prefsRestored', h)
    return () => { window.removeEventListener(PRAYER_EVENT, h); window.removeEventListener('professor:prefsRestored', h) }
  }, [])
  if (state.enabled || gone) return null

  const had = habits.length ? prayerLikeHabits() : []
  const on = async (adopt?: string) => {
    enablePrayers(adopt)
    if (!loadPrayerState().place) await askLocation()
  }
  const dismiss = () => { try { localStorage.setItem(KEY, '1') } catch { /* private mode */ } setGone(true) }

  return (
    <div data-prayer-offer style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px',
      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
    }}>
      <span aria-hidden style={{ fontSize: 22 }}>{DEFAULT_PRAYER_EMOJI}</span>
      <span style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
          {had.length ? `Make “${had[0].name}” the five daily prayers` : 'Track the five daily prayers at their times'}
        </span>
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
          {had.length
            ? 'Fajr, Dhuhr, Asr, Maghrib and Isha, each ticked at its own time, worked out for where you are. Your picture and history are kept — 1 logged becomes Maghrib, 2 Dhuhr and Asr, 3 Fajr, Dhuhr and Asr, 4 adds Maghrib.'
            : 'Each prayer unlocks at its time, worked out on this device for where you are. Switch it off any time in Settings → Habits.'}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button variant="primary" onClick={() => void on(had[0]?.id)}>{had.length ? 'Convert' : 'Turn on'}</Button>
        {had.length > 0 && <Button variant="secondary" onClick={() => void on()}>Start a new one</Button>}
        <Button variant="ghost" onClick={dismiss}>Not now</Button>
      </span>
    </div>
  )
}
