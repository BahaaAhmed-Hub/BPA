// ─── Task summary banner ─────────────────────────────────────────────────────
// The dark strip that reads the week back at you: what is next, what you have
// been closing, and what is still burning.

import { useMemo } from 'react'
import { Flame } from 'lucide-react'
import type { Task } from '@/types'
import { isCarriedOver } from './taskVisuals'

const INK = '#1E1A13'
const DIM = '#A69C86'
const AMBER = '#F5D14E'
const OLIVE = '#7C8F4F'

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}

function Stat({ label, value, sub, accent, icon: Icon, center }: {
  label: string
  value: string
  sub?: string
  accent?: string
  icon?: typeof Flame
  /** Counts sit centred under their label; prose stays left aligned. */
  center?: boolean
}) {
  return (
    <div style={{ minWidth: 0, textAlign: center ? 'center' : 'left' }}>
      <p style={{
        margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em',
        color: DIM, textTransform: 'uppercase',
      }}>{label}</p>
      <p style={{
        margin: '5px 0 0', fontFamily: 'Outfit, sans-serif', fontSize: 21, fontWeight: 600,
        letterSpacing: '-0.02em', color: accent ?? '#FFFFFF', lineHeight: 1.1,
        display: 'flex', alignItems: 'center', gap: 6,
        justifyContent: center ? 'center' : 'flex-start',
      }}>
        {Icon && <Icon size={16} strokeWidth={2} fill={accent ?? 'none'} />}
        {value}
      </p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: 11, color: DIM, lineHeight: 1.35 }}>{sub}</p>}
    </div>
  )
}

export function TaskBanner({ tasks }: { tasks: Task[] }) {
  const model = useMemo(() => {
    const today = startOfDay(new Date())
    const open = tasks.filter(t => !t.completed && t.status !== 'cancelled')

    // Next deadline
    const dated = open
      .filter(t => t.dueDate)
      .map(t => ({ t, at: new Date(t.dueDate! + 'T00:00:00') }))
      .filter(x => !Number.isNaN(x.at.getTime()))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
    const next = dated[0]
    const sameDay = next ? dated.filter(x => x.t.dueDate === next.t.dueDate).length : 0

    // Six days of closures, oldest first
    const days = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() - (5 - i))
      const iso = d.toISOString().slice(0, 10)
      return {
        iso,
        label: d.toLocaleDateString('en-GB', { weekday: 'short' }),
        count: tasks.filter(t => t.completed && t.completedAt === iso).length,
        isToday: i === 5,
      }
    })
    const peak = Math.max(1, ...days.map(d => d.count))
    const closed = days.reduce((n, d) => n + d.count, 0)

    return {
      next, sameDay, days, peak, closed,
      onFire: open.filter(t => t.urgent).length,
      carried: open.filter(isCarriedOver).length,
    }
  }, [tasks])

  const nextLabel = model.next
    ? new Date(model.next.t.dueDate! + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    : 'Nothing dated'

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', gap: 0,
      background: INK, borderRadius: 14, overflow: 'hidden',
      padding: '14px 0', minWidth: 0,
    }}>
      {/* Next deadline */}
      <div style={{ padding: '0 22px', flexShrink: 0, minWidth: 210, display: 'flex', alignItems: 'center' }}>
        <Stat
          label={model.next ? 'Next due' : 'Nothing due'}
          value={nextLabel}
          sub={model.next
            ? `${model.sameDay} task${model.sameDay === 1 ? '' : 's'} that day`
            : 'No open task carries a date'}
        />
      </div>

      <span style={{ width: 1, background: 'rgba(255,255,255,0.10)', flexShrink: 0 }} />

      {/* Six days of closures */}
      <div style={{ flex: 1, minWidth: 0, padding: '0 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <p style={{
          margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em',
          color: DIM, textTransform: 'uppercase',
        }}>
          {model.closed > 0
            ? `${model.closed} closed over the last six days`
            : 'Nothing closed in the last six days'}
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 34, marginTop: 8 }}>
          {model.days.map(d => (
            <div key={d.iso} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', height: '100%' }}>
              <div
                title={`${d.count} closed on ${d.label}`}
                style={{
                  width: '100%',
                  height: `${Math.max(22, Math.round((d.count / model.peak) * 100))}%`,
                  borderRadius: 5,
                  background: d.count === 0
                    ? 'rgba(255,255,255,0.09)'
                    : d.isToday ? AMBER : OLIVE,
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {model.days.map(d => (
            <span key={d.iso} style={{
              flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10,
              color: d.isToday ? '#FFFFFF' : DIM,
            }}>{d.label}</span>
          ))}
        </div>
      </div>

      <span style={{ width: 1, background: 'rgba(255,255,255,0.10)', flexShrink: 0 }} />

      {/* Pressure */}
      <div style={{ padding: '0 22px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 26 }}>
        <Stat label="On fire" value={String(model.onFire)} center icon={Flame}
          accent={model.onFire > 0 ? '#E2765C' : undefined} />
        <Stat label="Carried over" value={String(model.carried)} center
          accent={model.carried > 0 ? AMBER : undefined} />
      </div>
    </div>
  )
}
