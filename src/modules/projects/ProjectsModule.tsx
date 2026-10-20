import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { LOZENGE } from '@/components/SideRail'
import { loadDynamicCompanies } from '@/types'
import { ICON } from '@/lib/type'
import { projectStats } from '@/lib/projectStats'
import { useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import { useUIStore } from '@/store/uiStore'
import { ProjectPage } from './ProjectPage'
import { ProjectCard } from './ProjectCard'
import { ProjectDialog } from './ProjectDialog'
import type { Project, ProjectKind } from './types'

type View = 'open' | 'done' | 'archived'
type KindFilter = 'all' | ProjectKind

const inView = (p: Project, v: View) =>
  v === 'archived' ? p.archived : !p.archived && (v === 'done' ? p.status === 'done' : p.status !== 'done')

/** The Projects tab: a bar, and a grid of cards. A card opens its project page. */
export function ProjectsModule() {
  const projects = useProjectStore(s => s.projects)
  const milestones = useProjectStore(s => s.milestones)
  const tasks = useTaskStore(s => s.tasks)
  const [view, setView] = useState<View>('open')
  const [kind, setKind] = useState<KindFilter>('all')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // Something elsewhere sent you to a project — a task's own link to it.
  const focus = useUIStore(s => s.focus)
  const clearFocus = useUIStore(s => s.clearFocus)
  useEffect(() => {
    if (focus?.module !== 'projects') return
    setOpenId(focus.id)
    clearFocus()
  }, [focus, clearFocus])

  const today = new Date().toLocaleDateString('en-CA')
  const companies = useMemo(() => loadDynamicCompanies(), [projects])
  const shown = projects
    .filter(p => inView(p, view) && (kind === 'all' || p.kind === kind))
    // Dated ones first, soonest first; then by when they were made.
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.createdAt.localeCompare(b.createdAt))
  const none = projects.length === 0
  // A project deleted (here or on another device) while its page is open is a
  // grid again, not a blank screen.
  const openProject = openId ? projects.find(p => p.id === openId) : undefined
  if (openProject) return <ProjectPage project={openProject} onBack={() => setOpenId(null)} />

  return (
    <div data-projects-module style={{ padding: '8px 24px 32px', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box', minWidth: 0 }}>
      <div data-projects-bar style={{ ...LOZENGE, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>
          Projects
        </h1>
        {!none && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Segmented aria-label="Which projects" value={view} onChange={setView} options={[
              { value: 'open' as const, label: 'Open' }, { value: 'done' as const, label: 'Done' }, { value: 'archived' as const, label: 'Archived' },
            ]} />
            <Segmented aria-label="Kind of project" value={kind} onChange={setKind} options={[
              { value: 'all' as const, label: 'All' }, { value: 'work' as const, label: 'Work' }, { value: 'personal' as const, label: 'Personal' },
            ]} />
            <Button variant="accent" onClick={() => setCreating(true)} style={{ boxSizing: 'border-box', flexShrink: 0 }}>
              <Plus size={ICON.md} /> New project
            </Button>
          </span>
        )}
      </div>

      {none ? (
        <div data-projects-empty style={{ maxWidth: 460, margin: '48px auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>
            Give an outcome a home
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', lineHeight: 1.5, color: 'var(--sb-ink-3)' }}>
            A project gathers the tasks, dates and conversations behind one goal — a launch, a trip, a renovation — so you can see how far along it is.
          </p>
          <Button variant="accent" onClick={() => setCreating(true)}><Plus size={ICON.md} /> Create your first project</Button>
        </div>
      ) : shown.length === 0 ? (
        <p data-projects-none style={{ margin: '32px 0', textAlign: 'center', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
          {view === 'open' ? 'No open projects' : view === 'done' ? 'Nothing finished yet' : 'Nothing archived'}
          {kind !== 'all' && ` of that kind`}.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
          {shown.map(p => (
            <ProjectCard key={p.id} project={p} today={today}
              stats={projectStats(p, tasks, milestones, today)}
              company={p.companyId ? companies.find(c => c.id === p.companyId) : undefined}
              onOpen={() => setOpenId(p.id)} />
          ))}
        </div>
      )}

      {creating && <ProjectDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
