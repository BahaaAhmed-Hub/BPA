import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Calendar, Users, Video,
  CheckCircle2, Circle, Sparkles,
} from 'lucide-react'
import { planMyDay } from '@/lib/professor'
import type { DayPlan, DayContext } from '@/lib/professor'
import { fetchWeekEvents, detectMeetingType } from '@/lib/googleCalendar'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { DbUser, DbCompany, DbCalendarEvent, DbTask } from '@/types/database'
import type { Task } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const CO_COLOR: Record<string, string> = {
  teradix:    '#1E40AF',
  dxtech:     '#7F77DD',
  consulting: '#1D9E75',
  personal:   '#888780',
}

const CO_NAME: Record<string, string> = {
  teradix:    'Teradix',
  dxtech:     'DX Tech',
  consulting: 'Consulting',
  personal:   'Personal',
}

const ENERGY_META = [
  null,
  { label: 'Depleted', color: '#888780' },
  { label: 'Low',      color: '#FFFFFF' },
  { label: 'Steady',   color: '#1E40AF' },
  { label: 'Energized',color: '#1D9E75' },
  { label: 'Peak',     color: '#7F77DD' },
] as const

const QUADRANT_MAP: Record<string, DbTask['quadrant']> = {
  do:       'urgent_important',
  schedule: 'important_not_urgent',
  delegate: 'urgent_not_important',
  eliminate:'neither',
}

const MOCK_COMPANIES: DbCompany[] = [
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: '#1E40AF', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: '#1D9E75', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: '#888780', calendar_id: null, is_active: true },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadStoredHabits(): { id: string; name: string }[] {
  try {
    const raw = localStorage.getItem('professor-habits')
    if (!raw) return []
    return (JSON.parse(raw) as { id: string; name: string }[]).slice(0, 6)
  } catch { return [] }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function getFirstName(name: string | null | undefined, email: string): string {
  if (name) return name.trim().split(' ')[0]
  return email.split('@')[0]
}

function buildMockUser(user: { id: string; email: string; name?: string; avatarUrl?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo',
    email: user?.email ?? 'bahaa@example.com',
    full_name: user?.name ?? 'Bahaa Ahmed',
    avatar_url: user?.avatarUrl ?? null,
    active_framework: 'time_blocking',
    schedule_rules: {
      focus_hours: '09:00–12:00',
      buffer_minutes: 15,
      no_meeting_days: 'Wednesday',
      max_meetings_per_day: 4,
    },
    created_at: new Date().toISOString(),
  }
}

function buildContext(dbUser: DbUser, tasks: Task[], energyLevel: number | null, todayEvents: DbCalendarEvent[]): DayContext {
  const pendingTasks: DbTask[] = tasks
    .filter(t => !t.completed)
    .map(t => ({
      id: t.id,
      user_id: dbUser.id,
      company_id: t.company,
      title: t.title,
      description: t.description ?? null,
      quadrant: QUADRANT_MAP[t.quadrant] ?? null,
      effort_minutes: null,
      due_date: t.dueDate ?? null,
      status: 'todo' as const,
      delegated_to: null,
      done_looks_like: null,
      created_at: t.createdAt,
      completed_at: null,
    }))

  return {
    user: dbUser,
    companies: MOCK_COMPANIES,
    todayEvents,
    pendingTasks,
    energyLevel: energyLevel ?? undefined,
    date: todayKey(),
  }
}

function loadCachedPlan(): DayPlan | null {
  try {
    const raw = localStorage.getItem(`professor-dayplan-${todayKey()}`)
    return raw ? (JSON.parse(raw) as DayPlan) : null
  } catch {
    return null
  }
}

function savePlan(plan: DayPlan): void {
  try {
    localStorage.setItem(`professor-dayplan-${todayKey()}`, JSON.stringify(plan))
  } catch { /* quota full — skip */ }
}

function matchCompany(title: string, tasks: Task[]): string | null {
  const t = title.toLowerCase()
  const match = tasks.find(task =>
    task.title.toLowerCase().includes(t.slice(0, 12)) ||
    t.includes(task.title.toLowerCase().slice(0, 12)),
  )
  return match?.company ?? null
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = '100%', h = 14, radius = 8 }: { w?: string | number; h?: number; radius?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        background: 'linear-gradient(90deg, #252A3E 25%, #4A3E28 50%, #252A3E 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s infinite',
        flexShrink: 0,
      }}
    />
  )
}

function PlanSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Skel w={52} h={13} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <Skel w={`${70 - i * 8}%`} h={13} />
            {i % 2 === 0 && <Skel w="25%" h={10} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function PrioritySkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#161929', border: '1px solid #252A3E',
            borderRadius: 12, padding: '14px 16px',
          }}
        >
          <Skel w={32} h={32} radius={50} />
          <Skel w={`${60 - i * 8}%`} h={14} />
        </div>
      ))}
    </div>
  )
}

// ─── Meeting icon ──────────────────────────────────────────────────────────────

function MeetingTypeIcon({ type }: { type: string | null }) {
  if (type === 'video')       return <Video size={12}    color="#7F77DD" />
  if (type === 'one_on_one')  return <Users size={12}    color="#1D9E75" />
  if (type === 'external')    return <Calendar size={12} color="#1E40AF" />
  return                             <Users size={12}    color="#6B7280" />
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin: '0 0 14px',
      fontSize: 11,
      fontWeight: 600,
      color: '#FFFFFF',
      textTransform: 'uppercase',
      letterSpacing: '1px',
    }}>
      {children}
    </p>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export function MorningBrief() {
  const user    = useAuthStore(s => s.user)
  const tasks   = useTaskStore(s => s.tasks)

  const [energyLevel, setEnergyLevel]   = useState<number | null>(null)
  const [plan, setPlan]                 = useState<DayPlan | null>(loadCachedPlan)
  const [isGenerating, setIsGenerating] = useState(!loadCachedPlan())
  const [error, setError]               = useState<string | null>(null)
  const [habits, setHabits]             = useState(() =>
    loadStoredHabits().map(h => ({ ...h, checked: false })),
  )
  const [todayEvents, setTodayEvents]   = useState<DbCalendarEvent[]>([])

  const firstName = getFirstName(user?.name, user?.email ?? '')
  const dateStr   = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  // Fetch today's Google Calendar events on mount
  useEffect(() => {
    const today = new Date()
    const start = new Date(today); start.setHours(0, 0, 0, 0)
    const end   = new Date(today); end.setHours(23, 59, 59, 999)
    void fetchWeekEvents(start, end).then(({ events }) => {
      setTodayEvents(events.map(e => ({
        id: e.id,
        user_id: user?.id ?? '',
        company_id: null,
        google_event_id: e.id,
        title: e.summary ?? '(No title)',
        start_time: e.start.dateTime ?? e.start.date ?? '',
        end_time:   e.end.dateTime   ?? e.end.date   ?? '',
        location:   e.location ?? null,
        meeting_type: detectMeetingType(e),
        prep_notes: null,
        is_synced: true,
      })))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generate = useCallback(async (energy: number | null = energyLevel) => {
    setIsGenerating(true)
    setError(null)
    try {
      const dbUser  = buildMockUser(user)
      const context = buildContext(dbUser, tasks, energy, todayEvents)
      const result  = await planMyDay(context)
      setPlan(result)
      savePlan(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not generate plan.'
      setError(msg)
    } finally {
      setIsGenerating(false)
    }
  }, [user, tasks, energyLevel, todayEvents])

  // Generate on first load only if no cache
  useEffect(() => {
    if (!plan) generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleEnergySelect(level: number) {
    setEnergyLevel(level)
    // Regenerate if we already have a plan so it reflects new energy level
    if (plan) generate(level)
  }

  function handleHabitToggle(id: string) {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, checked: !h.checked } : h))
  }

  const checkedHabits = habits.filter(h => h.checked).length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .brief-section { animation: fadeIn 0.35s ease both; }
      `}</style>

      <div style={{ padding: '36px 32px 60px', maxWidth: 1080, margin: '0 auto' }}>

        {/* ─── 1. Greeting ───────────────────────────────────────────────── */}
        <div className="brief-section" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 15, color: '#FFFFFF', fontWeight: 400 }}>
                Good morning,
              </p>
              <h1 style={{
                margin: 0,
                fontSize: 48,
                fontWeight: 800,
                color: '#E8EAF6',
                fontFamily: "'Cabinet Grotesk', sans-serif",
                letterSpacing: '-1.5px',
                lineHeight: 1.05,
              }}>
                {firstName}.
              </h1>
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#FFFFFF' }}>
                {dateStr}
              </p>
            </div>

            <button
              onClick={() => generate()}
              disabled={isGenerating}
              title="Regenerate plan"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px', borderRadius: 8,
                background: 'transparent',
                border: '1px solid #252A3E',
                color: '#FFFFFF', fontSize: 12, cursor: 'pointer',
                transition: 'all 0.15s',
                opacity: isGenerating ? 0.5 : 1,
              }}
            >
              <RefreshCw size={13} style={{ animation: isGenerating ? 'spin 1s linear infinite' : 'none' }} />
              Regenerate plan
            </button>
          </div>

          {/* Divider */}
          <div style={{
            marginTop: 24,
            height: 1,
            background: 'linear-gradient(90deg, #1E40AF40 0%, #252A3E 60%, transparent 100%)',
          }} />
        </div>

        {/* ─── Energy check-in ───────────────────────────────────────────── */}
        <div className="brief-section" style={{
          marginBottom: 36,
          background: '#161929',
          border: '1px solid #252A3E',
          borderRadius: 14,
          padding: '20px 24px',
        }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#FFFFFF' }}>
            How's your energy this morning?
          </p>
          <div style={{ display: 'flex', gap: 14 }}>
            {([1, 2, 3, 4, 5] as const).map(level => {
              const meta     = ENERGY_META[level]!
              const selected = energyLevel === level
              return (
                <button
                  key={level}
                  onClick={() => handleEnergySelect(level)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  <span style={{
                    width: 44, height: 44, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    border: `1.5px solid ${selected ? meta.color : '#252A3E'}`,
                    background: selected ? `${meta.color}22` : 'transparent',
                    color: selected ? meta.color : '#6B7280',
                    boxShadow: selected ? `0 0 14px ${meta.color}40` : 'none',
                    transition: 'all 0.15s',
                  }}>
                    {level}
                  </span>
                  <span style={{
                    fontSize: 10, color: selected ? meta.color : '#6B7280',
                    fontWeight: selected ? 600 : 400, transition: 'color 0.15s',
                    whiteSpace: 'nowrap',
                  }}>
                    {meta.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ─── Main grid: left 2/3, right 1/3 ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ─── 2. AI Day Plan ──────────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 26px',
              borderLeft: '3px solid #1E40AF50',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 20 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: '#1E40AF18', border: '1px solid #1E40AF30',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles size={13} color="#1E40AF" />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#1E40AF', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  AI Day Plan
                </span>
                {isGenerating && (
                  <span style={{ fontSize: 11, color: '#FFFFFF', marginLeft: 'auto' }}>
                    Generating…
                  </span>
                )}
              </div>

              {/* Focus tip */}
              {!isGenerating && plan?.focusTip && (
                <div style={{
                  marginBottom: 22,
                  padding: '12px 16px',
                  background: 'rgba(30,64,175,0.07)',
                  borderLeft: '2px solid #1E40AF',
                  borderRadius: '0 8px 8px 0',
                }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#E8EAF6', lineHeight: 1.55 }}>
                    {plan.focusTip}
                  </p>
                </div>
              )}

              {/* Schedule */}
              {isGenerating ? (
                <PlanSkeleton />
              ) : error ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p style={{ margin: '0 0 14px', fontSize: 13, color: '#FFFFFF' }}>{error}</p>
                  <button
                    onClick={() => generate()}
                    style={{
                      padding: '7px 16px', borderRadius: 7,
                      background: '#1E40AF18', border: '1px solid #1E40AF30',
                      color: '#1E40AF', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Try again
                  </button>
                </div>
              ) : plan?.schedule.length ? (
                <div>
                  {plan.schedule.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, paddingBottom: i < plan.schedule.length - 1 ? 18 : 0 }}>
                      {/* Time */}
                      <span style={{
                        fontSize: 12, fontFamily: 'monospace',
                        color: '#1E40AF', width: 48, flexShrink: 0, paddingTop: 1,
                      }}>
                        {item.time}
                      </span>

                      {/* Dot + line */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1E40AF', marginTop: 4 }} />
                        {i < plan.schedule.length - 1 && (
                          <div style={{ width: 1, flex: 1, background: '#252A3E', minHeight: 18, marginTop: 4 }} />
                        )}
                      </div>

                      {/* Activity */}
                      <div style={{ flex: 1, paddingBottom: 4 }}>
                        <p style={{ margin: 0, fontSize: 13.5, color: '#E8EAF6', lineHeight: 1.4 }}>
                          {item.activity}
                        </p>
                        {item.company && (
                          <span style={{
                            display: 'inline-block', marginTop: 4,
                            fontSize: 10.5, fontWeight: 500,
                            padding: '2px 8px', borderRadius: 4,
                            color: CO_COLOR[item.company] ?? '#6B7280',
                            background: `${CO_COLOR[item.company] ?? '#6B7280'}18`,
                          }}>
                            {CO_NAME[item.company] ?? item.company}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  No schedule generated. Try regenerating.
                </p>
              )}
            </div>

            {/* ─── 3. Top 3 Priorities ─────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 26px',
            }}>
              <SectionLabel>Top 3 Priorities</SectionLabel>

              {isGenerating ? (
                <PrioritySkeleton />
              ) : plan?.top3.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.top3.map((title, i) => {
                    const co    = matchCompany(title, tasks)
                    const color = co ? (CO_COLOR[co] ?? '#6B7280') : '#6B7280'
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        background: '#0D0F1A',
                        border: `1px solid ${i === 0 ? '#1E40AF30' : '#252A3E'}`,
                        borderRadius: 12, padding: '13px 16px',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {/* Rank badge */}
                        <span style={{
                          width: 28, height: 28, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, flexShrink: 0,
                          background: i === 0 ? '#1E40AF20' : '#252A3E',
                          color: i === 0 ? '#1E40AF' : '#6B7280',
                        }}>
                          {i + 1}
                        </span>

                        <p style={{ margin: 0, flex: 1, fontSize: 13.5, color: '#E8EAF6', fontWeight: 500 }}>
                          {title}
                        </p>

                        {co && (
                          <span style={{
                            fontSize: 10.5, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                            color, background: `${color}18`, fontWeight: 500,
                          }}>
                            {CO_NAME[co]}
                          </span>
                        )}

                        {/* Top-priority gold accent */}
                        {i === 0 && (
                          <div style={{
                            position: 'absolute', top: 0, left: 0,
                            width: 3, height: '100%', background: '#1E40AF',
                            borderRadius: '12px 0 0 12px',
                          }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  Priorities will appear once the plan is generated.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ─── 4. Today's Meetings ─────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 22px',
            }}>
              <SectionLabel>Today's Meetings</SectionLabel>

              {todayEvents.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  No meetings today — or connect Google Calendar to see them.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {todayEvents.map((event, i) => {
                    const isPast = new Date(event.end_time) < new Date()
                    return (
                      <div key={event.id} style={{
                        display: 'flex', gap: 12, alignItems: 'flex-start',
                        paddingBottom: i < todayEvents.length - 1 ? 18 : 0,
                        opacity: isPast ? 0.45 : 1,
                      }}>
                        <div style={{ width: 54, flexShrink: 0, textAlign: 'right' }}>
                          <p style={{ margin: 0, fontSize: 11.5, color: '#E8EAF6', fontWeight: 500 }}>
                            {fmtTime(event.start_time)}
                          </p>
                          <p style={{ margin: '1px 0 0', fontSize: 10, color: '#FFFFFF' }}>
                            {fmtTime(event.end_time)}
                          </p>
                        </div>
                        <div style={{
                          width: 3, borderRadius: 2, flexShrink: 0,
                          background: '#1E40AF', alignSelf: 'stretch', minHeight: 36,
                        }} />
                        <div style={{ flex: 1, paddingBottom: 4 }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#E8EAF6', fontWeight: 500, lineHeight: 1.3 }}>
                            {event.title}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                            <MeetingTypeIcon type={event.meeting_type} />
                            {event.location && (
                              <span style={{ fontSize: 10.5, color: '#FFFFFF' }}>{event.location}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ─── 5. Habit Status ─────────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <SectionLabel>Today's Habits</SectionLabel>
                <span style={{ fontSize: 11, color: checkedHabits === habits.length ? '#1D9E75' : '#6B7280' }}>
                  {checkedHabits}/{habits.length}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {habits.map(habit => (
                  <button
                    key={habit.id}
                    onClick={() => handleHabitToggle(habit.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 9, width: '100%',
                      background: habit.checked ? '#1D9E7512' : '#0D0F1A',
                      border: `1px solid ${habit.checked ? '#1D9E7540' : '#252A3E'}`,
                      color: habit.checked ? '#1D9E75' : '#6B7280',
                      fontSize: 13, cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    {habit.checked
                      ? <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                      : <Circle size={15} style={{ flexShrink: 0 }} />}
                    <span style={{ textDecoration: habit.checked ? 'line-through' : 'none', opacity: habit.checked ? 0.75 : 1 }}>
                      {habit.name}
                    </span>
                  </button>
                ))}
              </div>

              {checkedHabits === habits.length && (
                <p style={{
                  margin: '14px 0 0', fontSize: 12, color: '#1D9E75',
                  textAlign: 'center', fontWeight: 500,
                }}>
                  All habits done. Exceptional day ahead. ✓
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
