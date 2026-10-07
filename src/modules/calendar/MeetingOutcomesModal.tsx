import { useState, useCallback } from 'react'
import { X, Plus, Trash2, CheckSquare, CalendarPlus } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import type { Priority } from '@/types'

// ─── Public contract ──────────────────────────────────────────────────────────
export interface MeetingEventContext {
  id: string
  title: string
  startIso?: string
  endIso?: string
  calendarId?: string
  attendees?: { email: string; displayName?: string; self?: boolean }[]
}

interface Props {
  event: MeetingEventContext
  onClose: () => void
  /** Called when the user wants to create a follow-up event. Parent does the actual creation. */
  onCreateFollowUp: (
    title: string,
    calId: string,
    date: string,
    startTime: string,
    endTime: string,
  ) => void
}

// ─── Internal types ───────────────────────────────────────────────────────────
interface TaskDraft {
  id: string
  title: string
  dueDate: string
  priority: Priority | ''
}

interface FollowUpDraft {
  title: string
  date: string
  startTime: string
  endTime: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatEventTime(startIso?: string, endIso?: string): string {
  if (!startIso) return ''
  try {
    const start = new Date(startIso)
    const end   = endIso ? new Date(endIso) : null
    const dateStr  = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    const startTm  = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    if (!end) return `${dateStr} · ${startTm}`
    const endTm    = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return `${dateStr} · ${startTm}–${endTm}`
  } catch { return '' }
}

function toDateStr(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 10)
  } catch { return '' }
}

function toTimeStr(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toTimeString().slice(0, 5)
  } catch { return '' }
}

function addOneHour(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function nextWeekday(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  if (d.getDay() === 0) d.setDate(d.getDate() + 1)  // Sun → Mon
  if (d.getDay() === 6) d.setDate(d.getDate() + 2)  // Sat → Mon
  return d.toISOString().slice(0, 10)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MeetingOutcomesModal({ event, onClose, onCreateFollowUp }: Props) {
  const addTask = useTaskStore(s => s.addTask)

  const [tasks, setTasks] = useState<TaskDraft[]>([
    { id: crypto.randomUUID(), title: '', dueDate: '', priority: '' },
  ])

  const [showFollowUp, setShowFollowUp] = useState(false)
  const [followUp, setFollowUp] = useState<FollowUpDraft>(() => {
    const startTime = toTimeStr(event.endIso)
    return {
      title:     `Follow-up: ${event.title}`,
      date:      toDateStr(event.endIso) || nextWeekday(),
      startTime: startTime || '10:00',
      endTime:   startTime ? addOneHour(startTime) : '11:00',
    }
  })

  const [saving, setSaving] = useState(false)

  const addRow = useCallback(() => {
    setTasks(prev => [...prev, { id: crypto.randomUUID(), title: '', dueDate: '', priority: '' }])
  }, [])

  const updateRow = useCallback((id: string, field: keyof TaskDraft, value: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }, [])

  const removeRow = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      for (const t of tasks.filter(t => t.title.trim())) {
        addTask({
          title:     t.title.trim(),
          quadrant:  null,
          company:   'personal',
          status:    'open',
          completed: false,
          dueDate:   t.dueDate || undefined,
          priority:  (t.priority as Priority) || undefined,
          links:     [`cal-event:${event.id}`],
        })
      }
      if (showFollowUp && followUp.title.trim() && followUp.date && event.calendarId) {
        onCreateFollowUp(
          followUp.title.trim(),
          event.calendarId,
          followUp.date,
          followUp.startTime,
          followUp.endTime,
        )
      }
    } finally {
      setSaving(false)
      onClose()
    }
  }

  const timeStr = formatEventTime(event.startIso, event.endIso)
  const othersStr = event.attendees
    ?.filter(a => !a.self)
    .map(a => a.displayName || a.email.split('@')[0])
    .slice(0, 4)
    .join(', ') ?? ''

  const validCount = tasks.filter(t => t.title.trim()).length

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(25,23,18,.42)', backdropFilter: 'blur(3px)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--sb-overlay)',
        border: '1px solid var(--sb-border)',
        borderRadius: 20,
        boxShadow: '0 12px 40px rgba(25,23,18,.24)',
        width: 'min(476px, calc(100vw - 32px))',
        maxHeight: 'min(680px, calc(100vh - 48px))',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--sb-hairline)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'var(--sb-positive-tint)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CheckSquare size={16} color='var(--sb-positive)' />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em',
                color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 3,
              }}>
                Meeting done
              </div>
              <div style={{
                fontSize: 15, fontWeight: 600, color: 'var(--sb-ink-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {event.title}
              </div>
              {timeStr && (
                <div style={{ fontSize: 12, color: 'var(--sb-ink-3)', marginTop: 1 }}>{timeStr}</div>
              )}
              {othersStr && (
                <div style={{ fontSize: 11.5, color: 'var(--sb-ink-4)', marginTop: 1 }}>with {othersStr}</div>
              )}
            </div>
            <button
              onClick={onClose}
              title='Close'
              aria-label='Close meeting outcomes'
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--sb-ink-4)', flexShrink: 0, borderRadius: 6 }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>

          {/* Action items */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 10 }}>
              Action items
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {tasks.map((task, i) => (
                <div
                  key={task.id}
                  style={{
                    background: 'var(--sb-card)',
                    border: '1px solid var(--sb-border)',
                    borderRadius: 12,
                    padding: '10px 12px',
                  }}
                >
                  {/* Title row */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
                    <input
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus={i === 0}
                      value={task.title}
                      onChange={e => updateRow(task.id, 'title', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }}
                      placeholder='Action item…'
                      style={{
                        flex: 1, border: 'none', background: 'transparent',
                        fontSize: 13.5, color: 'var(--sb-ink-1)', outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    {tasks.length > 1 && (
                      <button
                        onClick={() => removeRow(task.id)}
                        aria-label='Remove action item'
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--sb-ink-4)', borderRadius: 4 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* Due date + priority row */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type='date'
                      value={task.dueDate}
                      onChange={e => updateRow(task.id, 'dueDate', e.target.value)}
                      style={{
                        flex: 1, border: '1px solid var(--sb-border)', borderRadius: 7,
                        background: 'var(--sb-field)', padding: '3px 8px',
                        fontSize: 12, color: task.dueDate ? 'var(--sb-ink-2)' : 'var(--sb-ink-4)',
                        fontFamily: 'inherit', outline: 'none',
                      }}
                    />
                    <select
                      value={task.priority}
                      onChange={e => updateRow(task.id, 'priority', e.target.value)}
                      style={{
                        border: '1px solid var(--sb-border)', borderRadius: 7,
                        background: 'var(--sb-field)', padding: '3px 8px',
                        fontSize: 12,
                        color: task.priority ? 'var(--sb-ink-2)' : 'var(--sb-ink-4)',
                        fontFamily: 'inherit', outline: 'none',
                      }}
                    >
                      <option value=''>Priority</option>
                      <option value='P0'>P0 · Critical</option>
                      <option value='P1'>P1 · High</option>
                      <option value='P2'>P2 · Normal</option>
                      <option value='P3'>P3 · Low</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addRow}
              style={{
                marginTop: 8,
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: '1px dashed var(--sb-border)',
                borderRadius: 10, padding: '7px 12px', cursor: 'pointer',
                fontSize: 12.5, color: 'var(--sb-ink-3)', width: '100%',
                fontFamily: 'inherit',
              }}
            >
              <Plus size={13} />
              Add action item
            </button>
          </div>

          {/* Follow-up event */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: showFollowUp ? 12 : 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>
                Follow-up event
              </div>
              <button
                onClick={() => setShowFollowUp(v => !v)}
                style={{
                  border: '1px solid var(--sb-border)', borderRadius: 20,
                  background: showFollowUp ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  color: showFollowUp ? 'var(--sb-bg)' : 'var(--sb-ink-3)',
                  padding: '2px 11px', fontSize: 11.5, cursor: 'pointer',
                  fontFamily: 'inherit', lineHeight: 1.6,
                }}
              >
                {showFollowUp ? 'On' : 'Off'}
              </button>
            </div>

            {showFollowUp && (
              <div style={{
                background: 'var(--sb-card)',
                border: '1px solid var(--sb-border)',
                borderRadius: 12, padding: '12px',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                  <CalendarPlus size={14} color='var(--sb-ink-3)' />
                  <input
                    value={followUp.title}
                    onChange={e => setFollowUp(f => ({ ...f, title: e.target.value }))}
                    placeholder='Follow-up title…'
                    style={{
                      flex: 1, border: 'none', background: 'transparent',
                      fontSize: 13.5, color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type='date'
                    value={followUp.date}
                    onChange={e => setFollowUp(f => ({ ...f, date: e.target.value }))}
                    style={{
                      flex: 2, border: '1px solid var(--sb-border)', borderRadius: 8,
                      background: 'var(--sb-field)', padding: '5px 8px',
                      fontSize: 12, color: 'var(--sb-ink-2)', fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                  <input
                    type='time'
                    value={followUp.startTime}
                    onChange={e => setFollowUp(f => ({ ...f, startTime: e.target.value }))}
                    style={{
                      flex: 1, border: '1px solid var(--sb-border)', borderRadius: 8,
                      background: 'var(--sb-field)', padding: '5px 8px',
                      fontSize: 12, color: 'var(--sb-ink-2)', fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                  <input
                    type='time'
                    value={followUp.endTime}
                    onChange={e => setFollowUp(f => ({ ...f, endTime: e.target.value }))}
                    style={{
                      flex: 1, border: '1px solid var(--sb-border)', borderRadius: 8,
                      background: 'var(--sb-field)', padding: '5px 8px',
                      fontSize: 12, color: 'var(--sb-ink-2)', fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '14px 22px 18px',
          borderTop: '1px solid var(--sb-hairline)',
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              border: '1px solid var(--sb-border)', borderRadius: 10,
              background: 'var(--sb-field)', padding: '7px 16px',
              fontSize: 13.5, color: 'var(--sb-ink-2)', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              border: 'none', borderRadius: 10,
              background: 'var(--sb-ink-1)', padding: '7px 18px',
              fontSize: 13.5, color: 'var(--sb-bg)', cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontWeight: 600, opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…'
              : validCount > 0
                ? `Save ${validCount} item${validCount !== 1 ? 's' : ''}${showFollowUp ? ' + follow-up' : ''}`
                : showFollowUp ? 'Create follow-up'
                  : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
