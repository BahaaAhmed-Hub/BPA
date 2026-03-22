
import { useState, useCallback } from 'react'
import { Plus, CheckCircle2, Circle, Flame, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Habit {
  id: string
  name: string
  color: string
  createdAt: string
}

interface HabitLogs {
  [habitId: string]: string[]   // array of "YYYY-MM-DD" dates
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HABIT_COLORS = ['#7C3AED', '#7F77DD', '#1D9E75', '#E05252', '#888780', '#E0944A']

const DEFAULT_HABITS: Habit[] = []

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadHabits(): Habit[] {
  try {
    const raw = localStorage.getItem('professor-habits')
    return raw ? (JSON.parse(raw) as Habit[]) : DEFAULT_HABITS
  } catch { return DEFAULT_HABITS }
}

function saveHabits(habits: Habit[]) {
  try { localStorage.setItem('professor-habits', JSON.stringify(habits)) } catch { /* quota */ }
}

function loadLogs(): HabitLogs {
  try {
    const raw = localStorage.getItem('professor-habit-logs')
    return raw ? (JSON.parse(raw) as HabitLogs) : {}
  } catch { return {} }
}

function saveLogs(logs: HabitLogs) {
  try { localStorage.setItem('professor-habit-logs', JSON.stringify(logs)) } catch { /* quota */ }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Returns the last N days as "YYYY-MM-DD" strings, newest last */
function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}

function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...dates].sort().reverse()
  const today = todayKey()
  let streak = 0
  let cursor = today
  for (const date of sorted) {
    if (date === cursor) {
      streak++
      const d = new Date(cursor)
      d.setDate(d.getDate() - 1)
      cursor = d.toISOString().slice(0, 10)
    } else {
      break
    }
  }
  return streak
}

function fmtDayLabel(dateKey: string): string {
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WeekDots({ logs, color }: { logs: string[]; color: string }) {
  const days = lastNDays(7)
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {days.map(d => {
        const done = logs.includes(d)
        const isToday = d === todayKey()
        return (
          <div
            key={d}
            title={d}
            style={{
              width: 22, height: 22, borderRadius: 5,
              background: done ? color : '#0D0F1A',
              border: `1px solid ${done ? color : isToday ? '#5A4E3A' : '#252A3E'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8.5, color: done ? '#0D0F1A' : '#4A3E28', fontWeight: 600 }}>
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
  const [habits, setHabits] = useState<Habit[]>(loadHabits)
  const [logs, setLogs] = useState<HabitLogs>(loadLogs)
  const [addingHabit, setAddingHabit] = useState(false)
  const [newHabitName, setNewHabitName] = useState('')
  const [newHabitColor, setNewHabitColor] = useState(HABIT_COLORS[0])

  const today = todayKey()
  const days = lastNDays(7)

  const toggleHabit = useCallback((habitId: string) => {
    setLogs(prev => {
      const existing = prev[habitId] ?? []
      const updated = existing.includes(today)
        ? existing.filter(d => d !== today)
        : [...existing, today]
      const next = { ...prev, [habitId]: updated }
      saveLogs(next)
      return next
    })
  }, [today])

  const addHabit = () => {
    if (!newHabitName.trim()) return
    const habit: Habit = {
      id: crypto.randomUUID(),
      name: newHabitName.trim(),
      color: newHabitColor,
      createdAt: new Date().toISOString(),
    }
    setHabits(prev => {
      const next = [...prev, habit]
      saveHabits(next)
      return next
    })
    setNewHabitName('')
    setAddingHabit(false)
  }

  const deleteHabit = (habitId: string) => {
    setHabits(prev => {
      const next = prev.filter(h => h.id !== habitId)
      saveHabits(next)
      return next
    })
    setLogs(prev => {
      const next = { ...prev }
      delete next[habitId]
      saveLogs(next)
      return next
    })
  }

  const todayCompleted = habits.filter(h => (logs[h.id] ?? []).includes(today)).length
  const completionRate = habits.length > 0 ? Math.round((todayCompleted / habits.length) * 100) : 0

  return (
    <div>
      <TopBar title="Habits Tracker" subtitle="Small disciplines. Compounding results." />

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Summary cards ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            {
              label: "Today's Progress",
              value: `${todayCompleted}/${habits.length}`,
              sub: `${completionRate}% complete`,
              color: completionRate === 100 ? '#1D9E75' : '#7C3AED',
            },
            {
              label: 'Best Streak',
              value: `${Math.max(0, ...habits.map(h => calcStreak(logs[h.id] ?? [])))}d`,
              sub: 'Consecutive days',
              color: '#7F77DD',
            },
            {
              label: 'Active Habits',
              value: habits.length,
              sub: 'Being tracked',
              color: '#7C3AED',
            },
          ].map(card => (
            <div key={card.label} style={{
              background: '#161929', border: '1px solid #252A3E',
              borderRadius: 12, padding: '18px 20px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: card.color, borderRadius: '12px 0 0 12px' }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#E8EAF6', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', lineHeight: 1 }}>
                {card.value}
              </div>
              <div style={{ fontSize: 12.5, color: '#6B7280', marginTop: 4 }}>{card.label}</div>
              <div style={{ fontSize: 11, color: card.color, marginTop: 6, fontWeight: 500 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* ─── Habits list ─────────────────────────────────────────────────── */}
        <div style={{ background: '#161929', border: '1px solid #252A3E', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>

          {/* List header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid #252A3E',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Habit
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {days.map(d => (
                  <div key={d} style={{ width: 22, textAlign: 'center' }}>
                    <span style={{ fontSize: 9.5, color: d === today ? '#7C3AED' : '#5A4E3A', fontWeight: d === today ? 600 : 400 }}>
                      {fmtDayLabel(d)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Streak
            </span>
          </div>

          {/* Habit rows */}
          {habits.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>No habits yet. Add one below.</p>
            </div>
          )}

          {habits.map((habit, i) => {
            const habitLogs = logs[habit.id] ?? []
            const doneToday = habitLogs.includes(today)
            const streak = calcStreak(habitLogs)
            return (
              <div
                key={habit.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 20px',
                  borderBottom: i < habits.length - 1 ? '1px solid #252A3E' : 'none',
                  background: doneToday ? `${habit.color}06` : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                {/* Check button */}
                <button
                  onClick={() => toggleHabit(habit.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                  title={doneToday ? 'Mark incomplete' : 'Mark complete'}
                >
                  {doneToday
                    ? <CheckCircle2 size={20} color={habit.color} />
                    : <Circle size={20} color="#5A4E3A" />}
                </button>

                {/* Name */}
                <span style={{
                  flex: 1, fontSize: 13.5, fontWeight: 500,
                  color: doneToday ? habit.color : '#E8EAF6',
                  textDecoration: doneToday ? 'line-through' : 'none',
                  opacity: doneToday ? 0.8 : 1,
                  transition: 'color 0.15s',
                }}>
                  {habit.name}
                </span>

                {/* Week dots */}
                <WeekDots logs={habitLogs} color={habit.color} />

                {/* Streak */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: 52, justifyContent: 'flex-end' }}>
                  {streak > 0 && <Flame size={12} color={streak >= 7 ? '#E05252' : '#7C3AED'} />}
                  <span style={{ fontSize: 13, fontWeight: 600, color: streak > 0 ? (streak >= 7 ? '#E05252' : '#7C3AED') : '#5A4E3A' }}>
                    {streak > 0 ? `${streak}d` : '—'}
                  </span>
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteHabit(habit.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#4A3E28', flexShrink: 0 }}
                  title="Delete habit"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>

        {/* ─── Add habit ───────────────────────────────────────────────────── */}
        {addingHabit ? (
          <div style={{
            background: '#161929', border: '1px solid #252A3E',
            borderRadius: 12, padding: '18px 20px',
          }}>
            <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              New Habit
            </p>
            <input
              autoFocus
              value={newHabitName}
              onChange={e => setNewHabitName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setAddingHabit(false) }}
              placeholder="e.g. Journal 10 minutes"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                background: '#0D0F1A', border: '1px solid #4A3E28',
                color: '#E8EAF6', fontSize: 14, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {HABIT_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewHabitColor(c)}
                    style={{
                      width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                      outline: newHabitColor === c ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setAddingHabit(false); setNewHabitName('') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, background: 'transparent', border: '1px solid #252A3E', color: '#6B7280', fontSize: 12, cursor: 'pointer' }}
                >
                  <X size={12} /> Cancel
                </button>
                <button
                  onClick={addHabit}
                  disabled={!newHabitName.trim()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 16px', borderRadius: 7,
                    background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
                    color: '#7C3AED', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    opacity: newHabitName.trim() ? 1 : 0.4,
                  }}
                >
                  <Plus size={12} /> Add Habit
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingHabit(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '13px 18px', borderRadius: 10,
              background: 'transparent', border: '1px dashed #252A3E',
              color: '#5A4E3A', fontSize: 13, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#7C3AED50'; (e.currentTarget as HTMLElement).style.color = '#7C3AED' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#252A3E'; (e.currentTarget as HTMLElement).style.color = '#5A4E3A' }}
          >
            <Plus size={14} /> Add a habit
          </button>
        )}

        {/* ─── Completion message ───────────────────────────────────────────── */}
        {todayCompleted === habits.length && habits.length > 0 && (
          <div style={{
            marginTop: 20,
            padding: '16px 20px', borderRadius: 10,
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
