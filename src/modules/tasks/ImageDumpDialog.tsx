// ─── AI Scan-to-tasks dialog ──────────────────────────────────────────────────
// Upload a photo or PDF → Claude reads it → review/edit tasks → push to inbox.

import { useState, useRef, useCallback } from 'react'
import { X, Upload, Sparkles, CheckSquare, Square, ChevronDown, AlertTriangle, FileText, Image as ImageIcon, Trash2 } from 'lucide-react'
import { extractTasksFromFile, type ExtractedDraftTask } from '@/lib/imageTaskExtractor'
import { useTaskStore } from '@/store/taskStore'
import { loadVisibleCompanies } from '@/types'
import type { Quadrant, TaskType, CompanyTag } from '@/types'

const QUADRANT_OPTS: { v: Quadrant; label: string; color: string }[] = [
  { v: 'do',        label: 'Do',       color: '#7C3AED' },
  { v: 'schedule',  label: 'Schedule', color: '#7F77DD' },
  { v: 'delegate',  label: 'Delegate', color: '#1D9E75' },
  { v: 'eliminate', label: 'Eliminate',color: '#888780' },
]

const TYPE_OPTS: { v: TaskType; emoji: string; label: string }[] = [
  { v: 'do',       emoji: '✅', label: 'Do' },
  { v: 'call',     emoji: '📞', label: 'Call' },
  { v: 'followup', emoji: '↩️', label: 'Follow-up' },
  { v: 'email',    emoji: '✉️', label: 'Email' },
  { v: 'research', emoji: '🔍', label: 'Research' },
  { v: 'study',    emoji: '📚', label: 'Study' },
  { v: 'meeting',  emoji: '📅', label: 'Meeting' },
]

const inp: React.CSSProperties = {
  background: 'var(--sb-field, #FAF7EC)',
  border: '1px solid var(--sb-border, #E8E1CE)',
  borderRadius: 6, padding: '4px 8px', fontSize: 12,
  color: 'var(--sb-ink-1, #191712)', outline: 'none', fontFamily: 'inherit',
}

type Stage = 'upload' | 'analyzing' | 'review'

interface Props { onClose: () => void }

export function ImageDumpDialog({ onClose }: Props) {
  const { addTasksBatch } = useTaskStore()
  const companies = loadVisibleCompanies()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [stage, setStage]       = useState<Stage>('upload')
  const [preview, setPreview]   = useState<{ url: string; name: string; type: string } | null>(null)
  const [tasks, setTasks]       = useState<ExtractedDraftTask[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [isDragging, setDrag]   = useState(false)
  const [pushDone, setPushDone] = useState(false)
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({})

  const todayStr = new Date().toISOString().slice(0, 10)

  async function processFile(file: File) {
    setError(null)
    const isImage = file.type.startsWith('image/')
    const isPdf   = file.type === 'application/pdf'
    if (!isImage && !isPdf) { setError('Upload an image (JPEG, PNG, WEBP) or PDF.'); return }

    const objectUrl = URL.createObjectURL(file)
    setPreview({ url: objectUrl, name: file.name, type: file.type })
    setStage('analyzing')

    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      try {
        const result = await extractTasksFromFile(
          base64, file.type,
          companies.map(c => ({ id: c.id, name: c.name })),
          todayStr,
        )
        setTasks(result.tasks)
        setStage('review')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'AI extraction failed.')
        setStage('upload')
      }
    }
    reader.readAsDataURL(file)
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (file) processFile(file); e.target.value = ''
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const file = e.dataTransfer.files?.[0]; if (file) processFile(file)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function patch(id: string, p: Partial<ExtractedDraftTask>) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...p } : t))
  }
  function toggleAll(on: boolean) { setTasks(ts => ts.map(t => ({ ...t, include: on }))) }

  function pushTasks() {
    const selected = tasks.filter(t => t.include)
    if (!selected.length) return
    addTasksBatch(selected.map(t => {
      const co = t.companyName
        ? companies.find(c => c.name.toLowerCase().includes(t.companyName!.toLowerCase()))
        : null
      return {
        title: t.title, quadrant: t.quadrant,
        company: (co?.id as CompanyTag) ?? 'teradix' as CompanyTag,
        ...(co ? { companyId: co.id } : {}),
        taskType: t.taskType, status: 'open' as const,
        completed: false, urgent: t.urgent,
        ...(t.dueDate ? { dueDate: t.dueDate } : {}),
        ...(t.notes ? { description: t.notes } : {}),
      }
    }))
    setPushDone(true)
    setTimeout(() => onClose(), 1100)
  }

  const included = tasks.filter(t => t.include).length

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(25,23,18,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 700,
        background: 'var(--sb-card, #FFFFFF)',
        borderRadius: 18, border: '1px solid var(--sb-border, #E8E1CE)',
        boxShadow: '0 24px 80px rgba(25,23,18,0.22)',
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 48px)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px 14px', borderBottom: '1px solid var(--sb-hairline, #F0EBDC)' }}>
          <Sparkles size={16} color="#F5D14E" strokeWidth={2} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sb-ink-1, #191712)' }}>Scan task list</div>
            <div style={{ fontSize: 11.5, color: 'var(--sb-ink-4, #9B9180)', marginTop: 1 }}>
              Upload a photo or PDF — AI reads every task, you review before pushing
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4, #9B9180)', padding: 4, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>

          {/* UPLOAD */}
          {stage === 'upload' && (
            <div>
              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(180,82,58,0.07)', border: '1px solid rgba(180,82,58,0.2)', marginBottom: 16 }}>
                  <AlertTriangle size={13} color="#B4523A" />
                  <span style={{ fontSize: 12.5, color: '#B4523A' }}>{error}</span>
                </div>
              )}
              <div
                onDragOver={e => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? '#F5D14E' : 'var(--sb-border, #E8E1CE)'}`,
                  borderRadius: 14, padding: '48px 24px', textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.15s',
                  background: isDragging ? 'rgba(245,209,78,0.06)' : 'var(--sb-field, #FAF7EC)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
                  <ImageIcon size={28} color="#C8BFA8" strokeWidth={1.5} />
                  <FileText size={28} color="#C8BFA8" strokeWidth={1.5} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sb-ink-1, #191712)', marginBottom: 6 }}>
                  Drop your task list here
                </div>
                <div style={{ fontSize: 12, color: 'var(--sb-ink-4, #9B9180)', lineHeight: 1.5 }}>
                  Photo · Notebook scan · Whiteboard · PDF
                </div>
                <div style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 9, background: 'var(--sb-ink-1, #191712)', color: '#FFFFFF', fontSize: 13, fontWeight: 500 }}>
                  <Upload size={13} /> Choose file
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFilePick} style={{ display: 'none' }} />
            </div>
          )}

          {/* ANALYZING */}
          {stage === 'analyzing' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
              {preview && preview.type !== 'application/pdf' && (
                <img src={preview.url} alt="preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, border: '1px solid var(--sb-border, #E8E1CE)', objectFit: 'contain' }} />
              )}
              {preview?.type === 'application/pdf' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderRadius: 12, background: 'var(--sb-field, #FAF7EC)', border: '1px solid var(--sb-border, #E8E1CE)' }}>
                  <FileText size={22} color="#6C6553" strokeWidth={1.5} />
                  <span style={{ fontSize: 13, color: '#6C6553' }}>{preview.name}</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <svg width="22" height="22" viewBox="0 0 22 22" style={{ animation: 'img-spin 1s linear infinite' }}>
                  <circle cx="11" cy="11" r="9" stroke="#E8E1CE" strokeWidth="2.5" fill="none"/>
                  <path d="M11 2 A9 9 0 0 1 20 11" stroke="#F5D14E" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
                </svg>
                <style>{`@keyframes img-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sb-ink-1, #191712)' }}>Reading your task list…</div>
                <div style={{ fontSize: 12, color: 'var(--sb-ink-4, #9B9180)' }}>Claude is scanning and extracting tasks</div>
              </div>
            </div>
          )}

          {/* REVIEW */}
          {stage === 'review' && (
            <div>
              {preview && preview.type !== 'application/pdf' && (
                <div style={{ marginBottom: 16 }}>
                  <img src={preview.url} alt="source" style={{ maxHeight: 90, borderRadius: 8, border: '1px solid var(--sb-border, #E8E1CE)', objectFit: 'contain' }} />
                </div>
              )}
              {tasks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: 14, color: 'var(--sb-ink-4, #9B9180)' }}>No tasks found in this file.</div>
                  <button onClick={() => { setStage('upload'); setPreview(null) }} style={{ marginTop: 12, padding: '7px 16px', borderRadius: 8, background: 'var(--sb-field, #FAF7EC)', border: '1px solid var(--sb-border, #E8E1CE)', color: '#6C6553', fontSize: 13, cursor: 'pointer' }}>
                    Try another file
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <button onClick={() => toggleAll(tasks.some(t => !t.include))} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
                      {tasks.every(t => t.include) ? <CheckSquare size={14} color="var(--sb-ink-1, #191712)" /> : <Square size={14} color="#C8BFA8" />}
                      <span style={{ fontSize: 12, color: 'var(--sb-ink-3, #6C6553)' }}>{included} of {tasks.length} selected</span>
                    </button>
                    <span style={{ flex: 1 }} />
                    <button onClick={() => { setStage('upload'); setPreview(null); setTasks([]) }} style={{ fontSize: 11.5, color: 'var(--sb-ink-4, #9B9180)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      ← Try another file
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {tasks.map(t => (
                      <ReviewRow
                        key={t.id} task={t} companies={companies}
                        notesOpen={!!openNotes[t.id]}
                        onToggleNotes={() => setOpenNotes(o => ({ ...o, [t.id]: !o[t.id] }))}
                        onChange={p => patch(t.id, p)}
                        onRemove={() => setTasks(ts => ts.filter(x => x.id !== t.id))}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === 'review' && tasks.length > 0 && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--sb-hairline, #F0EBDC)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--sb-ink-4, #9B9180)' }}>
              {included} task{included !== 1 ? 's' : ''} → Brain dump
            </span>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 9, background: 'transparent', border: '1px solid var(--sb-border, #E8E1CE)', color: 'var(--sb-ink-3, #6C6553)', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={pushTasks}
              disabled={included === 0 || pushDone}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                background: pushDone ? '#1D9E75' : (included === 0 ? 'var(--sb-border, #E8E1CE)' : 'var(--sb-ink-1, #191712)'),
                border: 'none', color: included === 0 ? 'var(--sb-ink-4, #9B9180)' : '#FFFFFF',
                cursor: included === 0 ? 'default' : 'pointer', transition: 'all 0.15s',
              }}
            >
              {pushDone ? '✓ Added!' : `Push ${included} task${included !== 1 ? 's' : ''} to dump`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Single review row ────────────────────────────────────────────────────────

interface RowProps {
  task: ExtractedDraftTask
  companies: ReturnType<typeof loadVisibleCompanies>
  notesOpen: boolean
  onToggleNotes: () => void
  onChange: (p: Partial<ExtractedDraftTask>) => void
  onRemove: () => void
}

function ReviewRow({ task, companies, notesOpen, onToggleNotes, onChange, onRemove }: RowProps) {
  const q = QUADRANT_OPTS.find(o => o.v === task.quadrant)

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${task.include ? 'var(--sb-border, #E8E1CE)' : 'var(--sb-hairline, #F0EBDC)'}`,
      background: task.include ? 'var(--sb-card, #FFFFFF)' : 'var(--sb-field, #FAF7EC)',
      opacity: task.include ? 1 : 0.55, transition: 'all 0.15s', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px' }}>
        {/* Include toggle */}
        <button onClick={() => onChange({ include: !task.include })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 1, flexShrink: 0 }}>
          {task.include ? <CheckSquare size={14} color="var(--sb-ink-1, #191712)" /> : <Square size={14} color="#C8BFA8" />}
        </button>

        {/* Urgent dot */}
        {task.urgent && <div title="Urgent" style={{ width: 7, height: 7, borderRadius: '50%', background: '#B4523A', flexShrink: 0, marginTop: 4 }} />}

        {/* Title */}
        <input
          value={task.title} onChange={e => onChange({ title: e.target.value })}
          style={{ ...inp, flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: 0, fontSize: 13, fontWeight: 500 }}
        />

        {/* Type */}
        <select value={task.taskType} onChange={e => onChange({ taskType: e.target.value as TaskType })}
          style={{ ...inp, padding: '2px 4px', fontSize: 13, width: 'auto', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          {TYPE_OPTS.map(o => <option key={o.v} value={o.v}>{o.emoji} {o.label}</option>)}
        </select>

        {/* Quadrant */}
        <select value={task.quadrant ?? ''} onChange={e => onChange({ quadrant: (e.target.value || null) as Quadrant | null })}
          style={{
            ...inp, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            color: q?.color ?? 'var(--sb-ink-4, #9B9180)',
            background: q ? `${q.color}14` : 'var(--sb-field, #FAF7EC)',
            border: `1px solid ${q ? `${q.color}40` : 'var(--sb-border, #E8E1CE)'}`,
            borderRadius: 20,
          }}>
          <option value="">— Triage</option>
          {QUADRANT_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>

        {/* Company */}
        <select
          value={companies.find(c => c.name.toLowerCase().includes((task.companyName ?? '').toLowerCase()))?.id ?? ''}
          onChange={e => { const co = companies.find(c => c.id === e.target.value); onChange({ companyName: co?.name ?? null }) }}
          style={{ ...inp, padding: '2px 6px', fontSize: 11, cursor: 'pointer', width: 'auto', maxWidth: 100 }}>
          <option value="">— Co.</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Due date */}
        <input type="date" value={task.dueDate ?? ''} onChange={e => onChange({ dueDate: e.target.value || null })}
          style={{ ...inp, padding: '2px 6px', fontSize: 11, width: 'auto' }} />

        {/* Notes toggle */}
        {task.notes && (
          <button onClick={onToggleNotes} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4, #9B9180)', padding: 0, display: 'flex' }}>
            <ChevronDown size={13} style={{ transform: notesOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
        )}

        {/* Remove */}
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4, #9B9180)', padding: 0, display: 'flex' }}>
          <Trash2 size={12} />
        </button>
      </div>

      {task.notes && notesOpen && (
        <div style={{ padding: '0 12px 10px 34px', fontSize: 11.5, color: 'var(--sb-ink-3, #6C6553)', lineHeight: 1.5, borderTop: '1px solid var(--sb-hairline, #F0EBDC)', paddingTop: 8 }}>
          {task.notes}
        </div>
      )}
    </div>
  )
}

// Re-export the emoji for the trigger button
export { TYPE_OPTS }
