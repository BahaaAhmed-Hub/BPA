import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Pencil, Plus, Sparkles, X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { LOZENGE } from '@/components/SideRail'
import { CompanyMark } from '@/components/CompanyMark'
import { loadDynamicCompanies } from '@/types'
import type { Task } from '@/types'
import { ICON, STROKE } from '@/lib/type'
import { projectStats } from '@/lib/projectStats'
import { useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import { placementForNew } from '../tasks/BrainDumpRail'
import { useDeliverableGate } from '../tasks/DeliverablePrompt'
import { inputStyle } from '@/modules/library/fieldStyle'
import { ProjectDialog } from './ProjectDialog'
import { ProjectPlanner } from './ProjectPlanner'
import { ProjectTimeline, byDate } from './ProjectTimeline'
import { ProjectCalendar, projectCalendarItems } from './ProjectCalendar'
import { ProjectMail } from './ProjectMail'
import { ProjectMoney } from './ProjectMoney'
import { ProjectHabits } from './ProjectHabits'
import { ProjectBooks } from './ProjectBooks'
import { moduleIsOff } from '@/lib/entitlements'
import { useLibraryOff } from '@/modules/library/libraryPrefs'
import type { Project } from './types'

type Tab = 'overview' | 'tasks' | 'timeline' | 'calendar' | 'mail' | 'money' | 'habits' | 'books'

const STATUS_LABEL: Record<Project['status'], string> = { idea: 'Idea', active: 'Active', paused: 'Paused', done: 'Done' }
const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}
const fmt = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const dayDiff = (iso: string, today: string) =>
  Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 864e5)

/** One project: its numbers, and the tasks that belong to it. A task keeps its
 *  quadrant and every other view — this is one more place to see and add them,
 *  not a new home for them. */
export function ProjectPage({ project, onBack }: { project: Project; onBack: () => void }) {
  const milestones = useProjectStore(s => s.milestones)
  const links = useProjectStore(s => s.links)
  const allTasks = useTaskStore(s => s.tasks)
  const addTask = useTaskStore(s => s.addTask)
  const updateTask = useTaskStore(s => s.updateTask)
  const focusOn = useUIStore(s => s.focusOn)
  const { requestComplete, prompt: deliverablePrompt } = useDeliverableGate()
  const [tab, setTab] = useState<Tab>('overview')
  const [editing, setEditing] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [draft, setDraft] = useState('')

  const today = new Date().toLocaleDateString('en-CA')
  const company = useMemo(
    () => (project.companyId ? loadDynamicCompanies().find(c => c.id === project.companyId) : undefined),
    [project.companyId])
  const stats = projectStats(project, allTasks, milestones, today)
  const eventCount = projectCalendarItems(project, links, allTasks.filter(t => t.projectId === project.id)).length
  const threadCount = links.filter(l => l.projectId === project.id && l.kind === 'thread').length
  // The personal tabs. A personal project offers them; a work project shows one
  // only when it already holds something of that kind (a project that changed
  // kind must not hide what is linked to it). A module that is off offers nothing.
  const libraryOff = useLibraryOff()
  const countOf = (k: 'entry' | 'habit' | 'book') => links.filter(l => l.projectId === project.id && l.kind === k).length
  const personal = project.kind === 'personal'
  const showMoney = !moduleIsOff('finance') && (personal || countOf('entry') > 0)
  const showHabits = !moduleIsOff('habits') && (personal || countOf('habit') > 0)
  const showBooks = !libraryOff && (personal || countOf('book') > 0)
  const phases = milestones.filter(m => m.projectId === project.id).sort(byDate)
  const mine = allTasks.filter(t => t.projectId === project.id)
  const open = mine.filter(t => !t.completed && t.status !== 'done' && t.status !== 'cancelled')
  const done = mine.filter(t => t.completed || t.status === 'done')
  const notDoing = mine.filter(t => t.status === 'cancelled' && !t.completed)
  // Offered to bring in: open and in no project. A task already in another
  // project is moved from that project's own page or from the task itself.
  const loose = allTasks.filter(t => !t.projectId && !t.completed && t.status !== 'done' && t.status !== 'cancelled' && t.title.trim())
  const color = project.color ?? 'var(--sb-ink-4)'

  const addNew = () => {
    const title = draft.trim()
    if (!title) return
    const base = {
      title,
      company: (project.companyId ?? 'personal') as Task['company'],
      companyId: project.companyId,
      status: 'open' as Task['status'], completed: false, projectId: project.id,
    }
    addTask({ ...base, quadrant: placementForNew({ ...base, id: '', createdAt: '' } as Task) } as Omit<Task, 'id' | 'createdAt'>)
    setDraft('')
  }

  const left = project.targetDate ? dayDiff(project.targetDate, today) : null
  const targetLine = left == null ? 'No target date'
    : project.status === 'done' ? `Target was ${fmt(project.targetDate!)}`
    : left < 0 ? `${-left} day${left === -1 ? '' : 's'} late`
    : left === 0 ? 'Due today' : `${left} day${left === 1 ? '' : 's'} left`

  // Called, not rendered as components: defined here, a component would be a
  // new type on every render and every row would remount on every store change.
  const TaskLine = ({ t }: { t: Task }) => {
    const finished = t.completed || t.status === 'done'
    const late = !finished && t.status !== 'cancelled' && !!t.dueDate && t.dueDate < today
    return (
      <div key={t.id} data-project-task={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <button type="button" aria-label={finished ? `Reopen ${t.title}` : `Mark ${t.title} done`} aria-pressed={finished}
          onClick={() => requestComplete(t)}
          style={{
            width: 20, height: 20, borderRadius: 6, flexShrink: 0, padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: finished ? 'var(--sb-positive)' : 'transparent',
            border: `var(--sb-border-width) solid ${finished ? 'var(--sb-positive)' : 'var(--sb-border)'}`,
            color: 'var(--sb-ink-on-dark)',
          }}>{finished && <Check size={ICON.sm} strokeWidth={STROKE.active} />}</button>
        <button type="button" onClick={() => focusOn({ module: 'tasks', id: t.id })} title="Open this task"
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            font: 'inherit', fontSize: 'var(--sb-t-body)', color: finished || t.status === 'cancelled' ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)',
            textDecoration: finished || t.status === 'cancelled' ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.title}</button>
        {t.dueDate && (
          <span style={{ flexShrink: 0, fontSize: 'var(--sb-t-meta)', fontVariantNumeric: 'tabular-nums',
            color: late ? 'var(--sb-negative-deep)' : 'var(--sb-ink-3)', fontWeight: late ? 600 : 500 }}>
            {fmtShort(t.dueDate)}
          </span>
        )}
        {phases.length > 0 && !finished && t.status !== 'cancelled' && (
          <select aria-label={`Phase for ${t.title}`} value={phases.some(m => m.id === t.milestoneId) ? t.milestoneId : ''}
            onChange={e => updateTask(t.id, { milestoneId: e.target.value || undefined })}
            style={{ flex: '0 1 150px', minWidth: 0, height: 26, borderRadius: 'var(--sb-r-sm)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', color: t.milestoneId ? 'var(--sb-ink-2)' : 'var(--sb-ink-4)', fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', padding: '0 6px' }}>
            <option value="">No phase</option>
            {phases.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        )}
        <button type="button" aria-label={`Take ${t.title} out of this project`} title="Take it out of this project"
          onClick={() => updateTask(t.id, { projectId: undefined, milestoneId: undefined })}
          style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
          <X size={ICON.sm} />
        </button>
      </div>
    )
  }
  const Group = ({ label, tasks }: { label: string; tasks: Task[] }) => tasks.length === 0 ? null : (
    <div data-project-group={label} style={{ ...CARD, overflow: 'hidden' }}>
      <div style={{ ...CAP, padding: '12px 12px 6px' }}>{label} · {tasks.length}</div>
      {tasks.map(t => TaskLine({ t }))}
    </div>
  )

  return (
    <div data-project-page={project.id} style={{ padding: '8px 24px 32px', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box', minWidth: 0 }}>
      <div data-projects-bar style={{ ...LOZENGE, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap' }}>
        <Button variant="ghost" iconOnly title="Back to all projects" aria-label="Back to all projects" onClick={onBack}>
          <ArrowLeft size={ICON.md} />
        </Button>
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <h1 style={{ margin: 0, minWidth: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </h1>
        <span style={{ flexShrink: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', borderRadius: 999, padding: '3px 8px' }}>
          {project.archived ? 'Archived' : STATUS_LABEL[project.status]}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <Segmented aria-label="Project section" value={tab} onChange={setTab} options={[
            { value: 'overview' as const, label: 'Overview' },
            { value: 'tasks' as const, label: `Tasks${stats.total ? ` · ${stats.total}` : ''}` },
            { value: 'timeline' as const, label: 'Timeline' },
            { value: 'calendar' as const, label: `Calendar${eventCount ? ` · ${eventCount}` : ''}` },
            { value: 'mail' as const, label: `Mail${threadCount ? ` · ${threadCount}` : ''}` },
            ...(showMoney ? [{ value: 'money' as const, label: `Money${countOf('entry') ? ` · ${countOf('entry')}` : ''}` }] : []),
            ...(showHabits ? [{ value: 'habits' as const, label: `Habits${countOf('habit') ? ` · ${countOf('habit')}` : ''}` }] : []),
            ...(showBooks ? [{ value: 'books' as const, label: `Books${countOf('book') ? ` · ${countOf('book')}` : ''}` }] : []),
          ]} />
          <Button variant="secondary" onClick={() => setPlanning(true)}><Sparkles size={ICON.sm} /> Plan</Button>
          <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={ICON.sm} /> Edit</Button>
        </span>
      </div>

      {tab === 'overview' && (
        <div data-project-overview style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {stats.total === 0 && phases.length === 0 && (
            <div data-project-plan-prompt style={{ ...CARD, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>Nothing planned yet</div>
                <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 2, lineHeight: 1.45 }}>Start from a template, or describe it and let the AI draft milestones and tasks. You review the draft before anything is added.</div>
              </div>
              <Button variant="accent" onClick={() => setPlanning(true)}><Sparkles size={ICON.md} /> Plan this project</Button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12 }}>
            {[
              { k: 'progress', label: 'Progress', value: `${stats.pct}%` },
              { k: 'done', label: 'Done', value: String(stats.done) },
              { k: 'open', label: 'Open', value: String(stats.open) },
              { k: 'overdue', label: 'Overdue', value: String(stats.overdue), bad: stats.overdue > 0 },
            ].map(s => (
              <div key={s.k} data-project-stat={s.k} style={{ ...CARD, padding: '14px 16px' }}>
                <div style={CAP}>{s.label}</div>
                <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-display)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 6,
                  color: s.bad ? 'var(--sb-negative-deep)' : 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ ...CARD, padding: '12px 16px' }}>
            <div role="progressbar" aria-label="Project progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.pct}
              style={{ height: 8, borderRadius: 999, background: 'var(--sb-field)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${stats.pct}%`, background: color, borderRadius: 999 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
            <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={CAP}>Dates</div>
              <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)' }}>
                {project.startDate ? `Started ${fmt(project.startDate)}` : 'No start date'}
              </div>
              <div data-project-target style={{ fontSize: 'var(--sb-t-body)', color: left != null && left < 0 && project.status !== 'done' ? 'var(--sb-negative-deep)' : 'var(--sb-ink-2)', fontWeight: left != null && left < 0 && project.status !== 'done' ? 600 : 400 }}>
                {project.targetDate ? `${fmt(project.targetDate)} · ${targetLine}` : targetLine}
              </div>
              {stats.nextMilestone && (
                <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)' }}>
                  Next: <b style={{ color: 'var(--sb-ink-1)' }}>{stats.nextMilestone.title}</b>
                  {stats.nextMilestone.dueDate && ` · ${fmt(stats.nextMilestone.dueDate)}`}
                </div>
              )}
            </div>
            <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={CAP}>{project.kind === 'personal' ? 'Personal' : 'Work'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-2)' }}>
                {company && <CompanyMark co={company} size={20} />}
                {project.kind === 'personal' ? 'A personal project' : company ? company.name : 'No company yet'}
              </div>
            </div>
          </div>

          <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={CAP}>Notes</div>
            {project.notes
              ? <div data-project-notes style={{ fontSize: 'var(--sb-t-body)', lineHeight: 1.5, color: 'var(--sb-ink-2)', whiteSpace: 'pre-wrap' }}>{project.notes}</div>
              : <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
                  Nothing written yet. <button type="button" onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--sb-ink-1)', textDecoration: 'underline', cursor: 'pointer' }}>Add what done looks like</button>
                </div>}
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div data-project-tasks style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...CARD, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <form onSubmit={e => { e.preventDefault(); addNew() }} style={{ flex: '1 1 260px', display: 'flex', gap: 8, minWidth: 0 }}>
              <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a task to this project" aria-label="New task title" style={inputStyle} />
              <Button type="submit" variant="accent" disabled={!draft.trim()} style={{ flexShrink: 0 }}><Plus size={ICON.md} /> Add</Button>
            </form>
            {loose.length > 0 && (
              <select aria-label="Bring in an existing task" value="" style={{ ...inputStyle, flex: '0 1 220px' }}
                onChange={e => { if (e.target.value) updateTask(e.target.value, { projectId: project.id }) }}>
                <option value="">Bring in an existing task…</option>
                {loose.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            )}
          </div>

          {mine.length === 0 ? (
            <p data-project-tasks-empty style={{ margin: '24px 0', textAlign: 'center', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
              No tasks in this project yet. Add the first step above.
            </p>
          ) : (
            <>
              {Group({ label: 'Open', tasks: open })}
              {Group({ label: 'Done', tasks: done })}
              {Group({ label: 'Not doing', tasks: notDoing })}
            </>
          )}
        </div>
      )}

      {tab === 'mail' && <ProjectMail project={project} />}
      {tab === 'money' && showMoney && <ProjectMoney project={project} />}
      {tab === 'habits' && showHabits && <ProjectHabits project={project} />}
      {tab === 'books' && showBooks && <ProjectBooks project={project} />}
      {tab === 'calendar' && <ProjectCalendar project={project} tasks={mine} today={today} />}
      {tab === 'timeline' && <ProjectTimeline project={project} tasks={mine} today={today} />}

      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} />}
      {planning && <ProjectPlanner project={project} onClose={() => setPlanning(false)} />}
      {deliverablePrompt}
    </div>
  )
}
