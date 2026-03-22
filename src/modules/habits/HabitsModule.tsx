import { useState, useCallback } from 'react'
import { Plus, CheckCircle2, Circle, Flame, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import {
  useHabitsStore, loadLogs, saveLogs,
  calcStreak, lastNDays, getHabitColors,
  type Habit,
} from '@/store/habitsStore'

// ─── Date helpers ──────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDayLabel(dateKey: string): string {
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function WeekDots({ logs, color }: { logs: string[]; color: string }) {
  const days = lastNDays(7)
  const today = todayKey()
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {days.map(d => {
        const done = logs.includes(d)
        const isToday = d === today
        return (
          <div
            key={d}
            title={d}
            style={{
              width: 22, height: 22, borderRadius: 5,
              background: done ? color : 'var(--color-surface2, #0D0F1A)',
              border: `1px solid ${done ? color : isToday ? color + '60' : 'var(--color-border, #252A3E)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8.5, color: done ? 'var(--color-bg, #0D0F1A)' : 'var(--color-text-muted, #4B5563)', fontWeight: 600 }}>
              {fmtDayLabel(d)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HabitsModule() {
  const HABIT_COLORS = getHabitColors()

  const { habits, addHabit: storeAdd, deleteHabit: storeDelete } = useHabitsStore()
  const [logs, setLogs]           = useState(loadLogs)
  const [addingHabit, setAdding]  = useState(false)
  const [newName, setNewName]     = useState('')
  const [newEmoji, setNewEmoji]   = useState('🎯')
  const [newColor, setNewColor]   = useState(HABIT_COLORS[0])

  const today = todayKey()
  const days  = lastNDays(7)

  const toggleHabit = useCallback((habitId: string) => {
    setLogs(prev => {
      const existing = prev[habitId] ?? []
      const updated  = existing.includes(today)
        ? existing.filter(d => d !== today)
        : [...existing, today]
      const next = { ...prev, [habitId]: updated }
      saveLogs(next)
      return next
    })
  }, [today])

  const addHabit = () => {
    if (!newName.trim()) return
    storeAdd({ name: newName.trim(), emoji: newEmoji, color: newColor, frequency: 'daily', isActive: true })
    setNewName('')
    setAdding(false)
  }

  const deleteHabit = (habitId: string) => {
    storeDelete(habitId)
    setLogs(prev => {
      const next = { ...prev }
      delete next[habitId]
      saveLogs(next)
      return next
    })
  }

  const activeHabits     = habits.filter(h => h.isActive)
  const todayCompleted   = activeHabits.filter(h => (logs[h.id] ?? []).includes(today)).length
  const completionRate   = activeHabits.length > 0 ? Math.round((todayCompleted / activeHabits.length) * 100) : 0

  const EMOJIS = ['🎯','💪','📚','🏃','💧','🧘','🍎','💤','🌿','✍️','🧠','🔥']

  return (
    <div>
      <TopBar title="Habits Tracker" subtitle="Small disciplines. Compounding results." />

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Summary cards ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            {
              label: "Today's Progress",
              value: `${todayCompleted}/${activeHabits.length}`,
              sub: `${completionRate}% complete`,
              color: completionRate === 100 ? '#1D9E75' : 'var(--color-accent, #1E40AF)',
            },
            {
              label: 'Best Streak',
              value: `${Math.max(0, ...activeHabits.map(h => calcStreak(logs[h.id] ?? [])))}d`,
              sub: 'Consecutive days',
              color: '#7F77DD',
            },
            {
              label: 'Active Habits',
              value: activeHabits.length,
              sub: 'Being tracked',
              color: 'var(--color-accent, #1E40AF)',
            },
          ].map(card => (
            <div key={card.label} style={{
              background: 'var(--color-surface, #161929)',
              border: '1px solid var(--color-border, #252A3E)',
              borderRadius: 12, padding: '18px 20px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: card.color, borderRadius: '12px 0 0 12px' }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', lineHeight: 1 }}>
                {card.value}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-dim, #94A3B8)', marginTop: 4 }}>{card.label}</div>
              <div style={{ fontSize: 11, color: card.color, marginTop: 6, fontWeight: 500 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* ─── Habits list ───────────────────────────────────────────────── */}
        <div style={{
          background: 'var(--color-surface, #161929)',
          border: '1px solid var(--color-border, #252A3E)',
          borderRadius: 14, overflow: 'hidden', marginBottom: 14,
        }}>
          {/* List header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--color-border, #252A3E)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Habit
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {days.map(d => (
                  <div key={d} style={{ width: 22, textAlign: 'center' }}>
                    <span style={{ fontSize: 9.5, color: d === today ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #4B5563)', fontWeight: d === today ? 600 : 400 }}>
                      {fmtDayLabel(d)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Streak
            </span>
          </div>

          {activeHabits.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-dim, #94A3B8)' }}>No habits yet. Add one below.</p>
            </div>
          )}

          {activeHabits.map((habit, i) => {
            const habitLogs = logs[habit.id] ?? []
            const doneToday = habitLogs.includes(today)
            const streak    = calcStreak(habitLogs)
            return (
              <div key={habit.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 20px',
                borderBottom: i < activeHabits.length - 1 ? '1px solid var(--color-border, #252A3E)' : 'none',
                background: doneToday ? `${habit.color}08` : 'transparent',
                transition: 'background 0.15s',
              }}>
                {/* Emoji */}
                <span style={{ fontSize: 16, flexShrink: 0 }}>{habit.emoji}</span>

                {/* Check */}
                <button onClick={() => toggleHabit(habit.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
                  {doneToday
                    ? <CheckCircle2 size={20} color={habit.color} />
                    : <Circle size={20} color="var(--color-text-muted, #4B5563)" />}
                </button>

                {/* Name */}
                <span style={{
                  flex: 1, fontSize: 13.5, fontWeight: 500,
                  color: doneToday ? habit.color : 'var(--color-text, #E8EAF6)',
                  textDecoration: doneToday ? 'line-through' : 'none',
                  opacity: doneToday ? 0.8 : 1,
                }}>
                  {habit.name}
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-text-muted, #4B5563)', fontWeight: 400 }}>
                    {habit.frequency}
                  </span>
                </span>

                {/* Week dots */}
                <WeekDots logs={habitLogs} color={habit.color} />

                {/* Streak */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: 52, justifyContent: 'flex-end' }}>
                  {streak > 0 && <Flame size={12} color={streak >= 7 ? '#E05252' : 'var(--color-accent, #1E40AF)'} />}
                  <span style={{ fontSize: 13, fontWeight: 600, color: streak > 0 ? (streak >= 7 ? '#E05252' : 'var(--color-accent, #1E40AF)') : 'var(--color-text-muted, #4B5563)' }}>
                    {streak > 0 ? `${streak}d` : '—'}
                  </span>
                </div>

                {/* Delete */}
                <button onClick={() => deleteHabit(habit.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted, #4B5563)', flexShrink: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>

        {/* ─── Add habit ─────────────────────────────────────────────────── */}
        {addingHabit ? (
          <div style={{
            background: 'var(--color-surface, #161929)',
            border: '1px solid var(--color-border, #252A3E)',
            borderRadius: 12, padding: '18px 20px',
          }}>
            <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              New Habit
            </p>

            {/* Emoji picker */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => setNewEmoji(e)}
                  style={{
                    fontSize: 18, background: newEmoji === e ? 'var(--color-accent-fill, rgba(30,64,175,0.18))' : 'transparent',
                    border: `1px solid ${newEmoji === e ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                    borderRadius: 7, cursor: 'pointer', width: 36, height: 36,
                  }}>
                  {e}
                </button>
              ))}
            </div>

            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="e.g. Journal 10 minutes"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                background: 'var(--color-surface2, #0D0F1A)',
                border: '1px solid var(--color-border, #252A3E)',
                color: 'var(--color-text, #E8EAF6)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {HABIT_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    style={{
                      width: 22, height: 22, borderRadius: '50%', background: c,
                      border: 'none', cursor: 'pointer',
                      outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
                    }} />
                ))}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => { setAdding(false); setNewName('') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer' }}>
                  <X size={12} /> Cancel
                </button>
                <button onClick={addHabit} disabled={!newName.trim()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 16px', borderRadius: 7,
                    background: 'var(--color-accent-fill, rgba(30,64,175,0.15))',
                    border: '1px solid var(--color-accent, #1E40AF)30',
                    color: 'var(--color-accent, #1E40AF)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    opacity: newName.trim() ? 1 : 0.4,
                  }}>
                  <Plus size={12} /> Add Habit
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '13px 18px', borderRadius: 10,
              background: 'transparent',
              border: '1px dashed var(--color-border, #252A3E)',
              color: 'var(--color-text-muted, #4B5563)', fontSize: 13, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Add a habit
          </button>
        )}

        {/* ─── Completion banner ──────────────────────────────────────────── */}
        {todayCompleted === activeHabits.length && activeHabits.length > 0 && (
          <div style={{
            marginTop: 20, padding: '16px 20px', borderRadius: 10,
            background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.2)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Flame size={16} color="#1D9E75" />
            <p style={{ margin: 0, fontSize: 13.5, color: '#1D9E75', fontWeight: 500 }}>
              All habits complete for today. Exceptional discipline — keep the streak alive.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
