/**
 * calendarSettings — DB-backed persistence for per-calendar display preferences.
 *
 * Wraps the google_calendar_settings Supabase table (created in migration 20250011).
 * Falls back to localStorage on error so the UI never breaks during the transition.
 *
 * Design:
 *   - getCalendarSetting(accountId, calendarId) → row or null
 *   - upsertCalendarSetting(accountId, calendarId, patch) → saves to DB
 *   - loadAllCalendarSettings() → all rows for the current user
 *
 * The Settings UI and CalendarIntelligence can call these instead of writing
 * directly to localStorage keys like cal-intel-colors, cal-intel-hidden-*, etc.
 */

import { supabase } from './supabase'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarSettingRow {
  id:           string
  user_id:      string
  account_id:   string
  calendar_id:  string
  is_visible:   boolean
  custom_color: string | null
  display_name: string | null
  sort_order:   number
  updated_at:   string
}

export type CalendarSettingPatch = Partial<Pick<
  CalendarSettingRow,
  'is_visible' | 'custom_color' | 'display_name' | 'sort_order'
>>

// ─── CRUD helpers ──────────────────────────────────────────────────────────────

/**
 * Load all calendar settings rows for the signed-in user.
 * Returns [] on error.
 */
export async function loadAllCalendarSettings(): Promise<CalendarSettingRow[]> {
  const { data, error } = await supabase
    .from('google_calendar_settings')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.warn('[calendarSettings] loadAll error:', error)
    return []
  }
  return (data ?? []) as CalendarSettingRow[]
}

/**
 * Get a single calendar setting row by calendar_id.
 * Returns null if not found or on error.
 */
export async function getCalendarSetting(
  calendarId: string,
): Promise<CalendarSettingRow | null> {
  const { data, error } = await supabase
    .from('google_calendar_settings')
    .select('*')
    .eq('calendar_id', calendarId)
    .maybeSingle()

  if (error) {
    console.warn('[calendarSettings] get error:', error)
    return null
  }
  return data as CalendarSettingRow | null
}

/**
 * Upsert a calendar setting. `accountId` must be a valid google_accounts.id.
 * Returns true on success, false on error.
 */
export async function upsertCalendarSetting(
  accountId: string,
  calendarId: string,
  patch: CalendarSettingPatch,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('google_calendar_settings')
    .upsert(
      {
        user_id:    user.id,
        account_id: accountId,
        calendar_id: calendarId,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,calendar_id', ignoreDuplicates: false }
    )

  if (error) {
    console.warn('[calendarSettings] upsert error:', error)
    return false
  }
  return true
}

/**
 * Delete a calendar setting row (e.g. when account is removed).
 */
export async function deleteCalendarSettings(accountId: string): Promise<void> {
  const { error } = await supabase
    .from('google_calendar_settings')
    .delete()
    .eq('account_id', accountId)

  if (error) console.warn('[calendarSettings] delete error:', error)
}

// ─── localStorage bridge ───────────────────────────────────────────────────────
// During migration: sync DB state into the localStorage keys that the existing
// CalendarIntelligence reads. Call this once on app start / after sign-in.

const LS_COLORS_KEY  = 'cal-intel-colors'
const LS_HIDDEN_KEY  = 'cal-intel-hidden'

export async function syncCalendarSettingsToLocalStorage(): Promise<void> {
  const rows = await loadAllCalendarSettings()
  if (!rows.length) return

  // Merge custom colors into localStorage
  try {
    const existing: Record<string, string> = JSON.parse(
      localStorage.getItem(LS_COLORS_KEY) ?? '{}'
    )
    for (const row of rows) {
      if (row.custom_color) existing[row.calendar_id] = row.custom_color
      else delete existing[row.calendar_id]
    }
    localStorage.setItem(LS_COLORS_KEY, JSON.stringify(existing))
  } catch { /* quota */ }

  // Merge visibility (hidden calendars) into localStorage
  try {
    const hidden = new Set<string>(
      JSON.parse(localStorage.getItem(LS_HIDDEN_KEY) ?? '[]') as string[]
    )
    for (const row of rows) {
      if (!row.is_visible) hidden.add(row.calendar_id)
      else hidden.delete(row.calendar_id)
    }
    localStorage.setItem(LS_HIDDEN_KEY, JSON.stringify([...hidden]))
  } catch { /* quota */ }
}
