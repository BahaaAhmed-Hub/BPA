import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
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
function offsetDays(base: string, delta: number): string {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return toKey(d)
}

/** Returns the Monday of the week containing `dateKey` */
function weekStart(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return toKey(d)
}

function weekDays(startKey: string): string[] {
  const result: string[] = []
  for (let i = 0; i < 7; i++) result.push(offsetDays(startKey, i))
  return result
}

function fmtWeekRange(startKey: string): string {
  const start = new Date(startKey + 'T12:00:00')
  const end   = new Date(startKey + 'T12:00:00'); end.setDate(end.getDate() + 6)
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${s} – ${e}`
}

// ─── Frequency options ────────────────────────────────────────────────────────

const FREQ_OPTS = ['daily', 'weekdays', 'weekly'] as const
type Freq = typeof FREQ_OPTS[number]

// ─── Emoji picker ─────────────────────────────────────────────────────────────

const EMOJIS = [
  '🏃','💪','🏋️','🚴','🤸','🏊','🧘','🚶','⚽','🎾','🥊','🏄','🧗','🤾','🏇','🎿','⛷️','🤺','🏌️','🎳',
  '💧','🍎','🥗','🥦','🍵','🫐','🍓','🥑','🫁','🥤','🧃','🥛','🍇','🥕','🫚','🌾','🍋','🫒',
  '📚','🧠','✍️','📝','📖','🔬','🗓️','🧩','💡','🔭','🎓','🗺️','📐','🖊️','📓','🃏',
  '🎯','🔥','⚡','🏆','🥇','✅','⏰','📅','🚀','💼','📊','🗝️','⚙️','🛠️','🎪',
  '🎵','🎨','🎭','🎸','📷','🎹','✏️','🎺','🎻','🎤','🎬','🖼️','🧶','🪡','📸',
  '🌿','☀️','🌙','🧹','🛁','🚿','💤','🌅','🌳','🌸','🪴','🌈','🌊','🏔️','🦋',
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
        style={{ width: 24, height: 24, borderRadius: 7, background: '#FAF7EC', border: '1px solid #E8E1CE', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
        {value}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 30, left: 0, zIndex: 300, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10, padding: '8px', display: 'flex', gap: 4, flexWrap: 'wrap', width: 252, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => { onSelect(e); setOpen(false) }}
              style={{ fontSize: 16, width: 32, height: 32, borderRadius: 7, cursor: 'pointer', border: '1px solid', borderColor: e === value ? '#E8E1CE' : 'transparent', background: e === value ? '#FAF7EC' : 'transparent' }}>{e}</button>
          ))}
        </div>
      )}
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
      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #E8E1CE', outline: 'none', color: '#191712', fontFamily: 'inherit', padding: '0 2px', ...style }} />
  )
  return <span onClick={() => { setDraft(value); setEditing(true) }} title="Click to rename" style={{ cursor: 'text', ...style }}>{value}</span>
}

// ─── Week cell ────────────────────────────────────────────────────────────────

function WeekCell({
  done, isToday, isFuture, onToggle,
}: {
  done: boolean; isToday: boolean; isFuture: boolean; onToggle: () => void
}) {
  let bg = '#F3EEE0'
  let border = '1px solid #E8E1CE'
  let content = null

  if (isFuture) {
    bg = '#F3EEE0'; border = '1px solid #E8E1CE'
  } else if (done) {
    bg = '#191712'; border = '1px solid #191712'
    content = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FDF8E7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7"/>
      </svg>
    )
  } else if (isToday) {
    bg = '#FFFFFF'; border = '1px solid #191712'
  }

  return (
    <button
      disabled={isFuture}
      onClick={() => !isFuture && onToggle()}
      style={{
        width: 22, height: 22, borderRadius: 6, boxSizing: 'border-box',
        background: bg, border,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: isFuture ? 'default' : 'pointer', padding: 0,
        opacity: isFuture ? 0.4 : 1, flexShrink: 0,
      }}>
      {content}
    </button>
  )
}

// ─── Quantity control ─────────────────────────────────────────────────────────

function QuantityControl({ value, goal, unit, onSet }: { value: number; goal: number; unit?: string; onSet: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) { setDraft(String(value)); inputRef.current?.focus() } }, [editing, value])
  function commit() {
    const n = parseFloat(draft)
    if (!isNaN(n) && n >= 0) onSet(Math.round(n * 10) / 10)
    setEditing(false)
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <button onClick={() => onSet(Math.max(0, value - 1))}
        style={{ width: 22, height: 22, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #E8E1CE', background: '#FFFFFF', cursor: 'pointer', color: '#6C6553', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
      </button>
      {editing ? (
        <input ref={inputRef} value={draft} type="number" min={0}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          style={{ minWidth: 52, height: 22, boxSizing: 'border-box', textAlign: 'center', fontSize: 11, fontWeight: 600, background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 6, color: '#191712', outline: 'none', padding: '0 8px' }} />
      ) : (
        <button onClick={() => setEditing(true)} title="Click to enter value"
          style={{ minWidth: 52, height: 22, boxSizing: 'border-box', padding: '0 8px', borderRadius: 6, background: '#FAF7EC', border: '1px solid #E8E1CE', color: '#191712', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
          {value} / {goal}{unit ? ` ${unit}` : ''}
        </button>
      )}
      <button onClick={() => onSet(value + 1)}
        style={{ width: 22, height: 22, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #E8E1CE', background: '#FFFFFF', cursor: 'pointer', color: '#191712', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </span>
  )
}

// ─── Add / Edit habit form ─────────────────────────────────────────────────────

interface HabitFormState {
  name: string; emoji: string; color: string; freq: Freq
  type: 'boolean' | 'quantity'; goal: string; unit: string
}

function HabitForm({ initial, colors, onSave, onCancel, saveLabel }: {
  initial: HabitFormState; colors: string[]
  onSave: (s: HabitFormState) => void; onCancel: () => void; saveLabel?: string
}) {
  const [s, setS] = useState<HabitFormState>(initial)
  const update = (patch: Partial<HabitFormState>) => setS(prev => ({ ...prev, ...patch }))
  const valid = s.name.trim() !== '' && (s.type === 'boolean' || (parseFloat(s.goal) > 0 && s.unit.trim() !== ''))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Emoji row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
        {EMOJIS.slice(0, 30).map(e => (
          <button key={e} onClick={() => update({ emoji: e })}
            style={{ fontSize: 18, background: s.emoji === e ? '#FAF7EC' : 'transparent', border: `1px solid ${s.emoji === e ? '#E8E1CE' : 'transparent'}`, borderRadius: 7, cursor: 'pointer', width: 36, height: 36, flexShrink: 0 }}>
            {e}
          </button>
        ))}
      </div>

      {/* Name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Name</label>
        <input value={s.name} onChange={e => update({ name: e.target.value })} placeholder="e.g. Morning meditation"
          style={{ background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#191712', outline: 'none' }} />
      </div>

      {/* Type & Goal */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Type</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['boolean', 'quantity'] as const).map(t => (
              <button key={t} onClick={() => update({ type: t })}
                style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: s.type === t ? '#191712' : '#FAF7EC', color: s.type === t ? '#FDF8E7' : '#6C6553', border: `1px solid ${s.type === t ? '#191712' : '#E8E1CE'}` }}>
                {t === 'boolean' ? 'Done/Undone' : 'Measurable'}
              </button>
            ))}
          </div>
        </div>
        {s.type === 'quantity' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Goal</label>
              <input value={s.goal} onChange={e => update({ goal: e.target.value })} type="number" min={1} placeholder="e.g. 8"
                style={{ width: 72, background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#191712', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Unit</label>
              <input value={s.unit} onChange={e => update({ unit: e.target.value })} placeholder="glasses, km…"
                style={{ width: 120, background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#191712', outline: 'none' }} />
            </div>
          </>
        )}
      </div>

      {/* Frequency */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Frequency</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {FREQ_OPTS.map(f => (
            <button key={f} onClick={() => update({ freq: f })}
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: s.freq === f ? '#191712' : '#FAF7EC', color: s.freq === f ? '#FDF8E7' : '#6C6553', border: `1px solid ${s.freq === f ? '#191712' : '#E8E1CE'}` }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Accent</label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {colors.map(c => (
            <button key={c} onClick={() => update({ color: c })}
              style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: `2px solid ${s.color === c ? '#191712' : 'transparent'}`, cursor: 'pointer', padding: 0 }} />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 12, cursor: 'pointer' }}>
          <X size={12} /> Cancel
        </button>
        <button onClick={() => valid && onSave(s)} disabled={!valid}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 7, background: valid ? '#F5D14E' : '#FAF7EC', border: 'none', color: valid ? '#191712' : '#6C6553', fontSize: 12, fontWeight: 600, cursor: valid ? 'pointer' : 'default', opacity: valid ? 1 : 0.5 }}>
          <Plus size={12} /> {saveLabel ?? 'Add Habit'}
        </button>
      </div>
    </div>
  )
}

// ─── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? done / total : 0
  const deg = Math.round(pct * 360)
  return (
    <span style={{
      position: 'relative', width: 52, height: 52, flexShrink: 0, borderRadius: '50%',
      background: `conic-gradient(#191712 0deg, #191712 ${deg}deg, #EFE7D4 ${deg}deg)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ position: 'absolute', inset: 6, borderRadius: '50%', background: '#FFFFFF', border: '1px solid #E8E1CE' }} />
      <span style={{ position: 'relative', fontSize: 13, fontWeight: 700, color: '#191712', fontVariantNumeric: 'tabular-nums' }}>
        {done}<span style={{ fontSize: 9, color: '#6C6553' }}>/{total}</span>
      </span>
    </span>
  )
}

// ─── Wall view card (12A) ─────────────────────────────────────────────────────

const WALL_PALETTE = [
  '#E8E4D8','#D9E4C8','#D8E0E4','#E4D9D8','#E4E0D8',
  '#DDD8E4','#D8E4E0','#E4DDD8','#D8E0D8',
]

function WallCard({ habit, todayDone, streak, qtyValue, onToggle, onIncrement, paletteIdx }: {
  habit: { id: string; name: string; emoji: string; type?: string; goal?: number; unit?: string }
  todayDone: boolean
  streak: number
  qtyValue: number
  onToggle: () => void
  onIncrement: () => void
  paletteIdx: number
}) {
  const bgColor = WALL_PALETTE[paletteIdx % WALL_PALETTE.length]
  const isQty = habit.type === 'quantity'
  const pct = isQty && habit.goal ? Math.min(100, Math.round((qtyValue / habit.goal) * 100)) : (todayDone ? 100 : 0)
  const weekDots = Array.from({ length: 7 }, (_, i) => i < (streak % 7) ? '#191712' : '')

  return (
    <div style={{ display: 'flex', minWidth: 0, minHeight: 0, borderRadius: 18, overflow: 'hidden', border: '1px solid #E8E1CE', background: '#FFFFFF' }}>
      {/* Left: photo-style colored panel with gradient overlay */}
      <span style={{ position: 'relative', width: '66.6%', flexShrink: 0 }}>
        {/* Warm gradient fill simulating photo */}
        <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}CC 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 52, opacity: 0.18 }}>{habit.emoji}</span>
        </span>
        {/* Dark gradient overlay */}
        <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg,rgba(25,23,18,.46) 0%,rgba(25,23,18,.10) 40%,rgba(25,23,18,.52) 100%)' }} />
        {/* Content overlay */}
        <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', padding: '12px 13px' }}>
          {/* Streak badge */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', height: 20, padding: '0 8px', borderRadius: 999, background: 'rgba(25,23,18,.42)', border: '1px solid rgba(255,255,255,.36)', color: '#FFFFFF', fontSize: 10, fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5"/></svg>
            {streak}d
          </span>
          {/* Habit name */}
          <span style={{ marginTop: 'auto', fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15, color: '#FFFFFF', textShadow: '0 1px 10px rgba(25,23,18,.55)' }}>{habit.name}</span>
        </span>
      </span>
      {/* Right: data panel */}
      <span style={{ flex: 1, minWidth: 0, background: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: 9, padding: '13px 14px' }}>
        {/* Count / status */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', fontVariantNumeric: 'tabular-nums' }}>
            {isQty ? `${qtyValue}${habit.unit ? ' ' + habit.unit : ''}` : (todayDone ? 'Done' : '—')}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6C6553', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isQty && habit.goal ? `of ${habit.goal} ${habit.unit ?? ''}` : (todayDone ? 'logged today' : 'not yet done')}
          </span>
        </span>
        {/* Week dot streak (last 7 days) */}
        <span style={{ display: 'flex', gap: 5 }}>
          {weekDots.map((filled, i) => (
            <span key={i} style={{ width: 8, height: 8, boxSizing: 'border-box', borderRadius: 999, background: filled || (todayDone && i === 6) ? '#191712' : 'transparent', border: `1px solid ${filled || (todayDone && i === 6) ? 'transparent' : 'rgba(25,23,18,.35)'}`, display: 'block' }} />
          ))}
        </span>
        {/* CTA button */}
        <span style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, height: 38, boxSizing: 'border-box', padding: 4, borderRadius: 999, background: '#FAF7EC', border: '1px solid #E8E1CE' }}>
          <button onClick={isQty ? onIncrement : onToggle} style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 999, background: '#191712', color: '#FDF8E7', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
            {todayDone && !isQty
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
            }
          </button>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#191712', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {todayDone && !isQty ? 'Logged ✓' : isQty ? `+${habit.unit ?? '1'}` : 'Tap to log'}
          </span>
        </span>
      </span>
    </div>
  )
}

// ─── Fill view card (12B) ─────────────────────────────────────────────────────

function FillCard({ habit, todayDone, streak, qtyValue, onToggle, onIncrement, onDecrement, paletteIdx, isSelected, onSelect }: {
  habit: { id: string; name: string; emoji: string; type?: string; goal?: number; unit?: string }
  todayDone: boolean
  streak: number
  qtyValue: number
  onToggle: () => void
  onIncrement: () => void
  onDecrement: () => void
  paletteIdx: number
  isSelected: boolean
  onSelect: () => void
}) {
  const bgColor = WALL_PALETTE[paletteIdx % WALL_PALETTE.length]
  const isQty = habit.type === 'quantity'
  const pct = isQty && habit.goal ? Math.min(100, Math.round((qtyValue / habit.goal) * 100)) : (todayDone ? 100 : 0)
  const lastWeek = Array.from({ length: 7 }, (_, i) => i < (streak % 7))

  const filterStyle = pct === 0
    ? 'saturate(0.06) grayscale(1) brightness(0.82) contrast(0.94)'
    : pct < 50 ? 'saturate(0.5) brightness(0.9)' : ''

  return (
    <div
      onClick={onSelect}
      style={{
        position: 'relative', flexShrink: 0, height: 520,
        width: isSelected ? 220 : 110,
        borderRadius: 16, overflow: 'hidden',
        border: isSelected ? '1px solid #191712' : '1px solid #E8E1CE',
        background: '#FFFFFF',
        boxShadow: isSelected ? '0 0 0 3px rgba(245,209,78,.45)' : 'none',
        cursor: isSelected ? 'default' : 'pointer',
        transition: 'width 0.3s ease',
      }}
    >
      {/* Background */}
      <span style={{ position: 'absolute', inset: 0, filter: filterStyle, opacity: pct === 0 ? 0.42 : 0.76 }}>
        <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}AA 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 72, opacity: 0.25 }}>{habit.emoji}</span>
        </span>
      </span>
      {/* Dark gradient */}
      <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg,rgba(25,23,18,.52) 0%,rgba(25,23,18,.04) 34%,rgba(25,23,18,.30) 62%,rgba(25,23,18,.86) 100%)' }} />
      {/* Content */}
      <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '12px 11px' }}>
        {/* Top */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', borderRadius: 999, background: 'rgba(253,248,231,.16)', border: '1px solid rgba(253,248,231,.32)', color: '#FDF8E7', fontSize: 9.5, fontWeight: 700, alignSelf: 'flex-start', fontVariantNumeric: 'tabular-nums' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5"/></svg>
            {streak}d
          </span>
          {isSelected && (
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.16, color: '#FDF8E7' }}>{habit.name}</span>
          )}
        </span>
        {/* Bottom */}
        <span style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {isSelected && (
            <>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: '#FDF8E7', fontVariantNumeric: 'tabular-nums' }}>
                  {isQty ? `${qtyValue}${habit.unit ? ' ' + habit.unit : ''}` : (todayDone ? 'Done' : '—')}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(253,248,231,.78)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isQty && habit.goal ? `of ${habit.goal} ${habit.unit ?? ''}` : (todayDone ? 'logged today' : 'nothing yet')}
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                {/* Progress bar */}
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, height: 5, borderRadius: 999, background: 'rgba(253,248,231,.24)', overflow: 'hidden', display: 'block' }}>
                    <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: '#F5D14E', borderRadius: 999 }} />
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: '#FDF8E7', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                </span>
                {/* Week dots */}
                <span style={{ display: 'flex', gap: 3 }}>
                  {lastWeek.map((done, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: done ? '#FDF8E7' : 'rgba(253,248,231,.28)', display: 'block' }} />
                  ))}
                </span>
              </span>
              {/* +/- controls */}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.02em', color: 'rgba(253,248,231,.86)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {isQty ? `+${habit.unit ?? '1'}` : (todayDone ? 'Logged ✓' : 'Log it')}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, height: 30, boxSizing: 'border-box', padding: 3, borderRadius: 999, background: 'rgba(253,248,231,.16)', border: '1px solid rgba(253,248,231,.4)', backdropFilter: 'blur(6px)' }}>
                  <button onClick={e => { e.stopPropagation(); isQty ? onDecrement() : onToggle() }} style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 999, background: 'rgba(253,248,231,.2)', border: '1px solid rgba(253,248,231,.34)', color: '#FDF8E7', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
                  </button>
                  <button onClick={e => { e.stopPropagation(); isQty ? onIncrement() : onToggle() }} style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 999, background: '#FDF8E7', color: '#191712', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </span>
              </span>
            </>
          )}
          {!isSelected && (
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, color: '#FDF8E7', writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', alignSelf: 'center' }}>
              {habit.name}
            </span>
          )}
        </span>
      </span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HabitsModule() {
  const HABIT_COLORS = getHabitColors()

  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDelete, reorderHabits } = useHabitsStore()
  const [logs,    setLogs]    = useState(loadLogs)
  const [qtyLogs, setQtyLogs] = useState(loadQuantityLogs)

  // Week navigation: anchor to Monday of current week
  const today = todayKey()
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(today))
  const days = weekDays(weekAnchor)

  const [addingHabit, setAdding] = useState(false)
  const dragHabitIdx = useRef<number | null>(null)
  const [view, setView] = useState<'table' | 'wall' | 'fill'>('table')
  const [fillSelected, setFillSelected] = useState<string | null>(null)

  // ── Boolean toggle ─────────────────────────────────────────────────────────
  const toggleHabit = useCallback((habitId: string, day: string) => {
    setLogs(prev => {
      const existing = prev[habitId] ?? []
      const updated  = existing.includes(day) ? existing.filter(x => x !== day) : [...existing, day]
      const next = { ...prev, [habitId]: updated }
      saveLogs(next); scheduleLogsSync(next)
      return next
    })
  }, [])

  // ── Quantity set ───────────────────────────────────────────────────────────
  const setQuantity = useCallback((habitId: string, goal: number, day: string, value: number) => {
    setQtyLogs(prev => {
      const habitQty = { ...(prev[habitId] ?? {}), [day]: value }
      const next = { ...prev, [habitId]: habitQty }
      saveQuantityLogs(next)
      return next
    })
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

  // Today's completion stats
  const todayDone = activeHabits.filter(h => (logs[h.id] ?? []).includes(today)).length
  const totalActive = activeHabits.length
  const completionPct = totalActive > 0 ? Math.round((todayDone / totalActive) * 100) : 0

  // Week completion stats
  const weekDayKeys = days
  const weekCheckIns = activeHabits.reduce((sum, h) => {
    return sum + weekDayKeys.filter(d => (logs[h.id] ?? []).includes(d)).length
  }, 0)
  const weekTotal = activeHabits.length * 7
  const weekPct = weekTotal > 0 ? Math.round((weekCheckIns / weekTotal) * 100) : 0

  // Current streak (max across active habits) + cold days
  const bestStreak = activeHabits.length > 0
    ? Math.max(...activeHabits.map(h => calcStreak(logs[h.id] ?? [])))
    : 0

  // Cold days: how many days since the best-streaking habit was last logged
  const coldDays = (() => {
    if (bestStreak > 0) return 0
    if (activeHabits.length === 0) return 0
    const allLogs = activeHabits.flatMap(h => logs[h.id] ?? [])
    if (allLogs.length === 0) return 0
    const latest = allLogs.sort().at(-1)!
    const msOff = new Date(today + 'T00:00:00').getTime() - new Date(latest + 'T00:00:00').getTime()
    return Math.floor(msOff / 86400000)
  })()

  const isCurrentWeek = weekAnchor === weekStart(today)

  // Week bar data: for each day of week, compute completion % across all habits
  const weekBars = days.map(d => {
    if (totalActive === 0) return 0
    const done = activeHabits.filter(h => (logs[h.id] ?? []).includes(d)).length
    return done / totalActive
  })

  return (
    <div style={{ padding: '22px 26px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ─── Page header ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553' }}>HABITS TRACKER</span>
          <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
            {todayDone} of {totalActive} done today
          </span>
          <span style={{ fontSize: 12, color: '#6C6553', paddingTop: 3 }}>
            {completionPct}% complete
            {bestStreak > 0 ? ` · ${bestStreak}d streak` : coldDays > 0 ? ` · ${coldDays} days cold` : ' · no streak yet'}
            {' · '}{weekPct}% this week
          </span>
        </div>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 3 }}>
          {/* View toggle */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, height: 34, boxSizing: 'border-box', padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            {([
              { id: 'table' as const, label: 'Table' },
              { id: 'wall'  as const, label: 'Wall' },
              { id: 'fill'  as const, label: 'Fill' },
            ]).map(v => (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                height: 28, padding: '0 12px', borderRadius: 999,
                background: view === v.id ? '#FFFFFF' : 'transparent',
                boxShadow: view === v.id ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
                color: view === v.id ? '#191712' : '#6C6553',
                fontWeight: view === v.id ? 600 : 500, fontSize: 12,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}>{v.label}</button>
            ))}
          </span>
          {/* New habit CTA */}
          <button onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', height: 34, padding: '0 15px', borderRadius: 999, background: '#F5D14E', color: '#191712', fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 2px 0 rgba(25,23,18,.14)', flexShrink: 0 }}>
            <Plus size={15} />
            New habit
          </button>
        </span>
      </div>

      {/* ─── Summary card ──────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 16, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
        {/* Progress ring */}
        <ProgressRing done={todayDone} total={totalActive} />

        {/* Status text */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#191712' }}>
            {todayDone === 0 ? 'Nothing logged yet today' : todayDone === totalActive ? 'All habits complete! 🎉' : `${todayDone} of ${totalActive} done`}
          </span>
          <span style={{ fontSize: 10.5, color: '#6C6553' }}>
            {totalActive === 0 ? 'Add your first habit below' : `Resets at midnight · ${totalActive - todayDone} remaining`}
          </span>
        </span>

        {/* Divider */}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#F0EBDC', margin: '0 4px' }} />

        {/* Week bars */}
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 7, flexShrink: 0 }}>
          {days.map((d, i) => {
            const pct = weekBars[i]
            const isT = d === today
            const dayLabel = ['S','M','T','W','T','F','S'][new Date(d + 'T12:00:00').getDay()]
            return (
              <span key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 34, borderRadius: 3, background: '#F3EEE0', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                  <span style={{ width: '100%', height: `${Math.round(pct * 100)}%`, background: isT ? '#F5D14E' : '#191712', borderRadius: 3, display: 'block' }} />
                </span>
                <span style={{ fontSize: 8.5, color: isT ? '#191712' : '#6C6553', fontWeight: isT ? 700 : 500 }}>{dayLabel}</span>
              </span>
            )
          })}
        </span>

        {/* Divider */}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#F0EBDC', margin: '0 4px' }} />

        {/* Week % */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', fontVariantNumeric: 'tabular-nums' }}>{weekPct}%</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4A4438' }}>This week</span>
          <span style={{ fontSize: 9.5, color: '#6C6553' }}>{weekCheckIns} of {weekTotal} check-ins</span>
        </span>

        {/* Divider */}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#F0EBDC', margin: '0 4px' }} />

        {/* Streak */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ color: '#6C6553' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5"/></svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', fontVariantNumeric: 'tabular-nums' }}>{bestStreak}d</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4A4438' }}>Current streak</span>
            <span style={{ fontSize: 9.5, color: coldDays > 0 ? '#B4523A' : '#6C6553' }}>
              {coldDays > 0 ? `${coldDays} days cold` : `best ${bestStreak}d`}
            </span>
          </span>
        </span>

        {/* Divider */}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#F0EBDC', margin: '0 4px' }} />

        {/* Active habits count */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', fontVariantNumeric: 'tabular-nums' }}>{totalActive}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4A4438' }}>Active habits</span>
          <span style={{ fontSize: 9.5, color: '#6C6553' }}>{activeHabits.filter(h => h.frequency === 'weekdays').length} weekday-only</span>
        </span>
      </div>

      {/* ─── Wall view (12A) ────────────────────────────────────────────────── */}
      {view === 'wall' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoRows: '220px', gap: 14 }}>
          {activeHabits.map((habit, i) => {
            const habitLogs   = logs[habit.id] ?? []
            const todayDoneH  = habitLogs.includes(today)
            const streak      = calcStreak(habitLogs)
            const isQuantity  = habit.type === 'quantity'
            const qtyValue    = isQuantity ? (qtyLogs[habit.id]?.[today] ?? 0) : 0
            return (
              <WallCard
                key={habit.id}
                habit={habit}
                todayDone={todayDoneH}
                streak={streak}
                qtyValue={qtyValue}
                paletteIdx={i}
                onToggle={() => toggleHabit(habit.id, today)}
                onIncrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, today, qtyValue + 1)}
              />
            )
          })}
          {activeHabits.length === 0 && (
            <div style={{ gridColumn: '1/-1', padding: 32, textAlign: 'center', color: '#6C6553', fontSize: 13 }}>
              No habits yet. Click "New habit" to get started.
            </div>
          )}
        </div>
      )}

      {/* ─── Fill view (12B) ────────────────────────────────────────────────── */}
      {view === 'fill' && (
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', minHeight: 520, padding: '4px 0 8px', scrollbarWidth: 'thin' }}>
          {activeHabits.map((habit, i) => {
            const habitLogs   = logs[habit.id] ?? []
            const todayDoneH  = habitLogs.includes(today)
            const streak      = calcStreak(habitLogs)
            const isQuantity  = habit.type === 'quantity'
            const qtyValue    = isQuantity ? (qtyLogs[habit.id]?.[today] ?? 0) : 0
            const isSelected  = (fillSelected ?? activeHabits[0]?.id) === habit.id
            return (
              <FillCard
                key={habit.id}
                habit={habit}
                todayDone={todayDoneH}
                streak={streak}
                qtyValue={qtyValue}
                paletteIdx={i}
                isSelected={isSelected}
                onSelect={() => setFillSelected(habit.id)}
                onToggle={() => toggleHabit(habit.id, today)}
                onIncrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, today, qtyValue + 1)}
                onDecrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, today, Math.max(0, qtyValue - 1))}
              />
            )
          })}
          {activeHabits.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#6C6553', fontSize: 13 }}>
              No habits yet. Click "New habit" to get started.
            </div>
          )}
        </div>
      )}

      {/* ─── Habits table ───────────────────────────────────────────────────── */}
      {view === 'table' && <div style={{ flex: 1, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Table header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 4px 8px', minWidth: 0 }}>
          {/* drag handle placeholder */}
          <span style={{ width: 14, flexShrink: 0 }} />
          {/* today-check placeholder */}
          <span style={{ width: 22, flexShrink: 0 }} />
          {/* emoji placeholder */}
          <span style={{ width: 24, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553' }}>HABIT</span>

          {/* Week nav */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setWeekAnchor(d => offsetDays(d, -7))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 0, display: 'flex' }}>
              <ChevronLeft size={13} />
            </button>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: isCurrentWeek ? '#191712' : '#4A4438', minWidth: 120, textAlign: 'center' }}>
              {isCurrentWeek ? 'This week' : 'Week'} · {fmtWeekRange(weekAnchor)}
            </span>
            <button onClick={() => setWeekAnchor(d => offsetDays(d, 7))} disabled={isCurrentWeek}
              style={{ background: 'none', border: 'none', cursor: isCurrentWeek ? 'default' : 'pointer', color: '#6C6553', padding: 0, display: 'flex', opacity: isCurrentWeek ? 0.3 : 1 }}>
              <ChevronRight size={13} />
            </button>
          </span>

          {/* Day letter headers */}
          <span style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            {days.map(d => {
              const dayLabel = ['S','M','T','W','T','F','S'][new Date(d + 'T12:00:00').getDay()]
              const isT = d === today
              return (
                <span key={d} style={{ width: 22, textAlign: 'center', fontSize: 9.5, fontWeight: isT ? 700 : 600, color: isT ? '#191712' : '#6C6553' }}>
                  {dayLabel}
                </span>
              )
            })}
          </span>

          <span style={{ width: 48, textAlign: 'right', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#6C6553', flexShrink: 0 }}>STREAK</span>
          <span style={{ width: 38, flexShrink: 0 }} />
        </div>

        {/* Empty state */}
        {activeHabits.length === 0 && !addingHabit && (
          <div style={{ padding: 32, textAlign: 'center', color: '#6C6553', fontSize: 13 }}>
            No habits yet. Click "New habit" to get started.
          </div>
        )}

        {/* Habit rows */}
        {activeHabits.map((habit, i) => {
          const habitLogs  = logs[habit.id] ?? []
          const todayDoneH = habitLogs.includes(today)
          const streak     = calcStreak(habitLogs)
          const isQuantity = habit.type === 'quantity'

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
                height: 46, borderTop: '1px solid #F0EBDC', padding: '0 4px',
                background: 'transparent', minWidth: 0,
              }}
            >
              {/* Drag handle */}
              <span draggable onDragStart={() => { dragHabitIdx.current = i }}
                title="Drag to reorder"
                style={{ color: '#CFC7B2', flexShrink: 0, cursor: 'grab', display: 'flex' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/>
                  <circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/>
                </svg>
              </span>

              {/* Today done checkbox */}
              <button onClick={() => toggleHabit(habit.id, today)} title={todayDoneH ? 'Mark undone' : 'Mark done'}
                style={{ width: 22, height: 22, boxSizing: 'border-box', borderRadius: 7, background: '#FFFFFF', border: '1.5px solid #E8E1CE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
                {todayDoneH && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#191712" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </button>

              {/* Emoji icon */}
              <EmojiBtn value={habit.emoji} onSelect={e => updateHabit(habit.id, { emoji: e })} />

              {/* Habit name */}
              <InlineEdit value={habit.name} onSave={v => updateHabit(habit.id, { name: v })}
                style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#191712', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} />

              {/* Quantity control for measurable habits */}
              {isQuantity && (
                <QuantityControl
                  value={qtyLogs[habit.id]?.[today] ?? 0}
                  goal={habit.goal ?? 1}
                  unit={habit.unit}
                  onSet={v => setQuantity(habit.id, habit.goal ?? 1, today, v)}
                />
              )}

              {/* Frequency badge */}
              <button onClick={() => { const idx = FREQ_OPTS.indexOf(habit.frequency); updateHabit(habit.id, { frequency: FREQ_OPTS[(idx + 1) % FREQ_OPTS.length] }) }}
                title="Click to change frequency"
                style={{ height: 20, boxSizing: 'border-box', padding: '0 8px', borderRadius: 6, background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }}>
                {habit.frequency}
              </button>

              {/* Week cells */}
              <span style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                {days.map(d => {
                  const done = habitLogs.includes(d)
                  const isT = d === today
                  const isFuture = d > today
                  if (isQuantity) {
                    const qty = qtyLogs[habit.id]?.[d] ?? 0
                    const goal = habit.goal ?? 1
                    return (
                      <WeekCell key={d} done={qty >= goal} isToday={isT} isFuture={isFuture}
                        onToggle={() => {
                          const cur = qtyLogs[habit.id]?.[d] ?? 0
                          setQuantity(habit.id, goal, d, cur >= goal ? 0 : goal)
                        }} />
                    )
                  }
                  return (
                    <WeekCell key={d} done={done} isToday={isT} isFuture={isFuture}
                      onToggle={() => toggleHabit(habit.id, d)} />
                  )
                })}
              </span>

              {/* Streak */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, width: 48, justifyContent: 'flex-end', flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: streak > 0 ? '#4E7645' : '#6C6553', fontVariantNumeric: 'tabular-nums' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5"/></svg>
                {streak > 0 ? `${streak}d` : '0d'}
              </span>

              {/* Actions: archive + delete */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: 38, justifyContent: 'flex-end', flexShrink: 0, color: '#6C6553' }}>
                <button onClick={() => updateHabit(habit.id, { isActive: false })} title="Archive"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'inherit', display: 'flex' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M5 8v11h14V8"/><path d="M10 12h4"/>
                  </svg>
                </button>
                <button onClick={() => deleteHabit(habit.id)} title="Delete"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'inherit', display: 'flex' }}>
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          )
        })}

        {/* Archived habits section (collapsed) */}
        {habits.filter(h => !h.isActive).length > 0 && (
          <details style={{ marginTop: 8, borderTop: '1px solid #F0EBDC' }}>
            <summary style={{ fontSize: 11, color: '#8A8272', cursor: 'pointer', padding: '8px 4px', fontWeight: 600, letterSpacing: '0.08em' }}>
              ARCHIVED ({habits.filter(h => !h.isActive).length})
            </summary>
            {habits.filter(h => !h.isActive).map(habit => (
              <div key={habit.id} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 40, borderTop: '1px solid #F0EBDC', padding: '0 4px', opacity: 0.6 }}>
                <span style={{ width: 14, flexShrink: 0 }} />
                <span style={{ width: 22, flexShrink: 0 }} />
                <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{habit.emoji}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#8A8272', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{habit.name}</span>
                <button onClick={() => updateHabit(habit.id, { isActive: true })} title="Restore"
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: '#FAF7EC', border: '1px solid #E8E1CE', color: '#6C6553', cursor: 'pointer' }}>
                  Restore
                </button>
                <button onClick={() => deleteHabit(habit.id)} title="Delete permanently"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#6C6553' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </details>
        )}
      </div>}

      {/* ─── Add habit form ─────────────────────────────────────────────────── */}
      {addingHabit && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14, padding: '18px 20px' }}>
          <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.8px' }}>New Habit</p>
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
      )}

      {/* ─── All-done banner ────────────────────────────────────────────────── */}
      {todayDone === totalActive && totalActive > 0 && (
        <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(78,118,69,0.08)', border: '1px solid rgba(78,118,69,0.2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4E7645" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5"/></svg>
          <p style={{ margin: 0, fontSize: 13.5, color: '#4E7645', fontWeight: 500 }}>
            All habits complete for today. Exceptional discipline — keep the streak alive.
          </p>
        </div>
      )}
    </div>
  )
}
