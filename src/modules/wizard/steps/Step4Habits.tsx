import { useState } from 'react'
import { Check, X } from 'lucide-react'

const HABIT_TEMPLATES = [
  { id: 'water',       name: 'Drink Water',   emoji: '💧', color: '#60A5FA', type: 'quantity' as const, goal: 8,     unit: 'glasses', frequency: 'daily' as const },
  { id: 'exercise',    name: 'Exercise',       emoji: '💪', color: '#E05252', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'reading',     name: 'Reading',        emoji: '📚', color: '#A855F7', type: 'quantity' as const, goal: 30,   unit: 'min',     frequency: 'daily' as const },
  { id: 'meditation',  name: 'Meditation',     emoji: '🧘', color: '#1D9E75', type: 'quantity' as const, goal: 10,   unit: 'min',     frequency: 'daily' as const },
  { id: 'sleep',       name: '8h Sleep',       emoji: '😴', color: '#7F77DD', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'journaling',  name: 'Journaling',     emoji: '📓', color: '#F97316', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'steps',       name: 'Steps',          emoji: '🚶', color: '#34D399', type: 'quantity' as const, goal: 10000, unit: 'steps',  frequency: 'daily' as const },
  { id: 'cold-shower', name: 'Cold Shower',    emoji: '🚿', color: '#22D3EE', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'no-phone-am', name: 'No Phone (AM)',  emoji: '📵', color: '#6366F1', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'vitamins',    name: 'Vitamins',       emoji: '💊', color: '#EC4899', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'prayer',      name: 'Prayer',         emoji: '🤲', color: '#FBBF24', type: 'boolean'  as const, frequency: 'daily' as const },
  { id: 'no-sugar',    name: 'No Sugar',       emoji: '🚫', color: '#E0944A', type: 'boolean'  as const, frequency: 'daily' as const },
] as const

const COLORS = ['#7F77DD','#60A5FA','#1D9E75','#E05252','#F97316','#A855F7','#EC4899','#FBBF24']

interface CustomHabitDraft {
  name: string; emoji: string; color: string
  type: 'boolean' | 'quantity'; goal?: number; unit?: string
  frequency: 'daily' | 'weekdays' | 'weekly'
}

interface Props {
  data: { selectedTemplates: string[]; customHabits: CustomHabitDraft[] }
  onChange: (p: { selectedTemplates?: string[]; customHabits?: CustomHabitDraft[] }) => void
}

const inp: React.CSSProperties = {
  background: 'var(--color-bg,#F7F4EA)', border: '1px solid var(--color-border,#E8E1CE)',
  borderRadius: 7, padding: '8px 12px', color: 'var(--color-text,#E8EAF6)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

export function Step4Habits({ data, onChange }: Props) {
  const [addingCustom, setAddingCustom] = useState(false)
  const [cName,  setCName]  = useState('')
  const [cEmoji, setCEmoji] = useState('💡')
  const [cColor, setCColor] = useState(COLORS[0])
  const [cType,  setCType]  = useState<'boolean' | 'quantity'>('boolean')
  const [cGoal,  setCGoal]  = useState('')
  const [cUnit,  setCUnit]  = useState('')
  const [cFreq,  setCFreq]  = useState<'daily' | 'weekdays' | 'weekly'>('daily')

  function toggleTemplate(id: string) {
    const sel = data.selectedTemplates
    onChange({ selectedTemplates: sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id] })
  }

  function addCustom() {
    if (!cName.trim()) return
    const h: CustomHabitDraft = {
      name: cName.trim(), emoji: cEmoji, color: cColor, type: cType, frequency: cFreq,
      ...(cType === 'quantity' && { goal: parseInt(cGoal) || 1, unit: cUnit.trim() || 'times' }),
    }
    onChange({ customHabits: [...data.customHabits, h] })
    setCName(''); setCEmoji('💡'); setCColor(COLORS[0]); setCType('boolean'); setCGoal(''); setCUnit(''); setAddingCustom(false)
  }

  function removeCustom(idx: number) {
    onChange({ customHabits: data.customHabits.filter((_, i) => i !== idx) })
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--color-text,#E8EAF6)' }}>
        Build your habits
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: 'var(--color-text-dim,#94A3B8)', lineHeight: 1.6 }}>
        Choose from popular habits or create your own. You can edit them anytime.
      </p>

      {/* Template grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
        {HABIT_TEMPLATES.map(t => {
          const selected = data.selectedTemplates.includes(t.id)
          return (
            <button key={t.id} onClick={() => toggleTemplate(t.id)} style={{
              padding: '12px 10px', borderRadius: 10, cursor: 'pointer', position: 'relative',
              background: selected ? `${t.color}18` : 'var(--color-surface,#FFFFFF)',
              border: `1.5px solid ${selected ? t.color : 'var(--color-border,#E8E1CE)'}`,
              textAlign: 'left', transition: 'all 0.15s',
            }}>
              {selected && (
                <div style={{
                  position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: '50%',
                  background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Check size={10} color="#fff" strokeWidth={3} />
                </div>
              )}
              <div style={{ fontSize: 22, marginBottom: 6 }}>{t.emoji}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text,#E8EAF6)', marginBottom: 2 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted,#6B7280)' }}>
                {t.type === 'quantity' ? `${(t as {goal?: number}).goal} ${(t as {unit?: string}).unit}` : 'Daily check'}
              </div>
            </button>
          )
        })}
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--color-border,#E8E1CE)' }} />
        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted,#6B7280)' }}>or add your own</span>
        <div style={{ flex: 1, height: 1, background: 'var(--color-border,#E8E1CE)' }} />
      </div>

      {/* Custom habits */}
      {data.customHabits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {data.customHabits.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--color-surface,#FFFFFF)', border: '1px solid var(--color-border,#E8E1CE)' }}>
              <span style={{ fontSize: 18 }}>{h.emoji}</span>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text,#E8EAF6)' }}>{h.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted,#6B7280)' }}>{h.frequency}</span>
              <button onClick={() => removeCustom(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted,#6B7280)', padding: 2, display: 'flex' }}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {addingCustom ? (
        <div style={{ padding: 16, borderRadius: 10, background: 'var(--color-surface,#FFFFFF)', border: '1px solid var(--color-border,#E8E1CE)' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={cEmoji} onChange={e => setCEmoji(e.target.value)} placeholder="💡" style={{ ...inp, width: 56, textAlign: 'center', fontSize: 18 }} />
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Habit name" style={{ ...inp, flex: 1 }} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => setCType('boolean')} style={{ flex: 1, padding: '7px', borderRadius: 7, border: `1.5px solid ${cType === 'boolean' ? 'var(--color-accent,#7F77DD)' : 'var(--color-border,#E8E1CE)'}`, background: cType === 'boolean' ? 'rgba(127,119,221,0.1)' : 'transparent', color: 'var(--color-text,#E8EAF6)', fontSize: 12.5, cursor: 'pointer' }}>
              ✓ Boolean
            </button>
            <button onClick={() => setCType('quantity')} style={{ flex: 1, padding: '7px', borderRadius: 7, border: `1.5px solid ${cType === 'quantity' ? 'var(--color-accent,#7F77DD)' : 'var(--color-border,#E8E1CE)'}`, background: cType === 'quantity' ? 'rgba(127,119,221,0.1)' : 'transparent', color: 'var(--color-text,#E8EAF6)', fontSize: 12.5, cursor: 'pointer' }}>
              # Quantity
            </button>
          </div>
          {cType === 'quantity' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input value={cGoal} onChange={e => setCGoal(e.target.value)} placeholder="Goal (e.g. 8)" type="number" style={{ ...inp, width: 100 }} />
              <input value={cUnit} onChange={e => setCUnit(e.target.value)} placeholder="Unit (e.g. glasses)" style={{ ...inp, flex: 1 }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {(['daily','weekdays','weekly'] as const).map(f => (
              <button key={f} onClick={() => setCFreq(f)} style={{ flex: 1, padding: '6px', borderRadius: 7, border: `1.5px solid ${cFreq === f ? 'var(--color-accent,#7F77DD)' : 'var(--color-border,#E8E1CE)'}`, background: cFreq === f ? 'rgba(127,119,221,0.1)' : 'transparent', color: 'var(--color-text,#E8EAF6)', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
                {f}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setCColor(c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: cColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2, transform: cColor === c ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.1s' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addCustom} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-accent,#7F77DD)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Add</button>
            <button onClick={() => setAddingCustom(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted,#6B7280)', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAddingCustom(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8,
          background: 'transparent', border: '1px dashed var(--color-border,#E8E1CE)',
          color: 'var(--color-text-muted,#6B7280)', fontSize: 13, cursor: 'pointer',
          width: '100%', justifyContent: 'center',
        }}>
          + Custom habit
        </button>
      )}
    </div>
  )
}
