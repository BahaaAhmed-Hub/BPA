import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { ICON } from '@/lib/type'
import { inputStyle } from '@/modules/library/fieldStyle'
import { loadLogs, loadQuantityLogs, useHabitsStore } from '@/store/habitsStore'
import { useProjectStore } from '@/store/projectStore'
import { habitWeek } from './projectLife'
import type { Project } from './types'

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}

/** Habits that serve the project, with how this week went. The logs are the
 *  Habits module's own and are only read here; a habit deleted there is shown
 *  as deleted, with a way to take it out, rather than silently dropped. */
export function ProjectHabits({ project }: { project: Project }) {
  const habits = useHabitsStore(s => s.habits)
  const links = useProjectStore(s => s.links)
  const addLink = useProjectStore(s => s.addLink)
  const removeLink = useProjectStore(s => s.removeLink)
  // The logs live in localStorage and announce their changes with an event.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener('professor:habitLogsUpdated', bump)
    window.addEventListener('storage', bump)
    return () => { window.removeEventListener('professor:habitLogsUpdated', bump); window.removeEventListener('storage', bump) }
  }, [])
  const logs = useMemo(() => loadLogs(), [tick, habits])        // eslint-disable-line react-hooks/exhaustive-deps
  const qty = useMemo(() => loadQuantityLogs(), [tick, habits]) // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date().toLocaleDateString('en-CA')

  const mine = links.filter(l => l.projectId === project.id && l.kind === 'habit')
  const taken = new Set(links.filter(l => l.kind === 'habit' && l.projectId === project.id).map(l => l.refId))
  const options = habits.filter(h => h.isActive && !h.archived && !taken.has(h.id))

  return (
    <div data-project-habits style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...CARD, padding: 12 }}>
        <select aria-label="Link a habit" value="" style={{ ...inputStyle, width: '100%' }}
          onChange={e => { if (e.target.value) addLink(project.id, 'habit', e.target.value) }}>
          <option value="">{options.length ? 'Link a habit that serves this project…' : 'No more habits to link'}</option>
          {options.map(h => <option key={h.id} value={h.id}>{`${h.emoji} ${h.name}`.trim()}</option>)}
        </select>
      </div>

      {mine.length === 0 ? (
        <p data-project-habits-empty style={{ margin: '8px 0', textAlign: 'center', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
          No habits linked yet. Link the daily practice behind this project — writing, training, practising — and its week shows here.
        </p>
      ) : (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ ...CAP, padding: '12px 12px 6px' }}>Habits · {mine.length}</div>
          {mine.map(l => {
            const h = habits.find(x => x.id === l.refId)
            const week = h ? habitWeek(h, logs, qty, today) : []
            const done = week.filter(d => d.p >= 1).length
            return (
              <div key={l.id} data-project-habit={l.refId}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: h?.color ?? 'var(--sb-ink-4)', flexShrink: 0 }} />
                <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 'var(--sb-t-body)', color: h ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h ? `${h.emoji} ${h.name}`.trim() : 'This habit was deleted'}
                </span>
                {h && (
                  <>
                    <span data-habit-week aria-label={`Last seven days: ${done} done`} style={{ display: 'inline-flex', gap: 4 }}>
                      {week.map(d => (
                        <span key={d.date} data-day={d.date} data-p={d.p.toFixed(2)} title={d.date} style={{
                          width: 14, height: 14, borderRadius: 4, boxSizing: 'border-box',
                          border: 'var(--sb-border-width) solid var(--sb-border)',
                          // A part-day is drawn as a part-day: a fill that is a share of the square.
                          background: d.p >= 1 ? h.color : d.p > 0 ? `linear-gradient(to top, ${h.color} ${Math.round(d.p * 100)}%, transparent ${Math.round(d.p * 100)}%)` : 'transparent',
                        }} />
                      ))}
                    </span>
                    <span data-habit-count style={{ flex: '0 0 72px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{done} of 7 days</span>
                  </>
                )}
                <button type="button" aria-label={`Unlink ${h?.name ?? 'the habit'} from this project`} title="Unlink it — the habit stays in Habits"
                  onClick={() => removeLink(l.id)}
                  style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
                  <X size={ICON.sm} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
