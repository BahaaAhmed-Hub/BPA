/**
 * Behavioral Engine — rank calculation and identity inference.
 *
 * All calculations are purely derived from existing task / habit / log data
 * already in the app. No external calls required.
 */

import type { Task } from '@/types'
import type { Habit, HabitLogs } from '@/store/habitsStore'
import type { RankResult, IdentityResult, Rank, IdentityStage } from '@/store/behavioralStore'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function last14Keys(): string[] {
  return Array.from({ length: 14 }, (_, i) => toDateKey(daysAgo(13 - i)))
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v))
}

// ─── Rank Calculation ────────────────────────────────────────────────────────

export function scoreToRank(score: number): Rank {
  if (score >= 81) return 'shogun'
  if (score >= 61) return 'daimyo'
  if (score >= 36) return 'samurai'
  return 'ronin'
}

export const RANK_META: Record<Rank, { label: string; philosophy: string; threshold: number; next: Rank | null }> = {
  ronin:   { label: 'Ronin',   philosophy: 'Capable but inconsistent.',          threshold: 0,  next: 'samurai' },
  samurai: { label: 'Samurai', philosophy: 'Disciplined executor.',               threshold: 36, next: 'daimyo'  },
  daimyo:  { label: 'Daimyo',  philosophy: 'Strategic orchestrator.',             threshold: 61, next: 'shogun'  },
  shogun:  { label: 'Shogun',  philosophy: 'Elite operational mastery.',          threshold: 81, next: null      },
}

function calcTaskCompletion(tasks: Task[]): number {
  const window = daysAgo(13)
  const recent = tasks.filter(t => t.createdAt && new Date(t.createdAt) >= window)
  if (recent.length === 0) return 50
  const done = recent.filter(t => t.completed || t.status === 'done').length
  return clamp(Math.round((done / recent.length) * 100))
}

function calcHabitConsistency(habits: Habit[], logs: HabitLogs): number {
  const active = habits.filter(h => h.isActive)
  if (active.length === 0) return 50
  const keys = last14Keys()
  const rates = active.map(h => {
    const logged = (logs[h.id] ?? []).filter(d => keys.includes(d)).length
    const expected = h.frequency === 'weekdays'
      ? keys.filter(k => { const day = new Date(k).getDay(); return day > 0 && day < 6 }).length
      : h.frequency === 'weekly' ? 2
      : keys.length
    return clamp(Math.round((logged / Math.max(expected, 1)) * 100))
  })
  return clamp(Math.round(rates.reduce((a, b) => a + b, 0) / rates.length))
}

function calcPlanningQuality(tasks: Task[]): number {
  const window = daysAgo(13)
  const recent = tasks.filter(t => t.createdAt && new Date(t.createdAt) >= window)
  if (recent.length < 3) return 50
  const withDue = recent.filter(t => t.dueDate).length
  const withType = recent.filter(t => t.taskType).length
  const score = ((withDue / recent.length) * 0.6 + (withType / recent.length) * 0.4) * 100
  return clamp(Math.round(score))
}

export function evaluateRank(tasks: Task[], habits: Habit[], logs: HabitLogs): RankResult {
  const taskCompletion   = calcTaskCompletion(tasks)
  const habitConsistency = calcHabitConsistency(habits, logs)
  const planningQuality  = calcPlanningQuality(tasks)

  const score = clamp(Math.round(
    taskCompletion   * 0.40 +
    habitConsistency * 0.35 +
    planningQuality  * 0.25
  ))

  return { rank: scoreToRank(score), score, components: { taskCompletion, habitConsistency, planningQuality } }
}

// ─── Identity Detection ──────────────────────────────────────────────────────

interface IdentityRule {
  id: string
  name: string
  emoji: string
  description: string
  taskKeywords: string[]
  habitKeywords: string[]
}

const IDENTITY_RULES: IdentityRule[] = [
  {
    id: 'reader',
    name: 'Reader',
    emoji: '📖',
    description: 'Consistent knowledge consumption through reading.',
    taskKeywords:  ['read', 'book', 'article', 'chapter', 'literature'],
    habitKeywords: ['read', 'book', 'reading'],
  },
  {
    id: 'planner',
    name: 'Planner',
    emoji: '🗂',
    description: 'Deliberate scheduling and structured forward-thinking.',
    taskKeywords:  ['plan', 'schedule', 'strategy', 'roadmap', 'prepare'],
    habitKeywords: ['plan', 'schedule', 'daily review', 'week', 'planning'],
  },
  {
    id: 'deepworker',
    name: 'Deep Worker',
    emoji: '⚡',
    description: 'Sustained focus and distraction-free execution.',
    taskKeywords:  ['focus', 'deep', 'draft', 'write', 'build', 'code', 'design'],
    habitKeywords: ['focus', 'deep work', 'pomodoro', 'no distraction'],
  },
  {
    id: 'athlete',
    name: 'Athlete',
    emoji: '⚔',
    description: 'Disciplined physical training and body conditioning.',
    taskKeywords:  ['workout', 'exercise', 'gym', 'run', 'training', 'sport'],
    habitKeywords: ['workout', 'exercise', 'gym', 'run', 'walk', 'sport', 'train'],
  },
  {
    id: 'reflector',
    name: 'Reflector',
    emoji: '🪞',
    description: 'Regular introspection and behavioral self-assessment.',
    taskKeywords:  ['reflect', 'journal', 'review', 'retrospect', 'meditate'],
    habitKeywords: ['journal', 'meditate', 'reflect', 'gratitude', 'review'],
  },
  {
    id: 'organizer',
    name: 'Organizer',
    emoji: '◈',
    description: 'Systematic management of tasks, inbox, and information.',
    taskKeywords:  ['organize', 'sort', 'archive', 'clean', 'structure', 'inbox'],
    habitKeywords: ['inbox zero', 'organize', 'tidy', 'clean'],
  },
  {
    id: 'builder',
    name: 'Builder',
    emoji: '◆',
    description: 'Consistent creation and meaningful execution output.',
    taskKeywords:  ['build', 'create', 'develop', 'launch', 'ship', 'deploy', 'implement'],
    habitKeywords: ['build', 'create', 'side project', 'ship'],
  },
  {
    id: 'learner',
    name: 'Learner',
    emoji: '◉',
    description: 'Continuous skill acquisition and knowledge building.',
    taskKeywords:  ['learn', 'study', 'course', 'practice', 'research', 'explore'],
    habitKeywords: ['study', 'learn', 'course', 'research', 'practice'],
  },
]

function scoreStage(score: number): IdentityStage {
  if (score >= 75) return 'core'
  if (score >= 55) return 'established'
  if (score >= 35) return 'developing'
  return 'emerging'
}

const STAGE_THRESHOLD = 20 // minimum score to surface an identity

export function detectIdentities(tasks: Task[], habits: Habit[], logs: HabitLogs): IdentityResult[] {
  const window30 = daysAgo(29)
  const recentTasks = tasks.filter(t => t.createdAt && new Date(t.createdAt) >= window30)
  const keys30 = Array.from({ length: 30 }, (_, i) => toDateKey(daysAgo(29 - i)))

  const results: IdentityResult[] = []

  for (const rule of IDENTITY_RULES) {
    // Task signal: how many recent tasks match this identity
    const matchingTasks = recentTasks.filter(t =>
      rule.taskKeywords.some(k => t.title.toLowerCase().includes(k))
    )
    const taskSignal = clamp(Math.round((matchingTasks.length / Math.max(recentTasks.length, 5)) * 150))

    // Habit signal: how consistently matching habits are logged
    const matchingHabits = habits.filter(h =>
      h.isActive && rule.habitKeywords.some(k => h.name.toLowerCase().includes(k))
    )
    let habitSignal = 0
    if (matchingHabits.length > 0) {
      const rates = matchingHabits.map(h => {
        const logged = (logs[h.id] ?? []).filter(d => keys30.includes(d)).length
        return clamp(Math.round((logged / 30) * 100))
      })
      habitSignal = Math.max(...rates)
    }

    // Combined score — habit signal is stronger evidence than task keywords
    const score = clamp(Math.round(habitSignal * 0.65 + taskSignal * 0.35))

    if (score >= STAGE_THRESHOLD) {
      results.push({
        id:          rule.id,
        name:        rule.name,
        emoji:       rule.emoji,
        stage:       scoreStage(score),
        score,
        description: rule.description,
        detectedAt:  new Date().toISOString(),
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 6)
}

// ─── Insights Generation ─────────────────────────────────────────────────────

export function generateInsights(rank: RankResult, identities: IdentityResult[]): string[] {
  const insights: string[] = []
  const { taskCompletion, habitConsistency, planningQuality } = rank.components

  // Rank-level observations
  if (rank.score >= 70) {
    insights.push('Execution integrity is at a high point. Sustain the current rhythm.')
  } else if (rank.score >= 50) {
    insights.push('Operational consistency is developing. Small daily improvements compound.')
  } else {
    insights.push('Patterns are still forming. Consistency over the next two weeks will define your trajectory.')
  }

  // Component-specific
  if (taskCompletion >= 70) {
    insights.push('Task completion rate is strong. Decisive execution is becoming a reliable pattern.')
  } else if (taskCompletion < 40) {
    insights.push('Task completion rate is below threshold. Reduce the list. Fewer, sharper objectives.')
  }

  if (habitConsistency >= 70) {
    insights.push('Habit discipline is stabilizing. Daily rituals are reinforcing your operational identity.')
  } else if (habitConsistency < 40) {
    insights.push('Habit consistency is fragile. Anchor two core habits before adding more.')
  }

  if (planningQuality >= 65) {
    insights.push('Planning structure is solid. Forward visibility is supporting execution quality.')
  } else if (planningQuality < 35) {
    insights.push('Planning depth is low. Tasks without due dates create invisible backlog.')
  }

  // Identity-specific insights
  const coreIds = identities.filter(i => i.stage === 'core' || i.stage === 'established')
  if (coreIds.length > 0) {
    insights.push(`${coreIds[0].name} is one of your strongest recurring behavioral patterns.`)
  }

  const emerging = identities.filter(i => i.stage === 'emerging')
  if (emerging.length > 0) {
    insights.push(`An early pattern of ${emerging[0].name.toLowerCase()} behavior is forming. Sustain it for three more weeks.`)
  }

  return insights.slice(0, 5)
}

// ─── Decisive Objectives ─────────────────────────────────────────────────────

export function getDecisiveObjectives(tasks: Task[]): Task[] {
  const open = tasks.filter(t => !t.completed && t.status !== 'done')

  // Priority order: do (urgent+important) → schedule (important) → delegate → has due date → urgent flag
  const score = (t: Task): number => {
    let s = 0
    if (t.quadrant === 'do') s += 100
    else if (t.quadrant === 'schedule') s += 60
    else if (t.quadrant === 'delegate') s += 20
    if (t.urgent) s += 30
    if (t.dueDate) {
      const due = new Date(t.dueDate)
      const days = Math.ceil((due.getTime() - Date.now()) / 86400000)
      if (days <= 1) s += 50
      else if (days <= 3) s += 30
      else if (days <= 7) s += 15
    }
    return s
  }

  return open.sort((a, b) => score(b) - score(a)).slice(0, 3)
}
