
import { TopBar } from '@/components/layout/TopBar'
import {
  TrendingUp, CheckSquare, Calendar, Inbox,
  Clock, Target, Zap, Award,
} from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { COMPANY_COLORS, COMPANY_LABELS } from '@/types'
import type { CompanyTag } from '@/types'

function MetricCard({
  label, value, delta, deltaPositive, icon: Icon, accentColor,
}: {
  label: string
  value: string | number
  delta?: string
  deltaPositive?: boolean
  icon: React.ElementType
  accentColor?: string
}) {
  const color = accentColor ?? '#1E40AF'
  return (
    <div
      style={{
        background: '#161929',
        border: '1px solid #252A3E',
        borderRadius: 12,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: `${color}18`,
          border: `1px solid ${color}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={16} color={color} strokeWidth={2} />
      </div>

      <div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#E8EAF6',
            fontFamily: "'Cabinet Grotesk', sans-serif",
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 12.5, color: '#FFFFFF', marginTop: 4, fontWeight: 400 }}>
          {label}
        </div>
      </div>

      {delta && (
        <div
          style={{
            fontSize: 11.5,
            color: deltaPositive ? '#1D9E75' : '#E05252',
            fontWeight: 500,
          }}
        >
          {deltaPositive ? '↑' : '↓'} {delta}
        </div>
      )}

      {/* Accent stripe */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 3,
          height: '100%',
          background: color,
          borderRadius: '12px 0 0 12px',
        }}
      />
    </div>
  )
}

function CompanyBadge({ company, count }: { company: CompanyTag; count: number }) {
  const color = COMPANY_COLORS[company]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: '#0D0F1A',
        borderRadius: 8,
        border: '1px solid #252A3E',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13, color: '#E8EAF6', fontWeight: 400 }}>
          {COMPANY_LABELS[company]}
        </span>
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color,
          background: `${color}18`,
          padding: '2px 8px',
          borderRadius: 4,
        }}
      >
        {count}
      </span>
    </div>
  )
}

export function ExecutiveDashboard() {
  const tasks = useTaskStore(s => s.tasks)
  const activeTasks = tasks.filter(t => !t.completed)
  const urgentTasks = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const completedToday = tasks.filter(t => t.completed).length

  const tasksByCompany = (['teradix', 'dxtech', 'consulting', 'personal'] as CompanyTag[]).map(c => ({
    company: c,
    count: activeTasks.filter(t => t.company === c).length,
  }))

  return (
    <div>
      <TopBar title="Executive Dashboard" subtitle="Your command center — clear, focused, decisive." />

      <div style={{ padding: '28px 28px' }}>
        {/* Welcome */}
        <div style={{ marginBottom: 28 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: '#E8EAF6',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              letterSpacing: '-0.4px',
            }}
          >
            Good morning.
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#FFFFFF' }}>
            Here's what demands your attention today.
          </p>
        </div>

        {/* Metric Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <MetricCard
            label="Active Tasks"
            value={activeTasks.length}
            delta="3 added this week"
            deltaPositive={false}
            icon={CheckSquare}
            accentColor="#1E40AF"
          />
          <MetricCard
            label="Urgent & Important"
            value={urgentTasks.length}
            delta="Needs attention"
            deltaPositive={false}
            icon={Zap}
            accentColor="#E05252"
          />
          <MetricCard
            label="Completed"
            value={completedToday}
            delta="2 more than yesterday"
            deltaPositive={true}
            icon={Award}
            accentColor="#1D9E75"
          />
          <MetricCard
            label="Focus Time"
            value="4.2h"
            delta="12% above average"
            deltaPositive={true}
            icon={Clock}
            accentColor="#7F77DD"
          />
        </div>

        {/* Second Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
          <MetricCard
            label="Meetings Today"
            value="3"
            delta="Next in 45 min"
            deltaPositive={true}
            icon={Calendar}
            accentColor="#7F77DD"
          />
          <MetricCard
            label="Unread Emails"
            value="27"
            delta="5 require action"
            deltaPositive={false}
            icon={Inbox}
            accentColor="#1E40AF"
          />
          <MetricCard
            label="Habit Streak"
            value="14d"
            delta="Personal best!"
            deltaPositive={true}
            icon={Target}
            accentColor="#1D9E75"
          />
        </div>

        {/* Bottom Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Company Breakdown */}
          <div
            style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 12,
              padding: '20px 22px',
            }}
          >
            <h3
              style={{
                margin: '0 0 16px',
                fontSize: 13,
                fontWeight: 600,
                color: '#FFFFFF',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
              }}
            >
              Tasks by Company
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasksByCompany.map(({ company, count }) => (
                <CompanyBadge key={company} company={company} count={count} />
              ))}
            </div>
          </div>

          {/* Priority Matrix Summary */}
          <div
            style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 12,
              padding: '20px 22px',
            }}
          >
            <h3
              style={{
                margin: '0 0 16px',
                fontSize: 13,
                fontWeight: 600,
                color: '#FFFFFF',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
              }}
            >
              Eisenhower Matrix
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(
                [
                  { key: 'do', label: 'Do Now', color: '#1E40AF' },
                  { key: 'schedule', label: 'Schedule', color: '#7F77DD' },
                  { key: 'delegate', label: 'Delegate', color: '#1D9E75' },
                  { key: 'eliminate', label: 'Eliminate', color: '#888780' },
                ] as const
              ).map(({ key, label, color }) => {
                const count = activeTasks.filter(t => t.quadrant === key).length
                return (
                  <div
                    key={key}
                    style={{
                      background: '#0D0F1A',
                      border: `1px solid ${color}30`,
                      borderRadius: 8,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                      {count}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#FFFFFF' }}>{label}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Professor Insight */}
        <div
          style={{
            marginTop: 14,
            background: 'rgba(30, 64, 175, 0.06)',
            border: '1px solid rgba(30, 64, 175, 0.2)',
            borderRadius: 12,
            padding: '16px 20px',
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'rgba(30, 64, 175, 0.15)',
              border: '1px solid rgba(30, 64, 175, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            <TrendingUp size={13} color="#1E40AF" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF', marginBottom: 4, letterSpacing: '0.3px' }}>
              THE PROFESSOR
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: '#E8EAF6', lineHeight: 1.55 }}>
              You have {urgentTasks.length} urgent & important tasks that require your direct attention today.
              Consider blocking your first 2 hours for deep work on the Q2 Board Presentation — 
              it's your highest-leverage activity this week.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
