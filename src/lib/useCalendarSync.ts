/**
 * useCalendarSync — React hook for fetching and auto-refreshing calendar data.
 *
 * Architecture:
 *   - On mount: fetches calendars + events for the current week via the
 *     google-calendar-sync edge function (tokens never leave the server).
 *   - Every 2 minutes: re-fetches events to pick up changes from other clients
 *     or external edits in Google Calendar.
 *   - Provides: calendars, events, loading state, error, and manual refresh fn.
 *
 * Usage:
 *   const { calendars, events, loading, refresh } = useCalendarSync({ weekStart, weekEnd })
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SyncCalendar {
  id:               string
  summary?:         string
  backgroundColor?: string
  foregroundColor?: string
  primary?:         boolean
  accessRole?:      string
  accountEmail:     string
  accountId:        string
  accountName?:     string | null
  accountAvatarUrl?: string | null
  isPrimaryAccount: boolean
}

export interface SyncEvent {
  id:               string
  summary?:         string
  description?:     string
  location?:        string
  status?:          string
  htmlLink?:        string
  start:            { dateTime?: string; date?: string; timeZone?: string }
  end:              { dateTime?: string; date?: string; timeZone?: string }
  attendees?:       { email: string; displayName?: string; responseStatus?: string; self?: boolean }[]
  organizer?:       { email?: string; displayName?: string; self?: boolean }
  conferenceData?:  { entryPoints?: { entryPointType: string; uri: string; label?: string }[]; createRequest?: unknown }
  recurringEventId?: string
  recurrence?:      string[]
  reminders?:       { useDefault: boolean; overrides?: { method: string; minutes: number }[] }
  calendarId:       string
  accountEmail:     string
  accountId:        string
  isPrimaryAccount: boolean
}

export interface CalendarSyncState {
  calendars:       SyncCalendar[]
  events:          SyncEvent[]
  loading:         boolean
  eventsLoading:   boolean
  error:           string | null
  needsReconnect:  string[]   // emails that need re-auth
  refresh:         () => void
  refreshEvents:   () => void
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 2 * 60 * 1000   // 2 minutes

interface UseCalendarSyncOptions {
  weekStart: Date
  weekEnd:   Date
  enabled?:  boolean   // default true; set false to pause syncing
}

export function useCalendarSync({
  weekStart,
  weekEnd,
  enabled = true,
}: UseCalendarSyncOptions): CalendarSyncState {
  const [calendars,      setCalendars]      = useState<SyncCalendar[]>([])
  const [events,         setEvents]         = useState<SyncEvent[]>([])
  const [loading,        setLoading]        = useState(true)
  const [eventsLoading,  setEventsLoading]  = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState<string[]>([])

  // Stable refs so interval callbacks don't capture stale values
  const weekStartRef = useRef(weekStart)
  const weekEndRef   = useRef(weekEnd)
  useEffect(() => { weekStartRef.current = weekStart }, [weekStart])
  useEffect(() => { weekEndRef.current   = weekEnd   }, [weekEnd])

  // ── fetchCalendars ──────────────────────────────────────────────────────────

  const fetchCalendars = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('google-calendar-sync', {
      body: { action: 'list_calendars' },
    })
    if (fnErr) {
      setError(fnErr.message)
      setLoading(false)
      return
    }
    const cals: SyncCalendar[] = data?.calendars ?? []
    setCalendars(cals)
    if (data?.needsReconnect?.length) {
      setNeedsReconnect(prev => {
        const combined = new Set([...prev, ...(data.needsReconnect as string[])])
        return [...combined]
      })
      for (const email of data.needsReconnect as string[]) {
        window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email } }))
      }
    }
    setLoading(false)
  }, [])

  // ── fetchEvents ─────────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true)
    const { data, error: fnErr } = await supabase.functions.invoke('google-calendar-sync', {
      body: {
        action:   'list_events',
        time_min: weekStartRef.current.toISOString(),
        time_max: weekEndRef.current.toISOString(),
      },
    })
    if (fnErr) {
      console.warn('[useCalendarSync] events fetch error:', fnErr.message)
      setEventsLoading(false)
      return
    }
    const evs: SyncEvent[] = (data?.events ?? []).filter(
      (e: SyncEvent) => e.status !== 'cancelled'
    )
    setEvents(evs)
    if (data?.needsReconnect?.length) {
      setNeedsReconnect(prev => {
        const combined = new Set([...prev, ...(data.needsReconnect as string[])])
        return [...combined]
      })
      for (const email of data.needsReconnect as string[]) {
        window.dispatchEvent(new CustomEvent('cal:reconnect-required', { detail: { email } }))
      }
    }
    setEventsLoading(false)
  }, [])

  // ── Initial load ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return
    void fetchCalendars()
    void fetchEvents()
  }, [enabled, fetchCalendars, fetchEvents])

  // ── Auto-refresh events every 2 minutes ────────────────────────────────────

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => { void fetchEvents() }, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [enabled, fetchEvents])

  // ── Refresh on week change ──────────────────────────────────────────────────

  const weekKey = `${weekStart.toISOString()}|${weekEnd.toISOString()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (enabled) void fetchEvents() }, [weekKey, enabled])

  return {
    calendars,
    events,
    loading,
    eventsLoading,
    error,
    needsReconnect,
    refresh:       fetchCalendars,
    refreshEvents: fetchEvents,
  }
}
