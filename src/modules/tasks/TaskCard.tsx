import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Check, Clock, CalendarDays, Paperclip, Flame, User } from 'lucide-react'
import type { Task, TaskType, Priority } from '@/types'
import { TASK_TYPE_META, getVisibleUsers, loadVisibleCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { useDeliverableGate } from './DeliverablePrompt'
import { MeetingFollowUpPopup } from './MeetingFollowUpPopup'
import type { ExtractedTask } from '@/lib/professor'
import {
  PRIORITY_ICON, TASK_TYPE_ORDER, SLOT,
  slotFilled, slotEmpty, slotScheduled, slotPriority,
  initials, openLabel, resolveTaskVisuals,
} from './taskVisuals'
import { OverlaySelect } from './controls'
import { SchedulePopover } from './SchedulePopover'

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
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
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
  // Work that leaves something behind is asked for it before it closes.
  const { requestComplete, prompt: deliverablePrompt } = useDeliverableGate()
  const [hovered, setHovered] = useState(false)
  const [showMeetingPopup, setShowMeetingPopup] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const scheduleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scheduleOpen) return
    const h = (e: MouseEvent) => {
      if (scheduleRef.current && !scheduleRef.current.contains(e.target as Node)) setScheduleOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [scheduleOpen])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const v = resolveTaskVisuals(task)
  const { TypeIcon } = v
  const allUsers = getVisibleUsers()
  const companies = loadVisibleCompanies()
  const users = task.companyId ? allUsers.filter(u => u.companyId === task.companyId) : allUsers
  const attachmentCount = task.attachments?.length ?? 0

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nm]')) return
    onOpen(task.id)
  }

  return (
    <div
      data-task-node
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
          <button
            data-nm
            onClick={() => {
              if (!task.completed && isMeetingTask(task.title)) setShowMeetingPopup(true)
              else requestComplete(task)
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

          <button data-nm
            onClick={() => deleteTask(task.id)}
            title="Delete task"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex',
              flexShrink: 0, marginTop: 2, color: hovered ? '#B4523A' : '#D8CFB8',
            }}>
            <Trash2 size={12.5} strokeWidth={2} />
          </button>

          <p
            style={{
              flex: 1, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#191712',
              lineHeight: 1.35, minWidth: 0,
              textDecoration: task.completed ? 'line-through' : 'none',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >{task.title}</p>

          <button data-nm onClick={() => toggleUrgent(task.id)}
            title={task.urgent ? 'On fire — click to clear' : 'Mark as on fire'}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex',
              flexShrink: 0, marginTop: 2,
              color: task.urgent ? '#B4523A' : hovered ? '#9B9180' : '#D8CFB8',
            }}>
            <Flame size={12.5} strokeWidth={2} fill={task.urgent ? '#B4523A' : 'none'} />
          </button>
        </div>

        {/* Company — coloured text, the card's only colour, and its own picker */}
        <div data-nm style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', margin: '5px 0 0 37px' }}>
          <p style={{
            margin: 0, fontSize: 12, fontWeight: 600,
            color: v.companyName ? v.companyColor : '#C9C0A8', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: 'pointer',
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
        </div>

        {/* Meta line */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 11, margin: '5px 0 0 37px',
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
          {v.scheduleLabel && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <CalendarDays size={11} />
              {v.scheduleLabel}
            </span>
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

        {/* Schedule — our own picker, not the browser's spinner */}
        <div ref={scheduleRef} data-nm style={{ position: 'relative', width: SLOT, height: SLOT }}>
          <button
            data-nm
            onClick={e => { e.stopPropagation(); setScheduleOpen(o => !o) }}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            title={v.scheduled ? `Scheduled ${v.scheduleLabel ?? ''}`.trim() : 'Not scheduled'}
            style={{ ...(v.scheduled ? slotScheduled : slotEmpty), cursor: 'pointer', padding: 0 }}>
            <CalendarDays size={13} strokeWidth={1.9} />
          </button>
          {scheduleOpen && (
            <SchedulePopover
              align="right"
              date={task.dueDate}
              start={task.plannedTime}
              duration={task.duration}
              onApply={patch => updateTask(task.id, patch)}
              onClose={() => setScheduleOpen(false)}
            />
          )}
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
          >{v.ownerInitials ?? <User size={13} strokeWidth={2} />}</div>
          <SlotSelect value={task.owner ?? ''} onChange={val => updateTask(task.id, { owner: val || undefined })}>
            <option value="">Unassigned</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SlotSelect>
        </div>
      </div>

      {deliverablePrompt}

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
