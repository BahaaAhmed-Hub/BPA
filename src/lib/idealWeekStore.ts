// ─── Ideal Week — types and localStorage persistence ─────────────────────────
//
// All state for the Ideal Week feature lives here. Nothing in this file touches
// the network — it is a local-first store that syncs across the platform via
// the same prefSync keys used by habits and finance.

export type BlockType = 'hard' | 'soft'
export type GoalHorizon = 'weekly' | 'monthly' | 'longer'
export type RuleType = 'no-meetings' | 'category-budget' | 'time-preference' | 'yield'
export type VarianceType = 'missing' | 'conflict' | 'overload'

// 0 = Monday … 6 = Sunday (matches the platform's weekStart convention)
export interface IdealBlock {
  id: string
  day: number
  startHour: number  // 0-23
  endHour: number    // 1-24
  title: string
  category: string
  color: string
  goalId?: string
  blockType: BlockType
  notes?: string
}

export interface IdealGoal {
  id: string
  title: string
  category: string
  color: string
  targetHoursWeek: number
  targetHoursMonth?: number
  horizon: GoalHorizon
  deadline?: string  // ISO date
  enabled: boolean
}

export interface IdealRule {
  id: string
  title: string
  description: string
  ruleType: RuleType
  config: {
    days?: number[]
    startHour?: number
    endHour?: number
    category?: string
    maxHoursWeek?: number
    yieldTo?: string[]
  }
  enabled: boolean
  createdFrom: 'ai-chat' | 'canvas' | 'manual'
  createdAt: string
  triggerCount: number
}

export type IdealWeekAction =
  | { type: 'add_block'; day: number; startHour: number; endHour: number; title: string; category: string; color: string; blockType: BlockType }
  | { type: 'remove_block'; id: string; title: string }
  | { type: 'add_goal'; title: string; category: string; color: string; targetHoursWeek: number; horizon: GoalHorizon; deadline?: string }
  | { type: 'add_rule'; title: string; description: string; ruleType: RuleType; config: IdealRule['config'] }
  | { type: 'clear_canvas' }

export interface IdealChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: IdealWeekAction[]
  applied: boolean
  ts: string
}

// ─── Variance — real calendar vs. ideal template ──────────────────────────────

export interface IdealVariance {
  id: string
  type: VarianceType
  day: number       // 0-6
  dateStr: string   // 'YYYY-MM-DD' of the specific occurrence
  startHour: number
  endHour: number
  idealTitle: string
  realTitle?: string   // for conflict: the real event's title
  category: string
  action: string       // human-readable description of the suggested fix
  applied: boolean
}

// ─── Category colour palette ───────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  Focus:      '#5B8DEF',
  Health:     '#0C8140',
  Learning:   '#9B59B6',
  Admin:      '#E67E22',
  Client:     '#E74C3C',
  Personal:   '#27AE60',
  Creative:   '#F39C12',
  Team:       '#2980B9',
  Other:      '#7F8C8D',
}

export const CATEGORY_LIST = Object.keys(CATEGORY_COLORS)

// ─── Persistence ──────────────────────────────────────────────────────────────

const BLOCKS_KEY = 'ideal-week-blocks'
const GOALS_KEY  = 'ideal-week-goals'
const RULES_KEY  = 'ideal-week-rules'
const CHAT_KEY   = 'ideal-week-chat'

function load<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as T[] } catch { return [] }
}
function store<T>(key: string, data: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* noop */ }
}

export const loadBlocks      = (): IdealBlock[]   => load<IdealBlock>(BLOCKS_KEY)
export const loadGoals       = (): IdealGoal[]    => load<IdealGoal>(GOALS_KEY)
export const loadRules       = (): IdealRule[]    => load<IdealRule>(RULES_KEY)
export const loadChatHistory = (): IdealChatMsg[] => load<IdealChatMsg>(CHAT_KEY).slice(-100)

export const saveBlocks = (b: IdealBlock[])   => store(BLOCKS_KEY, b)
export const saveGoals  = (g: IdealGoal[])    => store(GOALS_KEY, g)
export const saveRules  = (r: IdealRule[])    => store(RULES_KEY, r)
export const saveChatHistory = (m: IdealChatMsg[]) => store(CHAT_KEY, m.slice(-100))

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function nanoid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function hourLabel(h: number): string {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
}

/** Total hours blocked per category across the whole ideal week. */
export function hoursPerCategory(blocks: IdealBlock[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of blocks) {
    out[b.category] = (out[b.category] ?? 0) + (b.endHour - b.startHour)
  }
  return out
}

/** Total hours scheduled toward a goal this week (from ideal blocks). */
export function goalHoursBlocked(goalId: string, blocks: IdealBlock[]): number {
  return blocks.filter(b => b.goalId === goalId).reduce((s, b) => s + (b.endHour - b.startHour), 0)
}
