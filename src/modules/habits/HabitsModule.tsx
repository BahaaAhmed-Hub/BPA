import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useHabitsStore, loadLogs, saveLogs, loadQuantityLogs, saveQuantityLogs,
  calcStreak, getHabitColors,
  type HabitLogs, type Habit,
} from '@/store/habitsStore'
import { saveHabitLogsToDB } from '@/lib/dbSync'
import { markLocalWrite } from '@/lib/liveSync'

let logsDbTimer: ReturnType<typeof setTimeout> | null = null
function scheduleLogsSync(logs: HabitLogs) {
  markLocalWrite('habits')
  if (logsDbTimer) clearTimeout(logsDbTimer)
  logsDbTimer = setTimeout(() => {
    markLocalWrite('habits')
    // Read at push time: the quantity map was written synchronously by whoever
    // scheduled this, so localStorage is the one copy that is certainly current.
    void saveHabitLogsToDB(logs, loadQuantityLogs()).catch(() => { /* offline */ })
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
/** What stands in for a habit's picture when there isn't one.
 *
 *  The emoji was drawn straight, which is wrong for the tick and cross people
 *  use as habit icons: a 52px ✅ behind the words "Not done" reads as a state,
 *  not as decoration, and on a device that has no pictures every card became a
 *  wall of green ticks. A status glyph is replaced by the habit's initial. */
const STATUS_GLYPHS = /[\u2705\u274C\u2714\u2716\u274E\u2717\u2718\u2713\u2611\u2612\uFE0F]/u

function pictureStandIn(habit: { emoji?: string; name: string }): string {
  const emoji = habit.emoji ?? ''
  if (!emoji || STATUS_GLYPHS.test(emoji)) {
    return habit.name.trim().charAt(0).toUpperCase() || '·'
  }
  return emoji
}

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
      <span style={{ position: 'relative', display: 'inline-flex' }}>
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
        {image && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            title="Remove picture"
            style={{
              position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%',
              padding: 0, cursor: 'pointer', background: '#191712', border: '2px solid #FFFFFF',
              color: '#FDF8E7', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <X size={9} strokeWidth={3} />
          </button>
        )}
      </span>
      <input
        ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try { onChange(await readHabitImage(file)) } catch { /* not a usable image */ }
        }} />
      {!image && <span style={{ color: '#9B9180', fontSize: 10 }}>Picture</span>}
    </div>
  )
}

export function EmojiBtn({ value, onSelect, size = 24 }: {
  value: string
  onSelect: (e: string) => void
  /** The button's edge; the popover is the same either way. */
  size?: number
}) {
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
        style={{ width: size, height: size, borderRadius: size >= 40 ? 13 : 7, background: '#FAF7EC', border: '1px solid #E8E1CE', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.52) }}>
        {value}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: size + 6, left: 0, zIndex: 300, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10, padding: '8px', display: 'flex', gap: 4, flexWrap: 'wrap', width: 252, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
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


/** The one way to log a habit from a card: a done toggle, or − N + for a count.
 *  Wall and fill cards both use it, so logging feels the same wherever you are. */
function HabitLogControl({ isQty, todayDone, qtyValue, unit, tone, isToday = true, onToggle, onIncrement, onDecrement }: {
  isQty: boolean
  todayDone: boolean
  /** False when the card is showing a day other than today. */
  isToday?: boolean
  qtyValue: number
  unit?: string
  /** 'light' sits on a photo; 'dark' sits on white. */
  tone: 'light' | 'dark'
  onToggle: () => void
  onIncrement: () => void
  onDecrement: () => void
}) {
  const light = tone === 'light'
  const track: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, height: 34, boxSizing: 'border-box',
    width: '100%', padding: 3, borderRadius: 999, minWidth: 0,
    background: light ? 'rgba(253,248,231,.16)' : '#FAF7EC',
    border: `1px solid ${light ? 'rgba(253,248,231,.4)' : '#E8E1CE'}`,
    ...(light ? { backdropFilter: 'blur(6px)' } : {}),
  }
  const round: React.CSSProperties = {
    width: 28, height: 28, flexShrink: 0, borderRadius: 999, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  }
  const ink = light ? '#FDF8E7' : '#191712'

  if (!isQty) {
    return (
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        style={{
          ...track, justifyContent: 'center', gap: 7, cursor: 'pointer', fontFamily: 'inherit',
          background: todayDone ? (light ? 'rgba(253,248,231,.9)' : '#0C8140') : track.background,
          border: todayDone ? '1px solid transparent' : track.border,
          color: todayDone ? (light ? '#191712' : '#FDF8E7') : ink,
          fontSize: 11.5, fontWeight: 700,
        }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
        {todayDone ? (isToday ? 'Done today' : 'Done') : (isToday ? 'Mark done' : 'Mark done')}
      </button>
    )
  }

  return (
    <span style={track}>
      <button
        onClick={e => { e.stopPropagation(); onDecrement() }}
        disabled={qtyValue === 0}
        style={{
          ...round,
          background: light ? 'rgba(253,248,231,.2)' : '#FFFFFF',
          border: `1px solid ${light ? 'rgba(253,248,231,.34)' : '#E8E1CE'}`,
          color: ink, opacity: qtyValue === 0 ? 0.45 : 1,
          cursor: qtyValue === 0 ? 'default' : 'pointer',
        }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
      </button>
      <span style={{
        flex: 1, minWidth: 0, textAlign: 'center', color: ink,
        fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{qtyValue}{unit ? ` ${unit}` : ''}</span>
      <button
        onClick={e => { e.stopPropagation(); onIncrement() }}
        style={{
          ...round,
          background: light ? '#FDF8E7' : '#191712',
          border: 'none', color: light ? '#191712' : '#FDF8E7',
        }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </span>
  )
}

function WallCard({ habit, todayDone, streak, qtyValue, onToggle, onIncrement, onDecrement, paletteIdx, isToday = true, isSelected, onSelect }: {
  habit: { id: string; name: string; emoji: string; type?: string; goal?: number; unit?: string; image?: string }
  todayDone: boolean
  streak: number
  qtyValue: number
  onToggle: () => void
  onIncrement: () => void
  onDecrement: () => void
  paletteIdx: number
  /** False when the view is showing a day other than today. */
  isToday?: boolean
  isSelected?: boolean
  onSelect?: () => void
}) {
  const bgColor = WALL_PALETTE[paletteIdx % WALL_PALETTE.length]
  const isQty = habit.type === 'quantity'
  const _pct2 = isQty && habit.goal ? Math.min(100, Math.round((qtyValue / habit.goal) * 100)) : (todayDone ? 100 : 0); void _pct2

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', minWidth: 0, minHeight: 0, borderRadius: 18, overflow: 'hidden',
        border: isSelected ? '1px solid #191712' : '1px solid #E8E1CE', background: '#FFFFFF',
        boxShadow: isSelected ? '0 0 0 3px rgba(245,209,78,.45)' : 'none',
        cursor: onSelect ? 'pointer' : 'default',
      }}>
      {/* Left: photo-style colored panel with gradient overlay */}
      <span style={{ position: 'relative', width: '66.6%', flexShrink: 0 }}>
        {/* Warm gradient fill simulating photo */}
        <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}CC 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {habit.image
            ? <img src={habit.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 52, opacity: 0.18, fontWeight: 700 }}>{pictureStandIn(habit)}</span>}
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
            {isQty && habit.goal ? `of ${habit.goal} ${habit.unit ?? ''}` : (todayDone ? (isToday ? 'logged today' : 'logged that day') : 'not yet done')}
          </span>
        </span>
        {/* Log it — the same control the fill cards use */}
        <span style={{ marginTop: 'auto', display: 'block' }}>
          <HabitLogControl
            isQty={isQty}
            todayDone={todayDone}
            qtyValue={qtyValue}
            unit={habit.unit}
            tone="dark"
            isToday={isToday}
            onToggle={onToggle}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
          />
        </span>
      </span>
    </div>
  )
}

// ─── Fill view card (12B) ─────────────────────────────────────────────────────

function FillCard({ habit, todayDone, streak, qtyValue, onToggle, onIncrement, onDecrement, paletteIdx, isToday = true, isSelected, onSelect }: {
  habit: { id: string; name: string; emoji: string; type?: string; goal?: number; unit?: string; image?: string }
  todayDone: boolean
  /** False when the view is showing a day other than today. */
  isToday?: boolean
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
        position: 'relative', height: 520,
        // Cards divide the row between them; the open one takes the larger share
        flex: isSelected ? '2.4 1 0' : '1 1 0',
        minWidth: isSelected ? 190 : 92,
        borderRadius: 16, overflow: 'hidden',
        border: isSelected ? '1px solid #191712' : '1px solid #E8E1CE',
        background: '#FFFFFF',
        boxShadow: isSelected ? '0 0 0 3px rgba(245,209,78,.45)' : 'none',
        cursor: isSelected ? (dragRef.current ? 'grabbing' : 'grab') : 'pointer',
        transition: 'flex 0.3s ease, min-width 0.3s ease',
        touchAction: 'none',
      }}
    >
      {/* Fill flood from bottom (12D) — a count fills, a yes/no habit does not */}
      {isQty && (
        <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
          <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${displayPct}%`, background: `${bgColor}${hasImage ? '4D' : '88'}`, display: 'block' }} />
        </span>
      )}
      {/* Background */}
      <span style={{ position: 'absolute', inset: 0 }}>
        <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}AA 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {habit.image
            ? <img src={habit.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 72, opacity: 0.25, fontWeight: 700 }}>{pictureStandIn(habit)}</span>}
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
        {/* Bottom — where you are stands on every card; the controls come with
            the card you open */}
        <span style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span style={{
              fontFamily: 'Outfit, sans-serif', fontSize: isSelected ? 24 : 18, fontWeight: 700,
              letterSpacing: '-0.03em', lineHeight: 1.1, color: '#FDF8E7', fontVariantNumeric: 'tabular-nums',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isQty ? `${qtyValue}${habit.unit ? ' ' + habit.unit : ''}` : (todayDone ? 'Done' : 'Not done')}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(253,248,231,.78)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hasGoal
                ? `of ${habit.goal} ${habit.unit ?? ''}`.trim()
                : isQty ? 'no target — count as you go'
                : todayDone ? (isToday ? 'logged today' : 'logged that day') : 'nothing yet'}
            </span>
          </span>

          {hasGoal && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, height: 5, borderRadius: 999, background: 'rgba(253,248,231,.24)', overflow: 'hidden', display: 'block' }}>
                <span style={{ display: 'block', width: `${displayPct}%`, height: '100%', background: '#F5D14E', borderRadius: 999 }} />
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: '#FDF8E7', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{displayPct}%</span>
            </span>
          )}

          {isSelected && (
            <HabitLogControl
              isQty={isQty}
              todayDone={todayDone}
              qtyValue={qtyValue}
              unit={habit.unit}
              tone="light"
              isToday={isToday}
              onToggle={onToggle}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
            />
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
  habit, hLogs, qtyToday, today, onClose, onUpdate, onToggleToday, onSetQuantity,
}: {
  habit: Habit
  hLogs: string[]
  qtyToday: number
  today: string
  onClose: () => void
  onUpdate: (patch: Partial<Habit>) => void
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

  const pct = hasGoal ? Math.min(100, Math.round((qtyToday / habit.goal!) * 100)) : 0

  return (
    <div style={{
      width: 288, flexShrink: 0, background: '#FFFFFF', border: '1px solid #E8E1CE',
      borderRadius: 18, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 10,
      alignSelf: 'flex-start',
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

      {/* Its icon — the colour comes with the habit and needs no picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <EmojiBtn value={habit.emoji} onSelect={v => onUpdate({ emoji: v })} size={32} />
      </div>

      {/* Today — the one thing you came here to change */}
      <div style={{ background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 12, padding: '12px 13px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 9 }}>
          {today === todayKey()
            ? 'TODAY'
            : new Date(today + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase()}
        </div>
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
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#0C8140' : habit.color, borderRadius: 999 }} />
              </div>
            )}
          </>
        ) : (
          <button onClick={onToggleToday}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 9, cursor: 'pointer',
              border: `1px solid ${doneToday ? '#0C8140' : '#E8E1CE'}`,
              background: doneToday ? '#0C8140' : '#FFFFFF',
              color: doneToday ? '#FFFFFF' : '#6C6553', fontSize: 12.5, fontWeight: 600,
            }}>
            {doneToday ? 'Done today' : 'Mark done today'}
          </button>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
        {[
          { label: 'Streak', value: `${streak}d`, color: streak > 0 ? '#0C8140' : '#191712' },
          { label: 'Best', value: `${bestStreak}d`, color: '#191712' },
          { label: 'Total', value: `${totalCheckIns}`, color: '#191712' },
          { label: '30-day', value: `${completionRate}%`, color: completionRate >= 70 ? '#0C8140' : '#191712' },
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(13, 1fr)', gridAutoRows: 11, gap: 2 }}>
          {heatmapDays.map(d => {
            const done = hLogs.includes(d)
            const isT = d === today
            return (
              <div key={d} title={d} style={{
                borderRadius: 2,
                background: done ? '#0C8140' : isT ? '#F5D14E22' : '#F0EBDC',
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

  // Preferences pulled from the server land after this page has already read
  // localStorage, so without this the counts only appeared on the next reload.
  useEffect(() => {
    const h = (e: Event) => {
      const keys = (e as CustomEvent<string[]>).detail ?? []
      if (keys.includes('professor-habit-quantity-logs')) setQtyLogs(loadQuantityLogs())
    }
    window.addEventListener('professor:prefsRestored', h)
    return () => window.removeEventListener('professor:prefsRestored', h)
  }, [])

  // A tick made on the other device arrives through the store, which writes
  // localStorage — this state was read on mount and would not notice.
  useEffect(() => {
    const h = () => { setLogs(loadLogs()); setQtyLogs(loadQuantityLogs()) }
    window.addEventListener('professor:habitLogsUpdated', h)
    return () => window.removeEventListener('professor:habitLogsUpdated', h)
  }, [])
  const [fillSelected, setFillSelected] = useState<string | null>(null)
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
      const next = met === hasDone
        ? prev
        : { ...prev, [habitId]: met ? [...existing, day] : existing.filter(x => x !== day) }
      // Always push. Changing 3 glasses to 4 does not cross the goal and so
      // did not touch the tick — and used to sync nowhere as a result.
      if (next !== prev) saveLogs(next)
      scheduleLogsSync(next)
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
    setDetailHabitId(id)
  }

  // The summary reads one day at a time. Today until you click another bar.
  const [selectedDay, setSelectedDay] = useState(today)
  const dayDone = activeHabits.filter(h => (logs[h.id] ?? []).includes(selectedDay)).length
  const isToday = selectedDay === today
  const selectedLabel = new Date(selectedDay + 'T12:00:00')
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

  /** Step the week, keeping the same weekday selected. */
  function stepWeek(delta: number) {
    const nextAnchor = offsetDays(weekAnchor, delta * 7)
    setWeekAnchor(nextAnchor)
    setSelectedDay(offsetDays(selectedDay, delta * 7))
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
        {/* Progress ring — for the day you are looking at */}
        <ProgressRing done={dayDone} total={totalActive} />

        {/* Status text */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#191712', whiteSpace: 'nowrap' }}>
            {totalActive === 0 ? 'No habits yet'
              : dayDone === totalActive ? 'All habits complete! 🎉'
              : dayDone === 0 ? (isToday ? 'Nothing logged yet today' : 'Nothing logged that day')
              : `${dayDone} of ${totalActive} done`}
          </span>
          <span style={{ fontSize: 10.5, color: '#6C6553', whiteSpace: 'nowrap' }}>
            {totalActive === 0 ? 'Add your first habit below'
              : isToday ? `Resets at midnight · ${totalActive - dayDone} remaining`
              : selectedLabel}
          </span>
        </span>

        {/* Divider */}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#F0EBDC', margin: '0 4px' }} />

        {/* Week bars — click a day to read it, arrows to walk the weeks */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <button onClick={() => stepWeek(-1)} title="Previous week"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180', padding: 2, display: 'flex' }}>
            <ChevronLeft size={14} />
          </button>

          <span style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
            {days.map((d, i) => {
              const pct = weekBars[i]
              const isT = d === today
              const on = d === selectedDay
              const future = d > today
              const dayLabel = ['S','M','T','W','T','F','S'][new Date(d + 'T12:00:00').getDay()]
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDay(d)}
                  title={new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    opacity: future ? 0.45 : 1, fontFamily: 'inherit',
                  }}>
                  <span style={{
                    width: 12, height: 34, borderRadius: 3, background: '#F3EEE0',
                    display: 'flex', alignItems: 'flex-end', overflow: 'hidden',
                    outline: on ? '2px solid #191712' : 'none', outlineOffset: 2,
                  }}>
                    <span style={{ width: '100%', height: `${Math.round(pct * 100)}%`, background: isT ? '#F5D14E' : '#191712', borderRadius: 3, display: 'block' }} />
                  </span>
                  <span style={{ fontSize: 8.5, color: on || isT ? '#191712' : '#6C6553', fontWeight: on || isT ? 700 : 500 }}>{dayLabel}</span>
                </button>
              )
            })}
          </span>

          <button onClick={() => stepWeek(1)} disabled={isCurrentWeek} title="Next week"
            style={{ background: 'none', border: 'none', cursor: isCurrentWeek ? 'default' : 'pointer', color: '#9B9180', padding: 2, display: 'flex', opacity: isCurrentWeek ? 0.3 : 1 }}>
            <ChevronRight size={14} />
          </button>
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
            <span style={{ fontSize: 9.5, color: coldDays > 0 ? '#C62828' : '#6C6553' }}>
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
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: detailHabitId ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gridAutoRows: '220px', gap: 14, alignContent: 'start' }}>
            {activeHabits.map((habit, i) => {
              const habitLogs   = logs[habit.id] ?? []
              const todayDoneH  = habitLogs.includes(selectedDay)
              const streak      = calcStreak(habitLogs)
              const isQuantity  = habit.type === 'quantity'
              const qtyValue    = isQuantity ? (qtyLogs[habit.id]?.[selectedDay] ?? 0) : 0
              return (
                <WallCard
                  key={habit.id}
                  habit={habit}
                  todayDone={todayDoneH}
                  streak={streak}
                  qtyValue={qtyValue}
                  paletteIdx={i}
                  isToday={selectedDay === today}
                  isSelected={detailHabitId === habit.id}
                  onSelect={() => setDetailHabitId(id => id === habit.id ? null : habit.id)}
                  onToggle={() => toggleHabit(habit.id, selectedDay)}
                  onIncrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, selectedDay, qtyValue + 1)}
                  onDecrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, selectedDay, Math.max(0, qtyValue - 1))}
                />
              )
            })}
            {activeHabits.length === 0 && (
              <div style={{ gridColumn: '1/-1', padding: 32, textAlign: 'center', color: '#6C6553', fontSize: 13 }}>
                No habits yet. Click "New habit" to get started.
              </div>
            )}
          </div>

        </div>
      )}

      {/* ─── Fill view (12B) ────────────────────────────────────────────────── */}
      {view === 'fill' && (
        <div style={{ display: 'flex', gap: 8, minWidth: 0, minHeight: 520, padding: '4px 0 8px' }}>
          {activeHabits.map((habit, i) => {
            const habitLogs   = logs[habit.id] ?? []
            const todayDoneH  = habitLogs.includes(selectedDay)
            const streak      = calcStreak(habitLogs)
            const isQuantity  = habit.type === 'quantity'
            const qtyValue    = isQuantity ? (qtyLogs[habit.id]?.[selectedDay] ?? 0) : 0
            const isSelected  = (fillSelected ?? activeHabits[0]?.id) === habit.id
            return (
              <FillCard
                key={habit.id}
                habit={habit}
                todayDone={todayDoneH}
                streak={streak}
                qtyValue={qtyValue}
                paletteIdx={i}
                isToday={selectedDay === today}
                isSelected={isSelected}
                onSelect={() => { setFillSelected(habit.id); setDetailHabitId(habit.id) }}
                onToggle={() => toggleHabit(habit.id, selectedDay)}
                onIncrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, selectedDay, qtyValue + 1)}
                onDecrement={() => isQuantity && setQuantity(habit.id, habit.goal ?? 1, selectedDay, Math.max(0, qtyValue - 1))}
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
          const todayDoneH = habitLogs.includes(selectedDay)
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
              <button onClick={() => toggleHabit(habit.id, selectedDay)} title={todayDoneH ? 'Mark undone' : 'Mark done'}
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
                  value={qtyLogs[habit.id]?.[selectedDay] ?? 0}
                  goal={habit.goal}
                  unit={habit.unit}
                  onSet={v => setQuantity(habit.id, habit.goal ?? 1, selectedDay, v)}
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
          qtyToday={qtyLogs[detailHabit.id]?.[selectedDay] ?? 0}
          today={selectedDay}
          onClose={() => setDetailHabitId(null)}
          onUpdate={patch => updateHabit(detailHabit.id, patch)}
          onToggleToday={() => toggleHabit(detailHabit.id, selectedDay)}
          onSetQuantity={v => setQuantity(detailHabit.id, detailHabit.goal ?? 1, selectedDay, v)}
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
