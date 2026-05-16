import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Flame, Trash2, X, ChevronLeft, ChevronRight, Hash, CheckSquare } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import {
  useHabitsStore, loadLogs, saveLogs, loadQuantityLogs, saveQuantityLogs,
  calcStreak, getHabitColors,
  type HabitLogs,
} from '@/store/habitsStore'
import { saveHabitLogsToDB } from '@/lib/dbSync'

let logsDbTimer: ReturnType<typeof setTimeout> | null = null
function scheduleLogsSync(logs: HabitLogs) {
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
  const result: string[] = []
  for (let i = n - 1; i >= 0; i--) result.push(offsetDays(anchor, -i))
  return result
}

// ─── Frequency options ────────────────────────────────────────────────────────

const FREQ_OPTS = ['daily', 'weekdays', 'weekly'] as const
type Freq = typeof FREQ_OPTS[number]

// ─── Day dots ─────────────────────────────────────────────────────────────────

function DayDots({
  logs, color, days, viewDate, onToggle, quantities, goal,
}: {
  logs: string[]; color: string; days: string[]; viewDate: string
  onToggle: (day: string) => void
  quantities?: Record<string, number>; goal?: number
}) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {days.map(d => {
        const done     = logs.includes(d)
        const isView   = d === viewDate
        const isFuture = d > todayKey()

        // For quantity habits: compute fill % from 0–1
        const qty  = quantities ? (quantities[d] ?? 0) : null
        const pct  = (qty !== null && goal) ? Math.min(qty / goal, 1) : null
        const filled = pct !== null ? pct : (done ? 1 : 0)

        // Gradient fill from bottom: color up to pct%, surface above
        const bg = filled === 0
          ? 'var(--color-surface2, #0D0F1A)'
          : filled >= 1
            ? color
            : `linear-gradient(to top, ${color} ${Math.round(filled * 100)}%, var(--color-surface2, #0D0F1A) ${Math.round(filled * 100)}%)`

        const textColor = filled >= 0.6 ? 'var(--color-bg, #0D0F1A)' : 'var(--color-text-muted, #4B5563)'

        return (
          <button key={d} title={qty !== null ? `${qty}${goal ? ` / ${goal}` : ''} (${Math.round(filled * 100)}%)` : d}
            disabled={isFuture}
            onClick={() => !isFuture && onToggle(d)}
            style={{
              width: 22, height: 22, borderRadius: 5, padding: 0, border: 'none',
              background: bg,
              outline: isView ? `2px solid ${color}` : undefined, outlineOffset: 1,
              cursor: isFuture ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isFuture ? 0.3 : 1,
              overflow: 'hidden',
            }}>
            <span style={{ fontSize: 8, color: textColor, fontWeight: 600, userSelect: 'none' }}>
              {fmtDayLabel(d)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Inline edit ──────────────────────────────────────────────────────────────

function InlineEdit({ value, onSave, style }: { value: string; onSave: (v: string) => void; style?: React.CSSProperties }) {
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
  if (editing) return (
    <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-accent, #1E40AF)', outline: 'none', color: 'var(--color-text, #E8EAF6)', fontFamily: 'inherit', padding: '0 2px', ...style }} />
  )
  return <span onClick={() => { setDraft(value); setEditing(true) }} title="Click to rename" style={{ cursor: 'text', ...style }}>{value}</span>
}

// ─── Emoji picker ─────────────────────────────────────────────────────────────

const EMOJIS = [
  // Health & Fitness
  '🏃','💪','🏋️','🚴','🤸','🏊','🧘','🚶','⚽','🎾','🥊','🏄','🧗','🤾','🏇','🎿','⛷️','🤺','🏌️','🎳',
  // Nutrition & Food
  '💧','🍎','🥗','🥦','🍵','🫐','🍓','🥑','🫁','🥤','🧃','🥛','🍇','🥕','🫚','🌾','🍋','🫒',
  // Mind & Learning
  '📚','🧠','✍️','📝','📖','🔬','🗓️','🧩','💡','🔭','🎓','🗺️','📐','🖊️','📓','🃏',
  // Productivity & Goals
  '🎯','🔥','⚡','🏆','🥇','✅','⏰','📅','🚀','💼','📊','🗝️','⚙️','🛠️','🎪',
  // Creative & Hobbies
  '🎵','🎨','🎭','🎸','📷','🎹','✏️','🎺','🎻','🎤','🎬','🖼️','🧶','🪡','📸',
  // Lifestyle & Self-care
  '🌿','☀️','🌙','🧹','🛁','🚿','💤','🌅','🌳','🌸','🪴','🌈','🌊','🏔️','🦋',
  // Emotions & Mindset
  '💎','🌟','⭐','🎁','💫','🙏','❤️','🤝','😊','🧡','💛','💚','💙','💜','🤍',
]

function EmojiBtn({ value, onSelect }: { value: string; onSelect: (e: string) => void }) {
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
        <div style={{ position: 'absolute', top: 28, left: 0, zIndex: 300, background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 10, padding: '8px', display: 'flex', gap: 4, flexWrap: 'wrap', width: 252, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => { onSelect(e); setOpen(false) }}
              style={{ fontSize: 16, width: 32, height: 32, borderRadius: 7, cursor: 'pointer', border: 'none', background: e === value ? 'var(--color-accent-fill)' : 'transparent' }}>{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}


// ─── Quantity stepper ─────────────────────────────────────────────────────────

function QuantityControl({
  value, goal, unit, color, onSet,
}: {
  value: number; goal: number; unit?: string; color: string
  onSet: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const met = value >= goal

  useEffect(() => { if (editing) { setDraft(String(value)); inputRef.current?.focus() } }, [editing, value])

  function commit() {
    const n = parseFloat(draft)
    if (!isNaN(n) && n >= 0) onSet(Math.round(n * 10) / 10)
    setEditing(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button onClick={() => onSet(Math.max(0, value - 1))}
        style={{ width: 20, height: 20, borderRadius: 5, border: '1px solid var(--color-border, #252A3E)', background: 'var(--color-surface2, #0D0F1A)', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1, padding: 0 }}>
        −
      </button>

      {editing ? (
        <input ref={inputRef} value={draft} type="number" min={0}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          style={{ width: 44, textAlign: 'center', fontSize: 11.5, fontWeight: 600, background: 'var(--color-surface2, #0D0F1A)', border: `1px solid ${color}`, borderRadius: 5, color: 'var(--color-text, #E8EAF6)', outline: 'none', padding: '1px 3px' }} />
      ) : (
        <button onClick={() => setEditing(true)} title="Click to enter value"
          style={{ minWidth: 60, textAlign: 'center', fontSize: 11.5, fontWeight: 600, background: met ? `${color}18` : 'var(--color-surface2, #0D0F1A)', border: `1px solid ${met ? color + '60' : 'var(--color-border, #252A3E)'}`, borderRadius: 5, color: met ? color : 'var(--color-text-muted, #94A3B8)', padding: '2px 5px', cursor: 'pointer' }}>
          {value}/{goal}{unit ? ` ${unit}` : ''}
        </button>
      )}

      <button onClick={() => onSet(value + 1)}
        style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${met ? color + '60' : 'var(--color-border, #252A3E)'}`, background: met ? `${color}18` : 'var(--color-surface2, #0D0F1A)', cursor: 'pointer', color: met ? color : 'var(--color-text-muted, #6B7280)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1, padding: 0 }}>
        +
      </button>
    </div>
  )
}

// ─── Add / Edit habit form (shared between New and inline edit) ────────────────

interface HabitFormState {
  name: string; emoji: string; color: string; freq: Freq
  type: 'boolean' | 'quantity'; goal: string; unit: string
}

function HabitForm({
  initial, colors, onSave, onCancel, saveLabel,
}: {
  initial: HabitFormState
  colors: string[]
  onSave: (s: HabitFormState) => void
  onCancel: () => void
  saveLabel?: string
}) {
  const [s, setS] = useState<HabitFormState>(initial)
  const update = (patch: Partial<HabitFormState>) => setS(prev => ({ ...prev, ...patch }))
  const valid = s.name.trim() !== '' && (s.type === 'boolean' || (parseFloat(s.goal) > 0 && s.unit.trim() !== ''))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Emoji row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 160, overflowY: 'auto', padding: '2px 0' }}>
        {EMOJIS.map(e => (
          <button key={e} onClick={() => update({ emoji: e })}
            style={{ fontSize: 18, background: s.emoji === e ? 'var(--color-accent-fill, rgba(30,64,175,0.18))' : 'transparent', border: `1px solid ${s.emoji === e ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`, borderRadius: 7, cursor: 'pointer', width: 36, height: 36, flexShrink: 0 }}>
            {e}
          </button>
        ))}
      </div>

      {/* Name */}
      <input autoFocus value={s.name} onChange={e => update({ name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && valid) onSave(s); if (e.key === 'Escape') onCancel() }}
        placeholder="e.g. Drink water, Walk 5 miles…"
        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, background: 'var(--color-surface2, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text, #E8EAF6)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted, #6B7280)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</span>
        <div style={{ display: 'flex', background: 'var(--color-surface2, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 7, overflow: 'hidden' }}>
          {([['boolean', '✓ Done / Not done', CheckSquare], ['quantity', '# Measurable', Hash]] as const).map(([t, label, Icon]) => (
            <button key={t} onClick={() => update({ type: t })}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, fontWeight: s.type === t ? 600 : 400, cursor: 'pointer', border: 'none', background: s.type === t ? 'var(--color-accent-fill, rgba(30,64,175,0.18))' : 'none', color: s.type === t ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)' }}>
              <Icon size={12} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Goal + unit (quantity only) */}
      {s.type === 'quantity' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--color-text-muted, #6B7280)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Goal</span>
          <input type="number" min={1} value={s.goal} onChange={e => update({ goal: e.target.value })}
            placeholder="8"
            style={{ width: 72, padding: '7px 10px', borderRadius: 7, background: 'var(--color-surface2, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text, #E8EAF6)', fontSize: 13, outline: 'none', textAlign: 'center' }} />
          <input value={s.unit} onChange={e => update({ unit: e.target.value })}
            placeholder="glasses / miles / min…"
            style={{ flex: 1, padding: '7px 10px', borderRadius: 7, background: 'var(--color-surface2, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text, #E8EAF6)', fontSize: 13, outline: 'none' }} />
        </div>
      )}

      {/* Frequency + color */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {FREQ_OPTS.map(f => (
            <button key={f} onClick={() => update({ freq: f })}
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: s.freq === f ? 'var(--color-accent-fill)' : 'transparent', border: `1px solid ${s.freq === f ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`, color: s.freq === f ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)', fontWeight: s.freq === f ? 600 : 400, textTransform: 'capitalize' }}>
              {f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 7, marginLeft: 'auto' }}>
          {colors.map(c => (
            <button key={c} onClick={() => update({ color: c })}
              style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: s.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer' }}>
          <X size={12} /> Cancel
        </button>
        <button onClick={() => valid && onSave(s)} disabled={!valid}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 7, background: 'var(--color-accent-fill, rgba(30,64,175,0.15))', border: '1px solid var(--color-accent, #1E40AF)30', color: 'var(--color-accent, #1E40AF)', fontSize: 12, fontWeight: 500, cursor: valid ? 'pointer' : 'default', opacity: valid ? 1 : 0.4 }}>
          <Plus size={12} /> {saveLabel ?? 'Add Habit'}
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HabitsModule() {
  const HABIT_COLORS = getHabitColors()

  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDelete, reorderHabits } = useHabitsStore()
  const [logs,    setLogs]    = useState(loadLogs)
  const [qtyLogs, setQtyLogs] = useState(loadQuantityLogs)
  const [viewDate, setViewDate] = useState(todayKey)
  const [addingHabit, setAdding] = useState(false)
  const dragHabitIdx = useRef<number | null>(null)

  const today = todayKey()
  const days  = daysWindow(viewDate, 7)

  // ── Boolean toggle ────────────────────────────────────────────────────────
  const toggleHabit = useCallback((habitId: string, day?: string) => {
    const d = day ?? viewDate
    setLogs(prev => {
      const existing = prev[habitId] ?? []
      const updated  = existing.includes(d) ? existing.filter(x => x !== d) : [...existing, d]
      const next = { ...prev, [habitId]: updated }
      saveLogs(next); scheduleLogsSync(next)
      return next
    })
  }, [viewDate])

  // ── Quantity set — syncs the boolean log automatically ─────────────────────
  const setQuantity = useCallback((habitId: string, goal: number, day: string, value: number) => {
    setQtyLogs(prev => {
      const habitQty = { ...(prev[habitId] ?? {}), [day]: value }
      const next = { ...prev, [habitId]: habitQty }
      saveQuantityLogs(next)
      return next
    })
    // Keep boolean log in sync: date is "done" when value >= goal
    setLogs(prev => {
      const existing = prev[habitId] ?? []
      const met = value >= goal
      const hasDone = existing.includes(day)
      if (met === hasDone) return prev
      const updated = met ? [...existing, day] : existing.filter(x => x !== day)
      const next = { ...prev, [habitId]: updated }
      saveLogs(next); scheduleLogsSync(next)
      return next
    })
  }, [])

  const deleteHabit = (habitId: string) => {
    storeDelete(habitId)
    setLogs(prev => {
      const next = { ...prev }; delete next[habitId]
      saveLogs(next); scheduleLogsSync(next)
      return next
    })
    setQtyLogs(prev => {
      const next = { ...prev }; delete next[habitId]
      saveQuantityLogs(next)
      return next
    })
  }

  const activeHabits = habits.filter(h => h.isActive)

  // Completion for current viewDate
  const viewCompleted = activeHabits.filter(h => (logs[h.id] ?? []).includes(viewDate)).length
  const completionRate = activeHabits.length > 0 ? Math.round((viewCompleted / activeHabits.length) * 100) : 0
  const isToday = viewDate === today

  return (
    <div>
      <TopBar title="Habits Tracker" subtitle="Small disciplines. Compounding results." />

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Summary cards ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            {
              label: isToday ? "Today's Progress" : fmtHeaderDate(new Date(viewDate + 'T12:00:00')),
              value: `${viewCompleted}/${activeHabits.length}`,
              sub: `${completionRate}% complete`,
              color: completionRate === 100 ? '#1D9E75' : 'var(--color-accent, #1E40AF)',
            },
            {
              label: 'Best Streak',
              value: `${Math.max(0, ...activeHabits.map(h => calcStreak(logs[h.id] ?? [])))}d`,
              sub: 'Consecutive days',
              color: 'var(--color-accent)',
            },
            {
              label: 'Active Habits',
              value: activeHabits.length,
              sub: 'Being tracked',
              color: 'var(--color-accent, #1E40AF)',
            },
          ].map(card => (
            <div key={card.label} style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: card.color, borderRadius: '12px 0 0 12px' }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', lineHeight: 1 }}>{card.value}</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-dim, #94A3B8)', marginTop: 4 }}>{card.label}</div>
              <div style={{ fontSize: 11, color: card.color, marginTop: 6, fontWeight: 500 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* ─── Habits list ───────────────────────────────────────────────── */}
        <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 14, overflow: 'visible', marginBottom: 14 }}>

          {/* List header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 12px 20px', borderBottom: '1px solid var(--color-border, #252A3E)' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Habit</span>

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

            <div style={{ display: 'flex', gap: 3 }}>
              {days.map(d => (
                <div key={d} style={{ width: 22, textAlign: 'center' }}>
                  <span style={{ fontSize: 9, color: d === viewDate ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #4B5563)', fontWeight: d === viewDate ? 700 : 400 }}>
                    {fmtDayLabel(d)}
                  </span>
                </div>
              ))}
            </div>

            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Streak</span>
          </div>

          {activeHabits.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-dim, #94A3B8)' }}>No habits yet. Add one below.</p>
            </div>
          )}

          {activeHabits.map((habit, i) => {
            const habitLogs  = logs[habit.id] ?? []
            const doneToday  = habitLogs.includes(viewDate)
            const streak     = calcStreak(habitLogs)
            const isQuantity = habit.type === 'quantity'
            const qtyValue   = qtyLogs[habit.id]?.[viewDate] ?? 0

            return (
              <div key={habit.id}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  if (dragHabitIdx.current !== null && dragHabitIdx.current !== i) {
                    reorderHabits(dragHabitIdx.current, i)
                    dragHabitIdx.current = null
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px 12px 12px',
                  borderBottom: i < activeHabits.length - 1 ? '1px solid var(--color-border, #252A3E)' : 'none',
                  background: doneToday ? `${habit.color}08` : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                {/* Drag handle */}
                <span
                  draggable
                  onDragStart={() => { dragHabitIdx.current = i }}
                  title="Drag to reorder"
                  style={{ cursor: 'grab', color: 'var(--color-text-muted, #4B5563)', fontSize: 14, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}
                >⠿</span>
                <EmojiBtn value={habit.emoji} onSelect={e => updateHabit(habit.id, { emoji: e })} />

                {/* Done circle — sits where color circle was */}
                {!isQuantity && (
                  <button onClick={() => toggleHabit(habit.id, viewDate)} title={doneToday ? 'Mark undone' : 'Mark done'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      background: doneToday ? habit.color : 'transparent',
                      border: `2px solid ${doneToday ? habit.color : 'var(--color-text-muted, #4B5563)'}`,
                      boxShadow: doneToday ? `0 0 0 2px var(--color-bg, #0D0F1A), 0 0 0 3px ${habit.color}60` : 'none',
                      transition: 'all 0.15s ease',
                    }} />
                  </button>
                )}

                <InlineEdit value={habit.name} onSave={v => updateHabit(habit.id, { name: v })}
                  style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: doneToday ? habit.color : 'var(--color-text, #E8EAF6)', textDecoration: doneToday ? 'line-through' : 'none', opacity: doneToday ? 0.8 : 1 }} />

                {/* Quantity control (for measurable habits) */}
                {isQuantity && (
                  <QuantityControl
                    value={qtyValue}
                    goal={habit.goal ?? 1}
                    unit={habit.unit}
                    color={habit.color}
                    onSet={v => setQuantity(habit.id, habit.goal ?? 1, viewDate, v)}
                  />
                )}

                {/* Frequency badge */}
                <button onClick={() => { const idx = FREQ_OPTS.indexOf(habit.frequency); updateHabit(habit.id, { frequency: FREQ_OPTS[(idx + 1) % FREQ_OPTS.length] }) }}
                  title="Click to change frequency"
                  style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-surface2, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-muted, #6B7280)' }}>
                  {habit.frequency}
                </button>

                {/* Day dots — boolean: filled/empty; quantity: partial fill shows achievement % */}
                <DayDots logs={habitLogs} color={habit.color} days={days} viewDate={viewDate}
                  quantities={isQuantity ? qtyLogs[habit.id] : undefined}
                  goal={isQuantity ? (habit.goal ?? 1) : undefined}
                  onToggle={d => {
                    if (isQuantity) {
                      const cur = qtyLogs[habit.id]?.[d] ?? 0
                      const goal = habit.goal ?? 1
                      setQuantity(habit.id, goal, d, cur >= goal ? 0 : goal)
                    } else {
                      toggleHabit(habit.id, d)
                    }
                  }} />

                {/* Streak */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: 52, justifyContent: 'flex-end' }}>
                  {streak > 0 && <Flame size={12} color={streak >= 7 ? '#E05252' : 'var(--color-accent, #1E40AF)'} />}
                  <span style={{ fontSize: 13, fontWeight: 600, color: streak > 0 ? (streak >= 7 ? '#E05252' : 'var(--color-accent, #1E40AF)') : 'var(--color-text-muted, #4B5563)' }}>
                    {streak > 0 ? `${streak}d` : '—'}
                  </span>
                </div>

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
          <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 12, padding: '18px 20px' }}>
            <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>New Habit</p>
            <HabitForm
              initial={{ name: '', emoji: '🎯', color: HABIT_COLORS[0], freq: 'daily', type: 'boolean', goal: '', unit: '' }}
              colors={HABIT_COLORS}
              onSave={s => {
                storeAdd({
                  name: s.name.trim(), emoji: s.emoji, color: s.color,
                  frequency: s.freq, isActive: true,
                  type: s.type,
                  goal: s.type === 'quantity' ? parseFloat(s.goal) : undefined,
                  unit: s.type === 'quantity' ? s.unit.trim() : undefined,
                })
                setAdding(false)
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '13px 18px', borderRadius: 10, background: 'transparent', border: '1px dashed var(--color-border, #252A3E)', color: 'var(--color-text-muted, #4B5563)', fontSize: 13, cursor: 'pointer' }}>
            <Plus size={14} /> Add a habit
          </button>
        )}

        {/* ─── Completion banner ──────────────────────────────────────────── */}
        {viewCompleted === activeHabits.length && activeHabits.length > 0 && (
          <div style={{ marginTop: 20, padding: '16px 20px', borderRadius: 10, background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.2)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Flame size={16} color="#1D9E75" />
            <p style={{ margin: 0, fontSize: 13.5, color: '#1D9E75', fontWeight: 500 }}>
              {isToday ? 'All habits complete for today. Exceptional discipline — keep the streak alive.' : `All habits complete for ${fmtHeaderDate(new Date(viewDate + 'T12:00:00'))}.`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
