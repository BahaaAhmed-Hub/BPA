// ─── 9D task detail panel ────────────────────────────────────────────────────
// A docked right-hand panel, not a centred modal: company pill and controls on
// top, then the title, one row of pickers, the attribute chips, checklist,
// notes, attachments and the activity log, over a Cancel / Save footer.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Maximize2, ChevronDown, ChevronLeft, ChevronRight,
  Plus, Link2, Folder, FileText, Image as ImageIcon, CalendarDays, BarChart3, History, Trash2, Check,
} from 'lucide-react'
import type { Task, TaskType, Priority, ChecklistStep, TaskAttachment } from '@/types'
import { PRIORITY_META, TASK_TYPE_META, getAllUsers, loadVisibleCompanies } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { TASK_TYPE_ORDER, initials, resolveTaskVisuals } from './taskVisuals'

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Today, 29 Aug" / "Thu, 4 Sep" / "No date" */
function formatDateLabel(iso?: string): string {
  if (!iso) return 'No date'
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return 'No date'
  const today = toISODate(new Date())
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (iso === today) return `Today, ${day}`
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })}, ${day}`
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = (h * 60 + m + mins) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function relativeStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const ICON_BTN: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 0,
}

/** One attribute cell: same height and shape in every state, icon then value. */
const CELL: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  height: 34, padding: '0 11px', borderRadius: 9, minWidth: 0,
  background: '#FAF7EC', border: '1px solid #E8E1CE',
  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
}

const CELL_VALUE: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/** The native control that actually drives a cell, laid invisibly over it. */
const CELL_INPUT: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0,
}

const SECTION_LABEL: React.CSSProperties = {
  margin: 0, fontSize: 12, fontWeight: 600, color: '#6C6553',
}

/** Month grid + start/end, as the artboard's date popover. */
function DatePopover({ date, start, duration, onApply, onClose }: {
  date?: string
  start?: string
  duration?: number
  onApply: (patch: { dueDate?: string; plannedTime?: string; duration?: number }) => void
  onClose: () => void
}) {
  const initial = date ? new Date(date + 'T00:00:00') : new Date()
  const [view, setView] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1))
  const [picked, setPicked] = useState<string | undefined>(date)
  const [from, setFrom] = useState(start ?? '09:00')
  const [to, setTo] = useState(addMinutes(start ?? '09:00', duration ?? 30))
  // End follows the start by whatever gap is currently showing — 30 minutes to
  // begin with, or whatever the user last set the end to.
  const gapRef = useRef(duration ?? 30)

  function changeStart(v: string) {
    setFrom(v)
    setTo(addMinutes(v, gapRef.current))
  }

  function changeEnd(v: string) {
    setTo(v)
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = v.split(':').map(Number)
    const gap = (th * 60 + tm) - (fh * 60 + fm)
    if (gap > 0) gapRef.current = gap
  }

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    // Monday-first, like the artboard
    const lead = (first.getDay() + 6) % 7
    const startCell = new Date(first)
    startCell.setDate(first.getDate() - lead)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(startCell)
      d.setDate(startCell.getDate() + i)
      return d
    })
  }, [view])

  const minutes = (() => {
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = to.split(':').map(Number)
    return Math.max(0, (th * 60 + tm) - (fh * 60 + fm))
  })()

  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 80, width: 292,
      background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14, padding: 14,
      boxShadow: '0 24px 56px -22px rgba(25,23,18,.45)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#191712' }}>
          {view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1))} style={{ ...ICON_BTN, width: 22, height: 22 }}>
          <ChevronLeft size={14} />
        </button>
        <button onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1))} style={{ ...ICON_BTN, width: 22, height: 22 }}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600, color: '#9B9180', padding: '2px 0 4px' }}>{w}</span>
        ))}
        {cells.map(d => {
          const iso = toISODate(d)
          const outside = d.getMonth() !== view.getMonth()
          const on = iso === picked
          return (
            <button key={iso} onClick={() => setPicked(iso)} style={{
              height: 28, borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: on ? '#191712' : 'transparent',
              color: on ? '#FFFFFF' : outside ? '#CFC6B0' : '#191712',
              fontSize: 12, fontWeight: on ? 700 : 500,
            }}>{d.getDate()}</button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#6C6553', marginBottom: 4 }}>Start</span>
          <input type="time" value={from} onChange={e => changeStart(e.target.value)} style={{
            width: '100%', boxSizing: 'border-box', background: '#FAF7EC', border: '1px solid #E8E1CE',
            borderRadius: 8, padding: '7px 9px', fontSize: 12.5, color: '#191712', outline: 'none', fontFamily: 'inherit',
          }} />
        </label>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#6C6553', marginBottom: 4 }}>End</span>
          <input type="time" value={to} onChange={e => changeEnd(e.target.value)} style={{
            width: '100%', boxSizing: 'border-box', background: '#FAF7EC', border: '1px solid #E8E1CE',
            borderRadius: 8, padding: '7px 9px', fontSize: 12.5, color: '#191712', outline: 'none', fontFamily: 'inherit',
          }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={{ flex: 1, fontSize: 11.5, color: '#9B9180' }}>
          {minutes > 0 ? `${minutes}m block at ${from}` : 'End must follow start'}
        </span>
        <button
          onClick={() => { onApply({ dueDate: picked, plannedTime: from, duration: minutes || undefined }); onClose() }}
          style={{
            height: 30, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#F5D14E', color: '#191712', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
          }}>Set block</button>
      </div>
    </div>
  )
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function TaskDetailPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, deleteTask, activities } = useTaskStore()
  const [draft, setDraft] = useState<Task>(task)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [fullLog, setFullLog] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [activityOpen, setActivityOpen] = useState(true)
  const [dropping, setDropping] = useState(false)
  const [newStep, setNewStep] = useState('')
  const dateRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Selecting a different task remounts the panel (keyed on task.id by the
  // caller), so the draft starts fresh without an effect syncing it.

  useEffect(() => {
    if (!datePickerOpen) return
    const h = (e: MouseEvent) => { if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDatePickerOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [datePickerOpen])

  const v = resolveTaskVisuals(draft)
  const { TypeIcon } = v
  const companies = loadVisibleCompanies()
  const allUsers = getAllUsers()
  const users = draft.companyId ? allUsers.filter(u => u.companyId === draft.companyId) : allUsers
  const owner = draft.owner ? allUsers.find(u => u.id === draft.owner) : undefined

  const checklist = draft.checklist ?? []
  const doneSteps = checklist.filter(s => s.done).length
  const attachments = draft.attachments ?? []

  const taskActs = useMemo(
    () => activities.filter(a => a.taskId === task.id).slice().reverse(),
    [activities, task.id],
  )
  const shownActs = fullLog ? taskActs : taskActs.slice(0, 7)

  function patch(p: Partial<Task>) {
    setDraft(d => ({ ...d, ...p }))
    updateTask(task.id, p)
  }

  function addStep() {
    const text = newStep.trim()
    if (!text) return
    patch({ checklist: [...checklist, { id: crypto.randomUUID(), text, done: false }] })
    setNewStep('')
  }

  function toggleStep(id: string) {
    patch({ checklist: checklist.map(s => (s.id === id ? { ...s, done: !s.done } : s)) })
  }

  function acceptFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const added: TaskAttachment[] = Array.from(files).map(f => ({
      id: crypto.randomUUID(), name: f.name, size: f.size,
      source: 'added here', addedAt: new Date().toISOString(),
    }))
    patch({ attachments: [...attachments, ...added] })
  }

  const linkCount = draft.links?.length ?? 0

  // Empty is just the affordance; set spells out the date, the time and how long.
  const scheduleLabel = !draft.dueDate
    ? 'Add a date'
    : [
        formatDateLabel(draft.dueDate),
        draft.plannedTime,
        draft.plannedTime ? `${draft.duration ?? 30}m` : null,
      ].filter(Boolean).join(' · ')

  return (
    <aside style={{
      width: expanded ? 560 : 400, flexShrink: 0, alignSelf: 'flex-start',
      maxHeight: 'calc(100vh - 212px)',
      background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 16,
      display: 'flex', flexDirection: 'column', minWidth: 0,
      boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
    }}>
      {/* ── Top row: company pill + controls ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 0' }}>
        <span style={{ position: 'relative', display: 'inline-flex', flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 12px',
            borderRadius: 999, border: `1px solid ${v.companyColor}`, color: v.companyColor,
            fontSize: 12, fontWeight: 600, maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{v.companyName || 'No company'}</span>
          <select
            value={draft.companyId ?? ''}
            onChange={e => {
              const co = companies.find(c => c.id === e.target.value)
              patch({ companyId: co?.id, company: (co?.id ?? draft.company) as Task['company'], owner: undefined })
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}
          >
            <option value="">No company</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </span>

        <button title={expanded ? 'Narrow the panel' : 'Widen the panel'} onClick={() => setExpanded(x => !x)} style={ICON_BTN}><Maximize2 size={14} /></button>
        <button title="Delete task" onClick={() => { if (window.confirm('Delete this task?')) { deleteTask(task.id); onClose() } }} style={ICON_BTN}>
          <Trash2 size={15} />
        </button>
        <button title="Close" onClick={onClose} style={ICON_BTN}><X size={16} /></button>
      </div>

      {/* ── Scrolling body ───────────────────────────────────────────────── */}
      <div
        onDragOver={e => { e.preventDefault(); setDropping(true) }}
        onDragLeave={() => setDropping(false)}
        onDrop={e => { e.preventDefault(); setDropping(false); acceptFiles(e.dataTransfer.files) }}
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 14px 0',
          outline: dropping ? '2px dashed #F5D14E' : 'none', outlineOffset: -6,
        }}>
        {/* Title */}
        <textarea
          value={draft.title}
          onChange={e => patch({ title: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          rows={2}
          placeholder="Task title"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
            background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 11,
            padding: '12px 14px', outline: 'none', fontFamily: 'Outfit, sans-serif',
            fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712', lineHeight: 1.25,
          }}
        />

        {/* Attributes — one aligned grid instead of a ragged chip row. Every
            cell is the same shape and reads icon-then-value, left aligned, so
            nothing shifts when a value is set or cleared. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8, marginTop: 12,
        }}>
          {/* Schedule — the widest value, so it takes the full row */}
          <div ref={dateRef} style={{ gridColumn: '1 / -1', position: 'relative' }}>
            <button onClick={() => setDatePickerOpen(o => !o)} style={{ ...CELL, width: '100%' }}>
              <CalendarDays size={14} strokeWidth={1.9} style={{ flexShrink: 0, color: draft.dueDate ? '#5F7038' : '#9B9180' }} />
              <span style={{ ...CELL_VALUE, color: draft.dueDate ? '#191712' : '#9B9180' }}>
                {scheduleLabel}
              </span>
              <ChevronDown size={13} style={{ flexShrink: 0, color: '#9B9180' }} />
            </button>
            {datePickerOpen && (
              <DatePopover
                date={draft.dueDate} start={draft.plannedTime} duration={draft.duration}
                onApply={patch}
                onClose={() => setDatePickerOpen(false)}
              />
            )}
          </div>

          {/* Type */}
          <label style={{ ...CELL, position: 'relative' }}>
            <TypeIcon size={14} strokeWidth={1.9} style={{ flexShrink: 0, color: '#6C6553' }} />
            <span style={{ ...CELL_VALUE, color: '#191712' }}>{v.typeLabel}</span>
            <select value={v.type} onChange={e => patch({ taskType: e.target.value as TaskType })} style={CELL_INPUT}>
              {TASK_TYPE_ORDER.map(t => <option key={t} value={t}>{TASK_TYPE_META[t].label}</option>)}
            </select>
          </label>

          {/* Priority */}
          <label style={{ ...CELL, position: 'relative' }}>
            <BarChart3 size={14} strokeWidth={1.9} style={{
              flexShrink: 0, color: draft.priority ? PRIORITY_META[draft.priority].color : '#9B9180',
            }} />
            <span style={{ ...CELL_VALUE, color: draft.priority ? '#191712' : '#9B9180' }}>
              {draft.priority ?? 'No priority'}
            </span>
            <select
              value={draft.priority ?? ''}
              onChange={e => patch({ priority: (e.target.value || undefined) as Priority | undefined })}
              style={CELL_INPUT}>
              <option value="">No priority</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          {/* Owner */}
          <label style={{ ...CELL, gridColumn: '1 / -1', position: 'relative' }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              background: owner ? '#191712' : 'transparent',
              border: owner ? 'none' : '1px dashed #D8CFB8',
              color: owner ? '#FFFFFF' : '#C9C0A8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, fontWeight: 700,
            }}>{owner ? initials(owner.name) : ''}</span>
            <span style={{ ...CELL_VALUE, color: owner ? '#191712' : '#9B9180' }}>
              {owner ? owner.name : 'Unassigned'}
            </span>
            <select value={draft.owner ?? ''} onChange={e => patch({ owner: e.target.value || undefined })} style={CELL_INPUT}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>

          {/* Links */}
          <button
            onClick={() => {
              const url = window.prompt('Paste a link (thread, doc, page)')?.trim()
              if (url) patch({ links: [...(draft.links ?? []), url] })
            }}
            style={CELL}>
            <Link2 size={14} strokeWidth={1.9} style={{ flexShrink: 0, color: linkCount ? '#6C6553' : '#9B9180' }} />
            <span style={{ ...CELL_VALUE, color: linkCount ? '#191712' : '#9B9180' }}>
              {linkCount ? `${linkCount} link${linkCount === 1 ? '' : 's'}` : 'Add a link'}
            </span>
          </button>

          {/* Files */}
          <button onClick={() => fileRef.current?.click()} style={CELL}>
            <Folder size={14} strokeWidth={1.9} style={{ flexShrink: 0, color: attachments.length ? '#6C6553' : '#9B9180' }} />
            <span style={{ ...CELL_VALUE, color: attachments.length ? '#191712' : '#9B9180' }}>
              {attachments.length ? `${attachments.length} file${attachments.length === 1 ? '' : 's'}` : 'Add a file'}
            </span>
          </button>
        </div>

        {/* Checklist */}
        <div style={{ marginTop: 18 }}>
          <p style={SECTION_LABEL}>Checklist · {doneSteps} of {checklist.length}</p>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {checklist.map((s: ChecklistStep) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
                <button onClick={() => toggleStep(s.id)} style={{
                  width: 15, height: 15, borderRadius: 4, boxSizing: 'border-box', flexShrink: 0, padding: 0,
                  border: s.done ? '1.5px solid #191712' : '1.5px solid #CFC6B0',
                  background: s.done ? '#191712' : '#FFFFFF', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{s.done && <Check size={9} color="#fff" strokeWidth={3} />}</button>
                <span style={{
                  flex: 1, fontSize: 12.5, color: s.done ? '#9B9180' : '#191712',
                  textDecoration: s.done ? 'line-through' : 'none',
                }}>{s.text}</span>
                <button onClick={() => patch({ checklist: checklist.filter(x => x.id !== s.id) })}
                  title="Remove step" style={{ ...ICON_BTN, width: 20, height: 20, color: '#C9C0A8' }}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
              <Plus size={13} color="#C9C0A8" style={{ flexShrink: 0 }} />
              <input
                value={newStep}
                onChange={e => setNewStep(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addStep() }}
                onBlur={addStep}
                placeholder="Add step"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 12.5, color: '#191712', fontFamily: 'inherit', padding: 0,
                }}
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginTop: 18 }}>
          <p style={SECTION_LABEL}>Notes</p>
          <textarea
            value={draft.description ?? ''}
            onChange={e => patch({ description: e.target.value })}
            rows={3}
            placeholder="Anything worth remembering…"
            style={{
              width: '100%', boxSizing: 'border-box', marginTop: 8, resize: 'vertical',
              background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 10,
              padding: '10px 12px', fontSize: 12.5, color: '#191712', outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
        </div>

        {/* Attachments — only when the task actually has some */}
        {(attachments.length > 0 || linkCount > 0) && (
          <div style={{ marginTop: 18 }}>
            <p style={SECTION_LABEL}>Attachments · {attachments.length + linkCount}</p>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(draft.links ?? []).map((url, i) => (
                <div key={`${url}-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: '1px solid #E8E1CE', borderRadius: 10, padding: '9px 11px',
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: '#FAF7EC',
                    border: '1px solid #E8E1CE', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6C6553',
                  }}><Link2 size={13} /></span>
                  <a href={url} target="_blank" rel="noreferrer" style={{
                    flex: 1, minWidth: 0, fontSize: 12.5, color: '#2F6BD8',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{url}</a>
                  <button onClick={() => patch({ links: (draft.links ?? []).filter((_, j) => j !== i) })}
                    title="Remove link" style={{ ...ICON_BTN, width: 22, height: 22, color: '#C9C0A8' }}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {attachments.map(f => {
                const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)
                return (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    border: '1px solid #E8E1CE', borderRadius: 10, padding: '9px 11px',
                  }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: '#FAF7EC',
                      border: '1px solid #E8E1CE', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6C6553',
                    }}>{isImage ? <ImageIcon size={13} /> : <FileText size={13} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                      <p style={{ margin: '1px 0 0', fontSize: 11, color: '#9B9180' }}>
                        {formatBytes(f.size)}{f.source ? ` · ${f.source}` : ''}
                      </p>
                    </div>
                    <button onClick={() => patch({ attachments: attachments.filter(x => x.id !== f.id) })}
                      title="Remove attachment" style={{ ...ICON_BTN, width: 22, height: 22, color: '#C9C0A8' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" multiple onChange={e => acceptFiles(e.target.files)} style={{ display: 'none' }} />

        {/* Activity */}
        <div style={{ marginTop: 18, paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setActivityOpen(o => !o)}
              title={activityOpen ? 'Collapse activity' : 'Expand activity'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: 'inherit', textAlign: 'left',
              }}>
              {activityOpen
                ? <ChevronDown size={13} strokeWidth={2.2} color="#9B9180" />
                : <ChevronRight size={13} strokeWidth={2.2} color="#9B9180" />}
              <span style={SECTION_LABEL}>Activity</span>
            </button>
            {activityOpen && taskActs.length > 7 && (
              <button onClick={() => setFullLog(f => !f)} style={{
                display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
                cursor: 'pointer', color: '#6C6553', fontSize: 11.5, fontFamily: 'inherit', padding: 0,
              }}>
                <History size={12} /> {fullLog ? 'Recent only' : 'Full log'}
              </button>
            )}
          </div>
          <div style={{ marginTop: 10, display: activityOpen ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>
            {shownActs.length === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: '#9B9180' }}>Nothing yet.</p>
            )}
            {shownActs.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  background: '#FAF7EC', border: '1px solid #E8E1CE',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B9180',
                }}>
                  <History size={10} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12.5, color: '#191712', lineHeight: 1.35 }}>{a.description}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 11, color: '#9B9180' }}>{relativeStamp(a.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderTop: '1px solid #F0EBDC', padding: '10px 14px',
      }}>
        <span style={{ fontSize: 11.5, color: '#9B9180' }}>Every change saves itself</span>
      </div>
    </aside>
  )
}
