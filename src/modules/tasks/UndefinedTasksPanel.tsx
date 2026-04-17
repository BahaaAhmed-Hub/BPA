import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, X, Inbox, Check, Calendar, User, GripVertical, Sparkles, ListPlus, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTaskStore } from '@/store/taskStore'
import { getAllUsers, loadDynamicCompanies, COMPANY_COLORS, TASK_TYPE_META, inferTaskType, type TaskStatus, type TaskType, type CompanyTag, type Task } from '@/types'
import { analyzeTask } from '@/lib/professor'
import type { TaskAnalysis } from '@/lib/professor'

type Filter = 'all' | 'open' | 'done' | 'cancelled'

const inp: React.CSSProperties = {
  background: 'var(--color-bg, #0D0F1A)',
  border: '1px solid var(--color-border, #252A3E)',
  borderRadius: 6, padding: '5px 8px', fontSize: 12,
  color: 'var(--color-text, #E8EAF6)', outline: 'none', width: '100%',
}
const sel: React.CSSProperties = { ...inp }

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: '#7F77DD', done: '#1D9E75', cancelled: '#6B7280',
}

// ─── Draggable card for inbox tasks ──────────────────────────────────────────

interface InboxCardProps {
  task: Task
  accentColor: string
  taskStatus: TaskStatus
  ownerUser?: { name: string }
  onOpen: (id: string) => void
  onToggle: () => void
  onDelete: () => void
  onCompanyChange: (companyId: string) => void
  onToggleUrgent: () => void
  companies: ReturnType<typeof loadDynamicCompanies>
}

function DraggableInboxCard({ task, accentColor, taskStatus, ownerUser, onOpen, onToggle, onDelete, onCompanyChange, onToggleUrgent, companies }: InboxCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const [hovered, setHovered] = useState(false)

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, position: 'relative' }}
      onClick={() => onOpen(task.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        padding: '9px 11px',
        background: isDragging ? 'var(--color-surface2, #252A3E)' : 'var(--color-bg, #0D0F1A)',
        border: `1px solid ${task.urgent ? '#E0711A40' : hovered ? '#353A50' : 'var(--color-border, #252A3E)'}`,
        borderRadius: 8,
        opacity: taskStatus === 'cancelled' ? 0.5 : taskStatus === 'done' ? 0.6 : 1,
        cursor: isDragging ? 'grabbing' : 'pointer',
        transition: 'border-color 0.15s ease, background 0.15s ease',
      }}>
        {/* Left accent */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: accentColor, borderRadius: '8px 0 0 8px', opacity: 0.7,
        }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, paddingLeft: 4 }}>
          {/* Drag handle */}
          <div
            {...listeners} {...attributes}
            onClick={e => e.stopPropagation()}
            style={{ cursor: 'grab', color: hovered ? '#6B7280' : 'transparent', transition: 'color 0.15s', marginTop: 1, flexShrink: 0 }}
          >
            <GripVertical size={12} strokeWidth={2} />
          </div>

          {/* Checkbox */}
          <button
            onClick={e => { e.stopPropagation(); onToggle() }}
            style={{
              width: 15, height: 15, borderRadius: 4,
              border: `1.5px solid ${task.completed ? '#1D9E75' : 'var(--color-border, #252A3E)'}`,
              background: task.completed ? '#1D9E75' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, marginTop: 1, transition: 'all 0.15s ease',
            }}
          >
            {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
          </button>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: 12.5, fontWeight: 500, color: 'var(--color-text, #E8EAF6)', lineHeight: 1.35,
              textDecoration: taskStatus === 'done' ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{task.title}</p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
              {/* Inline company picker */}
              <select
                value={task.companyId ?? task.company}
                onClick={e => e.stopPropagation()}
                onChange={e => { e.stopPropagation(); onCompanyChange(e.target.value) }}
                title="Change company"
                style={{
                  fontSize: 10, fontWeight: 600,
                  color: accentColor, background: `${accentColor}18`,
                  padding: '1px 5px', borderRadius: 3,
                  border: 'none', outline: 'none', cursor: 'pointer',
                  appearance: 'none', WebkitAppearance: 'none', fontFamily: 'inherit',
                }}
              >
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              {task.dueDate && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6B7280' }}>
                  <Calendar size={9} />
                  {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}

              {ownerUser && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#1D9E75' }}>
                  <User size={9} /> {ownerUser.name}
                </span>
              )}

              <span style={{
                marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
                background: STATUS_COLORS[taskStatus], flexShrink: 0,
              }} />
            </div>
          </div>

          {/* Urgent + Delete */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onToggleUrgent() }}
              title={task.urgent ? 'Unmark urgent' : 'Mark urgent'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 4,
                color: task.urgent ? '#E0711A' : hovered ? '#4B5268' : 'transparent',
                display: 'flex', alignItems: 'center', transition: 'color 0.15s',
              }}
            >
              <Zap size={11} strokeWidth={2} fill={task.urgent ? '#E0711A' : 'none'} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#6B7280', padding: 2, borderRadius: 4,
                display: 'flex', alignItems: 'center',
                opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
              }}
            >
              <Trash2 size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface Props {
  onOpen: (id: string) => void
  hideCompleted?: boolean
  groupBy?: 'none' | 'type' | 'company'
  allGroupsExpanded?: boolean
}

export function UndefinedTasksPanel({ onOpen, hideCompleted = false, groupBy = 'none', allGroupsExpanded = true }: Props) {
  const { tasks, addTask, addTasksBatch, deleteTask, toggleComplete, updateTask, toggleUrgent } = useTaskStore()
  const [filter, setFilter] = useState<Filter>('open')
  const [adding, setAdding] = useState(false)

  // Group expand state
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setExpandedGroups(prev => Object.fromEntries(Object.keys(prev).map(k => [k, allGroupsExpanded])))
  }, [allGroupsExpanded])
  function isGroupExpanded(key: string) { return expandedGroups[key] ?? true }
  function toggleGroupExpanded(key: string) { setExpandedGroups(prev => ({ ...prev, [key]: !isGroupExpanded(key) })) }

  // Bulk add state
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkDone, setBulkDone] = useState(false)
  const bulkRef = useRef<HTMLTextAreaElement>(null)
  const bulkLines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)

  function handleBulkAdd() {
    if (!bulkLines.length) return
    addTasksBatch(bulkLines.map(t => ({ title: t, quadrant: null, company: 'personal' as const, status: 'open' as const, completed: false })))
    setBulkText('')
    setBulkDone(true)
    setTimeout(() => { setBulkDone(false); setBulkOpen(false) }, 1400)
  }

  // Form state
  const [title, setTitle]         = useState('')
  const [companyId, setCompanyId] = useState('')
  const [dueDate, setDueDate]     = useState('')
  const [owner, setOwner]         = useState('')
  const [duration, setDuration]   = useState('')
  const [status, setFormStatus]   = useState<TaskStatus>('open')
  const [aiHint, setAiHint]       = useState<TaskAnalysis | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const aiTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce AI analysis 900ms after typing
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

  const companies = loadDynamicCompanies()
  const users     = getAllUsers()

  const inbox = tasks.filter(t => t.quadrant === null)
  const visibleInbox = hideCompleted
    ? inbox.filter(t => !t.completed && t.status !== 'done')
    : inbox
  const filtered = filter === 'all'
    ? visibleInbox
    : filter === 'done'
      ? visibleInbox.filter(t => t.completed || t.status === 'done')
      : filter === 'open'
        ? visibleInbox.filter(t => !t.completed && (t.status === 'open' || !t.status))
        : visibleInbox.filter(t => t.status === filter)

  const counts: Record<Filter, number> = {
    all:       inbox.length,
    open:      inbox.filter(t => !t.completed && (t.status === 'open' || !t.status)).length,
    done:      inbox.filter(t => t.completed || t.status === 'done').length,
    cancelled: inbox.filter(t => t.status === 'cancelled').length,
  }

  function reset() {
    setTitle(''); setCompanyId(''); setDueDate(''); setOwner('')
    setDuration(''); setFormStatus('open'); setAiHint(null); setAdding(false)
  }

  function handleAdd() {
    if (!title.trim()) { reset(); return }
    const finalTitle     = (aiHint?.titleWithIcon ?? title).trim()
    const finalCompanyId = companyId || aiHint?.companyId || ''
    const finalOwner     = owner || aiHint?.ownerId || ''
    addTask({
      title: finalTitle,
      quadrant: null,
      company: 'teradix',
      status,
      completed: status === 'done',
      ...(finalCompanyId && { companyId: finalCompanyId }),
      ...(dueDate        && { dueDate }),
      ...(finalOwner     && { owner: finalOwner }),
      ...(duration       && { duration: parseInt(duration, 10) }),
    })
    reset()
  }

  const FILTERS: Filter[] = ['all', 'open', 'done', 'cancelled']

  // ─── Group helpers ────────────────────────────────────────────────────────
  function buildInboxGroups(tasks: Task[], gBy: 'type' | 'company') {
    if (gBy === 'type') {
      const map = new Map<TaskType, Task[]>()
      for (const t of tasks) {
        const k = t.taskType ?? inferTaskType(t.title)
        if (!map.has(k)) map.set(k, [])
        map.get(k)!.push(t)
      }
      return (Object.keys(TASK_TYPE_META) as TaskType[])
        .filter(k => map.has(k))
        .map(k => ({ key: k, label: TASK_TYPE_META[k].label, emoji: TASK_TYPE_META[k].emoji, color: TASK_TYPE_META[k].color, tasks: map.get(k)! }))
    } else {
      const map = new Map<string, Task[]>()
      for (const t of tasks) {
        const k = t.companyId ?? t.company
        if (!map.has(k)) map.set(k, [])
        map.get(k)!.push(t)
      }
      return [...map.entries()].map(([k, ts]) => {
        const dynCo = companies.find(c => c.id === k)
        const label = dynCo?.name ?? k
        const color = dynCo?.color ?? '#6B7280'
        return { key: k, label, emoji: '🏢', color, tasks: ts }
      })
    }
  }

  function renderCard(t: Task) {
    const co = companies.find(c => c.id === t.companyId)
    const ownerUser = t.owner ? users.find(u => u.id === t.owner) : undefined
    const taskStatus: TaskStatus = t.completed ? 'done' : (t.status ?? 'open')
    const accentColor = co?.color ?? COMPANY_COLORS[t.company] ?? '#6B7280'
    return (
      <DraggableInboxCard
        key={t.id} task={t} accentColor={accentColor} taskStatus={taskStatus}
        ownerUser={ownerUser} companies={companies} onOpen={onOpen}
        onToggle={() => toggleComplete(t.id)}
        onDelete={() => deleteTask(t.id)}
        onToggleUrgent={() => toggleUrgent(t.id)}
        onCompanyChange={cId => {
          const co2 = companies.find(c => c.id === cId)
          updateTask(t.id, { companyId: cId, company: (co2?.id as CompanyTag) ?? t.company })
        }}
      />
    )
  }

  // Drop zone — board cards can be dragged here to send back to inbox
  const { isOver: inboxOver, setNodeRef: setInboxRef } = useDroppable({ id: 'inbox' })

  return (
    <div style={{
      width: 300, flexShrink: 0,
      background: 'var(--color-surface, #161929)',
      border: '1px solid var(--color-border, #252A3E)',
      borderRadius: 12, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', maxHeight: 'calc(100vh - 160px)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-border, #252A3E)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Inbox size={14} color="#6B7280" />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text, #E8EAF6)' }}>Inbox</span>
          <span style={{
            fontSize: 10.5, fontWeight: 600,
            color: '#6B7280', background: '#6B728018', padding: '1px 6px', borderRadius: 4,
          }}>{inbox.length}</span>
          <button
            onClick={() => { setBulkOpen(o => !o); setBulkText(''); setBulkDone(false); setTimeout(() => bulkRef.current?.focus(), 50) }}
            title="Bulk add tasks"
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 500,
              background: bulkOpen ? 'rgba(29,158,117,0.12)' : 'transparent',
              border: `1px solid ${bulkOpen ? 'rgba(29,158,117,0.3)' : 'var(--color-border, #252A3E)'}`,
              color: bulkOpen ? '#1D9E75' : '#6B7280', cursor: 'pointer',
            }}
          >
            <ListPlus size={11} /> Bulk add
          </button>
        </div>

        {/* Bulk add panel */}
        {bulkOpen && (
          <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              ref={bulkRef}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleBulkAdd() }}
              placeholder={'One task per line…\nBuy milk\nSend report\nCall client'}
              rows={4}
              style={{
                ...inp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10.5, color: '#6B7280', flex: 1 }}>
                {bulkLines.length > 0 ? `${bulkLines.length} task${bulkLines.length > 1 ? 's' : ''} ready` : 'Paste or type tasks above'}
              </span>
              <button onClick={() => { setBulkOpen(false); setBulkText('') }} style={{
                padding: '4px 8px', borderRadius: 5, fontSize: 11, background: 'transparent',
                border: '1px solid var(--color-border, #252A3E)', color: '#6B7280', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleBulkAdd} disabled={bulkLines.length === 0 || bulkDone} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5,
                fontSize: 11, fontWeight: 500,
                background: bulkDone ? 'rgba(29,158,117,0.15)' : 'rgba(29,158,117,0.12)',
                border: `1px solid ${bulkDone ? 'rgba(29,158,117,0.5)' : 'rgba(29,158,117,0.3)'}`,
                color: '#1D9E75', cursor: bulkLines.length === 0 ? 'default' : 'pointer',
                opacity: bulkLines.length === 0 ? 0.4 : 1,
              }}>
                {bulkDone ? 'Added!' : <><Plus size={11} /> Add {bulkLines.length > 0 ? `${bulkLines.length} ` : ''}task{bulkLines.length !== 1 ? 's' : ''}</>}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
              cursor: 'pointer', textTransform: 'capitalize',
              background: filter === f ? '#1E40AF18' : 'transparent',
              border: `1px solid ${filter === f ? '#1E40AF50' : 'var(--color-border, #252A3E)'}`,
              color: filter === f ? '#7F77DD' : '#6B7280',
            }}>
              {f} {counts[f] > 0 && <span style={{ opacity: 0.7 }}>({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Task list — also a drop zone for board cards */}
      <div
        ref={setInboxRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px',
          display: 'flex', flexDirection: 'column', gap: 5,
          background: inboxOver ? '#7F77DD08' : 'transparent',
          transition: 'background 0.15s ease',
        }}
      >
        {filtered.length === 0 && !adding && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 80, color: inboxOver ? '#7F77DD' : '#6B7280',
            fontSize: 12, fontStyle: 'italic',
            border: `1px dashed ${inboxOver ? '#7F77DD60' : 'var(--color-border, #252A3E)'}`,
            borderRadius: 8, transition: 'all 0.15s ease',
          }}>
            {inboxOver ? 'Drop here to move to inbox' : 'No tasks'}
          </div>
        )}

        {groupBy === 'none' ? (
          <SortableContext items={filtered.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {filtered.map(t => renderCard(t))}
          </SortableContext>
        ) : (() => {
          const groups = buildInboxGroups(filtered, groupBy)
          const orderedIds = groups.flatMap(g => g.tasks.map(t => t.id))
          return (
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              {groups.map(g => (
                <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
                  <button onClick={() => toggleGroupExpanded(g.key)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 6px', borderRadius: 6, cursor: 'pointer',
                    background: `${g.color}10`, border: `1px solid ${g.color}30`,
                    marginBottom: isGroupExpanded(g.key) ? 4 : 0,
                  }}>
                    <span style={{ fontSize: 11 }}>{g.emoji}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: g.color, flex: 1, textAlign: 'left' }}>{g.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: g.color, background: `${g.color}20`, padding: '0 5px', borderRadius: 3 }}>{g.tasks.length}</span>
                    {isGroupExpanded(g.key)
                      ? <ChevronDown size={11} color={g.color} strokeWidth={2.5} />
                      : <ChevronRight size={11} color={g.color} strokeWidth={2.5} />}
                  </button>
                  {isGroupExpanded(g.key) && g.tasks.map(t => renderCard(t))}
                </div>
              ))}
            </SortableContext>
          )
        })()}
      </div>

      {/* Add form */}
      <div style={{ borderTop: '1px solid var(--color-border, #252A3E)', padding: '8px' }}>
        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') reset() }}
              placeholder="Task title…" style={inp} />

            {/* AI suggestion strip */}
            {(aiLoading || aiHint) && (
              <div style={{
                background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)', borderRadius: 6,
                padding: '5px 8px', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center',
              }}>
                <Sparkles size={10} color="#7F77DD" style={{ flexShrink: 0 }} />
                {aiLoading && <span style={{ fontSize: 10.5, color: '#6B7280' }}>Analyzing…</span>}
                {!aiLoading && aiHint && (
                  <>
                    {aiHint.icon && <span style={{ fontSize: 10.5, color: '#94A3B8' }}>Icon: {aiHint.icon}</span>}
                    {aiHint.companyId && (() => {
                      const co = companies.find(c => c.id === aiHint.companyId)
                      return co ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${co.color}18`, color: co.color, fontWeight: 600 }}>{co.name}</span> : null
                    })()}
                    {aiHint.ownerId && (() => {
                      const u = users.find(u => u.id === aiHint.ownerId)
                      return u ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#1D9E7518', color: '#1D9E75', fontWeight: 600 }}>→ {u.name}</span> : null
                    })()}
                    {aiHint.quadrant && (
                      <span style={{ fontSize: 10, color: '#E0944A', padding: '1px 5px', borderRadius: 3, background: '#E0944A15' }}>
                        Suggest quadrant: {aiHint.quadrant}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

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
                      border: `1px solid ${status === s ? STATUS_COLORS[s] + '80' : 'var(--color-border, #252A3E)'}`,
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
            <Plus size={12} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}
