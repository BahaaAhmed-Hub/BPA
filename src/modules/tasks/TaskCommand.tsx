import { useState, useEffect, useRef, useMemo } from 'react'
import {
  DndContext, DragOverlay, closestCorners,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { EisenhowerBoard } from './EisenhowerBoard'
import { BrainDumpRail } from './BrainDumpRail'
import { KanbanBoard } from './KanbanBoard'
import { TaskDetailPanel } from './TaskDetailPanel'
import { TaskCard } from './TaskCard'
import { useTaskStore } from '@/store/taskStore'
import { Search, X, Plus, SlidersHorizontal, LayoutGrid, Target, List as ListIcon } from 'lucide-react'
import type { Quadrant, Task } from '@/types'
import { isTaskHidden, loadVisibleCompanies, getAllUsers, TASK_TYPE_META, inferTaskType } from '@/types'
import { scheduleTaskToCalendar } from '@/lib/aiScheduler'
import { SmartDayPlanner } from './SmartDayPlanner'
import { TaskListView } from './TaskListView'
import { TaskBanner } from './TaskBanner'
import { TASK_TYPE_ICON, TASK_TYPE_ORDER } from './taskVisuals'

const QUADRANTS: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']
const TASKS_CONFIG_KEY = 'task-command-config'

type GroupBy = 'none' | 'status' | 'type' | 'company' | 'owner'
interface TaskConfig { hideCompleted: boolean; groupBy: GroupBy; allGroupsExpanded: boolean }
interface TaskFilters { company: string; type: string; owner: string }
type ViewMode = 'board' | 'eisenhower' | 'list'

const GROUP_BY_LABEL: Record<GroupBy, string> = {
  none: 'None', status: 'Status', type: 'Task type', company: 'Company', owner: 'Owner',
}

function loadTaskConfig(): TaskConfig {
  try { return { hideCompleted: false, groupBy: 'none', allGroupsExpanded: true, ...JSON.parse(localStorage.getItem(TASKS_CONFIG_KEY) ?? '{}') } }
  catch { return { hideCompleted: false, groupBy: 'none', allGroupsExpanded: true } }
}

export function TaskCommand() {
  const { tasks: allTasks, moveTask, moveTaskBefore, reorderInbox, reorderQuadrant, updateTask, addTask } = useTaskStore()
  const tasks = allTasks.filter(t => !isTaskHidden(t))

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('task-view-mode') as ViewMode) ?? 'board'
  )
  function switchView(mode: ViewMode) {
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
  function clearFilters() { setFilters({ company: '', type: '', owner: '' }); setSearchQuery('') }

  /** Create a blank task, then open it in the detail panel ready to name.
   *  The store mints the id, so the new task is picked up on the next render. */
  const openNewestRef = useRef(false)
  function handleNewTask() {
    const firstCompany = loadVisibleCompanies()[0]
    openNewestRef.current = true
    addTask({
      title: 'New task',
      quadrant: null,
      company: (firstCompany?.id ?? 'personal') as Task['company'],
      companyId: firstCompany?.id,
      status: 'open',
      completed: false,
    } as Omit<Task, 'id' | 'createdAt'>)
  }
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [modalTaskId,  setModalTaskId]  = useState<string | null>(null)
  const [showPlanner,  setShowPlanner]  = useState(false)

  useEffect(() => {
    if (!openNewestRef.current || allTasks.length === 0) return
    openNewestRef.current = false
    const newest = [...allTasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (newest) setModalTaskId(newest.id)
  }, [allTasks])

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

  /** Captured but not yet placed — what the rail and the board's first column show. */
  const dumpedTasks = tasks.filter(t =>
    t.quadrant == null && !t.completed && t.status !== 'done' && t.status !== 'cancelled' &&
    (!filteredTaskIds || filteredTaskIds.has(t.id))
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

  return (
    <div>
      {/* ── Summary strip, then the header beneath it ───────────────────────── */}
      <div style={{ padding: '20px 26px 0' }}>
        <TaskBanner tasks={tasks} />
      </div>

      <div style={{ padding: '18px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          {/* Filter button */}
          <div ref={filterRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setFilterOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, boxSizing: 'border-box', padding: '0 18px', borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712', fontSize: 13, fontWeight: 500, cursor: 'pointer', boxShadow: '0 1px 3px rgba(25,23,18,0.06)' }}>
              <SlidersHorizontal size={14} strokeWidth={2} />
              Filters
              {activeFilterCount > 0 && (
                <span style={{ height: 18, minWidth: 18, boxSizing: 'border-box', padding: '0 5px', borderRadius: 999, background: '#191712', color: '#FDF8E7', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                {/* Search — the artboard has no page-level search bar, so it
                    lives here rather than being dropped. */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: 12 }}>
                  <Search size={13} color="#9B9180" style={{ position: 'absolute', left: 11, pointerEvents: 'none' }} />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search tasks…"
                    style={{
                      width: '100%', boxSizing: 'border-box', background: '#FAF7EC',
                      border: `1px solid ${searchQuery ? '#F5D14E' : '#E8E1CE'}`,
                      borderRadius: 9, padding: '8px 30px 8px 32px',
                      color: '#191712', fontSize: 12.5, outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 9, background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180', display: 'flex', padding: 2 }}>
                      <X size={12} />
                    </button>
                  )}
                </div>

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
                {(['none', 'status', 'type', 'company', 'owner'] as GroupBy[]).map(opt => (
                  <div key={opt} onClick={() => setGroupBy(opt)} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 9px', borderRadius: 9, background: groupBy === opt ? '#FEF7DE' : 'transparent', cursor: 'pointer' }}>
                    <span style={{ width: 16, height: 16, boxSizing: 'border-box', borderRadius: 999, border: `2px solid ${groupBy === opt ? '#191712' : '#C9C0A8'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {groupBy === opt && <span style={{ width: 7, height: 7, borderRadius: 999, background: '#191712' }} />}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: groupBy === opt ? 600 : 500, color: groupBy === opt ? '#191712' : '#4A4438' }}>
                      {GROUP_BY_LABEL[opt]}
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
                  {TASK_TYPE_ORDER.map(type => {
                    const Icon = TASK_TYPE_ICON[type]
                    const on = filters.type === type
                    return (
                      <button key={type} onClick={() => setFilters(f => ({ ...f, type: f.type === type ? '' : type }))} style={{
                        display: 'flex', alignItems: 'center', gap: 6, height: 28, boxSizing: 'border-box', padding: '0 11px', borderRadius: 999,
                        background: on ? '#FEF7DE' : '#FFFFFF',
                        border: `1px solid ${on ? '#F5D14E' : '#E8E1CE'}`,
                        color: '#191712', fontSize: 11.5, fontWeight: on ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                        <Icon size={12} strokeWidth={1.9} /> {TASK_TYPE_META[type].label}
                      </button>
                    )
                  })}
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
                    <button onClick={clearFilters} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: '#191712', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Clear all</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* View switcher — Board | Matrix | List */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 38, boxSizing: 'border-box', padding: 3, borderRadius: 999, background: '#EDE7D9', flexShrink: 0 }}>
            {([
              { id: 'board',      label: 'Board',  Icon: LayoutGrid },
              { id: 'eisenhower', label: 'Matrix', Icon: Target },
              { id: 'list',       label: 'List',   Icon: ListIcon },
            ] as { id: ViewMode; label: string; Icon: typeof LayoutGrid }[]).map(v => {
              const on = viewMode === v.id
              return (
                <button key={v.id} onClick={() => switchView(v.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, height: 32, boxSizing: 'border-box',
                    padding: '0 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: on ? '#FFFFFF' : 'transparent',
                    boxShadow: on ? '0 1px 3px rgba(25,23,18,.14)' : 'none',
                    color: on ? '#191712' : '#8A8271',
                    fontSize: 13, fontWeight: on ? 700 : 500, fontFamily: 'inherit',
                    transition: 'all .14s', flexShrink: 0,
                  }}>
                  <v.Icon size={14} strokeWidth={2} /> {v.label}
                </button>
              )
            })}
          </span>

          {/* New task CTA */}
          <button
            onClick={handleNewTask}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, boxSizing: 'border-box', padding: '0 18px', borderRadius: 999, background: '#F5D14E', color: '#191712', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(25,23,18,0.14)', flexShrink: 0, fontFamily: 'inherit' }}>
            <Plus size={15} strokeWidth={2.2} />
            New task
          </button>
        </span>
      </div>

      {/* Main content */}
      {viewMode === 'list' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {/* The list carries the same brain dump rail the matrix does */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, minWidth: 0, padding: '4px 0 0 28px' }}>
            <div>
              <BrainDumpRail tasks={dumpedTasks} onOpen={setModalTaskId} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TaskListView
                tasks={tasks}
                onOpen={setModalTaskId}
                hideCompleted={hideCompleted}
                groupBy={groupBy}
                filteredTaskIds={filteredTaskIds}
              />
            </div>
            {modalTask && (
              <div style={{ paddingRight: 28, paddingBottom: 28 }}>
                <TaskDetailPanel key={modalTask.id} task={modalTask} onClose={() => setModalTaskId(null)} />
              </div>
            )}
          </div>

          <DragOverlay>
            {activeTask && (
              <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
                <TaskCard task={activeTask} onOpen={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : viewMode === 'board' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <KanbanBoard
              onOpen={setModalTaskId}
              hideCompleted={hideCompleted}
              filteredTaskIds={filteredTaskIds}
            />
          </div>
          {modalTask && (
            <div style={{ paddingTop: 4, paddingRight: 28, paddingBottom: 28 }}>
              <TaskDetailPanel key={modalTask.id} task={modalTask} onClose={() => setModalTaskId(null)} />
            </div>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {/* 9F: the brain dump rail sits to the LEFT of the matrix */}
          <div style={{ display: 'flex', gap: 16, padding: '4px 28px 28px', alignItems: 'flex-start' }}>
            <div>
            <BrainDumpRail tasks={dumpedTasks} onOpen={setModalTaskId} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <EisenhowerBoard onOpen={setModalTaskId} hideCompleted={hideCompleted} groupBy={groupBy} allGroupsExpanded={allGroupsExpanded} filteredTaskIds={filteredTaskIds} onOpenPlanner={() => setShowPlanner(true)} />
            </div>
            {modalTask && (
              <div>
                <TaskDetailPanel key={modalTask.id} task={modalTask} onClose={() => setModalTaskId(null)} />
              </div>
            )}
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

      {showPlanner && <SmartDayPlanner onClose={() => setShowPlanner(false)} onOpenTask={id => { setShowPlanner(false); setModalTaskId(id) }} />}
    </div>
  )
}
