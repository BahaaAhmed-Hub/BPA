import { useEffect, useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import {
  TrendingUp, CheckSquare, Calendar, Inbox,
  Target, Zap, Award, ArrowRight,
} from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import { COMPANY_COLORS, COMPANY_LABELS } from '@/types'
import type { CompanyTag } from '@/types'
import { loadHabits, loadLogs, calcStreak } from '@/store/habitsStore'
import { fetchWeekEvents } from '@/lib/googleCalendar'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayKey() { return new Date().toISOString().slice(0, 10) }

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, delta, deltaPositive, icon: Icon, accentColor, onClick,
}: {
  label: string
  value: string | number
  delta?: string
  deltaPositive?: boolean
  icon: React.ElementType
  accentColor?: string
  onClick?: () => void
}) {
  const color = accentColor ?? '#1E40AF'
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--color-surface, #161929)',
        border: '1px solid var(--color-border, #252A3E)',
        borderRadius: 12, padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 12,
        position: 'relative', overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: `${color}18`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} color={color} strokeWidth={2} />
      </div>

      <div>
        <div style={{
          fontSize: 28, fontWeight: 700,
          color: 'var(--color-text, #E8EAF6)',
          fontFamily: "'Cabinet Grotesk', sans-serif",
          letterSpacing: '-0.5px', lineHeight: 1,
        }}>
          {value}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-dim, #94A3B8)', marginTop: 4, fontWeight: 400 }}>
          {label}
        </div>
      </div>

      {delta && (
        <div style={{ fontSize: 11.5, color: deltaPositive ? '#1D9E75' : '#E05252', fontWeight: 500 }}>
          {deltaPositive ? '↑' : '↓'} {delta}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: 3, height: '100%', background: color,
        borderRadius: '12px 0 0 12px',
      }} />
    </div>
  )
}

function CompanyBadge({ company, count }: { company: CompanyTag; count: number }) {
  const color = COMPANY_COLORS[company]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      background: 'var(--color-surface2, #0D0F1A)',
      borderRadius: 8, border: '1px solid var(--color-border, #252A3E)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13, color: 'var(--color-text, #E8EAF6)', fontWeight: 400 }}>
          {COMPANY_LABELS[company]}
        </span>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, background: `${color}18`, padding: '2px 8px', borderRadius: 4 }}>
        {count}
      </span>
    </div>
  )
}

// ─── Quick Action Button ──────────────────────────────────────────────────────

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '12px 16px',
        background: 'var(--color-surface2, #0D0F1A)',
        border: '1px solid var(--color-border, #252A3E)',
        borderRadius: 9, cursor: 'pointer', gap: 10,
        color: 'var(--color-text, #E8EAF6)', fontSize: 13, fontWeight: 500,
        transition: 'border-color 0.15s',
        textAlign: 'left',
      }}
    >
      {label}
      <ArrowRight size={13} color="var(--color-text-muted, #4B5563)" />
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutiveDashboard() {
  const tasks         = useTaskStore(s => s.tasks)
  const setModule     = useUIStore(s => s.setActiveModule)

  const [todayMeetings, setTodayMeetings] = useState(0)
  const [habitStreak,   setHabitStreak]   = useState(0)
  const [habitProgress, setHabitProgress] = useState({ done: 0, total: 0 })

  const activeTasks    = tasks.filter(t => !t.completed)
  const urgentTasks    = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const completedTasks = tasks.filter(t => t.completed)

  // Completed this week
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0)
  const completedThisWeek = completedTasks.filter(t => t.createdAt && new Date(t.createdAt) >= weekStart).length

  // Tasks added this week
  const addedThisWeek = tasks.filter(t => t.createdAt && new Date(t.createdAt) >= weekStart).length

  const tasksByCompany = (['teradix', 'dxtech', 'consulting', 'personal'] as CompanyTag[]).map(c => ({
    company: c, count: activeTasks.filter(t => t.company === c).length,
  }))

  // Load habit data
  useEffect(() => {
    const habits  = loadHabits().filter(h => h.isActive)
    const logs    = loadLogs()
    const today   = todayKey()
    const done    = habits.filter(h => (logs[h.id] ?? []).includes(today)).length
    const best    = Math.max(0, ...habits.map(h => calcStreak(logs[h.id] ?? [])))
    setHabitProgress({ done, total: habits.length })
    setHabitStreak(best)
  }, [])

  // Load calendar events for today
  useEffect(() => {
    const today = new Date()
    const start = new Date(today); start.setHours(0, 0, 0, 0)
    const end   = new Date(today); end.setHours(23, 59, 59, 999)
    fetchWeekEvents(start, end).then(({ events }) => {
      setTodayMeetings(events.length)
    }).catch(() => { /* no calendar connected */ })
  }, [])

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning.'
    if (h < 17) return 'Good afternoon.'
    return 'Good evening.'
  })()

  return (
    <div>
      <TopBar title="Executive Dashboard" subtitle="Your command center — clear, focused, decisive." />

      <div style={{ padding: '28px 28px 60px' }}>
        {/* Welcome */}
        <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: 22, fontWeight: 700,
              color: 'var(--color-text, #E8EAF6)',
              fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.4px',
            }}>
              {greeting}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--color-text-dim, #94A3B8)' }}>
              Here's what demands your attention today.
            </p>
          </div>
          <button
            onClick={() => setModule('tasks')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 9,
              background: 'var(--color-accent-fill, rgba(30,64,175,0.15))',
              border: '1px solid var(--color-accent, #1E40AF)40',
              color: 'var(--color-accent, #1E40AF)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <CheckSquare size={14} /> Manage Tasks
          </button>
        </div>

        {/* Top metric cards — real data */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          <MetricCard
            label="Active Tasks"
            value={activeTasks.length}
            delta={addedThisWeek > 0 ? `${addedThisWeek} added this week` : undefined}
            deltaPositive={false}
            icon={CheckSquare}
            accentColor="#1E40AF"
            onClick={() => setModule('tasks')}
          />
          <MetricCard
            label="Urgent & Important"
            value={urgentTasks.length}
            delta={urgentTasks.length > 0 ? 'Needs attention' : 'All clear'}
            deltaPositive={urgentTasks.length === 0}
            icon={Zap}
            accentColor="#E05252"
            onClick={() => setModule('tasks')}
          />
          <MetricCard
            label="Completed"
            value={completedTasks.length}
            delta={completedThisWeek > 0 ? `${completedThisWeek} this week` : undefined}
            deltaPositive={true}
            icon={Award}
            accentColor="#1D9E75"
          />
          <MetricCard
            label="Meetings Today"
            value={todayMeetings}
            delta={todayMeetings > 0 ? 'From calendar' : 'Connect calendar'}
            deltaPositive={todayMeetings === 0}
            icon={Calendar}
            accentColor="#7F77DD"
            onClick={() => setModule('calendar')}
          />
        </div>

        {/* Second Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
          <MetricCard
            label="Today's Habits"
            value={`${habitProgress.done}/${habitProgress.total}`}
            delta={habitProgress.done === habitProgress.total && habitProgress.total > 0 ? 'All done!' : habitProgress.total === 0 ? 'No habits set' : `${habitProgress.total - habitProgress.done} remaining`}
            deltaPositive={habitProgress.done === habitProgress.total}
            icon={Target}
            accentColor="#1D9E75"
            onClick={() => setModule('habits')}
          />
          <MetricCard
            label="Habit Streak"
            value={habitStreak > 0 ? `${habitStreak}d` : '—'}
            delta={habitStreak >= 7 ? 'On fire! 🔥' : habitStreak > 0 ? 'Keep going' : 'Start today'}
            deltaPositive={habitStreak > 0}
            icon={Award}
            accentColor="#1D9E75"
            onClick={() => setModule('habits')}
          />
          <MetricCard
            label="Inbox"
            value="—"
            delta="Connect Gmail"
            deltaPositive={false}
            icon={Inbox}
            accentColor="#1E40AF"
            onClick={() => setModule('inbox')}
          />
        </div>

        {/* Bottom Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Company Breakdown */}
          <div style={{
            background: 'var(--color-surface, #161929)',
            border: '1px solid var(--color-border, #252A3E)',
            borderRadius: 12, padding: '20px 22px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Tasks by Company
              </h3>
              <button onClick={() => setModule('tasks')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #4B5563)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                View all <ArrowRight size={11} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasksByCompany.map(({ company, count }) => (
                <CompanyBadge key={company} company={company} count={count} />
              ))}
            </div>
          </div>

          {/* Eisenhower Matrix + Quick Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'var(--color-surface, #161929)',
              border: '1px solid var(--color-border, #252A3E)',
              borderRadius: 12, padding: '20px 22px',
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Eisenhower Matrix
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([
                  { key: 'do',       label: 'Do Now',   color: '#1E40AF' },
                  { key: 'schedule', label: 'Schedule', color: '#7F77DD' },
                  { key: 'delegate', label: 'Delegate', color: '#1D9E75' },
                  { key: 'eliminate',label: 'Eliminate',color: '#888780' },
                ] as const).map(({ key, label, color }) => {
                  const count = activeTasks.filter(t => t.quadrant === key).length
                  return (
                    <div key={key} onClick={() => setModule('tasks')}
                      style={{
                        background: 'var(--color-surface2, #0D0F1A)',
                        border: `1px solid ${color}30`,
                        borderRadius: 8, padding: '12px 14px',
                        display: 'flex', flexDirection: 'column', gap: 4,
                        cursor: 'pointer',
                      }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                        {count}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-dim, #94A3B8)' }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{
              background: 'var(--color-surface, #161929)',
              border: '1px solid var(--color-border, #252A3E)',
              borderRadius: 12, padding: '16px 18px',
            }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Quick Access
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <QuickAction label="📋 Manage Tasks" onClick={() => setModule('tasks')} />
                <QuickAction label="☀️ Morning Brief" onClick={() => setModule('morning')} />
                <QuickAction label="📅 Calendar" onClick={() => setModule('calendar')} />
                <QuickAction label="🔁 Weekly Review" onClick={() => setModule('review')} />
              </div>
            </div>
          </div>
        </div>

        {/* Professor Insight */}
        <div style={{
          marginTop: 14,
          background: 'rgba(30,64,175,0.06)',
          border: '1px solid rgba(30,64,175,0.2)',
          borderRadius: 12, padding: '16px 20px',
          display: 'flex', gap: 14, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'rgba(30,64,175,0.15)', border: '1px solid rgba(30,64,175,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 1,
          }}>
            <TrendingUp size={13} color="#1E40AF" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF', marginBottom: 4, letterSpacing: '0.3px' }}>
              THE PROFESSOR
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.55 }}>
              {urgentTasks.length > 0
                ? `You have ${urgentTasks.length} urgent & important task${urgentTasks.length !== 1 ? 's' : ''} requiring your direct attention. Consider blocking deep-work time to address ${urgentTasks[0]?.title ? `"${urgentTasks[0].title}"` : 'the top priority'} first.`
                : activeTasks.length === 0
                  ? "Your task board is clear — excellent execution. Use this time to plan ahead and review your weekly goals."
                  : `You have ${activeTasks.length} active tasks with no immediate fires — a good state to be in. Focus on your scheduled deep work.`
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
