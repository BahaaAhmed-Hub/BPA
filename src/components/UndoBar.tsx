import { useCallback, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { inTextField, subscribeUndo, topUndo, undoLast, type UndoEntry } from '@/lib/undo'
import { ICON, STROKE } from '@/lib/type'

// ─── The corner that says what just happened ─────────────────────────────────
//
// It names the last thing done and offers to take it back. It fades after a
// few seconds because it is a courtesy, not a dialog — ⌘Z still works long
// after it has gone, for as far back as the stack goes.

const SHOWN_MS = 7_000

export function UndoBar() {
  const [entry, setEntry] = useState<UndoEntry | null>(null)
  const [shownId, setShownId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => subscribeUndo(() => {
    const top = topUndo()
    setEntry(top)
    if (top) setShownId(top.id)
  }), [])

  // Each new action gets its own few seconds.
  useEffect(() => {
    if (!shownId) return
    const t = window.setTimeout(() => setShownId(null), SHOWN_MS)
    return () => window.clearTimeout(t)
  }, [shownId])

  // Anything else worth one line in the corner.
  useEffect(() => {
    const onNote = (e: Event) => setFlash((e as CustomEvent<string>).detail)
    window.addEventListener('professor:notify', onNote)
    return () => window.removeEventListener('professor:notify', onNote)
  }, [])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 5_000)
    return () => window.clearTimeout(t)
  }, [flash])

  const take = useCallback(async () => {
    const done = await undoLast()
    if (done) { setFlash(`Undone — ${done.label.charAt(0).toLowerCase()}${done.label.slice(1)}`); setShownId(null) }
  }, [])

  // ⌘Z / Ctrl-Z, but never over a text field: inside one the browser's own undo
  // knows about the caret and the selection, and this does not.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey) return
      if (inTextField(document.activeElement)) return
      if (!topUndo()) return
      e.preventDefault()
      void take()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [take])

  const visible = flash ?? (entry && shownId === entry.id ? entry.label : null)
  if (!visible) return null
  const isFlash = flash !== null

  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)',
      zIndex: 4000, display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', borderRadius: 'var(--sb-r-nav)',
      padding: isFlash ? '11px 18px' : '9px 9px 9px 18px',
      boxShadow: 'var(--sb-shadow-menu)',
      fontFamily: 'inherit', fontSize: 'var(--sb-t-body)', maxWidth: 'min(560px, 92vw)',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{visible}</span>
      {!isFlash && (
        <button
          onClick={() => void take()}
          title="Undo — ⌘Z"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            height: 30, padding: '0 12px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
            background: 'var(--sb-accent)', border: '1px solid rgba(25,23,18,0.18)',
            color: 'var(--sb-ink-1)', fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
          }}>
          <RotateCcw size={ICON.sm} strokeWidth={STROKE.active} />
          Undo
        </button>
      )}
    </div>
  )
}
