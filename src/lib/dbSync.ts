/**
 * dbSync.ts — Supabase write/read helpers. All app data synced to DB.
 * Run supabase/migrations/20240002_extend_schema.sql before deploying.
 */
import { supabase } from './supabase'
import type { DbCompany, DbHabit, DbHabitLog } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface CompanyUser { id: string; name: string; email?: string }

export interface CompanyRow {
  id: string; name: string; color: string
  calendarId: string; emailDomain: string; accountId: string; isActive: boolean
  users: CompanyUser[]
}

export interface TaskRow {
  id: string; title: string; quadrant: string | null; company: string
  companyId?: string; status: string; completed: boolean
  dueDate?: string; duration?: number; plannedTime?: string
  owner?: string; urgent?: boolean; taskType?: string; createdAt: string
}

export interface HabitRow {
  id: string; name: string; emoji: string; color: string
  frequency: 'daily' | 'weekdays' | 'weekly'; isActive: boolean; createdAt: string
}

export interface HabitLogs { [habitId: string]: string[] }

export interface ConnectedAccount {
  id: string; email: string; name: string; avatarUrl?: string
  providerToken: string; scopes: string[]; connectedAt: string; isPrimary: boolean
}

// ─── Session ──────────────────────────────────────────────────────────────────

async function getSession() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Not signed in')
  return data.session
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function quadrantToDb(q: string | null): string | null {
  const map: Record<string, string> = {
    do: 'urgent_important', schedule: 'important_not_urgent',
    delegate: 'urgent_not_important', eliminate: 'neither',
  }
  return q ? (map[q] ?? null) : null
}

function quadrantFromDb(q: string | null): string | null {
  const map: Record<string, string> = {
    urgent_important: 'do', important_not_urgent: 'schedule',
    urgent_not_important: 'delegate', neither: 'eliminate',
  }
  return q ? (map[q] ?? null) : null
}

function statusToDb(s: string): string {
  const map: Record<string, string> = { open: 'todo', in_progress: 'in_progress', done: 'done', cancelled: 'deferred' }
  return map[s] ?? 'todo'
}

function statusFromDb(s: string): string {
  const map: Record<string, string> = { todo: 'open', in_progress: 'in_progress', done: 'done', deferred: 'cancelled' }
  return map[s] ?? 'open'
}

// ─── Profile + Schedule ───────────────────────────────────────────────────────

export async function saveProfileToDB(s: AppSettings): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id
  const email   = session.user.email ?? ''

  // Load existing schedule_rules to merge (preserve connected_accounts etc.)
  const { data: existing } = await supabase
    .from('users').select('schedule_rules').eq('id', userId).maybeSingle()
  const prev = (existing?.schedule_rules as Record<string, unknown>) ?? {}

  const scheduleRules = {
    ...prev,
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

  const { error } = await supabase.from('users').upsert(
    { id: userId, email, full_name: s.fullName, active_framework: s.framework, schedule_rules: scheduleRules },
    { onConflict: 'id' },
  )
  if (error) throw new Error(error.message)
}

// ─── Professor AI + Notifications + Appearance ────────────────────────────────

export async function savePrefsToDB(s: AppSettings): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id
  const email   = session.user.email ?? ''

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

// Load all settings from DB → merge into AppSettings defaults
export async function loadSettingsFromDB(defaults: AppSettings): Promise<AppSettings> {
  const session = await getSession()
  const { data } = await supabase
    .from('users').select('full_name, active_framework, schedule_rules').eq('id', session.user.id).maybeSingle()
  if (!data) return defaults
  const r = (data.schedule_rules as Record<string, unknown>) ?? {}
  return {
    fullName:            (data.full_name as string) || defaults.fullName,
    framework:           (data.active_framework as string) || defaults.framework,
    timezone:            (r.timezone as string) || defaults.timezone,
    workWeek:            (r.work_week as string[]) || defaults.workWeek,
    focusStart:          (r.focus_start as string) || defaults.focusStart,
    focusEnd:            (r.focus_end as string) || defaults.focusEnd,
    earliestMeeting:     (r.earliest_meeting as string) || defaults.earliestMeeting,
    bufferMins:          (r.buffer_mins as number) ?? defaults.bufferMins,
    physicalBufferMins:  (r.physical_buffer as number) ?? defaults.physicalBufferMins,
    endOfDay:            (r.end_of_day as string) || defaults.endOfDay,
    familyStart:         (r.family_start as string) || defaults.familyStart,
    protectFocus:        (r.protect_focus as boolean) ?? defaults.protectFocus,
    autoDeclineEarly:    (r.auto_decline_early as boolean) ?? defaults.autoDeclineEarly,
    commStyle:           (r.comm_style as AppSettings['commStyle']) || defaults.commStyle,
    proactive:           (r.proactive as boolean) ?? defaults.proactive,
    briefTime:           (r.brief_time as string) || defaults.briefTime,
    reviewDay:           (r.review_day as string) || defaults.reviewDay,
    customInstructions:  (r.custom_instructions as string) || defaults.customInstructions,
    morningReminderOn:   (r.morning_reminder_on as boolean) ?? defaults.morningReminderOn,
    morningReminderTime: (r.morning_reminder_time as string) || defaults.morningReminderTime,
    windDownOn:          (r.wind_down_on as boolean) ?? defaults.windDownOn,
    windDownTime:        (r.wind_down_time as string) || defaults.windDownTime,
    followUpNudges:      (r.follow_up_nudges as boolean) ?? defaults.followUpNudges,
    weeklyReviewOn:      (r.weekly_review_on as boolean) ?? defaults.weeklyReviewOn,
    weeklyReviewDay:     (r.weekly_review_day as string) || defaults.weeklyReviewDay,
    weeklyReviewTime:    (r.weekly_review_time as string) || defaults.weeklyReviewTime,
    theme:               (r.theme as string) || defaults.theme,
    sidebarDefault:      (r.sidebar_default as boolean) ?? defaults.sidebarDefault,
    compact:             (r.compact as boolean) ?? defaults.compact,
  }
}

// ─── Companies (full — with users, emailDomain, accountId) ───────────────────

type DbCompanyExtended = DbCompany & {
  email_domain?: string | null
  account_id?: string | null
  users_data?: CompanyUser[] | null
}

export async function saveCompaniesToDB(companies: CompanyRow[]): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  const { data: existing } = await supabase
    .from('companies').select('id').eq('user_id', userId)
  const existingIds = (existing ?? []).map((r: { id: string }) => r.id)
  const keepIds     = companies.map(c => c.id)
  const toDelete    = existingIds.filter((id: string) => !keepIds.includes(id))

  if (toDelete.length) {
    await supabase.from('companies').delete().in('id', toDelete)
  }

  if (companies.length) {
    const rows = companies.map(c => ({
      id:           c.id,
      user_id:      userId,
      name:         c.name,
      color_tag:    c.color,
      calendar_id:  c.calendarId || null,
      is_active:    c.isActive,
      email_domain: c.emailDomain || null,
      account_id:   c.accountId || null,
      users_data:   c.users ?? [],
    }))

    const { error } = await supabase.from('companies').upsert(rows, { onConflict: 'id' })
    if (error) {
      // Migration not run yet — fall back to base columns only
      const baseRows = rows.map(({ id, user_id, name, color_tag, calendar_id, is_active }) =>
        ({ id, user_id, name, color_tag, calendar_id, is_active })
      )
      const { error: baseError } = await supabase.from('companies').upsert(baseRows, { onConflict: 'id' })
      if (baseError) throw new Error(baseError.message)
    }
  }
}

export async function loadCompaniesFromDB(): Promise<CompanyRow[]> {
  const session = await getSession()
  const userId  = session.user.id
  const { data, error } = await supabase
    .from('companies').select('*').eq('user_id', userId)
  if (error || !data) return []
  return (data as DbCompanyExtended[]).map(r => ({
    id:          r.id,
    name:        r.name,
    color:       r.color_tag ?? '#6B7280',
    calendarId:  r.calendar_id ?? '',
    emailDomain: r.email_domain ?? '',
    accountId:   r.account_id ?? '',
    isActive:    r.is_active ?? true,
    users:       (r.users_data as CompanyUser[]) ?? [],
  }))
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function saveTasksToDB(tasks: TaskRow[]): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  // Delete rows not in local list
  const { data: existing } = await supabase
    .from('tasks').select('id').eq('user_id', userId)
  const existingIds = (existing ?? []).map((r: { id: string }) => r.id)
  const keepIds     = tasks.map(t => t.id)
  const toDelete    = existingIds.filter((id: string) => !keepIds.includes(id))
  if (toDelete.length) {
    await supabase.from('tasks').delete().in('id', toDelete)
  }

  if (!tasks.length) return

  const rows = tasks.map(t => ({
    id:           t.id,
    user_id:      userId,
    company_id:   null as null,
    title:        t.title,
    description:  t.taskType ?? null,
    quadrant:     quadrantToDb(t.quadrant),
    effort_minutes: t.duration ?? null,
    due_date:     t.dueDate ?? null,
    status:       statusToDb(t.status),
    delegated_to: t.owner ?? null,
    done_looks_like: null as null,
    created_at:   t.createdAt,
    completed_at: t.completed ? new Date().toISOString() : null,
    // extended columns (from migration 20240002)
    planned_time: t.plannedTime ?? null,
    owner_id:     t.owner ?? null,
    // store dynamic companyId in company_tag when set, else static company tag
    company_tag:  t.companyId ?? t.company ?? null,
    completed:    t.completed,
  }))

  const { error } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function loadTasksFromDB(): Promise<TaskRow[]> {
  const session = await getSession()
  const userId  = session.user.id
  const { data, error } = await supabase
    .from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: true })
  if (error || !data) return []

  const STATIC_TAGS = new Set(['teradix', 'dxtech', 'consulting', 'personal'])
  return (data as (Record<string, unknown>)[]).map(r => {
    const tag = (r.company_tag as string) || ''
    // If tag is a dynamic companyId (not a known static tag), store in companyId
    const isDynamic = tag && !STATIC_TAGS.has(tag)
    return {
      id:          r.id as string,
      title:       r.title as string,
      quadrant:    quadrantFromDb(r.quadrant as string | null),
      company:     (isDynamic ? 'personal' : tag) as string || 'teradix',
      ...(isDynamic ? { companyId: tag } : {}),
      status:      statusFromDb(r.status as string),
      completed:   (r.completed as boolean) ?? (r.completed_at != null),
      dueDate:     (r.due_date as string) ?? undefined,
      duration:    (r.effort_minutes as number) ?? undefined,
      plannedTime: (r.planned_time as string) ?? undefined,
      owner:       (r.delegated_to as string) ?? (r.owner_id as string) ?? undefined,
      createdAt:   r.created_at as string,
      ...(r.description ? { taskType: r.description as string } : {}),
    }
  })
}

// ─── Connected accounts → users.schedule_rules.connected_accounts ─────────────

export async function saveAccountsToDB(accounts: ConnectedAccount[]): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  const { data: existing } = await supabase
    .from('users').select('schedule_rules').eq('id', userId).maybeSingle()
  const prev = (existing?.schedule_rules as Record<string, unknown>) ?? {}

  // Strip tokens before saving to DB for security — store metadata only
  const safe = accounts.map(a => ({
    id: a.id, email: a.email, name: a.name, avatarUrl: a.avatarUrl,
    scopes: a.scopes, connectedAt: a.connectedAt, isPrimary: a.isPrimary,
  }))

  const { error } = await supabase.from('users').update({
    schedule_rules: { ...prev, connected_accounts: safe },
  }).eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function loadAccountsFromDB(): Promise<Omit<ConnectedAccount, 'providerToken'>[]> {
  const session = await getSession()
  const { data } = await supabase
    .from('users').select('schedule_rules').eq('id', session.user.id).maybeSingle()
  const r = (data?.schedule_rules as Record<string, unknown>) ?? {}
  return (r.connected_accounts as Omit<ConnectedAccount, 'providerToken'>[]) ?? []
}

/** Load only the fields that actually exist in DB (no defaults needed). */
export async function loadRawSettingsFromDB(): Promise<Partial<AppSettings>> {
  try {
    const session = await getSession()
    const { data } = await supabase
      .from('users').select('full_name, active_framework, schedule_rules')
      .eq('id', session.user.id).maybeSingle()
    if (!data) return {}
    const r = (data.schedule_rules as Record<string, unknown>) ?? {}
    const out: Partial<AppSettings> = {}
    if (data.full_name)               out.fullName              = data.full_name as string
    if (data.active_framework)        out.framework             = data.active_framework as string
    if (r.timezone)                   out.timezone              = r.timezone as string
    if (r.work_week)                  out.workWeek              = r.work_week as string[]
    if (r.focus_start)                out.focusStart            = r.focus_start as string
    if (r.focus_end)                  out.focusEnd              = r.focus_end as string
    if (r.earliest_meeting)           out.earliestMeeting       = r.earliest_meeting as string
    if (r.buffer_mins        != null) out.bufferMins            = r.buffer_mins as number
    if (r.physical_buffer    != null) out.physicalBufferMins    = r.physical_buffer as number
    if (r.end_of_day)                 out.endOfDay              = r.end_of_day as string
    if (r.family_start)               out.familyStart           = r.family_start as string
    if (r.protect_focus      != null) out.protectFocus          = r.protect_focus as boolean
    if (r.auto_decline_early != null) out.autoDeclineEarly      = r.auto_decline_early as boolean
    if (r.comm_style)                 out.commStyle             = r.comm_style as AppSettings['commStyle']
    if (r.proactive          != null) out.proactive             = r.proactive as boolean
    if (r.brief_time)                 out.briefTime             = r.brief_time as string
    if (r.review_day)                 out.reviewDay             = r.review_day as string
    if (r.custom_instructions)        out.customInstructions    = r.custom_instructions as string
    if (r.morning_reminder_on   != null) out.morningReminderOn   = r.morning_reminder_on as boolean
    if (r.morning_reminder_time)         out.morningReminderTime = r.morning_reminder_time as string
    if (r.wind_down_on          != null) out.windDownOn          = r.wind_down_on as boolean
    if (r.wind_down_time)                out.windDownTime        = r.wind_down_time as string
    if (r.follow_up_nudges      != null) out.followUpNudges      = r.follow_up_nudges as boolean
    if (r.weekly_review_on      != null) out.weeklyReviewOn      = r.weekly_review_on as boolean
    if (r.weekly_review_day)             out.weeklyReviewDay     = r.weekly_review_day as string
    if (r.weekly_review_time)            out.weeklyReviewTime    = r.weekly_review_time as string
    if (r.theme)                         out.theme               = r.theme as string
    if (r.sidebar_default       != null) out.sidebarDefault      = r.sidebar_default as boolean
    if (r.compact               != null) out.compact             = r.compact as boolean
    return out
  } catch { return {} }
}

// ─── Habits ───────────────────────────────────────────────────────────────────

export async function saveHabitsToDB(habits: HabitRow[]): Promise<void> {
  const session = await getSession()
  const userId  = session.user.id

  const { data: existing } = await supabase
    .from('habits').select('id').eq('user_id', userId)
  const existingIds = (existing ?? []).map((r: { id: string }) => r.id)
  const toDelete    = existingIds.filter((id: string) => !habits.map(h => h.id).includes(id))

  if (toDelete.length) {
    await supabase.from('habits').delete().in('id', toDelete)
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

export async function loadHabitsFromDB(): Promise<HabitRow[]> {
  const session = await getSession()
  const userId  = session.user.id
  const { data, error } = await supabase
    .from('habits').select('*').eq('user_id', userId)
  if (error || !data) return []
  return (data as (DbHabit & { emoji?: string; color?: string; created_at?: string })[]).map(r => ({
    id: r.id, name: r.name,
    emoji:     r.emoji     ?? '✅',
    color:     r.color     ?? '#1E40AF',
    frequency: (r.frequency as HabitRow['frequency']) ?? 'daily',
    isActive:  r.is_active ?? true,
    createdAt: r.created_at ?? new Date().toISOString(),
  }))
}

export async function loadHabitLogsFromDB(): Promise<HabitLogs> {
  const session = await getSession()
  const userId  = session.user.id
  const { data, error } = await supabase
    .from('habit_logs').select('habit_id, date').eq('user_id', userId)
  if (error || !data) return {}
  const logs: HabitLogs = {}
  for (const row of data as { habit_id: string; date: string }[]) {
    if (!logs[row.habit_id]) logs[row.habit_id] = []
    logs[row.habit_id].push(row.date)
  }
  return logs
}
