// ─── 9F Brain dump rail ──────────────────────────────────────────────────────
// Uncategorised capture on the left of the matrix, with a per-task suggestion
// and an auto-distribute footer that reads each task's own fields.

import { useState } from 'react'
import { Plus, Sparkles, GripVertical, Check, AlertTriangle, RotateCcw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import type { Task, Quadrant } from '@/types'
import { loadVisibleCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { suppressUndo } from '@/lib/undo'
import { CountBadge } from './controls'
import { ICON, STROKE } from '@/lib/type'

// ─── Collapsed or not ────────────────────────────────────────────────────────
// The rail costs 360px of the board, so whether it is open is worth remembering
// between visits.

const COLLAPSE_KEY = 'professor-braindump-collapsed'

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}
function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* private mode */ }
}

// ─── Suggestion ──────────────────────────────────────────────────────────────

const QUADRANT_BADGE: Record<Quadrant, string> = {
  do: 'DO', schedule: 'PLAN', delegate: 'DELEGATE', eliminate: 'DROP',
}

function daysUntil(dueDate: string): number {
  const due = new Date(dueDate + 'T00:00:00').getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((due - today.getTime()) / 86_400_000)
}

export interface Suggestion {
  quadrant: Quadrant
  bucket: string
  /** True when the task lacks the fields to decide, so this is a guess. */
  inferred: boolean
}

/** Due date -> urgency. Priority · company -> importance. Status · schedule -> column. */
export function suggestPlacement(task: Task): Suggestion {
  const hasDate     = !!task.dueDate
  const hasPriority = !!task.priority
  const urgent      = hasDate ? daysUntil(task.dueDate!) <= 1 : false
  const important   = hasPriority ? (task.priority === 'P0' || task.priority === 'P1') : !!task.companyId

  const quadrant: Quadrant =
    urgent && important ? 'do'
    : !urgent && important ? 'schedule'
    : urgent ? 'delegate'
    : 'eliminate'

  const bucket =
    task.plannedTime || (hasDate && daysUntil(task.dueDate!) <= 7) ? 'This week'
    : hasDate || hasPriority ? 'Next up'
    : 'Someday'

  return { quadrant, bucket, inferred: !hasDate || !hasPriority }
}

/** Which board column the same fields imply. */
function suggestColumn(task: Task): string {
  if (task.completed) return 'done'
  if (!task.dueDate) return task.priority === 'P0' ? 'decide' : 'later'
  const d = daysUntil(task.dueDate)
  if (d <= 0) return 'decide'
  if (d === 1) return 'today'
  if (d <= 7) return 'this-week'
  return 'later'
}

function relativeCapture(task: Task): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 60000))
  const when = mins < 60 ? `${mins}m ago`
    : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
    : `${Math.floor(mins / 1440)}d ago`
  const via = task.capturedVia === 'voice' ? ' · voice note'
    : task.capturedVia === 'mail' ? ' · from mail'
    : ''
  return `captured ${when}${via}`
}

// ─── Card ────────────────────────────────────────────────────────────────────

function DumpCard({ task, onOpen, onDelete }: {
  task: Task
  onOpen: (id: string) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const [hovered, setHovered] = useState(false)
  const s = suggestPlacement(task)

  return (
    <div
      data-task-node
      ref={setNodeRef}
      onClick={e => { if (!(e.target as HTMLElement).closest('[data-nm]')) onOpen(task.id) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: s.inferred ? '#FFFCF0' : 'var(--sb-card)',
        border: `1px solid ${s.inferred ? '#F0DFA8' : 'var(--sb-border)'}`,
        borderRadius: 'var(--sb-r-nav)', padding: '10px 11px',
        display: 'flex', gap: 8, cursor: 'pointer', minWidth: 0,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span data-nm {...listeners} {...attributes} title="Drag into a quadrant"
        style={{ cursor: 'grab', touchAction: 'none', color: 'var(--sb-ink-4)', display: 'flex', paddingTop: 2, flexShrink: 0 }}>
        <GripVertical size={ICON.sm} strokeWidth={STROKE.rest} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          <p style={{
            flex: 1, margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, lineHeight: 1.3,
            color: task.title.trim() ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
            fontStyle: task.title.trim() ? 'normal' : 'italic',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{task.title.trim() || 'Untitled'}</p>
          <button
            data-nm
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete task"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', flexShrink: 0, marginTop: 1,
              color: hovered ? 'var(--sb-negative)' : '#D8CFB8',
            }}>
            <Trash2 size={ICON.sm} strokeWidth={STROKE.rest} />
          </button>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.3 }}>
          {relativeCapture(task)}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 7, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0,
            padding: '3px 8px', borderRadius: 'var(--sb-r-pill)',
            background: s.inferred ? '#FDF3CE' : '#F4F1E6',
            border: `1px solid ${s.inferred ? '#EBD79A' : '#E4DDC9'}`,
            fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)',
          }}>
            {s.inferred
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Sparkles size={ICON.sm} strokeWidth={STROKE.rest} />AI</span>
              : <Check size={ICON.sm} strokeWidth={STROKE.active} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {QUADRANT_BADGE[s.quadrant]} · {s.bucket}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Rail ────────────────────────────────────────────────────────────────────

export function BrainDumpRail({ tasks, onOpen, flexible }: {
  tasks: Task[]
  onOpen: (id: string) => void
  /** Share the row's width with what sits beside it instead of holding 360px.
   *  Used when the detail panel is open and the space has to go round. */
  flexible?: boolean
}) {
  const { addTask, updateTask, deleteTask } = useTaskStore()
  const [capturing, setCapturing] = useState(false)
  const [draft, setDraft] = useState('')
  const [lastRun, setLastRun] = useState<{ id: string; quadrant: Quadrant | null; boardStatus?: string }[] | null>(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  function toggleCollapsed() {
    setCollapsed(c => { saveCollapsed(!c); return !c })
  }

  const missingFields = tasks.filter(t => !t.dueDate || !t.priority).length

  function commitCapture() {
    const lines = draft.split('\n').map(l => l.trim()).filter(Boolean)
    setCapturing(false)
    setDraft('')
    if (lines.length === 0) return
    const co = loadVisibleCompanies()[0]
    for (const title of lines) {
      addTask({
        title,
        quadrant: null,
        company: (co?.id ?? 'personal') as Task['company'],
        ...(co ? { companyId: co.id } : {}),
        status: 'open',
        completed: false,
        capturedVia: 'manual',
      } as Omit<Task, 'id' | 'createdAt'>)
    }
  }

  function distributeAll() {
    if (tasks.length === 0) return
    setLastRun(tasks.map(t => ({ id: t.id, quadrant: t.quadrant, boardStatus: t.boardStatus })))
    // One action to take back, not one per task: the list is remembered once
    // and every write inside stays quiet.
    useTaskStore.getState()._remember(`Distributed ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`)
    suppressUndo(() => {
      for (const t of tasks) {
        updateTask(t.id, { quadrant: suggestPlacement(t).quadrant, boardStatus: suggestColumn(t) })
      }
    })
  }

  function undoDistribute() {
    if (!lastRun) return
    useTaskStore.getState()._remember('Put the distribution back')
    suppressUndo(() => {
      for (const prev of lastRun) updateTask(prev.id, { quadrant: prev.quadrant, boardStatus: prev.boardStatus })
    })
    setLastRun(null)
  }

  // Shut, the rail keeps only what you need to decide whether to open it: how
  // much is waiting in there.
  if (collapsed) {
    return (
      <div style={{
        width: 44, flexShrink: 0, alignSelf: 'start',
        background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '10px 0 14px', gap: 10,
      }}>
        <button onClick={toggleCollapsed} title="Show the brain dump" style={{
          width: 28, height: 28, borderRadius: 'var(--sb-r-chip)', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', color: 'var(--sb-ink-3)', cursor: 'pointer',
        }}><ChevronRight size={ICON.md} /></button>
        <CountBadge value={tasks.length} />
        <span style={{
          writingMode: 'vertical-rl', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-4)',
          letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none',
        }}>Brain dump</span>
      </div>
    )
  }

  return (
    <div style={{
      ...(flexible
        ? { flex: 1, minWidth: 0 }
        : { width: 'clamp(240px, 26vw, 360px)', flexShrink: 0 }),
      alignSelf: 'start',
      background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px' }}>
        {/* The count belongs beside the title it counts, not loose next to a button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ margin: 0, flex: 1, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>Brain dump</p>
          <CountBadge value={tasks.length} />
          <button onClick={toggleCollapsed} title="Hide the brain dump" style={{
            width: 24, height: 24, borderRadius: 'var(--sb-r-chip)', padding: 0, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', color: 'var(--sb-ink-4)', cursor: 'pointer',
          }}><ChevronLeft size={ICON.md} /></button>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.35 }}>
          Uncategorised — drag into a quadrant
        </p>
        <button onClick={() => setCapturing(c => !c)} style={{
          width: '100%', marginTop: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          height: 32, borderRadius: 'var(--sb-r-sm)',
          background: 'var(--sb-field)', border: '1px solid var(--sb-border)', color: 'var(--sb-ink-1)',
          fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={ICON.sm} strokeWidth={STROKE.rest} /> Capture
        </button>
        {capturing && (
          <textarea
            autoFocus value={draft} rows={3}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitCapture}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitCapture()
              if (e.key === 'Escape') { setCapturing(false); setDraft('') }
            }}
            placeholder={'One per line…'}
            style={{
              width: '100%', boxSizing: 'border-box', marginTop: 9, resize: 'vertical',
              background: 'var(--sb-field)', border: '1px solid var(--sb-accent)', borderRadius: 'var(--sb-r-sm)',
              padding: '8px 10px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
        )}
      </div>

      {/* Cards */}
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: '18px 0', textAlign: 'center', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>
            Nothing uncategorised.
          </p>
        )}
        {tasks.map(t => (
          <DumpCard
            key={t.id}
            task={t}
            onOpen={onOpen}
            onDelete={() => deleteTask(t.id)}
          />
        ))}
      </div>

      {/* Auto-distribute */}
      <div style={{ borderTop: '1px solid var(--sb-hairline)', padding: '13px 14px 14px' }}>
        <p style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase',
        }}>
          <Sparkles size={ICON.sm} strokeWidth={STROKE.rest} /> Auto-distribute
        </p>
        <p style={{ margin: '7px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.45 }}>
          Reads each task's own fields and places it in a quadrant <b style={{ color: 'var(--sb-ink-3)' }}>and</b> a board column in one pass.
        </p>

        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column' }}>
          {[
            ['Due date', 'urgency'],
            ['Priority · company', 'importance'],
            ['Status · schedule', 'column'],
          ].map(([from, to]) => (
            <div key={from} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0', borderBottom: '1px solid #F5F1E5', fontSize: 'var(--sb-t-meta)',
            }}>
              <span style={{ color: 'var(--sb-ink-3)', flex: 1, minWidth: 0 }}>{from}</span>
              <span style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }}>→ {to}</span>
            </div>
          ))}
        </div>

        {missingFields > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 'var(--sb-t-meta)' }}>
            <span style={{ color: 'var(--sb-ink-3)', flex: 1 }}>{missingFields} task{missingFields === 1 ? '' : 's'} missing fields</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sb-negative)', fontWeight: 600, flexShrink: 0 }}>
              <AlertTriangle size={ICON.sm} strokeWidth={STROKE.rest} /> AI fills
            </span>
          </div>
        )}

        <button onClick={distributeAll} disabled={tasks.length === 0} style={{
          width: '100%', marginTop: 12, height: 38, borderRadius: 'var(--sb-r-nav)', border: 'none',
          background: tasks.length === 0 ? 'var(--sb-border)' : 'var(--sb-ink-1)',
          color: tasks.length === 0 ? 'var(--sb-ink-4)' : 'var(--sb-card)',
          fontSize: 'var(--sb-t-body-s)', fontWeight: 600, fontFamily: 'inherit',
          cursor: tasks.length === 0 ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          <Sparkles size={ICON.sm} strokeWidth={STROKE.rest} /> Distribute all {tasks.length}
        </button>

        <button onClick={undoDistribute} disabled={!lastRun} style={{
          width: '100%', marginTop: 8, background: 'none', border: 'none', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontSize: 'var(--sb-t-meta)', color: lastRun ? 'var(--sb-ink-3)' : '#B5AC98', fontFamily: 'inherit',
          cursor: lastRun ? 'pointer' : 'default',
        }}>
          <RotateCcw size={ICON.sm} strokeWidth={STROKE.rest} />
          {lastRun ? 'Undo the last distribution' : 'Preview, then undo in one click'}
        </button>
      </div>
    </div>
  )
}
