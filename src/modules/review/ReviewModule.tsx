
import { useState, useCallback } from 'react'
import { Sparkles, RefreshCw, CheckSquare, Clock, Users, TrendingUp } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { weeklyInsight } from '@/lib/professor'
import type { WeekData } from '@/lib/professor'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { DbUser, DbCompany, DbTask, DbWeeklyReview } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

const MOCK_COMPANIES: DbCompany[] = []

const COMPANY_COLORS: Record<string, string> = {}

const QUADRANT_MAP: Record<string, DbTask['quadrant']> = {
  do: 'urgent_important', schedule: 'important_not_urgent',
  delegate: 'urgent_not_important', eliminate: 'neither',
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

function loadHours(): { focus: number; meeting: number } {
  try {
    const raw = localStorage.getItem('professor-review-hours')
    return raw ? (JSON.parse(raw) as { focus: number; meeting: number }) : { focus: 0, meeting: 0 }
  } catch { return { focus: 0, meeting: 0 } }
}

function saveHours(focus: number, meeting: number) {
  try { localStorage.setItem('professor-review-hours', JSON.stringify({ focus, meeting })) } catch { /* quota */ }
}

function loadHabitsForReview(): { name: string; streak: number; completedThisWeek: number; target: number }[] {
  try {
    const habitsRaw = localStorage.getItem('professor-habits')
    const logsRaw   = localStorage.getItem('professor-habit-logs')
    if (!habitsRaw) return []
    const habits = JSON.parse(habitsRaw) as { id: string; name: string }[]
    const logs   = logsRaw ? (JSON.parse(logsRaw) as Record<string, string[]>) : {}
    const today  = new Date()
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      return d.toISOString().slice(0, 10)
    })
    return habits.map(h => {
      const dates = logs[h.id] ?? []
      const completedThisWeek = dates.filter(d => weekDates.includes(d)).length
      // streak calculation
      const sorted = [...dates].sort().reverse()
      let streak = 0
      let cursor = today.toISOString().slice(0, 10)
      for (const date of sorted) {
        if (date === cursor) {
          streak++
          const d = new Date(cursor); d.setDate(d.getDate() - 1)
          cursor = d.toISOString().slice(0, 10)
        } else break
      }
      return { name: h.name, streak, completedThisWeek, target: 7 }
    })
  } catch { return [] }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMonday(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

function buildMockUser(user: { id: string; email: string; name?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo',
    email: user?.email ?? 'bahaa@example.com',
    full_name: user?.name ?? 'Bahaa Ahmed',
    avatar_url: null,
    active_framework: 'time_blocking',
    schedule_rules: { focus_hours: '09:00–12:00', buffer_minutes: 15 },
    created_at: new Date().toISOString(),
  }
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color, editable, onChange,
}: {
  label: string
  value: number | string
  sub: string
  icon: React.ElementType
  color: string
  editable?: boolean
  onChange?: (v: number) => void
}) {
  return (
    <div style={{
      background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)',
      borderRadius: 12, padding: '18px 20px',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: color, borderRadius: '12px 0 0 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {editable && onChange ? (
            <input
              type="number"
              min={0}
              max={168}
              value={value}
              onChange={e => onChange(parseFloat(e.target.value) || 0)}
              style={{
                fontSize: 28, fontWeight: 700, color: 'var(--color-text, #E8EAF6)',
                fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px',
                background: 'none', border: 'none', outline: 'none',
                width: 80, padding: 0,
              }}
            />
          ) : (
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px', lineHeight: 1 }}>
              {value}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: '#FFFFFF', marginTop: 4 }}>{label}</div>
          <div style={{ fontSize: 11, color, marginTop: 6, fontWeight: 500 }}>{sub}</div>
        </div>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: `${color}18`, border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon size={15} color={color} />
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReviewModule() {
  const user  = useAuthStore(s => s.user)
  const tasks = useTaskStore(s => s.tasks)

  const completedTasks = tasks.filter(t => t.completed)
  const activeTasks    = tasks.filter(t => !t.completed)
  const slipped        = activeTasks.filter(t => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length

  const [focusHours,   setFocusHours]   = useState(() => loadHours().focus)
  const [meetingHours, setMeetingHours] = useState(() => loadHours().meeting)
  const [insight,      setInsight]      = useState<string | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const dbUser = buildMockUser(user)

      const dbCompletedTasks: DbTask[] = completedTasks.map(t => ({
        id: t.id,
        user_id: dbUser.id,
        company_id: t.company,
        title: t.title,
        description: t.description ?? null,
        quadrant: t.quadrant ? (QUADRANT_MAP[t.quadrant] ?? null) : null,
        effort_minutes: null,
        due_date: t.dueDate ?? null,
        status: 'done' as const,
        delegated_to: null,
        done_looks_like: null,
        created_at: t.createdAt,
        completed_at: null,
      }))

      const review: DbWeeklyReview = {
        id: 'review-demo',
        user_id: dbUser.id,
        week_of: getMonday(),
        shipped_count: completedTasks.length,
        slipped_count: slipped,
        focus_hours: focusHours,
        meeting_hours: meetingHours,
        professor_insight: null,
        created_at: new Date().toISOString(),
      }

      const data: WeekData = {
        user: dbUser,
        companies: MOCK_COMPANIES,
        review,
        completedTasks: dbCompletedTasks,
        habits: loadHabitsForReview(),
      }

      const result = await weeklyInsight(data)
      setInsight(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate insight.')
    } finally {
      setLoading(false)
    }
  }, [user, completedTasks, slipped, focusHours, meetingHours])

  return (
    <div>
      <TopBar title="Weekly Review" subtitle="Reflect, realign, and reset your compass." />

      <div style={{ padding: '28px 28px 60px' }}>

        {/* ─── Week label ───────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 3px', fontSize: 20, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.3px' }}>
              Week of {new Date(getMonday() + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
              Adjust hours below, then generate your AI insight.
            </p>
          </div>
          <button
            onClick={() => void handleGenerate()}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 8,
              background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)',
              color: '#1E40AF', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <Sparkles size={14} />
            {loading ? 'Generating…' : insight ? 'Regenerate Insight' : 'Generate AI Insight'}
          </button>
        </div>

        {/* ─── Stats grid ───────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
          <StatCard
            label="Tasks Shipped"
            value={completedTasks.length}
            sub="This week"
            icon={CheckSquare}
            color="#1D9E75"
          />
          <StatCard
            label="Tasks Slipped"
            value={slipped}
            sub={slipped > 0 ? 'Past due date' : 'All on track'}
            icon={TrendingUp}
            color={slipped > 0 ? '#E05252' : '#1D9E75'}
          />
          <StatCard
            label="Focus Hours"
            value={focusHours}
            sub="Click to edit"
            icon={Clock}
            color="#7F77DD"
            editable
            onChange={v => { setFocusHours(v); saveHours(v, meetingHours) }}
          />
          <StatCard
            label="Meeting Hours"
            value={meetingHours}
            sub="Click to edit"
            icon={Users}
            color="#1E40AF"
            editable
            onChange={v => { setMeetingHours(v); saveHours(focusHours, v) }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* ─── Completed tasks ──────────────────────────────────────────── */}
          <div style={{ background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 14, padding: '22px 24px' }}>
            <p style={{ margin: '0 0 16px', fontSize: 11, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Shipped This Week
            </p>
            {completedTasks.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>No completed tasks yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {completedTasks.slice(0, 8).map(task => (
                  <div key={task.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)',
                  }}>
                    <CheckSquare size={13} color="#1D9E75" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#FFFFFF', flex: 1, textDecoration: 'line-through', opacity: 0.7 }}>
                      {task.title}
                    </span>
                    {task.company && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                        color: COMPANY_COLORS[task.company] ?? '#888780',
                        background: `${COMPANY_COLORS[task.company] ?? '#888780'}18`,
                        fontWeight: 500,
                      }}>
                        {task.company}
                      </span>
                    )}
                  </div>
                ))}
                {completedTasks.length > 8 && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#FFFFFF', textAlign: 'center' }}>
                    + {completedTasks.length - 8} more
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ─── AI Insight ───────────────────────────────────────────────── */}
          <div style={{
            background: loading
              ? 'var(--color-surface, #161929)'
              : insight
                ? 'rgba(30,64,175,0.05)'
                : 'var(--color-surface, #161929)',
            border: `1px solid ${insight ? 'rgba(30,64,175,0.2)' : 'var(--color-border, #252A3E)'}`,
            borderRadius: 14, padding: '22px 24px',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 6,
                background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Sparkles size={13} color="#1E40AF" />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                The Professor's Insight
              </span>
            </div>

            {loading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                <RefreshCw size={14} color="#1E40AF" style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, color: '#1E40AF' }}>Analyzing your week…</span>
              </div>
            ) : error ? (
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: '#FFFFFF' }}>{error}</p>
                <button
                  onClick={() => void handleGenerate()}
                  style={{ padding: '7px 14px', borderRadius: 7, background: '#1E40AF18', border: '1px solid #1E40AF30', color: '#1E40AF', fontSize: 12, cursor: 'pointer' }}
                >
                  Try again
                </button>
              </div>
            ) : insight ? (
              <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.7 }}>
                {insight}
              </p>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 0' }}>
                <Sparkles size={28} color="var(--color-border, #252A3E)" />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 14, color: '#5A4E3A', fontWeight: 500 }}>
                    No insight yet
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: '#4A3E28' }}>
                    Click "Generate AI Insight" to get The Professor's<br />analysis of your week.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
