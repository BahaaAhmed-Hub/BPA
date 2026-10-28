import { useMemo, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { ICON, STROKE } from '@/lib/type'
import { inputStyle } from '@/modules/library/fieldStyle'
import { useProjectStore } from '@/store/projectStore'
import type { Task } from '@/types'
import { Diamond } from './MilestoneMarkers'
import type { Project, ProjectMilestone } from './types'

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}
const DAY = 864e5
const ms = (iso: string) => new Date(iso + 'T12:00:00').getTime()
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** Dated first, soonest first; undated last, in the order they were made. */
export const byDate = (a: ProjectMilestone, b: ProjectMilestone) =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sortOrder - b.sortOrder

/** Where each date falls on the axis, 0–100. The range always holds every date
 *  that is drawn plus today (while the project is live), padded a little so an
 *  end marker is not on the edge; a single-day range is widened to a fortnight. */
export function axisOf(project: Project, milestones: ProjectMilestone[], today: string) {
  const dates = [project.startDate, project.targetDate, ...milestones.map(m => m.dueDate), project.status === 'done' ? undefined : today]
    .filter((d): d is string => !!d).map(ms)
  let from = Math.min(...dates), to = Math.max(...dates)
  if (!isFinite(from) || !isFinite(to)) return null
  if (to - from < 14 * DAY) { const mid = (from + to) / 2; from = mid - 7 * DAY; to = mid + 7 * DAY }
  const pad = (to - from) * 0.04
  from -= pad; to += pad
  return { pos: (iso: string) => ((ms(iso) - from) / (to - from)) * 100 }
}

function Row({ m, tasks, project }: { m: ProjectMilestone; tasks: Task[]; project: Project }) {
  const update = useProjectStore(s => s.updateMilestone)
  const remove = useProjectStore(s => s.deleteMilestone)
  const [title, setTitle] = useState(m.title)
  // Escape blurs the field to leave it, and blur is what saves — so Escape has to
  // say it was a cancel, or the half-typed name is committed on the way out.
  const cancelled = useRef(false)
  const mine = tasks.filter(t => t.milestoneId === m.id && t.status !== 'cancelled')
  const done = mine.filter(t => t.completed || t.status === 'done').length
  const past = !!m.dueDate && !!project.targetDate && m.dueDate > project.targetDate
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; setTitle(m.title); return }
    const t = title.trim()
    if (!t) { setTitle(m.title); return }      // a milestone with no name is not a milestone
    if (t !== m.title) update(m.id, { title: t })
  }
  return (
    <div data-milestone-row={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
      <button type="button" aria-label={m.done ? `Reopen ${m.title}` : `Mark ${m.title} done`} aria-pressed={m.done}
        onClick={() => update(m.id, { done: !m.done })}
        style={{
          width: 20, height: 20, borderRadius: 6, flexShrink: 0, padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-ink-on-dark)',
          background: m.done ? 'var(--sb-positive)' : 'transparent',
          border: `var(--sb-border-width) solid ${m.done ? 'var(--sb-positive)' : 'var(--sb-border)'}`,
        }}>{m.done && <Check size={ICON.sm} strokeWidth={STROKE.active} />}</button>
      <input value={title} onChange={e => setTitle(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { cancelled.current = true; (e.target as HTMLInputElement).blur() } }}
        aria-label={`Milestone name: ${m.title}`} maxLength={80}
        style={{ ...inputStyle, flex: '1 1 160px', width: 'auto', minHeight: 30, background: 'transparent', border: '1px solid transparent',
          textDecoration: m.done ? 'line-through' : 'none', color: m.done ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)' }} />
      <input type="date" value={m.dueDate ?? ''} onChange={e => update(m.id, { dueDate: e.target.value || undefined })}
        aria-label={`Date for ${m.title}`} style={{ ...inputStyle, flex: '0 0 150px', width: 150, minHeight: 30 }} />
      <span data-milestone-count style={{ flex: '0 0 auto', minWidth: 96, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
        {mine.length === 0 ? 'No tasks' : `${done} of ${mine.length} done`}
      </span>
      {/* A fixed slot, so the columns line up whether or not a row has something to say. */}
      <span {...(past ? { 'data-milestone-late': '' } : {})} style={{ flex: '0 0 128px', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-negative-deep)' }}>
        {past ? 'After the target date' : ''}
      </span>
      <button type="button" aria-label={`Delete milestone ${m.title}`} title="Delete this milestone — its tasks keep the project"
        onClick={() => remove(m.id)}
        style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
        <X size={ICON.sm} />
      </button>
    </div>
  )
}

/** Milestones on an axis, and the list that edits them. Dates are drawn where
 *  they fall; the list below is the source of truth for names and dates. */
export function ProjectTimeline({ project, tasks, today }: { project: Project; tasks: Task[]; today: string }) {
  const all = useProjectStore(s => s.milestones)
  const add = useProjectStore(s => s.addMilestone)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const ms_ = useMemo(() => all.filter(m => m.projectId === project.id).sort(byDate), [all, project.id])
  const dated = ms_.filter(m => m.dueDate)
  const axis = axisOf(project, ms_, today)
  const color = project.color ?? 'var(--sb-ink-4)'
  const clamp = (p: number) => Math.max(7, Math.min(93, p))

  const submit = () => {
    const t = title.trim()
    if (!t) return
    add(project.id, { title: t, dueDate: date || undefined })
    setTitle(''); setDate('')
  }

  return (
    <div data-project-timeline style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...CARD, padding: '12px 16px', overflowX: 'auto' }}>
        <div style={CAP}>Timeline</div>
        {!axis || (dated.length === 0 && !project.startDate && !project.targetDate) ? (
          <p data-timeline-empty style={{ margin: '14px 0 6px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
            Give a milestone a date, or the project a start and target, and it is drawn here.
          </p>
        ) : (
          <div data-timeline-axis style={{ position: 'relative', minWidth: 560, height: 170, marginTop: 6 }}>
            <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 85, height: 2, borderRadius: 2, background: 'var(--sb-border)' }} />
            {project.status !== 'done' && (
              <div data-timeline-today style={{ position: 'absolute', left: `${axis.pos(today)}%`, top: 8, bottom: 8, width: 0, borderLeft: '1px dashed var(--sb-ink-3)' }}>
                <span style={{ position: 'absolute', top: -2, left: 4, ...CAP, fontSize: 9.5 }}>Today</span>
              </div>
            )}
            {project.startDate && (
              <div data-timeline-start style={{ position: 'absolute', left: `${axis.pos(project.startDate)}%`, top: 78, height: 16, borderLeft: `2px solid ${color}` }}>
                <span style={{ position: 'absolute', top: 70, left: 4, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', whiteSpace: 'nowrap' }}>Start {fmtShort(project.startDate)}</span>
              </div>
            )}
            {project.targetDate && (
              <div data-timeline-target style={{ position: 'absolute', left: `${axis.pos(project.targetDate)}%`, top: 78, height: 16, borderLeft: `2px solid ${color}` }}>
                <span style={{ position: 'absolute', top: 70, right: 4, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', whiteSpace: 'nowrap' }}>Target {fmtShort(project.targetDate)}</span>
              </div>
            )}
            {dated.map((m, i) => {
              const p = axis.pos(m.dueDate!)
              const above = i % 2 === 0
              return (
                <div key={m.id} data-timeline-marker={m.id}>
                  <span style={{ position: 'absolute', left: `calc(${p}% - 6px)`, top: 80, display: 'flex' }}><Diamond color={color} size={12} hollow={m.done} /></span>
                  {/* The label is clamped to the axis so an end marker's name is not
                      pushed off the card; the diamond itself is never moved. */}
                  <div style={{
                    position: 'absolute', left: `${clamp(p)}%`, transform: 'translateX(-50%)', width: 132, textAlign: 'center',
                    [above ? 'bottom' : 'top']: 100, minWidth: 0,
                  }}>
                    <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: m.done ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: m.done ? 'line-through' : 'none' }}>{m.title}</div>
                    <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{fmtShort(m.dueDate!)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ ...CARD, overflow: 'hidden' }}>
        <div style={{ ...CAP, padding: '12px 12px 6px' }}>Milestones{ms_.length ? ` · ${ms_.length}` : ''}</div>
        {ms_.length === 0 && (
          <p data-milestones-empty style={{ margin: 0, padding: '4px 12px 12px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
            Milestones are the dated steps on the way — a sign-off, a launch, a payment. They appear on your calendar on their day.
          </p>
        )}
        {ms_.map(m => <Row key={m.id} m={m} tasks={tasks} project={project} />)}
        <form onSubmit={e => { e.preventDefault(); submit() }} style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a milestone" aria-label="New milestone name" maxLength={80}
            style={{ ...inputStyle, flex: '1 1 200px', width: 'auto' }} />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="New milestone date" style={{ ...inputStyle, flex: '0 0 150px', width: 150 }} />
          <Button type="submit" variant="accent" disabled={!title.trim()} style={{ flexShrink: 0 }}><Plus size={ICON.md} /> Add</Button>
        </form>
      </div>
    </div>
  )
}
