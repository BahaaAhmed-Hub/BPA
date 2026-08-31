import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Check, Clock, CalendarDays, Paperclip, Flame } from 'lucide-react'
import type { Task, TaskType, Priority } from '@/types'
import { TASK_TYPE_META, getAllUsers } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { MeetingFollowUpPopup } from './MeetingFollowUpPopup'
import type { ExtractedTask } from '@/lib/professor'
import {
  PRIORITY_ICON, TASK_TYPE_ORDER, SLOT,
  slotFilled, slotEmpty, slotScheduled, slotPriority,
  initials, openLabel, resolveTaskVisuals,
} from './taskVisuals'

const MEETING_KEYWORDS = ['meeting', 'call', 'sync', 'standup', 'stand-up', '1:1', 'interview', 'check-in', 'debrief', 'catchup', 'catch-up']
const MEETING_EMOJIS   = ['📞', '💬', '🤝', '📅']

function isMeetingTask(title: string): boolean {
  const lower = title.toLowerCase()
  return MEETING_EMOJIS.some(e => title.includes(e)) ||
    MEETING_KEYWORDS.some(k => lower.includes(k))
}

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']

/** A native select laid invisibly over a slot, so the slot itself is the control. */
function SlotSelect({ value, onChange, children }: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      data-nm
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0,
      }}
    >{children}</select>
  )
}

interface TaskCardProps {
  task: Task
  onOpen: (id: string) => void
  /** 9B draws the focused card with a 2px ink border. */
  selected?: boolean
}

export function TaskCard({ task, onOpen, selected }: TaskCardProps) {
  const { toggleComplete, deleteTask, updateTask, addTasksBatch, toggleUrgent } = useTaskStore()
  const [hovered, setHovered] = useState(false)
  const [showMeetingPopup, setShowMeetingPopup] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const v = resolveTaskVisuals(task)
  const { TypeIcon } = v
  const allUsers = getAllUsers()
  const users = task.companyId ? allUsers.filter(u => u.companyId === task.companyId) : allUsers
  const attachmentCount = task.attachments?.length ?? 0

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nm]')) return
    onOpen(task.id)
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: CSS.Transform.toString(transform),
        opacity: isDragging ? 0.4 : task.completed ? 0.55 : 1,
        zIndex: isDragging ? 50 : 'auto',
        position: 'relative',
        // 9B: neutral card. Company shows as coloured text, not as a tinted card.
        background: '#FFFFFF',
        border: selected ? '2px solid #191712' : '1px solid #E8E1CE',
        // keep the geometry identical whether or not the ink border is on
        padding: selected ? '12px 13px' : '13px 14px',
        borderRadius: 12,
        boxShadow: hovered && !selected ? '0 2px 8px rgba(25,23,18,0.07)' : '0 1px 2px rgba(25,23,18,0.04)',
        cursor: isDragging ? 'grabbing' : 'pointer',
        display: 'flex', gap: 10, minWidth: 0,
        transition: [transition, 'box-shadow .15s ease'].filter(Boolean).join(', '),
      }}
    >
      {/* ── Left column: checkbox + title, company, meta ────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, minWidth: 0 }}>
          <button
            data-nm
            onClick={() => {
              if (!task.completed && isMeetingTask(task.title)) setShowMeetingPopup(true)
              else toggleComplete(task.id)
            }}
            title={task.completed ? 'Reopen' : 'Complete'}
            style={{
              width: 16, height: 16, borderRadius: 5, boxSizing: 'border-box', marginTop: 1,
              border: task.completed ? '1.5px solid #5F7038' : '1.5px solid #CFC6B0',
              background: task.completed ? '#5F7038' : '#FFFFFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, padding: 0, transition: 'all .15s',
            }}
          >
            {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
          </button>

          <p
            style={{
              flex: 1, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#191712',
              lineHeight: 1.35, minWidth: 0,
              textDecoration: task.completed ? 'line-through' : 'none',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >{task.title}</p>
        </div>

        {/* Company — coloured text, the card's only colour */}
        {v.companyName && (
          <p style={{
            margin: '5px 0 0 25px', fontSize: 12, fontWeight: 600,
            color: v.companyColor, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{v.companyName}</p>
        )}

        {/* Meta line */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 11, margin: '5px 0 0 25px',
          fontSize: 11.5, color: '#9B9180', minWidth: 0,
          // a narrow column (panel open) clips the trailing meta rather than
          // letting it run under the attribute rail
          overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          {attachmentCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <Paperclip size={11} /> {attachmentCount}
            </span>
          )}
          {!task.completed && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <Clock size={11} /> {openLabel(task)}
            </span>
          )}
          {(task.plannedTime || task.dueDate) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <CalendarDays size={11} />
              {task.plannedTime ?? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {(task.urgent || hovered) && (
            <button data-nm onClick={() => toggleUrgent(task.id)}
              title={task.urgent ? 'On fire — click to clear' : 'Mark as on fire'}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexShrink: 0,
                color: task.urgent ? '#B4523A' : '#C9C0A8',
              }}>
              <Flame size={12} strokeWidth={2} fill={task.urgent ? '#B4523A' : 'none'} />
            </button>
          )}
          <span style={{ flex: 1 }} />
          {hovered && (
            <button data-nm onClick={() => deleteTask(task.id)} title="Delete task"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9C0A8', padding: 0, display: 'flex', flexShrink: 0 }}>
              <Trash2 size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* ── Right rail: the four attribute slots ────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, width: SLOT }}>
        {/* Type */}
        <div data-nm style={{ position: 'relative', width: SLOT, height: SLOT }}>
          <div style={slotFilled} title={v.typeLabel}><TypeIcon size={13} strokeWidth={1.9} /></div>
          <SlotSelect value={v.type} onChange={val => updateTask(task.id, { taskType: val as TaskType })}>
            {TASK_TYPE_ORDER.map(t => <option key={t} value={t}>{TASK_TYPE_META[t].label}</option>)}
          </SlotSelect>
        </div>

        {/* Schedule */}
        <div data-nm style={{ position: 'relative', width: SLOT, height: SLOT }}>
          <div style={v.scheduled ? slotScheduled : slotEmpty}
            title={v.scheduled ? `Scheduled ${v.scheduleLabel ?? ''}`.trim() : 'Not scheduled'}>
            <CalendarDays size={13} strokeWidth={1.9} />
          </div>
          <input
            data-nm type="time" value={task.plannedTime ?? ''}
            onChange={e => updateTask(task.id, { plannedTime: e.target.value || undefined })}
            onClick={e => e.stopPropagation()}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
          />
        </div>

        {/* Priority */}
        <div data-nm style={{ position: 'relative', width: SLOT, height: SLOT }}>
          <div style={task.priority ? slotPriority(task.priority) : slotEmpty}
            title={task.priority ? `Priority ${task.priority}` : 'No priority'}>
            <PRIORITY_ICON size={13} strokeWidth={1.9} />
          </div>
          <SlotSelect value={task.priority ?? ''} onChange={val => updateTask(task.id, { priority: (val || undefined) as Priority | undefined })}>
            <option value="">No priority</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </SlotSelect>
        </div>

        {/* Owner */}
        <div data-nm style={{ position: 'relative', width: SLOT, height: SLOT }}>
          <div
            title={v.ownerName ?? 'Unassigned'}
            style={{
              ...(v.ownerInitials ? slotFilled : slotEmpty),
              borderRadius: '50%',
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.02em',
            }}
          >{v.ownerInitials ?? '+'}</div>
          <SlotSelect value={task.owner ?? ''} onChange={val => updateTask(task.id, { owner: val || undefined })}>
            <option value="">Unassigned</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SlotSelect>
        </div>
      </div>

      {showMeetingPopup && (
        <MeetingFollowUpPopup
          parentTask={task}
          onConfirm={(extracted: (ExtractedTask & { ownerId?: string })[]) => {
            setShowMeetingPopup(false)
            toggleComplete(task.id)
            if (extracted.length > 0) {
              addTasksBatch(extracted.map(t => ({
                title:        t.title,
                quadrant:     t.quadrant ?? null,
                company:      task.company,
                companyId:    task.companyId,
                parentTaskId: task.id,
                status:       'open' as const,
                completed:    false,
                ...(t.dueDate && { dueDate: t.dueDate }),
                ...(t.ownerId && { owner: t.ownerId }),
              })))
            }
          }}
          onSkip={() => { setShowMeetingPopup(false); toggleComplete(task.id) }}
        />
      )}
    </div>
  )
}

export { initials }
