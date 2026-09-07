// ─── Deliverable prompt ──────────────────────────────────────────────────────
// Work you sat down and did — a "do" or a deep work block — usually leaves
// something behind: a document, a deck, a link to what shipped. Ticking one of
// those off asks for it before the task closes. Everything here is optional;
// what is not optional is that Cancel leaves the task open.

import { useState } from 'react'
import { Button, Card } from '@/components/ui'
import { createPortal } from 'react-dom'
import { X, Link2, Paperclip, Plus, Check, FileText } from 'lucide-react'
import type { Task, TaskAttachment, TaskType } from '@/types'
import { inferTaskType } from '@/types'
import { useTaskStore } from '@/store/taskStore'
import { ICON, STROKE } from '@/lib/type'

/** The kinds of task that produce something you would want to keep. */
const DELIVERS: TaskType[] = ['do', 'deepwork']

export function producesDeliverable(task: Task): boolean {
  return DELIVERS.includes(task.taskType ?? inferTaskType(task.title))
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const FIELD: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px',
  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
  fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none',
}

const ROUND: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 'var(--sb-r-sm)', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
}

export function DeliverablePrompt({ task, onComplete, onCancel }: {
  task: Task
  /** Called with whatever was gathered — either list may be empty. */
  onComplete: (out: { links: string[]; attachments: TaskAttachment[] }) => void
  onCancel: () => void
}) {
  const [links, setLinks] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<TaskAttachment[]>([])
  const [dropping, setDropping] = useState(false)

  function addLink() {
    const url = draft.trim()
    if (!url) return
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    setLinks(l => (l.includes(full) ? l : [...l, full]))
    setDraft('')
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setFiles(f => [...f, ...Array.from(list).map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      source: 'deliverable',
      addedAt: new Date().toISOString(),
    }))])
  }

  const count = links.length + files.length

  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'color-mix(in srgb, var(--sb-ink-1) 34.0%, transparent)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
      <Card style={{ width: 460, maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box', padding: '20px 22px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, color: 'var(--sb-ink-1)', letterSpacing: '-0.02em' }}>
              What came out of it?
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
              Keep the deliverable with “{task.title}”. Both are optional — you can
              close it with nothing attached.
            </p>
          </div>
          <button onClick={onCancel} title="Leave it open" style={{ ...ROUND, width: 32, height: 32, borderRadius: 'var(--sb-r-pill)' }}>
            <X size={ICON.sm} />
          </button>
        </div>

        {/* ── Links ────────────────────────────────────────────────────────── */}
        <p style={{ margin: '18px 0 8px', fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>
          Links
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
            placeholder="Paste a link and press Enter"
            style={{ ...FIELD, flex: 1 }} />
          <button onClick={addLink} disabled={!draft.trim()} title="Add this link"
            style={{ ...ROUND, opacity: draft.trim() ? 1 : 0.45 }}>
            <Plus size={ICON.md} />
          </button>
        </div>
        {links.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {links.map(url => (
              <div key={url} style={{
                display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                height: 'var(--sb-h-nav)', padding: '0 10px', borderRadius: 'var(--sb-r-sm)',
                background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
              }}>
                <Link2 size={ICON.sm} color="var(--sb-ink-3)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-info)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {url}
                </span>
                <button onClick={() => setLinks(l => l.filter(x => x !== url))} title="Remove"
                  style={{ ...ROUND, width: 22, height: 22, border: 'none', background: 'none', color: 'var(--sb-ink-4)' }}>
                  <X size={ICON.sm} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Files ────────────────────────────────────────────────────────── */}
        <p style={{ margin: '18px 0 8px', fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>
          Files
        </p>
        <label
          onDragOver={e => { e.preventDefault(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onDrop={e => { e.preventDefault(); setDropping(false); addFiles(e.dataTransfer.files) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 62, borderRadius: 'var(--sb-r-nav)', cursor: 'pointer',
            background: dropping ? 'rgba(var(--sb-accent-rgb),0.16)' : 'var(--sb-field)',
            border: `1px dashed ${dropping ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
            fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)',
          }}>
          <Paperclip size={ICON.sm} />
          Drop files here, or choose several
          <input type="file" multiple onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} />
        </label>
        {files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {files.map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                height: 'var(--sb-h-nav)', padding: '0 10px', borderRadius: 'var(--sb-r-sm)',
                background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
              }}>
                <FileText size={ICON.sm} color="var(--sb-ink-3)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', flexShrink: 0 }}>{formatBytes(f.size)}</span>
                <button onClick={() => setFiles(x => x.filter(y => y.id !== f.id))} title="Remove"
                  style={{ ...ROUND, width: 22, height: 22, border: 'none', background: 'none', color: 'var(--sb-ink-4)' }}>
                  <X size={ICON.sm} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Close it, or don't ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 20 }}>
          <span style={{ flex: 1, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            {count === 0 ? 'Nothing attached yet' : `${count} attached`}
          </span>
          <button onClick={onCancel} style={{
            height: 40, padding: '0 16px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
            fontSize: 'var(--sb-t-body)', fontFamily: 'inherit',
          }}>Cancel</button>
          <Button variant="primary" onClick={() => onComplete({ links, attachments: files })}><Check size={ICON.sm} strokeWidth={STROKE.active} /> Complete</Button>
        </div>
      </Card>
    </div>,
    document.body,
  )
}

/** Wraps completing a task. Call `requestComplete(task)` wherever you would
 *  have called toggleComplete, and render `prompt` in the same component —
 *  a task that leaves a deliverable behind gets asked for it first, and
 *  everything else closes straight away. */
export function useDeliverableGate() {
  const { toggleComplete, updateTask } = useTaskStore()
  const [pending, setPending] = useState<Task | null>(null)

  function requestComplete(task: Task) {
    // Reopening never asks for anything, and neither does a kind of task that
    // does not produce a deliverable.
    if (task.completed || !producesDeliverable(task)) { toggleComplete(task.id); return }
    setPending(task)
  }

  const prompt = pending ? (
    <DeliverablePrompt
      task={pending}
      onCancel={() => setPending(null)}
      onComplete={({ links, attachments }) => {
        const task = pending
        setPending(null)
        if (links.length || attachments.length) {
          updateTask(task.id, {
            links: [...(task.links ?? []), ...links],
            attachments: [...(task.attachments ?? []), ...attachments],
          })
        }
        toggleComplete(task.id)
      }}
    />
  ) : null

  return { requestComplete, prompt }
}
