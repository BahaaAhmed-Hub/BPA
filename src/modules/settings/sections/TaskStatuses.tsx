import { useState, useEffect, useRef } from 'react'
import { STATUS_COLORS_PRESETS } from '@/lib/palettes'
import { Plus, Trash2, X, RefreshCw, Pencil, GripVertical } from 'lucide-react'
import { loadCustomStatuses, saveCustomStatuses, moveStatus, DEFAULT_STATUSES, type CustomStatus } from '@/lib/customStatuses'
import { ICON } from '@/lib/type'
import { inputStyle } from '@/lib/fields'

// ─── Task Statuses Section ───────────────────────────────────────────────────


export function TaskStatusesSection() {
  const [statuses, setStatuses] = useState<CustomStatus[]>(loadCustomStatuses)

  // The board can rename and reorder statuses too, so pick those changes up
  useEffect(() => {
    const h = () => setStatuses(loadCustomStatuses())
    window.addEventListener('professor:statusesUpdated', h)
    return () => window.removeEventListener('professor:statusesUpdated', h)
  }, [])
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{ id: string; label: string; color: string }>({ id: '', label: '', color: 'var(--sb-ink-3)' })

  function persist(next: CustomStatus[]) {
    setStatuses(next)
    saveCustomStatuses(next)
  }

  function startAdd() {
    setEditIdx(null)
    setDraft({ id: '', label: '', color: 'var(--sb-ink-3)' })
    setAdding(true)
  }

  function startEdit(i: number) {
    setAdding(false)
    setEditIdx(i)
    setDraft({ ...statuses[i] })
  }

  function confirmSave() {
    const id = draft.id.trim().toLowerCase().replace(/\s+/g, '-') || draft.label.trim().toLowerCase().replace(/\s+/g, '-')
    const label = draft.label.trim()
    if (!label || !id) return
    if (adding) {
      persist([...statuses, { id, label, color: draft.color }])
      setAdding(false)
    } else if (editIdx !== null) {
      const next = statuses.map((s, i) => i === editIdx ? { id, label, color: draft.color } : s)
      persist(next)
      setEditIdx(null)
    }
  }

  function remove(i: number) {
    persist(statuses.filter((_, idx) => idx !== i))
    if (editIdx === i) setEditIdx(null)
  }

  function move(from: number, to: number) {
    persist(moveStatus(statuses, from, to))
    setEditIdx(null)
  }

  // Drag a row onto another to reorder — the order here is the column order
  const dragIdx = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  function resetDefaults() {
    persist(DEFAULT_STATUSES)
    setEditIdx(null)
    setAdding(false)
  }

  const isEditingRow = (i: number) => editIdx === i && !adding

  const formEl = (
    <div style={{ padding: '10px 14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 4, fontWeight: 600 }}>Label</div>
          <input value={draft.label} onChange={e => setDraft(p => ({ ...p, label: e.target.value }))}
            placeholder="e.g. In Review" autoFocus
            style={{ ...inputStyle, fontSize: 'var(--sb-t-body-s)' }}
            onKeyDown={e => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') { setAdding(false); setEditIdx(null) } }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 4, fontWeight: 600 }}>ID (slug)</div>
          <input value={draft.id} onChange={e => setDraft(p => ({ ...p, id: e.target.value }))}
            placeholder="auto from label"
            style={{ ...inputStyle, fontSize: 'var(--sb-t-body-s)' }} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 6, fontWeight: 600 }}>Color</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_COLORS_PRESETS.map(c => (
            <button key={c} onClick={() => setDraft(p => ({ ...p, color: c }))} style={{
              width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', background: c, border: 'none', cursor: 'pointer',
              outline: draft.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
            }} />
          ))}
          <input type="color" value={draft.color} onChange={e => setDraft(p => ({ ...p, color: e.target.value }))}
            style={{ width: 22, height: 22, border: 'none', borderRadius: 'var(--sb-r-pill)', padding: 0, cursor: 'pointer', background: 'transparent' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setAdding(false); setEditIdx(null) }}
          style={{ padding: '5px 12px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
          <X size={ICON.sm} /> Cancel
        </button>
        <button onClick={confirmSave}
          style={{ padding: '5px 14px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.31)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
          <Plus size={ICON.sm} /> {adding ? 'Add Status' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
        Define custom board statuses. These appear as columns in the Status board and in the task detail dropdown.
      </p>

      {statuses.map((s, i) => (
        <div key={s.id + i}>
          <div
            draggable
            onDragStart={e => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={e => { e.preventDefault(); if (dragIdx.current !== null && overIdx !== i) setOverIdx(i) }}
            onDragLeave={() => setOverIdx(o => (o === i ? null : o))}
            onDrop={e => {
              e.preventDefault()
              if (dragIdx.current !== null && dragIdx.current !== i) move(dragIdx.current, i)
              dragIdx.current = null
              setOverIdx(null)
            }}
            onDragEnd={() => { dragIdx.current = null; setOverIdx(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
              background: overIdx === i ? 'rgba(var(--sb-accent-rgb),0.10)' : 'transparent',
            }}>
            <span title="Drag to reorder" style={{ display: 'flex', color: 'var(--sb-ink-3)', cursor: 'grab', flexShrink: 0 }}>
              <GripVertical size={ICON.sm} />
            </span>
            <div style={{ width: 10, height: 10, borderRadius: 'var(--sb-r-pill)', background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{s.label}</span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', padding: '2px 7px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
              {s.id}
            </span>
            <button onClick={() => startEdit(i)} title="Edit"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isEditingRow(i) ? 'var(--sb-accent)' : 'var(--sb-ink-3)', padding: 4 }}>
              <Pencil size={ICON.sm} />
            </button>
            <button onClick={() => remove(i)} title="Delete"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4 }}>
              <Trash2 size={ICON.sm} />
            </button>
          </div>
          {isEditingRow(i) && formEl}
        </div>
      ))}

      {adding && formEl}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={startAdd} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 7,
          padding: '11px 16px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: '1px dashed var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', cursor: 'pointer',
        }}>
          <Plus size={ICON.sm} /> Add a status
        </button>
        <button onClick={resetDefaults} title="Reset to defaults" style={{
          padding: '11px 14px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: 'var(--sb-border-width) solid var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={ICON.sm} /> Reset
        </button>
      </div>
    </div>
  )
}
