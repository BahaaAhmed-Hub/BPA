import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { CAPS, ICON } from '@/lib/type'

/**
 * The one shell for everything the Library makes or edits beside the shelf: a
 * cream panel of white cards, docked to the right on a wide screen and taking
 * the whole column on a phone (as the book panel does). Adding a book and
 * making a list are the same kind of act as editing one, so they stand in the
 * same place and look the same — a modal over the shelf hides the very thing
 * the new book is about to join.
 *
 * `footer` is sticky and keeps the right corner clear: the assistant's floating
 * button is fixed to the viewport and sits on top of whatever is there.
 * Escape closes it, but never from under a dialog.
 */
export function SidePanel({ label, eyebrow, narrow, onClose, actions, footer, children }: {
  label: string
  eyebrow: string
  narrow?: boolean
  onClose: () => void
  /** Icon buttons before Close. */
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      onClose()
    }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <aside aria-label={label} style={{
      width: narrow ? '100%' : 'clamp(300px, 32vw, 420px)', flexShrink: 0, boxSizing: 'border-box', maxHeight: '100%', overflowY: 'auto', scrollbarGutter: 'stable',
      display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 0',
      background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)',
      borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-panel)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ ...CAPS, color: 'var(--sb-ink-3)', flex: 1 }}>{eyebrow}</span>
        {actions}
        <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
      </div>
      {children}
      {footer ? (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, whiteSpace: 'nowrap', boxSizing: 'border-box',
          padding: '12px var(--ai-fab-clear) 14px 14px', margin: '0 -14px', minWidth: 0, background: 'var(--sb-page)', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>{footer}</div>
      ) : <div style={{ height: 56, flexShrink: 0 }} />}
    </aside>
  )
}
