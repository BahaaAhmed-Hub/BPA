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
import { ICON, STROKE } from '@/lib/type'

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
        background: 'var(--sb-card)',
        border: selected ? '2px solid var(--sb-ink-1)' : '1px solid var(--sb-border)',
        // keep the geometry identical whether or not the ink border is on
        padding: selected ? '8px 9px' : '9px 10px',
        borderRadius: 'var(--sb-r-nav)',
        boxShadow: hovered && !selected ? '0 2px 8px rgba(25,23,18,0.07)' : '0 1px 2px rgba(25,23,18,0.04)',
        cursor: isDragging ? 'grabbing' : 'pointer',
        // Without this iOS scrolls the page instead of starting the drag.
        touchAction: 'none',
        display: 'flex', gap: 8, minWidth: 0,
        transition: [transition, 'box-shadow .15s ease'].filter(Boolean).join(', '),
      }}
    >
      {/* ── Left column: checkbox + title, company, meta ────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
          {/* The tick and the bin, stacked: they are both about the card as a
              whole, and side by side they pushed the title into two lines. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, paddingTop: 1 }}>
            <button
              data-nm
              onClick={() => {
                if (!task.completed && isMeetingTask(task.title)) setShowMeetingPopup(true)
                else requestComplete(task)
              }}
              title={task.completed ? 'Reopen' : 'Complete'}
              style={{
                width: 15, height: 15, borderRadius: 'var(--sb-r-chip)', boxSizing: 'border-box',
                border: task.completed ? 'var(--sb-border-emphasis) solid var(--sb-positive)' : 'var(--sb-border-emphasis) solid #CFC6B0',
                background: task.completed ? 'var(--sb-positive)' : 'var(--sb-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0, padding: 0, transition: 'all .15s',
              }}
            >
              {task.completed && <Check size={ICON.sm} color="#fff" strokeWidth={STROKE.active} />}
            </button>

            <button data-nm
              onClick={() => deleteTask(task.id)}
              title="Delete task"
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex',
                flexShrink: 0, color: hovered ? 'var(--sb-negative)' : '#DCD3BF',
              }}>
              <Trash2 size={ICON.sm} strokeWidth={STROKE.rest} />
            </button>
          </div>

          <p
            style={{
              flex: 1, margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
              // An unnamed task reads as unnamed, not as a task called Untitled.
              color: task.title.trim() ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
              fontStyle: task.title.trim() ? 'normal' : 'italic',
              lineHeight: 1.3, minWidth: 0,
              textDecoration: task.completed ? 'line-through' : 'none',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >{task.title.trim() || 'Untitled'}</p>

          <button data-nm onClick={() => toggleUrgent(task.id)}
            title={task.urgent ? 'On fire — click to clear' : 'Mark as on fire'}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex',
              flexShrink: 0, marginTop: 2,
              color: task.urgent ? 'var(--sb-negative)' : hovered ? 'var(--sb-ink-4)' : '#D8CFB8',
            }}>
            <Flame size={ICON.sm} strokeWidth={STROKE.rest} fill={task.urgent ? 'var(--sb-negative)' : 'none'} />
          </button>
        </div>

        {/* Company — coloured text, the card's only colour, and its own picker */}
        <div data-nm style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', margin: '3px 0 0 22px' }}>
          <p style={{
            margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 600,
            color: v.companyName ? v.companyColor : 'var(--sb-ink-4)', lineHeight: 1.3,
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
          display: 'flex', alignItems: 'center', gap: 9, margin: '3px 0 0 22px',
          fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', minWidth: 0,
          // a narrow column (panel open) clips the trailing meta rather than
          // letting it run under the attribute rail
          overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          {attachmentCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <Paperclip size={ICON.sm} /> {attachmentCount}
            </span>
          )}
          {!task.completed && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <Clock size={ICON.sm} /> {openLabel(task)}
            </span>
          )}
          {v.scheduleLabel && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <CalendarDays size={ICON.sm} />
              {v.scheduleLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Right rail: the four attribute slots ────────────────────────── */}
      {/* Two by two rather than a column of four: stacked, the rail was 100px
          of chrome on a card whose words needed sixty, and it set the height of
          every card on the board. */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(2, ${SLOT}px)`,
        gap: 4, flexShrink: 0, alignContent: 'start',
      }}>
        {/* Type */}
        <div data-nm style={{ position: 'relative', width: SLOT, height: SLOT }}>
          <div style={slotFilled} title={v.typeLabel}><TypeIcon size={12} strokeWidth={1.9} /></div>
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
            <CalendarDays size={ICON.sm} strokeWidth={STROKE.rest} />
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
            <PRIORITY_ICON size={12} strokeWidth={1.9} />
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
              borderRadius: 'var(--sb-r-pill)',
              fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.02em',
            }}
          >{v.ownerInitials ?? <User size={ICON.sm} strokeWidth={STROKE.rest} />}</div>
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
