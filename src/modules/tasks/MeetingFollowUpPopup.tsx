import { useState } from 'react'
import { X, Sparkles, Plus, Trash2, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { breakdownMeetingNotes } from '@/lib/professor'
import type { ExtractedTask } from '@/lib/professor'
import { loadDynamicCompanies, getAllUsers } from '@/types'
import type { Task, Quadrant } from '@/types'

// ─── editable task row (draft state) ─────────────────────────────────────────

interface DraftTask {
  title:    string
  quadrant: Quadrant | null
  dueDate:  string
  ownerId:  string   // CompanyUser.id — empty = unassigned
  deleted:  boolean
}

function toDraft(t: ExtractedTask, allUsers: ReturnType<typeof getAllUsers>): DraftTask {
  // Try to match ownerName → user id
  const matched = t.ownerName
    ? allUsers.find(u => u.name.toLowerCase().includes(t.ownerName!.toLowerCase()))
    : undefined
  return {
    title:    t.title,
    quadrant: (t.quadrant as Quadrant) ?? null,
    dueDate:  t.dueDate ?? '',
    ownerId:  matched?.id ?? '',
    deleted:  false,
  }
}

// ─── constants ────────────────────────────────────────────────────────────────

const Q_OPTIONS: { value: Quadrant | null; label: string; color: string }[] = [
  { value: 'do',        label: 'Do',       color: '#E05252' },
  { value: 'schedule',  label: 'Schedule', color: '#7F77DD' },
  { value: 'delegate',  label: 'Delegate', color: '#1D9E75' },
  { value: 'eliminate', label: 'Eliminate',color: '#888780' },
  { value: null,        label: 'Inbox',    color: '#1E40AF' },
]

// ─── inline edit row ──────────────────────────────────────────────────────────

interface RowProps {
  draft:    DraftTask
  index:    number
  expanded: boolean
  onToggle: () => void
  onChange: (patch: Partial<DraftTask>) => void
  onDelete: () => void
}

function TaskRow({ draft, index, expanded, onToggle, onChange, onDelete }: RowProps) {
  const allUsers = getAllUsers()
  const owner    = draft.ownerId ? allUsers.find(u => u.id === draft.ownerId) : undefined
  const q        = Q_OPTIONS.find(o => o.value === draft.quadrant)

  const inp: React.CSSProperties = {
    background: '#0D0F1A', border: '1px solid #2E3450', borderRadius: 6,
    color: '#E8EAF6', fontSize: 12, padding: '5px 8px', outline: 'none',
    fontFamily: 'inherit',
  }

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${expanded ? '#353A60' : '#252A3E'}`,
      background: expanded ? '#1A1F38' : '#161929',
      overflow: 'hidden',
      transition: 'all 0.15s',
      opacity: draft.deleted ? 0.35 : 1,
    }}>
      {/* Summary row — always visible */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', cursor: 'pointer',
        }}
      >
        {/* Row number */}
        <span style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
          background: '#252A3E', fontSize: 10, fontWeight: 700,
          color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {index + 1}
        </span>

        {/* Title */}
        <span style={{
          flex: 1, fontSize: 12.5, color: '#E8EAF6', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {draft.title || <span style={{ color: '#6B7280', fontStyle: 'italic' }}>No title</span>}
        </span>

        {/* Meta chips */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          {q && (
            <span style={{
              fontSize: 9.5, padding: '1px 7px', borderRadius: 4, fontWeight: 600,
              background: `${q.color}18`, color: q.color,
            }}>
              {q.label}
            </span>
          )}
          {draft.dueDate && (
            <span style={{ fontSize: 10, color: '#6B7280' }}>
              {new Date(draft.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {owner && (
            <span style={{ fontSize: 10, color: '#1D9E75', fontWeight: 500 }}>
              → {owner.name.split(' ')[0]}
            </span>
          )}
        </div>

        {expanded
          ? <ChevronUp  size={13} color="#6B7280" style={{ flexShrink: 0 }} />
          : <ChevronDown size={13} color="#6B7280" style={{ flexShrink: 0 }} />
        }
      </div>

      {/* Expanded edit form */}
      {expanded && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Title */}
          <div>
            <label style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 4 }}>Title</label>
            <input
              autoFocus
              value={draft.title}
              onChange={e => onChange({ title: e.target.value })}
              style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Quadrant selector */}
          <div>
            <label style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 6 }}>
              Eisenhower box <span style={{ color: '#404560' }}>(leave as Inbox to decide later)</span>
            </label>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {Q_OPTIONS.map(opt => {
                const active = draft.quadrant === opt.value
                return (
                  <button
                    key={String(opt.value)}
                    onClick={() => onChange({ quadrant: opt.value })}
                    style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: active ? 700 : 500,
                      background: active ? `${opt.color}22` : 'transparent',
                      border: `1px solid ${active ? opt.color + '60' : '#252A3E'}`,
                      color: active ? opt.color : '#6B7280',
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Due date + Owner row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 4 }}>Due date</label>
              <input
                type="date"
                value={draft.dueDate}
                onChange={e => onChange({ dueDate: e.target.value })}
                style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 4 }}>Owner</label>
              <select
                value={draft.ownerId}
                onChange={e => onChange({ ownerId: e.target.value })}
                style={{ ...inp, width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
              >
                <option value="">— unassigned —</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} · {u.companyName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={onDelete}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'transparent', border: '1px solid #252A3E',
                borderRadius: 6, padding: '4px 10px', color: '#6B7280',
                fontSize: 11.5, cursor: 'pointer',
              }}
            >
              <Trash2 size={11} /> Remove
            </button>
            <button
              onClick={onToggle}
              style={{
                background: '#1E40AF18', border: '1px solid #1E40AF40',
                borderRadius: 6, padding: '4px 14px', color: '#1E40AF',
                fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Done editing
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main popup ───────────────────────────────────────────────────────────────

interface Props {
  parentTask: Task
  onConfirm: (tasks: ExtractedTask[]) => void
  onSkip: () => void
}

export function MeetingFollowUpPopup({ parentTask, onConfirm, onSkip }: Props) {
  const [notes,       setNotes]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [drafts,      setDrafts]      = useState<DraftTask[] | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const companies = loadDynamicCompanies()
  const allUsers  = getAllUsers()

  async function handleAnalyze() {
    if (!notes.trim()) { onConfirm([]); return }
    setLoading(true)
    try {
      const tasks = await breakdownMeetingNotes(notes, parentTask.title, companies)
      setDrafts(tasks.map(t => toDraft(t, allUsers)))
      setExpandedIdx(null)
    } catch {
      setDrafts([])
    } finally {
      setLoading(false)
    }
  }

  function patchDraft(i: number, patch: Partial<DraftTask>) {
    setDrafts(prev => prev ? prev.map((d, idx) => idx === i ? { ...d, ...patch } : d) : prev)
  }

  function deleteDraft(i: number) {
    setDrafts(prev => prev ? prev.map((d, idx) => idx === i ? { ...d, deleted: true } : d) : prev)
    if (expandedIdx === i) setExpandedIdx(null)
  }

  function handleSave() {
    const active = (drafts ?? []).filter(d => !d.deleted && d.title.trim())
    // Convert drafts back to ExtractedTask for the confirm handler
    onConfirm(active.map(d => ({
      title:     d.title.trim(),
      quadrant:  d.quadrant,
      dueDate:   d.dueDate || undefined,
      ownerName: d.ownerId
        ? allUsers.find(u => u.id === d.ownerId)?.name
        : undefined,
      ownerId:   d.ownerId || undefined,
    } as ExtractedTask & { ownerId?: string })))
  }

  const activeCount = (drafts ?? []).filter(d => !d.deleted).length

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onSkip}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          zIndex: 1000, backdropFilter: 'blur(3px)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1001,
        width: 560, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 64px)',
        background: '#161929',
        border: '1px solid #252A3E',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px 14px',
          borderBottom: '1px solid #252A3E',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: '#1D9E7518', border: '1px solid #1D9E7530',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Check size={16} color="#1D9E75" strokeWidth={2.5} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 700, color: '#E8EAF6' }}>
              {drafts === null ? 'Meeting complete!' : `${activeCount} follow-up task${activeCount !== 1 ? 's' : ''}`}
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>
              {drafts === null
                ? <>From <span style={{ color: '#94A3B8' }}>"{parentTask.title}"</span></>
                : 'Review and edit before saving to Inbox · click any row to edit'
              }
            </p>
          </div>
          <button onClick={onSkip} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6B7280', padding: 4, borderRadius: 6, flexShrink: 0,
          }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {drafts === null ? (
            /* ── Phase 1: paste notes ── */
            <>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94A3B8' }}>
                Paste your notes, action items, or anything discussed. The AI will extract tasks automatically.
              </p>
              <textarea
                autoFocus
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={'- Follow up with Ali on the API proposal\n- Schedule deep dive on Q3 metrics\n- John to send updated deck by Friday'}
                style={{
                  width: '100%', minHeight: 140, resize: 'vertical',
                  background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 8,
                  color: '#E8EAF6', fontSize: 12.5, padding: '10px 12px',
                  outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAnalyze()
                }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 10.5, color: '#4B5563' }}>
                ⌘↵ to analyze · Leave empty to skip
              </p>
            </>

          ) : drafts.length === 0 ? (
            /* ── No tasks extracted ── */
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#6B7280', fontSize: 13 }}>
              No action items detected. You can still add tasks manually from Inbox.
            </div>

          ) : (
            /* ── Phase 2: editable review table ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 90px 72px 80px',
                padding: '0 12px',
                gap: 8,
              }}>
                {['#', 'Task', 'Box', 'Due', 'Owner'].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</span>
                ))}
              </div>

              {drafts.map((draft, i) => (
                <TaskRow
                  key={i}
                  draft={draft}
                  index={i}
                  expanded={expandedIdx === i}
                  onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  onChange={patch => patchDraft(i, patch)}
                  onDelete={() => deleteDraft(i)}
                />
              ))}

              {/* Re-analyze link */}
              <button
                onClick={() => { setDrafts(null); setExpandedIdx(null) }}
                style={{
                  alignSelf: 'flex-start', marginTop: 4,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 11.5, color: '#4B5563', textDecoration: 'underline', padding: 0,
                }}
              >
                ← Re-paste notes
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #252A3E',
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
        }}>
          <button onClick={onSkip} style={{
            padding: '7px 16px', borderRadius: 8, fontSize: 12.5,
            background: 'transparent', border: '1px solid #252A3E',
            color: '#6B7280', cursor: 'pointer',
          }}>
            Skip
          </button>

          {drafts === null ? (
            <button
              onClick={() => void handleAnalyze()}
              disabled={loading}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: loading ? '#252A3E' : '#7F77DD22',
                border: '1px solid #7F77DD50',
                color: loading ? '#6B7280' : '#7F77DD',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Sparkles size={12} />
              {loading ? 'Analyzing…' : notes.trim() ? 'Analyze & Extract' : 'Done (no notes)'}
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={activeCount === 0}
              style={{
                padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: activeCount > 0 ? '#1D9E7522' : '#252A3E',
                border: `1px solid ${activeCount > 0 ? '#1D9E7550' : '#252A3E'}`,
                color: activeCount > 0 ? '#1D9E75' : '#6B7280',
                cursor: activeCount > 0 ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Plus size={12} />
              Save {activeCount} task{activeCount !== 1 ? 's' : ''} to Inbox
            </button>
          )}
        </div>
      </div>
    </>
  )
}
