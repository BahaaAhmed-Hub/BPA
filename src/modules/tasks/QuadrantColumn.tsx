import { useState, useEffect, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, X, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { TaskCard } from './TaskCard'
import type { Task, Quadrant } from '@/types'
import { QUADRANT_META, getAllUsers, loadDynamicCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { analyzeTask } from '@/lib/professor'
import { buildTaskGroups, type TaskGroupBy } from './taskVisuals'
import type { TaskAnalysis } from '@/lib/professor'

// ─── Task type grouping helpers ───────────────────────────────────────────────

function GroupHeader({ label, emoji, color, count, expanded, onToggle }: {
  label: string; emoji: string; color: string; count: number; expanded: boolean; onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 6px', borderRadius: 6, cursor: 'pointer',
        background: `${color}10`, border: `1px solid ${color}30`,
        marginBottom: expanded ? 4 : 0,
      }}
    >
      <span style={{ fontSize: 11 }}>{emoji}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color, flex: 1, textAlign: 'left' }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 600, color, background: `${color}20`,
        padding: '0px 5px', borderRadius: 3,
      }}>{count}</span>
      {expanded
        ? <ChevronDown size={11} color={color} strokeWidth={2.5} />
        : <ChevronRight size={11} color={color} strokeWidth={2.5} />}
    </button>
  )
}

const inp: React.CSSProperties = {
  background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 6,
  padding: '5px 8px', fontSize: 12, color: '#191712', outline: 'none', width: '100%',
}
const lbl: React.CSSProperties = { fontSize: 10.5, color: '#9B9180', marginBottom: 3, display: 'block' }

interface QuadrantColumnProps {
  quadrant: Quadrant
  tasks: Task[]
  onOpen: (id: string) => void
  groupBy?: TaskGroupBy
  allGroupsExpanded?: boolean
}

export function QuadrantColumn({ quadrant, tasks, onOpen, groupBy = 'none', allGroupsExpanded = true }: QuadrantColumnProps) {
  const meta = QUADRANT_META[quadrant]
  const { isOver, setNodeRef } = useDroppable({ id: quadrant })
  const addTask = useTaskStore(s => s.addTask)

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [globalExpanded, setGlobalExpanded] = useState(true)
  const [adding, setAdding]         = useState(false)
  const [title, setTitle]           = useState('')
  const [companyId, setCompanyId]   = useState('')
  const [dueDate, setDueDate]       = useState('')
  const [duration, setDuration]     = useState('')
  const [plannedTime, setPlanned]   = useState('')
  const [owner, setOwner]           = useState('')
  const [aiHint, setAiHint]         = useState<TaskAnalysis | null>(null)
  const [aiLoading, setAiLoading]   = useState(false)
  const aiTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const users = getAllUsers()
  const companies = loadDynamicCompanies()

  // Sync expand/collapse all: update the global default and clear individual overrides
  useEffect(() => {
    setGlobalExpanded(allGroupsExpanded)
    setExpandedGroups({})
  }, [allGroupsExpanded])

  function isExpanded(key: string) { return expandedGroups[key] ?? globalExpanded }
  function toggleGroup(key: string) { setExpandedGroups(prev => ({ ...prev, [key]: !isExpanded(key) })) }

  // Debounce AI analysis 900ms after typing stops
  useEffect(() => {
    if (!adding || title.trim().length < 4) { setAiHint(null); return }
    if (aiTimer.current) clearTimeout(aiTimer.current)
    aiTimer.current = setTimeout(async () => {
      setAiLoading(true)
      const result = await analyzeTask(title, companies)
      setAiHint(result)
      if (result.companyId) setCompanyId(result.companyId)
      setAiLoading(false)
    }, 900)
    return () => { if (aiTimer.current) clearTimeout(aiTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, adding])

  function reset() {
    setTitle(''); setCompanyId(''); setDueDate(''); setDuration(''); setPlanned(''); setOwner('')
    setAiHint(null); setAdding(false)
  }

  function handleAdd() {
    if (!title.trim()) { reset(); return }
    const finalTitle = (aiHint?.titleWithIcon ?? title).trim()
    const finalOwner = owner || aiHint?.ownerId || ''
    const finalCompanyId = companyId || aiHint?.companyId || undefined
    const co = companies.find(c => c.id === finalCompanyId)
    // Use first dynamic company as static fallback instead of hardcoded 'teradix'
    const fallbackCompany = (companies[0]?.id ?? 'teradix') as Task['company']
    addTask({
      title: finalTitle,
      quadrant,
      company: (co?.id ?? fallbackCompany) as Task['company'],
      status: 'open',
      completed: false,
      ...(dueDate        && { dueDate }),
      ...(duration       && { duration: parseInt(duration, 10) }),
      ...(plannedTime    && { plannedTime }),
      ...(finalOwner     && { owner: finalOwner }),
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
        background: '#FFFFFF',
        border: `1px solid ${isOver ? meta.color + '60' : '#E8E1CE'}`,
        borderRadius: 14, overflow: 'hidden',
        transition: 'border-color 0.15s ease', minHeight: 280,
        boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '13px 14px 10px',
        borderBottom: '1px solid #EDE7D9',
        background: isOver ? `${meta.color}08` : '#FDFBF6',
        transition: 'background 0.15s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#191712', letterSpacing: '-0.2px', fontFamily: 'var(--sb-font-ui)' }}>
            {meta.label}
          </h3>
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, fontWeight: 600,
            color: meta.color, background: `${meta.color}18`,
            padding: '1px 6px', borderRadius: 4,
          }}>{activeTasks.length}</span>
        </div>
        <p style={{ margin: '2px 0 0 16px', fontSize: 10.5, color: '#9B9180' }}>{meta.sub}</p>
      </div>

      {/* Drop zone */}
      <div ref={setNodeRef} style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: 5, minHeight: 100 }}>
        {groupBy === 'none' ? (
          <SortableContext items={activeTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {activeTasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
          </SortableContext>
        ) : (() => {
          const groups = buildTaskGroups(activeTasks, groupBy)
          const orderedIds = groups.flatMap(g => g.tasks.map(t => t.id))
          return (
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              {groups.map(g => (
                <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
                  <GroupHeader
                    label={g.label} emoji={g.emoji} color={g.color}
                    count={g.tasks.length} expanded={isExpanded(g.key)}
                    onToggle={() => toggleGroup(g.key)}
                  />
                  {isExpanded(g.key) && g.tasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
                </div>
              ))}
            </SortableContext>
          )
        })()}

        {/* Completed tasks */}
        {doneTasks.length > 0 && (
          <div style={{ marginTop: 4, opacity: 0.5 }}>
            {doneTasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
          </div>
        )}

        {activeTasks.length === 0 && doneTasks.length === 0 && !adding && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#9B9180', fontSize: 11.5, fontStyle: 'italic',
            opacity: isOver ? 0 : 0.6,
            border: `1px dashed ${isOver ? meta.color : '#E8E1CE'}`,
            borderRadius: 8, minHeight: 60, transition: 'all 0.15s ease',
          }}>{isOver ? '' : 'Drop tasks here'}</div>
        )}
      </div>

      {/* Add task area */}
      <div style={{ padding: '8px', borderTop: '1px solid #E8E1CE' }}>
        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {/* Title */}
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') reset() }}
              placeholder="Task title…" style={inp} />

            {/* Company selector — auto-filled by AI, user can override */}
            {companies.length > 0 && (
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={inp}>
                <option value="">— company —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            {/* AI suggestion strip */}
            {(aiLoading || aiHint) && (
              <div style={{
                background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 6,
                padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center',
              }}>
                <Sparkles size={10} color="#7F77DD" style={{ flexShrink: 0 }} />
                {aiLoading && <span style={{ fontSize: 10.5, color: '#9B9180' }}>Analyzing…</span>}
                {!aiLoading && aiHint && (
                  <>
                    {aiHint.icon && (
                      <span style={{ fontSize: 10.5, color: '#6C6553' }}>Icon: {aiHint.icon}</span>
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
                  <p style={{ margin: '4px 0 0', fontSize: 10.5, color: '#9B9180' }}>
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
                background: 'transparent', border: '1px solid #E8E1CE',
                color: '#9B9180', cursor: 'pointer',
              }}><X size={11} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5, color: '#9B9180',
            fontSize: 11.5, padding: '3px 2px', borderRadius: 6, transition: 'color 0.15s ease',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = meta.color }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#9B9180' }}
          >
            <Plus size={12} strokeWidth={2.5} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}
