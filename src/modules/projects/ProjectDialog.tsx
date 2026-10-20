import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { loadDynamicCompanies } from '@/types'
import { COMPANY_COLOR_CHOICES } from '@/lib/palettes'
import { ICON } from '@/lib/type'
import { inputStyle } from '@/modules/library/fieldStyle'
import { useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import type { Project, ProjectKind, ProjectStatus } from './types'

const SWATCHES = COMPANY_COLOR_CHOICES.slice(0, 12)   // the deep row: legible as a stripe on every theme
const LABEL: React.CSSProperties = {
  fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', marginBottom: 5, display: 'block',
}

/** Create a project, or edit one. `project` absent means create.
 *  Edits are saved with the button, not live: a half-typed name is not a name. */
export function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const add = useProjectStore(s => s.addProject)
  const update = useProjectStore(s => s.updateProject)
  const remove = useProjectStore(s => s.deleteProject)
  const taskCount = useTaskStore(s => project ? s.tasks.filter(t => t.projectId === project.id).length : 0)

  const companies = useMemo(() => loadDynamicCompanies().filter(c => !c.hidden), [])
  const [name, setName] = useState(project?.name ?? '')
  const [kind, setKind] = useState<ProjectKind>(project?.kind ?? 'work')
  const [companyId, setCompanyId] = useState(project?.companyId ?? '')
  const [color, setColor] = useState(project?.color ?? SWATCHES[7])
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active')
  const [startDate, setStartDate] = useState(project?.startDate ?? '')
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? '')
  const [notes, setNotes] = useState(project?.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dateProblem = startDate && targetDate && targetDate < startDate
    ? 'The target date is before the start.' : ''
  const canSave = name.trim().length > 0 && !dateProblem

  const save = () => {
    if (!canSave) return
    const fields = {
      name: name.trim(), kind, color, status,
      // A personal project has no company; a work one has exactly one, or none yet.
      companyId: kind === 'work' && companyId ? companyId : undefined,
      startDate: startDate || undefined, targetDate: targetDate || undefined,
      notes: notes.trim() || undefined,
    }
    if (project) update(project.id, fields)
    else add(fields)
    onClose()
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={project ? 'Edit project' : 'New project'} data-project-dialog style={{
        width: 'min(560px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>
            {project ? 'Edit project' : 'New project'}
          </h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>

        <form onSubmit={e => { e.preventDefault(); save() }}
          style={{ overflowY: 'auto', padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label>
            <span style={LABEL}>Name</span>
            <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} maxLength={80}
              placeholder="Launch the new website" aria-label="Project name" style={inputStyle} />
          </label>

          <div>
            <span style={LABEL}>Kind</span>
            <Segmented aria-label="Project kind" value={kind} onChange={setKind} options={[
              { value: 'work' as const, label: 'Work' }, { value: 'personal' as const, label: 'Personal' },
            ]} />
          </div>

          {kind === 'work' && (
            <label>
              <span style={LABEL}>Company</span>
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} aria-label="Company" style={inputStyle}>
                <option value="">No company yet</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}

          <div>
            <span style={LABEL}>Colour</span>
            <div role="radiogroup" aria-label="Project colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SWATCHES.map(c => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                    border: 'none',
                    // Ringed in the page's own colour, outside the fill — a border would eat the colour.
                    boxShadow: color === c ? '0 0 0 2px var(--sb-overlay), 0 0 0 4px var(--sb-ink-1)' : 'none',
                  }} />
              ))}
            </div>
          </div>

          <div>
            <span style={LABEL}>Status</span>
            <Segmented aria-label="Project status" value={status} onChange={setStatus} options={[
              { value: 'idea' as const, label: 'Idea' }, { value: 'active' as const, label: 'Active' },
              { value: 'paused' as const, label: 'Paused' }, { value: 'done' as const, label: 'Done' },
            ]} />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={LABEL}>Start</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="Start date" style={inputStyle} />
            </label>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={LABEL}>Target</span>
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} aria-label="Target date" style={inputStyle} />
            </label>
          </div>
          {dateProblem && <div role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)', marginTop: -8 }}>{dateProblem}</div>}

          <label>
            <span style={LABEL}>Notes</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} aria-label="Notes"
              placeholder="What done looks like, who is involved, anything worth remembering"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.45 }} />
          </label>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px 16px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          {project && !confirmDelete && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
          {project && confirmDelete && (
            <>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', maxWidth: 220, lineHeight: 1.35 }}>
                Delete this project? Its tasks{taskCount ? ` (${taskCount})` : ''} stay, unassigned.
              </span>
              <Button variant="danger" onClick={() => { remove(project.id); onClose() }}>Yes, delete</Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </>
          )}
          <span style={{ flex: 1 }} />
          {project && !confirmDelete && (
            <Button variant="secondary" onClick={() => { update(project.id, { archived: !project.archived }); onClose() }}>
              {project.archived ? 'Unarchive' : 'Archive'}
            </Button>
          )}
          {!confirmDelete && <Button variant="secondary" onClick={onClose}>Cancel</Button>}
          {!confirmDelete && <Button variant="primary" onClick={save} disabled={!canSave}>{project ? 'Save' : 'Create project'}</Button>}
        </div>
      </div>
    </div>
  )
}
