import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui'
import { useHabitsStore } from '@/store/habitsStore'
import { HABIT_TEMPLATES } from '@/lib/habitTemplates'
import { enablePrayers } from '@/lib/prayerState'
import { ICON, STROKE } from '@/lib/type'
import { alpha } from '@/lib/alpha'
import { inkOn } from '@/lib/ink'

/**
 * The Habits screen's first-run prompt: shown where an empty list used to say
 * "No habits yet". It replaces the setup wizard's habits step, so the presets
 * are still one tap away — but when a person is looking at Habits, not before
 * they have seen the app.
 */
export function HabitStarter() {
  const addHabit = useHabitsStore(s => s.addHabit)
  const [picked, setPicked] = useState<string[]>([])

  function toggle(id: string) {
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  }
  function add() {
    for (const id of picked) {
      const t = HABIT_TEMPLATES.find(x => x.id === id)
      if (t?.id === 'prayer') enablePrayers()
      else if (t) addHabit({ name: t.name, emoji: t.emoji, color: t.color, type: t.type, goal: t.goal, unit: t.unit, frequency: t.frequency, isActive: true })
    }
    setPicked([])
  }

  return (
    <div data-habit-starter style={{ gridColumn: '1/-1', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Start with a few habits</div>
        <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', marginTop: 4 }}>
          Pick any that fit, or use "New habit" to make your own. You can change them anytime.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {HABIT_TEMPLATES.map(t => {
          const on = picked.includes(t.id)
          return (
            <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle(t.id)} style={{
              padding: '12px 10px', borderRadius: 'var(--sb-r-nav)', cursor: 'pointer', position: 'relative', textAlign: 'left',
              background: on ? alpha(t.color, 9.4) : 'var(--sb-card)',
              border: `var(--sb-border-width) solid ${on ? t.color : 'var(--sb-border)'}`,
            }}>
              {on && (
                <span style={{ position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={ICON.sm} color={inkOn(t.color)} strokeWidth={STROKE.active} aria-hidden />
                </span>
              )}
              <div data-user-content style={{ fontSize: 'var(--sb-t-h2)', marginBottom: 6 }}>{t.emoji}</div>
              <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', marginBottom: 2 }}>{t.name}</div>
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                {t.type === 'quantity' ? `${t.goal} ${t.unit}` : 'Daily check'}
              </div>
            </button>
          )
        })}
      </div>
      <div>
        <Button variant="primary" disabled={picked.length === 0} onClick={add}>
          {picked.length === 0 ? 'Add habits' : `Add ${picked.length} habit${picked.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  )
}
