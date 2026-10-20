import type { ReactNode } from 'react'
import { CheckSquare, CalendarDays, Flame } from 'lucide-react'
import { QUADRANTS } from '@/lib/quadrants'
import { ICON, STROKE } from '@/lib/type'

/**
 * Today's one-line summary: what the Dashboard used to say, at the top of the
 * screen that already answers "what is my day". Four figures, each a door to
 * the module that owns it. It states counts only — the sentences, the plan and
 * the mail below it are the day itself.
 */
export interface GlanceProps {
  doNow: number
  open: number
  meetings: number
  habitsPct: number
  habitsTotal: number
  onGo: (module: 'tasks' | 'calendar' | 'habits') => void
}

function Chip({ onClick, icon, value, label }: { onClick: () => void; icon: ReactNode; value: string; label: string }) {
  return (
    <button type="button" onClick={onClick} className="sb-hit" style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer',
      borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
      textAlign: 'left', flex: '1 1 150px', minWidth: 0,
    }}>
      {icon}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-1)', lineHeight: 1.1 }}>{value}</span>
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{label}</span>
      </span>
    </button>
  )
}

export function TodayGlance({ doNow, open, meetings, habitsPct, habitsTotal, onGo }: GlanceProps) {
  const Q = QUADRANTS.do
  return (
    <div data-today-glance style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '0 18px 4px', padding: '0 8px' }}>
      <Chip onClick={() => onGo('tasks')} value={String(doNow)} label={Q.label}
        icon={<Q.Icon size={ICON.md} strokeWidth={STROKE.active} data-quadrant="do" style={{ color: Q.color, flexShrink: 0 }} aria-hidden />} />
      <Chip onClick={() => onGo('tasks')} value={String(open)} label="Open tasks"
        icon={<CheckSquare size={ICON.md} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-3)', flexShrink: 0 }} aria-hidden />} />
      <Chip onClick={() => onGo('calendar')} value={String(meetings)} label={meetings === 1 ? 'Meeting today' : 'Meetings today'}
        icon={<CalendarDays size={ICON.md} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-3)', flexShrink: 0 }} aria-hidden />} />
      <Chip onClick={() => onGo('habits')} value={habitsTotal === 0 ? '—' : `${habitsPct}%`} label={habitsTotal === 0 ? 'No habits yet' : 'Habits today'}
        icon={<Flame size={ICON.md} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-3)', flexShrink: 0 }} aria-hidden />} />
    </div>
  )
}
