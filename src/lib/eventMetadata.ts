/**
 * eventMetadata — DB-backed persistence for per-event user overrides.
 *
 * Wraps the google_event_metadata Supabase table (created in migration 20250012).
 * Replaces localStorage keys: cal-event-statuses, and future prep note storage.
 * Falls back gracefully on error.
 *
 * Design:
 *   - upsertEventStatus(accountId, eventId, calendarId, status) → saves to DB
 *   - loadEventStatuses() → { [eventId]: status } map for all of this user's events
 *   - upsertPrepNotes(accountId, eventId, calendarId, notes) → saves prep to DB
 *   - syncEventMetadataToLocalStorage() → bridges DB state into localStorage
 */

import { supabase } from './supabase'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EventStatus = 'done' | 'cancelled'

export interface EventMetadataRow {
  id:          string
  user_id:     string
  account_id:  string
  event_id:    string
  calendar_id: string
  status:      EventStatus | null
  prep_notes:  string | null
  prep_error:  string | null
  prep_at:     string | null
  updated_at:  string
}

// ─── Status operations ─────────────────────────────────────────────────────────

/**
 * Upsert the status (done/cancelled) for an event.
 * Pass null to clear the status.
 */
export async function upsertEventStatus(
  accountId:  string,
  eventId:    string,
  calendarId: string,
  status:     EventStatus | null,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('google_event_metadata')
    .upsert(
      {
        user_id:    user.id,
        account_id: accountId,
        event_id:   eventId,
        calendar_id: calendarId,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,event_id', ignoreDuplicates: false }
    )

  if (error) {
    console.warn('[eventMetadata] upsertStatus error:', error)
    return false
  }
  return true
}

/**
 * Load all event metadata rows for the signed-in user.
 */
export async function loadAllEventMetadata(): Promise<EventMetadataRow[]> {
  const { data, error } = await supabase
    .from('google_event_metadata')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    console.warn('[eventMetadata] loadAll error:', error)
    return []
  }
  return (data ?? []) as EventMetadataRow[]
}

/**
 * Load a compact { eventId → status } map. Efficient for bulk status rendering.
 */
export async function loadEventStatusMap(): Promise<Record<string, EventStatus>> {
  const { data, error } = await supabase
    .from('google_event_metadata')
    .select('event_id, status')
    .not('status', 'is', null)

  if (error) {
    console.warn('[eventMetadata] loadStatusMap error:', error)
    return {}
  }

  const map: Record<string, EventStatus> = {}
  for (const row of data ?? []) {
    if (row.status) map[row.event_id as string] = row.status as EventStatus
  }
  return map
}

// ─── Prep notes operations ─────────────────────────────────────────────────────

/**
 * Save AI prep notes for an event.
 */
export async function upsertPrepNotes(
  accountId:  string,
  eventId:    string,
  calendarId: string,
  prepNotes:  string,
  prepError?: string | null,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('google_event_metadata')
    .upsert(
      {
        user_id:    user.id,
        account_id: accountId,
        event_id:   eventId,
        calendar_id: calendarId,
        prep_notes: prepNotes,
        prep_error: prepError ?? null,
        prep_at:    new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,event_id', ignoreDuplicates: false }
    )

  if (error) {
    console.warn('[eventMetadata] upsertPrep error:', error)
    return false
  }
  return true
}

/**
 * Delete all metadata for an account (called when account is removed).
 */
export async function deleteEventMetadataForAccount(accountId: string): Promise<void> {
  const { error } = await supabase
    .from('google_event_metadata')
    .delete()
    .eq('account_id', accountId)

  if (error) console.warn('[eventMetadata] delete error:', error)
}

// ─── localStorage bridge ───────────────────────────────────────────────────────
// During migration: write DB state into the localStorage key that CalendarIntelligence
// currently reads so existing code picks it up without refactoring.

const LS_STATUSES_KEY = 'cal-event-statuses'

export async function syncEventMetadataToLocalStorage(): Promise<void> {
  const rows = await loadAllEventMetadata()
  if (!rows.length) return

  try {
    const map: Record<string, EventStatus> = {}
    for (const row of rows) {
      if (row.status) map[row.event_id] = row.status
    }
    localStorage.setItem(LS_STATUSES_KEY, JSON.stringify(map))
  } catch { /* quota */ }
}
