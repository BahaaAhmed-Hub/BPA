import { useEffect, useState } from 'react'
import {
  TrendingUp, CheckSquare, Calendar, Inbox,
  Target, Zap, Award, ArrowRight, Ban,
} from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import { loadDynamicCompanies, isTaskHidden } from '@/types'
import { loadHabits, loadLogs, calcStreak } from '@/store/habitsStore'
import { fetchVisibleEvents } from '@/lib/calendarEvents'
import { ICON, STROKE } from '@/lib/type'
import { alpha } from '@/lib/alpha'

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
  const color = accentColor ?? 'var(--sb-info)'
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--sb-card)',
        border: '1px solid var(--sb-border)',
        borderRadius: 'var(--sb-r-nav)', padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 12,
        position: 'relative', overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 'var(--sb-r-chip)',
        // The tile is the card's colour at a fraction of itself. An eight-digit
        // hex could only ever say that about a hex, and one of these colours is
        // now a token — 24/255 and 48/255, the two alphas that were there.
        background: `color-mix(in srgb, ${color} 9.4%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 18.8%, transparent)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} color={color} strokeWidth={2} />
      </div>

      <div>
        <div style={{
          fontSize: 'var(--sb-t-h1)', fontWeight: 700,
          color: 'var(--sb-ink-1)',
          fontFamily: 'var(--sb-font-num)',
          letterSpacing: '-0.5px', lineHeight: 1,
        }}>
          {value}
        </div>
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 4, fontWeight: 400 }}>
          {label}
        </div>
      </div>

      {delta && (
        <div style={{ fontSize: 'var(--sb-t-meta)', color: deltaPositive ? 'var(--sb-positive)' : 'var(--sb-negative)', fontWeight: 500 }}>
          {delta}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: 3, height: '100%', background: color,
        borderRadius: 'var(--sb-r-nav) 0 0 var(--sb-r-nav)',
      }} />
    </div>
  )
}

function CompanyBadge({ name, color, count }: { name: string; color: string; count: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      background: 'var(--sb-field)',
      borderRadius: 'var(--sb-r-chip)', border: '1px solid var(--sb-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: color }} />
        <span style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontWeight: 400 }}>
          {name}
        </span>
      </div>
      <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color, background: alpha(color, 9.4), padding: '2px 8px', borderRadius: 'var(--sb-r-chip)' }}>
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
        background: 'var(--sb-field)',
        border: '1px solid var(--sb-border)',
        borderRadius: 'var(--sb-r-sm)', cursor: 'pointer', gap: 10,
        color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', fontWeight: 500,
        transition: 'border-color 0.15s',
        textAlign: 'left',
      }}
    >
      {label}
      <ArrowRight size={ICON.sm} color="var(--sb-ink-3)" />
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutiveDashboard() {
  const tasks         = useTaskStore(s => s.tasks).filter(t => !isTaskHidden(t))
  const setModule     = useUIStore(s => s.setActiveModule)

  const [todayMeetings, setTodayMeetings] = useState(0)
  const [habitStreak,   setHabitStreak]   = useState(0)
  const [habitProgress, setHabitProgress] = useState({ done: 0, total: 0 })

  const activeTasks    = tasks.filter(t => !t.completed)
  const urgentTasks    = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const completedTasks = tasks.filter(t => t.completed)

  // Tasks added this week
  const weekStart     = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0)
  const addedThisWeek = tasks.filter(t => t.createdAt && new Date(t.createdAt) >= weekStart).length

  // Tasks by Company — use dynamic companies from Settings, match by companyId or company name
  const dynamicCompanies = loadDynamicCompanies()
  const tasksByCompany = dynamicCompanies.filter(co => !co.hidden)
    .map(co => ({
      id:    co.id,
      name:  co.name,
      color: co.color,
      count: activeTasks.filter(t =>
        t.companyId === co.id ||
        t.company === co.id ||
        t.company?.toLowerCase() === co.name.toLowerCase()
      ).length,
    }))
    .filter(co => co.count > 0 || dynamicCompanies.length <= 4)

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
    fetchVisibleEvents(start, end).then(events => {
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

      <div style={{ padding: '28px 28px 60px' }}>
        {/* Welcome */}
        <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: 'var(--sb-t-h2)', fontWeight: 700,
              color: 'var(--sb-ink-1)',
              fontFamily: 'var(--sb-font-num)', letterSpacing: '-0.4px',
            }}>
              {greeting}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-3)' }}>
              Here's what demands your attention today.
            </p>
          </div>
          <button
            onClick={() => setModule('tasks')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 'var(--sb-r-sm)',
              background: 'rgba(var(--sb-accent-rgb),0.12)',
              border: '1px solid rgba(var(--sb-accent-rgb),0.25)',
              color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-label)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <CheckSquare size={ICON.sm} /> Manage Tasks
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
            accentColor="var(--sb-info)"
            onClick={() => setModule('tasks')}
          />
          <MetricCard
            label="Urgent & Important"
            value={urgentTasks.length}
            delta={urgentTasks.length > 0 ? 'Needs attention' : 'All clear'}
            deltaPositive={urgentTasks.length === 0}
            icon={Zap}
            accentColor="var(--sb-negative)"
            onClick={() => setModule('tasks')}
          />
          <MetricCard
            label="Completed"
            value={completedTasks.length}
            delta={completedTasks.length > 0 ? 'Tasks shipped' : undefined}
            deltaPositive={true}
            icon={Award}
            accentColor="var(--sb-positive)"
          />
          <MetricCard
            label="Meetings Today"
            value={todayMeetings}
            delta={todayMeetings > 0 ? 'From calendar' : 'Connect calendar'}
            deltaPositive={todayMeetings === 0}
            icon={Calendar}
            accentColor="var(--sb-info)"
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
            accentColor="var(--sb-positive)"
            onClick={() => setModule('habits')}
          />
          <MetricCard
            label="Habit Streak"
            value={habitStreak > 0 ? `${habitStreak}d` : '—'}
            delta={habitStreak >= 7 ? 'On fire! 🔥' : habitStreak > 0 ? 'Keep going' : 'Start today'}
            deltaPositive={habitStreak > 0}
            icon={Award}
            accentColor="var(--sb-positive)"
            onClick={() => setModule('habits')}
          />
          <MetricCard
            label="Inbox"
            value="—"
            delta="Connect Gmail"
            deltaPositive={false}
            icon={Inbox}
            accentColor="var(--sb-info)"
            onClick={() => setModule('inbox')}
          />
        </div>

        {/* Bottom Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Company Breakdown */}
          <div style={{
            background: 'var(--sb-card)',
            border: '1px solid var(--sb-border)',
            borderRadius: 'var(--sb-r-nav)', padding: '20px 22px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Tasks by Company
              </h3>
              <button onClick={() => setModule('tasks')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--sb-t-meta)' }}>
                View all <ArrowRight size={ICON.sm} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasksByCompany.length === 0
                ? <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>No companies set up yet — add them in Settings.</p>
                : tasksByCompany.map(co => (
                    <CompanyBadge key={co.id} name={co.name} color={co.color} count={co.count} />
                  ))
              }
            </div>
          </div>

          {/* Eisenhower Matrix + Quick Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'var(--sb-card)',
              border: '1px solid var(--sb-border)',
              borderRadius: 'var(--sb-r-nav)', padding: '20px 22px',
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Eisenhower Matrix
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {/* Each quadrant carries a glyph as well as its name and its
                    hue: two of these were the same violet anyway, so the colour
                    was never telling them apart. The figures are darkened to
                    clear 3:1 at their size. */}
                {([
                  { key: 'do',       label: 'Do Now',    color: 'var(--sb-info)',         Icon: Zap },
                  { key: 'schedule', label: 'Schedule',  color: 'var(--sb-ink-2)', Icon: Calendar },
                  { key: 'delegate', label: 'Delegate',  color: 'var(--sb-positive)',         Icon: ArrowRight },
                  { key: 'eliminate',label: 'Eliminate', color: 'var(--sb-ink-3)', Icon: Ban },
                ] as const).map(({ key, label, color, Icon }) => {
                  const count = activeTasks.filter(t => t.quadrant === key).length
                  return (
                    <div key={key} onClick={() => setModule('tasks')}
                      style={{
                        background: 'var(--sb-field)',
                        border: `1px solid ${alpha(color, 18.8)}`,
                        borderRadius: 'var(--sb-r-chip)', padding: '12px 14px',
                        display: 'flex', flexDirection: 'column', gap: 4,
                        cursor: 'pointer',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-h2)', fontWeight: 700, color, fontFamily: 'var(--sb-font-num)' }}>
                        <Icon size={ICON.sm} strokeWidth={STROKE.active} />
                        {count}
                      </div>
                      <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{
              background: 'var(--sb-card)',
              border: '1px solid var(--sb-border)',
              borderRadius: 'var(--sb-r-nav)', padding: '16px 18px',
            }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
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
          background: 'color-mix(in srgb, var(--sb-info) 6.0%, transparent)',
          border: '1px solid color-mix(in srgb, var(--sb-info) 20.0%, transparent)',
          borderRadius: 'var(--sb-r-nav)', padding: '16px 20px',
          display: 'flex', gap: 14, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 'var(--sb-r-chip)',
            background: 'color-mix(in srgb, var(--sb-info) 15.0%, transparent)', border: '1px solid color-mix(in srgb, var(--sb-info) 30.0%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 1,
          }}>
            <TrendingUp size={ICON.sm} color="var(--sb-info)" strokeWidth={STROKE.active} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', marginBottom: 4, letterSpacing: '0.3px' }}>
              THE PROFESSOR
            </div>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-1)', lineHeight: 1.55 }}>
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
