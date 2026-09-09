// ─── The morning plan, outside the component ─────────────────────────────────
// MorningBrief drew the plan and also built it, so nothing could write one
// before the page was opened. The automation's "Write the morning brief" rule
// needs to, at 06:40, so the building moved here and the page reads the cache.

import { planMyDay } from '@/lib/professor'
import type { DayPlan, DayContext } from '@/lib/professor'
import type { DbUser, DbCompany, DbCalendarEvent, DbTask } from '@/types/database'
import type { Task } from '@/types'
import { isTaskHidden } from '@/types'
import { fetchVisibleEvents } from '@/lib/calendarEvents'
import type { GCalEvent } from '@/lib/googleCalendar'

const QUADRANT_MAP: Record<string, DbTask['quadrant']> = {
  do:       'urgent_important',
  schedule: 'important_not_urgent',
  delegate: 'urgent_not_important',
  eliminate:'neither',
}

export const MOCK_COMPANIES: DbCompany[] = [
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: 'var(--sb-info)', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: 'var(--sb-info)', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: 'var(--sb-positive)', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: 'var(--sb-ink-4)', calendar_id: null, is_active: true },
]

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function buildMockUser(user: { id: string; email: string; name?: string; avatarUrl?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo',
    email: user?.email ?? 'bahaa@example.com',
    full_name: user?.name ?? 'Bahaa Ahmed',
    avatar_url: user?.avatarUrl ?? null,
    active_framework: 'time_blocking',
    schedule_rules: {
      focus_hours: '09:00–12:00',
      buffer_minutes: 15,
      no_meeting_days: 'Wednesday',
      max_meetings_per_day: 4,
    },
    created_at: new Date().toISOString(),
  }
}

export function buildContext(dbUser: DbUser, tasks: Task[], energyLevel: number | null, todayEvents: DbCalendarEvent[]): DayContext {
  const pendingTasks: DbTask[] = tasks
    .filter(t => !t.completed)
    .map(t => ({
      id: t.id,
      user_id: dbUser.id,
      company_id: t.company,
      title: t.title,
      description: t.description ?? null,
      quadrant: t.quadrant ? (QUADRANT_MAP[t.quadrant] ?? null) : null,
      effort_minutes: null,
      due_date: t.dueDate ?? null,
      status: 'todo' as const,
      delegated_to: null,
      done_looks_like: null,
      created_at: t.createdAt,
      completed_at: null,
    }))

  return {
    user: dbUser,
    companies: MOCK_COMPANIES,
    todayEvents,
    pendingTasks,
    energyLevel: energyLevel ?? undefined,
    date: todayKey(),
  }
}

export function loadCachedPlan(): DayPlan | null {
  try {
    const raw = localStorage.getItem(`professor-dayplan-${todayKey()}`)
    return raw ? (JSON.parse(raw) as DayPlan) : null
  } catch {
    return null
  }
}

export function savePlan(plan: DayPlan): void {
  try {
    localStorage.setItem(`professor-dayplan-${todayKey()}`, JSON.stringify(plan))
  } catch { /* quota full — skip */ }
}

/** Today's events in the shape the planner reads. */
export async function todaysEventsForPlan(userId: string): Promise<DbCalendarEvent[]> {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end   = new Date(); end.setHours(23, 59, 59, 999)
  const evs: GCalEvent[] = await fetchVisibleEvents(start, end).catch(() => [])
  return evs.map(e => ({
    id: e.id, user_id: userId, company_id: null, google_event_id: e.id,
    title: e.summary ?? '(No title)',
    start_time: e.start.dateTime ?? e.start.date ?? '',
    end_time:   e.end.dateTime   ?? e.end.date   ?? '',
    location: e.location ?? null, meeting_type: null, prep_notes: null, is_synced: true,
  }))
}

/**
 * Write today's plan into the cache the Morning Brief opens with, unless one
 * is there already. Returns whether one was written.
 */
export async function writeMorningPlan(
  user: { id: string; email: string; name?: string; avatarUrl?: string } | null,
  tasks: Task[],
): Promise<boolean> {
  if (loadCachedPlan()) return false
  const dbUser = buildMockUser(user)
  const events = await todaysEventsForPlan(dbUser.id)
  const plan = await planMyDay(buildContext(dbUser, tasks.filter(t => !isTaskHidden(t)), null, events))
  savePlan(plan)
  return true
}
