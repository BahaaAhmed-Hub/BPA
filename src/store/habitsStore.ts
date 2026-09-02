/**
 * Unified habit store — single source of truth for habits.
 * Uses Zustand so both Settings and HabitsModule share live reactive state.
 * localStorage key: 'professor-habits'
 */
import { create } from 'zustand'
import { loadHabitsFromDB, loadHabitLogsFromDB, saveHabitsToDB, saveHabitLogsToDB } from '@/lib/dbSync'
import { reportSyncGap } from '@/lib/syncStatus'

export interface Habit {
  id: string
  name: string
  emoji: string
  color: string
  frequency: 'daily' | 'weekdays' | 'weekly'
  isActive: boolean
  archived?: boolean
  createdAt: string
  type: 'boolean' | 'quantity'
  goal?: number   // target quantity (e.g. 8)
  unit?: string   // display unit (e.g. "glasses", "miles", "min")
  /** A picture for the habit, as a data URL. The wall and fill cards use it
   *  in place of the generated colour panel. */
  image?: string
}

export interface HabitLogs {
  [habitId: string]: string[]  // array of "YYYY-MM-DD" dates
}

// Numeric values per day for quantity habits
export type HabitQuantityLogs = { [habitId: string]: { [dateKey: string]: number } }

const HABITS_KEY   = 'professor-habits'
const LOGS_KEY     = 'professor-habit-logs'
const QTY_LOGS_KEY = 'professor-habit-quantity-logs'

const DEFAULT_COLORS = [
  // Blues & Purples
  '#1E40AF','#3B82F6','#60A5FA','#7F77DD','#9333EA','#A855F7','#C084FC','#6366F1',
  // Greens
  '#1D9E75','#10B981','#34D399','#16A34A','#4ADE80','#84CC16','#65A30D',
  // Reds & Oranges
  '#E05252','#EF4444','#F87171','#E0944A','#F97316','#FB923C','#FBBF24','#EAB308',
  // Pinks & Roses
  '#EC4899','#F472B6','#FB7185','#E11D48','#BE185D',
  // Teals & Cyans
  '#06B6D4','#22D3EE','#0891B2','#0E7490',
  // Neutrals
  '#888780','#94A3B8','#64748B','#6B7280','#78716C',
]

// ─── Raw localStorage helpers (kept for non-reactive consumers) ───────────────

function parseHabits(raw: string | null): Habit[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<Habit>[]
    return parsed.map((h, i) => ({
      id:        h.id        ?? String(Date.now() + i),
      name:      h.name      ?? 'Habit',
      emoji:     h.emoji     ?? '🎯',
      color:     h.color     ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      frequency: h.frequency ?? 'daily',
      isActive:  h.isActive  ?? true,
      archived:  h.archived  ?? false,
      createdAt: h.createdAt ?? new Date().toISOString(),
      type:      h.type      ?? 'boolean',
      goal:      h.goal,
      unit:      h.unit,
      image:     h.image,
    }))
  } catch { return [] }
}

export function loadHabits(): Habit[] {
  return parseHabits(localStorage.getItem(HABITS_KEY))
}

export function saveHabits(habits: Habit[]): void {
  try { localStorage.setItem(HABITS_KEY, JSON.stringify(habits)) } catch { /* quota */ }
}

export function loadLogs(): HabitLogs {
  try {
    const raw = localStorage.getItem(LOGS_KEY)
    return raw ? (JSON.parse(raw) as HabitLogs) : {}
  } catch { return {} }
}

export function saveLogs(logs: HabitLogs): void {
  try { localStorage.setItem(LOGS_KEY, JSON.stringify(logs)) } catch { /* quota */ }
}

export function loadQuantityLogs(): HabitQuantityLogs {
  try {
    const raw = localStorage.getItem(QTY_LOGS_KEY)
    return raw ? (JSON.parse(raw) as HabitQuantityLogs) : {}
  } catch { return {} }
}

export function saveQuantityLogs(logs: HabitQuantityLogs): void {
  try { localStorage.setItem(QTY_LOGS_KEY, JSON.stringify(logs)) } catch { /* quota */ }
}

let dbSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleHabitsSync(habits: Habit[], logs?: HabitLogs) {
  if (dbSyncTimer) clearTimeout(dbSyncTimer)
  dbSyncTimer = setTimeout(() => {
    // Not "offline" — every failure looked like this, including a database
    // that cannot store what it is being sent.
    void saveHabitsToDB(habits).catch(e => {
      reportSyncGap('habits', 'error', e instanceof Error ? e.message : String(e))
    })
    if (logs) void saveHabitLogsToDB(logs).catch(() => { /* offline */ })
  }, 1500)
}

export function getHabitColors(): string[] {
  return DEFAULT_COLORS
}

// ─── Zustand store ────────────────────────────────────────────────────────────

interface HabitsState {
  habits: Habit[]
  /** Returns the new habit's id, so the caller can open it straight away. */
  addHabit:     (h: Omit<Habit, 'id' | 'createdAt'>) => string
  updateHabit:  (id: string, patch: Partial<Habit>) => void
  deleteHabit:  (id: string) => void
  reorderHabits:(from: number, to: number) => void
  clearAll:     () => void
  loadFromDB:   () => Promise<void>
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export const useHabitsStore = create<HabitsState>((set, get) => ({
  habits: loadHabits(),

  addHabit(h) {
    const id = crypto.randomUUID()
    const next = [...get().habits, { ...h, id, createdAt: new Date().toISOString() }]
    saveHabits(next)
    scheduleHabitsSync(next)
    set({ habits: next })
    return id
  },

  updateHabit(id, patch) {
    const next = get().habits.map(h => h.id === id ? { ...h, ...patch } : h)
    saveHabits(next)
    scheduleHabitsSync(next)
    set({ habits: next })
  },

  deleteHabit(id) {
    const next = get().habits.filter(h => h.id !== id)
    saveHabits(next)
    scheduleHabitsSync(next)
    set({ habits: next })
  },

  reorderHabits(from, to) {
    const next = arrayMove(get().habits, from, to)
    saveHabits(next)
    scheduleHabitsSync(next)
    set({ habits: next })
  },

  clearAll() {
    saveHabits([])
    saveLogs({})
    set({ habits: [] })
  },

  async loadFromDB() {
    try {
      const [dbHabits, logs] = await Promise.all([loadHabitsFromDB(), loadHabitLogsFromDB()])
      if (dbHabits.length > 0) {
        // Merge: keep locally customised emoji/color/type/goal/unit — these may have
        // been changed after the last DB sync (debounced 1.5s).
        const local = get().habits
        const merged: Habit[] = dbHabits.map((h, i) => {
          const localH = local.find(l => l.id === h.id)
          const base: Habit = {
            id:        h.id,
            name:      h.name,
            emoji:     h.emoji     ?? '🎯',
            color:     h.color     ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
            frequency: h.frequency ?? 'daily',
            isActive:  h.isActive  ?? true,
            archived:  localH?.archived ?? false,
            createdAt: h.createdAt ?? new Date().toISOString(),
            // What this device knows wins, since it may be newer than the last
            // sync — but where it knows nothing, the server fills it in. That
            // last part is what puts a picture on a device that never had one.
            type:      localH?.type ?? h.type ?? 'boolean',
            goal:      localH?.goal ?? h.goal,
            unit:      localH?.unit ?? h.unit,
            image:     localH?.image ?? h.image,
          }
          return localH ? { ...base, emoji: localH.emoji, color: localH.color } : base
        })

        // A habit made on this device and not yet synced is not in dbHabits, so
        // building the merge from dbHabits alone quietly dropped it — and then
        // wrote that shorter list over localStorage.
        const dbIds = new Set(dbHabits.map(h => h.id))
        const localOnly = local.filter(l => !dbIds.has(l.id))
        const all = [...merged, ...localOnly]

        saveHabits(all)
        saveLogs(logs)
        set({ habits: all })

        // The merge is the moment this device's own data — a picture, an icon,
        // a target — sits alongside the server's. Nothing else pushes it: the
        // sync runs on edits, so without this a picture taken on one device
        // stayed there until someone happened to change that habit.
        scheduleHabitsSync(all, logs)
      }
    } catch { /* offline — keep local */ }
  },
}))

// ─── Utility functions ────────────────────────────────────────────────────────

/** Compute streak for a habit given its log dates */
export function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...dates].sort().reverse()
  const today = new Date().toISOString().slice(0, 10)
  let streak = 0
  let cursor = today
  for (const date of sorted) {
    if (date === cursor) {
      streak++
      const d = new Date(cursor)
      d.setDate(d.getDate() - 1)
      cursor = d.toISOString().slice(0, 10)
    } else { break }
  }
  return streak
}

/** Returns last N days as YYYY-MM-DD strings, oldest first */
export function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}
