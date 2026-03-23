import { useState } from 'react'
import { Plus, Trash2, X, Inbox } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { getAllUsers, loadDynamicCompanies, type TaskStatus } from '@/types'

type Filter = 'all' | 'open' | 'done' | 'cancelled'

const inp: React.CSSProperties = {
  background: 'var(--color-surface2, #0D0F1A)',
  border: '1px solid var(--color-border, #252A3E)',
  borderRadius: 6, padding: '5px 8px', fontSize: 12,
  color: 'var(--color-text, #E8EAF6)', outline: 'none', width: '100%',
}
const sel: React.CSSProperties = { ...inp }

const STATUS_COLORS: Record<TaskStatus, string> = {
  open:      '#7F77DD',
  done:      '#1D9E75',
  cancelled: '#6B7280',
}

export function UndefinedTasksPanel() {
  const { tasks, addTask, updateTask, deleteTask, setStatus } = useTaskStore()
  const [filter, setFilter] = useState<Filter>('open')
  const [adding, setAdding] = useState(false)

  // Form state
  const [title, setTitle]         = useState('')
  const [companyId, setCompanyId] = useState('')
  const [dueDate, setDueDate]     = useState('')
  const [owner, setOwner]         = useState('')
  const [duration, setDuration]   = useState('')
  const [status, setFormStatus]   = useState<TaskStatus>('open')

  const companies = loadDynamicCompanies()
  const users     = getAllUsers()

  const inbox = tasks.filter(t => t.quadrant === null)
  const filtered = filter === 'all'
    ? inbox
    : inbox.filter(t => (filter === 'done' ? t.completed || t.status === 'done' : t.status === filter) ||
        (filter === 'open' && !t.completed && (t.status === 'open' || !t.status)))

  const counts: Record<Filter, number> = {
    all:       inbox.length,
    open:      inbox.filter(t => !t.completed && (t.status === 'open' || !t.status)).length,
    done:      inbox.filter(t => t.completed || t.status === 'done').length,
    cancelled: inbox.filter(t => t.status === 'cancelled').length,
  }

  function reset() {
    setTitle(''); setCompanyId(''); setDueDate(''); setOwner('');
    setDuration(''); setFormStatus('open'); setAdding(false)
  }

  function handleAdd() {
    if (!title.trim()) { reset(); return }
    addTask({
      title: title.trim(),
      quadrant: null,
      company: 'teradix',
      status,
      completed: status === 'done',
      ...(companyId && { companyId }),
      ...(dueDate   && { dueDate }),
      ...(owner     && { owner }),
      ...(duration  && { duration: parseInt(duration, 10) }),
    })
    reset()
  }

  const FILTERS: Filter[] = ['all', 'open', 'done', 'cancelled']

  return (
    <div style={{
      width: 340, flexShrink: 0,
      background: 'var(--color-surface, #161929)',
      border: '1px solid var(--color-border, #252A3E)',
      borderRadius: 12, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', maxHeight: 'calc(100vh - 160px)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid var(--color-border, #252A3E)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Inbox size={14} color="#6B7280" />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text, #E8EAF6)' }}>Undefined</span>
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, fontWeight: 600,
            color: '#6B7280', background: '#6B728018', padding: '1px 6px', borderRadius: 4,
          }}>{inbox.length}</span>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '3px 9px', borderRadius: 5, fontSize: 11, fontWeight: 500,
              cursor: 'pointer', textTransform: 'capitalize',
              background: filter === f ? 'var(--color-accent-fill)' : 'transparent',
              border: `1px solid ${filter === f ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
              color: filter === f ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
            }}>
              {f} {counts[f] > 0 && <span style={{ opacity: 0.7 }}>({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {filtered.length === 0 && !adding && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 80, color: '#6B7280', fontSize: 12, fontStyle: 'italic',
          }}>No tasks</div>
        )}

        {filtered.map(t => {
          const co = companies.find(c => c.id === t.companyId)
          const ownerUser = t.owner ? users.find(u => u.id === t.owner) : undefined
          const taskStatus: TaskStatus = t.completed ? 'done' : (t.status ?? 'open')

          return (
            <div key={t.id} style={{
              padding: '10px 10px', marginBottom: 6,
              background: 'var(--color-surface2, #0D0F1A)',
              border: '1px solid var(--color-border, #252A3E)',
              borderRadius: 9,
              opacity: taskStatus === 'cancelled' ? 0.55 : 1,
            }}>
              {/* Title row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
                <p style={{
                  margin: 0, flex: 1, fontSize: 12.5, fontWeight: 500,
                  color: 'var(--color-text, #E8EAF6)', lineHeight: 1.35,
                  textDecoration: taskStatus === 'done' ? 'line-through' : 'none',
                }}>{t.title}</p>
                <button onClick={() => deleteTask(t.id)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#6B7280', padding: 2, flexShrink: 0,
                }}><Trash2 size={11} /></button>
              </div>

              {/* Fields grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 8px', fontSize: 11 }}>
                {/* Company */}
                <div>
                  <span style={{ color: '#6B7280', fontSize: 10, display: 'block', marginBottom: 2 }}>Company</span>
                  <select value={t.companyId ?? ''} onChange={e => updateTask(t.id, { companyId: e.target.value })}
                    style={{ ...sel, fontSize: 11, padding: '3px 6px' }}>
                    <option value="">—</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* Due date */}
                <div>
                  <span style={{ color: '#6B7280', fontSize: 10, display: 'block', marginBottom: 2 }}>Due date</span>
                  <input type="date" value={t.dueDate ?? ''}
                    onChange={e => updateTask(t.id, { dueDate: e.target.value })}
                    style={{ ...sel, fontSize: 11, padding: '3px 6px' }} />
                </div>

                {/* Owner */}
                <div>
                  <span style={{ color: '#6B7280', fontSize: 10, display: 'block', marginBottom: 2 }}>Owner</span>
                  <select value={t.owner ?? ''} onChange={e => updateTask(t.id, { owner: e.target.value })}
                    style={{ ...sel, fontSize: 11, padding: '3px 6px' }}>
                    <option value="">—</option>
                    {co
                      ? (co.users ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)
                      : users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.companyName}</option>)
                    }
                  </select>
                </div>

                {/* Duration */}
                <div>
                  <span style={{ color: '#6B7280', fontSize: 10, display: 'block', marginBottom: 2 }}>Duration (min)</span>
                  <input type="number" min={5} step={5} value={t.duration ?? ''}
                    onChange={e => updateTask(t.id, { duration: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                    placeholder="—" style={{ ...sel, fontSize: 11, padding: '3px 6px' }} />
                </div>
              </div>

              {/* Status selector */}
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {(['open', 'done', 'cancelled'] as TaskStatus[]).map(s => (
                  <button key={s} onClick={() => setStatus(t.id, s)} style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                    cursor: 'pointer', textTransform: 'capitalize',
                    background: taskStatus === s ? STATUS_COLORS[s] + '22' : 'transparent',
                    border: `1px solid ${taskStatus === s ? STATUS_COLORS[s] + '80' : '#252A3E'}`,
                    color: taskStatus === s ? STATUS_COLORS[s] : '#6B7280',
                  }}>{s}</button>
                ))}

                {/* Company color dot */}
                {co && (
                  <span style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, color: '#6B7280',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: co.color, display: 'inline-block' }} />
                    {ownerUser?.name ?? co.name}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add form */}
      <div style={{ borderTop: '1px solid var(--color-border, #252A3E)', padding: '8px' }}>
        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') reset() }}
              placeholder="Task title…" style={inp} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Company</span>
                <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={sel}>
                  <option value="">—</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Due date</span>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={sel} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Owner</span>
                <select value={owner} onChange={e => setOwner(e.target.value)} style={sel}>
                  <option value="">—</option>
                  {(companyId
                    ? (companies.find(c => c.id === companyId)?.users ?? []).map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))
                    : users.map(u => (
                        <option key={u.id} value={u.id}>{u.name} · {u.companyName}</option>
                      ))
                  )}
                </select>
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Duration (min)</span>
                <input type="number" min={5} step={5} value={duration}
                  onChange={e => setDuration(e.target.value)} placeholder="60" style={sel} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 2 }}>Status</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {(['open', 'done', 'cancelled'] as TaskStatus[]).map(s => (
                    <button key={s} onClick={() => setFormStatus(s)} style={{
                      flex: 1, padding: '4px', borderRadius: 5, fontSize: 11, fontWeight: 500,
                      cursor: 'pointer', textTransform: 'capitalize',
                      background: status === s ? STATUS_COLORS[s] + '22' : 'transparent',
                      border: `1px solid ${status === s ? STATUS_COLORS[s] + '80' : '#252A3E'}`,
                      color: status === s ? STATUS_COLORS[s] : '#6B7280',
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleAdd} disabled={!title.trim()} style={{
                flex: 1, padding: '6px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)50',
                color: 'var(--color-accent, #1E40AF)', cursor: title.trim() ? 'pointer' : 'not-allowed',
                opacity: title.trim() ? 1 : 0.4,
              }}>Add Task</button>
              <button onClick={reset} style={{
                padding: '6px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--color-border, #252A3E)',
                color: '#6B7280', cursor: 'pointer', fontSize: 12,
              }}><X size={12} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            width: '100%', background: 'transparent', border: '1px dashed var(--color-border, #252A3E)',
            borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            color: '#6B7280', fontSize: 12, padding: '7px 10px',
          }}>
            <Plus size={12} /> Add undefined task
          </button>
        )}
      </div>
    </div>
  )
}
