// Auto-aligned with supabase/migrations/20240001_initial_schema.sql

export interface DbUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  active_framework: string
  schedule_rules: Record<string, unknown>
  created_at: string
}

export interface DbCompany {
  id: string
  user_id: string
  name: string
  color_tag: string | null
  calendar_id: string | null
  is_active: boolean
}

export type DbQuadrant =
  | 'urgent_important'
  | 'important_not_urgent'
  | 'urgent_not_important'
  | 'neither'

export type DbTaskStatus = 'todo' | 'in_progress' | 'done' | 'deferred'

export interface DbTask {
  id: string
  user_id: string
  company_id: string | null
  title: string
  description: string | null
  quadrant: DbQuadrant | null
  effort_minutes: number | null
  due_date: string | null          // ISO date "YYYY-MM-DD"
  status: DbTaskStatus
  delegated_to: string | null
  done_looks_like: string | null
  created_at: string
  completed_at: string | null
}

export type DbHabitFrequency = 'daily' | 'weekdays' | 'weekly'

export interface DbHabit {
  id: string
  user_id: string
  name: string
  frequency: DbHabitFrequency
  current_streak: number
  longest_streak: number
  is_active: boolean
}

export interface DbHabitLog {
  id: string
  habit_id: string
  user_id: string
  date: string    // "YYYY-MM-DD"
  completed: boolean
}

export interface DbEnergyLog {
  id: string
  user_id: string
  date: string    // "YYYY-MM-DD"
  morning_level: number | null     // 1-5
  afternoon_level: number | null   // 1-5
  notes: string | null
}

export interface DbCalendarEvent {
  id: string
  user_id: string
  company_id: string | null
  google_event_id: string | null
  title: string
  start_time: string    // ISO timestamptz
  end_time: string
  location: string | null
  meeting_type: string | null
  prep_notes: string | null
  is_synced: boolean
}

export type DbEmailClassification = 'decision' | 'fyi' | 'waiting' | 'delegate'

export interface DbEmailAction {
  id: string
  user_id: string
  gmail_id: string | null
  subject: string | null
  from_email: string | null
  classification: DbEmailClassification | null
  suggested_reply: string | null
  status: string | null
  follow_up_date: string | null   // "YYYY-MM-DD"
}

export interface DbWeeklyReview {
  id: string
  user_id: string
  week_of: string       // "YYYY-MM-DD" (Monday of that week)
  shipped_count: number | null
  slipped_count: number | null
  focus_hours: number | null
  meeting_hours: number | null
  professor_insight: string | null
  created_at: string
}
