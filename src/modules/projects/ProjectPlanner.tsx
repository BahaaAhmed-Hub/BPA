import { useEffect, useMemo, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { ICON } from '@/lib/type'
import { aiConfigured } from '@/lib/professor'
import { notify, pushUndo, suppressUndo } from '@/lib/undo'
import { inputStyle } from '@/modules/library/fieldStyle'
import { useProjectStore } from '@/store/projectStore'
import { useTaskStore } from '@/store/taskStore'
import { placementForNew } from '../tasks/BrainDumpRail'
import type { Task } from '@/types'
import {
  TEMPLATES, draftWithAI, fromTemplate, scheduleWithAI, todayISO, addDays,
  type Draft, type OpenTask, type PlanTemplate, type Proposal,
} from './projectPlan'
import type { Project } from './types'

const LABEL: React.CSSProperties = { fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', marginBottom: 5, display: 'block' }
const CAP: React.CSSProperties = { fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)' }
const small: React.CSSProperties = { ...inputStyle, minHeight: 30, width: 'auto' }

type Mode = 'plan' | 'schedule'
type Row<T> = T & { on: boolean }

/** Plan a project: from a template or a few words, as a **draft you review**.
 *  Nothing exists until Add — not a milestone, not a task — and what is added is
 *  only what is still ticked, with the titles and dates as they now read. */
export function ProjectPlanner({ project, onClose }: { project: Project; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const addMilestone = useProjectStore(s => s.addMilestone)
  const deleteMilestone = useProjectStore(s => s.deleteMilestone)
  const allTasks = useTaskStore(s => s.tasks)
  const addTask = useTaskStore(s => s.addTask)
  const deleteTask = useTaskStore(s => s.deleteTask)
  const updateTask = useTaskStore(s => s.updateTask)

  const today = todayISO()
  const open = useMemo(
    () => allTasks.filter(t => t.projectId === project.id && !t.completed && t.status !== 'done' && t.status !== 'cancelled' && !t.dueDate),
    [allTasks, project.id])
  const milestones = useProjectStore(s => s.milestones)

  const [mode, setMode] = useState<Mode>('plan')
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<{ ms: Row<Draft['milestones'][number]>[]; ts: Row<Draft['tasks'][number]>[]; from: string } | null>(null)
  const [props, setProps] = useState<Row<Proposal>[] | null>(null)
  const ai = aiConfigured()
  const start = project.startDate && project.startDate > today ? project.startDate : today

  const reset = () => { setDraft(null); setProps(null); setError('') }
  const startDraft = (d: Draft, from: string) =>
    setDraft({ ms: d.milestones.map(m => ({ ...m, on: true })), ts: d.tasks.map(t => ({ ...t, on: true })), from })

  const useTemplate = (t: PlanTemplate) => { reset(); startDraft(fromTemplate(t, start, project.targetDate && project.targetDate > start ? project.targetDate : undefined), `the “${t.name}” template`) }

  async function askAI() {
    setBusy(true); setError('')
    try {
      const d = await draftWithAI(brief, { name: project.name, kind: project.kind, today, startDate: project.startDate, targetDate: project.targetDate, notes: project.notes })
      startDraft(d, 'the AI')
    } catch (e) { setError(e instanceof Error ? e.message : 'The AI could not draft a plan.') }
    finally { setBusy(false) }
  }

  const window_ = useMemo(() => {
    const to = project.targetDate && project.targetDate >= addDays(today, 3) ? project.targetDate : addDays(today, 28)
    return { from: today, to }
  }, [project.targetDate, today])

  async function askSchedule() {
    setBusy(true); setError('')
    try {
      const phaseOf = (t: Task) => milestones.find(m => m.id === t.milestoneId)?.title
      const asked: OpenTask[] = open.map(t => ({ id: t.id, title: t.title, priority: t.priority, phase: phaseOf(t) }))
      const out = await scheduleWithAI(asked, { name: project.name, today, from: window_.from, to: window_.to })
      setProps(out.map(p => ({ ...p, on: true })))
    } catch (e) { setError(e instanceof Error ? e.message : 'The AI could not date these.') }
    finally { setBusy(false) }
  }

  // ── Apply: the only place anything is written ──────────────────────────────
  function applyPlan() {
    if (!draft) return
    const msOn = draft.ms.filter(m => m.on && m.title.trim())
    const tsOn = draft.ts.filter(t => t.on && t.title.trim())
    const madeMs: string[] = [], madeTs: string[] = []
    suppressUndo(() => {
      const idOf = new Map<string, string>()
      for (const m of msOn) idOf.set(m.key, addMilestone(project.id, { title: m.title.trim(), dueDate: m.dueDate || undefined }))
      madeMs.push(...idOf.values())
      for (const t of tsOn) {
        const base = {
          title: t.title.trim(),
          company: (project.companyId ?? 'personal') as Task['company'], companyId: project.companyId,
          status: 'open' as Task['status'], completed: false, projectId: project.id,
          milestoneId: t.milestoneKey ? idOf.get(t.milestoneKey) : undefined,
          dueDate: t.dueDate || undefined, priority: t.priority,
        }
        madeTs.push(addTask({ ...base, quadrant: placementForNew({ ...base, id: '', createdAt: '' } as Task) } as Omit<Task, 'id' | 'createdAt'>))
      }
    })
    // One gesture, one undo: the tasks go, then the milestones, and the tasks'
    // `milestoneId` is already gone with them.
    pushUndo(`Added a plan to “${project.name}”`, () => suppressUndo(() => {
      for (const id of madeTs) deleteTask(id)
      for (const id of madeMs) deleteMilestone(id)
    }))
    notify(`Added ${msOn.length} milestone${msOn.length === 1 ? '' : 's'} and ${tsOn.length} task${tsOn.length === 1 ? '' : 's'}`)
    onClose()
  }

  function applySchedule() {
    if (!props) return
    const on = props.filter(p => p.on && p.dueDate)
    // The app's own snapshot undo: puts every task back as it was, including the
    // quadrant a first date moves it out of.
    useTaskStore.getState()._remember(`Dated ${on.length} task${on.length === 1 ? '' : 's'} in “${project.name}”`)
    suppressUndo(() => { for (const p of on) updateTask(p.id, { dueDate: p.dueDate }) })
    notify(`Dated ${on.length} task${on.length === 1 ? '' : 's'}`)
    onClose()
  }

  const msOn = draft?.ms.filter(m => m.on && m.title.trim()).length ?? 0
  const tsOn = draft?.ts.filter(t => t.on && t.title.trim()).length ?? 0
  const datedOn = (draft?.ts.filter(t => t.on && t.title.trim() && t.dueDate && t.dueDate >= today).length ?? 0)
  const schedOn = props?.filter(p => p.on && p.dueDate).length ?? 0
  const schedDated = props?.filter(p => p.on && p.dueDate && p.dueDate >= today).length ?? 0
  const taskTitle = (id: string) => open.find(t => t.id === id)?.title ?? ''

  const Check = ({ on, label, set }: { on: boolean; label: string; set: (v: boolean) => void }) => (
    <input type="checkbox" checked={on} aria-label={label} onChange={e => set(e.target.checked)} style={{ accentColor: 'var(--sb-ink-1)', width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
  )

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Plan this project" data-project-planner style={{
        width: 'min(720px, 100%)', maxHeight: 'calc(94 * var(--vh))', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Plan “{project.name}”</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 6, padding: '4px 20px 8px' }}>
          {([['plan', 'Start a plan'], ['schedule', `Date my open tasks${open.length ? ` · ${open.length}` : ''}`]] as const).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={mode === v} onClick={() => { setMode(v); reset() }}
              disabled={v === 'schedule' && open.length === 0}
              style={{ height: 28, padding: '0 12px', borderRadius: 999, border: 'none', cursor: v === 'schedule' && open.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
                background: mode === v ? 'var(--sb-ink-1)' : 'var(--sb-field)', color: mode === v ? 'var(--sb-ink-on-dark)' : v === 'schedule' && open.length === 0 ? 'var(--sb-ink-4)' : 'var(--sb-ink-2)' }}>{label}</button>
          ))}
        </div>

        <div style={{ overflowY: 'auto', padding: '4px 20px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div role="alert" data-planner-error style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative-deep)', lineHeight: 1.45 }}>{error}</div>}

          {mode === 'plan' && !draft && (
            <>
              <div>
                <span style={LABEL}>Start from a template</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))', gap: 8 }}>
                  {[...TEMPLATES].sort((a, b) => Number(b.kind === project.kind) - Number(a.kind === project.kind)).map(t => (
                    <button key={t.id} type="button" data-template={t.id} onClick={() => useTemplate(t)}
                      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--sb-r-card)', cursor: 'pointer', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontFamily: 'inherit' }}>
                      <span style={{ display: 'block', fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{t.name}</span>
                      <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2, lineHeight: 1.4 }}>{t.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label>
                  <span style={LABEL}>Or describe it, and the AI drafts one</span>
                  <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3} aria-label="Describe the project"
                    placeholder="Move our shop online by January: catalogue of 40 products, card payments, and a launch email to existing customers"
                    style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.45 }} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <Button variant="accent" onClick={() => void askAI()} disabled={!ai || busy || brief.trim().length < 8}>
                    <Sparkles size={ICON.md} /> {busy ? 'Drafting…' : 'Draft with AI'}
                  </Button>
                  {!ai && <span data-planner-nokey style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Add a key in Settings → AI to draft from words. Templates need none.</span>}
                  {ai && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>You will see the draft first. Nothing is added until you press Add.</span>}
                </div>
              </div>
            </>
          )}

          {mode === 'plan' && draft && (
            <div data-planner-preview>
              <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginBottom: 8 }}>
                A draft from {draft.from}. Untick what you do not want; rename or re-date anything. <b style={{ color: 'var(--sb-ink-1)' }}>Nothing exists yet.</b>
              </div>
              <div style={CAP}>Milestones · {msOn} of {draft.ms.length}</div>
              {draft.ms.length === 0 && <p style={{ margin: '6px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>None drafted.</p>}
              {draft.ms.map((m, i) => (
                <div key={m.key} data-draft-milestone={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
                  <Check on={m.on} label={`Include milestone ${m.title}`} set={v => setDraft(d => d && ({ ...d, ms: d.ms.map((x, j) => (j === i ? { ...x, on: v } : x)) }))} />
                  <input value={m.title} aria-label={`Milestone name ${i + 1}`} onChange={e => setDraft(d => d && ({ ...d, ms: d.ms.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} style={{ ...small, flex: 1, minWidth: 0, opacity: m.on ? 1 : 0.5 }} />
                  <input type="date" value={m.dueDate ?? ''} aria-label={`Date for milestone ${i + 1}`} onChange={e => setDraft(d => d && ({ ...d, ms: d.ms.map((x, j) => (j === i ? { ...x, dueDate: e.target.value || undefined } : x)) }))} style={{ ...small, width: 140, opacity: m.on ? 1 : 0.5 }} />
                </div>
              ))}
              <div style={{ ...CAP, marginTop: 12 }}>Tasks · {tsOn} of {draft.ts.length}</div>
              {draft.ts.length === 0 && <p style={{ margin: '6px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>None drafted.</p>}
              {draft.ts.map((t, i) => {
                const phaseOn = draft.ms.find(m => m.key === t.milestoneKey)
                return (
                  <div key={t.key} data-draft-task={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
                    <Check on={t.on} label={`Include task ${t.title}`} set={v => setDraft(d => d && ({ ...d, ts: d.ts.map((x, j) => (j === i ? { ...x, on: v } : x)) }))} />
                    <input value={t.title} aria-label={`Task name ${i + 1}`} onChange={e => setDraft(d => d && ({ ...d, ts: d.ts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} style={{ ...small, flex: '1 1 200px', minWidth: 0, opacity: t.on ? 1 : 0.5 }} />
                    <select aria-label={`Phase for task ${i + 1}`} value={t.milestoneKey ?? ''} onChange={e => setDraft(d => d && ({ ...d, ts: d.ts.map((x, j) => (j === i ? { ...x, milestoneKey: e.target.value || undefined } : x)) }))} style={{ ...small, flex: '0 1 150px', opacity: t.on ? 1 : 0.5 }}>
                      <option value="">No phase</option>
                      {draft.ms.map(m => <option key={m.key} value={m.key}>{m.title || '(untitled)'}</option>)}
                    </select>
                    <input type="date" value={t.dueDate ?? ''} aria-label={`Date for task ${i + 1}`} onChange={e => setDraft(d => d && ({ ...d, ts: d.ts.map((x, j) => (j === i ? { ...x, dueDate: e.target.value || undefined } : x)) }))} style={{ ...small, width: 140, opacity: t.on ? 1 : 0.5 }} />
                    {t.milestoneKey && phaseOn && !phaseOn.on && t.on && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>its phase is unticked — it goes in with none</span>}
                  </div>
                )
              })}
            </div>
          )}

          {mode === 'schedule' && !props && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-body)', lineHeight: 1.5, color: 'var(--sb-ink-2)' }}>
                {open.length} open task{open.length === 1 ? ' has' : 's have'} no date. The AI proposes days between {window_.from} and {window_.to}, earlier for higher priority and close together within a phase. You review before anything changes.
              </p>
              <Button variant="accent" onClick={() => void askSchedule()} disabled={!ai || busy}><Sparkles size={ICON.md} /> {busy ? 'Proposing…' : 'Propose dates'}</Button>
              {!ai && <span data-planner-nokey style={{ marginLeft: 10, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Add a key in Settings → AI to use this.</span>}
            </div>
          )}

          {mode === 'schedule' && props && (
            <div data-planner-schedule>
              <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginBottom: 8 }}>Proposed dates. <b style={{ color: 'var(--sb-ink-1)' }}>No task has changed yet.</b></div>
              {props.map((p, i) => (
                <div key={p.id} data-proposal={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
                  <Check on={p.on} label={`Date ${taskTitle(p.id)}`} set={v => setProps(ps => ps && ps.map((x, j) => (j === i ? { ...x, on: v } : x)))} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: p.on ? 1 : 0.5 }}>{taskTitle(p.id)}</span>
                  <input type="date" value={p.dueDate} aria-label={`Date for ${taskTitle(p.id)}`} onChange={e => setProps(ps => ps && ps.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} style={{ ...small, width: 140, opacity: p.on ? 1 : 0.5 }} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px 16px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
          {(draft || props) && <Button variant="ghost" onClick={reset}>Back</Button>}
          <span style={{ flex: 1, minWidth: 120 }}>
            {draft && datedOn > 0 && (
              <span data-planner-calendar-note style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.4 }}>
                {datedOn} of these tasks {datedOn === 1 ? 'has' : 'have'} a date, so {datedOn === 1 ? 'it' : 'they'} will be put on your calendar, as any dated task is.
              </span>
            )}
            {props && schedDated > 0 && (
              <span data-planner-calendar-note style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.4 }}>
                Dated tasks are put on your calendar — {schedDated} will be.
              </span>
            )}
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {draft && <Button variant="primary" onClick={applyPlan} disabled={msOn + tsOn === 0}>Add {msOn} milestone{msOn === 1 ? '' : 's'} and {tsOn} task{tsOn === 1 ? '' : 's'}</Button>}
          {props && <Button variant="primary" onClick={applySchedule} disabled={schedOn === 0}>Date {schedOn} task{schedOn === 1 ? '' : 's'}</Button>}
        </div>
      </div>
    </div>
  )
}
