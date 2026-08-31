import { useState, useMemo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Check, GripVertical, Clock, Calendar, CalendarCheck, Zap } from 'lucide-react'
import type { Task, TaskType } from '@/types'
import { COMPANY_COLORS, TASK_TYPE_META, inferTaskType, getAllUsers, loadDynamicCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { MeetingFollowUpPopup } from './MeetingFollowUpPopup'
import type { ExtractedTask } from '@/lib/professor'

const MEETING_KEYWORDS = ['meeting', 'call', 'sync', 'standup', 'stand-up', '1:1', 'interview', 'check-in', 'debrief', 'catchup', 'catch-up']
const MEETING_EMOJIS   = ['📞', '💬', '🤝', '📅']

function isMeetingTask(title: string): boolean {
  const lower = title.toLowerCase()
  return MEETING_EMOJIS.some(e => title.includes(e)) ||
    MEETING_KEYWORDS.some(k => lower.includes(k))
}

/** Convert hex color (#RRGGBB or #RGB) to "R, G, B" string for rgba() */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    const [r, g, b] = h.split('').map(c => parseInt(c + c, 16))
    return `${r}, ${g}, ${b}`
  }
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '25, 23, 18'
  return `${r}, ${g}, ${b}`
}

/** Get initials from a full name — up to 2 characters */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Days since an ISO date string */
function daysOpen(createdAt: string): number {
  const created = new Date(createdAt).getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((now - created) / 86_400_000))
}

interface TaskCardProps {
  task: Task
  onOpen: (id: string) => void
}

export function TaskCard({ task, onOpen }: TaskCardProps) {
  const { toggleComplete, deleteTask, updateTask, addTasksBatch, toggleUrgent } = useTaskStore()
  const [hovered, setHovered] = useState(false)
  const [showMeetingPopup, setShowMeetingPopup] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [editingDate, setEditingDate] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [editingOwner, setEditingOwner] = useState(false)
  const [editingType, setEditingType] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
  }

  const companies    = loadDynamicCompanies()
  const dynCompany   = companies.find(c => c.id === task.companyId)
  const companyColor = dynCompany?.color ?? COMPANY_COLORS[task.company] ?? '#6C6553'
  const allUsers  = getAllUsers()
  const ownerUser = task.owner ? allUsers.find(u => u.id === task.owner) : undefined
  // Only show users belonging to the task's selected company in the owner picker
  const users = task.companyId
    ? allUsers.filter(u => u.companyId === task.companyId)
    : allUsers
  const isSchedule = task.quadrant === 'schedule'
  const isDelegate = task.quadrant === 'delegate'

  const openDays = useMemo(() => daysOpen(task.createdAt), [task.createdAt])

  function saveTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed })
    else setTitleDraft(task.title)
    setEditingTitle(false)
  }

  // Clicking the card background opens the modal.
  // Interactive child elements stop propagation via data-nm attribute check.
  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nm]')) return
    onOpen(task.id)
  }

  const fieldInput: React.CSSProperties = {
    background: '#F7F4EA', border: '1px solid #353A50', borderRadius: 4,
    color: '#191712', fontSize: 10, padding: '1px 5px', outline: 'none',
  }

  // Design-spec card background: company color at 8.5% opacity
  const cardBg = `rgba(${hexToRgb(companyColor)}, 0.085)`
  const cardBorder = hovered || isDragging
    ? `2px solid ${companyColor}`
    : `1px solid rgba(${hexToRgb(companyColor)}, 0.42)`

  const ccRgb = hexToRgb(companyColor.startsWith('#') ? companyColor : '#8C826A')
  const tt = task.taskType ?? inferTaskType(task.title)
  const meta = TASK_TYPE_META[tt]

  return (
    <div
      ref={setNodeRef}
      onClick={handleCardClick}
      style={{
        ...style,
        position: 'relative',
        background: cardBg,
        border: cardBorder,
        borderRadius: 13,
        padding: '11px 12px',
        display: 'flex', flexDirection: 'column', gap: 7,
        cursor: isDragging ? 'grabbing' : 'pointer',
        overflow: 'hidden',
        boxShadow: hovered ? '0 8px 20px -12px rgba(25,23,18,.4)' : 'none',
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
        opacity: task.completed ? 0.6 : 1,
        minWidth: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Row 1: drag handle + checkbox + title + urgent/delete ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {/* Drag handle */}
        <div data-nm {...listeners} {...attributes} style={{
          cursor: 'grab', color: hovered ? '#8A8272' : 'transparent',
          transition: 'color 0.15s', flexShrink: 0, marginTop: 2, display: 'flex',
        }}>
          <GripVertical size={12} strokeWidth={2} />
        </div>

        {/* Checkbox */}
        <button
          data-nm
          onClick={() => {
            if (!task.completed && isMeetingTask(task.title)) {
              setShowMeetingPopup(true)
            } else {
              toggleComplete(task.id)
            }
          }}
          style={{
            width: 16, height: 16, borderRadius: 5, boxSizing: 'border-box',
            border: task.completed ? '1.5px solid #4E7645' : '1.5px solid rgba(25,23,18,.28)',
            background: task.completed ? '#4E7645' : 'rgba(255,255,255,.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, marginTop: 2, transition: 'all 0.15s ease',
          }}
        >
          {task.completed && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingTitle ? (
            <input
              data-nm
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') saveTitle()
                if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false) }
              }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: '1px solid #191712', outline: 'none',
                color: '#191712', fontSize: 12.5, fontWeight: 600,
                width: '100%', padding: 0, fontFamily: 'inherit', lineHeight: 1.32,
              }}
            />
          ) : (
            <p
              data-nm
              onClick={() => { if (!task.completed) setEditingTitle(true) }}
              title={task.completed ? undefined : 'Click to rename'}
              style={{
                margin: 0, fontSize: 12.5, fontWeight: 600, color: '#191712',
                lineHeight: 1.35, textDecoration: task.completed ? 'line-through' : 'none',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', minWidth: 0,
                cursor: task.completed ? 'default' : 'text',
              }}
            >{task.title}</p>
          )}
        </div>

        {/* Urgent toggle + Delete */}
        <div data-nm style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button data-nm onClick={() => toggleUrgent(task.id)} title={task.urgent ? 'Unmark urgent' : 'Mark urgent'}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 4, color: task.urgent ? '#B94A2E' : hovered ? '#8A8272' : 'transparent', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}>
            <Zap size={11} strokeWidth={2} fill={task.urgent ? '#B94A2E' : 'none'} />
          </button>
          {hovered && (
            <button data-nm onClick={() => deleteTask(task.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#8A8272', padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <Trash2 size={11} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* ── Row 2: company (colored) + task type badge + urgent badge ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 36, flexWrap: 'wrap', minWidth: 0 }}>

        {/* Company colored text */}
        {(dynCompany?.name || task.company) && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: companyColor,
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: companyColor, display: 'inline-block', flexShrink: 0 }} />
            {dynCompany?.name ?? task.company}
          </span>
        )}

        {/* Task type badge */}
        {editingType ? (
          <select
            data-nm autoFocus
            value={tt}
            onChange={e => { updateTask(task.id, { taskType: e.target.value as TaskType }); setEditingType(false) }}
            onBlur={() => setEditingType(false)}
            style={{ ...fieldInput, fontSize: 10 }}
          >
            {(Object.keys(TASK_TYPE_META) as TaskType[]).map(k => (
              <option key={k} value={k}>{TASK_TYPE_META[k].emoji} {TASK_TYPE_META[k].label}</option>
            ))}
          </select>
        ) : (
          <span
            data-nm onClick={() => setEditingType(true)} title="Change task type"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              height: 18, boxSizing: 'border-box', padding: '0 6px', borderRadius: 4,
              background: `rgba(255,255,255,.78)`, border: `1px solid rgba(${ccRgb},.38)`,
              color: companyColor.startsWith('#') ? companyColor : '#8C826A',
              fontSize: 9.5, fontWeight: 700, flexShrink: 0, cursor: 'pointer',
            }}
          >{meta.emoji} {meta.label}</span>
        )}

        {/* Urgent badge */}
        {task.urgent && (
          <span style={{ height: 17, boxSizing: 'border-box', padding: '0 5px', borderRadius: 4, background: '#FBEAE4', border: '1px solid #E5BBAC', color: '#B94A2E', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            P0
          </span>
        )}

        {/* Calendar scheduled indicator */}
        {task.gcalEventId && (
          <span title="Scheduled to Google Calendar"
            style={{ display: 'flex', alignItems: 'center', gap: 4, height: 17, boxSizing: 'border-box', padding: '0 5px', borderRadius: 4, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(25,23,18,.1)', color: '#4E7645', fontSize: 9, fontWeight: 600, flexShrink: 0 }}>
            <CalendarCheck size={9} /> Sched
          </span>
        )}
      </div>

      {/* ── Row 3: Xd open · due date · time · owner initials ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 36, minWidth: 0 }}>

        {/* Days open */}
        {!task.completed && (
          <span style={{ fontSize: 9.5, color: '#8A8272', fontWeight: 500, flexShrink: 0 }}>
            {openDays === 0 ? 'Today' : `${openDays}d open`}
          </span>
        )}

        {/* Due date chip */}
        {(task.dueDate || isSchedule) && (
          editingDate ? (
            <input data-nm type="date" autoFocus value={task.dueDate ?? ''}
              onChange={e => updateTask(task.id, { dueDate: e.target.value || undefined })}
              onBlur={() => setEditingDate(false)}
              onKeyDown={e => e.key === 'Escape' && setEditingDate(false)}
              style={{ ...fieldInput, fontSize: 9.5 }}
            />
          ) : (
            <span data-nm onClick={() => setEditingDate(true)} title="Set due date"
              style={{ display: 'flex', alignItems: 'center', gap: 4, height: 17, boxSizing: 'border-box', padding: '0 6px', borderRadius: 4, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(25,23,18,.1)', color: '#6C6553', fontSize: 9.5, fontWeight: 600, flexShrink: 0, cursor: 'pointer' }}>
              <Calendar size={9} />
              {task.dueDate ? new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Set date'}
            </span>
          )
        )}

        {/* Spacer pushes time + owner to the right */}
        <span style={{ flex: 1 }} />

        {/* Planned time */}
        {task.plannedTime && (
          editingTime ? (
            <input data-nm type="time" autoFocus value={task.plannedTime ?? ''}
              onChange={e => updateTask(task.id, { plannedTime: e.target.value || undefined })}
              onBlur={() => setEditingTime(false)}
              onKeyDown={e => e.key === 'Escape' && setEditingTime(false)}
              style={{ ...fieldInput, fontSize: 9.5 }}
            />
          ) : (
            <span data-nm onClick={() => setEditingTime(true)} title="Set planned time"
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 600, color: '#6C6553', flexShrink: 0, cursor: 'pointer' }}>
              <Clock size={9} />
              {task.plannedTime}
            </span>
          )
        )}

        {/* Owner initials badge */}
        {(task.owner || isDelegate) && (
          editingOwner ? (
            <select data-nm autoFocus value={task.owner ?? ''}
              onChange={e => { updateTask(task.id, { owner: e.target.value || undefined }); setEditingOwner(false) }}
              onBlur={() => setEditingOwner(false)}
              style={{ ...fieldInput, fontSize: 9.5 }}
            >
              <option value="">— none —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          ) : (
            <span
              data-nm
              onClick={() => setEditingOwner(true)}
              title={ownerUser ? ownerUser.name : 'Assign owner'}
              style={{
                width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                background: companyColor, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8.5, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 0 0 1.5px rgba(255,255,255,.7)',
                letterSpacing: '0.02em',
              }}
            >
              {ownerUser ? getInitials(ownerUser.name) : '?'}
            </span>
          )
        )}
      </div>

      {/* Meeting follow-up popup — shown when completing a meeting/call task */}
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
                ...(t.dueDate  && { dueDate: t.dueDate }),
                ...(t.ownerId  && { owner: t.ownerId }),
              })))
            }
          }}
          onSkip={() => {
            setShowMeetingPopup(false)
            toggleComplete(task.id)
          }}
        />
      )}
    </div>
  )
}
