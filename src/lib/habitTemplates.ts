/** The habit presets a person can start from — one list, used by the Habits
 *  screen's first-run prompt. (The setup wizard used to carry two copies.) */
export interface HabitTemplate {
  id: string; name: string; emoji: string; color: string
  type: 'boolean' | 'quantity'; goal?: number; unit?: string
  frequency: 'daily'
}

export const HABIT_TEMPLATES: HabitTemplate[] = [
// ui-guard: emoji-start — habit presets a person can pick
  { id: 'water',       name: 'Drink Water',   emoji: '💧', color: 'var(--sb-info)',     type: 'quantity', goal: 8,     unit: 'glasses', frequency: 'daily' },
  { id: 'exercise',    name: 'Exercise',      emoji: '💪', color: 'var(--sb-negative)', type: 'boolean',                                   frequency: 'daily' },
  { id: 'reading',     name: 'Reading',       emoji: '📚', color: 'var(--sb-info)',     type: 'quantity', goal: 30,    unit: 'min',     frequency: 'daily' },
  { id: 'meditation',  name: 'Meditation',    emoji: '🧘', color: 'var(--sb-positive)', type: 'quantity', goal: 10,    unit: 'min',     frequency: 'daily' },
  { id: 'sleep',       name: '8h Sleep',      emoji: '😴', color: 'var(--sb-info)',     type: 'boolean',                                   frequency: 'daily' },
  { id: 'journaling',  name: 'Journaling',    emoji: '📓', color: 'var(--sb-warning)',  type: 'boolean',                                   frequency: 'daily' },
  { id: 'steps',       name: 'Steps',         emoji: '🚶', color: 'var(--sb-positive)', type: 'quantity', goal: 10000, unit: 'steps',   frequency: 'daily' },
  { id: 'cold-shower', name: 'Cold Shower',   emoji: '🚿', color: 'var(--sb-info)',     type: 'boolean',                                   frequency: 'daily' },
  { id: 'no-phone-am', name: 'No Phone (AM)', emoji: '📵', color: 'var(--sb-info)',     type: 'boolean',                                   frequency: 'daily' },
  { id: 'vitamins',    name: 'Vitamins',      emoji: '💊', color: 'var(--sb-negative)', type: 'boolean',                                   frequency: 'daily' },
  { id: 'prayer',      name: 'Prayers',       emoji: '🕌', color: 'var(--sb-accent)',   type: 'quantity', goal: 5,     unit: 'prayers', frequency: 'daily' },  // built in: the five daily prayers, at their times (see lib/prayer.ts)
  { id: 'no-sugar',    name: 'No Sugar',      emoji: '🚫', color: 'var(--sb-accent)',   type: 'boolean',                                   frequency: 'daily' },
// ui-guard: emoji-end
]
