import { useState, useEffect, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, X, Sparkles } from 'lucide-react'
import { TaskCard } from './TaskCard'
import type { Task, Quadrant } from '@/types'
import { QUADRANT_META, getAllUsers, loadDynamicCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { analyzeTask } from '@/lib/professor'
import type { TaskAnalysis } from '@/lib/professor'

const inp: React.CSSProperties = {
  background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 6,
  padding: '5px 8px', fontSize: 12, color: 'var(--color-text, #E8EAF6)', outline: 'none', width: '100%',
}
const lbl: React.CSSProperties = { fontSize: 10.5, color: '#6B7280', marginBottom: 3, display: 'block' }

interface QuadrantColumnProps {
  quadrant: Quadrant
  tasks: Task[]
  onOpen: (id: string) => void
}

export function QuadrantColumn({ quadrant, tasks, onOpen }: QuadrantColumnProps) {
  const meta = QUADRANT_META[quadrant]
  const { isOver, setNodeRef } = useDroppable({ id: quadrant })
  const addTask = useTaskStore(s => s.addTask)

  const [adding, setAdding]         = useState(false)
  const [title, setTitle]           = useState('')
  const [dueDate, setDueDate]       = useState('')
  const [duration, setDuration]     = useState('')
  const [plannedTime, setPlanned]   = useState('')
  const [owner, setOwner]           = useState('')
  const [aiHint, setAiHint]         = useState<TaskAnalysis | null>(null)
  const [aiLoading, setAiLoading]   = useState(false)
  const aiTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const users = getAllUsers()
  const companies = loadDynamicCompanies()

  // Debounce AI analysis 900ms after typing stops
  useEffect(() => {
    if (!adding || title.trim().length < 4) { setAiHint(null); return }
    if (aiTimer.current) clearTimeout(aiTimer.current)
    aiTimer.current = setTimeout(async () => {
      setAiLoading(true)
      const result = await analyzeTask(title, companies)
      setAiHint(result)
      setAiLoading(false)
    }, 900)
    return () => { if (aiTimer.current) clearTimeout(aiTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, adding])

  function reset() {
    setTitle(''); setDueDate(''); setDuration(''); setPlanned(''); setOwner('')
    setAiHint(null); setAdding(false)
  }

  function handleAdd() {
    if (!title.trim()) { reset(); return }
    const finalTitle = (aiHint?.titleWithIcon ?? title).trim()
    const finalOwner = owner || aiHint?.ownerId || ''
    const finalCompanyId = aiHint?.companyId || undefined
    addTask({
      title: finalTitle,
      quadrant,
      company: 'teradix',
      status: 'open',
      completed: false,
      ...(dueDate       && { dueDate }),
      ...(duration      && { duration: parseInt(duration, 10) }),
      ...(plannedTime   && { plannedTime }),
      ...(finalOwner    && { owner: finalOwner }),
      ...(finalCompanyId && { companyId: finalCompanyId }),
    })
    reset()
  }

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && !t.completed)
  const doneTasks   = tasks.filter(t => t.completed || t.status === 'done')

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-surface, #161929)',
        border: `1px solid ${isOver ? meta.color + '60' : 'var(--color-border, #252A3E)'}`,
        borderRadius: 12, overflow: 'hidden',
        transition: 'border-color 0.15s ease', minHeight: 280,
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '1px solid var(--color-border, #252A3E)',
        background: isOver ? `${meta.color}08` : 'transparent',
        transition: 'background 0.15s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', letterSpacing: '-0.2px' }}>
            {meta.label}
          </h3>
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, fontWeight: 600,
            color: meta.color, background: `${meta.color}18`,
            padding: '1px 6px', borderRadius: 4,
          }}>{activeTasks.length}</span>
        </div>
        <p style={{ margin: '2px 0 0 16px', fontSize: 10.5, color: '#6B7280' }}>{meta.sub}</p>
      </div>

      {/* Drop zone */}
      <div ref={setNodeRef} style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: 5, minHeight: 100 }}>
        <SortableContext items={activeTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {activeTasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
        </SortableContext>

        {/* Completed tasks (collapsed) */}
        {doneTasks.length > 0 && (
          <div style={{ marginTop: 4, opacity: 0.5 }}>
            {doneTasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
          </div>
        )}

        {activeTasks.length === 0 && doneTasks.length === 0 && !adding && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7280', fontSize: 11.5, fontStyle: 'italic',
            opacity: isOver ? 0 : 0.6,
            border: `1px dashed ${isOver ? meta.color : 'var(--color-border, #252A3E)'}`,
            borderRadius: 8, minHeight: 60, transition: 'all 0.15s ease',
          }}>{isOver ? '' : 'Drop tasks here'}</div>
        )}
      </div>

      {/* Add task area */}
      <div style={{ padding: '8px', borderTop: '1px solid var(--color-border, #252A3E)' }}>
        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {/* Title */}
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') reset() }}
              placeholder="Task title…" style={inp} />

            {/* AI suggestion strip */}
            {(aiLoading || aiHint) && (
              <div style={{
                background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 6,
                padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center',
              }}>
                <Sparkles size={10} color="#7F77DD" style={{ flexShrink: 0 }} />
                {aiLoading && <span style={{ fontSize: 10.5, color: '#6B7280' }}>Analyzing…</span>}
                {!aiLoading && aiHint && (
                  <>
                    {aiHint.icon && (
                      <span style={{ fontSize: 10.5, color: '#94A3B8' }}>Icon: {aiHint.icon}</span>
                    )}
                    {aiHint.companyId && (() => {
                      const co = companies.find(c => c.id === aiHint.companyId)
                      return co ? (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${co.color}18`, color: co.color, fontWeight: 600 }}>
                          {co.name}
                        </span>
                      ) : null
                    })()}
                    {aiHint.ownerId && (() => {
                      const u = users.find(u => u.id === aiHint.ownerId)
                      return u ? (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#1D9E7518', color: '#1D9E75', fontWeight: 600 }}>
                          → {u.name}
                        </span>
                      ) : null
                    })()}
                    {aiHint.quadrant && aiHint.quadrant !== quadrant && (
                      <span style={{ fontSize: 10, color: '#E0944A', padding: '1px 5px', borderRadius: 3, background: '#E0944A15' }}>
                        Suggest: {QUADRANT_META[aiHint.quadrant].label}
                      </span>
                    )}
                    {aiHint.assignToMe && !aiHint.ownerId && (
                      <span style={{ fontSize: 10, color: '#7F77DD' }}>assign to me</span>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Schedule: due date + duration + planned time */}
            {quadrant === 'schedule' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <span style={lbl}>Due date</span>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inp} />
                </div>
                <div>
                  <span style={lbl}>Duration (min)</span>
                  <input type="number" min={5} step={5} value={duration}
                    onChange={e => setDuration(e.target.value)} placeholder="60" style={inp} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={lbl}>Planned time</span>
                  <input type="time" value={plannedTime} onChange={e => setPlanned(e.target.value)} style={inp} />
                </div>
              </div>
            )}

            {/* Delegate: owner picker */}
            {quadrant === 'delegate' && (
              <div>
                <span style={lbl}>Assign to</span>
                <select value={owner} onChange={e => setOwner(e.target.value)} style={{ ...inp }}>
                  <option value="">— select owner —</option>
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
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleAdd} disabled={!title.trim()} style={{
                flex: 1, padding: '5px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
                background: meta.color + '22', border: `1px solid ${meta.color}50`,
                color: meta.color, cursor: title.trim() ? 'pointer' : 'not-allowed',
                opacity: title.trim() ? 1 : 0.4,
              }}>Add</button>
              <button onClick={reset} style={{
                padding: '5px 8px', borderRadius: 6, fontSize: 11.5,
                background: 'transparent', border: '1px solid var(--color-border, #252A3E)',
                color: '#6B7280', cursor: 'pointer',
              }}><X size={11} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5, color: '#6B7280',
            fontSize: 11.5, padding: '3px 2px', borderRadius: 6, transition: 'color 0.15s ease',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = meta.color }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6B7280' }}
          >
            <Plus size={12} strokeWidth={2.5} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}
