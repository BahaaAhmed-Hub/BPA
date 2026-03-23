/**
 * dbSync.ts — Supabase write helpers for manual save.
 * Each function maps the local app shape → DB row shape and upserts.
 */
import { supabase } from './supabase'
import type { DbCompany, DbHabit, DbHabitLog } from '@/types/database'

// ─── Types mirroring Settings local state ────────────────────────────────────

export interface AppSettings {
  fullName: string; timezone: string; workWeek: string[]; framework: string
  focusStart: string; focusEnd: string; earliestMeeting: string
  bufferMins: number; physicalBufferMins: number
  endOfDay: string; familyStart: string
  protectFocus: boolean; autoDeclineEarly: boolean
  commStyle: 'brief' | 'balanced' | 'detailed'; proactive: boolean
  briefTime: string; reviewDay: string; customInstructions: string
  morningReminderOn: boolean; morningReminderTime: string
  windDownOn: boolean; windDownTime: string; followUpNudges: boolean
  weeklyReviewOn: boolean; weeklyReviewDay: string; weeklyReviewTime: string
  theme: string; sidebarDefault: boolean; compact: boolean
}

export interface CompanyRow {
  id: string; name: string; color: string
  calendarId: string; emailDomain: string; accountId: string; isActive: boolean
}

export interface HabitRow {
  id: string; name: string; emoji: string; color: string
  frequency: 'daily' | 'weekdays' | 'weekly'; isActive: boolean; createdAt: string
}

export interface HabitLogs { [habitId: string]: string[] }

// ─── Get current session ──────────────────────────────────────────────────────

async function getSession() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Not signed in — please sign in with Google first')
  return data.session
}

// ─── Profile + Schedule → users row ──────────────────────────────────────────

export async function saveProfileToDB(s: AppSettings): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id
  const email   = session.user.email ?? ''

  const scheduleRules = {
    timezone:           s.timezone,
    work_week:          s.workWeek,
    focus_start:        s.focusStart,
    focus_end:          s.focusEnd,
    earliest_meeting:   s.earliestMeeting,
    buffer_mins:        s.bufferMins,
    physical_buffer:    s.physicalBufferMins,
    end_of_day:         s.endOfDay,
    family_start:       s.familyStart,
    protect_focus:      s.protectFocus,
    auto_decline_early: s.autoDeclineEarly,
  }

  // Use update first (row created by auth trigger); fall back to upsert with email
  const { error: updateErr } = await supabase.from('users')
    .update({ full_name: s.fullName, active_framework: s.framework, schedule_rules: scheduleRules })
    .eq('id', userId)

  if (updateErr) {
    // Row might not exist yet — upsert with all required fields
    const { error: upsertErr } = await supabase.from('users').upsert({
      id: userId, email,
      full_name: s.fullName, active_framework: s.framework, schedule_rules: scheduleRules,
    }, { onConflict: 'id' })
    if (upsertErr) throw new Error(upsertErr.message)
  }
}

// ─── Professor AI + Notifications + Appearance → users.schedule_rules ────────

export async function savePrefsToDB(s: AppSettings): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id
  const email   = session.user.email ?? ''

  // Read existing schedule_rules — ignore "no rows" error
  const { data: existing } = await supabase
    .from('users').select('schedule_rules').eq('id', userId).maybeSingle()

  const merged = {
    ...(existing?.schedule_rules as Record<string, unknown> ?? {}),
    comm_style:            s.commStyle,
    proactive:             s.proactive,
    brief_time:            s.briefTime,
    review_day:            s.reviewDay,
    custom_instructions:   s.customInstructions,
    morning_reminder_on:   s.morningReminderOn,
    morning_reminder_time: s.morningReminderTime,
    wind_down_on:          s.windDownOn,
    wind_down_time:        s.windDownTime,
    follow_up_nudges:      s.followUpNudges,
    weekly_review_on:      s.weeklyReviewOn,
    weekly_review_day:     s.weeklyReviewDay,
    weekly_review_time:    s.weeklyReviewTime,
    theme:                 s.theme,
    sidebar_default:       s.sidebarDefault,
    compact:               s.compact,
  }

  const { error } = await supabase.from('users').upsert(
    { id: userId, email, schedule_rules: merged },
    { onConflict: 'id' },
  )
  if (error) throw new Error(error.message)
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function saveCompaniesToDB(companies: CompanyRow[]): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  const { data: existing } = await supabase
    .from('companies').select('id').eq('user_id', userId)
  const existingIds = (existing ?? []).map((r: { id: string }) => r.id)
  const keepIds     = companies.map(c => c.id)
  const toDelete    = existingIds.filter((id: string) => !keepIds.includes(id))

  if (toDelete.length) {
    const { error } = await supabase.from('companies').delete().in('id', toDelete)
    if (error) throw new Error(error.message)
  }

  if (companies.length) {
    const rows: DbCompany[] = companies.map(c => ({
      id:          c.id,
      user_id:     userId,
      name:        c.name,
      color_tag:   c.color,
      calendar_id: c.calendarId || null,
      is_active:   c.isActive,
    }))
    const { error } = await supabase.from('companies').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
}

export async function loadCompaniesFromDB(): Promise<CompanyRow[]> {
  const session = await getSession()
  const userId  = session.user.id
  const { data, error } = await supabase
    .from('companies').select('*').eq('user_id', userId)
  if (error || !data) return []
  return (data as DbCompany[]).map(r => ({
    id:          r.id,
    name:        r.name,
    color:       r.color_tag ?? '#6B7280',
    calendarId:  r.calendar_id ?? '',
    emailDomain: '',
    accountId:   '',
    isActive:    r.is_active ?? true,
  }))
}

// ─── Habits ───────────────────────────────────────────────────────────────────

export async function saveHabitsToDB(habits: HabitRow[]): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  const { data: existing } = await supabase
    .from('habits').select('id').eq('user_id', userId)
  const existingIds = (existing ?? []).map((r: { id: string }) => r.id)
  const keepIds     = habits.map(h => h.id)
  const toDelete    = existingIds.filter((id: string) => !keepIds.includes(id))

  if (toDelete.length) {
    const { error } = await supabase.from('habits').delete().in('id', toDelete)
    if (error) throw new Error(error.message)
  }

  if (habits.length) {
    const rows: DbHabit[] = habits.map(h => ({
      id:             h.id,
      user_id:        userId,
      name:           h.name,
      frequency:      h.frequency,
      current_streak: 0,
      longest_streak: 0,
      is_active:      h.isActive,
    }))
    const { error } = await supabase.from('habits').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
}

// ─── Habit logs ───────────────────────────────────────────────────────────────

export async function saveHabitLogsToDB(logs: HabitLogs): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  const rows: Omit<DbHabitLog, 'id'>[] = []
  for (const [habitId, dates] of Object.entries(logs)) {
    for (const date of dates) {
      rows.push({ habit_id: habitId, user_id: userId, date, completed: true })
    }
  }
  if (!rows.length) return

  const { error } = await supabase.from('habit_logs')
    .upsert(rows as DbHabitLog[], { onConflict: 'habit_id,date', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
}
