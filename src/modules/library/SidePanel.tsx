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
      width: narrow ? '100%' : 'clamp(300px, calc(32 * var(--vw)), 420px)', flexShrink: 0, boxSizing: 'border-box', maxHeight: '100%', overflow: 'hidden',
      // The assistant's button is fixed to the bottom-right corner of the window, so the panel stops above it
      // instead of reserving a stripe of its own footer for it: the footer is then one full-width row.
      marginBottom: 'calc(var(--ai-fab-clear) - 8px)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)',
      borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-panel)',
    }}>
      {/* The task panel's shape: the card clips, the header and footer are pinned, and the body between
          them is what scrolls — so the bar sits inside the border, below the header. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 14px 0', flexShrink: 0 }}>
        <span style={{ ...CAPS, color: 'var(--sb-ink-3)', flex: 1 }}>{eyebrow}</span>
        {actions}
        <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable',
        display: 'flex', flexDirection: 'column', gap: 12, padding: footer ? '12px 14px 12px' : '12px 14px 14px',
      }}>
        {children}
      </div>
      {footer && (
        <div style={{
          flexShrink: 0, display: 'flex', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, whiteSpace: 'nowrap', boxSizing: 'border-box',
          padding: '12px 14px', minWidth: 0, background: 'var(--sb-page)', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>{footer}</div>
      )}
    </aside>
  )
}
