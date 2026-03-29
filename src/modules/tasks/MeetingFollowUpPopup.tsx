import { useState } from 'react'
import { X, Sparkles, Plus, Trash2, Check } from 'lucide-react'
import { breakdownMeetingNotes } from '@/lib/professor'
import type { ExtractedTask } from '@/lib/professor'
import { loadDynamicCompanies } from '@/types'
import type { Task } from '@/types'

interface Props {
  parentTask: Task
  onConfirm: (tasks: ExtractedTask[]) => void  // called with tasks to add (may be empty)
  onSkip: () => void                            // skip without adding tasks
}

export function MeetingFollowUpPopup({ parentTask, onConfirm, onSkip }: Props) {
  const [notes,     setNotes]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [extracted, setExtracted] = useState<ExtractedTask[] | null>(null)
  const [removed,   setRemoved]   = useState<Set<number>>(new Set())

  const companies = loadDynamicCompanies()

  async function handleAnalyze() {
    if (!notes.trim()) { onConfirm([]); return }
    setLoading(true)
    try {
      const tasks = await breakdownMeetingNotes(notes, parentTask.title, companies)
      setExtracted(tasks)
      setRemoved(new Set())
    } catch {
      setExtracted([])
    } finally {
      setLoading(false)
    }
  }

  function toggleRemove(i: number) {
    setRemoved(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function handleAddTasks() {
    const toAdd = (extracted ?? []).filter((_, i) => !removed.has(i))
    onConfirm(toAdd)
  }

  const quadrantColor: Record<string, string> = {
    do: '#E05252', schedule: '#7F77DD', delegate: '#1D9E75', eliminate: '#888780',
  }

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
        width: 520, maxWidth: 'calc(100vw - 32px)',
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
              Meeting complete!
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>
              Any notes or follow-up tasks from <span style={{ color: '#94A3B8' }}>"{parentTask.title}"</span>?
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

          {extracted === null ? (
            /* Notes input phase */
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
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAnalyze()
                }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 10.5, color: '#4B5563' }}>
                ⌘↵ to analyze · Leave empty to skip
              </p>
            </>
          ) : extracted.length === 0 ? (
            /* Empty result */
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#6B7280', fontSize: 13 }}>
              No action items detected. You can still add tasks manually from Inbox.
            </div>
          ) : (
            /* Extracted tasks phase */
            <>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94A3B8' }}>
                <Sparkles size={11} style={{ marginRight: 4 }} />
                {extracted.length} task{extracted.length !== 1 ? 's' : ''} extracted — deselect any you don't want:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {extracted.map((t, i) => {
                  const isRemoved = removed.has(i)
                  const qColor = t.quadrant ? (quadrantColor[t.quadrant] ?? '#6B7280') : '#6B7280'
                  return (
                    <div
                      key={i}
                      onClick={() => toggleRemove(i)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                        background: isRemoved ? 'transparent' : '#1A1F35',
                        border: `1px solid ${isRemoved ? '#1A1F35' : '#252A3E'}`,
                        opacity: isRemoved ? 0.4 : 1,
                        transition: 'all 0.15s',
                      }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${isRemoved ? '#404560' : '#1D9E75'}`,
                        background: isRemoved ? 'transparent' : '#1D9E7520',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {!isRemoved && <Check size={9} color="#1D9E75" strokeWidth={3} />}
                      </div>

                      {/* Title */}
                      <span style={{
                        flex: 1, fontSize: 12.5, color: '#E8EAF6',
                        textDecoration: isRemoved ? 'line-through' : 'none',
                      }}>
                        {t.title}
                      </span>

                      {/* Meta chips */}
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                        {t.quadrant && (
                          <span style={{
                            fontSize: 9.5, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                            background: `${qColor}18`, color: qColor,
                          }}>
                            {t.quadrant}
                          </span>
                        )}
                        {t.dueDate && (
                          <span style={{ fontSize: 10, color: '#6B7280' }}>
                            {new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        {t.ownerName && (
                          <span style={{ fontSize: 10, color: '#1D9E75' }}>→ {t.ownerName}</span>
                        )}
                      </div>

                      <Trash2 size={11} color="#6B7280" style={{ flexShrink: 0 }} />
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #252A3E',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button onClick={onSkip} style={{
            padding: '7px 16px', borderRadius: 8, fontSize: 12.5,
            background: 'transparent', border: '1px solid #252A3E',
            color: '#6B7280', cursor: 'pointer',
          }}>
            Skip
          </button>

          {extracted === null ? (
            <button
              onClick={handleAnalyze}
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
              {loading ? (
                <>
                  <span style={{ fontSize: 11 }}>Analyzing…</span>
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  {notes.trim() ? 'Analyze & Extract' : 'Done (no notes)'}
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleAddTasks}
              disabled={extracted.length > 0 && removed.size === extracted.length}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: '#1D9E7522', border: '1px solid #1D9E7550',
                color: '#1D9E75', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Plus size={12} />
              Add {extracted.filter((_, i) => !removed.has(i)).length} to Inbox
            </button>
          )}
        </div>
      </div>
    </>
  )
}
