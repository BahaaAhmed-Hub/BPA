/**
 * AI-powered task scheduler.
 * - Tasks with dueDate + plannedTime  → create calendar event directly
 * - Tasks with dueDate only           → AI picks best slot, may move other events
 * Moved-by-AI events are tracked in localStorage: 'cal-ai-moved-events'
 */
import type { Task } from '@/types'
import type { GCalEventWithCalendar } from '@/lib/googleCalendar'
import { fetchDayEvents, createCalendarEvent, updateCalendarEvent } from '@/lib/googleCalendar'
import { call } from '@/lib/professor'

// ─── AI-moved tracking ────────────────────────────────────────────────────────

const AI_MOVED_KEY = 'cal-ai-moved-events'

export function loadAiMovedEvents(): Set<string> {
  try {
    const raw = localStorage.getItem(AI_MOVED_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function markAiMoved(eventIds: string[]) {
  const set = loadAiMovedEvents()
  eventIds.forEach(id => set.add(id))
  localStorage.setItem(AI_MOVED_KEY, JSON.stringify([...set]))
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleResult {
  success: boolean
  gcalEventId?: string
  scheduledTime?: string   // HH:MM
  movedCount?: number
  error?: string
}

interface AiSlotResponse {
  scheduledTime: string   // HH:MM
  movedEvents: { id: string; newTime: string; reason: string }[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number)
  return hh * 60 + mm
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function eventDurationMins(ev: GCalEventWithCalendar): number {
  if (!ev.start.dateTime || !ev.end.dateTime) return 60
  return (new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime()) / 60000
}

function hasOtherAttendees(ev: GCalEventWithCalendar): boolean {
  return (ev.attendees ?? []).filter(a => !a.self).length > 0
}

function isTooCloseToCurrent(ev: GCalEventWithCalendar): boolean {
  if (!ev.start.dateTime) return false
  const diffMs = new Date(ev.start.dateTime).getTime() - Date.now()
  return diffMs < 2 * 60 * 60 * 1000  // within 2 hours
}

// ─── Main scheduler ───────────────────────────────────────────────────────────

export async function scheduleTaskToCalendar(task: Task): Promise<ScheduleResult> {
  if (!task.dueDate) return { success: false, error: 'Task has no due date.' }

  const calendarId = task.calendarId ?? 'primary'
  const durationMins = task.duration ?? 30
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  // ── Case 1: has planned time → create directly ────────────────────────────
  if (task.plannedTime) {
    const start = new Date(`${task.dueDate}T${task.plannedTime}:00`)
    const end   = new Date(start.getTime() + durationMins * 60000)

    const result = await createCalendarEvent(calendarId, {
      summary: task.title,
      description: task.description,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end:   { dateTime: end.toISOString(),   timeZone: tz },
    })
    if (result.noAuth) return { success: false, error: 'Not signed in to Google.' }
    if (result.error)  return { success: false, error: result.error }
    return { success: true, gcalEventId: result.event?.id, scheduledTime: task.plannedTime }
  }

  // ── Case 2: date only → AI picks best slot ────────────────────────────────
  const dayEvents = await fetchDayEvents(calendarId, task.dueDate)
  const movable   = dayEvents.filter(ev => ev.start.dateTime && !hasOtherAttendees(ev) && !isTooCloseToCurrent(ev))

  const eventsDesc = dayEvents.map(ev => ({
    id:          ev.id,
    title:       ev.summary ?? '(No title)',
    start:       ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'all-day',
    end:         ev.end.dateTime   ? new Date(ev.end.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'all-day',
    durationMins: eventDurationMins(ev),
    canMove:     movable.includes(ev),
    hasAttendees: hasOtherAttendees(ev),
    tooClose:    isTooCloseToCurrent(ev),
  }))

  const quadrantPriority: Record<string, string> = {
    do:       'URGENT — schedule in morning or earliest available slot',
    schedule: 'Important but flexible — prefer mid-morning or early afternoon',
    delegate: 'Low urgency — afternoon is fine',
    eliminate:'Very low — any open slot works',
  }
  const quadrantHint = task.quadrant ? (quadrantPriority[task.quadrant] ?? '') : 'No quadrant set — use judgement'

  const system = `You are an executive calendar AI. Schedule a task into a day's calendar by finding the best available time slot.
You may suggest moving existing events only if canMove=true. Never move events with hasAttendees=true or tooClose=true.
Return ONLY valid JSON.`

  const userMsg = `Schedule this task:
- Title: "${task.title}"
- Duration: ${durationMins} minutes
- Priority: ${quadrantHint}
- Date: ${task.dueDate}

Today's events:
${JSON.stringify(eventsDesc, null, 2)}

Rules:
- Working hours: 08:00–19:00
- Leave 10min buffer between meetings
- For "do" tasks, prefer earliest available morning slot
- Only suggest moves if truly necessary to fit the task
- Never move events where canMove=false

Return JSON:
{
  "scheduledTime": "HH:MM",
  "movedEvents": [
    { "id": "event-id", "newTime": "HH:MM", "reason": "brief reason" }
  ]
}`

  let aiResponse: AiSlotResponse
  try {
    const raw = await call(system, userMsg)
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    aiResponse = JSON.parse(stripped) as AiSlotResponse
  } catch {
    // Fallback: find first 30-min gap from 09:00
    aiResponse = { scheduledTime: findFallbackSlot(dayEvents, durationMins), movedEvents: [] }
  }

  // Apply moves
  const movedIds: string[] = []
  for (const mv of (aiResponse.movedEvents ?? [])) {
    const ev = movable.find(e => e.id === mv.id)
    if (!ev || !ev.start.dateTime || !ev.end.dateTime) continue
    const dur = eventDurationMins(ev)
    const newStart = new Date(`${task.dueDate}T${mv.newTime}:00`)
    const newEnd   = new Date(newStart.getTime() + dur * 60000)
    const res = await updateCalendarEvent(calendarId, ev.id, {
      start: { dateTime: newStart.toISOString(), timeZone: tz },
      end:   { dateTime: newEnd.toISOString(),   timeZone: tz },
    })
    if (!res.error) movedIds.push(ev.id)
  }
  if (movedIds.length > 0) markAiMoved(movedIds)

  // Create the task event
  const scheduledTime = aiResponse.scheduledTime ?? '09:00'
  const start = new Date(`${task.dueDate}T${scheduledTime}:00`)
  const end   = new Date(start.getTime() + durationMins * 60000)

  const result = await createCalendarEvent(calendarId, {
    summary: task.title,
    description: task.description,
    start: { dateTime: start.toISOString(), timeZone: tz },
    end:   { dateTime: end.toISOString(),   timeZone: tz },
  })
  if (result.noAuth) return { success: false, error: 'Not signed in to Google.' }
  if (result.error)  return { success: false, error: result.error }

  return {
    success: true,
    gcalEventId: result.event?.id,
    scheduledTime,
    movedCount: movedIds.length,
  }
}

function findFallbackSlot(events: GCalEventWithCalendar[], durationMins: number): string {
  const timedEvents = events
    .filter(e => e.start.dateTime)
    .map(e => ({
      start: toMinutes(new Date(e.start.dateTime!).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })),
      end:   toMinutes(new Date(e.end.dateTime!).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })),
    }))
    .sort((a, b) => a.start - b.start)

  let cursor = 9 * 60  // 09:00
  const workEnd = 19 * 60
  for (const ev of timedEvents) {
    if (cursor + durationMins + 10 <= ev.start) return fromMinutes(cursor)
    cursor = Math.max(cursor, ev.end + 10)
  }
  if (cursor + durationMins <= workEnd) return fromMinutes(cursor)
  return '09:00'
}
