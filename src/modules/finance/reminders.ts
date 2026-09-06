import type { Task } from '@/types'
import type { Category } from './types'
import { loadRules, monthlyAmount, activeIn, type BudgetRule } from './modals/BudgetRuleModal'
import { group } from './format'
import { isoDate, shiftDaysISO } from './dates'

// ─── Money that has to be paid on a day ──────────────────────────────────────
// A budget says how much a category gets in a month. It says nothing about the
// day the money actually has to move, which is the thing that gets forgotten.
// A reminder ties the two together: this category, this day of the month, and
// a task on that date — which the task board schedules onto the calendar the
// same way it does everything else with a date on it.

const KEY  = 'finance-money-reminders'
const MADE = 'finance-money-reminders-made'

export interface MoneyReminder {
  id: string
  categoryId: string
  /** 1–31. A month too short for it takes its last day rather than skipping. */
  day: number
  /** Days before the day itself. 0 puts the task on the day. */
  leadDays: number
  /** How many months ahead to keep tasks standing. */
  monthsAhead: number
  enabled: boolean
  note?: string
}

export function defaultReminder(categoryId: string): MoneyReminder {
  return { id: crypto.randomUUID(), categoryId, day: 1, leadDays: 0, monthsAhead: 3, enabled: true }
}

export function loadReminders(): MoneyReminder[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r): r is MoneyReminder =>
      !!r && typeof r === 'object' && typeof (r as MoneyReminder).categoryId === 'string')
  } catch { return [] }
}

/** The budgets that carry a day of their own, as reminders.
 *
 *  A day set on the budget is the same statement as a reminder made by hand —
 *  this category, this day — so it goes through the same machinery rather than
 *  growing a second one beside it. The id is derived from the category, so
 *  changing the day moves the task the budget already made.
 *
 *  A hand-made reminder for the same category wins: two tasks for one bill is
 *  worse than either version of it. */
export function remindersFromBudgets(
  rules: Record<string, BudgetRule>,
  handMade: MoneyReminder[] = [],
): MoneyReminder[] {
  const taken = new Set(handMade.filter(r => r.enabled).map(r => r.categoryId))
  const out: MoneyReminder[] = []
  for (const [categoryId, rule] of Object.entries(rules)) {
    if (!rule || rule.dueDay == null || taken.has(categoryId)) continue
    out.push({
      id: `budget:${categoryId}`,
      categoryId,
      day: rule.dueDay,
      leadDays: rule.dueLeadDays ?? 0,
      monthsAhead: 3,
      enabled: true,
    })
  }
  return out
}

export function saveReminders(list: MoneyReminder[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* quota */ }
  window.dispatchEvent(new Event('professor:moneyRemindersChanged'))
}

/** The 31st of a month with 30 days is the 30th, not the 1st of the next one. */
function onDay(year: number, monthIndex: number, day: number): string {
  const last = new Date(year, monthIndex + 1, 0).getDate()
  const d = Math.min(Math.max(1, day), last)
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function minusDays(iso: string, days: number): string {
  return days ? shiftDaysISO(iso, -days) : iso
}

/** The months a reminder still owes a task for: this one and the next few,
 *  skipping any whose day has already gone by. */
export function dueDatesFor(rule: MoneyReminder, from = new Date()): { monthKey: string; date: string }[] {
  const out: { monthKey: string; date: string }[] = []
  const today = isoDate(from)
  for (let n = 0; n < Math.max(1, Math.min(12, rule.monthsAhead)); n++) {
    const d = new Date(from.getFullYear(), from.getMonth() + n, 1)
    const due = minusDays(onDay(d.getFullYear(), d.getMonth(), rule.day), rule.leadDays)
    if (due < today) continue
    out.push({ monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, date: due })
  }
  return out
}

/** What the task should be called: the category, and what it is budgeted, so
 *  the amount is on the card rather than a thing to go and look up. */
export function reminderTitle(cat: Category | undefined, rule?: BudgetRule, monthKey?: string): string {
  const name = cat?.name ?? 'money'
  const amount = rule && monthKey && activeIn(rule, monthKey) ? monthlyAmount(rule) : 0
  const kind = cat?.txType === 'income' ? 'Collect' : 'Pay'
  return amount > 0 ? `${kind} ${name} · ${rule?.currency ?? 'EGP'} ${group(amount)}` : `${kind} ${name}`
}

const MARK = 'money-reminder'

/** A reminder's task carries its own key, so the rule can find the task it made
 *  and move it when the rule changes rather than leaving the old one behind and
 *  adding another. */
export function markerFor(ruleId: string, monthKey: string): string {
  return `${MARK}:${ruleId}:${monthKey}`
}
function markerOf(task: Task): string | null {
  return task.links?.find(l => l.startsWith(`${MARK}:`)) ?? null
}

function madeKeys(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(MADE) ?? '[]') as string[]) } catch { return new Set() }
}
function rememberMade(keys: Set<string>): void {
  try { localStorage.setItem(MADE, JSON.stringify([...keys].slice(-500))) } catch { /* quota */ }
}

export interface TaskApi {
  addTask: (t: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
}

/**
 * Bring the task board in line with the reminders.
 *
 * A month that has been made once is never made again: if the task is gone, the
 * person deleted it, and putting it back is the one thing they did not ask for.
 * A rule that changes moves the task it already made rather than leaving the old
 * one standing beside a new one — and a rule turned off or deleted takes its
 * unfinished future tasks with it, but leaves anything already done alone.
 *
 * The task goes into the schedule quadrant with a date on it, which is what the
 * board already pushes to Google Calendar, so nothing here knows about calendars.
 */
export function runReminders(
  categories: Category[],
  tasks: Task[],
  api: TaskApi,
  now = new Date(),
): { made: number; moved: number; dropped: number } {
  const handMade = loadReminders()
  const budgets = loadRules()
  // A day written on a budget is a reminder; it just did not have to be typed
  // twice. Both lists run through everything below unchanged.
  const rules = [...handMade, ...remindersFromBudgets(budgets, handMade)]
  const made = madeKeys()
  const today = isoDate(now)
  let createdCount = 0, movedCount = 0, droppedCount = 0

  const byMarker = new Map<string, Task>()
  for (const t of tasks) {
    const m = markerOf(t)
    if (m) byMarker.set(m, t)
  }

  const wanted = new Set<string>()

  for (const rule of rules.filter(r => r.enabled)) {
    const cat = categories.find(c => c.id === rule.categoryId)
    if (!cat) continue
    for (const { monthKey, date } of dueDatesFor(rule, now)) {
      const key = markerFor(rule.id, monthKey)
      wanted.add(key)
      const title = reminderTitle(cat, budgets[rule.categoryId], monthKey)
      const existing = byMarker.get(key)

      if (existing) {
        if (existing.completed) continue
        if (existing.dueDate !== date || existing.title !== title) {
          api.updateTask(existing.id, { dueDate: date, title })
          movedCount++
        }
        continue
      }
      if (made.has(key)) continue   // it existed; it was deleted on purpose
      made.add(key)
      api.addTask({
        title,
        description: rule.note?.trim() || undefined,
        quadrant: 'schedule',
        company: 'personal',
        dueDate: date,
        duration: 15,
        status: 'open',
        completed: false,
        priority: 'P2',
        links: [key],
      })
      createdCount++
    }
  }

  // A rule that is gone, off, or no longer covers a month takes its unfinished
  // future tasks with it. Anything already done is a record and stays.
  for (const [key, task] of byMarker) {
    if (wanted.has(key)) continue
    if (task.completed) continue
    if (task.dueDate && task.dueDate < today) continue
    api.deleteTask(task.id)
    droppedCount++
  }

  if (createdCount > 0) rememberMade(made)
  return { made: createdCount, moved: movedCount, dropped: droppedCount }
}
