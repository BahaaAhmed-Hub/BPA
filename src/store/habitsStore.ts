/**
 * Unified habit store — single source of truth for habits.
 * Both the Settings page and the Habits page read/write from here.
 * localStorage key: 'professor-habits'
 */

export interface Habit {
  id: string
  name: string
  emoji: string
  color: string
  frequency: 'daily' | 'weekdays' | 'weekly'
  isActive: boolean
  createdAt: string
}

export interface HabitLogs {
  [habitId: string]: string[]  // array of "YYYY-MM-DD" dates
}

const HABITS_KEY = 'professor-habits'
const LOGS_KEY   = 'professor-habit-logs'

const DEFAULT_COLORS = ['#1E40AF', '#7F77DD', '#1D9E75', '#E05252', '#888780', '#E0944A']

export function loadHabits(): Habit[] {
  try {
    const raw = localStorage.getItem(HABITS_KEY)
    if (!raw) return []
    // Migrate old format (just {id, name, color, createdAt}) if needed
    const parsed = JSON.parse(raw) as Partial<Habit>[]
    return parsed.map((h, i) => ({
      id:        h.id        ?? String(Date.now() + i),
      name:      h.name      ?? 'Habit',
      emoji:     h.emoji     ?? '🎯',
      color:     h.color     ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      frequency: h.frequency ?? 'daily',
      isActive:  h.isActive  ?? true,
      createdAt: h.createdAt ?? new Date().toISOString(),
    }))
  } catch { return [] }
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

export function getHabitColors(): string[] {
  return DEFAULT_COLORS
}

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
