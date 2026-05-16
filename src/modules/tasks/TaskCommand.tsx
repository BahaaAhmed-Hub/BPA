import { useState, useEffect, useRef, useMemo } from 'react'
import {
  DndContext, DragOverlay, closestCorners,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { TopBar } from '@/components/layout/TopBar'
import { EisenhowerBoard } from './EisenhowerBoard'
import { UndefinedTasksPanel } from './UndefinedTasksPanel'
import { TaskDetailModal } from './TaskDetailModal'
import { TaskCard } from './TaskCard'
import { useTaskStore } from '@/store/taskStore'
import { CheckSquare, Zap, SlidersHorizontal, Search, Filter, X } from 'lucide-react'
import type { Quadrant } from '@/types'
import { isTaskHidden, loadVisibleCompanies, getAllUsers, TASK_TYPE_META, inferTaskType } from '@/types'
import { scheduleTaskToCalendar } from '@/lib/aiScheduler'
import type { TaskType } from '@/types'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']
const TASKS_CONFIG_KEY = 'task-command-config'

type GroupBy = 'none' | 'type' | 'company'
interface TaskConfig { hideCompleted: boolean; groupBy: GroupBy; allGroupsExpanded: boolean }
interface TaskFilters { company: string; type: string; owner: string }

function loadTaskConfig(): TaskConfig {
  try { return { hideCompleted: false, groupBy: 'none', allGroupsExpanded: true, ...JSON.parse(localStorage.getItem(TASKS_CONFIG_KEY) ?? '{}') } }
  catch { return { hideCompleted: false, groupBy: 'none', allGroupsExpanded: true } }
}

export function TaskCommand() {
  const { tasks: allTasks, moveTask, moveTaskBefore, reorderInbox, reorderQuadrant, updateTask } = useTaskStore()
  const tasks = allTasks.filter(t => !isTaskHidden(t))

  const [cfg, setCfg] = useState(loadTaskConfig)
  const [configOpen, setConfigOpen] = useState(false)
  const configRef = useRef<HTMLDivElement>(null)

  // ── Search & filter state ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters]         = useState<TaskFilters>({ company: '', type: '', owner: '' })
  const [filterOpen, setFilterOpen]   = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const hideCompleted = cfg.hideCompleted ?? false
  const groupBy = cfg.groupBy ?? 'none'
  const allGroupsExpanded = cfg.allGroupsExpanded ?? true

  function saveCfg(patch: Partial<TaskConfig>) {
    const next = { ...cfg, ...patch }
    setCfg(next)
    localStorage.setItem(TASKS_CONFIG_KEY, JSON.stringify(next))
  }
  function setHideCompleted(val: boolean) { saveCfg({ hideCompleted: val }) }
  function setGroupBy(val: GroupBy) { saveCfg({ groupBy: val }) }
  function setAllGroupsExpanded(val: boolean) { saveCfg({ allGroupsExpanded: val }) }

  // Close popups on outside click
  useEffect(() => {
    if (!configOpen && !filterOpen) return
    const handler = (e: MouseEvent) => {
      if (configOpen && configRef.current && !configRef.current.contains(e.target as Node)) setConfigOpen(false)
      if (filterOpen && filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [configOpen, filterOpen])

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ── Filter options derived from tasks ────────────────────────────────────
  const companies     = loadVisibleCompanies()
  const allUsers      = getAllUsers()
  const ownerOptions  = useMemo(() => {
    const ids = new Set(tasks.map(t => t.owner).filter(Boolean) as string[])
    return allUsers.filter(u => ids.has(u.id))
  }, [tasks, allUsers])

  const typeOptions = Object.entries(TASK_TYPE_META) as [TaskType, typeof TASK_TYPE_META[TaskType]][]

  // ── Compute filtered task IDs ─────────────────────────────────────────────
  const filteredTaskIds = useMemo<Set<string> | null>(() => {
    const q = searchQuery.trim().toLowerCase()
    const hasSearch  = !!q
    const hasFilters = !!(filters.company || filters.type || filters.owner)
    if (!hasSearch && !hasFilters) return null

    return new Set(
      tasks.filter(t => {
        // Search: title, inferred type, owner name
        if (hasSearch) {
          const type     = t.taskType ?? inferTaskType(t.title)
          const typeMeta = TASK_TYPE_META[type]
          const owner    = allUsers.find(u => u.id === t.owner)
          const haystack = [
            t.title,
            typeMeta?.label ?? type,
            owner?.name ?? '',
            t.owner ?? '',
          ].join(' ').toLowerCase()
          if (!haystack.includes(q)) return false
        }
        // Filters
        if (filters.company) {
          const co = companies.find(c => c.id === filters.company)
          const matches = t.companyId === filters.company
            || (co && t.company?.toLowerCase() === co.name.toLowerCase())
          if (!matches) return false
        }
        if (filters.type) {
          if ((t.taskType ?? inferTaskType(t.title)) !== filters.type) return false
        }
        if (filters.owner) {
          if (t.owner !== filters.owner) return false
        }
        return true
      }).map(t => t.id)
    )
  }, [tasks, searchQuery, filters, allUsers, companies])

  const activeFilterCount = [filters.company, filters.type, filters.owner].filter(Boolean).length
  const isFiltering = !!searchQuery.trim() || activeFilterCount > 0
  const matchCount  = filteredTaskIds?.size ?? tasks.length

  function clearFilters() { setFilters({ company: '', type: '', owner: '' }); setSearchQuery('') }

  const active = tasks.filter(t => t.quadrant !== null && !t.completed)
  const urgent = tasks.filter(t => t.quadrant === 'do' && !t.completed)
  const inbox  = tasks.filter(t => t.quadrant === null && t.status !== 'done' && t.status !== 'cancelled' && !t.completed)

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [modalTaskId,  setModalTaskId]  = useState<string | null>(null)

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) ?? null : null
  const modalTask  = modalTaskId  ? tasks.find(t => t.id === modalTaskId)  ?? null : null

  // Auto-schedule tasks that enter the 'schedule' quadrant with a dueDate
  const schedulingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const candidates = tasks.filter(
      t => t.quadrant === 'schedule' && t.dueDate && !t.gcalEventId && !schedulingRef.current.has(t.id)
    )
    for (const task of candidates) {
      schedulingRef.current.add(task.id)
      scheduleTaskToCalendar(task)
        .then(res => { if (res.success && res.gcalEventId) updateTask(task.id, { gcalEventId: res.gcalEventId }) })
        .catch(() => {})
        .finally(() => schedulingRef.current.delete(task.id))
    }
  }, [tasks, updateTask])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart({ active }: DragStartEvent) { setActiveTaskId(active.id as string) }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTaskId(null)
    if (!over) return
    const taskId = active.id as string
    const overId = over.id as string
    if (overId === 'inbox') {
      moveTask(taskId, null)
    } else if (QUADRANTS.includes(overId as Quadrant)) {
      moveTask(taskId, overId as Quadrant)
    } else {
      const dragged = tasks.find(t => t.id === taskId)
      const target  = tasks.find(t => t.id === overId)
      if (!target) return
      if (dragged?.quadrant === null && target.quadrant === null) reorderInbox(taskId, overId)
      else if (dragged?.quadrant !== null && dragged?.quadrant === target.quadrant) reorderQuadrant(taskId, overId)
      else moveTaskBefore(taskId, overId)
      if (groupBy === 'company' && dragged) {
        if (target.companyId !== dragged.companyId || target.company !== dragged.company)
          updateTask(taskId, { companyId: target.companyId, company: target.company })
      }
    }
  }

  // ── Chip helpers ──────────────────────────────────────────────────────────
  const companyChipLabel = filters.company ? (companies.find(c => c.id === filters.company)?.name ?? filters.company) : ''
  const typeChipLabel    = filters.type ? (TASK_TYPE_META[filters.type as TaskType]?.label ?? filters.type) : ''
  const ownerChipLabel   = filters.owner ? (allUsers.find(u => u.id === filters.owner)?.name ?? filters.owner) : ''

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '3px 8px 3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
    background: 'rgba(127,119,221,0.12)', border: '1px solid rgba(127,119,221,0.3)',
    color: 'var(--color-accent,#7F77DD)', cursor: 'default',
  }
  const chipX: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-accent,#7F77DD)', padding: 0, display: 'flex', lineHeight: 1,
  }

  return (
    <div>
      <TopBar
        title="Task Command"
        subtitle="Eisenhower Matrix — ruthless prioritization for maximum leverage."
      />

      {/* ── Stats + search bar ──────────────────────────────────────────────── */}
      <div style={{ padding: '10px 28px', borderBottom: '1px solid var(--color-border,#252A3E)', display: 'flex', gap: 14, alignItems: 'center' }}>

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <CheckSquare size={13} color="var(--color-accent)" strokeWidth={2} />
            <span style={{ fontSize: 12.5, color: 'var(--color-text,#E8EAF6)' }}>
              <span style={{ fontWeight: 600 }}>{active.length}</span> active
            </span>
          </div>
          <div style={{ width: 1, height: 14, background: 'var(--color-border,#252A3E)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Zap size={13} color="#E05252" strokeWidth={2} />
            <span style={{ fontSize: 12.5, color: 'var(--color-text,#E8EAF6)' }}>
              <span style={{ fontWeight: 600 }}>{urgent.length}</span> urgent
            </span>
          </div>
          {inbox.length > 0 && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--color-border,#252A3E)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted,#6B7280)' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text,#E8EAF6)' }}>{inbox.length}</span> unassigned
              </span>
            </>
          )}
          {isFiltering && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--color-border,#252A3E)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--color-accent,#7F77DD)', fontWeight: 600 }}>
                {matchCount} match{matchCount !== 1 ? 'es' : ''}
              </span>
            </>
          )}
        </div>

        {/* Search input */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={13} color="var(--color-text-muted,#6B7280)" style={{ position: 'absolute', left: 10, pointerEvents: 'none' }} />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search tasks… (name, type, owner)  •  Press / to focus'
            style={{
              width: '100%', background: 'var(--color-bg,#0D0F1A)',
              border: `1px solid ${searchQuery ? 'var(--color-accent,#7F77DD)' : 'var(--color-border,#252A3E)'}`,
              borderRadius: 8, padding: '6px 32px 6px 30px',
              color: 'var(--color-text,#E8EAF6)', fontSize: 12.5, outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted,#6B7280)', display: 'flex', padding: 2 }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filter button */}
        <div ref={filterRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setFilterOpen(o => !o)}
            title="Filter tasks"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', height: 28, borderRadius: 7, cursor: 'pointer',
              background: activeFilterCount > 0 ? 'rgba(127,119,221,0.12)' : filterOpen ? 'rgba(127,119,221,0.08)' : 'transparent',
              border: `1px solid ${activeFilterCount > 0 || filterOpen ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border,#252A3E)'}`,
              color: activeFilterCount > 0 ? 'var(--color-accent,#7F77DD)' : 'var(--color-text-muted,#6B7280)',
              transition: 'all 0.12s', fontSize: 12, fontWeight: 500,
            }}
          >
            <Filter size={12} />
            Filter
            {activeFilterCount > 0 && (
              <span style={{ background: 'var(--color-accent,#7F77DD)', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Filter dropdown */}
          {filterOpen && (
            <div style={{
              position: 'absolute', top: 34, right: 0, zIndex: 100,
              background: 'var(--color-surface,#161929)', border: '1px solid var(--color-border,#252A3E)',
              borderRadius: 12, padding: '14px 16px', width: 260,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              {/* Company filter */}
              {companies.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ margin: '0 0 7px', fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-muted,#6B7280)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>Company</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {companies.map(co => (
                      <button key={co.id} onClick={() => setFilters(f => ({ ...f, company: f.company === co.id ? '' : co.id }))} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                        background: filters.company === co.id ? `${co.color}22` : 'transparent',
                        border: `1px solid ${filters.company === co.id ? co.color : 'var(--color-border,#252A3E)'}`,
                        color: filters.company === co.id ? co.color : 'var(--color-text-dim,#94A3B8)',
                        fontWeight: filters.company === co.id ? 600 : 400, transition: 'all 0.12s',
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: co.color, flexShrink: 0 }} />
                        {co.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Type filter */}
              <div style={{ marginBottom: 14 }}>
                <p style={{ margin: '0 0 7px', fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-muted,#6B7280)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>Task Type</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {typeOptions.map(([type, meta]) => (
                    <button key={type} onClick={() => setFilters(f => ({ ...f, type: f.type === type ? '' : type }))} style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                      background: filters.type === type ? `${meta.color}22` : 'transparent',
                      border: `1px solid ${filters.type === type ? meta.color : 'var(--color-border,#252A3E)'}`,
                      color: filters.type === type ? meta.color : 'var(--color-text-dim,#94A3B8)',
                      fontWeight: filters.type === type ? 600 : 400, transition: 'all 0.12s',
                    }}>
                      <span>{meta.emoji}</span> {meta.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Owner filter */}
              {ownerOptions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ margin: '0 0 7px', fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-muted,#6B7280)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>Owner</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {ownerOptions.map(u => (
                      <button key={u.id} onClick={() => setFilters(f => ({ ...f, owner: f.owner === u.id ? '' : u.id }))} style={{
                        padding: '4px 9px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                        background: filters.owner === u.id ? 'rgba(127,119,221,0.12)' : 'transparent',
                        border: `1px solid ${filters.owner === u.id ? 'var(--color-accent,#7F77DD)' : 'var(--color-border,#252A3E)'}`,
                        color: filters.owner === u.id ? 'var(--color-accent,#7F77DD)' : 'var(--color-text-dim,#94A3B8)',
                        fontWeight: filters.owner === u.id ? 600 : 400, transition: 'all 0.12s',
                      }}>
                        {u.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeFilterCount > 0 && (
                <button onClick={() => setFilters({ company: '', type: '', owner: '' })} style={{
                  width: '100%', padding: '6px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                  background: 'rgba(224,82,82,0.08)', border: '1px solid rgba(224,82,82,0.2)',
                  color: '#E05252', fontWeight: 500,
                }}>
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Config button */}
        <div ref={configRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setConfigOpen(o => !o)} title="Display settings" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
            background: configOpen ? 'rgba(127,119,221,0.12)' : 'transparent',
            border: `1px solid ${configOpen ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border,#252A3E)'}`,
            color: configOpen ? 'var(--color-accent)' : 'var(--color-text-muted,#6B7280)',
            transition: 'all 0.12s',
          }}>
            <SlidersHorizontal size={13} />
          </button>
          {configOpen && (
            <div style={{ position: 'absolute', top: 34, right: 0, zIndex: 100, background: 'var(--color-surface,#161929)', border: '1px solid var(--color-border,#252A3E)', borderRadius: 10, padding: '12px 14px', minWidth: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted,#6B7280)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Task Display</p>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-dim,#C0C4D6)' }}>Hide completed tasks</span>
                <div onClick={() => setHideCompleted(!hideCompleted)} style={{ width: 36, height: 20, borderRadius: 10, flexShrink: 0, background: hideCompleted ? 'var(--color-accent)' : 'var(--color-border,#252A3E)', position: 'relative', cursor: 'pointer', transition: 'background 0.15s' }}>
                  <div style={{ position: 'absolute', top: 3, left: hideCompleted ? 19 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                </div>
              </label>
              <div style={{ width: '100%', height: 1, background: 'var(--color-border,#252A3E)', marginBottom: 12 }} />
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted,#6B7280)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Group tasks by</p>
              {(['none', 'type', 'company'] as GroupBy[]).map(opt => (
                <label key={opt} onClick={() => setGroupBy(opt)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 6px', borderRadius: 6, marginBottom: 2, background: groupBy === opt ? 'rgba(127,119,221,0.1)' : 'transparent' }}>
                  <div style={{ width: 13, height: 13, borderRadius: '50%', flexShrink: 0, border: `2px solid ${groupBy === opt ? 'var(--color-accent)' : 'var(--color-text-muted,#6B7280)'}`, background: groupBy === opt ? 'var(--color-accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {groupBy === opt && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                  <span style={{ fontSize: 12.5, color: groupBy === opt ? 'var(--color-text-dim,#C0C4D6)' : 'var(--color-text-dim,#8B93A8)' }}>
                    {opt === 'none' ? 'None' : opt === 'type' ? 'Task type' : 'Company'}
                  </span>
                </label>
              ))}
              {groupBy !== 'none' && (
                <button onClick={() => setAllGroupsExpanded(!allGroupsExpanded)} style={{ marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 7, background: 'rgba(127,119,221,0.08)', border: '1px solid rgba(127,119,221,0.25)', color: '#9B94E8', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                  {allGroupsExpanded ? '⊟ Collapse all groups' : '⊞ Expand all groups'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Active filter chips ─────────────────────────────────────────────── */}
      {(companyChipLabel || typeChipLabel || ownerChipLabel) && (
        <div style={{ padding: '7px 28px', borderBottom: '1px solid var(--color-border,#252A3E)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted,#6B7280)', marginRight: 2 }}>Filtered by:</span>
          {companyChipLabel && (
            <span style={chipStyle}>
              🏢 {companyChipLabel}
              <button style={chipX} onClick={() => setFilters(f => ({ ...f, company: '' }))}><X size={11} /></button>
            </span>
          )}
          {typeChipLabel && (
            <span style={chipStyle}>
              {TASK_TYPE_META[filters.type as TaskType]?.emoji} {typeChipLabel}
              <button style={chipX} onClick={() => setFilters(f => ({ ...f, type: '' }))}><X size={11} /></button>
            </span>
          )}
          {ownerChipLabel && (
            <span style={chipStyle}>
              👤 {ownerChipLabel}
              <button style={chipX} onClick={() => setFilters(f => ({ ...f, owner: '' }))}><X size={11} /></button>
            </span>
          )}
          <button onClick={clearFilters} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted,#6B7280)', textDecoration: 'underline', padding: '0 4px', marginLeft: 2 }}>
            Clear all
          </button>
        </div>
      )}

      {/* Board + inbox */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', gap: 14, padding: '18px 28px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EisenhowerBoard onOpen={setModalTaskId} hideCompleted={hideCompleted} groupBy={groupBy} allGroupsExpanded={allGroupsExpanded} filteredTaskIds={filteredTaskIds} />
          </div>
          <UndefinedTasksPanel onOpen={setModalTaskId} hideCompleted={hideCompleted} groupBy={groupBy} allGroupsExpanded={allGroupsExpanded} filteredTaskIds={filteredTaskIds} />
        </div>

        <DragOverlay>
          {activeTask && (
            <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
              <TaskCard task={activeTask} onOpen={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {modalTask && <TaskDetailModal task={modalTask} onClose={() => setModalTaskId(null)} />}
    </div>
  )
}
