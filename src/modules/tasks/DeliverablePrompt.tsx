// ─── Deliverable prompt ──────────────────────────────────────────────────────
// Work you sat down and did — a "do" or a deep work block — usually leaves
// something behind: a document, a deck, a link to what shipped. Ticking one of
// those off asks for it before the task closes. Everything here is optional;
// what is not optional is that Cancel leaves the task open.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Link2, Paperclip, Plus, Check, FileText } from 'lucide-react'
import type { Task, TaskAttachment, TaskType } from '@/types'
import { inferTaskType } from '@/types'
import { useTaskStore } from '@/store/taskStore'

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
  background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 9,
  fontSize: 13, color: '#191712', fontFamily: 'inherit', outline: 'none',
}

const ROUND: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 9, flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553', cursor: 'pointer',
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
        background: 'rgba(25,23,18,0.34)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
      <div style={{
        width: 460, maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box',
        background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 16,
        boxShadow: '0 24px 60px -20px rgba(25,23,18,0.45)', padding: '20px 22px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontFamily: 'Outfit, sans-serif', fontSize: 19, fontWeight: 600, color: '#191712', letterSpacing: '-0.02em' }}>
              What came out of it?
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#6C6553', lineHeight: 1.45 }}>
              Keep the deliverable with “{task.title}”. Both are optional — you can
              close it with nothing attached.
            </p>
          </div>
          <button onClick={onCancel} title="Leave it open" style={{ ...ROUND, width: 32, height: 32, borderRadius: '50%' }}>
            <X size={14} />
          </button>
        </div>

        {/* ── Links ────────────────────────────────────────────────────────── */}
        <p style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', textTransform: 'uppercase' }}>
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
            <Plus size={15} />
          </button>
        </div>
        {links.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {links.map(url => (
              <div key={url} style={{
                display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                height: 36, padding: '0 10px', borderRadius: 9,
                background: '#FAF7EC', border: '1px solid #E8E1CE',
              }}>
                <Link2 size={13} color="#6C6553" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#1A73E8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {url}
                </span>
                <button onClick={() => setLinks(l => l.filter(x => x !== url))} title="Remove"
                  style={{ ...ROUND, width: 22, height: 22, border: 'none', background: 'none', color: '#9B9180' }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Files ────────────────────────────────────────────────────────── */}
        <p style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', textTransform: 'uppercase' }}>
          Files
        </p>
        <label
          onDragOver={e => { e.preventDefault(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onDrop={e => { e.preventDefault(); setDropping(false); addFiles(e.dataTransfer.files) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 62, borderRadius: 11, cursor: 'pointer',
            background: dropping ? 'rgba(245,209,78,0.16)' : '#FAF7EC',
            border: `1px dashed ${dropping ? '#F5D14E' : '#D8CFB8'}`,
            fontSize: 12.5, color: '#6C6553',
          }}>
          <Paperclip size={14} />
          Drop files here, or choose several
          <input type="file" multiple onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} />
        </label>
        {files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {files.map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                height: 36, padding: '0 10px', borderRadius: 9,
                background: '#FAF7EC', border: '1px solid #E8E1CE',
              }}>
                <FileText size={13} color="#6C6553" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 11, color: '#9B9180', flexShrink: 0 }}>{formatBytes(f.size)}</span>
                <button onClick={() => setFiles(x => x.filter(y => y.id !== f.id))} title="Remove"
                  style={{ ...ROUND, width: 22, height: 22, border: 'none', background: 'none', color: '#9B9180' }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Close it, or don't ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 20 }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#9B9180' }}>
            {count === 0 ? 'Nothing attached yet' : `${count} attached`}
          </span>
          <button onClick={onCancel} style={{
            height: 40, padding: '0 16px', borderRadius: 9, cursor: 'pointer',
            background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553',
            fontSize: 13, fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={() => onComplete({ links, attachments: files })} style={{
            display: 'flex', alignItems: 'center', gap: 7,
            height: 40, padding: '0 18px', borderRadius: 9, cursor: 'pointer',
            background: '#191712', border: 'none', color: '#FDF8E7',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          }}><Check size={14} strokeWidth={2.6} /> Complete</button>
        </div>
      </div>
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
