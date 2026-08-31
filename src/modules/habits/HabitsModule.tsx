import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useHabitsStore, loadLogs, saveLogs, loadQuantityLogs, saveQuantityLogs,
  calcStreak, getHabitColors,
  type HabitLogs, type Habit,
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

export type HabitView = 'table' | 'wall' | 'fill'
const HABIT_VIEW_KEY = 'professor-habit-view'

export const HABIT_VIEWS: { id: HabitView; label: string; hint: string }[] = [
  { id: 'table', label: 'Table',  hint: 'Every habit on one line, a week at a time' },
  { id: 'wall',  label: 'Wall',   hint: 'A grid of picture cards' },
  { id: 'fill',  label: 'Fill',   hint: 'Tall cards that fill up as you log' },
]

/** Which view the Habits page opens on. Changing it on the page sticks. */
export function loadHabitView(): HabitView {
  try {
    const v = localStorage.getItem(HABIT_VIEW_KEY)
    return v === 'wall' || v === 'fill' || v === 'table' ? v : 'table'
  } catch { return 'table' }
}
export function saveHabitView(v: HabitView): void {
  try { localStorage.setItem(HABIT_VIEW_KEY, v) } catch { /* private mode */ }
}


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

/** Reads a picked file into a data URL, downscaled so localStorage can hold it. */
function readHabitImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('unreadable'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('not an image'))
      img.onload = () => {
        const MAX = 640
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(String(reader.result)); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** Picture well: shows the habit's photo, or its emoji until one is picked. */
function HabitImagePicker({ image, emoji, onChange, size = 54 }: {
  image?: string
  emoji: string
  onChange: (v: string | undefined) => void
  size?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        title={image ? 'Change picture' : 'Add a picture'}
        style={{
          width: size, height: size, borderRadius: 13, padding: 0, cursor: 'pointer',
          overflow: 'hidden', background: '#FAF7EC', border: '1px solid #E8E1CE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.round(size * 0.5), lineHeight: 1,
        }}>
        {image
          ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : (emoji || '🎯')}
      </button>
      <input
        ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try { onChange(await readHabitImage(file)) } catch { /* not a usable image */ }
        }} />
      <button
        type="button"
        onClick={() => { if (image) onChange(undefined); else ref.current?.click() }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9B9180', fontSize: 10, fontFamily: 'inherit' }}>
        {image ? 'Remove' : 'Picture'}
      </button>
    </div>
  )
}

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

function QuantityControl({ value, goal, unit, onSet }: { value: number; goal?: number; unit?: string; onSet: (v: number) => void }) {
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
          {goal ? `${value} / ${goal}` : value}{unit ? ` ${unit}` : ''}
        </button>
      )}
      <button onClick={() => onSet(value + 1)}
        style={{ width: 22, height: 22, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #E8E1CE', background: '#FFFFFF', cursor: 'pointer', color: '#191712', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </span>
  )
}


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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', color: '#9B9180', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

function WallCard({ habit, todayDone, streak, qtyValue, onToggle, onIncrement, paletteIdx, isEditing, onEdit }: {
  habit: { id: string; name: string; emoji: string; type?: string; goal?: number; unit?: string; image?: string }
  todayDone: boolean
  streak: number
  qtyValue: number
  onToggle: () => void
  onIncrement: () => void
  paletteIdx: number
  isEditing?: boolean
  onEdit?: () => void
}) {
  const bgColor = WALL_PALETTE[paletteIdx % WALL_PALETTE.length]
  const isQty = habit.type === 'quantity'
  const _pct2 = isQty && habit.goal ? Math.min(100, Math.round((qtyValue / habit.goal) * 100)) : (todayDone ? 100 : 0); void _pct2
  const weekDots = Array.from({ length: 7 }, (_, i) => i < (streak % 7) ? '#191712' : '')

  return (
    <div style={{ display: 'flex', minWidth: 0, minHeight: 0, borderRadius: 18, overflow: 'hidden', border: '1px solid #E8E1CE', background: '#FFFFFF' }}>
      {/* Left: photo-style colored panel with gradient overlay */}
      <span style={{ position: 'relative', width: '66.6%', flexShrink: 0 }}>
        {/* Warm gradient fill simulating photo */}
        <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}CC 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {habit.image
            ? <img src={habit.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 52, opacity: 0.18 }}>{habit.emoji}</span>}
        </span>
        {/* Dark gradient overlay — lighter over a real picture, so it stays in colour */}
        <span style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: habit.image
            ? 'linear-gradient(180deg,rgba(25,23,18,.30) 0%,rgba(25,23,18,.02) 42%,rgba(25,23,18,.48) 100%)'
            : 'linear-gradient(180deg,rgba(25,23,18,.46) 0%,rgba(25,23,18,.10) 40%,rgba(25,23,18,.52) 100%)',
        }} />
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
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit() }}
              title="Edit habit"
              style={{
                marginLeft: 'auto', flexShrink: 0, width: 28, height: 28, borderRadius: 999,
                background: isEditing ? '#191712' : 'transparent', border: 'none', cursor: 'pointer', color: isEditing ? '#FDF8E7' : '#9B9180', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
        </span>
      </span>
    </div>
  )
}

// ─── Fill view card (12B) ─────────────────────────────────────────────────────

function FillCard({ habit, todayDone, streak, qtyValue, onToggle, onIncrement, onDecrement, paletteIdx, isSelected, onSelect }: {
  habit: { id: string; name: string; emoji: string; type?: string; goal?: number; unit?: string; image?: string }
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
  // A counter with a target shows progress towards it; one without a target has
  // no percentage to show, so the card reports the count instead.
  const hasGoal = isQty && !!habit.goal && habit.goal > 0
  const pct = hasGoal
    ? Math.min(100, Math.round((qtyValue / habit.goal!) * 100))
    : isQty ? (qtyValue > 0 ? 100 : 0) : (todayDone ? 100 : 0)
  const lastWeek = Array.from({ length: 7 }, (_, i) => i < (streak % 7))

  // 12D — drag-up gesture: track pointer drag to set fill level
  const dragRef = useRef<{ startY: number; startPct: number } | null>(null)
  const [dragPct, setDragPct] = useState<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  function handlePointerDown(e: React.PointerEvent) {
    if (!isSelected) return
    // A press on a control is not a drag — capturing it here swallowed the click
    if ((e.target as HTMLElement).closest('button,input,select,a')) return
    const card = cardRef.current
    if (!card) return
    dragRef.current = { startY: e.clientY, startPct: pct }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !isSelected) return
    const card = cardRef.current
    if (!card) return
    const h = card.clientHeight
    const dy = dragRef.current.startY - e.clientY  // positive = drag up
    const deltaPct = Math.round((dy / h) * 100)
    const newPct = Math.max(0, Math.min(100, dragRef.current.startPct + deltaPct))
    setDragPct(newPct)
  }
  function handlePointerUp() {
    if (dragRef.current && dragPct !== null && hasGoal) {
      const newQty = Math.round((dragPct / 100) * habit.goal!)
      if (newQty !== qtyValue) onIncrement()  // simplified: just increment once
    } else if (dragRef.current && dragPct !== null && !isQty) {
      if (dragPct >= 50 && !todayDone) onToggle()
      else if (dragPct < 50 && todayDone) onToggle()
    }
    dragRef.current = null
    setDragPct(null)
  }

  const displayPct = dragPct ?? pct

  // Cards keep their full colour whatever the progress — the flood, the bar and
  // the numbers say where you are; draining the colour just made them hard to read.
  const hasImage = !!habit.image

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'relative', flexShrink: 0, height: 520,
        width: isSelected ? 220 : 110,
        borderRadius: 16, overflow: 'hidden',
        border: isSelected ? '1px solid #191712' : '1px solid #E8E1CE',
        background: '#FFFFFF',
        boxShadow: isSelected ? '0 0 0 3px rgba(245,209,78,.45)' : 'none',
        cursor: isSelected ? (dragRef.current ? 'grabbing' : 'grab') : 'pointer',
        transition: 'width 0.3s ease',
        touchAction: 'none',
      }}
    >
      {/* Fill flood from bottom (12D) */}
      <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${displayPct}%`, background: `${bgColor}${hasImage ? '4D' : '88'}`, transition: dragRef.current ? 'none' : 'height 0.4s ease', display: 'block' }} />
      </span>
      {/* Background */}
      <span style={{ position: 'absolute', inset: 0 }}>
        <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}AA 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {habit.image
            ? <img src={habit.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 72, opacity: 0.25 }}>{habit.emoji}</span>}
        </span>
      </span>
      {/* Dark gradient */}
      <span style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
        background: hasImage
          ? 'linear-gradient(180deg,rgba(25,23,18,.34) 0%,rgba(25,23,18,0) 30%,rgba(25,23,18,.14) 58%,rgba(25,23,18,.78) 100%)'
          : 'linear-gradient(180deg,rgba(25,23,18,.52) 0%,rgba(25,23,18,.04) 34%,rgba(25,23,18,.30) 62%,rgba(25,23,18,.86) 100%)',
      }} />
      {/* Content */}
      <span style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', flexDirection: 'column', padding: '12px 11px' }}>
        {/* Top */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', borderRadius: 999, background: 'rgba(253,248,231,.16)', border: '1px solid rgba(253,248,231,.32)', color: '#FDF8E7', fontSize: 9.5, fontWeight: 700, alignSelf: 'flex-start', fontVariantNumeric: 'tabular-nums' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5"/></svg>
            {streak}d
          </span>
          <span style={{
            fontFamily: 'Outfit, sans-serif', fontSize: isSelected ? 15 : 12.5, fontWeight: 700,
            letterSpacing: '-0.02em', lineHeight: 1.18, color: '#FDF8E7',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{habit.name}</span>
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
                  {hasGoal
                    ? `of ${habit.goal} ${habit.unit ?? ''}`.trim()
                    : isQty ? 'no target — count as you go'
                    : todayDone ? 'logged today' : 'nothing yet'}
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                {/* Progress bar */}
                {(hasGoal || !isQty) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, height: 5, borderRadius: 999, background: 'rgba(253,248,231,.24)', overflow: 'hidden', display: 'block' }}>
                      <span style={{ display: 'block', width: `${displayPct}%`, height: '100%', background: '#F5D14E', borderRadius: 999, transition: dragRef.current ? 'none' : 'width 0.3s' }} />
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: '#FDF8E7', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{displayPct}%</span>
                  </span>
                )}
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
        </span>
      </span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── 10B: Habit detail panel ──────────────────────────────────────────────────
// Whatever view you are in, selecting a habit opens the same record: what it is,
// how it is going, and — for a counter — today's number with its controls.

function HabitDetailPanel({
  habit, hLogs, qtyToday, today, colors, onClose, onUpdate, onDelete, onToggleToday, onSetQuantity,
}: {
  habit: Habit
  colors: string[]
  hLogs: string[]
  qtyToday: number
  today: string
  onClose: () => void
  onUpdate: (patch: Partial<Habit>) => void
  onDelete: () => void
  onToggleToday: () => void
  onSetQuantity: (v: number) => void
}) {
  const isQty   = habit.type === 'quantity'
  const hasGoal = isQty && !!habit.goal && habit.goal > 0
  const doneToday = hLogs.includes(today)

  const streak = calcStreak(hLogs)
  const totalCheckIns = hLogs.length

  const bestStreak = (() => {
    if (hLogs.length === 0) return 0
    const sorted = [...hLogs].sort()
    let best = 1, cur = 1
    for (let i = 1; i < sorted.length; i++) {
      const diff = (new Date(sorted[i] + 'T12:00:00').getTime() - new Date(sorted[i - 1] + 'T12:00:00').getTime()) / 86400000
      if (diff === 1) { cur++; if (cur > best) best = cur } else cur = 1
    }
    return best
  })()

  const last30 = Array.from({ length: 30 }, (_, i) => offsetDays(today, -i))
  const completionRate = Math.round((last30.filter(d => hLogs.includes(d)).length / 30) * 100)
  const heatmapDays = Array.from({ length: 91 }, (_, i) => offsetDays(today, -(90 - i)))
  const recentCheckins = [...hLogs].sort().reverse().slice(0, 3)

  const pct = hasGoal ? Math.min(100, Math.round((qtyToday / habit.goal!) * 100)) : 0

  return (
    <div style={{
      width: 288, flexShrink: 0, background: '#FFFFFF', border: '1px solid #E8E1CE',
      borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 13,
      alignSelf: 'flex-start',
      // Stay inside the page: the shell scrolls the module, not this card
      maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', scrollbarWidth: 'thin',
    }}>
      {/* Header — picture, name, and what the habit is in one line */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <HabitImagePicker image={habit.image} emoji={habit.emoji} size={46}
          onChange={v => onUpdate({ image: v })} />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          <input
            value={habit.name}
            onChange={e => onUpdate({ name: e.target.value })}
            placeholder="Name this habit"
            style={{
              width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none',
              borderBottom: '1px solid transparent', outline: 'none', padding: '0 0 2px',
              fontSize: 14.5, fontWeight: 700, color: '#191712', fontFamily: 'inherit', textAlign: 'left',
            }}
            onFocus={e => { e.currentTarget.style.borderBottomColor = '#E8E1CE' }}
            onBlur={e => { e.currentTarget.style.borderBottomColor = 'transparent' }} />
          <div style={{ fontSize: 10.5, color: '#9B9180', marginTop: 2 }}>
            {habit.frequency ?? 'daily'}
            {isQty && ` · ${hasGoal ? `${habit.goal} ${habit.unit ?? 'times'} a day` : `counts ${habit.unit ?? 'times'}, no target`}`}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180', padding: 2, display: 'flex' }}>
          <X size={14} />
        </button>
      </div>

      {/* What kind of habit this is */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 6 }}>TRACK AS</div>
        <div style={{ display: 'flex', gap: 5 }}>
          {(['boolean', 'quantity'] as const).map(t => (
            <button key={t} onClick={() => onUpdate({ type: t })}
              style={{ flex: 1, padding: '5px 0', borderRadius: 7, border: '1px solid #E8E1CE', background: (habit.type ?? 'boolean') === t ? '#191712' : '#FAF7EC', color: (habit.type ?? 'boolean') === t ? '#FDF8E7' : '#6C6553', fontSize: 10, fontWeight: (habit.type ?? 'boolean') === t ? 600 : 400, cursor: 'pointer' }}>
              {t === 'boolean' ? 'Done / not done' : 'A count'}
            </button>
          ))}
        </div>
      </div>

      {/* Icon and colour — what the wall and fill cards use */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 6 }}>ICON &amp; COLOUR</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EmojiBtn value={habit.emoji} onSelect={v => onUpdate({ emoji: v })} />
          <input
            value={habit.emoji}
            onChange={e => onUpdate({ emoji: [...e.target.value].slice(-2).join('') })}
            title="Type or paste any emoji"
            style={{
              width: 46, boxSizing: 'border-box', textAlign: 'center', background: '#FAF7EC',
              border: '1px solid #E8E1CE', borderRadius: 7, padding: '3px 0', fontSize: 12.5,
              color: '#191712', outline: 'none', fontFamily: 'inherit',
            }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {colors.slice(0, 12).map(c => (
              <button key={c} onClick={() => onUpdate({ color: c })} title={c}
                style={{
                  width: 15, height: 15, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                  border: habit.color === c ? '2px solid #191712' : '1px solid rgba(25,23,18,.12)',
                }} />
            ))}
          </div>
        </div>
      </div>

      {/* Today — the one thing you came here to change */}
      <div style={{ background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 12, padding: '12px 13px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 9 }}>TODAY</div>
        {isQty ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => onSetQuantity(Math.max(0, qtyToday - 1))} disabled={qtyToday === 0}
                style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid #E8E1CE', background: '#FFFFFF', color: '#6C6553', fontSize: 17, lineHeight: 1, cursor: qtyToday === 0 ? 'default' : 'pointer', opacity: qtyToday === 0 ? 0.4 : 1, flexShrink: 0 }}>−</button>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: '#191712', lineHeight: 1 }}>
                  {qtyToday}{hasGoal && <span style={{ fontSize: 15, color: '#9B9180' }}> / {habit.goal}</span>}
                </span>
                <div style={{ fontSize: 10.5, color: '#9B9180', marginTop: 2 }}>{habit.unit ?? 'times'}</div>
              </div>
              <button onClick={() => onSetQuantity(qtyToday + 1)}
                style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid #E8E1CE', background: '#FFFFFF', color: '#191712', fontSize: 17, lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}>+</button>
            </div>
            {hasGoal && (
              <div style={{ height: 6, borderRadius: 999, background: '#EDE7D9', marginTop: 11, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#5F7038' : habit.color, borderRadius: 999 }} />
              </div>
            )}
          </>
        ) : (
          <button onClick={onToggleToday}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 9, cursor: 'pointer',
              border: `1px solid ${doneToday ? '#5F7038' : '#E8E1CE'}`,
              background: doneToday ? '#5F7038' : '#FFFFFF',
              color: doneToday ? '#FFFFFF' : '#6C6553', fontSize: 12.5, fontWeight: 600,
            }}>
            {doneToday ? 'Done today' : 'Mark done today'}
          </button>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
        {[
          { label: 'Streak', value: `${streak}d`, color: streak > 0 ? '#5F7038' : '#191712' },
          { label: 'Best', value: `${bestStreak}d`, color: '#191712' },
          { label: 'Total', value: `${totalCheckIns}`, color: '#191712' },
          { label: '30-day', value: `${completionRate}%`, color: completionRate >= 70 ? '#5F7038' : '#191712' },
        ].map(st => (
          <div key={st.label} style={{ background: '#FAF7EC', borderRadius: 9, padding: '7px 8px', minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 17, fontWeight: 700, letterSpacing: '-0.03em', color: st.color, lineHeight: 1 }}>{st.value}</div>
            <div style={{ fontSize: 9, color: '#9B9180', marginTop: 3, fontWeight: 600 }}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* 6-month heatmap */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 6 }}>LAST 13 WEEKS</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(13, 1fr)', gap: 2 }}>
          {heatmapDays.map(d => {
            const done = hLogs.includes(d)
            const isT = d === today
            return (
              <div key={d} title={d} style={{
                aspectRatio: '1', borderRadius: 2,
                background: done ? '#5F7038' : isT ? '#F5D14E22' : '#F0EBDC',
                border: isT ? '1px solid #F5D14E' : '1px solid transparent',
              }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
          <span style={{ fontSize: 9, color: '#9B9180' }}>13 weeks ago</span>
          <span style={{ fontSize: 9, color: '#9B9180' }}>Today</span>
        </div>
      </div>

      {/* Cadence */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 6 }}>CADENCE</div>
        <div style={{ display: 'flex', gap: 5 }}>
          {FREQ_OPTS.map(f => (
            <button key={f} onClick={() => onUpdate({ frequency: f })}
              style={{ flex: 1, padding: '5px 0', borderRadius: 7, border: '1px solid #E8E1CE', background: habit.frequency === f ? '#191712' : '#FAF7EC', color: habit.frequency === f ? '#FDF8E7' : '#6C6553', fontSize: 10, fontWeight: habit.frequency === f ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
              {f === 'weekdays' ? 'Wkdays' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Target — only a counter has one to set */}
      {isQty && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 6 }}>DAILY TARGET</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number" min={0} defaultValue={habit.goal ?? ''} key={habit.id + String(habit.goal)}
              placeholder="none"
              onBlur={e => {
                const n = parseFloat(e.target.value)
                onUpdate({ goal: Number.isFinite(n) && n > 0 ? n : undefined })
              }}
              style={{ width: 78, boxSizing: 'border-box', background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#191712', outline: 'none', textAlign: 'left' }} />
            <input
              defaultValue={habit.unit ?? ''} key={habit.id + (habit.unit ?? '')}
              placeholder="unit"
              onBlur={e => onUpdate({ unit: e.target.value.trim() || undefined })}
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#191712', outline: 'none', textAlign: 'left' }} />
          </div>
          <div style={{ fontSize: 10, color: '#9B9180', marginTop: 5 }}>
            {hasGoal ? 'Cards show progress towards this target.' : 'No target — cards show the running count.'}
          </div>
        </div>
      )}

      {/* Recent check-ins */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 7 }}>RECENT CHECK-INS</div>
        {recentCheckins.length === 0 ? (
          <div style={{ fontSize: 11.5, color: '#9B9180' }}>No logs yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {recentCheckins.map(d => (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #F0EBDC' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: '#5F7038', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#191712', fontWeight: 500 }}>
                  {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Archive / Delete */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => { onUpdate({ isActive: false }); onClose() }}
          style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid #E8E1CE', background: 'transparent', color: '#9B9180', fontSize: 11.5, cursor: 'pointer' }}>
          Archive
        </button>
        <button onClick={() => { onDelete(); onClose() }}
          style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid rgba(180,82,58,0.3)', background: 'rgba(180,82,58,0.06)', color: '#B4523A', fontSize: 11.5, cursor: 'pointer' }}>
          Delete
        </button>
      </div>
    </div>
  )
}

export function HabitsModule() {
  const HABIT_COLORS = getHabitColors()

  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDelete, reorderHabits } = useHabitsStore()
  const [logs,    setLogs]    = useState(loadLogs)
  const [qtyLogs, setQtyLogs] = useState(loadQuantityLogs)

  // Week navigation: anchor to Monday of current week
  const today = todayKey()
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(today))
  const days = weekDays(weekAnchor)

  const dragHabitIdx = useRef<number | null>(null)
  // The view you last chose wins; Settings only decides where a fresh browser starts
  const [view, setView] = useState<HabitView>(() => loadHabitView())
  useEffect(() => {
    const h = () => setView(loadHabitView())
    window.addEventListener('professor:habitViewUpdated', h)
    return () => window.removeEventListener('professor:habitViewUpdated', h)
  }, [])
  const [fillSelected, setFillSelected] = useState<string | null>(null)
  const [wallEditId, setWallEditId] = useState<string | null>(null)
  const [detailHabitId, setDetailHabitId] = useState<string | null>(null)

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
  const detailHabit = detailHabitId ? activeHabits.find(h => h.id === detailHabitId) ?? null : null

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

  /** A new habit is a real habit straight away: a box appears in the view you
   *  are in, and its record opens on the right for you to fill in. */
  function createHabit() {
    const id = storeAdd({
      name: 'New habit',
      emoji: '🎯',
      color: HABIT_COLORS[habits.length % HABIT_COLORS.length],
      frequency: 'daily',
      isActive: true,
      type: 'boolean',
    })
    setFillSelected(id)
    setWallEditId(null)
    setDetailHabitId(id)
  }

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
              <button key={v.id} onClick={() => { setView(v.id); saveHabitView(v.id) }} style={{
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
          <button onClick={createHabit}
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

      {/* ─── Views + the habit record they all share ───────────────────────── */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>

      {/* ─── Wall view (12A) ────────────────────────────────────────────────── */}
      {view === 'wall' && (
        <div style={{ display: 'flex', gap: 14, minHeight: 0 }}>
          {/* Wall grid — 3 cols, shrinks to 2 when edit panel is open */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: wallEditId ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gridAutoRows: '220px', gap: 14, alignContent: 'start' }}>
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
                  isEditing={wallEditId === habit.id}
                  onToggle={() => toggleHabit(habit.id, today)}
                  onIncrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, today, qtyValue + 1)}
                  onEdit={() => setWallEditId(id => id === habit.id ? null : habit.id)}
                />
              )
            })}
            {activeHabits.length === 0 && (
              <div style={{ gridColumn: '1/-1', padding: 32, textAlign: 'center', color: '#6C6553', fontSize: 13 }}>
                No habits yet. Click "New habit" to get started.
              </div>
            )}
          </div>

          {/* 12C — Edit panel */}
          {wallEditId && (() => {
            const h = activeHabits.find(x => x.id === wallEditId)
            if (!h) return null
            return (
              <div style={{ width: 280, flexShrink: 0, background: '#FCFAF4', border: '1px solid #E8E1CE', borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 28 }}>{h.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: '#9B9180', marginTop: 2 }}>{h.frequency ?? 'daily'}</div>
                  </div>
                  <button onClick={() => setWallEditId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180', padding: 3, display: 'flex' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>

                {/* Quick fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <FieldRow label="Name">
                    <input defaultValue={h.name} onBlur={e => updateHabit(h.id, { name: e.target.value })}
                      style={{ width: '100%', boxSizing: 'border-box', background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 7, padding: '6px 9px', fontSize: 13, color: '#191712', outline: 'none' }} />
                  </FieldRow>
                  <FieldRow label="Frequency">
                    <div style={{ display: 'flex', gap: 5 }}>
                      {FREQ_OPTS.map(f => (
                        <button key={f} onClick={() => updateHabit(h.id, { frequency: f })}
                          style={{ flex: 1, padding: '5px 0', borderRadius: 7, border: '1px solid #E8E1CE', background: h.frequency === f ? '#191712' : '#FAF7EC', color: h.frequency === f ? '#FDF8E7' : '#6C6553', fontSize: 11, fontWeight: h.frequency === f ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                          {f === 'weekdays' ? 'Weekdays' : f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                  </FieldRow>
                  {h.type === 'quantity' && (
                    <FieldRow label="Daily goal">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <input type="number" defaultValue={h.goal ?? 1} onBlur={e => updateHabit(h.id, { goal: parseInt(e.target.value) || 1 })}
                          style={{ width: 72, background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 7, padding: '6px 9px', fontSize: 13, color: '#191712', outline: 'none' }} />
                        <span style={{ fontSize: 12, color: '#9B9180' }}>{h.unit ?? 'times'}</span>
                      </div>
                    </FieldRow>
                  )}
                </div>

                {/* Archive / delete */}
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={() => { updateHabit(h.id, { isActive: false }); setWallEditId(null) }}
                    style={{ padding: '7px 0', borderRadius: 8, border: '1px solid #E8E1CE', background: 'transparent', color: '#9B9180', fontSize: 12, cursor: 'pointer' }}>
                    Archive habit
                  </button>
                  <button onClick={() => { deleteHabit(h.id); setWallEditId(null) }}
                    style={{ padding: '7px 0', borderRadius: 8, border: '1px solid rgba(180,82,58,0.3)', background: 'rgba(180,82,58,0.06)', color: '#B4523A', fontSize: 12, cursor: 'pointer' }}>
                    Delete habit
                  </button>
                </div>
              </div>
            )
          })()}
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
                onSelect={() => { setFillSelected(habit.id); setDetailHabitId(habit.id) }}
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
      {view === 'table' && <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

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
        {activeHabits.length === 0 && (
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

              {/* Habit name — click to open detail panel */}
              <span
                onClick={() => setDetailHabitId(id => id === habit.id ? null : habit.id)}
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
              >
                <InlineEdit value={habit.name} onSave={v => updateHabit(habit.id, { name: v })}
                  style={{ fontSize: 13, fontWeight: 600, color: detailHabitId === habit.id ? '#B4853A' : '#191712', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, width: '100%' }} />
              </span>

              {/* Quantity control for measurable habits */}
              {isQuantity && (
                <QuantityControl
                  value={qtyLogs[habit.id]?.[today] ?? 0}
                  goal={habit.goal}
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
      </div>

      </div>}

      </div>

      {detailHabit && (
        <HabitDetailPanel
          key={detailHabit.id}
          habit={detailHabit}
          hLogs={logs[detailHabit.id] ?? []}
          qtyToday={qtyLogs[detailHabit.id]?.[today] ?? 0}
          today={today}
          colors={HABIT_COLORS}
          onClose={() => setDetailHabitId(null)}
          onUpdate={patch => updateHabit(detailHabit.id, patch)}
          onDelete={() => deleteHabit(detailHabit.id)}
          onToggleToday={() => toggleHabit(detailHabit.id, today)}
          onSetQuantity={v => setQuantity(detailHabit.id, detailHabit.goal ?? 1, today, v)}
        />
      )}
      </div>

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
