import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, CheckCircle2, Circle, Flame, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import {
  useHabitsStore, loadLogs, saveLogs,
  calcStreak, getHabitColors,
} from '@/store/habitsStore'
import { saveHabitLogsToDB } from '@/lib/dbSync'

let logsDbTimer: ReturnType<typeof setTimeout> | null = null
function scheduleLogsSync(logs: import('@/store/habitsStore').HabitLogs) {
  if (logsDbTimer) clearTimeout(logsDbTimer)
  logsDbTimer = setTimeout(() => {
    void saveHabitLogsToDB(logs).catch(() => { /* offline */ })
  }, 1500)
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayKey(): string { return toKey(new Date()) }

function fmtDayLabel(dateKey: string): string {
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
}

function fmtHeaderDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function offsetDays(base: string, delta: number): string {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return toKey(d)
}

function daysWindow(anchor: string, n: number): string[] {
  // Show n days ending on anchor
  const result: string[] = []
  for (let i = n - 1; i >= 0; i--) result.push(offsetDays(anchor, -i))
  return result
}

// ─── Frequency options ────────────────────────────────────────────────────────

const FREQ_OPTS = ['daily', 'weekdays', 'weekly'] as const
type Freq = typeof FREQ_OPTS[number]

// ─── Sub-components ──────────────────────────────────────────────────────────

function DayDots({
  logs, color, days, viewDate,
  onToggle,
}: {
  logs: string[]; color: string; days: string[]; viewDate: string
  onToggle: (day: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {days.map(d => {
        const done    = logs.includes(d)
        const isView  = d === viewDate
        const isFuture = d > todayKey()
        return (
          <button
            key={d}
            title={d}
            disabled={isFuture}
            onClick={() => !isFuture && onToggle(d)}
            style={{
              width: 22, height: 22, borderRadius: 5, padding: 0, border: 'none',
              background: done ? color : 'var(--color-surface2, #0D0F1A)',
              outline: isView ? `2px solid ${color}` : undefined,
              outlineOffset: 1,
              cursor: isFuture ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isFuture ? 0.3 : 1,
            }}
          >
            <span style={{ fontSize: 8, color: done ? 'var(--color-bg, #0D0F1A)' : 'var(--color-text-muted, #4B5563)', fontWeight: 600, userSelect: 'none' }}>
              {fmtDayLabel(d)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Inline editable text
function InlineEdit({
  value, onSave, style,
}: {
  value: string
  onSave: (v: string) => void
  style?: React.CSSProperties
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  function commit() {
    const v = draft.trim()
    if (v && v !== value) onSave(v)
    else setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        style={{
          background: 'transparent', border: 'none',
          borderBottom: '1px solid var(--color-accent, #1E40AF)',
          outline: 'none', color: 'var(--color-text, #E8EAF6)',
          fontFamily: 'inherit', padding: '0 2px',
          ...style,
        }}
      />
    )
  }
  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Click to rename"
      style={{ cursor: 'text', ...style }}
    >
      {value}
    </span>
  )
}

// Emoji picker popover
function EmojiBtn({ value, onSelect }: { value: string; onSelect: (e: string) => void }) {
  const EMOJIS = ['🎯','💪','📚','🏃','💧','🧘','🍎','💤','🌿','✍️','🧠','🔥','🎵','🏋️','🚿','🫁','🥗','☀️','🧹','🧩']
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Change icon"
        style={{ fontSize: 16, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
        {value}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 28, left: 0, zIndex: 300,
          background: '#1a1f35', border: '1px solid #2e3450', borderRadius: 10,
          padding: '8px', display: 'flex', gap: 4, flexWrap: 'wrap', width: 210,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => { onSelect(e); setOpen(false) }}
              style={{
                fontSize: 16, width: 32, height: 32, borderRadius: 7, cursor: 'pointer', border: 'none',
                background: e === value ? 'var(--color-accent-fill)' : 'transparent',
              }}>{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Color picker dot
function ColorBtn({ value, colors, onSelect }: { value: string; colors: string[]; onSelect: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Change color"
        style={{
          width: 14, height: 14, borderRadius: '50%', background: value,
          border: 'none', cursor: 'pointer', flexShrink: 0,
          boxShadow: `0 0 0 2px #0D0F1A, 0 0 0 3px ${value}60`,
        }} />
      {open && (
        <div style={{
          position: 'absolute', top: 20, left: 0, zIndex: 300,
          background: '#1a1f35', border: '1px solid #2e3450', borderRadius: 8,
          padding: '7px 8px', display: 'flex', gap: 5,
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        }}>
          {colors.map(c => (
            <button key={c} onClick={() => { onSelect(c); setOpen(false) }}
              style={{
                width: 16, height: 16, borderRadius: '50%', background: c,
                border: 'none', cursor: 'pointer',
                boxShadow: value === c ? `0 0 0 2px #1a1f35, 0 0 0 3.5px ${c}` : 'none',
                transform: value === c ? 'scale(1.2)' : 'scale(1)',
                transition: 'transform 0.1s',
              }} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HabitsModule() {
  const HABIT_COLORS = getHabitColors()

  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDelete } = useHabitsStore()
  const [logs, setLogs]           = useState(loadLogs)
  const [viewDate, setViewDate]   = useState(todayKey)
  const [addingHabit, setAdding]  = useState(false)
  const [newName, setNewName]     = useState('')
  const [newEmoji, setNewEmoji]   = useState('🎯')
  const [newColor, setNewColor]   = useState(HABIT_COLORS[0])
  const [newFreq, setNewFreq]     = useState<Freq>('daily')

  const today  = todayKey()
  const days   = daysWindow(viewDate, 7)

  const toggleHabit = useCallback((habitId: string, day?: string) => {
    const d = day ?? viewDate
    setLogs(prev => {
      const existing = prev[habitId] ?? []
      const updated  = existing.includes(d)
        ? existing.filter(x => x !== d)
        : [...existing, d]
      const next = { ...prev, [habitId]: updated }
      saveLogs(next)
      scheduleLogsSync(next)
      return next
    })
  }, [viewDate])

  const addHabit = () => {
    if (!newName.trim()) return
    storeAdd({ name: newName.trim(), emoji: newEmoji, color: newColor, frequency: newFreq, isActive: true })
    setNewName('')
    setAdding(false)
  }

  const deleteHabit = (habitId: string) => {
    storeDelete(habitId)
    setLogs(prev => {
      const next = { ...prev }
      delete next[habitId]
      saveLogs(next)
      scheduleLogsSync(next)
      return next
    })
  }

  const activeHabits   = habits.filter(h => h.isActive)
  const viewCompleted  = activeHabits.filter(h => (logs[h.id] ?? []).includes(viewDate)).length
  const completionRate = activeHabits.length > 0 ? Math.round((viewCompleted / activeHabits.length) * 100) : 0
  const isToday        = viewDate === today

  const EMOJIS = ['🎯','💪','📚','🏃','💧','🧘','🍎','💤','🌿','✍️','🧠','🔥','🎵','🏋️','🚿','🫁','🥗','☀️','🧹','🧩']

  return (
    <div>
      <TopBar title="Habits Tracker" subtitle="Small disciplines. Compounding results." />

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Summary cards ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            {
              label: isToday ? "Today's Progress" : `${fmtHeaderDate(new Date(viewDate + 'T12:00:00'))}`,
              value: `${viewCompleted}/${activeHabits.length}`,
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
          borderRadius: 14, overflow: 'visible', marginBottom: 14,
        }}>
          {/* List header with day nav */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px 12px 20px', borderBottom: '1px solid var(--color-border, #252A3E)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Habit
            </span>

            {/* Day navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setViewDate(d => offsetDays(d, -1))}
                style={{ background: 'none', border: '1px solid var(--color-border, #252A3E)', borderRadius: 6, cursor: 'pointer', padding: '3px 6px', color: 'var(--color-text-dim, #94A3B8)', display: 'flex' }}>
                <ChevronLeft size={13} />
              </button>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: isToday ? 'var(--color-accent, #1E40AF)' : 'var(--color-text, #E8EAF6)', minWidth: 90, textAlign: 'center' }}>
                {isToday ? 'Today' : fmtHeaderDate(new Date(viewDate + 'T12:00:00'))}
              </span>
              <button onClick={() => setViewDate(d => offsetDays(d, 1))} disabled={viewDate >= today}
                style={{ background: 'none', border: '1px solid var(--color-border, #252A3E)', borderRadius: 6, cursor: viewDate >= today ? 'default' : 'pointer', padding: '3px 6px', color: 'var(--color-text-dim, #94A3B8)', display: 'flex', opacity: viewDate >= today ? 0.3 : 1 }}>
                <ChevronRight size={13} />
              </button>
              {!isToday && (
                <button onClick={() => setViewDate(today)}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)30', color: 'var(--color-accent, #1E40AF)', cursor: 'pointer' }}>
                  Today
                </button>
              )}
            </div>

            {/* Day column labels */}
            <div style={{ display: 'flex', gap: 3 }}>
              {days.map(d => (
                <div key={d} style={{ width: 22, textAlign: 'center' }}>
                  <span style={{ fontSize: 9, color: d === viewDate ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #4B5563)', fontWeight: d === viewDate ? 700 : 400 }}>
                    {fmtDayLabel(d)}
                  </span>
                </div>
              ))}
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
            const doneToday = habitLogs.includes(viewDate)
            const streak    = calcStreak(habitLogs)
            return (
              <div key={habit.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px 12px 20px',
                borderBottom: i < activeHabits.length - 1 ? '1px solid var(--color-border, #252A3E)' : 'none',
                background: doneToday ? `${habit.color}08` : 'transparent',
                transition: 'background 0.15s',
              }}>
                {/* Emoji — click to change */}
                <EmojiBtn value={habit.emoji} onSelect={e => updateHabit(habit.id, { emoji: e })} />

                {/* Check for viewDate */}
                <button onClick={() => toggleHabit(habit.id, viewDate)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
                  {doneToday
                    ? <CheckCircle2 size={20} color={habit.color} />
                    : <Circle size={20} color="var(--color-text-muted, #4B5563)" />}
                </button>

                {/* Color dot — click to change */}
                <ColorBtn value={habit.color} colors={HABIT_COLORS} onSelect={c => updateHabit(habit.id, { color: c })} />

                {/* Name — click to rename */}
                <InlineEdit
                  value={habit.name}
                  onSave={v => updateHabit(habit.id, { name: v })}
                  style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: doneToday ? habit.color : 'var(--color-text, #E8EAF6)', textDecoration: doneToday ? 'line-through' : 'none', opacity: doneToday ? 0.8 : 1 }}
                />

                {/* Frequency badge — click to cycle */}
                <button
                  onClick={() => {
                    const idx  = FREQ_OPTS.indexOf(habit.frequency)
                    const next = FREQ_OPTS[(idx + 1) % FREQ_OPTS.length]
                    updateHabit(habit.id, { frequency: next })
                  }}
                  title="Click to change frequency"
                  style={{
                    fontSize: 9.5, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    background: 'var(--color-surface2, #0D0F1A)',
                    border: '1px solid var(--color-border, #252A3E)',
                    color: 'var(--color-text-muted, #6B7280)',
                  }}
                >
                  {habit.frequency}
                </button>

                {/* Day dots — each is clickable */}
                <DayDots logs={habitLogs} color={habit.color} days={days} viewDate={viewDate} onToggle={d => toggleHabit(habit.id, d)} />

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
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
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
                width: '100%', padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                background: 'var(--color-surface2, #0D0F1A)',
                border: '1px solid var(--color-border, #252A3E)',
                color: 'var(--color-text, #E8EAF6)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />

            {/* Frequency selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {FREQ_OPTS.map(f => (
                <button key={f} onClick={() => setNewFreq(f)}
                  style={{
                    padding: '5px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                    background: newFreq === f ? 'var(--color-accent-fill)' : 'transparent',
                    border: `1px solid ${newFreq === f ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                    color: newFreq === f ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
                    fontWeight: newFreq === f ? 600 : 400, textTransform: 'capitalize',
                  }}>
                  {f}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 7 }}>
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
        {viewCompleted === activeHabits.length && activeHabits.length > 0 && (
          <div style={{
            marginTop: 20, padding: '16px 20px', borderRadius: 10,
            background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.2)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Flame size={16} color="#1D9E75" />
            <p style={{ margin: 0, fontSize: 13.5, color: '#1D9E75', fontWeight: 500 }}>
              {isToday
                ? 'All habits complete for today. Exceptional discipline — keep the streak alive.'
                : `All habits complete for ${fmtHeaderDate(new Date(viewDate + 'T12:00:00'))}.`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
