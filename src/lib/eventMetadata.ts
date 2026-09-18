/**
 * eventMetadata — DB-backed persistence for per-event user overrides.
 *
 * Wraps the google_event_metadata Supabase table (migration 20250012 +
 * 20260018). account_id is now nullable (SET NULL on account removal) and
 * account_email is stored alongside it so rows can be relinked when the same
 * email is reconnected with a new google_accounts UUID.
 */

import { supabase } from './supabase'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EventStatus = 'done' | 'cancelled'

export interface EventMetadataRow {
  id:            string
  user_id:       string
  account_id:    string | null
  account_email: string | null
  event_id:      string
  calendar_id:   string
  status:        EventStatus | null
  prep_notes:    string | null
  prep_error:    string | null
  prep_at:       string | null
  updated_at:    string
}

// ─── Status operations ─────────────────────────────────────────────────────────

export async function upsertEventStatus(
  accountId:    string,
  eventId:      string,
  calendarId:   string,
  status:       EventStatus | null,
  accountEmail?: string,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('google_event_metadata')
    .upsert(
      {
        user_id:       user.id,
        account_id:    accountId,
        account_email: accountEmail ?? null,
        event_id:      eventId,
        calendar_id:   calendarId,
        status,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,event_id', ignoreDuplicates: false }
    )

  if (error) {
    console.warn('[eventMetadata] upsertStatus error:', error)
    return false
  }
  return true
}

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

export async function upsertPrepNotes(
  accountId:    string,
  eventId:      string,
  calendarId:   string,
  prepNotes:    string,
  prepError?:   string | null,
  accountEmail?: string,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('google_event_metadata')
    .upsert(
      {
        user_id:       user.id,
        account_id:    accountId,
        account_email: accountEmail ?? null,
        event_id:      eventId,
        calendar_id:   calendarId,
        prep_notes:    prepNotes,
        prep_error:    prepError ?? null,
        prep_at:       new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,event_id', ignoreDuplicates: false }
    )

  if (error) {
    console.warn('[eventMetadata] upsertPrep error:', error)
    return false
  }
  return true
}

// ─── Relink after reconnect ────────────────────────────────────────────────────
// When a Google account is reconnected, a new google_accounts row is created
// with a new UUID. Rows whose account_id was SET NULL (account removed) but
// whose account_email matches get re-pointed to the new UUID.

export async function relinkEventMetadata(
  newAccountId: string,
  email:        string,
): Promise<void> {
  const { error } = await supabase
    .from('google_event_metadata')
    .update({ account_id: newAccountId, updated_at: new Date().toISOString() })
    .eq('account_email', email)
    .is('account_id', null)

  if (error) console.warn('[eventMetadata] relink error:', error)
  else console.log('[eventMetadata] relinked rows for', email, '→', newAccountId)
}

// ─── localStorage bridge ───────────────────────────────────────────────────────

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
