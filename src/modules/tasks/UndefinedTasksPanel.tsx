import { useState } from 'react'
import { Plus, Trash2, X, Inbox, Check, Calendar, User } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { getAllUsers, loadDynamicCompanies, COMPANY_COLORS, COMPANY_LABELS, type TaskStatus, type CompanyTag } from '@/types'

type Filter = 'all' | 'open' | 'done' | 'cancelled'

const inp: React.CSSProperties = {
  background: '#0D0F1A',
  border: '1px solid #252A3E',
  borderRadius: 6, padding: '5px 8px', fontSize: 12,
  color: '#E8EAF6', outline: 'none', width: '100%',
}
const sel: React.CSSProperties = { ...inp }

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: '#7F77DD', done: '#1D9E75', cancelled: '#6B7280',
}

interface Props {
  onOpen: (id: string) => void
}

export function UndefinedTasksPanel({ onOpen }: Props) {
  const { tasks, addTask, deleteTask, toggleComplete } = useTaskStore()
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
    : filter === 'done'
      ? inbox.filter(t => t.completed || t.status === 'done')
      : filter === 'open'
        ? inbox.filter(t => !t.completed && (t.status === 'open' || !t.status))
        : inbox.filter(t => t.status === filter)

  const counts: Record<Filter, number> = {
    all:       inbox.length,
    open:      inbox.filter(t => !t.completed && (t.status === 'open' || !t.status)).length,
    done:      inbox.filter(t => t.completed || t.status === 'done').length,
    cancelled: inbox.filter(t => t.status === 'cancelled').length,
  }

  function reset() {
    setTitle(''); setCompanyId(''); setDueDate(''); setOwner('')
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
      width: 300, flexShrink: 0,
      background: '#161929',
      border: '1px solid #252A3E',
      borderRadius: 12, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', maxHeight: 'calc(100vh - 160px)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #252A3E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Inbox size={14} color="#6B7280" />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#E8EAF6' }}>Inbox</span>
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, fontWeight: 600,
            color: '#6B7280', background: '#6B728018', padding: '1px 6px', borderRadius: 4,
          }}>{inbox.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
              cursor: 'pointer', textTransform: 'capitalize',
              background: filter === f ? '#1E40AF18' : 'transparent',
              border: `1px solid ${filter === f ? '#1E40AF50' : '#252A3E'}`,
              color: filter === f ? '#7F77DD' : '#6B7280',
            }}>
              {f} {counts[f] > 0 && <span style={{ opacity: 0.7 }}>({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
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
          const accentColor = co?.color ?? COMPANY_COLORS[t.company] ?? '#6B7280'
          const companyLabel = co?.name ?? COMPANY_LABELS[t.company as CompanyTag] ?? t.company

          return (
            <div
              key={t.id}
              onClick={() => onOpen(t.id)}
              style={{
                padding: '9px 11px',
                background: '#0D0F1A',
                border: '1px solid #252A3E',
                borderRadius: 8,
                opacity: taskStatus === 'cancelled' ? 0.5 : taskStatus === 'done' ? 0.6 : 1,
                position: 'relative',
                cursor: 'pointer',
                transition: 'border-color 0.15s ease, background 0.15s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#353A50' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#252A3E' }}
            >
              {/* Left accent */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                background: accentColor, borderRadius: '8px 0 0 8px', opacity: 0.7,
              }} />

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, paddingLeft: 4 }}>
                {/* Checkbox */}
                <button
                  onClick={e => { e.stopPropagation(); toggleComplete(t.id) }}
                  style={{
                    width: 15, height: 15, borderRadius: 4,
                    border: `1.5px solid ${t.completed ? '#1D9E75' : '#252A3E'}`,
                    background: t.completed ? '#1D9E75' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0, marginTop: 1, transition: 'all 0.15s ease',
                  }}
                >
                  {t.completed && <Check size={9} color="#fff" strokeWidth={3} />}
                </button>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: 0, fontSize: 12.5, fontWeight: 500, color: '#E8EAF6',
                    lineHeight: 1.35,
                    textDecoration: taskStatus === 'done' ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.title}</p>

                  {/* Meta row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: accentColor,
                      background: `${accentColor}18`, padding: '1px 5px', borderRadius: 3,
                    }}>{companyLabel}</span>

                    {t.dueDate && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6B7280' }}>
                        <Calendar size={9} />
                        {new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}

                    {ownerUser && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#1D9E75' }}>
                        <User size={9} /> {ownerUser.name}
                      </span>
                    )}

                    {/* Status dot */}
                    <span style={{
                      marginLeft: 'auto',
                      width: 6, height: 6, borderRadius: '50%',
                      background: STATUS_COLORS[taskStatus], flexShrink: 0,
                    }} />
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={e => { e.stopPropagation(); deleteTask(t.id) }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#6B7280', padding: 2, borderRadius: 4,
                    display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0' }}
                  onFocus={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                  onBlur={e => { (e.currentTarget as HTMLElement).style.opacity = '0' }}
                >
                  <Trash2 size={11} strokeWidth={2} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add form */}
      <div style={{ borderTop: '1px solid #252A3E', padding: '8px' }}>
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
                background: '#1E40AF18', border: '1px solid #1E40AF50',
                color: '#7F77DD', cursor: title.trim() ? 'pointer' : 'not-allowed',
                opacity: title.trim() ? 1 : 0.4,
              }}>Add Task</button>
              <button onClick={reset} style={{
                padding: '6px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid #252A3E',
                color: '#6B7280', cursor: 'pointer', fontSize: 12,
              }}><X size={12} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            width: '100%', background: 'transparent', border: '1px dashed #252A3E',
            borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            color: '#6B7280', fontSize: 12, padding: '7px 10px',
          }}>
            <Plus size={12} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}
