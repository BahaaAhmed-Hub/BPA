import { useState, useEffect, useRef, useMemo } from 'react'
import {
  DndContext, DragOverlay, closestCorners,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { EisenhowerBoard } from './EisenhowerBoard'
import { UndefinedTasksPanel } from './UndefinedTasksPanel'
import { KanbanBoard } from './KanbanBoard'
import { TaskDetailModal } from './TaskDetailModal'
import { TaskCard } from './TaskCard'
import { useTaskStore } from '@/store/taskStore'
import { Search, X, CalendarDays } from 'lucide-react'
import type { Quadrant } from '@/types'
import { isTaskHidden, loadVisibleCompanies, getAllUsers, TASK_TYPE_META, inferTaskType } from '@/types'
import { scheduleTaskToCalendar } from '@/lib/aiScheduler'
import type { TaskType } from '@/types'
import { SmartDayPlanner } from './SmartDayPlanner'

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

  const [viewMode, setViewMode] = useState<'eisenhower' | 'board'>(() =>
    (localStorage.getItem('task-view-mode') as 'eisenhower' | 'board') ?? 'eisenhower'
  )
  function switchView(mode: 'eisenhower' | 'board') {
    setViewMode(mode)
    localStorage.setItem('task-view-mode', mode)
  }

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
  const [showPlanner,  setShowPlanner]  = useState(false)

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
    background: 'rgba(25,23,18,0.06)', border: '1px solid rgba(127,119,221,0.3)',
    color: 'var(--color-accent,#7F77DD)', cursor: 'default',
  }
  const chipX: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-accent,#7F77DD)', padding: 0, display: 'flex', lineHeight: 1,
  }

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '22px 26px 0', display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553' }}>TASK COMMAND</span>
          <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
            {active.length} open {active.length === 1 ? 'task' : 'tasks'}
          </span>
          <span style={{ fontSize: 12, color: '#6C6553', paddingTop: 3 }}>
            {urgent.length} urgent
            {inbox.length > 0 ? ` · ${inbox.length} unassigned` : ''}
            {isFiltering ? ` · ${matchCount} match${matchCount !== 1 ? 'es' : ''}` : ''}
          </span>
        </div>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          {/* Day Planner button */}
          <button onClick={() => setShowPlanner(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, boxSizing: 'border-box', padding: '0 13px', borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            <CalendarDays size={14} /> Day Planner
          </button>

          {/* Filter button */}
          <div ref={filterRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setFilterOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, boxSizing: 'border-box', padding: '0 13px', borderRadius: 999, background: '#FFFFFF', border: `1px solid ${activeFilterCount > 0 ? '#191712' : '#E8E1CE'}`, color: '#191712', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
              Filters
              {activeFilterCount > 0 && (
                <span style={{ height: 16, minWidth: 16, boxSizing: 'border-box', padding: '0 4px', borderRadius: 999, background: '#191712', color: '#FDF8E7', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Filter dropdown — updated styling */}
            {filterOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 100,
                background: '#FFFFFF', border: '1px solid #E8E1CE',
                borderRadius: 16, padding: '8px 16px 14px', width: 308,
                boxShadow: '0 28px 60px -24px rgba(25,23,18,.4)',
              }}>
                {/* Config section */}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#6C6553', padding: '12px 0 7px' }}>TASK DISPLAY</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 0 10px' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: '#191712' }}>Hide completed tasks</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <div onClick={() => setHideCompleted(!hideCompleted)} style={{ width: 38, height: 22, boxSizing: 'border-box', borderRadius: 999, background: hideCompleted ? '#191712' : '#E8E1CE', display: 'flex', alignItems: 'center', padding: 2, justifyContent: hideCompleted ? 'flex-end' : 'flex-start', cursor: 'pointer', transition: 'all .15s' }}>
                      <div style={{ width: 18, height: 18, borderRadius: 999, background: '#FFFFFF' }} />
                    </div>
                  </span>
                </div>
                <div style={{ borderTop: '1px solid #F0EBDC' }} />

                {/* Group by */}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#6C6553', padding: '12px 0 7px' }}>GROUP TASKS BY</span>
                {(['none', 'type', 'company'] as GroupBy[]).map(opt => (
                  <div key={opt} onClick={() => setGroupBy(opt)} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 9px', borderRadius: 9, background: groupBy === opt ? '#FEF7DE' : 'transparent', cursor: 'pointer' }}>
                    <span style={{ width: 16, height: 16, boxSizing: 'border-box', borderRadius: 999, border: `2px solid ${groupBy === opt ? '#191712' : '#C9C0A8'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {groupBy === opt && <span style={{ width: 7, height: 7, borderRadius: 999, background: '#191712' }} />}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: groupBy === opt ? 600 : 500, color: groupBy === opt ? '#191712' : '#4A4438' }}>
                      {opt === 'none' ? 'None' : opt === 'type' ? 'Task type' : 'Company'}
                    </span>
                  </div>
                ))}
                {groupBy !== 'none' && (
                  <button onClick={() => setAllGroupsExpanded(!allGroupsExpanded)} style={{ marginTop: 8, height: 36, width: '100%', borderRadius: 10, border: '1px solid #E8E1CE', background: '#FAF7EC', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: '#191712', cursor: 'pointer' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
                    {allGroupsExpanded ? 'Collapse all groups' : 'Expand all groups'}
                  </button>
                )}
                <div style={{ borderTop: '1px solid #F0EBDC', marginTop: 12 }} />

                {/* Company filter */}
                {companies.length > 0 && (
                  <>
                    <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#6C6553', padding: '12px 0 7px' }}>COMPANY</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {companies.map(co => (
                        <button key={co.id} onClick={() => setFilters(f => ({ ...f, company: f.company === co.id ? '' : co.id }))} style={{
                          display: 'flex', alignItems: 'center', gap: 6, height: 28, boxSizing: 'border-box', padding: '0 11px', borderRadius: 999,
                          background: filters.company === co.id ? '#FEF7DE' : '#FFFFFF',
                          border: `1px solid ${filters.company === co.id ? '#F5D14E' : '#E8E1CE'}`,
                          color: '#191712', fontSize: 11.5, fontWeight: filters.company === co.id ? 600 : 500, cursor: 'pointer',
                        }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: co.color, flexShrink: 0 }} />
                          {co.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Type filter */}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#6C6553', padding: '12px 0 7px' }}>TASK TYPE</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {typeOptions.map(([type, meta]) => (
                    <button key={type} onClick={() => setFilters(f => ({ ...f, type: f.type === type ? '' : type }))} style={{
                      display: 'flex', alignItems: 'center', gap: 6, height: 28, boxSizing: 'border-box', padding: '0 11px', borderRadius: 999,
                      background: filters.type === type ? '#FEF7DE' : '#FFFFFF',
                      border: `1px solid ${filters.type === type ? '#F5D14E' : '#E8E1CE'}`,
                      color: '#191712', fontSize: 11.5, fontWeight: filters.type === type ? 600 : 500, cursor: 'pointer',
                    }}>
                      <span>{meta.emoji}</span> {meta.label}
                    </button>
                  ))}
                </div>

                {/* Owner filter */}
                {ownerOptions.length > 0 && (
                  <>
                    <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#6C6553', padding: '12px 0 7px' }}>OWNER</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {ownerOptions.map(u => (
                        <button key={u.id} onClick={() => setFilters(f => ({ ...f, owner: f.owner === u.id ? '' : u.id }))} style={{
                          display: 'flex', alignItems: 'center', gap: 6, height: 28, boxSizing: 'border-box', padding: '0 11px', borderRadius: 999,
                          background: filters.owner === u.id ? '#FEF7DE' : '#FFFFFF',
                          border: `1px solid ${filters.owner === u.id ? '#F5D14E' : '#E8E1CE'}`,
                          color: '#191712', fontSize: 11.5, fontWeight: filters.owner === u.id ? 600 : 500, cursor: 'pointer',
                        }}>
                          {u.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {activeFilterCount > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 11, borderTop: '1px solid #F0EBDC', display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontSize: 11, color: '#6C6553' }}>{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active</span>
                    <button onClick={() => setFilters({ company: '', type: '', owner: '' })} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: '#191712', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#6C6553' }}>
            Drag a card onto the calendar to schedule it
          </span>

          <span style={{ width: 1, height: 22, background: '#E8E1CE', margin: '0 4px' }} />

          {/* View toggle — Board / Matrix / List */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 38, boxSizing: 'border-box', padding: 4, borderRadius: 999, background: '#EDE7D9', flexShrink: 0 }}>
            {[
              { id: 'board' as const, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>, label: 'Board' },
              { id: 'eisenhower' as const, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>, label: 'Matrix' },
            ].map(v => (
              <button key={v.id} onClick={() => switchView(v.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, boxSizing: 'border-box', padding: '0 16px', borderRadius: 999, background: viewMode === v.id ? '#FFFFFF' : 'transparent', boxShadow: viewMode === v.id ? '0 1px 3px rgba(25,23,18,.12)' : 'none', color: viewMode === v.id ? '#191712' : '#8A8271', fontSize: 13, fontWeight: viewMode === v.id ? 700 : 500, border: 'none', cursor: 'pointer', transition: 'all .14s', flexShrink: 0 }}>
                {v.icon} {v.label}
              </button>
            ))}
          </span>

          <span style={{ width: 1, height: 24, background: '#E8E1CE', margin: '0 2px' }} />

          {/* New task CTA */}
          <button
            onClick={() => {
              // Open add task — find modal or create mechanism
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, boxSizing: 'border-box', padding: '0 14px', borderRadius: 999, background: '#F5D14E', color: '#191712', fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 2px 0 rgba(25,23,18,.14)', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New task
          </button>
        </span>
      </div>

      {/* ── Secondary toolbar: search ────────────────────────────────────────── */}
      <div style={{ padding: '12px 26px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
        {/* Search input */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={13} color="var(--sb-ink-3)" style={{ position: 'absolute', left: 10, pointerEvents: 'none' }} />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search tasks… (name, type, owner)  •  Press / to focus'
            style={{
              width: '100%', background: 'var(--sb-page)',
              border: `1px solid ${searchQuery ? 'var(--color-accent,#7F77DD)' : 'var(--color-border,var(--sb-border))'}`,
              borderRadius: 8, padding: '6px 32px 6px 30px',
              color: 'var(--sb-ink-1)', fontSize: 12.5, outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex', padding: 2 }}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Active filter chips ─────────────────────────────────────────────── */}
      {(companyChipLabel || typeChipLabel || ownerChipLabel) && (
        <div style={{ padding: '4px 26px 10px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--sb-ink-3)', marginRight: 2 }}>Filtered by:</span>
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
          <button onClick={clearFilters} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--sb-ink-3)', textDecoration: 'underline', padding: '0 4px', marginLeft: 2 }}>
            Clear all
          </button>
        </div>
      )}

      {/* Main content */}
      {viewMode === 'board' ? (
        <KanbanBoard
          onOpen={setModalTaskId}
          hideCompleted={hideCompleted}
          filteredTaskIds={filteredTaskIds}
        />
      ) : (
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
      )}

      {modalTask && <TaskDetailModal task={modalTask} onClose={() => setModalTaskId(null)} />}
      {showPlanner && <SmartDayPlanner onClose={() => setShowPlanner(false)} onOpenTask={id => { setShowPlanner(false); setModalTaskId(id) }} />}
    </div>
  )
}
