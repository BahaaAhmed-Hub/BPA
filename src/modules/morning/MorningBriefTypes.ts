import type { DbCalendarEvent } from '@/types/database'
import type { GCalEvent } from '@/lib/googleCalendar'

export interface RichMeetingEvent extends DbCalendarEvent {
  calendarId?: string
  calendarName?: string
  calendarColor?: string
  accountEmail?: string
  attendees?: GCalEvent['attendees']
  description?: string
  htmlLink?: string
  conferenceData?: GCalEvent['conferenceData']
}

export type CalCacheItem = {
  id: string
  accountEmail: string
  summary?: string
  backgroundColor?: string
}
