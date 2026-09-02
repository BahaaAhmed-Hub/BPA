/**
 * Unified habit store — single source of truth for habits.
 * Uses Zustand so both Settings and HabitsModule share live reactive state.
 * localStorage key: 'professor-habits'
 */
import { create } from 'zustand'
import { loadHabitsFromDB, loadHabitLogsFromDB, saveHabitsToDB, saveHabitLogsToDB } from '@/lib/dbSync'
import { reportSyncGap } from '@/lib/syncStatus'
import { markLocalWrite } from '@/lib/liveSync'

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

// ─── Which habits this device has changed since it last pushed ───────────────
// The merge below needs to answer one question: is this device's copy of a
// habit newer than the server's? It used to assume yes, always, which is why a
// habit's icon, colour and type never arrived on a second device — see the
// comment in loadFromDB. This is the answer: a habit is only newer here if it
// was edited here and the edit has not been pushed yet.

const DIRTY_KEY = 'professor-habits-dirty'

function loadDirty(): Set<string> {
  try {
    const raw = localStorage.getItem(DIRTY_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveDirty(ids: Set<string>): void {
  try { localStorage.setItem(DIRTY_KEY, JSON.stringify([...ids])) } catch { /* quota */ }
}

function markDirty(...ids: string[]): void {
  const set = loadDirty()
  for (const id of ids) set.add(id)
  saveDirty(set)
  markLocalWrite('habits')
}

// A device that predates this list gives no way to tell what it has pushed and
// what it has not. Assume nothing: a redundant push costs a request, whereas
// treating a habit that only exists here as one deleted elsewhere loses it.
if (localStorage.getItem(DIRTY_KEY) == null) {
  const existing = loadHabits().map(h => h.id)
  if (existing.length) saveDirty(new Set(existing))
}

/** The fields that actually travel, in a form two copies can be compared by.
 *  Hydration pushes its merge back so this device's own data reaches the
 *  server — but pushing a merge that is already identical to what the server
 *  just sent makes a change event, which makes the other device reload, which
 *  makes it push... Two open devices would trade writes forever. */
function syncedShape(h: {
  name: string; frequency: string; isActive: boolean
  emoji?: string; color?: string; type?: string; goal?: number; unit?: string; image?: string
}): string {
  return JSON.stringify([
    h.name, h.frequency, h.isActive,
    h.emoji ?? null, h.color ?? null, h.type ?? null,
    h.goal ?? null, h.unit ?? null, h.image ?? null,
  ])
}

let dbSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleHabitsSync(habits: Habit[], logs?: HabitLogs) {
  if (dbSyncTimer) clearTimeout(dbSyncTimer)
  dbSyncTimer = setTimeout(() => {
    markLocalWrite('habits')
    const pushing = loadDirty()
    // Not "offline" — every failure looked like this, including a database
    // that cannot store what it is being sent.
    void saveHabitsToDB(habits)
      .then(() => {
        // Landed. These are no longer newer here than they are there.
        const still = loadDirty()
        for (const id of pushing) still.delete(id)
        saveDirty(still)
      })
      .catch(e => {
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
    markDirty(id)
    scheduleHabitsSync(next)
    set({ habits: next })
    return id
  },

  updateHabit(id, patch) {
    const next = get().habits.map(h => h.id === id ? { ...h, ...patch } : h)
    saveHabits(next)
    markDirty(id)
    scheduleHabitsSync(next)
    set({ habits: next })
  },

  deleteHabit(id) {
    const next = get().habits.filter(h => h.id !== id)
    saveHabits(next)
    markDirty(id)
    scheduleHabitsSync(next)
    set({ habits: next })
  },

  reorderHabits(from, to) {
    // Order is not stored server-side, so there is nothing to push — and an
    // upsert of unchanged rows would only wake the other device for nothing.
    const next = arrayMove(get().habits, from, to)
    saveHabits(next)
    set({ habits: next })
  },

  clearAll() {
    saveHabits([])
    saveLogs({})
    saveDirty(new Set())
    set({ habits: [] })
  },

  async loadFromDB() {
    try {
      const [dbHabits, logRes] = await Promise.all([loadHabitsFromDB(), loadHabitLogsFromDB()])
      const { logs, quantities } = logRes
      if (dbHabits.length > 0) {
        // The server wins, except for habits this device has changed and not
        // yet pushed.
        //
        // It used to be the other way round for every field, on the reasoning
        // that a local edit may be newer than the last (debounced) sync. But a
        // device invents an emoji, a colour and a type the moment it reads a
        // habit it has never seen — parseHabits fills in '🎯', a colour by
        // position and 'boolean'. Those invented values are indistinguishable
        // from choices, so they outranked the real ones forever: on the second
        // device a counter stayed a checkbox and every habit wore a placeholder
        // icon in a colour nobody picked. Only the picture came through, and
        // only because a device never invents one of those.
        //
        // So: unpushed local edits still win — that is what the local-is-newer
        // rule was actually protecting — and everything else defers.
        const local = get().habits
        const dirty = loadDirty()
        const merged: Habit[] = dbHabits.map((h, i) => {
          const localH = local.find(l => l.id === h.id)
          const mine = !!localH && dirty.has(h.id)

          const fromDb: Partial<Habit> = {
            name: h.name, frequency: h.frequency, isActive: h.isActive,
            emoji: h.emoji, color: h.color,
            type: h.type, goal: h.goal, unit: h.unit, image: h.image,
          }
          const first: Partial<Habit> = mine ? localH : fromDb
          const then:  Partial<Habit> = mine ? fromDb : (localH ?? {})

          return {
            id:        h.id,
            name:      first.name      ?? then.name      ?? h.name,
            emoji:     first.emoji     ?? then.emoji     ?? '🎯',
            color:     first.color     ?? then.color     ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
            frequency: first.frequency ?? then.frequency ?? 'daily',
            isActive:  first.isActive  ?? then.isActive  ?? true,
            // The server has nowhere to keep this one, so it stays local.
            archived:  localH?.archived ?? false,
            createdAt: h.createdAt ?? localH?.createdAt ?? new Date().toISOString(),
            type:      first.type ?? then.type ?? 'boolean',
            goal:      first.goal ?? then.goal,
            unit:      first.unit ?? then.unit,
            image:     first.image ?? then.image,
          }
        })

        // A habit made on this device and not yet synced is not in dbHabits, so
        // building the merge from dbHabits alone quietly dropped it — and then
        // wrote that shorter list over localStorage.
        //
        // But "missing from the server" has a second meaning now that the
        // server can change under an open app: deleted on another device. The
        // dirty list separates them. Keeping both would make a habit deleted on
        // the laptop reappear on the iPad and then get pushed back up.
        const dbIds = new Set(dbHabits.map(h => h.id))
        const localOnly = local.filter(l => !dbIds.has(l.id) && dirty.has(l.id))

        // Order is the one thing the server cannot answer for: there is no
        // position column, so the rows arrive in creation order. Hydrating
        // would therefore undo a manual reorder every time the app opened.
        // Keep the order this device already has, and put habits it has never
        // seen after it, in the order the server gave them.
        const localOrder = new Map(local.map((l, idx) => [l.id, idx]))
        const known   = merged.filter(h => localOrder.has(h.id))
                              .sort((a, b) => localOrder.get(a.id)! - localOrder.get(b.id)!)
        const arrived = merged.filter(h => !localOrder.has(h.id))
        const all = [...known, ...arrived, ...localOnly]

        saveHabits(all)
        saveLogs(logs)
        // null means the server has no quantity column yet — leave this
        // device's numbers alone rather than reading absence as zero.
        if (quantities) saveQuantityLogs(quantities)
        set({ habits: all })
        // The Habits page holds the logs in its own state, read once on mount.
        // Reloading while it is open has to tell it, or the ticks stay stale.
        window.dispatchEvent(new Event('professor:habitLogsUpdated'))

        // The merge is the moment this device's own data — a picture, an icon,
        // a target — sits alongside the server's. Nothing else pushes it: the
        // sync runs on edits, so without this a picture taken on one device
        // stayed there until someone happened to change that habit.
        //
        // Only when it would actually say something new, though — see
        // syncedShape. The logs are not pushed at all: they came from the
        // server a moment ago.
        const onServer = new Map(dbHabits.map(h => [h.id, syncedShape(h)]))
        const changed =
          all.length !== dbHabits.length ||
          all.some(h => onServer.get(h.id) !== syncedShape(h))
        if (changed) scheduleHabitsSync(all)
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
