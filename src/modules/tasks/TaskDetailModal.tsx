import { useState } from 'react'
import { X, Clock, Calendar, User, Building2, Activity } from 'lucide-react'
import type { Task, CompanyTag, TaskStatus, TaskType } from '@/types'
import {
  COMPANY_LABELS, COMPANY_COLORS, TASK_TYPE_META, inferTaskType, getAllUsers,
  loadDynamicCompanies,
} from '@/types'
import { useTaskStore } from '@/store/taskStore'

const COMPANY_TAGS: CompanyTag[] = ['teradix', 'dxtech', 'consulting', 'personal']
const QUADRANT_OPTS = [
  { value: '', label: 'Inbox (unassigned)' },
  { value: 'do', label: 'Do — Urgent + Important' },
  { value: 'schedule', label: 'Schedule — Not Urgent + Important' },
  { value: 'delegate', label: 'Delegate — Urgent + Not Important' },
  { value: 'eliminate', label: 'Eliminate — Not Urgent + Not Important' },
]
const STATUS_COLORS: Record<TaskStatus, string> = {
  open: '#7F77DD', done: '#1D9E75', cancelled: '#6B7280',
}

const field: React.CSSProperties = {
  background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 6,
  padding: '6px 9px', fontSize: 12, color: 'var(--color-text, #E8EAF6)', outline: 'none', width: '100%',
  fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 10.5, color: '#6B7280', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4,
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function activityIcon(type: string) {
  const s = { width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5 }
  if (type === 'created')        return <span style={{ ...s, background: '#1D9E75' }} />
  if (type === 'moved')          return <span style={{ ...s, background: '#7F77DD' }} />
  if (type === 'status_changed') return <span style={{ ...s, background: '#F59E0B' }} />
  return                                <span style={{ ...s, background: '#6B7280' }} />
}

interface Props {
  task: Task
  onClose: () => void
}

export function TaskDetailModal({ task, onClose }: Props) {
  const { updateTask, setStatus, activities } = useTaskStore()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)

  const companies  = loadDynamicCompanies()
  const users      = getAllUsers()
  const taskActs   = activities.filter(a => a.taskId === task.id).slice().reverse()
  const activeCo   = companies.find(c => c.id === task.companyId)
  const companyColor = activeCo?.color ?? COMPANY_COLORS[task.company] ?? '#6B7280'
  const taskStatus: TaskStatus = task.completed ? 'done' : (task.status ?? 'open')

  function handleCompanyChange(value: string) {
    if (companies.length > 0) {
      const co = companies.find(c => c.id === value)
      updateTask(task.id, { companyId: value || undefined, company: (co?.id ?? value) as CompanyTag })
    } else {
      updateTask(task.id, { company: value as CompanyTag, companyId: undefined })
    }
  }

  function saveTitle() {
    const t = titleDraft.trim()
    if (t && t !== task.title) updateTask(task.id, { title: t })
    else setTitleDraft(task.title)
    setEditingTitle(false)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 580, maxHeight: '85vh',
          background: 'var(--color-surface, #161929)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 14,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px 14px',
          borderBottom: '1px solid var(--color-border, #252A3E)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 4, minHeight: 28, borderRadius: 2,
            background: companyColor, flexShrink: 0, marginTop: 2,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveTitle()
                  if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false) }
                }}
                style={{
                  ...field, padding: '2px 0', background: 'transparent', border: 'none',
                  borderBottom: '1px solid #7F77DD', borderRadius: 0,
                  fontSize: 16, fontWeight: 700,
                }}
              />
            ) : (
              <h2
                onClick={() => setEditingTitle(true)}
                title="Click to rename"
                style={{
                  margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text, #E8EAF6)',
                  cursor: 'text', lineHeight: 1.3,
                  textDecoration: task.completed ? 'line-through' : 'none',
                }}
              >{task.title}</h2>
            )}
            <div style={{ marginTop: 4, fontSize: 11, color: '#6B7280' }}>
              Created {relativeTime(task.createdAt)}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6B7280', padding: 4, borderRadius: 6, flexShrink: 0,
            display: 'flex', alignItems: 'center',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>

          {/* Details grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 24 }}>

            {/* Company */}
            <div>
              <div style={lbl}><Building2 size={10} /> Company</div>
              <select
                value={companies.length > 0 ? (task.companyId ?? '') : task.company}
                onChange={e => handleCompanyChange(e.target.value)}
                style={field}
              >
                {companies.length > 0
                  ? <>
                      <option value="">— none —</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </>
                  : COMPANY_TAGS.map(c => <option key={c} value={c}>{COMPANY_LABELS[c]}</option>)
                }
              </select>
            </div>

            {/* Task Type */}
            <div>
              <div style={lbl}>Task Type</div>
              <select
                value={task.taskType ?? inferTaskType(task.title)}
                onChange={e => updateTask(task.id, { taskType: e.target.value as TaskType })}
                style={field}
              >
                {(Object.keys(TASK_TYPE_META) as TaskType[]).map(k => (
                  <option key={k} value={k}>{TASK_TYPE_META[k].emoji} {TASK_TYPE_META[k].label}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <div style={lbl}><Activity size={10} /> Status</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {(['open', 'done', 'cancelled'] as TaskStatus[]).map(s => (
                  <button key={s} onClick={() => setStatus(task.id, s)} style={{
                    flex: 1, padding: '5px 4px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
                    cursor: 'pointer', textTransform: 'capitalize',
                    background: taskStatus === s ? STATUS_COLORS[s] + '22' : 'transparent',
                    border: `1px solid ${taskStatus === s ? STATUS_COLORS[s] + '80' : 'var(--color-border, #252A3E)'}`,
                    color: taskStatus === s ? STATUS_COLORS[s] : '#6B7280',
                  }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Quadrant */}
            <div>
              <div style={lbl}>Quadrant</div>
              <select
                value={task.quadrant ?? ''}
                onChange={e => updateTask(task.id, { quadrant: (e.target.value || null) as any })}
                style={field}
              >
                {QUADRANT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Due Date */}
            <div>
              <div style={lbl}><Calendar size={10} /> Due Date</div>
              <input type="date" value={task.dueDate ?? ''}
                onChange={e => updateTask(task.id, { dueDate: e.target.value || undefined })}
                style={field} />
            </div>

            {/* Duration */}
            <div>
              <div style={lbl}><Clock size={10} /> Duration (min)</div>
              <input type="number" min={5} step={5} value={task.duration ?? ''}
                onChange={e => updateTask(task.id, { duration: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                placeholder="—" style={field} />
            </div>

            {/* Planned Time */}
            <div>
              <div style={lbl}><Clock size={10} /> Planned Time</div>
              <input type="time" value={task.plannedTime ?? ''}
                onChange={e => updateTask(task.id, { plannedTime: e.target.value || undefined })}
                style={field} />
            </div>

            {/* Owner — full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={lbl}><User size={10} /> Owner</div>
              <select value={task.owner ?? ''}
                onChange={e => updateTask(task.id, { owner: e.target.value || undefined })}
                style={field}
              >
                <option value="">— none —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} · {u.companyName}</option>
                ))}
              </select>
              {users.length === 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 10.5, color: '#6B7280' }}>
                  Add users under Settings → Companies first.
                </p>
              )}
            </div>

          </div>

          {/* Activity Log */}
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#6B7280',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              marginBottom: 10,
            }}>Activity</div>

            {taskActs.length === 0 ? (
              <p style={{ fontSize: 12, color: '#6B7280', fontStyle: 'italic', margin: 0 }}>No activity yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {taskActs.map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {activityIcon(a.type)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: '#C7CAE0' }}>{a.description}</span>
                      <span style={{ fontSize: 10, color: '#6B7280', marginLeft: 8 }}>{relativeTime(a.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
