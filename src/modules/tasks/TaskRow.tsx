// ─── Compact task row (9E matrix quadrants, and the List view) ───────────────
// One line per task: checkbox, title, company, meta — then the same four
// attributes the 9B card carries, laid out horizontally.

import { Check, Paperclip, CalendarDays } from 'lucide-react'
import type { Task } from '@/types'
import { PRIORITY_META } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { openLabel, resolveTaskVisuals } from './taskVisuals'

export function TaskRow({ task, onOpen, dense }: {
  task: Task
  onOpen: (id: string) => void
  /** Matrix rows sit inside a tinted quadrant and drop their own shadow. */
  dense?: boolean
}) {
  const { toggleComplete } = useTaskStore()
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
      onClick={e => { if (!(e.target as HTMLElement).closest('[data-nm]')) onOpen(task.id) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10,
        padding: dense ? '10px 13px' : '12px 14px',
        cursor: 'pointer', minWidth: 0,
        opacity: task.completed ? 0.55 : 1,
      }}
    >
      <button
        data-nm
        onClick={() => toggleComplete(task.id)}
        title={task.completed ? 'Reopen' : 'Complete'}
        style={{
          width: 16, height: 16, borderRadius: 5, boxSizing: 'border-box', flexShrink: 0, padding: 0,
          border: task.completed ? '1.5px solid #5F7038' : '1.5px solid #CFC6B0',
          background: task.completed ? '#5F7038' : '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 13.5, fontWeight: 600, color: '#191712', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: task.completed ? 'line-through' : 'none',
        }}>{task.title}</p>
        {v.companyName && (
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: v.companyColor, lineHeight: 1.3 }}>
            {v.companyName}
          </p>
        )}
        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
          {meta}
          {attachmentCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Paperclip size={10} /> {attachmentCount}
            </span>
          )}
        </p>
      </div>

      {/* Attributes, in the 9B slot order */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, color: '#9B9180' }}>
        <TypeIcon size={14} strokeWidth={1.9} />
        <span title={v.scheduled ? 'Scheduled' : 'Not scheduled'}
          style={{ display: 'flex', color: v.scheduled ? '#5F7038' : '#D8CFB8' }}>
          <CalendarDays size={14} strokeWidth={1.9} />
        </span>
        {task.priority && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: PRIORITY_META[task.priority].color }}>
            {task.priority}
          </span>
        )}
        <span
          title={v.ownerName ?? 'Unassigned'}
          style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            background: v.ownerInitials ? '#191712' : 'transparent',
            border: v.ownerInitials ? 'none' : '1px dashed #D8CFB8',
            color: v.ownerInitials ? '#FFFFFF' : '#C9C0A8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.02em',
          }}
        >{v.ownerInitials ?? ''}</span>
      </div>
    </div>
  )
}
