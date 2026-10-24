import { CompanyMark } from '@/components/CompanyMark'
import type { DynamicCompany } from '@/types'
import type { ProjectStats } from '@/lib/projectStats'
import type { Project } from './types'

const STATUS_LABEL: Record<Project['status'], string> = { idea: 'Idea', active: 'Active', paused: 'Paused', done: 'Done' }

const fmt = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** One project, as a card. The whole card is the button — a click target the
 *  size of the thing it names. The stripe and the progress fill carry the
 *  project's colour; every word is drawn in ink tokens, because a colour
 *  somebody chose cannot be promised to carry text in all four themes. */
export function ProjectCard({ project, stats, company, today, onOpen }: {
  project: Project; stats: ProjectStats; company?: DynamicCompany; today: string; onOpen: () => void
}) {
  const color = project.color ?? 'var(--sb-ink-4)'
  const late = !!project.targetDate && project.targetDate < today && project.status !== 'done'
  return (
    <button type="button" onClick={onOpen} data-project-card={project.id} aria-label={`Open ${project.name}`}
      className="sb-card-surface" data-variant="interactive"
      style={{
        textAlign: 'left', cursor: 'pointer', padding: 0, overflow: 'hidden', font: 'inherit', color: 'inherit',
        display: 'flex', flexDirection: 'column', opacity: project.archived ? 0.7 : 1,
      }}>
      <span aria-hidden style={{ height: 5, background: color }} />
      <span style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            flex: 1, minWidth: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 600,
            letterSpacing: '-0.01em', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{project.name}</span>
          <span data-project-status style={{
            flexShrink: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--sb-ink-3)', background: 'var(--sb-field)', borderRadius: 999, padding: '3px 8px',
          }}>{STATUS_LABEL[project.status]}</span>
        </span>

        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', minHeight: 18 }}>
          {company && <CompanyMark co={company} size={16} />}
          {project.kind === 'personal' ? 'Personal' : company ? company.name : 'Work'}
          {project.archived && <span> · archived</span>}
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span role="progressbar" aria-label={`${project.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.pct}
            style={{ height: 6, borderRadius: 999, background: 'var(--sb-field)', overflow: 'hidden', display: 'block' }}>
            <span style={{ display: 'block', height: '100%', width: `${stats.pct}%`, background: color, borderRadius: 999 }} />
          </span>
          <span data-project-count style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.total === 0 ? 'No tasks yet' : `${stats.done} of ${stats.total} tasks done`}
            {stats.overdue > 0 && <span style={{ color: 'var(--sb-negative-deep)', fontWeight: 600 }}> · {stats.overdue} overdue</span>}
          </span>
        </span>

        {(project.targetDate || stats.nextMilestone) && (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {stats.nextMilestone && (
              <span>Next: <span style={{ color: 'var(--sb-ink-2)', fontWeight: 600 }}>{stats.nextMilestone.title}</span>
                {stats.nextMilestone.dueDate && ` · ${fmt(stats.nextMilestone.dueDate)}`}</span>
            )}
            {project.targetDate && (
              <span style={late ? { color: 'var(--sb-negative-deep)', fontWeight: 600 } : undefined}>
                {late ? 'Was due' : 'Due'} {fmt(project.targetDate)}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  )
}
