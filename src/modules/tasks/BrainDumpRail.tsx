// ─── 9F Brain dump rail ──────────────────────────────────────────────────────
// Uncategorised capture on the left of the matrix, with a per-task suggestion
// and an auto-distribute footer that reads each task's own fields.

import { useState } from 'react'
import { Plus, Sparkles, GripVertical, Check, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import type { Task, Quadrant } from '@/types'
import { loadVisibleCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { CountBadge } from './controls'

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
      ref={setNodeRef}
      onClick={e => { if (!(e.target as HTMLElement).closest('[data-nm]')) onOpen(task.id) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: s.inferred ? '#FFFCF0' : '#FFFFFF',
        border: `1px solid ${s.inferred ? '#F0DFA8' : '#E8E1CE'}`,
        borderRadius: 11, padding: '10px 11px',
        display: 'flex', gap: 8, cursor: 'pointer', minWidth: 0,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span data-nm {...listeners} {...attributes} title="Drag into a quadrant"
        style={{ cursor: 'grab', color: '#C9C0A8', display: 'flex', paddingTop: 2, flexShrink: 0 }}>
        <GripVertical size={12} strokeWidth={2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          <p style={{
            flex: 1, margin: 0, fontSize: 12.5, fontWeight: 600, color: '#191712', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{task.title}</p>
          <button
            data-nm
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete task"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', flexShrink: 0, marginTop: 1,
              color: hovered ? '#B4523A' : '#D8CFB8',
            }}>
            <Trash2 size={12.5} strokeWidth={2} />
          </button>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: '#9B9180', lineHeight: 1.3 }}>
          {relativeCapture(task)}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 7, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0,
            padding: '3px 8px', borderRadius: 999,
            background: s.inferred ? '#FDF3CE' : '#F4F1E6',
            border: `1px solid ${s.inferred ? '#EBD79A' : '#E4DDC9'}`,
            fontSize: 10.5, fontWeight: 600, color: '#6C6553',
          }}>
            {s.inferred
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Sparkles size={10} strokeWidth={2} />AI</span>
              : <Check size={10} strokeWidth={2.5} />}
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

export function BrainDumpRail({ tasks, onOpen }: {
  tasks: Task[]
  onOpen: (id: string) => void
}) {
  const { addTask, updateTask, deleteTask } = useTaskStore()
  const [capturing, setCapturing] = useState(false)
  const [draft, setDraft] = useState('')
  const [lastRun, setLastRun] = useState<{ id: string; quadrant: Quadrant | null; boardStatus?: string }[] | null>(null)

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
    for (const t of tasks) {
      updateTask(t.id, { quadrant: suggestPlacement(t).quadrant, boardStatus: suggestColumn(t) })
    }
  }

  function undoDistribute() {
    if (!lastRun) return
    for (const prev of lastRun) updateTask(prev.id, { quadrant: prev.quadrant, boardStatus: prev.boardStatus })
    setLastRun(null)
  }

  return (
    <div style={{
      width: 360, flexShrink: 0, alignSelf: 'start',
      background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px' }}>
        {/* The count belongs beside the title it counts, not loose next to a button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ margin: 0, flex: 1, fontSize: 13.5, fontWeight: 600, color: '#191712', lineHeight: 1.3 }}>Brain dump</p>
          <CountBadge value={tasks.length} />
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.35 }}>
          Uncategorised — drag into a quadrant
        </p>
        <button onClick={() => setCapturing(c => !c)} style={{
          width: '100%', marginTop: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          height: 32, borderRadius: 9,
          background: '#FAF7EC', border: '1px solid #E8E1CE', color: '#191712',
          fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={13} strokeWidth={2} /> Capture
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
              background: '#FAF7EC', border: '1px solid #F5D14E', borderRadius: 9,
              padding: '8px 10px', fontSize: 12, color: '#191712', outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
        )}
      </div>

      {/* Cards */}
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#B5AC98' }}>
            Nothing uncategorised.
          </p>
        )}
        {tasks.map(t => (
          <DumpCard
            key={t.id}
            task={t}
            onOpen={onOpen}
            onDelete={() => { if (window.confirm(`Delete "${t.title}"?`)) deleteTask(t.id) }}
          />
        ))}
      </div>

      {/* Auto-distribute */}
      <div style={{ borderTop: '1px solid #F0EBDC', padding: '13px 14px 14px' }}>
        <p style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', textTransform: 'uppercase',
        }}>
          <Sparkles size={11} strokeWidth={2} /> Auto-distribute
        </p>
        <p style={{ margin: '7px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.45 }}>
          Reads each task's own fields and places it in a quadrant <b style={{ color: '#6C6553' }}>and</b> a board column in one pass.
        </p>

        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column' }}>
          {[
            ['Due date', 'urgency'],
            ['Priority · company', 'importance'],
            ['Status · schedule', 'column'],
          ].map(([from, to]) => (
            <div key={from} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0', borderBottom: '1px solid #F5F1E5', fontSize: 11.5,
            }}>
              <span style={{ color: '#6C6553', flex: 1, minWidth: 0 }}>{from}</span>
              <span style={{ color: '#B5AC98', flexShrink: 0 }}>→ {to}</span>
            </div>
          ))}
        </div>

        {missingFields > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 11.5 }}>
            <span style={{ color: '#6C6553', flex: 1 }}>{missingFields} task{missingFields === 1 ? '' : 's'} missing fields</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#B4523A', fontWeight: 600, flexShrink: 0 }}>
              <AlertTriangle size={11} strokeWidth={2} /> AI fills
            </span>
          </div>
        )}

        <button onClick={distributeAll} disabled={tasks.length === 0} style={{
          width: '100%', marginTop: 12, height: 38, borderRadius: 10, border: 'none',
          background: tasks.length === 0 ? '#E8E1CE' : '#191712',
          color: tasks.length === 0 ? '#9B9180' : '#FFFFFF',
          fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
          cursor: tasks.length === 0 ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          <Sparkles size={13} strokeWidth={2} /> Distribute all {tasks.length}
        </button>

        <button onClick={undoDistribute} disabled={!lastRun} style={{
          width: '100%', marginTop: 8, background: 'none', border: 'none', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontSize: 11, color: lastRun ? '#6C6553' : '#B5AC98', fontFamily: 'inherit',
          cursor: lastRun ? 'pointer' : 'default',
        }}>
          <RotateCcw size={11} strokeWidth={2} />
          {lastRun ? 'Undo the last distribution' : 'Preview, then undo in one click'}
        </button>
      </div>
    </div>
  )
}
