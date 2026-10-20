import type { EventMeta } from './types'

/** The part of a Google event a link remembers. Typed structurally so this file
 *  does not import the calendar's own (very large) module. */
export interface EventLike {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  calendarId?: string
}

export function eventMeta(ev: EventLike): EventMeta {
  const allDay = !ev.start.dateTime
  return {
    title: (ev.summary ?? '').trim() || '(No title)',
    start: ev.start.dateTime ?? ev.start.date ?? '',
    ...(ev.end ? { end: ev.end.dateTime ?? ev.end.date } : {}),
    allDay,
    ...(ev.calendarId ? { calendarId: ev.calendarId } : {}),
  }
}

export const sameMeta = (a: unknown, b: EventMeta): boolean => {
  const m = a as Partial<EventMeta> | undefined
  return !!m && m.title === b.title && m.start === b.start && (m.end ?? '') === (b.end ?? '')
    && m.allDay === b.allDay && (m.calendarId ?? '') === (b.calendarId ?? '')
}
