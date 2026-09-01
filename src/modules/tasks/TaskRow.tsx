// ─── Compact task row (9E matrix quadrants, and the List view) ───────────────
// One line per task: checkbox, title, company, meta — then the same four
// attributes the 9B card carries, laid out horizontally.

import { Check, Paperclip, CalendarDays, Flame, Trash2, User } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import type { Task, TaskType, Priority } from '@/types'
import { PRIORITY_META, TASK_TYPE_META } from '@/types'
import { getAllUsers, loadVisibleCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { openLabel, resolveTaskVisuals, TASK_TYPE_ORDER } from './taskVisuals'
import { ControlSlot, OverlaySelect, OverlayTime } from './controls'

export function TaskRow({ task, onOpen, dense }: {
  task: Task
  onOpen: (id: string) => void
  /** Matrix rows sit inside a tinted quadrant and drop their own shadow. */
  dense?: boolean
}) {
  // The row is the drag handle, so a task can be moved to another quadrant
  // without opening it first. The 5px activation distance keeps a click a click.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const { toggleComplete, updateTask, toggleUrgent, deleteTask } = useTaskStore()
  const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']
  const owners = getAllUsers().filter(u => (task.companyId ? u.companyId === task.companyId : true))
  const companies = loadVisibleCompanies()
  const v = resolveTaskVisuals(task)
  const { TypeIcon } = v
  const attachmentCount = task.attachments?.length ?? 0

  const meta = [
    task.completed ? null : `open ${openLabel(task).replace(' open', '')}`,
    task.plannedTime ? `today ${task.plannedTime}`
      : task.dueDate ? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'no date',
  ].filter(Boolean).join(' · ')

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={e => { if (!(e.target as HTMLElement).closest('[data-nm]')) onOpen(task.id) }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10,
        padding: dense ? '10px 13px' : '12px 14px',
        cursor: 'grab', minWidth: 0, touchAction: 'none',
        opacity: isDragging ? 0.35 : task.completed ? 0.55 : 1,
      }}
    >
      <button
        data-nm
        onClick={() => toggleComplete(task.id)}
        title={task.completed ? 'Reopen' : 'Complete'}
        style={{
          width: 16, height: 16, borderRadius: 5, boxSizing: 'border-box', flexShrink: 0, padding: 0, marginTop: 2,
          border: task.completed ? '1.5px solid #5F7038' : '1.5px solid #CFC6B0',
          background: task.completed ? '#5F7038' : '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 13.5, fontWeight: 600, color: '#191712', lineHeight: 1.35,
          overflowWrap: 'anywhere',
          textDecoration: task.completed ? 'line-through' : 'none',
        }}>{task.title}</p>
        <span data-nm style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', marginTop: 2 }}>
          <p style={{
            margin: 0, fontSize: 12, fontWeight: 600, lineHeight: 1.3, cursor: 'pointer',
            color: v.companyName ? v.companyColor : '#C9C0A8',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{v.companyName || 'No company'}</p>
          <OverlaySelect
            title="Change company"
            value={task.companyId ?? ''}
            onChange={val => {
              const co = companies.find(c => c.id === val)
              updateTask(task.id, {
                companyId: co?.id,
                company: (co?.id ?? task.company) as Task['company'],
                owner: undefined,
              })
            }}
            options={[{ value: '', label: 'No company' }, ...companies.map(c => ({ value: c.id, label: c.name }))]}
          />
        </span>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {meta}
          {attachmentCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Paperclip size={10} /> {attachmentCount}
            </span>
          )}
          <span style={{ flex: 1 }} />

          {/* Attributes — each one is its own control, so clicking an icon edits
              it rather than opening the task */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, color: '#9B9180' }}>
        <button
          data-nm
          onClick={e => { e.stopPropagation(); toggleUrgent(task.id) }}
          title={task.urgent ? 'On fire — click to clear' : 'Mark as on fire'}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex',
            color: task.urgent ? '#B4523A' : '#D8CFB8',
          }}>
          <Flame size={14} strokeWidth={1.9} fill={task.urgent ? '#B4523A' : 'none'} />
        </button>

        <ControlSlot size={14}>
          <TypeIcon size={14} strokeWidth={1.9} />
          <OverlaySelect
            title={v.typeLabel}
            value={v.type}
            onChange={val => updateTask(task.id, { taskType: val as TaskType })}
            options={TASK_TYPE_ORDER.map(t => ({ value: t, label: TASK_TYPE_META[t].label }))}
          />
        </ControlSlot>

        <ControlSlot size={14}>
          <span title={v.scheduled ? 'Scheduled' : 'Not scheduled'}
            style={{ display: 'flex', color: v.scheduled ? '#5F7038' : '#D8CFB8' }}>
            <CalendarDays size={14} strokeWidth={1.9} />
          </span>
          <OverlayTime
            title={v.scheduled ? `Scheduled ${task.plannedTime ?? ''}`.trim() : 'Set a time'}
            value={task.plannedTime ?? ''}
            onChange={val => updateTask(task.id, val
              ? { plannedTime: val, duration: task.duration ?? 30 }
              : { plannedTime: undefined })}
          />
        </ControlSlot>

        <ControlSlot size={22}>
          <span style={{
            width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11.5, fontWeight: 700,
            color: task.priority ? PRIORITY_META[task.priority].color : '#D8CFB8',
          }}>{task.priority ?? '—'}</span>
          <OverlaySelect
            title={task.priority ? `Priority ${task.priority}` : 'No priority'}
            value={task.priority ?? ''}
            onChange={val => updateTask(task.id, { priority: (val || undefined) as Priority | undefined })}
            options={[{ value: '', label: 'No priority' }, ...PRIORITIES.map(p => ({ value: p, label: p }))]}
          />
        </ControlSlot>

        <ControlSlot size={22}>
          <span
            title={v.ownerName ?? 'Unassigned'}
            style={{
              width: 22, height: 22, borderRadius: '50%', boxSizing: 'border-box',
              background: v.ownerInitials ? '#191712' : '#F1ECDE',
              border: v.ownerInitials ? 'none' : '1px solid #E8E1CE',
              color: v.ownerInitials ? '#FFFFFF' : '#9B9180',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.02em',
            }}
          >{v.ownerInitials ?? <User size={12} strokeWidth={2} />}</span>
          <OverlaySelect
            title={v.ownerName ?? 'Unassigned'}
            value={task.owner ?? ''}
            onChange={val => updateTask(task.id, { owner: val || undefined })}
            options={[{ value: '', label: 'Unassigned' }, ...owners.map(u => ({ value: u.id, label: u.name }))]}
          />
        </ControlSlot>

        <button
          data-nm
          onClick={e => { e.stopPropagation(); deleteTask(task.id) }}
          title="Delete task"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', color: '#D8CFB8' }}>
          <Trash2 size={14} strokeWidth={1.9} />
        </button>
          </span>
        </p>
      </div>
    </div>
  )
}
