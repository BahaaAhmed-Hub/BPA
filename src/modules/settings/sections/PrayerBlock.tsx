import { useEffect, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import {
  clock, METHODS, PRAYERS, PRAYER_LABEL, prayerTimes, type AsrSchool, type PrayerMethod,
} from '@/lib/prayer'
import { PRAYER_CITIES } from '@/lib/prayerCities'
import {
  askLocation, disablePrayers, enablePrayers, loadPrayerState, patchPrayerState, prayerLikeHabits, PRAYER_EVENT,
} from '@/lib/prayerState'
import { ICON } from '@/lib/type'
import { Button } from '@/components/ui'
import { inputStyle } from '@/modules/library/fieldStyle'
import { FieldRow, Toggle } from '../ui'

const today = () => new Date().toLocaleDateString('en-CA')

/** Settings → Habits → Prayer times: on or off, where, and by which method. */
export function PrayerBlock({ first }: { first?: boolean } = {}) {
  const [s, setS] = useState(loadPrayerState)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  // A habit already kept under a prayer's name: convert it, or start a new one — the person's call.
  const [choosing, setChoosing] = useState<{ id: string; name: string }[] | null>(null)

  function turnOn() {
    const had = s.habitId ? [] : prayerLikeHabits()
    if (had.length) setChoosing(had.map(h => ({ id: h.id, name: h.name })))
    else setS(enablePrayers())
  }

  useEffect(() => {
    const h = () => setS(loadPrayerState())
    window.addEventListener(PRAYER_EVENT, h)
    window.addEventListener('professor:prefsRestored', h)
    return () => { window.removeEventListener(PRAYER_EVENT, h); window.removeEventListener('professor:prefsRestored', h) }
  }, [])

  async function useMyLocation() {
    setAsking(true); setNote('')
    const got = await askLocation()
    setAsking(false)
    if (!got) setNote('Location was not shared. Pick a city instead — you can change it any time.')
  }

  function pickCity(name: string) {
    const c = PRAYER_CITIES.find(x => x.name === name)
    if (c) patchPrayerState({ place: { lat: c.lat, lon: c.lon, tz: c.tz, label: c.name }, method: c.method })
  }

  const times = s.enabled && s.place ? prayerTimes(today(), s.place, s.method, s.school) : null

  return (
    <div data-prayer-settings style={{ ...(first ? { paddingBottom: 18, marginBottom: 6, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' } : { marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }), display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)' }}>
        PRAYER TIMES
      </span>
      <FieldRow label="Read prayer times"
        sub="Five prayers a day at their own times, worked out on this device for where you are and following your timezone. They fill in the Prayers habit; you tick each one as you pray it.">
        <Toggle checked={s.enabled || !!choosing} onChange={on => { if (!on) { setChoosing(null); setS(disablePrayers()) } else turnOn() }} />
      </FieldRow>

      {choosing && !s.enabled && (
        <div data-prayer-adopt role="group" aria-label="Use the prayer habit you already have" style={{
          padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)',
          border: 'var(--sb-border-width) solid var(--sb-border)', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>
            You already keep {choosing.length === 1 ? 'a habit' : 'habits'} called {choosing.map(c => `“${c.name}”`).join(' and ')}.
            Converting one keeps its picture, name and history and makes it the five-prayer habit. Each past day is read by the count
            you logged: 1 is Maghrib, 2 is Dhuhr and Asr, 3 is Fajr, Dhuhr and Asr, 4 adds Maghrib, 5 is all five.
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {choosing.map(c => (
              <Button key={c.id} variant="primary" onClick={() => { setChoosing(null); setS(enablePrayers(c.id)) }}>Convert “{c.name}”</Button>
            ))}
            <Button variant="secondary" onClick={() => { setChoosing(null); setS(enablePrayers()) }}>Start a new one</Button>
            <Button variant="ghost" onClick={() => setChoosing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {s.enabled && (
        <>
          <FieldRow label="Where you are" sub={s.place ? `${s.place.label ?? 'Your location'} · ${s.place.tz ?? 'device timezone'}` : 'Needed to work the times out. Share your location, or choose a city.'}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="secondary" onClick={useMyLocation} disabled={asking}>
                <LocateFixed size={ICON.sm} /> {asking ? 'Asking…' : 'Use my location'}
              </Button>
              <select aria-label="City" value={PRAYER_CITIES.some(c => c.name === s.place?.label) ? s.place?.label : ''}
                onChange={e => pickCity(e.target.value)} style={{ ...inputStyle, width: 170 }}>
                <option value="" disabled>Or choose a city</option>
                {PRAYER_CITIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </FieldRow>
          {note && <div role="status" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{note}</div>}

          <FieldRow label="Calculation method" sub="The authority whose Fajr and Isha angles are used. The default follows the city you pick; match it to your local mosque's timetable.">
            <select aria-label="Calculation method" value={s.method} onChange={e => patchPrayerState({ method: e.target.value as PrayerMethod })} style={{ ...inputStyle, width: 240 }}>
              {(Object.keys(METHODS) as PrayerMethod[]).map(m => <option key={m} value={m}>{METHODS[m].label}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Asr" sub="Standard (shadow equals the object) or Hanafi (twice as long).">
            <select aria-label="Asr school" value={s.school} onChange={e => patchPrayerState({ school: e.target.value as AsrSchool })} style={{ ...inputStyle, width: 160 }}>
              <option value="standard">Standard</option>
              <option value="hanafi">Hanafi</option>
            </select>
          </FieldRow>

          {times && (
            <div data-prayer-today style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PRAYERS.map(p => (
                <span key={p} style={{
                  padding: '6px 12px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-field)',
                  border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)',
                }}>
                  <b style={{ fontWeight: 600, color: 'var(--sb-ink-1)' }}>{PRAYER_LABEL[p]}</b> {clock(times[p])}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
